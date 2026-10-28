"""Pruebas de extremo a extremo del programa de la Raspberry Pi, con los pines simulados (no necesitan hardware).

Arrancan el servidor real en un puerto libre y lo usan como lo haría el celular (HTTP y WebSocket):
    python3 test_ugv.py            (dentro de raspberry/)
actualizar.sh las corre antes de instalar una versión nueva: si alguna falla, no instala nada.
"""
import base64
import json
import math
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from robot import navegacion as nav  # noqa: E402
from robot.app import App  # noqa: E402
from robot.config import CONFIG_DEF  # noqa: E402
from robot.mapa import Mapa, distancia_segmento_lote  # noqa: E402
from robot.motores import Motores  # noqa: E402
from robot.rutas import Rutas  # noqa: E402

# calibración rápida para que las misiones de prueba duren poco
RAPIDA = {"cm_s": 400.0, "grados_s": 720.0, "espera_s": 0.05, "pausa_giro_s": 0.05, "rampa_pct_s": 2000}


def cfg_prueba(**extra):
    c = dict(CONFIG_DEF, **RAPIDA)
    c.update(extra)
    return c


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.app = App(simular=True, puerto=0, carpeta=self.tmp)
        self.app.cfg.update(RAPIDA)
        self.app.cfg["timeout_ms"] = 400
        self.app.iniciar()
        self.base = f"http://127.0.0.1:{self.app.puerto}"
        self.ctl = self.app.ctl
        self.token = self.pedir("POST", "/api/entrar", {"pin": "1234"})[1]["token"]

    def tearDown(self):
        self.app.cerrar()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pedir(self, metodo, ruta, cuerpo=None, token=None, crudo=None):
        datos = crudo if crudo is not None else (None if cuerpo is None else json.dumps(cuerpo).encode())
        r = urllib.request.Request(self.base + ruta, data=datos, method=metodo)
        r.add_header("Content-Type", "application/json")
        if token:
            r.add_header("X-Token", token)
        try:
            with urllib.request.urlopen(r, timeout=5) as f:
                cuerpo = f.read()
                es_json = f.headers.get("Content-Type", "").startswith("application/json")
                return f.status, json.loads(cuerpo) if es_json else cuerpo
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def post(self, ruta, cuerpo=None, cliente="a"):
        return self.pedir("POST", ruta, dict(cuerpo or {}, cliente=cliente), self.token)

    def estado(self):
        return self.pedir("GET", "/api/estado", token=self.token)[1]

    def esperar(self, cond, maximo=8.0, cliente="a"):
        """Espera a que se cumpla cond(estado) enviando latidos, como hace la página."""
        fin = time.monotonic() + maximo
        while time.monotonic() < fin:
            e = self.post("/api/latido", cliente=cliente)[1]
            if cond(e):
                return e
            time.sleep(0.05)
        self.fail(f"no se cumplió la condición; estado: {e['estado']} · misión: {e['mision']}")


