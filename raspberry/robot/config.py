"""Configuración del robot (config.json) y utilidades para guardar archivos sin dañarlos si se corta la energía."""
import json
import os

# Valores por defecto. config.json solo necesita los que se quieran cambiar.
CONFIG_DEF = {
    # --- red y acceso
    "puerto": 80,                 # página de control: http://10.42.0.1
    "puerto_https": 443,          # página del celular a bordo (sensores y cámara exigen HTTPS): https://10.42.0.1/abordo
    "pin": None,                  # PIN para manejar el robot; instalar.sh crea uno al azar
    "sesion_h": 12,               # horas que dura una sesión iniciada con el PIN
    # --- motores y seguridad
    "pwm_hz": 1000,               # frecuencia de la PWM hacia ENA y ENB
    "vel_max": 100,               # velocidad máxima permitida (%) en cualquier modo
    "rampa_pct_s": 250,           # modo manual: cuánto puede subir la potencia por segundo (%/s); frenar es inmediato
    "timeout_ms": 800,            # sin órdenes ni latidos durante este tiempo -> parada (en el informe: «____ ms»)
    "factor_izq": 1.0,            # ajuste por software de cada motor (se obtiene en la calibración)
    "factor_der": 1.0,
    "toma_control_s": 3.0,        # otro dispositivo puede tomar el control si el actual no envía órdenes en este tiempo
    # --- modo autónomo (sin sensores: tiempos calculados con la calibración)
    "vel_auto": 60,               # velocidad (%) del modo autónomo y de la calibración
    "cm_s": None,                 # avance medido a vel_auto (cm/s)
    "grados_s": None,             # giro sobre el eje medido a vel_auto (°/s)
    "espera_s": 1.0,              # espera en cada punto
    "pausa_giro_s": 0.5,          # pausa entre movimientos distintos (avanzar, girar, retroceder)
    "prueba_calibracion_s": 10.0, # duración de las pruebas de calibración
    "retroceder_si_vuelve": True, # si el siguiente punto queda atrás (más de 135°), retrocede en vez de dar media vuelta
    # --- modo temporal autónomo
    "tolerancia_tiempo_s": 10.0,  # al vencer el tiempo, solo termina el tramo actual si le faltan menos de estos segundos
    # --- celular a bordo (opcional)
    "celular_tolerancia_grados": 4.0,  # el giro termina cuando el rumbo del celular está a menos de esto del objetivo
    "celular_kp": 1.2,            # corrección del rumbo en línea recta (% de potencia por grado de error)
    "celular_corr_max": 20,       # corrección máxima en línea recta (%)
    "celular_max_s": 0.6,         # si los datos del celular tienen más de esta edad, no se usan
    "choque_ms2": 12.0,           # aceleración (sin gravedad) que se considera un golpe -> parada
    "inclinacion_max": 35.0,      # inclinación del robot (°) que se considera peligrosa -> parada
}


def cargar_config(ruta):
    cfg = dict(CONFIG_DEF)
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if k in CONFIG_DEF})
    return cfg


def guardar_json(ruta, datos):
    """Escribe en un archivo temporal y lo reemplaza de una vez: nunca queda un archivo a medias."""
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, ruta)
