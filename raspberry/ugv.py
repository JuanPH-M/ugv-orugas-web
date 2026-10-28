#!/usr/bin/env python3
"""Control del prototipo de orugas: Raspberry Pi 3 Model B + puente H L298N + 2 motores DC (sin sensores).

Este archivo solo arranca el programa; el código está organizado en el paquete robot/:
  config · motores · registro · mapa · navegacion · rutas · celular · seguridad · misiones · websocket · servidor · app

Uso en la Raspberry Pi (ver README.md):   sudo python3 ugv.py
Uso en un computador, sin hardware:       python3 ugv.py --simular      (abre http://localhost:8080, PIN 1234)

Limitación declarada en el informe: si este programa o el sistema operativo se bloquean, los pines pueden
quedar en su último estado. El corte total del prototipo es desconectar la batería.
"""
import sys

from robot.app import main

if __name__ == "__main__":
    sys.exit(main())
