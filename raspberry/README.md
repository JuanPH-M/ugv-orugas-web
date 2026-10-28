# Programa de la Raspberry Pi (versión 2)

Control real del prototipo: la **Raspberry Pi 3 Model B controla directamente el puente H L298N** (diseño final, sin ESP32). El robot **no tiene sensores ni cámara**; todo es gratis: Python 3 y `gpiozero`, que ya vienen en Raspberry Pi OS, sin servicios de pago ni librerías externas.

Tres modos de funcionamiento:

| Modo | Qué hace | Cuándo se detiene |
| --- | --- | --- |
| **Manual** | Lo manejas con las flechas del celular | Al soltar la flecha, con PARAR, o si dejan de llegar órdenes durante 800 ms |
| **Autónomo** | Hace una ruta completa: puntos del mapa, coordenadas en metros, instrucciones en metros y grados, o tramos de tiempo | Al terminar, con Pausar/PARAR, o si se pierde la conexión con el celular del operador |
| **Temporal autónomo** | Igual que el autónomo, con un tiempo límite | Al cumplirse el tiempo: **se detiene ya** o **termina el tramo si le falta poco** (`tolerancia_tiempo_s`) y llega a un punto. Nunca empieza un movimiento nuevo después |

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `ugv.py` | Arranca el programa (el servicio ejecuta `/opt/ugv/ugv.py`) |
| `robot/config.py` | Valores por defecto de `config.json` |
| `robot/motores.py` | Pines del L298N, PWM por hardware (GPIO 12 y 13), tope de velocidad y **rampa de aceleración** en el modo manual (frenar es inmediato) |
| `robot/navegacion.py` | Convierte rutas en pasos: metros/km y grados → segundos con la calibración; **posición por estima** |
| `robot/mapa.py` | Mapa (`finca.json`): puntos, caminos (Dijkstra) y zonas prohibidas con margen de seguridad |
| `robot/misiones.py` | Máquina de estados: modos, pausa/reanudar, tiempo límite, vigilancia, celular a bordo. Bucle de control a 50 Hz |
| `robot/rutas.py` | Rutas guardadas en `rutas.json` con **identificador y versión** |
| `robot/celular.py` | Celular a bordo (opcional): rumbo, golpes, inclinación, GPS y cámara |
| `robot/seguridad.py` | PIN, sesiones (bloqueo tras 5 intentos) y validación de cada orden |
| `robot/servidor.py` · `robot/websocket.py` | API HTTP y WebSocket (tiempo real) sin librerías externas |
| `robot/registro.py` | Registro CSV por día y alertas |
| `web/index.html` | Panel del operador (celular o computador) |
| `web/abordo.html` | Página del celular a bordo |
| `finca.json` | Mapa de ejemplo (puntos, caminos y lotes de cultivo) |
| `config.json` | Configuración (el PIN y la calibración se guardan aquí) |
| `instalar.sh` · `actualizar.sh` · `ugv.service` | Instalación, actualización desde GitHub y servicio de arranque |
| `test_ugv.py` | 49 pruebas de extremo a extremo con los pines simulados |

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

1. Graba **Raspberry Pi OS Lite (64 bits, Bookworm)** en la microSD con *Raspberry Pi Imager*. En el Imager activa **SSH**, pon usuario y clave y la red Wi-Fi de tu casa (solo para instalar).
2. Copia el programa a la Raspberry Pi. Dos opciones gratuitas:
   - **Con git** (recomendado, necesita internet en la Raspberry Pi):
     ```bash
     sudo apt install -y git
     git clone https://github.com/JuanPH-M/ugv-orugas-web.git
     cd ugv-orugas-web/raspberry
     ```
   - **Sin internet**, desde el computador: `scp -r raspberry usuario@raspberrypi.local:~/` y luego `cd ~/raspberry`.
3. Instala y reinicia:
   ```bash
   chmod +x instalar.sh actualizar.sh
   sudo ./instalar.sh
   sudo reboot
   ```
   El instalador activa la PWM por hardware (`dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4` y `dtparam=audio=off`), copia el programa a `/opt/ugv`, **crea un PIN de 6 cifras** (lo muestra al terminar), crea un certificado propio para la página del celular a bordo, activa el servicio y crea la red **UGV-Orugas** (clave `orugas2026`). Para otro nombre o clave: `sudo SSID=MiUGV CLAVE=otraClave123 ./instalar.sh`. Se puede repetir sin perder el PIN, la calibración, el mapa, las rutas ni los registros.
4. Conecta el celular a la red **UGV-Orugas**, abre **http://10.42.0.1** y escribe el PIN.

> Después del paso 3 la Raspberry Pi crea su propia red y deja de conectarse a la de tu casa. Para volver a entrar por SSH, conecta el computador a **UGV-Orugas** y usa `ssh usuario@10.42.0.1`.

### Actualizar desde GitHub

Cuando haya cambios en el repositorio, dale internet a la Raspberry Pi un momento (cable Ethernet, o conéctala a la Wi-Fi de la casa o al celular) y ejecuta:

