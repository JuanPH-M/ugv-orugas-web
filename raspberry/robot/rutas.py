"""Rutas guardadas (rutas.json) con identificador y versión.

Cada vez que se guarda una ruta con el mismo nombre, su versión sube en 1. Para iniciar una misión la página envía
el identificador y la versión que tiene en pantalla: si la ruta cambió desde otro dispositivo, el robot no la ejecuta
y pide recargarla. Así nunca se ejecutan datos viejos por accidente."""
import os
import re
import threading
import time
import unicodedata

from .config import guardar_json
from . import navegacion as nav

TIPOS_RUTA = ("coordenadas", "instrucciones", "tramos")
NOMBRE_OK = re.compile(r"^[\w\- .áéíóúñÁÉÍÓÚÑüÜ()]{1,40}$")

EJEMPLOS = [
    {"nombre": "Cuadrado de 1 m", "tipo": "instrucciones", "datos": {"instrucciones": [
        {"accion": "avanzar", "valor": 1, "unidad": "m"}, {"accion": "izquierda", "valor": 90},
        {"accion": "avanzar", "valor": 1, "unidad": "m"}, {"accion": "izquierda", "valor": 90},
        {"accion": "avanzar", "valor": 1, "unidad": "m"}, {"accion": "izquierda", "valor": 90},
        {"accion": "avanzar", "valor": 1, "unidad": "m"}, {"accion": "izquierda", "valor": 90}]}},
    {"nombre": "Puesto a cruce central", "tipo": "coordenadas", "datos": {"puntos": [
        {"x_m": -4.5, "y_m": 0, "nombre": "Cruce oeste"}, {"x_m": -0.5, "y_m": 0, "nombre": "Cruce central"}]}},
    {"nombre": "A-B-C (prueba P8)", "tipo": "tramos", "datos": {"tramos": [
        {"tipo": "avanzar", "velocidad": 60, "duracion": 4.0}, {"tipo": "pausa", "velocidad": 0, "duracion": 1.0},
        {"tipo": "derecha", "velocidad": 60, "duracion": 1.2}, {"tipo": "avanzar", "velocidad": 60, "duracion": 3.0},
        {"tipo": "pausa", "velocidad": 0, "duracion": 0.5}]}},
]


def identificador(nombre):
    s = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "ruta"


def validar_datos(tipo, datos):
    if tipo not in TIPOS_RUTA:
        raise ValueError(f"El tipo de ruta debe ser uno de {', '.join(TIPOS_RUTA)}.")
    if not isinstance(datos, dict):
        raise ValueError("Faltan los datos de la ruta.")
    if tipo == "coordenadas":
        return {"puntos": nav.validar_coordenadas(datos.get("puntos"))}
    if tipo == "instrucciones":
        return {"instrucciones": nav.validar_instrucciones(datos.get("instrucciones"))}
    return {"tramos": nav.validar_tramos(datos.get("tramos"))}


class Rutas:
    def __init__(self, ruta, recorridos_viejos=None):
        self.ruta, self.lock = ruta, threading.Lock()
        if not os.path.exists(ruta):
            datos = {}
            for e in EJEMPLOS:
                datos[identificador(e["nombre"])] = self._nueva(e["nombre"], e["tipo"], validar_datos(e["tipo"], e["datos"]), 1)
            # rutas por tramos de la versión anterior del programa (recorridos.json)
            if recorridos_viejos and os.path.exists(recorridos_viejos):
                import json
                with open(recorridos_viejos, encoding="utf-8") as f:
                    for nombre, tramos in json.load(f).items():
                        try:
                            rid = identificador(nombre)
                            if rid not in datos:
                                datos[rid] = self._nueva(nombre, "tramos", validar_datos("tramos", {"tramos": tramos}), 1)
                        except ValueError:
                            pass
            guardar_json(ruta, {"rutas": datos})

    @staticmethod
    def _nueva(nombre, tipo, datos, version):
        return {"nombre": nombre, "tipo": tipo, "version": version, "actualizado": time.strftime("%Y-%m-%d %H:%M:%S"), "datos": datos}

    def todas(self):
        import json
        with self.lock, open(self.ruta, encoding="utf-8") as f:
            return json.load(f)["rutas"]

    def obtener(self, rid):
        r = self.todas().get(rid)
        if r is None:
            raise KeyError(f"la ruta «{rid}»")
        return dict(r, id=rid)

    def guardar(self, nombre, tipo, datos):
        nombre = str(nombre or "").strip()
        if not NOMBRE_OK.match(nombre):
            raise ValueError("Nombre no válido (letras, números, espacios, puntos o guiones; máximo 40).")
        limpios = validar_datos(tipo, datos)
        rid = identificador(nombre)
        todas = self.todas()
        with self.lock:
            version = todas[rid]["version"] + 1 if rid in todas else 1
            todas[rid] = self._nueva(nombre, tipo, limpios, version)
            guardar_json(self.ruta, {"rutas": todas})
        return dict(todas[rid], id=rid)

    def borrar(self, rid):
        todas = self.todas()
        with self.lock:
            if todas.pop(rid, None) is None:
                raise KeyError(f"la ruta «{rid}»")
            guardar_json(self.ruta, {"rutas": todas})
