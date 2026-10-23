#!/usr/bin/env python3
"""Control del prototipo de orugas: la Raspberry Pi 3 Model B maneja directamente el puente H L298N.

Un solo programa, sin dependencias fuera de lo que trae Raspberry Pi OS:
  * servidor web para manejar el vehículo desde el celular (red Wi-Fi propia de la Raspberry Pi);
  * control de los motores: PWM por hardware en GPIO 12 (ENA) y GPIO 13 (ENB),
    sentido de giro en GPIO 17/27 (IN1/IN2, motor A izquierdo) y GPIO 22/23 (IN3/IN4, motor B derecho);
  * recorridos programados por tramos de tiempo y velocidad, en lazo abierto;
  * modo automático por los puntos de la finca (finca.json): va de punto en punto solo por los caminos,
    en línea recta, sin pasar por los cultivos; espera en cada punto 1 s o la orden del usuario;
  * vigilancia: detiene los motores si dejan de llegar órdenes del celular durante TIMEOUT_MS;
  * registro en CSV de cada orden, con el código de la prueba, la superficie y la carga.

Uso en la Raspberry Pi (ver README.md):   sudo python3 ugv.py
Uso en un computador, sin hardware:       python3 ugv.py --simular      (abre http://localhost:8080)

Limitación declarada en el informe: si este programa o el sistema operativo se bloquean, los pines pueden
quedar en su último estado. El corte total del prototipo es desconectar la batería.
"""
import argparse
import collections
import csv
import json
import logging
import math
import os
import re
import signal
import socket
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

VERSION = "1.1.0"
DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- pines (numeración BCM) del diagrama final
PIN_ENA, PIN_IN1, PIN_IN2 = 12, 17, 27   # motor A, oruga izquierda  (pines físicos 32, 11, 13)
PIN_IN3, PIN_IN4, PIN_ENB = 22, 23, 13   # motor B, oruga derecha    (pines físicos 15, 16, 33)
PWM_CANAL = {12: 0, 13: 1}               # GPIO 12 = PWM0, GPIO 13 = PWM1 (dtoverlay=pwm-2chan)

# ---------------------------------------------------------------- configuración (se puede cambiar en config.json)
CONFIG_DEF = {
    "puerto": 80,           # http://10.42.0.1 desde el celular conectado a la red del vehículo
    "pwm_hz": 1000,         # frecuencia de la PWM hacia ENA y ENB
    "timeout_ms": 800,      # sin órdenes durante este tiempo -> parada (en el informe: "____ ms"; ajustar con las pruebas)
    "factor_izq": 1.0,      # ajuste por software de cada motor si el vehículo se desvía en línea recta
    "factor_der": 1.0,
    "toma_control_s": 3.0,  # otro celular puede tomar el control si el actual no envía órdenes en este tiempo
    "vel_auto": 60,         # velocidad (%) del modo automático y de la calibración
    "cm_s": None,           # avance medido a vel_auto (cm/s): se obtiene en la calibración
    "grados_s": None,       # giro sobre el eje medido a vel_auto (°/s): se obtiene en la calibración
    "espera_s": 1.0,        # espera en cada punto del modo automático
    "pausa_giro_s": 0.5,    # pausa entre movimientos distintos del modo automático (avanzar, girar, retroceder)
    "prueba_calibracion_s": 10.0,  # duración de las pruebas de calibración (más largo = medición más precisa)
}
TIPOS = {  # tipo de tramo -> sentido de (oruga izquierda, oruga derecha)
    "avanzar": (1, 1), "retroceder": (-1, -1), "izquierda": (-1, 1), "derecha": (1, -1), "pausa": (0, 0),
}
MAX_TRAMOS, MAX_DURACION_S = 50, 60.0
NOMBRE_OK = re.compile(r"^[\w\- áéíóúñÁÉÍÓÚÑ]{1,40}$")

log = logging.getLogger("ugv")


def cargar_config(ruta):
    cfg = dict(CONFIG_DEF)
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if k in CONFIG_DEF})
    return cfg


# ================================================================ salidas
class PWMHardware:
    """PWM por hardware de la Raspberry Pi a través de /sys/class/pwm (requiere dtoverlay=pwm-2chan)."""

    def __init__(self, gpio, hz):
        self.canal = PWM_CANAL[gpio]
        self.chip = self._buscar_chip()
        self.base = f"{self.chip}/pwm{self.canal}"
        if not os.path.isdir(self.base):
            self._escribir(f"{self.chip}/export", self.canal)
            for _ in range(50):                      # el sistema tarda un momento en crear los archivos
                if os.access(f"{self.base}/period", os.W_OK):
                    break
                time.sleep(0.02)
        self.periodo = int(1e9 / hz)
        self._escribir(f"{self.base}/enable", 0)
        self._escribir(f"{self.base}/duty_cycle", 0)
        self._escribir(f"{self.base}/period", self.periodo)
        self._escribir(f"{self.base}/enable", 1)

    @staticmethod
    def _buscar_chip():
        raiz = "/sys/class/pwm"
        for nombre in sorted(os.listdir(raiz)) if os.path.isdir(raiz) else []:
            ruta = os.path.join(raiz, nombre)
            try:
                with open(os.path.join(ruta, "npwm")) as f:
                    if int(f.read()) >= 2:
                        return ruta
            except OSError:
                continue
        raise RuntimeError("No hay PWM por hardware: agrega 'dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4' "
                           "y 'dtparam=audio=off' en config.txt y reinicia (ver README.md).")

    @staticmethod
    def _escribir(ruta, valor):
        with open(ruta, "w") as f:
            f.write(str(valor))

    def set(self, fraccion):
        self._escribir(f"{self.base}/duty_cycle", int(self.periodo * max(0.0, min(1.0, fraccion))))

    def close(self):
        try:
            self.set(0)
            self._escribir(f"{self.base}/enable", 0)
        except OSError:
            pass


