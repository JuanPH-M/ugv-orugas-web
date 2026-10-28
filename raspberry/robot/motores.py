"""Control de motores: la Raspberry Pi escribe directamente las seis entradas del L298N.

Diagrama final (numeración BCM, entre paréntesis el pin físico):
  GPIO 12 (32) -> ENA  PWM por hardware del motor A (oruga izquierda)
  GPIO 17 (11) -> IN1  sentido del motor A
  GPIO 27 (13) -> IN2  sentido del motor A
  GPIO 22 (15) -> IN3  sentido del motor B (oruga derecha)
  GPIO 23 (16) -> IN4  sentido del motor B
  GPIO 13 (33) -> ENB  PWM por hardware del motor B
Los motores nunca se conectan a los GPIO: la potencia la entrega el L298N desde las baterías.
"""
import logging
import os
import threading
import time

PIN_ENA, PIN_IN1, PIN_IN2 = 12, 17, 27
PIN_IN3, PIN_IN4, PIN_ENB = 22, 23, 13
PWM_CANAL = {12: 0, 13: 1}   # GPIO 12 = PWM0, GPIO 13 = PWM1 (dtoverlay=pwm-2chan)

log = logging.getLogger("ugv")


class PWMHardware:
    """PWM por hardware de la Raspberry Pi a través de /sys/class/pwm (requiere dtoverlay=pwm-2chan)."""

    def __init__(self, gpio, hz):
        self.canal = PWM_CANAL[gpio]
        self.chip = self._buscar_chip()
        self.base = f"{self.chip}/pwm{self.canal}"
        if not os.path.isdir(self.base):
            self._escribir(f"{self.chip}/export", self.canal)
            for _ in range(50):                      # el sistema tarda un momento en crear los archivos
                if os.access(f"{self.base}/period", os.W_OK):
                    break
                time.sleep(0.02)
        self.periodo = int(1e9 / hz)
        self._escribir(f"{self.base}/enable", 0)
        self._escribir(f"{self.base}/duty_cycle", 0)
        self._escribir(f"{self.base}/period", self.periodo)
        self._escribir(f"{self.base}/enable", 1)

    @staticmethod
    def _buscar_chip():
        raiz = "/sys/class/pwm"
        for nombre in sorted(os.listdir(raiz)) if os.path.isdir(raiz) else []:
            ruta = os.path.join(raiz, nombre)
            try:
                with open(os.path.join(ruta, "npwm")) as f:
                    if int(f.read()) >= 2:
                        return ruta
            except OSError:
                continue
        raise RuntimeError("No hay PWM por hardware: agrega 'dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4' "
                           "y 'dtparam=audio=off' en config.txt y reinicia (ver README.md).")

    @staticmethod
    def _escribir(ruta, valor):
        with open(ruta, "w") as f:
            f.write(str(valor))

    def set(self, fraccion):
        self._escribir(f"{self.base}/duty_cycle", int(self.periodo * max(0.0, min(1.0, fraccion))))

    def close(self):
        try:
            self.set(0)
            self._escribir(f"{self.base}/enable", 0)
        except OSError:
            pass


class PWMSoftware:
    """Respaldo si no está activo el overlay: PWM por software de gpiozero (menos estable)."""

    def __init__(self, gpio, hz):
        from gpiozero import PWMOutputDevice
        self.dev = PWMOutputDevice(gpio, frequency=hz, initial_value=0)

    def set(self, fraccion):
        self.dev.value = max(0.0, min(1.0, fraccion))

    def close(self):
        self.dev.close()


class SalidaDigital:
    def __init__(self, gpio):
        from gpiozero import DigitalOutputDevice
        self.dev = DigitalOutputDevice(gpio, initial_value=False)

    def set(self, nivel):
        self.dev.value = 1 if nivel else 0

    def close(self):
        self.dev.close()


class SalidaSimulada:
    """Para probar el programa en un computador: guarda el valor que tendría el pin."""

    def __init__(self, gpio, *_):
        self.gpio, self.valor = gpio, 0

    def set(self, valor):
        self.valor = valor

    def close(self):
        self.valor = 0


