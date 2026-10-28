"""Registro de eventos en CSV (un archivo por día) y alertas recientes para la página."""
import collections
import csv
import os
import threading
from datetime import datetime


class Registro:
    COLS = ["fecha_hora", "nivel", "modo", "evento", "izq", "der", "x_m", "y_m", "rumbo", "prueba", "superficie", "carga_kg"]

    def __init__(self, carpeta):
        self.carpeta = carpeta
        os.makedirs(carpeta, exist_ok=True)
        self.lock = threading.Lock()
        self.ultimos = collections.deque(maxlen=200)
        self.alertas = collections.deque(maxlen=30)
        self.prueba = {"codigo": "", "superficie": "", "carga_kg": ""}
        self.n = 0                                  # contador de eventos (la página lo usa para saber si hay nuevos)

    def archivo(self):
        return os.path.join(self.carpeta, f"registro-{datetime.now():%Y-%m-%d}.csv")

    def anotar(self, modo, evento, izq=0, der=0, nivel="info", pose=None):
        """nivel: info, aviso o peligro. Los avisos y peligros también quedan en las alertas de la página."""
        x = y = r = ""
        if pose and pose.get("conocida"):
            x, y, r = round(pose["x"] / 100, 2), round(pose["y"] / 100, 2), round(pose["rumbo"], 1)
        fila = {"fecha_hora": datetime.now().isoformat(timespec="milliseconds"), "nivel": nivel, "modo": modo, "evento": evento,
                "izq": round(izq), "der": round(der), "x_m": x, "y_m": y, "rumbo": r, "prueba": self.prueba["codigo"],
                "superficie": self.prueba["superficie"], "carga_kg": self.prueba["carga_kg"]}
        with self.lock:
            nuevo = not os.path.exists(self.archivo())
            with open(self.archivo(), "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=self.COLS)
                if nuevo:
                    w.writeheader()
                w.writerow(fila)
            self.ultimos.append(fila)
            self.n += 1
            if nivel != "info":
                self.alertas.append({"n": self.n, "hora": fila["fecha_hora"][11:19], "nivel": nivel, "texto": evento})