class PWMSoftware:
    """Respaldo si no está activo el overlay: PWM por software de gpiozero (menos estable)."""

    def __init__(self, gpio, hz):
        from gpiozero import PWMOutputDevice
        self.dev = PWMOutputDevice(gpio, frequency=hz, initial_value=0)

    def set(self, fraccion):
        self.dev.value = max(0.0, min(1.0, fraccion))

    def close(self):
        self.dev.close()


class SalidaDigital:
    def __init__(self, gpio):
        from gpiozero import DigitalOutputDevice
        self.dev = DigitalOutputDevice(gpio, initial_value=False)

    def set(self, nivel):
        self.dev.value = 1 if nivel else 0

    def close(self):
        self.dev.close()


class SalidaSimulada:
    """Para probar el programa en un computador: guarda el valor que tendría el pin."""

    def __init__(self, gpio, *_):
        self.gpio, self.valor = gpio, 0

    def set(self, valor):
        self.valor = valor

    def close(self):
        self.valor = 0


# ================================================================ motores
class Motores:
    """Traduce una orden (-100..100 por oruga) en el sentido de IN1..IN4 y el ancho de pulso de ENA/ENB."""

    def __init__(self, cfg, simular=False):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.izq = self.der = 0
        if simular:
            self.tipo_pwm = "simulada"
            pwm, dig = SalidaSimulada, SalidaSimulada
        else:
            dig = SalidaDigital
            try:
                PWMHardware(PIN_ENA, cfg["pwm_hz"]).close()   # comprobación
                pwm, self.tipo_pwm = PWMHardware, "hardware"
            except (RuntimeError, OSError) as e:
                log.warning("%s Se usa PWM por software como respaldo.", e)
                pwm, self.tipo_pwm = PWMSoftware, "software"
        self.ena, self.enb = pwm(PIN_ENA, cfg["pwm_hz"]), pwm(PIN_ENB, cfg["pwm_hz"])
        self.in1, self.in2, self.in3, self.in4 = (dig(p) for p in (PIN_IN1, PIN_IN2, PIN_IN3, PIN_IN4))
        self.parar()

    @staticmethod
    def _lado(en, ia, ib, valor, factor, anterior):
        v = max(-100.0, min(100.0, float(valor) * factor))
        if (v > 0) != (anterior > 0) or (v < 0) != (anterior < 0):
            en.set(0)                   # si cambia el sentido, primero se quita la potencia,
            ia.set(v > 0)               # luego se fija el sentido en INx,
            ib.set(v < 0)
        en.set(abs(v) / 100.0)          # y por último el ancho de pulso en ENx
        return round(v)

    def mover(self, izq, der):
        with self.lock:
            self.izq = self._lado(self.ena, self.in1, self.in2, izq, self.cfg["factor_izq"], self.izq)
            self.der = self._lado(self.enb, self.in3, self.in4, der, self.cfg["factor_der"], self.der)

    def parar(self):
        with self.lock:
            for s in (self.ena, self.enb, self.in1, self.in2, self.in3, self.in4):
                s.set(0)
            self.izq = self.der = 0

    def pines(self):
        """Estado de los seis pines, para la página y las pruebas."""
        v = lambda s: getattr(s, "valor", None)
        return {"ENA": v(self.ena), "IN1": v(self.in1), "IN2": v(self.in2),
                "IN3": v(self.in3), "IN4": v(self.in4), "ENB": v(self.enb)}

    def close(self):
        self.parar()
        for s in (self.ena, self.enb, self.in1, self.in2, self.in3, self.in4):
            s.close()


