"""Navegación sin sensores de posición: convierte rutas en pasos (girar, avanzar, retroceder, pausa, llegada) y estima
la posición del robot con la calibración (posición por estima).

Cómo se calcula cada paso
  * El robot no mide su posición. Con la calibración sabe cuántos cm avanza y cuántos grados gira por segundo a la
    velocidad vel_auto; con eso convierte metros y grados en segundos.
  * Cada paso arranca directo a vel_auto, sin la rampa del modo manual, igual que en las pruebas de calibración: así
    la inercia de los motores pesa lo mismo al calibrar y al ejecutar (al detenerse, el robot sigue un poco por inercia
    y recupera lo que perdió al arrancar). Con una rampa, el tramo de arranque a poca potencia (donde el motor casi no
    gira) haría que cada giro quede corto unos grados y el error se acumule.
  * Entre movimientos distintos hay una pausa corta (pausa_giro_s) para que el giro y el avance no se mezclen.
  * Si el siguiente punto queda atrás (más de 135°), retrocede en línea recta en vez de dar media vuelta.
Con el celular a bordo (opcional), los giros terminan cuando el rumbo medido llega al objetivo y en línea recta se
corrige el rumbo; la distancia sigue saliendo del tiempo, porque no hay ningún sensor que la mida.
"""
import math

TIPOS = {  # tipo de paso -> sentido de (oruga izquierda, oruga derecha)
    "avanzar": (1, 1), "retroceder": (-1, -1), "izquierda": (-1, 1), "derecha": (1, -1), "pausa": (0, 0),
}
MOVIMIENTOS = ("avanzar", "retroceder", "izquierda", "derecha")
UNIDADES = {"cm": 1.0, "m": 100.0, "km": 100000.0}
MAX_PUNTOS, MAX_INSTRUCCIONES, MAX_TRAMOS = 200, 200, 50
MAX_COORD_CM = 1_000_000          # ±10 km desde el origen del mapa
MAX_DIST_CM = 1_000_000           # una instrucción de avance: hasta 10 km
MAX_PLAN_S = 8 * 3600             # un plan no puede durar más de 8 horas


def normalizar(angulo):
    """Lleva un ángulo a [-180, 180)."""
    return (angulo + 180.0) % 360.0 - 180.0


def tiempo_efectivo(cfg):
    """Duración de una prueba de calibración (avanza o gira a vel_auto, sin rampa)."""
    return float(cfg["prueba_calibracion_s"])


def calibrado(cfg):
    return bool(cfg.get("cm_s") and cfg.get("grados_s"))


def dur_distancia(cm, cfg):
    return round(abs(cm) / cfg["cm_s"], 2)


def dur_giro(grados, cfg):
    return round(abs(grados) / cfg["grados_s"], 2)


class _Plan:
    """Acumula pasos y lleva la pose prevista (x, y en cm; rumbo en grados; nombre del punto si está en uno)."""

    def __init__(self, cfg, x=None, y=None, rumbo=None, nombre=None):
        if not calibrado(cfg):
            raise ValueError("Primero calibra el avance (cm/s) y el giro (°/s) en la sección Calibración.")
        self.cfg, self.pasos, self.nodos = cfg, [], [nombre or "inicio"]
        self.x, self.y, self.rumbo, self.nombre = x, y, rumbo, nombre

    @property
    def conocida(self):
        return self.x is not None and self.rumbo is not None

    def _fin(self, nombre=None):
        if not self.conocida:
            return {"pos": nombre, "x": None, "y": None, "rumbo": None}
        return {"pos": nombre, "x": round(self.x, 1), "y": round(self.y, 1), "rumbo": round(self.rumbo, 1)}

    def mover(self, tipo, duracion, fin, **extra):
        # entre dos movimientos distintos el robot frena un momento: así el giro y el avance no se mezclan
        ult = self.pasos[-1] if self.pasos else None
        if ult and ult.get("tipo") in MOVIMIENTOS and ult["tipo"] != tipo:
            self.pasos.append({"tipo": "pausa", "velocidad": 0, "duracion": float(self.cfg["pausa_giro_s"])})
        paso = {"tipo": tipo, "velocidad": self.cfg["vel_auto"], "duracion": duracion, "fin": fin}
        paso.update({k: v for k, v in extra.items() if v is not None})
        self.pasos.append(paso)

    def girar(self, grados):
        """Gira sobre su eje (grados > 0: a la izquierda)."""
        if abs(grados) < 1:
            return
        objetivo = normalizar(self.rumbo + grados) if self.rumbo is not None else None
        self.rumbo = objetivo
        self.mover("izquierda" if grados > 0 else "derecha", dur_giro(grados, self.cfg), self._fin(self.nombre),
                   giro=round(grados, 1), rumbo_obj=None if objetivo is None else round(objetivo, 1))

    def recta(self, cm, nombre=None, hacia=None):
        """Avanza (cm > 0) o retrocede (cm < 0) en línea recta."""
        if abs(cm) < 1:
            return
        rumbo = self.rumbo
        if self.conocida:
            s = 1 if cm > 0 else -1
            self.x += s * abs(cm) * math.cos(math.radians(rumbo))
            self.y += s * abs(cm) * math.sin(math.radians(rumbo))
        self.nombre = nombre
        self.mover("avanzar" if cm > 0 else "retroceder", dur_distancia(cm, self.cfg), self._fin(nombre),
                   hacia=hacia or nombre, rumbo_rec=None if rumbo is None else round(rumbo, 1))

    def ir_a(self, x, y, nombre=None):
        """Línea recta hasta (x, y): gira hacia el punto y avanza; si queda atrás, retrocede."""
        dx, dy = x - self.x, y - self.y
        d = math.hypot(dx, dy)
        if d < 1:
            self.nombre = nombre or self.nombre
            return
        objetivo = math.degrees(math.atan2(dy, dx))
        giro = normalizar(objetivo - self.rumbo)
        if abs(giro) > 135 and self.cfg.get("retroceder_si_vuelve", True):
            self.recta(-d, nombre)
        else:
            self.girar(giro)
            self.rumbo = objetivo                       # el rumbo exacto (sin el redondeo del giro)
            self.recta(d, nombre)
        self.x, self.y = x, y                           # sin errores de redondeo acumulados

    def llegada(self, nombre, esperar_orden):
        self.pasos.append({"llega": nombre, "esperar": "orden" if esperar_orden else float(self.cfg["espera_s"]),
                           "x": None if self.x is None else round(self.x, 1), "y": None if self.y is None else round(self.y, 1)})

    def terminar(self):
        total = sum(p.get("duracion", 0) + (p["esperar"] if isinstance(p.get("esperar"), (int, float)) else 0) for p in self.pasos)
        if total > MAX_PLAN_S:
            raise ValueError(f"La ruta duraría {total / 3600:.1f} h: el máximo es {MAX_PLAN_S // 3600} h.")
        if not self.pasos:
            raise ValueError("La ruta no tiene ningún movimiento.")
        return self.pasos, self.nodos