# ====================================================================== acceso y seguridad
class Acceso(Base):
    def test_sin_token_no_maneja(self):
        self.assertEqual(self.pedir("GET", "/api/estado")[0], 401)
        self.assertEqual(self.pedir("POST", "/api/mover", {"izq": 50, "der": 50})[0], 401)
        self.assertEqual(self.pedir("GET", "/api/info")[0], 200)

    def test_pin_incorrecto_y_bloqueo(self):
        for _ in range(5):
            self.assertEqual(self.pedir("POST", "/api/entrar", {"pin": "0000"})[0], 403)
        s, r = self.pedir("POST", "/api/entrar", {"pin": "1234"})
        self.assertEqual(s, 403)
        self.assertIn("espera", r["error"])

    def test_parar_sin_pin(self):
        self.post("/api/mover", {"izq": 80, "der": 80})
        s, r = self.pedir("POST", "/api/parar", {})
        self.assertEqual(s, 200)
        self.assertEqual(self.ctl.m.pines()["ENA"], 0)
        self.assertEqual(r["estado"], "ESPERA")

    def test_salir_invalida_token(self):
        self.post("/api/salir")
        self.assertEqual(self.pedir("GET", "/api/estado", token=self.token)[0], 401)

    def test_potencias_no_validas(self):
        for v in (150, -101, "abc", None, float("nan")):
            cuerpo = json.dumps({"izq": v, "der": 0, "cliente": "a"}).replace("NaN", '"NaN"').encode()
            s = self.pedir("POST", "/api/mover", token=self.token, crudo=cuerpo)[0]
            self.assertEqual(s, 400, v)
        self.assertFalse(self.ctl.m.moviendo)

    def test_peticion_gigante_y_json_malo(self):
        self.assertEqual(self.pedir("POST", "/api/mover", token=self.token, crudo=b"{no es json")[0], 400)
        self.assertEqual(self.pedir("POST", "/api/rutas", token=self.token, crudo=b"[" + b"1," * 40000 + b"1]")[0], 400)

    def test_otro_dispositivo_no_roba_el_control(self):
        self.post("/api/mover", {"izq": 50, "der": 50}, "a")
        s, r = self.post("/api/mover", {"izq": -50, "der": -50}, "b")
        self.assertEqual(s, 409)
        self.post("/api/parar", cliente="b")                  # pero cualquiera puede detenerlo
        self.assertFalse(self.ctl.m.moviendo)


# ====================================================================== modo manual, motores y vigilancia
class Manual(Base):
    def test_avanzar_pines_y_rampa(self):
        self.post("/api/mover", {"izq": 100, "der": 100})
        self.assertLess(self.ctl.m.izq, 100)                  # la rampa no deja saltar a 100 %
        e = self.esperar(lambda e: e["izq"] == 100 and e["der"] == 100, 2)
        p = e["pines"]
        self.assertEqual((p["IN1"], p["IN2"], p["IN3"], p["IN4"]), (True, False, True, False))
        self.assertAlmostEqual(p["ENA"], 1.0)
        self.assertEqual(e["estado"], "CONTROL REMOTO")
        self.post("/api/mover", {"izq": 0, "der": 0})
        self.assertEqual(self.ctl.m.pines()["ENA"], 0)       # frenar es inmediato

    def test_giro_izquierda_sentidos(self):
        self.post("/api/mover", {"izq": -60, "der": 60})
        p = self.esperar(lambda e: e["der"] == 60, 2)["pines"]
        self.assertEqual((p["IN1"], p["IN2"], p["IN3"], p["IN4"]), (False, True, True, False))

    def test_vel_max(self):
        self.app.cfg["vel_max"] = 50
        self.post("/api/mover", {"izq": 100, "der": -100})
        e = self.esperar(lambda e: e["izq"] == 50, 2)
        self.assertEqual(e["der"], -50)

    def test_vigilancia_sin_latidos(self):
        self.post("/api/mover", {"izq": 60, "der": 60})
        time.sleep(0.8)
        e = self.estado()
        self.assertEqual(e["estado"], "DETENIDO POR SEGURIDAD")
        self.assertEqual((e["izq"], e["der"]), (0, 0))
        self.assertTrue(any("sin órdenes" in a["texto"] for a in e["alertas"]))

    def test_manejar_a_mano_pierde_la_posicion(self):
        self.assertTrue(self.estado()["pose"]["conocida"])
        self.post("/api/mover", {"izq": 50, "der": 50})
        self.assertFalse(self.estado()["pose"]["conocida"])

    def test_websocket(self):
        s = WS(self.app.puerto)
        try:
            s.enviar({"t": "hola", "token": "malo", "cliente": "w"})
            self.assertEqual(s.recibir()["codigo"], 401)
        finally:
            s.cerrar()
        s = WS(self.app.puerto)
        try:
            s.enviar({"t": "hola", "token": self.token, "cliente": "w"})
            self.assertEqual(s.recibir()["t"], "estado")
            s.enviar({"t": "mover", "izq": 70, "der": 70})
            fin = time.monotonic() + 2
            while time.monotonic() < fin:
                s.enviar({"t": "latido"})
                m = s.recibir()
                if m["t"] == "estado" and m["estado"]["izq"] == 70:
                    break
            self.assertEqual(m["estado"]["izq"], 70)
            self.assertTrue(m["estado"]["tienes_control"])
            s.enviar({"t": "mover", "izq": 500, "der": 0})
            while (m := s.recibir())["t"] != "error":
                pass
            self.assertEqual(m["codigo"], 400)
            s.enviar({"t": "parar"})
            time.sleep(0.1)
            self.assertFalse(self.ctl.m.moviendo)
        finally:
            s.cerrar()
        time.sleep(0.6)
        self.assertFalse(self.ctl.m.moviendo)