# ================================================================ registro CSV
class Registro:
    COLS = ["fecha_hora", "modo", "evento", "izq", "der", "prueba", "superficie", "carga_kg"]

    def __init__(self, carpeta):
        self.carpeta = carpeta
        os.makedirs(carpeta, exist_ok=True)
        self.lock = threading.Lock()
        self.ultimos = collections.deque(maxlen=200)
        self.prueba = {"codigo": "", "superficie": "", "carga_kg": ""}

    def archivo(self):
        return os.path.join(self.carpeta, f"registro-{datetime.now():%Y-%m-%d}.csv")

    def anotar(self, modo, evento, izq=0, der=0):
        fila = {"fecha_hora": datetime.now().isoformat(timespec="milliseconds"), "modo": modo, "evento": evento,
                "izq": izq, "der": der, "prueba": self.prueba["codigo"], "superficie": self.prueba["superficie"],
                "carga_kg": self.prueba["carga_kg"]}
        with self.lock:
            nuevo = not os.path.exists(self.archivo())
            with open(self.archivo(), "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=self.COLS)
                if nuevo:
                    w.writeheader()
                w.writerow(fila)
            self.ultimos.append(fila)


# ================================================================ recorridos guardados
def validar_tramos(tramos):
    if not isinstance(tramos, list) or not 1 <= len(tramos) <= MAX_TRAMOS:
        raise ValueError(f"El recorrido debe tener entre 1 y {MAX_TRAMOS} tramos.")
    limpios = []
    for i, t in enumerate(tramos, 1):
        if not isinstance(t, dict) or t.get("tipo") not in TIPOS:
            raise ValueError(f"Tramo {i}: el tipo debe ser uno de {', '.join(TIPOS)}.")
        try:
            vel, dur = float(t.get("velocidad", 0)), float(t["duracion"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Tramo {i}: falta la duración o no es un número.")
        if not 0 <= vel <= 100:
            raise ValueError(f"Tramo {i}: la velocidad va de 0 a 100 %.")
        if not 0.1 <= dur <= MAX_DURACION_S:
            raise ValueError(f"Tramo {i}: la duración va de 0,1 a {MAX_DURACION_S:g} s.")
        limpios.append({"tipo": t["tipo"], "velocidad": round(vel), "duracion": round(dur, 2)})
    return limpios


class Recorridos:
    EJEMPLO = {"A-B-C": [{"tipo": "avanzar", "velocidad": 60, "duracion": 4.0},
                         {"tipo": "pausa", "velocidad": 0, "duracion": 1.0},
                         {"tipo": "derecha", "velocidad": 60, "duracion": 1.2},
                         {"tipo": "avanzar", "velocidad": 60, "duracion": 3.0},
                         {"tipo": "pausa", "velocidad": 0, "duracion": 0.5}]}

    def __init__(self, ruta):
        self.ruta, self.lock = ruta, threading.Lock()
        if not os.path.exists(ruta):
            self._guardar(dict(self.EJEMPLO))

    def todos(self):
        with self.lock, open(self.ruta, encoding="utf-8") as f:
            return json.load(f)

    def _guardar(self, datos):
        tmp = self.ruta + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.ruta)

    def guardar(self, nombre, tramos):
        if not NOMBRE_OK.match(nombre or ""):
            raise ValueError("Nombre no válido (letras, números, espacios o guiones; máximo 40).")
        tramos = validar_tramos(tramos)
        datos = self.todos()
        with self.lock:
            datos[nombre] = tramos
            self._guardar(datos)
        return tramos

    def borrar(self, nombre):
        datos = self.todos()
        with self.lock:
            if datos.pop(nombre, None) is None:
                raise KeyError(nombre)
            self._guardar(datos)


# ================================================================ mapa de la finca y planificación por los caminos
class Mapa:
    """Puntos y caminos de la finca (finca.json). El robot solo va de un punto a otro por un camino del mapa,
    en línea recta, así que nunca entra a los lotes de cultivo. Al cargar se comprueba que cada camino
    pase a más de margen_cm de todos los lotes."""

    def __init__(self, ruta):
        with open(ruta, encoding="utf-8") as f:
            self.datos = json.load(f)
        d = self.datos
        self.puntos, self.inicio = d["puntos"], d["inicio"]
        self.orden, self.rumbo_inicial = list(d.get("orden", [])), float(d.get("rumbo_inicial", 90))
        self.lotes, self.margen = d.get("lotes", []), float(d.get("margen_cm", 40))
        self.vecinos = {p: [] for p in self.puntos}
        for a, b in d["caminos"]:
            if a not in self.puntos or b not in self.puntos:
                raise ValueError(f"El camino {a}-{b} usa un punto que no existe.")
            self.vecinos[a].append(b)
            self.vecinos[b].append(a)
            for lote in self.lotes:
                dist = distancia_segmento_lote(self._xy(a), self._xy(b), lote)
                if dist < self.margen:
                    raise ValueError(f"El camino {a}-{b} pasa a {dist:.0f} cm del lote «{lote['nombre']}» "
                                     f"(mínimo {self.margen:.0f} cm): el robot pisaría el cultivo.")
        for p in self.orden + [self.inicio]:
            if p not in self.puntos:
                raise ValueError(f"El punto {p} no existe en el mapa.")

    def _xy(self, p):
        return self.puntos[p]["x"], self.puntos[p]["y"]

    def distancia(self, a, b):
        (ax, ay), (bx, by) = self._xy(a), self._xy(b)
        return math.hypot(bx - ax, by - ay)

    def rumbo(self, a, b):
        (ax, ay), (bx, by) = self._xy(a), self._xy(b)
        return math.degrees(math.atan2(by - ay, bx - ax))

    def ruta(self, a, b):
        """Camino más corto de a hasta b por los caminos del mapa (Dijkstra)."""
        if a not in self.puntos or b not in self.puntos:
            raise KeyError(b if a in self.puntos else a)
        dist, previo, hecho = {p: math.inf for p in self.puntos}, {}, set()
        dist[a] = 0.0
        while True:
            u = None
            for p in self.puntos:                    # el pendiente más cercano (en empate, el primero del mapa)
                if p not in hecho and dist[p] < math.inf and (u is None or dist[p] < dist[u]):
                    u = p
            if u is None or u == b:
                break
            hecho.add(u)
            for v in self.vecinos[u]:
                nd = dist[u] + self.distancia(u, v)
                if nd < dist[v]:
                    dist[v], previo[v] = nd, u
        if dist[b] == math.inf:
            raise ValueError(f"No hay camino de {a} a {b}.")
        nodos = [b]
        while nodos[-1] != a:
            nodos.append(previo[nodos[-1]])
        return nodos[::-1]


def distancia_segmento_lote(p, q, lote):
    """Distancia mínima entre el segmento p-q y el rectángulo del lote (0 si lo cruza)."""
    x0, x1, y0, y1 = lote["x0"], lote["x1"], lote["y0"], lote["y1"]
    dentro = lambda x, y: x0 <= x <= x1 and y0 <= y <= y1
    if dentro(*p) or dentro(*q):
        return 0.0
    esquinas = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for i in range(4):
        if _cruzan(p, q, esquinas[i], esquinas[(i + 1) % 4]):
            return 0.0
    def punto_rect(x, y):
        return math.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1))
    def punto_seg(c):
        (px, py), (qx, qy) = p, q
        dx, dy = qx - px, qy - py
        t = max(0.0, min(1.0, ((c[0] - px) * dx + (c[1] - py) * dy) / (dx * dx + dy * dy or 1)))
        return math.hypot(px + t * dx - c[0], py + t * dy - c[1])
    return min([punto_rect(*p), punto_rect(*q)] + [punto_seg(c) for c in esquinas])


