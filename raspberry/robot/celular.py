"""Celular a bordo (opcional y sin costo: un celular que el equipo ya tenga, sujeto al robot).

Abre la página https://10.42.0.1/abordo y envía, varias veces por segundo:
  * rumbo: giro del robot medido con el giroscopio del celular (grados, sentido antihorario);
  * inclinación del robot (grados) y el pico de aceleración sin gravedad (m/s²) desde el último envío;
  * GPS (solo en exteriores, con la precisión que dé el celular) y fotos de la cámara trasera.
Con eso el programa puede: terminar los giros cuando el rumbo llega al objetivo, mantener el rumbo en línea recta,
detener el robot si detecta un golpe o una inclinación peligrosa, y mostrar la cámara al operador.
No mide distancias ni detecta obstáculos por sí solo: la distancia sigue saliendo de la calibración."""
import time

from .navegacion import normalizar


class Celular:
    def __init__(self, cfg):
        self.cfg = cfg
        self.datos, self.t = None, 0.0
        self.offset = None                    # rumbo del mapa = rumbo del celular + offset
        self.foto, self.t_foto = None, 0.0
        self.pendiente = None                 # alerta de seguridad por atender (choque o inclinación)
        self.gps = None

    def actualizar(self, d):
        """Guarda una lectura del celular. Devuelve el texto de una alerta de seguridad si la hay."""
        try:
            rumbo = float(d["rumbo"])
            incl = float(d.get("inclinacion", 0))
            acel = float(d.get("acel_max", 0))
        except (KeyError, TypeError, ValueError):
            raise ValueError("Lectura del celular incompleta.")
        self.datos, self.t = {"rumbo": rumbo % 360.0, "inclinacion": incl, "acel_max": acel}, time.monotonic()
        g = d.get("gps")
        if isinstance(g, dict) and all(isinstance(g.get(k), (int, float)) for k in ("lat", "lon", "precision")):
            self.gps = {"lat": round(g["lat"], 7), "lon": round(g["lon"], 7), "precision": round(g["precision"], 1), "t": time.time()}
        if acel >= float(self.cfg["choque_ms2"]):
            self.pendiente = f"posible choque: el celular a bordo midió {acel:.1f} m/s²"
        elif abs(incl) >= float(self.cfg["inclinacion_max"]):
            self.pendiente = f"inclinación peligrosa: {incl:.0f}°"
        return self.pendiente

    def fresco(self):
        return self.datos is not None and time.monotonic() - self.t <= float(self.cfg["celular_max_s"])

    def alinear(self, rumbo_mapa):
        """Fija la equivalencia entre el rumbo del celular y el del mapa (cuando se conoce el rumbo del robot)."""
        if self.fresco() and rumbo_mapa is not None:
            self.offset = normalizar(rumbo_mapa - self.datos["rumbo"])
            return True
        return False

    def rumbo_mapa(self):
        if self.fresco() and self.offset is not None:
            return normalizar(self.datos["rumbo"] + self.offset)
        return None

    def tomar_alerta(self):
        a, self.pendiente = self.pendiente, None
        return a

    def guardar_foto(self, jpeg):
        if not jpeg.startswith(b"\xff\xd8") or len(jpeg) > 400_000:
            raise ValueError("La foto debe ser un JPEG de menos de 400 kB.")
        self.foto, self.t_foto = jpeg, time.monotonic()

    def estado(self):
        conectado = self.fresco()
        return {"conectado": conectado, "alineado": self.offset is not None,
                "rumbo": round(self.rumbo_mapa(), 1) if self.rumbo_mapa() is not None else None,
                "inclinacion": round(self.datos["inclinacion"], 1) if conectado else None,
                "gps": self.gps, "camara": self.foto is not None and time.monotonic() - self.t_foto < 3}