class WS:
    """Cliente WebSocket mínimo para las pruebas."""

    def __init__(self, puerto):
        self.s = socket.create_connection(("127.0.0.1", puerto), timeout=5)
        clave = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {clave}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        cab = b""
        while b"\r\n\r\n" not in cab:
            cab += self.s.recv(1)
        assert b" 101 " in cab, cab
        self.f = self.s.makefile("rb")

    def enviar(self, obj):
        datos, mascara = json.dumps(obj).encode(), os.urandom(4)
        n = len(datos)
        cab = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n))
        self.s.sendall(cab + mascara + bytes(b ^ mascara[i % 4] for i, b in enumerate(datos)))

    def recibir(self):
        from robot.websocket import recibir
        return json.loads(recibir(self.f)[1])

    def cerrar(self):
        self.s.close()


# ====================================================================== rutas guardadas
class RutasGuardadas(Base):
    def test_ejemplos_y_versiones(self):
        rutas = self.pedir("GET", "/api/rutas", token=self.token)[1]
        self.assertIn("cuadrado-de-1-m", rutas)
        datos = {"instrucciones": [{"accion": "avanzar", "valor": 2, "unidad": "m"}]}
        r1 = self.post("/api/rutas", {"nombre": "Prueba Uno", "tipo": "instrucciones", "datos": datos})[1]
        r2 = self.post("/api/rutas", {"nombre": "Prueba Uno", "tipo": "instrucciones", "datos": datos})[1]
        self.assertEqual((r1["id"], r1["version"], r2["version"]), ("prueba-uno", 1, 2))
        s, r = self.post("/api/ejecutar", {"id": "prueba-uno", "version": 1})
        self.assertEqual(s, 409)                              # versión vieja: no se ejecuta
        self.assertIn("versión 2", r["error"])
        self.assertEqual(self.pedir("DELETE", "/api/rutas/prueba-uno", token=self.token)[0], 200)
        self.assertEqual(self.pedir("DELETE", "/api/rutas/prueba-uno", token=self.token)[0], 404)

    def test_rutas_no_validas(self):
        malas = [("x" * 41, "instrucciones", {"instrucciones": [{"accion": "avanzar", "valor": 1}]}),
                 ("ok", "magia", {}),
                 ("ok", "instrucciones", {"instrucciones": [{"accion": "volar", "valor": 1}]}),
                 ("ok", "instrucciones", {"instrucciones": [{"accion": "avanzar", "valor": -1}]}),
                 ("ok", "instrucciones", {"instrucciones": [{"accion": "avanzar", "valor": 11, "unidad": "km"}]}),
                 ("ok", "instrucciones", {"instrucciones": [{"accion": "derecha", "valor": 400}]}),
                 ("ok", "coordenadas", {"puntos": [{"x_m": "a", "y_m": 0}]}),
                 ("ok", "coordenadas", {"puntos": [{"x_m": 20000, "y_m": 0}]}),
                 ("ok", "tramos", {"tramos": [{"tipo": "avanzar", "velocidad": 60, "duracion": 100}]})]
        for nombre, tipo, datos in malas:
            self.assertEqual(self.post("/api/rutas", {"nombre": nombre, "tipo": tipo, "datos": datos})[0], 400, (nombre, tipo, datos))

    def test_migra_recorridos_viejos(self):
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, "recorridos.json"), "w", encoding="utf-8") as f:
                json.dump({"Ida": [{"tipo": "avanzar", "velocidad": 50, "duracion": 2}], "Mala": [{"tipo": "x"}]}, f)
            r = Rutas(os.path.join(d, "rutas.json"), os.path.join(d, "recorridos.json"))
            self.assertEqual(r.obtener("ida")["tipo"], "tramos")
            self.assertNotIn("mala", r.todas())
        finally:
            shutil.rmtree(d, ignore_errors=True)