```bash
sudo ~/ugv-orugas-web/raspberry/actualizar.sh
```

Descarga la última versión, **corre las 49 pruebas antes de instalar** (si alguna falla no cambia nada) y reinicia el servicio conservando tus datos.

## Uso

### Antes de nada: calibración

El robot no mide distancias: convierte metros y grados en segundos con la calibración. Hazla sobre la superficie donde trabajará, con la batería cargada:

1. **Avanzar 10 s:** mide con una cinta los cm que avanzó y cuánto se desvió de la línea recta (positivo si se fue a la izquierda). Con el desvío se ajusta la potencia de cada motor; repite hasta que el desvío sea menor de 2 cm.
2. **Girar 10 s:** mide los grados que giró.
3. **Guardar calibración.** Si cambias la velocidad del modo autónomo hay que medir de nuevo.

Vuelve a calibrar si cambian la batería, la carga o el suelo.

### Rutas

- **Metros y grados (instrucciones):** «avanzar 2 m», «girar a la derecha 90°», «esperar 3 s», «retroceder 50 cm»… Acepta cm, m y km (hasta 10 km por fila) y giros de 1 a 360°.
- **Coordenadas:** lista de puntos X, Y en metros (X hacia el este, Y hacia el norte desde un origen que el equipo marca en el terreno). El robot gira hacia cada punto y va en línea recta; si el punto queda atrás (más de 135°), retrocede. También se pueden agregar tocando el mapa.
- **Puntos del mapa:** «ir a B», «recorrido completo» (pasa por todos y vuelve al puesto), «desde cero», «esperar mi orden en cada punto». Solo usa los caminos y nunca pasa a menos de `margen_cm` de un lote.
- **Tramos de tiempo:** avanzar/girar/pausa con velocidad y duración (para las pruebas del informe).

Cada ruta guardada tiene **versión**: si alguien la cambia desde otro celular, el robot no ejecuta la vieja y pide recargarla. Antes de salir, el programa revisa que ningún tramo pise una zona prohibida del mapa.

### Dónde está el robot

**No lo mide: lo estima** (posición por estima con la calibración), y el error crece con la distancia y con el suelo. Al encender supone que está en su puesto mirando según `rumbo_inicial`. Si lo detienes a mitad de un tramo la posición queda «aproximada»; si lo manejas a mano queda «desconocida». Llévalo a un punto conocido y pulsa **El robot está aquí** (o escribe X, Y y rumbo).

### Pausa, reanudar y control manual

Durante una misión las flechas están bloqueadas. **Pausar** detiene el robot; **Reanudar** sigue desde donde estaba; **Tomar control manual** (solo con la misión pausada o detenida) la cancela. **PARAR** funciona siempre, desde cualquier celular y sin PIN.

### Seguridad

- **Vigilancia de conexión:** si dejan de llegar órdenes o latidos del panel durante `timeout_ms` (800 ms), se detiene: en manual queda «DETENIDO POR SEGURIDAD»; en una misión, la deja pausada para reanudarla.
- **Rampa de aceleración** en el modo manual (`rampa_pct_s`) y **tope de velocidad** (`vel_max`): evitan arranques bruscos y picos de corriente. Frenar siempre es inmediato. En el modo autónomo cada paso arranca directo a `vel_auto` (60 % por defecto), igual que en la calibración, para que los metros y grados calculados coincidan.
- **Validación de todo lo que llega:** potencias de −100 a 100, rutas con límites (10 km por instrucción, 8 h por ruta), JSON de máximo 64 kB.
- **PIN** para manejar (5 intentos fallidos → espera de 30 s). Cambia el PIN en `/opt/ugv/config.json` y reinicia.
- Si hay un error interno en el bucle de control, los motores se ponen en cero.

### Celular a bordo (opcional y gratis)

Un celular viejo sujeto al robot y conectado a la red UGV-Orugas, en **https://10.42.0.1/abordo** (el navegador mostrará un aviso por el certificado propio la primera vez: «Avanzado» → «Continuar»). Aporta:

| Qué mide el celular | Para qué lo usa el robot |
| --- | --- |
| Giroscopio y orientación | Los giros terminan cuando el rumbo medido llega al objetivo (± 4°) y en línea recta corrige el rumbo |
| Acelerómetro | **Se detiene si detecta un golpe** (`choque_ms2`) o una **inclinación peligrosa** (`inclinacion_max`) |
| GPS | Se muestra en el panel (solo en exteriores; precisión típica de 3 a 10 m, no sirve para guiar un robot pequeño) |
| Cámara trasera | El operador **ve lo que tiene delante** el robot desde el panel |

Para usarlo: indica dónde está el robot, pulsa **Alinear con el rumbo del robot** y marca **Usar el celular a bordo** al iniciar la misión. Si el celular deja de enviar datos durante la misión, el robot se detiene.

**Lo que no puede hacer:** detectar obstáculos por sí solo ni medir distancias. Un detector automático con la cámara (por ejemplo TensorFlow.js) necesita descargar modelos, no reconoce bien paredes o cajas y gasta mucha batería; se deja como trabajo futuro. El operador debe vigilar el recorrido o usar la cámara.

