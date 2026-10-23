# Programa de la Raspberry Pi

Control real del prototipo: la **Raspberry Pi 3 Model B controla directamente el puente H L298N** (diseño final, sin ESP32). Un solo programa en Python, sin librerías externas (solo `gpiozero`, que ya viene en Raspberry Pi OS):

| Archivo | Qué hace |
| --- | --- |
| `ugv.py` | Servidor web, control de motores con PWM por hardware, modo automático por los puntos de la finca, recorridos por tramos, parada sin órdenes y registro CSV |
| `finca.json` | Mapa de la finca: puntos (puesto, A, B, C, D, almacén y cruces), caminos y lotes de cultivo |
| `web/index.html` | Página de control que se abre en el celular (flechas, velocidad, recorridos, datos de la prueba y registro) |
| `config.json` | Puerto, frecuencia de la PWM, tiempo de parada sin órdenes y factor de ajuste de cada motor |
| `ugv.service` | Servicio de systemd: arranca el programa al encender |
| `instalar.sh` | Instala todo: PWM por hardware, programa, servicio y red Wi-Fi propia |
| `test_ugv.py` | Pruebas de extremo a extremo con los pines simulados |

## Conexiones (diagrama final)

| Raspberry Pi | Pin físico | L298N | Función |
| --- | --- | --- | --- |
| 5V | 2 | — | Entra la salida de 5 V del DC-DC |
| GND | 6 | GND | Tierra común con las baterías, el DC-DC y el L298N |
| GPIO 12 | 32 | ENA | PWM por hardware del motor A (izquierdo) |
| GPIO 17 | 11 | IN1 | Sentido del motor A |
| GPIO 27 | 13 | IN2 | Sentido del motor A |
| GPIO 22 | 15 | IN3 | Sentido del motor B |
| GPIO 23 | 16 | IN4 | Sentido del motor B |
| GPIO 13 | 33 | ENB | PWM por hardware del motor B (derecho) |

Baterías 7,4 V (+) → bornera 12V del L298N y entrada del DC-DC. OUT1/OUT2 → motor A; OUT3/OUT4 → motor B. **La salida de 5 V del L298N no se usa.** Quita los puentes (jumpers) de ENA y ENB del módulo para que esos pines reciban la PWM de la Raspberry Pi.

## Instalación paso a paso

1. Graba **Raspberry Pi OS Lite (64 bits, Bookworm)** en la microSD con *Raspberry Pi Imager*. En la configuración del Imager activa **SSH**, pon usuario y clave y, para la instalación, la red Wi-Fi de tu casa.
2. Enciende la Raspberry Pi, entra por SSH (`ssh usuario@raspberrypi.local`) y copia esta carpeta. Por ejemplo, desde el computador:
   ```bash
   scp -r raspberry usuario@raspberrypi.local:~/
   ```
3. En la Raspberry Pi:
   ```bash
   cd ~/raspberry
   chmod +x instalar.sh
   sudo ./instalar.sh
   sudo reboot
   ```
   El instalador agrega a `config.txt` la PWM por hardware (`dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4` y `dtparam=audio=off`), copia el programa a `/opt/ugv`, activa el servicio y crea la red **UGV-Orugas** (clave `orugas2026`). Para otro nombre o clave: `sudo SSID=MiUGV CLAVE=otraClave123 ./instalar.sh`.
4. Después de reiniciar, conecta el celular a la red **UGV-Orugas** y abre **http://10.42.0.1**.

> Después del paso 3 la Raspberry Pi crea su propia red y deja de conectarse a la de tu casa. Para volver a entrar por SSH, conecta el computador a **UGV-Orugas** y usa `ssh usuario@10.42.0.1`.

## Uso

- **Control remoto:** mantén pulsada una flecha; al soltarla se detiene. **ALTO** y **PARAR** detienen en cualquier momento, desde cualquier celular.
- **Modo automático por la finca:** el robot va de punto en punto **solo por los caminos** de `finca.json`, en línea recta, girando sobre su eje en los cruces y retrocediendo cuando el camino vuelve hacia atrás (así no da medias vueltas). Botones:
  - **Recorrido completo:** pasa por todos los puntos (A, B, C, D y almacén) y vuelve al puesto; en cada punto espera 1 s (`espera_s`) y sigue. Si se detuvo a mitad, continúa desde el punto que faltaba.
  - **Desde cero:** empieza otra vez el recorrido por el primer punto.
  - **Esperar mi orden en cada punto:** al llegar se queda quieto hasta que pulses **Siguiente punto**, o hasta que elijas otro punto.
  - **Ir directo a un punto:** calcula el camino más corto (sin atravesar lotes) desde donde está.
  - **Volver al puesto** y **El robot está aquí** (para indicarle dónde lo pusiste).
- **Cómo sabe dónde está:** no lo mide. Al encender supone que está en su puesto mirando al norte (`inicio` y `rumbo_inicial` del mapa) y después lleva la cuenta de cada tramo. Si lo detienes en el camino o lo manejas con las flechas, la posición queda «desconocida»: llévalo a un punto y pulsa **El robot está aquí**.
- **Calibración (obligatoria antes del modo automático):** en un camino de la finca y con la batería cargada:
  1. **Avanzar 10 s:** mide con la cinta cuántos centímetros avanzó y cuánto se desvió de la línea recta (positivo si se fue a la izquierda). Con el desvío el programa ajusta la potencia de cada motor; repite la prueba hasta que el desvío sea menor de 2 cm.
  2. **Girar 10 s:** mide cuántos grados giró.
  3. **Guardar calibración:** quedan `cm_s`, `grados_s`, `factor_izq` y `factor_der` en `config.json`.

  Vuelve a calibrar si cambia la batería, la carga o el suelo: en lazo abierto, un error pequeño por segundo se acumula en un recorrido largo.