# ====================================================================== modo autónomo
class Autonomo(Base):
    def test_ir_a_un_punto_por_los_caminos(self):
        s, e = self.post("/api/ir", {"destino": "B"})
        self.assertEqual(s, 200, e)
        self.assertEqual(e["modo"], "AUTÓNOMO")
        self.assertEqual(e["mision"]["nodos"], ["PUESTO", "J1", "J2", "B"])
        e = self.esperar(lambda e: e["mision"] is None)
        self.assertEqual(e["estado"], "ESPERA")
        self.assertEqual(e["pose"]["nombre"], "B")
        self.assertEqual((e["pose"]["x_m"], e["pose"]["y_m"]), (-0.5, 4.2))
        self.assertEqual(e["ultima_mision"]["resultado"], "terminada")

    def test_ruta_por_coordenadas(self):
        r = self.post("/api/rutas", {"nombre": "Coord", "tipo": "coordenadas",
                                     "datos": {"puntos": [{"x_m": -4.5, "y_m": 0}, {"x_m": -0.5, "y_m": 0, "nombre": "J"}]}})[1]
        s, e = self.post("/api/ejecutar", {"id": r["id"], "version": r["version"]})
        self.assertEqual(s, 200, e)
        e = self.esperar(lambda e: e["mision"] is None)
        self.assertEqual((e["pose"]["x_m"], e["pose"]["y_m"], e["pose"]["rumbo"]), (-0.5, 0.0, 0.0))

    def test_coordenadas_que_pisan_un_lote(self):
        r = self.post("/api/rutas", {"nombre": "Pisa", "tipo": "coordenadas", "datos": {"puntos": [{"x_m": 0, "y_m": -2}]}})[1]
        s, e = self.post("/api/ejecutar", {"id": r["id"], "version": r["version"]})
        self.assertEqual(s, 400)
        self.assertIn("Huerta", e["error"])
        self.assertFalse(self.ctl.m.moviendo)

    def test_instrucciones_sin_posicion_conocida(self):
        self.post("/api/mover", {"izq": 40, "der": 40})
        self.post("/api/mover", {"izq": 0, "der": 0})
        r = self.post("/api/rutas", {"nombre": "Ida y vuelta", "tipo": "instrucciones", "datos": {"instrucciones": [
            {"accion": "avanzar", "valor": 50, "unidad": "cm"}, {"accion": "derecha", "valor": 180},
            {"accion": "esperar", "valor": 0.1}, {"accion": "avanzar", "valor": 0.5, "unidad": "m"}]}})[1]
        s, e = self.post("/api/ejecutar", {"id": r["id"], "version": r["version"]})
        self.assertEqual(s, 200, e)
        e = self.esperar(lambda e: e["mision"] is None)
        self.assertEqual(e["ultima_mision"]["resultado"], "terminada")
        self.assertFalse(e["pose"]["conocida"])

    def test_mision_bloquea_el_manual(self):
        self.app.cfg["cm_s"] = 20.0
        self.post("/api/ir", {"destino": "A"})
        self.assertEqual(self.post("/api/mover", {"izq": 50, "der": 50})[0], 409)
        self.assertEqual(self.post("/api/manual")[0], 409)   # en marcha: primero pausar
        self.assertEqual(self.post("/api/ir", {"destino": "B"})[0], 409)
        self.esperar(lambda e: e["izq"] > 0)
        e = self.post("/api/pausar")[1]
        self.assertEqual((e["estado"], e["izq"], e["der"]), ("PAUSADO", 0, 0))
        e = self.post("/api/manual")[1]
        self.assertEqual((e["estado"], e["modo"], e["mision"]), ("ESPERA", "MANUAL", None))
        self.assertTrue(e["pose"]["aproximada"])
        self.assertEqual(self.post("/api/mover", {"izq": 30, "der": 30})[0], 200)

    def test_pausar_y_reanudar(self):
        self.app.cfg["cm_s"] = 100.0
        self.post("/api/ir", {"destino": "J1"})
        self.esperar(lambda e: e["izq"] > 0)
        time.sleep(0.15)
        self.post("/api/pausar")
        y_pausa = self.estado()["pose"]["y_m"]
        time.sleep(0.5)
        self.assertEqual(self.estado()["pose"]["y_m"], y_pausa)  # en pausa no avanza
        self.assertEqual(self.post("/api/reanudar")[0], 200)
        e = self.esperar(lambda e: e["mision"] is None)
        self.assertEqual(e["pose"]["nombre"], "J1")

    def test_vigilancia_en_mision_y_reanudar(self):
        self.app.cfg["cm_s"] = 100.0
        self.post("/api/ir", {"destino": "J1"})
        time.sleep(0.9)                                        # sin latidos
        e = self.estado()
        self.assertEqual(e["estado"], "DETENIDO POR SEGURIDAD")
        self.assertIsNotNone(e["mision"])
        self.assertEqual((e["izq"], e["der"]), (0, 0))
        self.post("/api/reanudar")
        e = self.esperar(lambda e: e["mision"] is None)
        self.assertEqual(e["pose"]["nombre"], "J1")

    def test_recorrido_esperando_orden(self):
        s, e = self.post("/api/recorrido", {"esperar_orden": True, "desde_cero": True})
        self.assertEqual(s, 200, e)
        e = self.esperar(lambda e: e["estado"] == "ESPERANDO ORDEN")
        self.assertEqual(e["pose"]["nombre"], "A")
        self.assertEqual(e["auto"]["tour_i"], 1)
        self.post("/api/siguiente")
        e = self.esperar(lambda e: e["estado"] == "ESPERANDO ORDEN" and e["pose"]["nombre"] == "B")
        self.post("/api/parar")
        self.assertEqual(self.estado()["auto"]["siguiente"], "C")

    def test_sin_calibrar_no_hay_autonomo(self):
        self.app.cfg["cm_s"] = None
        s, e = self.post("/api/ir", {"destino": "A"})
        self.assertEqual(s, 400)
        self.assertIn("calibra", e["error"])

    def test_tramos(self):
        s, e = self.post("/api/ejecutar", {"id": "a-b-c-prueba-p8", "version": 1})
        self.assertEqual(s, 200, e)
        e = self.esperar(lambda e: e["izq"] == 60)
        self.post("/api/parar")
        self.assertFalse(self.estado()["pose"]["conocida"])  # después de tramos por tiempo no se sabe dónde está


