"""Arranque: arma configuración, motores, registro, mapa, rutas, celular a bordo, controlador y servidores.

Uso en la Raspberry Pi (el servicio lo hace solo):  sudo python3 /opt/ugv/ugv.py
Uso en un computador, sin hardware:                 python3 ugv.py --simular      (http://localhost:8080, PIN 1234)"""
import argparse
import logging
import os
import secrets
import signal
import threading

from . import VERSION
from .celular import Celular
from .config import cargar_config, guardar_json
from .mapa import Mapa
from .misiones import Controlador
from .motores import Motores
from .registro import Registro
from .rutas import Rutas
from .seguridad import Sesiones
from .servidor import Manejador, ServidorWeb, contexto_tls

log = logging.getLogger("ugv")
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))      # carpeta del programa (raspberry/ o /opt/ugv)


class App:
    """Todo lo que necesita el servidor. servidores[0] es HTTP; servidores[1], si existe, HTTPS."""

    def __init__(self, simular=False, puerto=None, carpeta=DIR, puerto_https=None):
        os.makedirs(carpeta, exist_ok=True)
        self.carpeta = carpeta
        ruta_cfg = os.path.join(carpeta, "config.json")
        self.cfg = cfg = cargar_config(ruta_cfg)
        if not cfg.get("pin"):
            cfg["pin"] = "1234" if simular else f"{secrets.randbelow(10**6):06d}"
            guardar_json(ruta_cfg, cfg)
            log.warning("PIN del robot: %s (está en %s)", cfg["pin"], ruta_cfg)
        ruta_mapa = os.path.join(carpeta, "finca.json")
        if not os.path.exists(ruta_mapa):
            ruta_mapa = os.path.join(DIR, "finca.json")
        self.mapa = Mapa(ruta_mapa) if os.path.exists(ruta_mapa) else None
        self.registro = Registro(os.path.join(carpeta, "registros"))
        self.rutas = Rutas(os.path.join(carpeta, "rutas.json"), os.path.join(carpeta, "recorridos.json"))
        self.sesiones = Sesiones(cfg)
        self.celular = Celular(cfg)
        motores = Motores(cfg, simular=simular)
        self.ctl = Controlador(motores, self.registro, cfg, self.mapa, lambda: guardar_json(ruta_cfg, cfg), self.celular)

        manejador = type("ManejadorUGV", (Manejador,), {"app": self})
        self.servidores = [ServidorWeb(cfg["puerto"] if puerto is None else puerto, manejador)]
        tls = contexto_tls(os.path.join(carpeta, "cert.pem"), os.path.join(carpeta, "clave.pem"))
        self.puerto_https = None
        if tls is not None:
            try:
                srv = ServidorWeb(cfg["puerto_https"] if puerto_https is None else puerto_https, manejador, tls)
                self.servidores.append(srv)
                self.puerto_https = srv.server_address[1]
            except OSError as e:
                log.warning("No se pudo abrir HTTPS (%s): la página del celular a bordo no estará disponible.", e)

    @property
    def puerto(self):
        return self.servidores[0].server_address[1]

    def iniciar(self):
        """Atiende las conexiones en hilos aparte (lo usan las pruebas)."""
        for s in self.servidores:
            threading.Thread(target=s.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start()

    def cerrar(self):
        for s in self.servidores:
            s.shutdown()
            s.server_close()
        self.ctl.cerrar()


def main():
    ap = argparse.ArgumentParser(description="Control del prototipo de orugas (Raspberry Pi 3 Model B + L298N).")
    ap.add_argument("--simular", action="store_true", help="probar sin hardware (pines simulados, PIN 1234)")
    ap.add_argument("--puerto", type=int, help="puerto web (por defecto 80; 8080 al simular)")
    ap.add_argument("-v", "--detalle", action="store_true", help="mostrar cada petición")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.detalle else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # al simular, la configuración, las rutas y los registros se guardan aparte para no tocar los del prototipo
    carpeta = os.path.join(DIR, "simulacion") if a.simular else DIR
    app = App(a.simular, a.puerto or (8080 if a.simular else None), carpeta, 8443 if a.simular else None)
    principal = app.servidores[0]
    for s in app.servidores[1:]:
        threading.Thread(target=s.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start()
    detener = lambda *_: threading.Thread(target=principal.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, detener)
    signal.signal(signal.SIGINT, detener)
    log.info("UGV %s listo: PWM %s, parada sin órdenes a los %d ms, http://<ip-de-la-raspberry>:%d%s",
             VERSION, app.ctl.m.tipo_pwm, app.cfg["timeout_ms"], app.puerto,
             f" · celular a bordo: https://<ip>:{app.puerto_https}/abordo" if app.puerto_https else "")
    app.registro.anotar("ESPERA", "programa iniciado")
    try:
        principal.serve_forever(poll_interval=0.2)
    finally:
        for s in app.servidores[1:]:
            s.shutdown()
        for s in app.servidores:
            s.server_close()
        app.ctl.cerrar()
        log.info("Programa detenido: motores apagados.")
