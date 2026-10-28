"""Máquina de estados del robot y los tres modos de funcionamiento.

Modos
  MANUAL             el usuario maneja desde la página (flechas); si dejan de llegar órdenes, el robot se detiene.
  AUTÓNOMO           el robot ejecuta una ruta (puntos del mapa, coordenadas, instrucciones o tramos) hasta el final.
  TEMPORAL AUTÓNOMO  igual, pero con un tiempo límite. Al vencer: «detener» se detiene de inmediato; «punto_seguro»
                     solo termina el tramo actual si acaba en un punto y le faltan menos de tolerancia_tiempo_s.
                     Nunca empieza un movimiento nuevo después de vencer el tiempo; queda en TIEMPO CUMPLIDO.
Estados
  ESPERA · CONTROL REMOTO · AUTOMÁTICO · PAUSADO · ESPERANDO ORDEN · DETENIDO POR SEGURIDAD · TIEMPO CUMPLIDO
Transiciones seguras
  * Una misión en marcha no acepta órdenes manuales: primero se pausa (o se espera a que llegue) y luego se pide
    «tomar control manual», que la cancela.
  * Parar (botón PARAR) detiene y cancela desde cualquier dispositivo, sin PIN.
  * Sin latidos ni órdenes durante timeout_ms: en manual se detiene; en misión se detiene y queda pausada por
    seguridad (se puede reanudar cuando vuelva la conexión).
  * Un golpe o una inclinación peligrosa medidos por el celular a bordo detienen el robot de la misma forma.
El bucle de control corre 50 veces por segundo: vigila, avanza la misión, estima la posición y aplica la rampa (solo en manual)."""
import logging
import threading
import time

from . import navegacion as nav
from .navegacion import MOVIMIENTOS, TIPOS, normalizar

log = logging.getLogger("ugv")

ESPERA, REMOTO, AUTO, PAUSADO = "ESPERA", "CONTROL REMOTO", "AUTOMÁTICO", "PAUSADO"
ESPERANDO, SEGURIDAD, TIEMPO = "ESPERANDO ORDEN", "DETENIDO POR SEGURIDAD", "TIEMPO CUMPLIDO"
MANUAL, AUTONOMO, TEMPORAL = "MANUAL", "AUTÓNOMO", "TEMPORAL AUTÓNOMO"


class OcupadoError(Exception):
    pass