# ====================================================================== modo temporal autónomo
class Temporal(Base):
    def test_detener_al_vencer(self):
        self.app.cfg["cm_s"] = 5.0                             # misión larguísima
        s, e = self.post("/api/ir", {"destino": "D", "temporal": {"limite_s": 5, "al_terminar": "detener"}})
        self.assertEqual(s, 200, e)
        self.assertEqual(e["modo"], "TEMPORAL AUTÓNOMO")
        e = self.esperar(lambda e: e["estado"] == "TIEMPO CUMPLIDO", 8)
        self.assertEqual((e["izq"], e["der"]), (0, 0))
        self.assertTrue(e["pose"]["aproximada"])
        self.assertEqual(e["ultima_mision"]["resultado"], "tiempo cumplido")
        time.sleep(0.3)
        self.assertFalse(self.ctl.m.moviendo)                 # nunca arranca otro movimiento

    def test_punto_seguro_termina_el_tramo(self):
        # PUESTO -> J1 son 420 cm; a 80 cm/s el tramo dura ~5,3 s: al vencer a los 5 s le faltan < 10 s
        self.app.cfg["cm_s"] = 80.0
        s, e = self.post("/api/ir", {"destino": "A", "temporal": {"limite_s": 5, "al_terminar": "punto_seguro"}})
        self.assertEqual(s, 200, e)
        e = self.esperar(lambda e: e["estado"] == "TIEMPO CUMPLIDO", 9)
        self.assertEqual(e["pose"]["nombre"], "J1")           # se detuvo en el cruce, no a mitad de camino
        self.assertFalse(e["pose"]["aproximada"])

    def test_limites(self):
        for t in ({"limite_s": 1}, {"limite_s": 99999}, {"limite_s": 60, "al_terminar": "seguir"}, "x"):
            self.assertEqual(self.post("/api/ir", {"destino": "A", "temporal": t})[0], 400, t)