def _cruzan(a, b, c, d):
    o = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0


def plan_auto(mapa, desde, rumbo, destinos, cfg, esperar_orden):
    """Convierte una lista de destinos en pasos: girar sobre el eje hacia el siguiente punto, avanzar en línea recta
    la distancia del camino y, en cada destino, esperar (espera_s o la orden del usuario).
    Los tiempos salen de la calibración: cm_s (avance) y grados_s (giro) a la velocidad vel_auto. Entre movimientos distintos
    el robot queda quieto un momento (pausa_giro_s), y si el camino vuelve hacia atrás retrocede en vez de dar media vuelta."""
    if not cfg.get("cm_s") or not cfg.get("grados_s"):
        raise ValueError("Primero calibra el avance (cm/s) y el giro (°/s) en la sección Calibración.")
    vel, pasos, nodos, cur = cfg["vel_auto"], [], [desde], desde

    def mover(tipo, duracion, fin, hacia=None):
        # entre dos movimientos distintos (avanzar, girar, retroceder) el robot frena un momento: así no se mezclan
        if pasos and pasos[-1].get("tipo") in TIPOS and pasos[-1]["tipo"] not in ("pausa", tipo):
            pasos.append({"tipo": "pausa", "velocidad": 0, "duracion": float(cfg["pausa_giro_s"])})
        paso = {"tipo": tipo, "velocidad": vel, "duracion": duracion, "fin": fin}
        if hacia:
            paso["hacia"] = hacia
        pasos.append(paso)

    for dest in destinos:
        camino = mapa.ruta(cur, dest)
        for u, v in zip(camino, camino[1:]):
            objetivo = mapa.rumbo(u, v)
            giro = (objetivo - rumbo + 180) % 360 - 180
            tramo = round(mapa.distancia(u, v) / cfg["cm_s"], 2)
            if abs(giro) > 135:      # el camino vuelve hacia atrás: retrocede en línea recta en vez de dar media vuelta
                mover("retroceder", tramo, {"pos": v, "rumbo": round(rumbo, 1)}, v)
            else:
                if abs(giro) >= 1:
                    mover("izquierda" if giro > 0 else "derecha", round(abs(giro) / cfg["grados_s"], 2), {"pos": u, "rumbo": round(objetivo, 1)})
                    rumbo = objetivo
                mover("avanzar", tramo, {"pos": v, "rumbo": round(rumbo, 1)}, v)
            nodos.append(v)
        pasos.append({"llega": dest, "esperar": "orden" if esperar_orden else float(cfg["espera_s"])})
        cur = dest
    return pasos, nodos


# ================================================================ controlador (máquina de estados)
ESPERA, REMOTO, RECORRIDO, SEGURIDAD = "ESPERA", "CONTROL REMOTO", "RECORRIDO PROGRAMADO", "DETENIDO POR SEGURIDAD"
AUTO, ESPERANDO = "AUTOMÁTICO", "ESPERANDO ORDEN"
EN_MARCHA = (RECORRIDO, AUTO)


class OcupadoError(Exception):
    pass


