/* Genera el programa de la Raspberry Pi (Python 3) y el archivo de misión en JSON */
(function () {
'use strict';
const ORIGEN = { lat: 4.0, lon: -74.0 }; // origen de ejemplo: cámbialo por un punto medido en la finca
const R_TIERRA = 6378137;

/* Misión del simulador → JSON del informe (anexo C). x = este, z = sur (cm) */
UGV.missionJSON = function () {
  const ms = UGV.Sim.mission();
  const lat0 = ORIGEN.lat * Math.PI / 180;
  const puntos = ms.map(p => {
    const e = p.x / 100, n = -p.z / 100;
    const lat = ORIGEN.lat + (n / R_TIERRA) * 180 / Math.PI, lon = ORIGEN.lon + (e / (R_TIERRA * Math.cos(lat0))) * 180 / Math.PI;
    return { id: p.id, lat: +lat.toFixed(7), lon: +lon.toFixed(7), tipo: p.tipo, v_max: p.tipo === 'acopio' ? 0.15 : 0.3,
      r_llegada: p.tipo === 'acopio' ? 0.1 : (UGV.state.gnssMode === 'rtk' ? 0.3 : 2.5), confirmar: p.tipo !== 'paso' };
  });
  return JSON.stringify({ mision: 'finca_gemelo_digital', nota: 'Coordenadas de ejemplo alrededor de un origen ficticio: reemplázalas por puntos medidos con el receptor GNSS del robot.', puntos }, null, 2);
};

UGV.genPiCode = function () {
  const S = UGV.state, chi = UGV.Sim.st.slip.toFixed(2);
  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Unidad central del UGV de orugas para el transporte de la cosecha (Raspberry Pi 3 Model B).

Generado desde el gemelo digital (${new Date().toLocaleDateString('es-CO')}).
- Lee el receptor GNSS (NMEA por USB) y la odometría que envía la ESP32.
- Estima la posición con un filtro de Kalman extendido (x, y, rumbo).
- Ejecuta la misión por puntos: A (carga) -> B -> C -> ... -> acopio, y regreso.
- Guía con Pure Pursuit y manda las velocidades de las orugas a la ESP32 por UART.
- Si falta el latido del operador por más de 1 s, frena y queda en PARADA DE EMERGENCIA.

Uso:  python3 ugv_rpi.py mision.json
Requisitos: pip install pyserial  ·  en /boot/firmware/config.txt: enable_uart=1 y dtoverlay=disable-bt
"""
import csv
import json
import math
import struct
import sys
import threading
import time

try:
    import serial
except ImportError:
    sys.exit("Falta pyserial: pip install pyserial")

PUERTO_ESP32 = "/dev/serial0"      # GPIO 14 (TX) y 15 (RX) <-> UART2 de la ESP32
PUERTO_GNSS = "/dev/ttyUSB0"       # NEO-M8N por adaptador USB-serie
BAUD_ESP32, BAUD_GNSS = 115200, 9600
B = 0.125                          # distancia entre centros de las orugas (m)
CHI = ${chi}                           # factor de ensanchamiento por deslizamiento (lo corrige el filtro)
TICKS_POR_M = 350.0                # pulsos de encoder por metro de oruga (calibrar)
L_MIN, K_V = 0.45, 0.9             # distancia de anticipación de Pure Pursuit: L_d = L_MIN + K_V * v
GNSS_MODO = "${S.gnssMode === 'rtk' ? 'rtk' : 'autonomo'}"           # "autonomo" (NEO-M8N) o "rtk" (ZED-F9P)
LATIDO_MAX_S = 1.0                 # sin latido del operador -> PARADA DE EMERGENCIA
R_TIERRA = 6378137.0

VEL_CMD, MODE, STOP_CMD = 0x01, 0x02, 0x03
ODOM, IMU, RANGE, POWER, STATUS, RADIO_RX = 0x10, 0x11, 0x12, 0x13, 0x14, 0x15


def crc16(datos):
    """CRC-16/CCITT-FALSE, igual que el firmware de la ESP32."""
    c = 0xFFFF
    for b in datos:
        c ^= b << 8
        for _ in range(8):
            c = ((c << 1) ^ 0x1021) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
    return c


class EnlaceESP32(threading.Thread):
    """Tramas 0xAA 0x55 | tipo | secuencia | longitud | datos | CRC-16 (anexo B del informe)."""

    def __init__(self, puerto):
        super().__init__(daemon=True)
        self.ser = serial.Serial(puerto, BAUD_ESP32, timeout=0.05)
        self.seq = 0
        self.ticks = None
        self.dist_m = None
        self.flags = 0
        self.radio = []
        self.lock = threading.Lock()

    def enviar(self, tipo, datos=b""):
        cuerpo = bytes([tipo, self.seq & 0xFF, len(datos)]) + datos
        self.seq += 1
        self.ser.write(b"\\xAA\\x55" + cuerpo + struct.pack("<H", crc16(cuerpo)))

    def velocidades(self, v_izq, v_der):
        mm = lambda v: max(-32000, min(32000, int(round(v * 1000))))
        self.enviar(VEL_CMD, struct.pack("<hh", mm(v_izq), mm(v_der)))

    def run(self):
        buf = bytearray()
        while True:
            buf += self.ser.read(64)
            while len(buf) >= 7:
                if buf[0] != 0xAA or buf[1] != 0x55:
                    del buf[0]
                    continue
                n = buf[4]
                if n > 64:
                    del buf[0]
                    continue
                if len(buf) < n + 7:
                    break
                cuerpo, crc = bytes(buf[2:5 + n]), struct.unpack("<H", bytes(buf[5 + n:7 + n]))[0]
                del buf[:n + 7]
                if crc == crc16(cuerpo):
                    self.procesar(cuerpo[0], cuerpo[3:])

    def procesar(self, tipo, d):
        with self.lock:
            if tipo == ODOM and len(d) == 10:
                self.ticks = struct.unpack("<iiH", d)
            elif tipo == RANGE and len(d) == 2:
                self.dist_m = struct.unpack("<H", d)[0] / 1000.0
            elif tipo == STATUS and len(d) == 1:
                self.flags = d[0]
            elif tipo == RADIO_RX:
                self.radio.append(d.decode("ascii", "ignore").strip())


class GNSS(threading.Thread):
    """Lee las frases GGA del receptor: latitud, longitud, calidad del fix, satélites y HDOP."""

    def __init__(self, puerto):
        super().__init__(daemon=True)
        self.ser = serial.Serial(puerto, BAUD_GNSS, timeout=1)
        self.fix = None

    @staticmethod
    def grados(valor, hemisferio):
        if not valor:
            return None
        punto = valor.index(".")
        g = float(valor[:punto - 2]) + float(valor[punto - 2:]) / 60.0
        return -g if hemisferio in ("S", "W") else g

    def run(self):
        while True:
            linea = self.ser.readline().decode("ascii", "ignore").strip()
            if not (linea.startswith("$GPGGA") or linea.startswith("$GNGGA")):
                continue
            c = linea.split(",")
            if len(c) < 10 or c[6] in ("", "0"):
                continue
            lat, lon = self.grados(c[2], c[3]), self.grados(c[4], c[5])
            if lat is None or lon is None:
                continue
            self.fix = {"lat": lat, "lon": lon, "calidad": int(c[6]), "sat": int(c[7] or 0),
                        "hdop": float(c[8] or 9.9), "t": time.time()}


class Estimador:
    """EKF de 3 estados (x este, y norte, rumbo) con predicción por odometría y corrección por GNSS."""

    def __init__(self):
        self.x = [0.0, 0.0, 0.0]
        self.P = [[25.0, 0, 0], [0, 25.0, 0], [0, 0, 1.0]]
        self.ticks_prev = None

    def predecir(self, ticks):
        if self.ticks_prev is None:
            self.ticks_prev = ticks
            return 0.0
        dl = (ticks[0] - self.ticks_prev[0]) / TICKS_POR_M
        dr = (ticks[1] - self.ticks_prev[1]) / TICKS_POR_M
        self.ticks_prev = ticks
        ds, dth = (dl + dr) / 2.0, (dr - dl) / (CHI * B)
        th = self.x[2] + dth / 2.0
        self.x[0] += ds * math.cos(th)
        self.x[1] += ds * math.sin(th)
        self.x[2] = math.atan2(math.sin(self.x[2] + dth), math.cos(self.x[2] + dth))
        F = [[1, 0, -ds * math.sin(th)], [0, 1, ds * math.cos(th)], [0, 0, 1]]
        q = [0.02 * abs(ds) + 1e-5, 0.02 * abs(ds) + 1e-5, 0.01 * abs(dth) + 1e-6]
        self.P = suma(mult(mult(F, self.P), trasp(F)), [[q[0], 0, 0], [0, q[1], 0], [0, 0, q[2]]])
        return ds

    def corregir_gnss(self, e, n, sigma):
        S = [[self.P[0][0] + sigma ** 2, self.P[0][1]], [self.P[1][0], self.P[1][1] + sigma ** 2]]
        det = S[0][0] * S[1][1] - S[0][1] * S[1][0]
        Si = [[S[1][1] / det, -S[0][1] / det], [-S[1][0] / det, S[0][0] / det]]
        K = [[sum(self.P[i][k] * Si[k][j] for k in range(2)) for j in range(2)] for i in range(3)]
        r = [e - self.x[0], n - self.x[1]]
        for i in range(3):
            self.x[i] += K[i][0] * r[0] + K[i][1] * r[1]
        IKH = [[(1 if i == j else 0) - (K[i][j] if j < 2 else 0) for j in range(3)] for i in range(3)]
        self.P = mult(IKH, self.P)

    def incertidumbre(self):
        return math.sqrt(max(self.P[0][0], self.P[1][1]))


def mult(A, Bm):
    return [[sum(A[i][k] * Bm[k][j] for k in range(len(Bm))) for j in range(len(Bm[0]))] for i in range(len(A))]


def trasp(A):
    return [list(f) for f in zip(*A)]


def suma(A, Bm):
    return [[A[i][j] + Bm[i][j] for j in range(len(A[0]))] for i in range(len(A))]


class Mision:
    """Lista de puntos en coordenadas locales ENU y máquina de estados del informe."""

    def __init__(self, ruta):
        with open(ruta, encoding="utf-8") as f:
            datos = json.load(f)
        self.puntos = datos["puntos"]
        self.lat0, self.lon0 = self.puntos[0]["lat"], self.puntos[0]["lon"]
        for p in self.puntos:
            p["e"], p["n"] = self.enu(p["lat"], p["lon"])
        self.i, self.dir = 1, 1
        self.estado = "ESPERA"
        self.espera = None

    def enu(self, lat, lon):
        e = math.radians(lon - self.lon0) * math.cos(math.radians(self.lat0)) * R_TIERRA
        n = math.radians(lat - self.lat0) * R_TIERRA
        return e, n

    def tramo(self):
        p = [(q["e"], q["n"]) for q in self.puntos]
        return p[max(0, self.i - 1):] if self.dir > 0 else list(reversed(p[:self.i + 2]))

    def objetivo(self):
        return self.puntos[self.i]

    def llegar(self):
        p = self.objetivo()
        if p.get("confirmar") or p["tipo"] in ("carga", "acopio"):
            self.estado, self.espera = "PAUSA", p["tipo"]
        ultimo = len(self.puntos) - 1 if self.dir > 0 else 0
        if self.i == ultimo:
            self.dir = -self.dir
        self.i += self.dir


def pure_pursuit(x, y, th, tramo, v):
    """Devuelve la curvatura hacia el punto adelantado sobre la polilínea del tramo."""
    ld = L_MIN + K_V * v
    mejor, idx, proy = 1e9, 0, tramo[0]
    for k in range(len(tramo) - 1):
        (ax, ay), (bx, by) = tramo[k], tramo[k + 1]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1e-9)))
        px, py = ax + dx * t, ay + dy * t
        d = math.hypot(x - px, y - py)
        if d < mejor:
            mejor, idx, proy = d, k, (px, py)
    resto, (px, py) = ld, proy
    for k in range(idx, len(tramo) - 1):
        bx, by = tramo[k + 1]
        seg = math.hypot(bx - px, by - py)
        if seg >= resto:
            gx, gy = px + (bx - px) * resto / seg, py + (by - py) * resto / seg
            break
        resto -= seg
        px, py = bx, by
    else:
        gx, gy = tramo[-1]
    alfa = math.atan2(gy - y, gx - x) - th
    alfa = math.atan2(math.sin(alfa), math.cos(alfa))
    return 2.0 * math.sin(alfa) / ld, mejor


def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: python3 ugv_rpi.py mision.json")
    mision = Mision(sys.argv[1])
    esp = EnlaceESP32(PUERTO_ESP32)
    gps = GNSS(PUERTO_GNSS)
    esp.start()
    gps.start()
    ekf = Estimador()
    ultimo_latido, ultimo_fix, v = time.time(), 0.0, 0.0
    registro = csv.writer(open("registro_%d.csv" % int(time.time()), "w", newline=""))
    registro.writerow(["t", "estado", "x", "y", "rumbo", "incertidumbre", "v_izq", "v_der", "punto"])
    print("Unidad central lista. Esperando el latido del operador y el fix del GNSS...")
    mision.estado = "AUTONOMO"
    while True:
        t0 = time.time()
        with esp.lock:
            ticks, radio, flags = esp.ticks, esp.radio[:], esp.flags
            esp.radio.clear()
        for msg in radio:
            if msg.startswith("H"):
                ultimo_latido = time.time()
            elif msg.startswith("M,OK") and mision.estado == "PAUSA":
                mision.estado, mision.espera = "AUTONOMO", None
            elif msg.startswith("M,REARMAR") and mision.estado == "PARADA DE EMERGENCIA":
                mision.estado = "AUTONOMO"
        if ticks:
            v = ekf.predecir(ticks) / 0.05
        fix = gps.fix
        if fix and fix["t"] > ultimo_fix:
            ultimo_fix = fix["t"]
            e, n = mision.enu(fix["lat"], fix["lon"])
            sigma = (0.02 if fix["calidad"] == 4 else 0.4) if GNSS_MODO == "rtk" else 1.7 * fix["hdop"]
            ekf.corregir_gnss(e, n, sigma)
        if flags & 1 or time.time() - ultimo_latido > LATIDO_MAX_S:
            mision.estado = "PARADA DE EMERGENCIA"
        v_izq = v_der = 0.0
        if mision.estado == "AUTONOMO":
            x, y, th = ekf.x
            p = mision.objetivo()
            if math.hypot(p["e"] - x, p["n"] - y) < p.get("r_llegada", 2.5):
                mision.llegar()
            elif ekf.incertidumbre() > 1.0 and p.get("r_llegada", 2.5) < 1.0:
                mision.estado = "PAUSA"           # posición dudosa en un paso estrecho: pide ayuda
            else:
                kappa, _ = pure_pursuit(x, y, th, mision.tramo(), abs(v))
                vref = float(p.get("v_max", 0.3))
                w = vref * kappa
                v_izq, v_der = vref - w * CHI * B / 2.0, vref + w * CHI * B / 2.0
        esp.velocidades(v_izq, v_der)
        registro.writerow(["%.2f" % t0, mision.estado, "%.2f" % ekf.x[0], "%.2f" % ekf.x[1], "%.3f" % ekf.x[2],
                           "%.2f" % ekf.incertidumbre(), "%.3f" % v_izq, "%.3f" % v_der, mision.objetivo()["id"]])
        time.sleep(max(0.0, 0.05 - (time.time() - t0)))   # ciclo de guiado de 20 Hz


if __name__ == "__main__":
    main()
`;
};
})();