- **Tu finca:** mide los puntos y los caminos y escríbelos en `/opt/ugv/finca.json` (en centímetros, `y` hacia el norte). Al arrancar, el programa comprueba que ningún camino pase a menos de `margen_cm` de un lote; si pasa, no arranca y dice cuál.
- **Recorrido programado por tramos:** lista de tramos (avanzar, retroceder, girar a la izquierda o a la derecha sobre su eje, pausa), cada uno con velocidad (%) y duración (s). Se ejecuta en **lazo abierto**: cumple los tiempos sin medir la posición. La página debe quedar abierta mientras corre.
- **Parada sin órdenes:** si dejan de llegar órdenes del celular durante `timeout_ms` (800 ms por defecto), el programa detiene los motores y queda en «DETENIDO POR SEGURIDAD».
- **Datos de la prueba:** elige el código (P1–P10), la superficie y la carga antes de cada ensayo; quedan en cada línea del registro.
- **Registro:** `/opt/ugv/registros/registro-AAAA-MM-DD.csv` (también se descarga desde la página).
- **Ajuste de motores:** si en la prueba P2 el vehículo se desvía siempre hacia un lado, baja el factor del motor más rápido en `/opt/ugv/config.json` (por ejemplo `"factor_der": 0.95`) y reinicia el servicio: `sudo systemctl restart ugv`.

Comandos útiles:

```bash
journalctl -u ugv -f          # ver lo que hace el programa
sudo systemctl stop ugv       # detenerlo (los motores quedan apagados)
sudo systemctl restart ugv    # reiniciarlo después de cambiar config.json
```

## Probar sin la Raspberry Pi

En cualquier computador con Python 3:

```bash
python3 raspberry/ugv.py --simular            # abre http://localhost:8080
python3 -m unittest raspberry/test_ugv.py     # 22 pruebas del servidor real con pines simulados
```

## Limitación de seguridad (declarada en el informe)

La parada sin órdenes vive en este mismo programa. **Si el programa o el sistema operativo se bloquean, los pines pueden quedar en su último estado y los motores seguir girando.** El corte total del prototipo es **desconectar la batería**; para versiones futuras se recomienda un interruptor o paro físico que corte la potencia de los motores sin depender del software. Si el programa termina normalmente o por un error, primero pone los motores en cero, y el servicio lo vuelve a iniciar a los 2 s.

## API (para pruebas o para otros programas)

| Método y ruta | Cuerpo JSON | Respuesta |
| --- | --- | --- |
| `GET /api/estado?cliente=id` | — | modo, potencia de cada oruga, recorrido en curso, pines |
| `POST /api/mover` | `{"cliente", "izq", "der"}` de −100 a 100 | estado (409 si otro dispositivo maneja) |
| `POST /api/parar` | `{"cliente"}` | estado |
| `POST /api/latido` | `{"cliente"}` | estado (mantiene vivo un recorrido) |
| `GET /api/recorridos` | — | recorridos guardados |
| `POST /api/recorridos` | `{"nombre", "tramos": [{"tipo", "velocidad", "duracion"}]}` | estado |
| `DELETE /api/recorridos/<nombre>` | — | `{"ok": true}` |
| `POST /api/ejecutar` | `{"cliente", "nombre"}` o `{"cliente", "nombre", "tramos"}` | estado |
| `POST /api/prueba` | `{"codigo", "superficie", "carga_kg"}` | estado |
| `GET /api/mapa` | — | mapa de la finca (`finca.json`) |
| `POST /api/ir` | `{"cliente", "destino", "esperar_orden"}` | estado (camino más corto por los caminos) |
| `POST /api/recorrido` | `{"cliente", "desde_cero", "esperar_orden"}` | estado (todos los puntos y vuelta al puesto) |
| `POST /api/siguiente` | `{"cliente"}` | estado (sigue cuando espera la orden) |
| `POST /api/posicion` | `{"cliente", "punto", "rumbo"}` | estado (indica dónde está el robot) |
| `POST /api/calibrar` | `{"cliente", "prueba": "avance" o "giro"}` | estado (corre la prueba de 10 s) |
| `POST /api/calibracion` | `{"medido_cm", "medido_grados", "medido_desvio_cm", "vel_auto"}` | estado (guarda la calibración) |
| `GET /api/registro?n=30` · `GET /registro.csv` | — | últimas líneas · archivo del día |

## Si algo no funciona

| Síntoma | Causa probable |
| --- | --- |
| El registro dice «PWM software» | Falta el overlay en `config.txt` o no se reinició; revisa con `ls /sys/class/pwm/pwmchip0` |
| Un motor gira al revés | Intercambia sus dos cables en OUT1/OUT2 (o OUT3/OUT4) |
| Un motor no gira | El puente de ENA o ENB sigue puesto, o falta la tierra común entre la Raspberry Pi y el L298N |
| La Raspberry Pi se reinicia al arrancar los motores | Alimentación: revisa que el DC-DC entregue 5 V y soporte la corriente; no uses el 5 V del L298N |
| No aparece la red UGV-Orugas | Revisa `nmcli connection show` y el país Wi-Fi (`sudo raspi-config` → Localisation → WLAN Country) |
