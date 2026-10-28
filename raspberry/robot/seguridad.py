"""Seguridad: sesiones con PIN, validación de órdenes de movimiento y cambios de modo permitidos.

Lo que el software NO puede garantizar (declarado en el informe): si el programa o el sistema operativo se bloquean,
los pines pueden quedar en su último estado. El corte total del prototipo es desconectar la batería; un paro físico
queda recomendado para versiones futuras."""
import hmac
import math
import secrets
import time


class Sesiones:
    """El PIN se pide una vez por dispositivo; después la página usa un token. Detener el robot no requiere PIN."""

    def __init__(self, cfg):
        self.cfg, self.tokens = cfg, {}
        self.fallos, self.bloqueo_hasta = 0, 0.0

    def entrar(self, pin):
        ahora = time.monotonic()
        if ahora < self.bloqueo_hasta:
            raise PermissionError(f"Demasiados intentos: espera {int(self.bloqueo_hasta - ahora) + 1} s.")
        real = str(self.cfg.get("pin") or "")
        if not real or not hmac.compare_digest(str(pin or ""), real):
            self.fallos += 1
            if self.fallos >= 5:
                self.fallos, self.bloqueo_hasta = 0, ahora + 30
            raise PermissionError("PIN incorrecto.")
        self.fallos = 0
        token = secrets.token_hex(16)
        self.tokens[token] = ahora + float(self.cfg["sesion_h"]) * 3600
        return token

    def valida(self, token):
        vence = self.tokens.get(str(token or ""))
        if vence is None:
            return False
        if time.monotonic() > vence:
            self.tokens.pop(token, None)
            return False
        return True

    def salir(self, token):
        self.tokens.pop(str(token or ""), None)


def potencia(valor):
    """Una potencia de oruga válida: número finito entre −100 y 100."""
    try:
        v = float(valor)
    except (TypeError, ValueError):
        raise ValueError("La potencia debe ser un número.")
    if not math.isfinite(v) or abs(v) > 100:
        raise ValueError("La potencia va de −100 a 100 %.")
    return v


def duracion_limite(valor):
    try:
        v = float(valor)
    except (TypeError, ValueError):
        raise ValueError("El tiempo límite debe ser un número de segundos.")
    if not math.isfinite(v) or not 5 <= v <= 8 * 3600:
        raise ValueError("El tiempo límite va de 5 s a 8 h.")
    return v