class Controlador:
    def __init__(self, motores, registro, cfg, mapa=None, guardar_cfg=None, celular=None, periodo=0.02):
        self.m, self.reg, self.cfg, self.mapa, self.cel = motores, registro, cfg, mapa, celular
        self.guardar_cfg = guardar_cfg or (lambda: None)
        self.lock = threading.RLock()
        self.estado, self.modo = ESPERA, MANUAL
        self.duenio, self.ultima = None, 0.0      # dispositivo con el control y hora de su última orden o latido
        self.mision, self.ultima_mision = None, None
        self.tour_i = 0                           # próximo punto del recorrido completo por la finca
        # posición por estima: al encender se supone que el robot está en su puesto mirando según rumbo_inicial
        self.pose = {"conocida": False, "aproximada": False, "x": None, "y": None, "rumbo": None, "nombre": None}
        if mapa:
            x, y = mapa.xy(mapa.inicio)
            self._fijar_pose(x, y, mapa.rumbo_inicial, mapa.inicio)
        self.periodo, self.vivo = periodo, True
        self.hilo = threading.Thread(target=self._bucle, name="control", daemon=True)
        self.hilo.start()

    # ================================================================ utilidades
    def _anotar(self, texto, nivel="info"):
        self.reg.anotar(self.estado, texto, self.m.izq, self.m.der, nivel, self.pose)

    def _fijar_pose(self, x, y, rumbo, nombre=None, aproximada=False):
        self.pose = {"conocida": True, "aproximada": aproximada, "x": float(x), "y": float(y),
                     "rumbo": normalizar(float(rumbo)), "nombre": nombre}

    def _perder_pose(self):
        self.pose = {"conocida": False, "aproximada": False, "x": None, "y": None, "rumbo": None, "nombre": None}

    def _pose_plan(self):
        return None if not self.pose["conocida"] else {k: self.pose[k] for k in ("x", "y", "rumbo", "nombre")}

    def _tomar(self, cliente):
        ahora = time.monotonic()
        if self.duenio and self.duenio != cliente and ahora - self.ultima < self.cfg["toma_control_s"]:
            raise OcupadoError("Otro dispositivo está manejando el robot.")
        if self.duenio != cliente:
            self._anotar("toma de control")
        self.duenio, self.ultima = cliente, ahora

    # ================================================================ modo manual
    def mover(self, cliente, izq, der):
        from .seguridad import potencia
        izq, der = potencia(izq), potencia(der)
        with self.lock:
            if self.mision:
                raise OcupadoError("Hay una misión activa: pausa y pulsa «Tomar control manual», o cancélala.")
            self._tomar(cliente)
            antes = (self.m.obj_izq, self.m.obj_der)
            self.m.objetivo(izq, der)
            if self.m.obj_izq or self.m.obj_der:
                self._perder_pose()                # al manejarlo a mano ya no se sabe dónde está
            nuevo = REMOTO if (self.m.obj_izq or self.m.obj_der) else ESPERA
            self.modo = MANUAL
            if (self.m.obj_izq, self.m.obj_der) != antes or nuevo != self.estado:
                self.estado = nuevo
                self._anotar("orden manual")

    def latido(self, cliente):
        with self.lock:
            if cliente is not None and cliente == self.duenio:
                self.ultima = time.monotonic()

    def parar(self, cliente=None, motivo="detener"):
        """Cualquier dispositivo puede detener el robot, aunque no tenga el control ni el PIN."""
        with self.lock:
            self.m.parar()
            if self.mision:
                self._cerrar_mision("cancelada")
            if self.estado != ESPERA or motivo != "detener":
                self._anotar(motivo, "aviso" if motivo != "detener" else "info")
            self.estado = ESPERA

    def tomar_manual(self, cliente):
        """Transición autorizada a manual: solo con la misión detenida (pausada, esperando, tiempo cumplido o por seguridad)."""
        with self.lock:
            if self.estado == AUTO:
                raise OcupadoError("La misión está en marcha: primero pausa y luego toma el control manual.")
            self._tomar(cliente)
            self.m.parar()
            if self.mision:
                self._cerrar_mision("cancelada para tomar el control manual")
            self.estado, self.modo = ESPERA, MANUAL
            self._anotar("control manual")

    # ================================================================ misiones
    def _preparar(self, cliente, usar_celular):
        if self.estado == AUTO:
            raise OcupadoError("Ya hay una misión en marcha: espera a que llegue, páusala o deténla.")
        if self.m.moviendo:
            raise OcupadoError("Suelta los controles: el robot se está moviendo.")
        if usar_celular and (self.cel is None or self.cel.rumbo_mapa() is None):
            raise ValueError("El celular a bordo no está conectado o no está alineado.")
        self._tomar(cliente)

    def _iniciar(self, cliente, nombre, tipo, pasos, nodos, temporal=None, usar_celular=False, tour=False, ruta=None):
        if self.mision:
            self._cerrar_mision("reemplazada por otra")
        lim = None
        if temporal:
            from .seguridad import duracion_limite
            lim = duracion_limite(temporal.get("limite_s"))
            if temporal.get("al_terminar", "detener") not in ("detener", "punto_seguro"):
                raise ValueError("Al terminar el tiempo: «detener» o «punto_seguro».")
        total = sum(p.get("duracion", 0) + (p["esperar"] if isinstance(p.get("esperar"), (int, float)) else 0) for p in pasos)
        self.mision = {"nombre": nombre, "tipo": tipo, "pasos": pasos, "nodos": nodos, "i": 0, "t": 0.0, "dur": 0.0,
                       "iniciado": False, "llegado": False, "pose0": None, "t_total": 0.0, "t_hecho": 0.0, "total_s": total,
                       "alcanzados": [], "tour": tour, "usar_celular": bool(usar_celular), "ruta": ruta,
                       "limite_s": lim, "al_terminar": (temporal or {}).get("al_terminar", "detener"),
                       "vencido": False, "terminar_tras_paso": False}
        self.estado, self.modo = AUTO, TEMPORAL if lim else AUTONOMO
        self.ultima = time.monotonic()
        self._anotar(f"inicio de misión: {nombre}" + (f" (tiempo límite {lim:.0f} s, al terminar: {self.mision['al_terminar']})" if lim else ""))

    def ejecutar(self, cliente, nombre, tramos, temporal=None):
        """Recorrido por tramos de tiempo (pruebas del informe). Después no se sabe dónde quedó el robot."""
        tramos = nav.validar_tramos(tramos)
        with self.lock:
            self._preparar(cliente, False)
            self._perder_pose()
            self._iniciar(cliente, nombre, "tramos", [dict(t) for t in tramos], [], temporal)

    def ejecutar_ruta(self, cliente, ruta, version, temporal=None, esperar_orden=False, usar_celular=False):
        """Ejecuta una ruta guardada. La versión debe coincidir con la que tiene la página."""
        with self.lock:
            if version is None or int(version) != int(ruta["version"]):
                raise OcupadoError(f"La ruta «{ruta['nombre']}» cambió (versión {ruta['version']}): recárgala antes de enviarla.")
            self._preparar(cliente, usar_celular)
            tipo, datos = ruta["tipo"], ruta["datos"]
            info = {"id": ruta["id"], "version": ruta["version"]}
            if tipo == "coordenadas":
                pasos, nodos = nav.plan_coordenadas(self._pose_plan(), datos["puntos"], self.cfg, esperar_orden, self.mapa)
            elif tipo == "instrucciones":
                pasos, nodos = nav.plan_instrucciones(self._pose_plan(), datos["instrucciones"], self.cfg, self.mapa)
            else:
                if usar_celular:
                    raise ValueError("Las rutas por tramos de tiempo no usan el celular a bordo.")
                pasos, nodos = [dict(t) for t in datos["tramos"]], []
                self._perder_pose()
            self._iniciar(cliente, ruta["nombre"], tipo, pasos, nodos, temporal, usar_celular, ruta=info)

    def _en_punto(self):
        if self.mapa is None:
            raise ValueError("No hay mapa (finca.json).")
        if not self.pose["conocida"] or self.pose["nombre"] not in self.mapa.puntos or self.pose["aproximada"]:
            raise ValueError("No se sabe en qué punto del mapa está el robot: llévalo a uno e indícalo con «El robot está aquí».")
        return self.pose["nombre"]

    def ir(self, cliente, destino, esperar_orden=False, temporal=None, usar_celular=False):
        with self.lock:
            if self.mapa is None or destino not in self.mapa.puntos:
                raise KeyError(f"el punto {destino}")
            self._preparar(cliente, usar_celular)
            desde = self._en_punto()
            if destino == desde:
                raise ValueError(f"El robot ya está en {destino}.")
            pasos, nodos = nav.plan_puntos(self.mapa, desde, self.pose["rumbo"], [destino], self.cfg, esperar_orden)
            self._iniciar(cliente, f"ir a {destino}", "puntos", pasos, nodos, temporal, usar_celular)

    def recorrido_completo(self, cliente, desde_cero=False, esperar_orden=False, temporal=None, usar_celular=False):
        with self.lock:
            self._preparar(cliente, usar_celular)
            desde = self._en_punto()
            if desde_cero or self.tour_i >= len(self.mapa.orden):
                self.tour_i = 0
            destinos = self.mapa.orden[self.tour_i:] + [self.mapa.inicio]
            if destinos and destinos[0] == desde:
                destinos = destinos[1:]
                self.tour_i += 1 if self.tour_i < len(self.mapa.orden) else 0
            if not destinos:
                raise ValueError("No queda ningún punto por recorrer.")
            pasos, nodos = nav.plan_puntos(self.mapa, desde, self.pose["rumbo"], destinos, self.cfg, esperar_orden)
            self._iniciar(cliente, "recorrido completo" + (" desde cero" if desde_cero else ""), "puntos", pasos, nodos,
                          temporal, usar_celular, tour=True)

    def siguiente(self, cliente):
        with self.lock:
            if self.estado != ESPERANDO or not self.mision:
                raise OcupadoError("El robot no está esperando una orden.")
            self._tomar(cliente)
            self.estado = AUTO
            self._siguiente_paso()

    def pausar(self, cliente):
        with self.lock:
            if self.estado != AUTO or not self.mision:
                raise OcupadoError("No hay una misión en marcha.")
            self._tomar(cliente)
            self.m.parar()
            self.estado = PAUSADO
            self._anotar("misión pausada")

    def reanudar(self, cliente):
        with self.lock:
            if self.estado not in (PAUSADO, SEGURIDAD) or not self.mision:
                raise OcupadoError("No hay una misión pausada.")
            mis = self.mision
            if mis["usar_celular"] and (self.cel is None or self.cel.rumbo_mapa() is None):
                raise ValueError("El celular a bordo no está conectado: reconéctalo o cancela la misión.")
            self._tomar(cliente)
            if mis["iniciado"] and not mis["llegado"]:
                # el resto del paso empieza desde la posición estimada actual, con la rampa de un nuevo arranque
                resto = max(0.0, mis["dur"] - mis["t"])
                mis["t_hecho"] += mis["t"]
                mis["dur"], mis["t"] = resto, 0.0
                mis["pose0"] = self._pose_plan()
                self._aplicar_paso(mis["pasos"][mis["i"]])
            self.estado = AUTO
            self.ultima = time.monotonic()
            self._anotar("misión reanudada")

    # ================================================================ posición y calibración
    def fijar_posicion(self, cliente, punto=None, x_m=None, y_m=None, rumbo=None):
        """El usuario indica dónde está el robot: en un punto del mapa o en unas coordenadas (m) con su rumbo (°)."""
        with self.lock:
            if self.estado == AUTO or self.m.moviendo:
                raise OcupadoError("Detén el robot antes de indicar dónde está.")
            if punto:
                if self.mapa is None or punto not in self.mapa.puntos:
                    raise KeyError(f"el punto {punto}")
                x, y = self.mapa.xy(punto)
                r = float(rumbo) if rumbo is not None else self.mapa.rumbo_inicial
            else:
                try:
                    x, y, r = float(x_m) * 100, float(y_m) * 100, float(rumbo)
                except (TypeError, ValueError):
                    raise ValueError("Indica un punto del mapa, o X e Y en metros y el rumbo en grados.")
                if max(abs(x), abs(y)) > nav.MAX_COORD_CM:
                    raise ValueError("Coordenadas fuera del rango permitido (±10 km).")
            if self.mision:
                self._cerrar_mision("cancelada al indicar la posición")
            self._fijar_pose(x, y, r, punto)
            if punto == (self.mapa.inicio if self.mapa else None):
                self.tour_i = 0
            if self.cel:
                self.cel.alinear(self.pose["rumbo"])
            self.estado = ESPERA
            self._anotar(f"posición indicada: {punto or ''} ({x / 100:.2f} m, {y / 100:.2f} m), rumbo {self.pose['rumbo']:.0f}°")

    def calibrar(self, cliente, prueba):
        """Prueba de calibración: avanza o gira durante prueba_calibracion_s a vel_auto; luego el usuario mide."""
        t = {"avance": "avanzar", "giro": "izquierda"}.get(prueba)
        if t is None:
            raise ValueError("La prueba de calibración es «avance» o «giro».")
        self.ejecutar(cliente, f"calibración de {prueba}",
                      [{"tipo": t, "velocidad": self.cfg["vel_auto"], "duracion": self.cfg["prueba_calibracion_s"]}])

    def guardar_calibracion(self, medido_cm=None, medido_grados=None, vel_auto=None, medido_desvio_cm=None):
        with self.lock:
            if self.estado == AUTO:
                raise OcupadoError("Espera a que termine la misión para cambiar la calibración.")
            if vel_auto is not None:
                if not 20 <= float(vel_auto) <= 100:
                    raise ValueError("La velocidad del modo autónomo va de 20 a 100 %.")
                if round(float(vel_auto)) != self.cfg["vel_auto"]:
                    # lo medido a otra velocidad ya no sirve: hay que repetir las pruebas
                    self.cfg["vel_auto"] = round(float(vel_auto))
                    if medido_cm is None:
                        self.cfg["cm_s"] = None
                    if medido_grados is None:
                        self.cfg["grados_s"] = None
            s = nav.tiempo_efectivo(self.cfg)
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
            self._anotar(f"calibración: {self.cfg['cm_s']} cm/s, {self.cfg['grados_s']} °/s a {self.cfg['vel_auto']} %")

    def _ajustar_motores(self, desvio, largo):
        """Ajusta factor_izq/factor_der con el desvío lateral de la prueba de avance (cm, positivo si se fue a la izquierda).
        En línea recta el robot describe un arco: curvatura = 2·desvío/largo². Con el ancho de vía efectivo que da la prueba
        de giro, la curvatura dice cuánto más rápido va una oruga que la otra. Se corrige la mitad (al girar sobre su eje
        las orugas van más lento que en recta): repite la prueba de avance hasta que el desvío sea menor de 2 cm."""
        if not nav.calibrado(self.cfg):
            raise ValueError("Para corregir el desvío primero guarda el avance y el giro medidos.")
        import math
        ancho = 2 * self.cfg["cm_s"] / math.radians(self.cfg["grados_s"])
        r = 0.5 * 2 * desvio / (largo * largo) * ancho
        rel = (self.cfg["factor_der"] / self.cfg["factor_izq"]) / (1 + r)
        if rel <= 1:
            self.cfg["factor_izq"], self.cfg["factor_der"] = 1.0, round(rel, 4)
        else:
            self.cfg["factor_izq"], self.cfg["factor_der"] = round(1 / rel, 4), 1.0

    # ================================================================ celular a bordo
    def datos_celular(self, d):
        if self.cel is None:
            raise ValueError("El celular a bordo no está habilitado.")
        with self.lock:
            sin_offset = self.cel.offset is None
            self.cel.actualizar(d)
            if sin_offset and self.pose["conocida"] and not self.pose["aproximada"]:
                self.cel.alinear(self.pose["rumbo"])

    def alinear_celular(self, cliente):
        with self.lock:
            if self.cel is None or not self.cel.fresco():
                raise ValueError("El celular a bordo no está enviando datos.")
            if not self.pose["conocida"]:
                raise ValueError("Primero indica dónde está el robot y hacia dónde mira.")
            self.cel.alinear(self.pose["rumbo"])
            self._anotar("celular a bordo alineado con el rumbo del robot")

    # ================================================================ bucle de control (50 Hz)
    def _bucle(self):
        antes = time.monotonic()
        while self.vivo:
            time.sleep(self.periodo)
            ahora = time.monotonic()
            dt, antes = min(0.2, ahora - antes), ahora
            try:
                with self.lock:
                    self._vigilar()
                    self._alerta_celular()
                    self._paso_mision(dt)
                    self.m.paso(dt)
            except Exception:                       # un error inesperado nunca deja los motores andando
                log.exception("Error en el bucle de control: motores detenidos.")
                try:
                    self.m.parar()
                    self.estado = SEGURIDAD
                    self._anotar("error interno: motores detenidos", "peligro")
                except Exception:
                    pass

    def _vigilar(self):
        moviendo = self.m.moviendo or self.estado == AUTO
        if moviendo and (time.monotonic() - self.ultima) * 1000 > self.cfg["timeout_ms"]:
            self._detener_seguridad(f"sin órdenes ni latidos durante {self.cfg['timeout_ms']} ms")

    def _alerta_celular(self):
        if self.cel is None:
            return
        alerta = self.cel.tomar_alerta()
        if alerta:
            if self.m.moviendo or self.estado == AUTO:
                self._detener_seguridad(alerta)
            else:
                self._anotar(f"celular a bordo: {alerta} (el robot estaba quieto)")

    def _detener_seguridad(self, motivo):
        self.m.parar()
        self.estado = SEGURIDAD
        if self.mision:
            self.mision["motivo"] = motivo
        self._anotar(f"parada de seguridad: {motivo}", "peligro")

    def _aplicar_paso(self, p):
        sl, sr = TIPOS[p["tipo"]]
        self.m.objetivo(sl * p["velocidad"], sr * p["velocidad"], rampa=False)

    def _siguiente_paso(self):
        mis = self.mision
        p = mis["pasos"][mis["i"]]
        if mis["iniciado"] or (mis["llegado"] and p.get("esperar") != "orden"):
            mis["t_hecho"] += mis["t"]                 # para la barra de progreso
        mis["i"] += 1
        mis["iniciado"] = mis["llegado"] = False
        mis["t"] = 0.0

    def _paso_mision(self, dt):
        mis = self.mision
        if not mis or self.estado != AUTO:
            return
        mis["t_total"] += dt
        if mis["limite_s"] and not mis["vencido"] and mis["t_total"] >= mis["limite_s"]:
            if self._vencer():
                return
        if mis["i"] >= len(mis["pasos"]):
            self._cerrar_mision("terminada")
            return
        p = mis["pasos"][mis["i"]]
        if "llega" in p:
            if not mis["llegado"]:
                mis["llegado"], mis["t"] = True, 0.0
                self.m.objetivo(0, 0)
                if p.get("x") is not None:
                    self._fijar_pose(p["x"], p["y"], self.pose["rumbo"] if self.pose["rumbo"] is not None else 0, p["llega"])
                elif self.pose["conocida"]:
                    self.pose["nombre"] = p["llega"]
                mis["alcanzados"].append(p["llega"])
                orden = self.mapa.orden if self.mapa else []
                if mis["tour"] and self.tour_i < len(orden) and p["llega"] == orden[self.tour_i]:
                    self.tour_i += 1
                self._anotar(f"llegó a {p['llega']}")
                if mis["vencido"]:                     # el tiempo ya se cumplió: se queda en este punto
                    self._fin_tiempo()
                    return
                if p["esperar"] == "orden":
                    self.estado = ESPERANDO
                    return
            if p["esperar"] != "orden":
                mis["t"] += dt
                if mis["t"] >= p["esperar"]:
                    self._siguiente_paso()
            return
        if not mis["iniciado"]:
            if mis["terminar_tras_paso"] or mis["vencido"]:
                self._fin_tiempo()                  # vencido el tiempo no empieza ningún movimiento nuevo
                return
            mis["iniciado"], mis["t"], mis["dur"] = True, 0.0, float(p["duracion"])
            mis["pose0"] = self._pose_plan()
            self._aplicar_paso(p)
            if p["tipo"] != "pausa":
                self._anotar(f"paso {mis['i'] + 1}: {p['tipo']}" + (f" hacia {p['hacia']}" if p.get("hacia") else ""))
        mis["t"] += dt
        mov = p["tipo"] in MOVIMIENTOS
        if mov:
            est = nav.pose_en_paso(mis["pose0"], p, mis["t"] / mis["dur"] if mis["dur"] else 1)
            if est:
                self.pose.update(est, nombre=None, conocida=True)
            elif "fin" in p:
                self._perder_pose()
        rc = self.cel.rumbo_mapa() if (self.cel and mis["usar_celular"]) else None
        if mis["usar_celular"] and mov and rc is None:
            self._detener_seguridad("se perdió la señal del celular a bordo")
            return
        if rc is not None and mov:
            if self.pose["conocida"]:
                self.pose["rumbo"] = rc
            if self._control_celular(mis, p, rc):
                return
        elif mis["t"] >= mis["dur"]:
            self._fin_paso(mis, p)

    def _control_celular(self, mis, p, rc):
        """Giros que terminan al llegar al rumbo medido y corrección del rumbo en línea recta. Devuelve True si terminó el paso."""
        v = float(p["velocidad"])
        if p["tipo"] in ("izquierda", "derecha") and p.get("rumbo_obj") is not None:
            err = normalizar(p["rumbo_obj"] - rc)
            if abs(err) <= float(self.cfg["celular_tolerancia_grados"]):
                self._fin_paso(mis, p, rc)
                return True
            if mis["t"] > 2 * mis["dur"] + 2:
                self._detener_seguridad("el giro no se completó: ¿orugas atascadas o celular suelto?")
                return True
            pot = v if abs(err) > 20 else max(35.0, v * 0.6)          # más despacio al acercarse al rumbo
            s = 1 if err > 0 else -1
            self.m.objetivo(-s * pot, s * pot, rampa=False)
            return False
        if p["tipo"] in ("avanzar", "retroceder") and p.get("rumbo_rec") is not None:
            err = normalizar(p["rumbo_rec"] - rc)
            cmax = float(self.cfg["celular_corr_max"])
            corr = max(-cmax, min(cmax, float(self.cfg["celular_kp"]) * err))
            if p["tipo"] == "avanzar":
                self.m.objetivo(v - corr, v + corr, rampa=False)
            else:
                self.m.objetivo(-(v + corr), -(v - corr), rampa=False)
        if mis["t"] >= mis["dur"]:
            self._fin_paso(mis, p, rc)
            return True
        return False

    def _fin_paso(self, mis, p, rumbo_medido=None):
        fin = p.get("fin")
        if fin and fin.get("x") is not None:
            self._fijar_pose(fin["x"], fin["y"], rumbo_medido if rumbo_medido is not None else fin["rumbo"], fin.get("pos"))
        elif fin and fin.get("rumbo") is not None and self.pose["conocida"]:
            self.pose["rumbo"] = rumbo_medido if rumbo_medido is not None else fin["rumbo"]
        terminar = mis["terminar_tras_paso"]
        self._siguiente_paso()
        nxt = mis["pasos"][mis["i"]] if mis["i"] < len(mis["pasos"]) else None
        if p["tipo"] in MOVIMIENTOS and not (nxt and nxt.get("tipo") in MOVIMIENTOS):
            self.m.objetivo(0, 0)
        if terminar and not (nxt and "llega" in nxt):
            self._fin_tiempo()

    def _vencer(self):
        """Venció el tiempo del modo temporal. Devuelve True si el robot ya se detuvo."""
        mis = self.mision
        mis["vencido"] = True
        p = mis["pasos"][mis["i"]] if mis["i"] < len(mis["pasos"]) else {}
        self._anotar(f"tiempo límite cumplido ({mis['limite_s']:.0f} s)", "aviso")
        resto = mis["dur"] - mis["t"]
        if (mis["al_terminar"] == "punto_seguro" and mis["iniciado"] and p.get("tipo") in ("avanzar", "retroceder")
                and (p.get("fin") or {}).get("pos") and resto <= float(self.cfg["tolerancia_tiempo_s"])):
            mis["terminar_tras_paso"] = True
            self._anotar(f"termina el tramo hacia {p['fin']['pos']} (faltan {resto:.1f} s) y se detiene")
            return False
        self._fin_tiempo()
        return True

    def _fin_tiempo(self):
        self.m.parar()
        self._cerrar_mision("tiempo cumplido")
        self.estado = TIEMPO

    def _cerrar_mision(self, como):
        mis = self.mision
        if mis is None:
            return
        actual = mis["pasos"][mis["i"]] if mis["i"] < len(mis["pasos"]) else {}
        if mis["iniciado"] and actual.get("tipo") in MOVIMIENTOS and self.pose["conocida"]:
            self.pose["aproximada"] = True                   # quedó a mitad de un movimiento: posición aproximada
            self.pose["nombre"] = None
        if mis["tour"] and self.pose.get("nombre") == (self.mapa.inicio if self.mapa else None) and como == "terminada":
            self.tour_i = 0
        self.ultima_mision = {"nombre": mis["nombre"], "resultado": como, "alcanzados": list(mis["alcanzados"]),
                              "duracion_s": round(mis["t_total"], 1)}
        self.mision = None
        if como == "terminada":
            self.m.objetivo(0, 0)
            self.estado = ESPERA
        self._anotar(f"misión {como}: {mis['nombre']}", "info" if como == "terminada" else "aviso")

    # ================================================================ estado para la página
    def estado_dict(self, cliente=None):
        with self.lock:
            mis, mi = self.mision, None
            if mis:
                p = mis["pasos"][mis["i"]] if mis["i"] < len(mis["pasos"]) else {}
                resto = mis["pasos"][mis["i"] + (1 if "llega" in p else 0):]
                destino = next((q["llega"] for q in resto if "llega" in q), None)
                hecho = mis["t_hecho"] + (mis["t"] if mis["iniciado"] else 0)
                mi = {"nombre": mis["nombre"], "tipo": mis["tipo"], "ruta": mis["ruta"], "paso": min(mis["i"] + 1, len(mis["pasos"])),
                      "total": len(mis["pasos"]), "progreso": round(min(100.0, 100.0 * hecho / mis["total_s"]) if mis["total_s"] else 0, 1),
                      "destino": destino, "hacia": p.get("hacia") or p.get("llega"), "nodos": mis["nodos"],
                      "alcanzados": mis["alcanzados"], "esperando": self.estado == ESPERANDO, "usar_celular": mis["usar_celular"],
                      "motivo": mis.get("motivo"), "temporal": None if not mis["limite_s"] else {
                          "limite_s": mis["limite_s"], "restante_s": round(max(0.0, mis["limite_s"] - mis["t_total"]), 1),
                          "al_terminar": mis["al_terminar"]},
                      "tramo": p.get("tipo"), "tramo_restante_s": round(max(0.0, mis["dur"] - mis["t"]), 1) if mis["iniciado"] else None}
            pz = self.pose
            pose = {"conocida": pz["conocida"], "aproximada": pz["aproximada"], "nombre": pz["nombre"],
                    "x_m": None if pz["x"] is None else round(pz["x"] / 100, 3), "y_m": None if pz["y"] is None else round(pz["y"] / 100, 3),
                    "rumbo": None if pz["rumbo"] is None else round(pz["rumbo"], 1),
                    "fuente": "estima + celular" if (self.cel and self.cel.rumbo_mapa() is not None) else "estima (calibración)"}
            cfg = self.cfg
            auto = None
            if self.mapa:
                auto = {"posicion": pz["nombre"] if pz["conocida"] and not pz["aproximada"] else None, "rumbo": pose["rumbo"],
                        "orden": self.mapa.orden, "tour_i": self.tour_i,
                        "siguiente": self.mapa.orden[self.tour_i] if self.tour_i < len(self.mapa.orden) else self.mapa.inicio}
            return {"estado": self.estado, "modo": self.modo, "tienes_control": cliente is not None and cliente == self.duenio,
                    "izq": round(self.m.izq), "der": round(self.m.der), "pines": self.m.pines(), "pwm": self.m.tipo_pwm,
                    "pose": pose, "mision": mi, "ultima_mision": self.ultima_mision, "auto": auto,
                    "calibracion": {"calibrado": nav.calibrado(cfg), "cm_s": cfg.get("cm_s"), "grados_s": cfg.get("grados_s"),
                                    "vel_auto": cfg["vel_auto"], "factor_izq": cfg["factor_izq"], "factor_der": cfg["factor_der"],
                                    "espera_s": cfg["espera_s"], "prueba_s": cfg["prueba_calibracion_s"]},
                    "celular": self.cel.estado() if self.cel else None,
                    "bateria": {"medida": False, "texto": "sin medición: la Raspberry Pi no tiene entrada analógica"},
                    "alertas": list(self.reg.alertas)[-8:], "eventos": self.reg.n, "timeout_ms": cfg["timeout_ms"],
                    "vel_max": cfg["vel_max"], "prueba": self.reg.prueba}

    def cerrar(self):
        self.vivo = False
        with self.lock:
            self.m.parar()
            if self.mision:
                self._cerrar_mision("programa detenido")
            self._anotar("programa detenido")
        self.m.close()