class Controlador:
    def __init__(self, motores, registro, cfg, mapa=None, guardar_cfg=None):
        self.m, self.reg, self.cfg, self.mapa = motores, registro, cfg, mapa
        self.guardar_cfg = guardar_cfg or (lambda: None)
        self.lock = threading.RLock()
        self.modo = ESPERA
        self.duenio, self.ultima = None, 0.0     # cliente con el control y hora de su última orden
        self.rec = None                          # plan en curso (recorrido por tramos o automático)
        # posición supuesta: al encender, el robot está en su puesto mirando según rumbo_inicial
        self.pos = mapa.inicio if mapa else None
        self.rumbo = mapa.rumbo_inicial if mapa else None
        self.tour_i = 0                          # próximo punto del recorrido completo
        self.vivo = True
        self.vigia = threading.Thread(target=self._vigilar, name="vigilancia", daemon=True)
        self.vigia.start()

    # ----- órdenes del celular
    def _tomar(self, cliente):
        ahora = time.monotonic()
        if self.duenio and self.duenio != cliente and ahora - self.ultima < self.cfg["toma_control_s"]:
            raise OcupadoError("Otro dispositivo está manejando el vehículo.")
        if self.duenio != cliente:
            self.reg.anotar(self.modo, "toma de control")
        self.duenio, self.ultima = cliente, ahora

    def mover(self, cliente, izq, der):
        with self.lock:
            if self.modo in EN_MARCHA or self.modo == ESPERANDO:
                raise OcupadoError("Hay un recorrido en curso: deténgalo primero.")
            self._tomar(cliente)
            antes = (self.m.izq, self.m.der)
            self.m.mover(izq, der)
            if self.m.izq or self.m.der:
                self.pos = self.rumbo = None     # al manejarlo a mano ya no se sabe dónde está
            nuevo = REMOTO if (self.m.izq or self.m.der) else ESPERA
            if (self.m.izq, self.m.der) != antes or nuevo != self.modo:
                self.modo = nuevo
                self.reg.anotar(self.modo, "orden", self.m.izq, self.m.der)

    def latido(self, cliente):
        with self.lock:
            if cliente == self.duenio:
                self.ultima = time.monotonic()

    def _cancelar(self):
        if self.rec:
            self.rec["alto"].set()
            self.rec = None

    def parar(self, cliente=None, motivo="detener"):
        """Cualquier dispositivo puede detener el vehículo, aunque no tenga el control."""
        with self.lock:
            self._cancelar()
            self.m.parar()
            if self.modo != ESPERA or motivo != "detener":
                self.reg.anotar(self.modo, motivo)
            self.modo = SEGURIDAD if motivo == "sin órdenes" else ESPERA

    def _iniciar(self, cliente, nombre, pasos, tipo, modo, **extra):
        self._tomar(cliente)
        self.modo = modo
        self.rec = dict({"nombre": nombre, "pasos": pasos, "tipo": tipo, "i": 0, "fin_tramo": 0.0,
                         "alto": threading.Event(), "sigue": threading.Event()}, **extra)
        self.reg.anotar(self.modo, f"inicio: {nombre}")
        threading.Thread(target=self._correr, args=(self.rec,), name="plan", daemon=True).start()

    # ----- recorrido programado por tramos (lazo abierto: cumple tiempos y velocidades)
    def ejecutar(self, cliente, nombre, tramos):
        tramos = validar_tramos(tramos)
        with self.lock:
            if self.rec:
                raise OcupadoError("Ya hay un recorrido en curso.")
            self.pos = self.rumbo = None
            self._iniciar(cliente, nombre, tramos, "tramos", RECORRIDO)

    # ----- modo automático por los puntos de la finca
    def _listo_auto(self):
        if self.mapa is None:
            raise ValueError("No hay mapa de la finca (finca.json).")
        if self.modo in EN_MARCHA:
            raise OcupadoError("El vehículo está en marcha: espera a que llegue o deténlo.")
        if self.pos is None or self.rumbo is None:
            raise ValueError("No se sabe dónde está el robot: llévalo a un punto del mapa e indícalo en «El robot está en».")

    def ir(self, cliente, destino, esperar_orden=False):
        with self.lock:
            self._listo_auto()
            if destino not in self.mapa.puntos:
                raise KeyError(destino)
            if destino == self.pos:
                raise ValueError(f"El robot ya está en {destino}.")
            pasos, nodos = plan_auto(self.mapa, self.pos, self.rumbo, [destino], self.cfg, esperar_orden)
            self._cancelar()
            self._iniciar(cliente, f"ir a {destino}", pasos, "auto", AUTO, ruta=nodos, tour=False)

    def recorrido_completo(self, cliente, desde_cero=False, esperar_orden=False):
        with self.lock:
            self._listo_auto()
            if desde_cero or self.tour_i >= len(self.mapa.orden):
                self.tour_i = 0
            destinos = self.mapa.orden[self.tour_i:] + [self.mapa.inicio]
            if destinos and destinos[0] == self.pos:
                destinos = destinos[1:]
                self.tour_i += 1 if self.tour_i < len(self.mapa.orden) else 0
            pasos, nodos = plan_auto(self.mapa, self.pos, self.rumbo, destinos, self.cfg, esperar_orden)
            self._cancelar()
            self._iniciar(cliente, "recorrido completo" + (" desde cero" if desde_cero else ""), pasos, "auto", AUTO, ruta=nodos, tour=True)

    def siguiente(self, cliente):
        with self.lock:
            if self.modo != ESPERANDO or not self.rec:
                raise OcupadoError("El vehículo no está esperando una orden.")
            self._tomar(cliente)
            self.rec["sigue"].set()

    def fijar_posicion(self, cliente, punto, rumbo=None):
        with self.lock:
            if self.mapa is None or punto not in self.mapa.puntos:
                raise KeyError(punto)
            if self.modo in EN_MARCHA or self.m.izq or self.m.der:
                raise OcupadoError("Detén el vehículo antes de indicar dónde está.")
            self._cancelar()
            self.modo = ESPERA
            self.pos = punto
            self.rumbo = float(rumbo) if rumbo is not None else self.mapa.rumbo_inicial
            if punto == self.mapa.inicio:
                self.tour_i = 0
            self.reg.anotar(self.modo, f"posición indicada: {punto}, rumbo {self.rumbo:g}°")

    def calibrar(self, cliente, prueba):
        """Prueba de calibración: avanza o gira durante prueba_calibracion_s a vel_auto; luego el usuario mide."""
        t = {"avance": "avanzar", "giro": "izquierda"}.get(prueba)
        if t is None:
            raise ValueError("La prueba de calibración es «avance» o «giro».")
        self.ejecutar(cliente, f"calibración de {prueba}",
                      [{"tipo": t, "velocidad": self.cfg["vel_auto"], "duracion": self.cfg["prueba_calibracion_s"]}])

    def guardar_calibracion(self, medido_cm=None, medido_grados=None, vel_auto=None, medido_desvio_cm=None):
        with self.lock:
            s = self.cfg["prueba_calibracion_s"]
            if vel_auto is not None:
                if not 20 <= float(vel_auto) <= 100:
                    raise ValueError("La velocidad del modo automático va de 20 a 100 %.")
                self.cfg["vel_auto"] = round(float(vel_auto))
            if medido_cm is not None:
                if float(medido_cm) <= 0:
                    raise ValueError("La distancia medida debe ser mayor que 0.")
                self.cfg["cm_s"] = round(float(medido_cm) / s, 2)
            if medido_grados is not None:
                if float(medido_grados) <= 0:
                    raise ValueError("El ángulo medido debe ser mayor que 0.")
                self.cfg["grados_s"] = round(float(medido_grados) / s, 2)
            if medido_desvio_cm is not None and float(medido_desvio_cm) != 0:
                self._ajustar_motores(float(medido_desvio_cm), float(medido_cm or self.cfg["cm_s"] * s))
            self.guardar_cfg()
            self.reg.anotar(self.modo, f"calibración: {self.cfg['cm_s']} cm/s, {self.cfg['grados_s']} °/s a {self.cfg['vel_auto']} %")

    def _ajustar_motores(self, desvio, largo):
        """Ajusta factor_izq/factor_der con el desvío lateral de la prueba de avance (cm, positivo si se fue a la izquierda).
        En línea recta el robot describe un arco: curvatura = 2·desvío/largo². Con el ancho de vía efectivo que da la prueba
        de giro (avance / giro en radianes por segundo × 2), la curvatura dice cuánto más rápido va una oruga que la otra."""
        if not self.cfg.get("cm_s") or not self.cfg.get("grados_s"):
            raise ValueError("Para corregir el desvío primero guarda el avance y el giro medidos.")
        ancho = 2 * self.cfg["cm_s"] / math.radians(self.cfg["grados_s"])
        # > 0: la oruga derecha va más rápido. Se corrige la mitad (al girar sobre su eje las orugas van más lento que en recta,
        # así que el ancho efectivo sale grande): repite la prueba de avance hasta que el desvío sea menor de 2 cm.
        r = 0.5 * 2 * desvio / (largo * largo) * ancho
        rel = (self.cfg["factor_der"] / self.cfg["factor_izq"]) / (1 + r)
        if rel <= 1:
            self.cfg["factor_izq"], self.cfg["factor_der"] = 1.0, round(rel, 4)
        else:
            self.cfg["factor_izq"], self.cfg["factor_der"] = round(1 / rel, 4), 1.0

    # ----- ejecución de un plan
    def _correr(self, rec):
        orden = self.mapa.orden if self.mapa else []
        for i, p in enumerate(rec["pasos"]):
            if "llega" in p:                                       # llegada a un punto
                with self.lock:
                    if rec["alto"].is_set():
                        return
                    rec["i"] = i
                    self.m.parar()
                    self.pos = p["llega"]
                    if rec.get("tour") and self.tour_i < len(orden) and p["llega"] == orden[self.tour_i]:
                        self.tour_i += 1
                    self.reg.anotar(self.modo, f"llegó a {p['llega']}")
                    if p["esperar"] == "orden":
                        rec["sigue"].clear()
                        self.modo = ESPERANDO
                    else:
                        rec["fin_tramo"] = time.monotonic() + p["esperar"]
                if p["esperar"] == "orden":
                    while not rec["sigue"].wait(0.05):
                        if rec["alto"].is_set():
                            return
                    with self.lock:
                        if rec["alto"].is_set():
                            return
                        self.modo, self.ultima = AUTO, time.monotonic()
                elif rec["alto"].wait(p["esperar"]):
                    return
                continue
            sl, sr = TIPOS[p["tipo"]]
            with self.lock:
                if rec["alto"].is_set():
                    return
                rec["i"], rec["fin_tramo"] = i, time.monotonic() + p["duracion"]
                if "fin" in p:
                    self.pos = self.rumbo = None                     # en movimiento: posición desconocida
                self.m.mover(sl * p["velocidad"], sr * p["velocidad"])
                self.reg.anotar(self.modo, f"paso {i + 1}: {p['tipo']}" + (f" hacia {p['hacia']}" if "hacia" in p else ""), self.m.izq, self.m.der)
            if rec["alto"].wait(p["duracion"]):
                return
            with self.lock:
                if rec["alto"].is_set():
                    return
                if "fin" in p:
                    self.pos, self.rumbo = p["fin"]["pos"], p["fin"]["rumbo"]
        with self.lock:
            if not rec["alto"].is_set():
                self.m.parar()
                if rec.get("tour") and self.pos == (self.mapa.inicio if self.mapa else None):
                    self.tour_i = 0
                self.reg.anotar(self.modo, f"fin: {rec['nombre']}")
                self.modo, self.rec = ESPERA, None

    # ----- vigilancia: parada si dejan de llegar órdenes o latidos
    def _vigilar(self):
        while self.vivo:
            time.sleep(0.02)
            with self.lock:
                moviendo = self.m.izq or self.m.der or self.modo in EN_MARCHA
                sin_ordenes = (time.monotonic() - self.ultima) * 1000 > self.cfg["timeout_ms"]
                if moviendo and sin_ordenes:
                    log.warning("Sin órdenes durante %d ms: motores detenidos.", self.cfg["timeout_ms"])
                    self.parar(motivo="sin órdenes")

    def estado(self, cliente=None):
        with self.lock:
            r = a = None
            if self.rec and self.rec["tipo"] == "tramos" and self.modo == RECORRIDO:
                t = self.rec["pasos"][self.rec["i"]]
                r = {"nombre": self.rec["nombre"], "tramo": self.rec["i"] + 1, "total": len(self.rec["pasos"]),
                     "tipo": t["tipo"], "restante_s": round(max(0.0, self.rec["fin_tramo"] - time.monotonic()), 1)}
            if self.mapa:
                a = {"posicion": self.pos, "rumbo": self.rumbo, "orden": self.mapa.orden, "tour_i": self.tour_i,
                     "siguiente": self.mapa.orden[self.tour_i] if self.tour_i < len(self.mapa.orden) else self.mapa.inicio,
                     "calibrado": bool(self.cfg.get("cm_s") and self.cfg.get("grados_s")),
                     "cm_s": self.cfg.get("cm_s"), "grados_s": self.cfg.get("grados_s"), "vel_auto": self.cfg["vel_auto"],
                     "espera_s": self.cfg["espera_s"], "factor_izq": self.cfg["factor_izq"], "factor_der": self.cfg["factor_der"], "plan": None}
                if self.rec and self.rec["tipo"] == "auto":
                    p = self.rec["pasos"][self.rec["i"]]
                    resto = self.rec["pasos"][self.rec["i"] + (1 if "llega" in p else 0):]
                    dest = next((q["llega"] for q in resto if "llega" in q), None)   # próximo punto donde se detendrá
                    a["plan"] = {"nombre": self.rec["nombre"], "ruta": self.rec["ruta"], "destino": dest,
                                 "hacia": p.get("hacia") or p.get("llega") or (p.get("fin") or {}).get("pos"),
                                 "paso": self.rec["i"] + 1, "total": len(self.rec["pasos"]), "esperando": self.modo == ESPERANDO}
            return {"version": VERSION, "modo": self.modo, "izq": self.m.izq, "der": self.m.der,
                    "tienes_control": cliente is not None and cliente == self.duenio, "recorrido": r, "auto": a,
                    "timeout_ms": self.cfg["timeout_ms"], "pwm": self.m.tipo_pwm, "pines": self.m.pines(),
                    "prueba": self.reg.prueba}

    def cerrar(self):
        self.vivo = False
        self.parar(motivo="programa detenido")
        self.m.close()