### Datos de la prueba y registro

Elige la prueba (P1–P10), la superficie y la carga; quedan en cada línea de `/opt/ugv/registros/registro-AAAA-MM-DD.csv` (también se descarga desde el panel), con la posición estimada.

## Probar sin la Raspberry Pi

En cualquier computador con Python 3:

```bash
cd raspberry
python3 ugv.py --simular     # abre http://localhost:8080 · PIN 1234
python3 test_ugv.py          # 49 pruebas con los pines simulados
```

Comandos útiles en la Raspberry Pi:

```bash
journalctl -u ugv -f          # ver lo que hace el programa (el PIN aparece aquí si se creó al arrancar)
sudo systemctl stop ugv       # detenerlo (los motores quedan apagados)
sudo systemctl restart ugv    # reiniciarlo después de cambiar config.json
```

## Limitaciones (declaradas en el informe)

- **Sin sensores de posición** la navegación es en lazo abierto: el error de distancia crece con el recorrido y depende del suelo, la carga y la batería (se mide en las pruebas del informe). No hay tolerancia de llegada medida; con el celular a bordo sí hay tolerancia de rumbo.
- **Sin detección de obstáculos:** el robot no ve; el operador debe vigilar (PARAR, cámara del celular a bordo).
- **Si el programa o el sistema operativo se bloquean, los pines pueden quedar en su último estado.** El corte total del prototipo es **desconectar la batería**; para versiones futuras se recomienda un paro físico que corte la potencia de los motores sin depender del software.
- **La batería no se mide:** la Raspberry Pi no tiene entrada analógica.

## API (para pruebas o para otros programas)

Todas, salvo `/api/info`, `/api/entrar` y `/api/parar`, piden la cabecera `X-Token` (se obtiene con el PIN).

| Método y ruta | Cuerpo JSON | Qué hace |
| --- | --- | --- |
| `POST /api/entrar` | `{"pin"}` | Devuelve `{"token"}` |
| `POST /api/parar` | `{}` | Detiene y cancela (sin PIN) |
| `GET /api/estado` | — | Estado, modo, potencias, pines, posición, misión, calibración, celular, alertas |
| `POST /api/mover` | `{"cliente", "izq", "der"}` (−100 a 100) | Control manual (409 si hay misión u otro dispositivo maneja) |
| `POST /api/latido` | `{"cliente"}` | Mantiene viva la misión |
| `GET/POST /api/rutas` · `DELETE /api/rutas/<id>` | `{"nombre", "tipo", "datos"}` | Rutas guardadas (la versión sube al guardar) |
| `POST /api/ejecutar` | `{"id", "version", "temporal": {"limite_s", "al_terminar"}, "esperar_orden", "usar_celular"}` | Ejecuta una ruta guardada |
| `POST /api/ir` · `/api/recorrido` | `{"destino"}` · `{"desde_cero"}` + las mismas opciones | Puntos del mapa |
| `POST /api/pausar` · `/api/reanudar` · `/api/siguiente` · `/api/manual` | `{}` | Control de la misión |
| `POST /api/posicion` | `{"punto"}` o `{"x_m", "y_m", "rumbo"}` | Indica dónde está el robot |
| `POST /api/calibrar` · `/api/calibracion` | `{"prueba"}` · `{"medido_cm", "medido_grados", "medido_desvio_cm", "vel_auto"}` | Calibración |
| `POST /api/celular` · `/api/celular/alinear` · `/api/camara` | lectura · `{}` · JPEG | Celular a bordo |
| `GET /api/mapa` · `/api/registro?n=30` · `/registro.csv` · `/api/camara.jpg` | — | Datos |
| `WS /ws` | primero `{"t": "hola", "token", "cliente"}` | Estado cada 200 ms; acepta `mover`, `latido`, `parar`, `celular` |

## Si algo no funciona

| Síntoma | Causa probable |
| --- | --- |
| El registro dice «PWM software» | Falta el overlay en `config.txt` o no se reinició; revisa con `ls /sys/class/pwm/pwmchip0` |
| Un motor gira al revés | Intercambia sus dos cables en OUT1/OUT2 (o OUT3/OUT4) |
| Un motor no gira | El puente de ENA o ENB sigue puesto, o falta la tierra común entre la Raspberry Pi y el L298N |
| La Raspberry Pi se reinicia al arrancar los motores | Alimentación: revisa que el DC-DC entregue 5 V y soporte la corriente; no uses el 5 V del L298N; baja `rampa_pct_s` (manual) o `vel_auto` (autónomo) |
| No aparece la red UGV-Orugas | Revisa `nmcli connection show` y el país Wi-Fi (`sudo raspi-config` → Localisation → WLAN Country) |
| Olvidé el PIN | `sudo grep pin /opt/ugv/config.json` |
| La página del celular a bordo no muestra datos | Debe abrirse con **https://**; acepta el aviso del certificado y los permisos de movimiento |
| El robot se queda corto o se pasa | Repite la calibración en esa superficie y con esa carga |