class Motores:
    """Recibe una potencia objetivo por oruga (-100..100 %) y la aplica con dos protecciones:
    tope de velocidad (vel_max) y rampa de aceleración (rampa_pct_s). Frenar o detenerse es inmediato.
    La potencia aplicada se actualiza en paso(dt), que llama el bucle de control 50 veces por segundo.
    La rampa se usa en el modo manual. En el modo autónomo cada paso arranca directo (rampa=False): así el tiempo
    calculado con la calibración coincide con el movimiento real (la calibración también se hace sin rampa)."""

    def __init__(self, cfg, simular=False):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.izq = self.der = 0.0          # potencia aplicada (con factores, tope y rampa)
        self.obj_izq = self.obj_der = 0.0  # potencia pedida
        self.con_rampa = True
        if simular:
            self.tipo_pwm = "simulada"
            pwm, dig = SalidaSimulada, SalidaSimulada
        else:
            dig = SalidaDigital
            try:
                PWMHardware(PIN_ENA, cfg["pwm_hz"]).close()   # comprobación
                pwm, self.tipo_pwm = PWMHardware, "hardware"
            except (RuntimeError, OSError) as e:
                log.warning("%s Se usa PWM por software como respaldo.", e)
                pwm, self.tipo_pwm = PWMSoftware, "software"
        self.ena, self.enb = pwm(PIN_ENA, cfg["pwm_hz"]), pwm(PIN_ENB, cfg["pwm_hz"])
        self.in1, self.in2, self.in3, self.in4 = (dig(p) for p in (PIN_IN1, PIN_IN2, PIN_IN3, PIN_IN4))
        self.parar()

    def _tope(self, v, factor):
        vmax = max(0.0, min(100.0, float(self.cfg["vel_max"])))
        return max(-vmax, min(vmax, float(v) * factor))

    def objetivo(self, izq, der, rampa=True):
        """Fija la potencia pedida; se aplica en el siguiente paso() (o de inmediato si es para frenar o sin rampa)."""
        with self.lock:
            self.con_rampa = rampa
            self.obj_izq = self._tope(izq, self.cfg["factor_izq"])
            self.obj_der = self._tope(der, self.cfg["factor_der"])
        self.paso(0.0)

    @staticmethod
    def _rampa(actual, objetivo, maximo):
        if objetivo == 0:
            return 0.0                                         # detenerse: inmediato
        if actual != 0 and (objetivo > 0) != (actual > 0):
            actual = 0.0                                       # cambio de sentido: primero a cero y desde ahí acelera
        if abs(objetivo) <= abs(actual):
            return objetivo                                    # bajar la potencia: inmediato
        paso = min(abs(objetivo) - abs(actual), maximo)        # subirla: como máximo «maximo» por paso
        return actual + paso if objetivo > 0 else actual - paso

    def paso(self, dt):
        """Avanza la rampa de aceleración dt segundos y escribe los pines."""
        with self.lock:
            r = float(self.cfg["rampa_pct_s"] or 0)
            maximo = float("inf") if (r <= 0 or not self.con_rampa) else r * dt
            izq = self._rampa(self.izq, self.obj_izq, maximo)
            der = self._rampa(self.der, self.obj_der, maximo)
            self.izq = self._lado(self.ena, self.in1, self.in2, izq, self.izq)
            self.der = self._lado(self.enb, self.in3, self.in4, der, self.der)

    @staticmethod
    def _lado(en, ia, ib, v, anterior):
        if (v > 0) != (anterior > 0) or (v < 0) != (anterior < 0):
            en.set(0)                   # si cambia el sentido, primero se quita la potencia,
            ia.set(v > 0)               # luego se fija el sentido en INx,
            ib.set(v < 0)
        en.set(abs(v) / 100.0)          # y por último el ancho de pulso en ENx
        return v

    def parar(self):
        """Parada inmediata: sin rampa."""
        with self.lock:
            for s in (self.ena, self.enb, self.in1, self.in2, self.in3, self.in4):
                s.set(0)
            self.izq = self.der = self.obj_izq = self.obj_der = 0.0

    @property
    def moviendo(self):
        return bool(self.izq or self.der or self.obj_izq or self.obj_der)

    def pines(self):
        """Estado de los seis pines, para la página y las pruebas."""
        v = lambda s: getattr(s, "valor", None)
        return {"ENA": v(self.ena), "IN1": v(self.in1), "IN2": v(self.in2),
                "IN3": v(self.in3), "IN4": v(self.in4), "ENB": v(self.enb)}

    def close(self):
        self.parar()
        for s in (self.ena, self.enb, self.in1, self.in2, self.in3, self.in4):
            s.close()