# ================================================================ servidor web
class Servidor(BaseHTTPRequestHandler):
    server_version = "UGV-Orugas/" + VERSION
    ctl = recorridos = registro = cfg = mapa = None   # se asignan al arrancar

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def _enviar(self, codigo, cuerpo, tipo="application/json; charset=utf-8", extra=None):
        datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(datos)

    def _json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 65536:
            raise ValueError("Petición demasiado grande.")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            with open(os.path.join(DIR, "web", "index.html"), "rb") as f:
                return self._enviar(200, f.read(), "text/html; charset=utf-8")
        if u.path == "/api/estado":
            return self._enviar(200, self.ctl.estado((q.get("cliente") or [None])[0]))
        if u.path == "/api/recorridos":
            return self._enviar(200, self.recorridos.todos())
        if u.path == "/api/mapa":
            return self._enviar(200, self.mapa.datos if self.mapa else {})
        if u.path == "/api/registro":
            n = min(200, int((q.get("n") or ["30"])[0]))
            return self._enviar(200, list(self.registro.ultimos)[-n:])
        if u.path == "/registro.csv":
            ruta = self.registro.archivo()
            datos = b""
            if os.path.exists(ruta):
                with open(ruta, "rb") as f:
                    datos = f.read()
            return self._enviar(200, datos, "text/csv; charset=utf-8",
                                {"Content-Disposition": f'attachment; filename="{os.path.basename(ruta)}"'})
        self._enviar(404, {"error": "No existe."})

    def do_POST(self):
        u = urlparse(self.path)
        try:
            d = self._json()
            cliente = str(d.get("cliente") or "")[:64] or None
            if u.path == "/api/mover":
                self.ctl.mover(cliente, float(d.get("izq", 0)), float(d.get("der", 0)))
            elif u.path == "/api/parar":
                self.ctl.parar(cliente)
            elif u.path == "/api/latido":
                self.ctl.latido(cliente)
            elif u.path == "/api/recorridos":
                self.recorridos.guardar(str(d.get("nombre", "")).strip(), d.get("tramos"))
            elif u.path == "/api/ejecutar":
                nombre = str(d.get("nombre") or "sin nombre")
                tramos = d.get("tramos") if "tramos" in d else self.recorridos.todos().get(nombre)
                if tramos is None:
                    raise KeyError(nombre)
                self.ctl.ejecutar(cliente, nombre, tramos)
            elif u.path == "/api/ir":
                self.ctl.ir(cliente, str(d.get("destino", "")), bool(d.get("esperar_orden")))
            elif u.path == "/api/recorrido":
                self.ctl.recorrido_completo(cliente, bool(d.get("desde_cero")), bool(d.get("esperar_orden")))
            elif u.path == "/api/siguiente":
                self.ctl.siguiente(cliente)
            elif u.path == "/api/posicion":
                self.ctl.fijar_posicion(cliente, str(d.get("punto", "")), d.get("rumbo"))
            elif u.path == "/api/calibrar":
                self.ctl.calibrar(cliente, str(d.get("prueba", "")))
            elif u.path == "/api/calibracion":
                self.ctl.guardar_calibracion(d.get("medido_cm"), d.get("medido_grados"), d.get("vel_auto"), d.get("medido_desvio_cm"))
            elif u.path == "/api/prueba":
                self.registro.prueba = {"codigo": str(d.get("codigo", ""))[:20], "superficie": str(d.get("superficie", ""))[:20],
                                        "carga_kg": str(d.get("carga_kg", ""))[:6]}
                self.registro.anotar(self.ctl.modo, "datos de la prueba")
            else:
                return self._enviar(404, {"error": "No existe."})
            self._enviar(200, self.ctl.estado(cliente))
        except OcupadoError as e:
            self._enviar(409, {"error": str(e)})
        except KeyError as e:
            self._enviar(404, {"error": f"No existe {e}."})
        except (ValueError, TypeError) as e:
            self._enviar(400, {"error": str(e)})

    def do_DELETE(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/recorridos/"):
            try:
                self.recorridos.borrar(unquote(u.path.split("/", 3)[3]))
                return self._enviar(200, {"ok": True})
            except KeyError:
                return self._enviar(404, {"error": "No existe ese recorrido."})
        self._enviar(404, {"error": "No existe."})


class ServidorWeb(ThreadingHTTPServer):
    """Escucha en IPv4 e IPv6 a la vez (si el sistema lo permite), para que 'localhost' responda sin demoras."""
    daemon_threads = True

    def __init__(self, puerto, manejador):
        doble = socket.has_dualstack_ipv6()
        self.address_family = socket.AF_INET6 if doble else socket.AF_INET
        super().__init__(("::" if doble else "0.0.0.0", puerto), manejador)

    def server_bind(self):
        if self.address_family == socket.AF_INET6:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def crear(simular=False, puerto=None, carpeta=DIR):
    """Arma el controlador y el servidor (lo usan main() y las pruebas)."""
    os.makedirs(carpeta, exist_ok=True)
    ruta_cfg = os.path.join(carpeta, "config.json")
    cfg = cargar_config(ruta_cfg)
    ruta_mapa = os.path.join(carpeta, "finca.json")
    mapa = Mapa(ruta_mapa if os.path.exists(ruta_mapa) else os.path.join(DIR, "finca.json"))
    motores = Motores(cfg, simular=simular)
    registro = Registro(os.path.join(carpeta, "registros"))

    def guardar_cfg():
        tmp = ruta_cfg + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, ruta_cfg)

    ctl = Controlador(motores, registro, cfg, mapa, guardar_cfg)
    Servidor.ctl, Servidor.registro, Servidor.cfg, Servidor.mapa = ctl, registro, cfg, mapa
    Servidor.recorridos = Recorridos(os.path.join(carpeta, "recorridos.json"))
    srv = ServidorWeb(cfg["puerto"] if puerto is None else puerto, Servidor)
    return srv, ctl