# ---------------------------------------------------------------- puntos del mapa (por los caminos)
def plan_puntos(mapa, desde, rumbo, destinos, cfg, esperar_orden):
    """Ruta más corta por los caminos del mapa hasta cada destino, con una espera en cada uno."""
    x, y = mapa.xy(desde)
    pl = _Plan(cfg, x, y, rumbo, desde)
    pl.nodos = [desde]
    cur = desde
    for dest in destinos:
        camino = mapa.ruta(cur, dest)
        for u, v in zip(camino, camino[1:]):
            pl.nombre = u
            pl.ir_a(*mapa.xy(v), nombre=v)
            pl.nodos.append(v)
        pl.llegada(dest, esperar_orden)
        cur = dest
    return pl.terminar()


# ---------------------------------------------------------------- coordenadas en metros
def validar_coordenadas(puntos):
    if not isinstance(puntos, list) or not 1 <= len(puntos) <= MAX_PUNTOS:
        raise ValueError(f"La ruta debe tener entre 1 y {MAX_PUNTOS} puntos.")
    limpios = []
    for i, p in enumerate(puntos, 1):
        try:
            x, y = float(p["x_m"]), float(p["y_m"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Punto {i}: faltan las coordenadas X e Y en metros o no son números.")
        if not (math.isfinite(x) and math.isfinite(y)) or abs(x) * 100 > MAX_COORD_CM or abs(y) * 100 > MAX_COORD_CM:
            raise ValueError(f"Punto {i}: las coordenadas deben estar entre −{MAX_COORD_CM // 100000} y {MAX_COORD_CM // 100000} km.")
        nombre = str(p.get("nombre") or f"P{i}")[:20]
        limpios.append({"x_m": round(x, 3), "y_m": round(y, 3), "nombre": nombre})
    return limpios


def plan_coordenadas(pose, puntos, cfg, esperar_orden, mapa=None):
    """Recorre los puntos en orden, en línea recta, desde la posición estimada actual.
    Si hay mapa, ningún tramo puede pasar cerca de una zona prohibida (lotes de cultivo, obstáculos fijos)."""
    puntos = validar_coordenadas(puntos)
    if pose is None:
        raise ValueError("Para una ruta por coordenadas hay que saber dónde está el robot: indícalo primero.")
    pl = _Plan(cfg, pose["x"], pose["y"], pose["rumbo"], pose.get("nombre"))
    previo, nombre_previo = (pose["x"], pose["y"]), pose.get("nombre") or "inicio"
    for p in puntos:
        destino = (p["x_m"] * 100, p["y_m"] * 100)
        if mapa is not None:
            lote, dist = mapa.zona_cercana(previo, destino)
            if lote is not None:
                raise ValueError(f"El tramo {nombre_previo} → {p['nombre']} pasa a {dist:.0f} cm de «{lote['nombre']}» "
                                 f"(mínimo {mapa.margen:.0f} cm): cambia los puntos para no pisar el cultivo.")
        pl.ir_a(*destino, nombre=p["nombre"])
        pl.nodos.append(p["nombre"])
        pl.llegada(p["nombre"], esperar_orden)
        previo, nombre_previo = destino, p["nombre"]
    return pl.terminar()


# ---------------------------------------------------------------- instrucciones (metros y grados)
ACCIONES = ("avanzar", "retroceder", "izquierda", "derecha", "esperar")


def validar_instrucciones(instr):
    if not isinstance(instr, list) or not 1 <= len(instr) <= MAX_INSTRUCCIONES:
        raise ValueError(f"La ruta debe tener entre 1 y {MAX_INSTRUCCIONES} instrucciones.")
    limpias = []
    for i, it in enumerate(instr, 1):
        if not isinstance(it, dict) or it.get("accion") not in ACCIONES:
            raise ValueError(f"Instrucción {i}: la acción debe ser una de {', '.join(ACCIONES)}.")
        try:
            valor = float(it["valor"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Instrucción {i}: falta el valor o no es un número.")
        if not math.isfinite(valor) or valor <= 0:
            raise ValueError(f"Instrucción {i}: el valor debe ser mayor que 0.")
        a = it["accion"]
        if a in ("avanzar", "retroceder"):
            unidad = it.get("unidad", "m")
            if unidad not in UNIDADES:
                raise ValueError(f"Instrucción {i}: la unidad debe ser cm, m o km.")
            if valor * UNIDADES[unidad] > MAX_DIST_CM:
                raise ValueError(f"Instrucción {i}: el máximo por instrucción es {MAX_DIST_CM // 100000} km.")
            limpias.append({"accion": a, "valor": valor, "unidad": unidad})
        elif a in ("izquierda", "derecha"):
            if valor > 360:
                raise ValueError(f"Instrucción {i}: el giro va de 1 a 360 grados.")
            limpias.append({"accion": a, "valor": valor, "unidad": "grados"})
        else:
            if valor > 3600:
                raise ValueError(f"Instrucción {i}: la espera va hasta 3600 s.")
            limpias.append({"accion": a, "valor": valor, "unidad": "s"})
    return limpias


def plan_instrucciones(pose, instr, cfg, mapa=None):
    """Ejecuta las instrucciones en orden. Si se conoce la posición, la va estimando y revisa las zonas prohibidas."""
    instr = validar_instrucciones(instr)
    if pose is not None:
        pl = _Plan(cfg, pose["x"], pose["y"], pose["rumbo"], pose.get("nombre"))
    else:
        pl = _Plan(cfg)
    for i, it in enumerate(instr, 1):
        a = it["accion"]
        if a in ("avanzar", "retroceder"):
            cm = it["valor"] * UNIDADES[it["unidad"]]
            antes = (pl.x, pl.y)
            pl.recta(cm if a == "avanzar" else -cm, nombre=f"I{i}", hacia=f"instrucción {i}")
            if mapa is not None and pl.conocida:
                lote, dist = mapa.zona_cercana(antes, (pl.x, pl.y))
                if lote is not None:
                    raise ValueError(f"La instrucción {i} pasa a {dist:.0f} cm de «{lote['nombre']}»: el robot pisaría el cultivo.")
        elif a in ("izquierda", "derecha"):
            pl.girar(it["valor"] if a == "izquierda" else -it["valor"])
        else:
            pl.pasos.append({"tipo": "pausa", "velocidad": 0, "duracion": float(it["valor"])})
    pl.llegada("fin", False)
    return pl.terminar()


# ---------------------------------------------------------------- tramos por tiempo (pruebas del informe)
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
        if not (math.isfinite(vel) and math.isfinite(dur)):
            raise ValueError(f"Tramo {i}: valores no válidos.")
        if not 0 <= vel <= 100:
            raise ValueError(f"Tramo {i}: la velocidad va de 0 a 100 %.")
        if not 0.1 <= dur <= 60:
            raise ValueError(f"Tramo {i}: la duración va de 0,1 a 60 s.")
        limpios.append({"tipo": t["tipo"], "velocidad": round(vel), "duracion": round(dur, 2)})
    return limpios


# ---------------------------------------------------------------- posición estimada durante un paso
def pose_en_paso(pose0, paso, fraccion):
    """Pose estimada a mitad de un paso (interpolación entre el inicio y el final previsto)."""
    fin = paso.get("fin") or {}
    if pose0 is None or fin.get("rumbo") is None:
        return None
    f = max(0.0, min(1.0, fraccion))
    if paso["tipo"] in ("izquierda", "derecha"):
        giro = normalizar(fin["rumbo"] - pose0["rumbo"])
        return {"x": pose0["x"], "y": pose0["y"], "rumbo": normalizar(pose0["rumbo"] + giro * f)}
    if fin.get("x") is None:
        return None
    return {"x": pose0["x"] + (fin["x"] - pose0["x"]) * f, "y": pose0["y"] + (fin["y"] - pose0["y"]) * f, "rumbo": pose0["rumbo"]}