# ====================================================================== posición y calibración
class PosicionYCalibracion(Base):
    def test_fijar_por_coordenadas(self):
        e = self.post("/api/posicion", {"x_m": 1.5, "y_m": -2, "rumbo": 180})[1]
        self.assertEqual((e["pose"]["x_m"], e["pose"]["y_m"], e["pose"]["rumbo"]), (1.5, -2.0, -180.0))
        self.assertEqual(self.post("/api/posicion", {"x_m": "a", "y_m": 0, "rumbo": 0})[0], 400)
        self.assertEqual(self.post("/api/posicion", {"punto": "ZZ"})[0], 404)
        e = self.post("/api/posicion", {"punto": "C"})[1]
        self.assertEqual(e["pose"]["nombre"], "C")

    def test_calibracion(self):
        self.app.cfg.update(vel_auto=60, prueba_calibracion_s=10.0)
        e = self.post("/api/calibracion", {"medido_cm": 294, "medido_grados": 882})[1]["calibracion"]
        self.assertAlmostEqual(e["cm_s"], 29.4)
        self.assertAlmostEqual(e["grados_s"], 88.2)
        with open(os.path.join(self.tmp, "config.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["cm_s"], e["cm_s"])
        e = self.post("/api/calibracion", {"vel_auto": 80})[1]["calibracion"]
        self.assertFalse(e["calibrado"])                       # otra velocidad: hay que medir de nuevo
        self.assertEqual(self.post("/api/calibracion", {"medido_cm": -3})[0], 400)

    def test_corregir_desvio(self):
        self.post("/api/calibracion", {"medido_cm": 300, "medido_grados": 900})
        e = self.post("/api/calibracion", {"medido_cm": 300, "medido_desvio_cm": 10})[1]["calibracion"]
        self.assertEqual(e["factor_izq"], 1.0)
        self.assertLess(e["factor_der"], 1.0)                 # se fue a la izquierda: la oruga derecha va más lento

    def test_prueba_de_calibracion(self):
        self.app.cfg["prueba_calibracion_s"] = 0.5
        self.assertEqual(self.post("/api/calibrar", {"prueba": "giro"})[0], 200)
        e = self.esperar(lambda e: e["der"] > 0)
        self.assertLess(e["izq"], 0)
        self.esperar(lambda e: e["mision"] is None)

    def test_registro_csv(self):
        self.post("/api/prueba", {"codigo": "P3", "superficie": "pasto", "carga_kg": "2"})
        s, datos = self.pedir("GET", "/registro.csv", token=self.token)
        self.assertEqual(s, 200)
        self.assertIn(b"P3,pasto,2", datos)


# ====================================================================== celular a bordo
class CelularABordo(Base):
    def test_choque_detiene(self):
        self.post("/api/mover", {"izq": 50, "der": 50})
        self.post("/api/celular", {"rumbo": 10, "inclinacion": 2, "acel_max": 25})
        e = self.esperar(lambda e: e["estado"] == "DETENIDO POR SEGURIDAD", 1)
        self.assertTrue(any("choque" in a["texto"] for a in e["alertas"]))

    def test_inclinacion_detiene(self):
        self.post("/api/mover", {"izq": 50, "der": 50})
        self.post("/api/celular", {"rumbo": 10, "inclinacion": 50, "acel_max": 0})
        self.esperar(lambda e: e["estado"] == "DETENIDO POR SEGURIDAD", 1)

    def test_lectura_incompleta(self):
        self.assertEqual(self.post("/api/celular", {"inclinacion": 3})[0], 400)
        self.assertEqual(self.post("/api/camara")[0], 400)

    def test_foto(self):
        jpeg = b"\xff\xd8" + b"0" * 100
        self.assertEqual(self.pedir("POST", "/api/camara", token=self.token, crudo=jpeg)[0], 200)
        self.assertEqual(self.pedir("GET", "/api/camara.jpg", token=self.token)[1], jpeg)
        self.assertEqual(self.pedir("POST", "/api/camara", token=self.token, crudo=b"GIF89a")[0], 400)

    def test_giro_en_lazo_cerrado(self):
        """Un celular simulado gira con el robot: el giro termina por el rumbo medido, no por el tiempo."""
        self.app.cfg.update(grados_s=40.0)                      # la calibración dice 40 °/s ...
        estado = {"rumbo": 0.0, "vivo": True}

        def celular():                                          # ... pero el robot real gira a 120 °/s
            while estado["vivo"]:
                m = self.ctl.m
                estado["rumbo"] += (m.der - m.izq) / 120 * 120 * 0.02
                try:
                    self.ctl.datos_celular({"rumbo": estado["rumbo"] % 360, "inclinacion": 0, "acel_max": 0})
                except ValueError:
                    pass
                time.sleep(0.02)
        hilo = threading.Thread(target=celular, daemon=True)
        hilo.start()
        try:
            self.esperar(lambda e: e["celular"]["conectado"] and e["celular"]["alineado"], 2)
            r = self.post("/api/rutas", {"nombre": "Giro", "tipo": "instrucciones",
                                         "datos": {"instrucciones": [{"accion": "izquierda", "valor": 90}]}})[1]
            t0 = time.monotonic()
            s, e = self.post("/api/ejecutar", {"id": r["id"], "version": r["version"], "usar_celular": True})
            self.assertEqual(s, 200, e)
            e = self.esperar(lambda e: e["mision"] is None, 5)
            self.assertLess(time.monotonic() - t0, 90 / 40)     # terminó antes de lo que diría el tiempo
            self.assertLess(abs(nav.normalizar(e["pose"]["rumbo"] - 180)), 15)
        finally:
            estado["vivo"] = False
            hilo.join()

    def test_usar_celular_sin_celular(self):
        s, e = self.post("/api/ir", {"destino": "A", "usar_celular": True})
        self.assertEqual(s, 400)
        self.assertIn("celular", e["error"])


# ====================================================================== planificador (sin servidor)
class Planificador(unittest.TestCase):
    def setUp(self):
        self.cfg = cfg_prueba(cm_s=30.0, grados_s=90.0, rampa_pct_s=250, pausa_giro_s=0.5, espera_s=1.0)
        self.mapa = Mapa(os.path.join(os.path.dirname(os.path.abspath(__file__)), "finca.json"))

    def test_duraciones(self):
        pasos, _ = nav.plan_instrucciones({"x": 0, "y": 0, "rumbo": 0}, [{"accion": "avanzar", "valor": 3, "unidad": "m"}], self.cfg)
        self.assertAlmostEqual(pasos[0]["duracion"], 10.0)
        self.assertEqual(pasos[0]["fin"], {"pos": "I1", "x": 300.0, "y": 0.0, "rumbo": 0.0})

    def test_km_y_pausa_entre_movimientos(self):
        pasos, _ = nav.plan_instrucciones(None, [{"accion": "avanzar", "valor": 0.01, "unidad": "km"},
                                                 {"accion": "derecha", "valor": 90}], self.cfg)
        self.assertEqual([p.get("tipo") for p in pasos], ["avanzar", "pausa", "derecha", None])
        self.assertAlmostEqual(pasos[0]["duracion"], round(1000 / 30, 2))
        self.assertEqual(pasos[-1]["llega"], "fin")

    def test_retrocede_si_el_punto_queda_atras(self):
        pasos, _ = nav.plan_coordenadas({"x": 0, "y": 0, "rumbo": 0}, [{"x_m": -2, "y_m": 0.1}], self.cfg, False)
        self.assertEqual(pasos[0]["tipo"], "retroceder")
        self.cfg["retroceder_si_vuelve"] = False
        pasos, _ = nav.plan_coordenadas({"x": 0, "y": 0, "rumbo": 0}, [{"x_m": -2, "y_m": 0.1}], self.cfg, False)
        self.assertEqual(pasos[0]["tipo"], "izquierda")

    def test_ruta_por_caminos(self):
        pasos, nodos = nav.plan_puntos(self.mapa, "PUESTO", 90, ["C"], self.cfg, False)
        self.assertEqual(nodos, ["PUESTO", "J1", "J2", "J3", "C"])
        giros = [p["giro"] for p in pasos if "giro" in p]
        self.assertEqual(giros, [-90.0, 90.0])
        self.assertEqual(pasos[-1], {"llega": "C", "esperar": 1.0, "x": 350.0, "y": 420.0})

    def test_maximo_8_horas(self):
        with self.assertRaises(ValueError):
            nav.plan_instrucciones(None, [{"accion": "avanzar", "valor": 10, "unidad": "km"}], dict(self.cfg, cm_s=0.3))

    def test_pose_intermedia(self):
        paso = {"tipo": "avanzar", "fin": {"x": 100.0, "y": 0.0, "rumbo": 0.0}}
        self.assertEqual(nav.pose_en_paso({"x": 0, "y": 0, "rumbo": 0}, paso, 0.25), {"x": 25.0, "y": 0.0, "rumbo": 0})

    def test_mapa_con_camino_sobre_un_lote(self):
        datos = {"puntos": {"P": {"x": 0, "y": 0}, "Q": {"x": 100, "y": 0}}, "inicio": "P", "caminos": [["P", "Q"]],
                 "lotes": [{"nombre": "L", "x0": 40, "x1": 60, "y0": -10, "y1": 10}]}
        with self.assertRaises(ValueError):
            Mapa(datos=datos)
        self.assertEqual(distancia_segmento_lote((0, 0), (100, 0), datos["lotes"][0]), 0.0)
        self.assertAlmostEqual(distancia_segmento_lote((0, 50), (100, 50), datos["lotes"][0]), 40.0)

    def test_autonomo_sin_rampa(self):
        m = Motores(cfg_prueba(rampa_pct_s=100), simular=True)
        m.objetivo(60, 60, rampa=False)
        m.paso(0.02)
        self.assertEqual(m.izq, 60)                            # los pasos del modo autónomo arrancan directo

    def test_motor_cambio_de_sentido_pasa_por_cero(self):
        m = Motores(cfg_prueba(rampa_pct_s=100), simular=True)
        m.objetivo(50, 50)
        for _ in range(100):
            m.paso(0.02)
        m.objetivo(-50, -50)
        self.assertEqual(m.izq, 0)                             # primero a cero ...
        m.paso(0.02)
        self.assertAlmostEqual(m.izq, -2.0)                    # ... y desde ahí acelera hacia atrás
        self.assertEqual((m.pines()["IN1"], m.pines()["IN2"]), (False, True))


# ====================================================================== HTTPS (si hay openssl)
@unittest.skipUnless(shutil.which("openssl"), "sin openssl")
class Https(unittest.TestCase):
    def test_pagina_a_bordo_por_https(self):
        import ssl
        import subprocess
        d = tempfile.mkdtemp()
        try:
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=prueba",
                            "-keyout", os.path.join(d, "clave.pem"), "-out", os.path.join(d, "cert.pem")],
                           check=True, capture_output=True)
            app = App(simular=True, puerto=0, carpeta=d, puerto_https=0)
            app.iniciar()
            try:
                ctx = ssl.create_default_context()
                ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
                with urllib.request.urlopen(f"https://127.0.0.1:{app.puerto_https}/abordo", context=ctx, timeout=5) as f:
                    self.assertEqual(f.status, 200)
                    self.assertIn(b"<html", f.read().lower())
            finally:
                app.cerrar()
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=1)
