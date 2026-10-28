"""Mapa del lugar de trabajo (finca.json): puntos con nombre, caminos entre ellos y zonas prohibidas (lotes de cultivo,
obstáculos fijos). Unidades: centímetros; x hacia el este, y hacia el norte; rumbo en grados (0 = este, 90 = norte).

Es un sistema de referencia LOCAL, no GPS: el origen (0, 0) es un punto que el equipo elige y mide en el terreno."""
import json
import math


class Mapa:
    """Al cargar se comprueba que cada camino pase a más de margen_cm de todas las zonas prohibidas;
    si no, el programa no arranca y dice cuál camino está mal: así un mapa equivocado no lleva al robot sobre los cultivos."""

    def __init__(self, ruta=None, datos=None):
        if datos is None:
            with open(ruta, encoding="utf-8") as f:
                datos = json.load(f)
        self.datos = d = datos
        self.puntos, self.inicio = d["puntos"], d["inicio"]
        self.orden, self.rumbo_inicial = list(d.get("orden", [])), float(d.get("rumbo_inicial", 90))
        self.lotes, self.margen = d.get("lotes", []), float(d.get("margen_cm", 40))
        self.vecinos = {p: [] for p in self.puntos}
        for p, v in self.puntos.items():
            if not isinstance(v.get("x"), (int, float)) or not isinstance(v.get("y"), (int, float)):
                raise ValueError(f"El punto {p} no tiene coordenadas x, y numéricas.")
        for a, b in d["caminos"]:
            if a not in self.puntos or b not in self.puntos:
                raise ValueError(f"El camino {a}-{b} usa un punto que no existe.")
            self.vecinos[a].append(b)
            self.vecinos[b].append(a)
            lote, dist = self.zona_cercana(self.xy(a), self.xy(b))
            if lote is not None:
                raise ValueError(f"El camino {a}-{b} pasa a {dist:.0f} cm del lote «{lote['nombre']}» "
                                 f"(mínimo {self.margen:.0f} cm): el robot pisaría el cultivo.")
        for p in self.orden + [self.inicio]:
            if p not in self.puntos:
                raise ValueError(f"El punto {p} no existe en el mapa.")

    def xy(self, p):
        return self.puntos[p]["x"], self.puntos[p]["y"]

    def zona_cercana(self, p, q):
        """Primera zona prohibida a menos de margen_cm del segmento p-q (o None) y su distancia."""
        for lote in self.lotes:
            dist = distancia_segmento_lote(p, q, lote)
            if dist < self.margen:
                return lote, dist
        return None, None

    def distancia(self, a, b):
        (ax, ay), (bx, by) = self.xy(a), self.xy(b)
        return math.hypot(bx - ax, by - ay)

    def rumbo(self, a, b):
        (ax, ay), (bx, by) = self.xy(a), self.xy(b)
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