def main():
    ap = argparse.ArgumentParser(description="Control del prototipo de orugas (Raspberry Pi 3 + L298N).")
    ap.add_argument("--simular", action="store_true", help="probar sin hardware (pines simulados)")
    ap.add_argument("--puerto", type=int, help="puerto web (por defecto 80; 8080 al simular)")
    ap.add_argument("-v", "--detalle", action="store_true", help="mostrar cada petición")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.detalle else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # al simular, la calibración y los registros se guardan aparte para no tocar los archivos del prototipo
    srv, ctl = crear(a.simular, a.puerto if a.puerto else (8080 if a.simular else None),
                     os.path.join(DIR, "simulacion") if a.simular else DIR)
    detener = lambda *_: threading.Thread(target=srv.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, detener)
    signal.signal(signal.SIGINT, detener)
    log.info("UGV %s listo: PWM %s, parada sin órdenes a los %d ms, http://<ip-de-la-raspberry>:%d",
             VERSION, ctl.m.tipo_pwm, ctl.cfg["timeout_ms"], srv.server_address[1])
    ctl.reg.anotar(ESPERA, "programa iniciado")
    try:
        srv.serve_forever(poll_interval=0.2)
    finally:
        ctl.cerrar()
        srv.server_close()
        log.info("Programa detenido: motores apagados.")


if __name__ == "__main__":
    sys.exit(main())
