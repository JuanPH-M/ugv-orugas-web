/* Datos del robot: piezas, pines y conexiones.
   Unidades: cm para 3D, g para masa, V y A para electricidad.
   Lo marcado como "estimado" sale de fotos o fichas genéricas y debe verificarse. */
window.UGV = window.UGV || {};

UGV.CATS = {
  estructura: 'Estructura',
  potencia: 'Potencia',
  control: 'Control',
  actuador: 'Actuador',
  sensor: 'Sensor',
  accesorio: 'Accesorio'
};

/* Tipos de pin: pwr (alimentación), gnd, sig (señal digital/PWM), bus (I2C/CSI), mot (salida a motor) */
UGV.PARTS = [
  {
    id: 'chassis', name: 'Chasis de orugas', cat: 'estructura', on: true, core: true, mass: 292,
    short: 'Base de aluminio de 2 mm, 2 orugas plásticas, 2 ruedas dentadas y 2 lisas',
    desc: 'Estructura del robot. La base de aluminio pintado sostiene la electrónica; cada oruga tiene una rueda dentada de tracción unida al motor y una rueda lisa de giro libre.',
    specs: [['Dimensiones', '180 × 165 × 60 mm'], ['Peso del kit', '482 g (con motores)'], ['Base', 'Aluminio 2 mm, pintura negra'], ['Rodaje', 'Orugas y ruedas plásticas'], ['Ancho de vía', '≈ 125 mm entre centros de oruga (estimado)'], ['Rueda', '≈ 52 mm de diámetro (estimado de fotos)']],
    pins: [], sch: null
  },
  {
    id: 'motorA', name: 'Motor A · izquierdo', cat: 'actuador', on: true, core: true, mass: 95,
    short: 'Motorreductor 33GB520, 9–12 V, 3,5 kg·cm',
    desc: 'Mueve la oruga izquierda desde la rueda dentada delantera. Solo tiene dos terminales: no trae encoder.',
    specs: [['Modelo', '33GB520 (motorreductor de 33 mm)'], ['Tensión', '9–12 V'], ['Velocidad', '170–350 RPM según reducción'], ['Torque', '3,5 kg·cm = 0,34 N·m'], ['Consumo sin carga', '100 mA'], ['Encoder', 'No']],
    pins: [{ id: 'M+', t: 'mot', side: 'l' }, { id: 'M-', t: 'mot', side: 'l' }],
    sch: { x: 1000, y: 40 }
  },
  {
    id: 'motorB', name: 'Motor B · derecho', cat: 'actuador', on: true, core: true, mass: 95,
    short: 'Motorreductor 33GB520, 9–12 V, 3,5 kg·cm',
    desc: 'Mueve la oruga derecha desde la rueda dentada trasera. Solo tiene dos terminales: no trae encoder.',
    specs: [['Modelo', '33GB520 (motorreductor de 33 mm)'], ['Tensión', '9–12 V'], ['Velocidad', '170–350 RPM según reducción'], ['Torque', '3,5 kg·cm = 0,34 N·m'], ['Consumo sin carga', '100 mA'], ['Encoder', 'No']],
    pins: [{ id: 'M+', t: 'mot', side: 'l' }, { id: 'M-', t: 'mot', side: 'l' }],
    sch: { x: 1000, y: 200 }
  },
  {
    id: 'battery', name: 'Baterías 2 × 18650', cat: 'potencia', on: true, core: true, mass: 115,
    short: '2 celdas de 3,7 V en serie = 7,4 V nominal',
    desc: 'Dos celdas de ion-litio de 3,7 V nominales cada una, en un portapilas en serie. Cargadas dan 8,4 V; por debajo de 6,0 V (3,0 V por celda) deben recargarse. Para la finca se recomienda una tercera celda (11,1 V): compensa la caída del L298N y casi duplica la velocidad. En el simulador se elige en “Modelo físico”.',
    specs: [['Celdas', '2 × 18650 ion-litio (código LGABB41865)'], ['Tensión por celda', '3,7 V nominal · 4,2 V llena · 3,0 V vacía'], ['Pack en serie', '7,4 V nominal · 8,4 V lleno · 6,0 V vacío'], ['Capacidad', '≈ 2600 mAh (según el código de la celda, verificar)'], ['Energía', '≈ 19 Wh'], ['Masa', '2 × 46 g + portapilas']],
    pins: [{ id: 'BAT+', t: 'pwr', side: 'r', v: 7.4 }, { id: 'BAT-', t: 'gnd', side: 'r', v: 0 }],
    sch: { x: 40, y: 40 }
  },
  {
    id: 'l298n', name: 'Driver L298N', cat: 'potencia', on: true, core: true, mass: 30,
    short: 'Doble puente H, 2 A por canal, regulador de 5 V',
    desc: 'Recibe las señales de la ESP32 y entrega la potencia a los dos motores. Su regulador 78M05 da 5 V a la ESP32 cuando el jumper de 5 V está puesto.',
    specs: [['Chip', 'L298N (Multiwatt 15)'], ['Canales', '2 puentes H'], ['Corriente', 'hasta 2 A por canal'], ['Caída interna', '≈ 1,8–3 V (transistores bipolares)'], ['Regulador', '78M05 → 5 V, ≈ 0,5 A'], ['Medidas', '43 × 43 × 27 mm']],
    pins: [
      { id: '12V', t: 'pwr', side: 'l' }, { id: 'GND', t: 'gnd', side: 'l' }, { id: '5V', t: 'pwr', side: 'l', v: 5.0 },
      { id: 'ENA', t: 'sig', side: 'l' }, { id: 'IN1', t: 'sig', side: 'l' }, { id: 'IN2', t: 'sig', side: 'l' },
      { id: 'IN3', t: 'sig', side: 'l' }, { id: 'IN4', t: 'sig', side: 'l' }, { id: 'ENB', t: 'sig', side: 'l' },
      { id: 'OUT1', t: 'mot', side: 'r' }, { id: 'OUT2', t: 'mot', side: 'r' }, { id: 'OUT3', t: 'mot', side: 'r' }, { id: 'OUT4', t: 'mot', side: 'r' }
    ],
    sch: { x: 660, y: 40 }
  },
  {
    id: 'esp32', name: 'ESP32 DevKit', cat: 'control', on: true, core: true, mass: 10,
    short: 'NodeMCU-32S, 30 pines, WiFi + Bluetooth',
    desc: 'Controlador de bajo nivel y de seguridad. Cierra el lazo de velocidad de cada oruga, lee encoders, IMU y ultrasonido, recibe la radio LoRa del operador y detiene los motores si pierde las órdenes de la Raspberry Pi. También sirve una app WiFi de respaldo en 192.168.4.1.',
    specs: [['Módulo', 'ESP-WROOM-32 · doble núcleo 240 MHz'], ['Placa', 'DevKit 30 pines · 55 × 28 mm'], ['Lógica', '3,3 V (los GPIO no toleran 5 V)'], ['Alimentación', 'VIN 5 V o USB'], ['Red', 'Punto de acceso WiFi 192.168.4.1'], ['Consumo', '≈ 120 mA con WiFi activo']],
    pins: [
      { id: 'VIN', t: 'pwr', side: 'l' }, { id: 'GND', t: 'gnd', side: 'l' }, { id: '3V3', t: 'pwr', side: 'l', v: 3.3 },
      { id: 'D14', t: 'sig', side: 'r', gpio: true }, { id: 'D27', t: 'sig', side: 'r', gpio: true }, { id: 'D26', t: 'sig', side: 'r', gpio: true },
      { id: 'D25', t: 'sig', side: 'r', gpio: true }, { id: 'D33', t: 'sig', side: 'r', gpio: true }, { id: 'D32', t: 'sig', side: 'r', gpio: true },
      { id: 'RX2', t: 'sig', side: 'r', gpio: true }, { id: 'TX2', t: 'sig', side: 'r', gpio: true },
      { id: 'D18', t: 'sig', side: 'r', gpio: true }, { id: 'D19', t: 'sig', side: 'r', gpio: true },
      { id: 'D23', t: 'sig', side: 'r', gpio: true }, { id: 'D13', t: 'sig', side: 'r', gpio: true },
      { id: 'D21', t: 'bus', side: 'l', gpio: true }, { id: 'D22', t: 'bus', side: 'l', gpio: true },
      { id: 'D5', t: 'sig', side: 'l', gpio: true },
      { id: 'D2', t: 'sig', side: 'l', gpio: true }, { id: 'D4', t: 'sig', side: 'l', gpio: true },
      { id: 'D34', t: 'sig', side: 'l', gpio: true }, { id: 'D35', t: 'sig', side: 'l', gpio: true },
      { id: 'VP', t: 'sig', side: 'l', gpio: true }, { id: 'VN', t: 'sig', side: 'l', gpio: true }
    ],
    sch: { x: 330, y: 230 }
  },
  {
    id: 'rpi', name: 'Raspberry Pi 3 Model B', cat: 'control', on: true, core: true, mass: 42,
    short: 'Unidad central · 4 núcleos 1,2 GHz · 1 GB RAM',
    desc: 'Componente central del vehículo. Ejecuta la máquina de estados y la misión por puntos (A → B → C → acopio), lee el GNSS, fusiona los sensores con el filtro de Kalman, calcula el Pure Pursuit, habla con la ESP32 por el puerto serie y con el operador por LoRa o WiFi, y guarda el registro de cada viaje. Va dentro de la caja, sobre separadores.',
    specs: [['Procesador', 'BCM2837 · 4 × Cortex-A53 1,2 GHz'], ['Memoria', '1 GB LPDDR2'], ['Medidas', '85,6 × 56,5 × 17 mm'], ['Alimentación', '5 V · hasta 2,5 A'], ['Cámara', 'Conector CSI'], ['Enlace con la ESP32', 'UART en GPIO 14 (TX) y GPIO 15 (RX), 115 200 bit/s'], ['Consumo típico', '≈ 0,5–0,8 A procesando video']],
    pins: [{ id: '5V', t: 'pwr', side: 'l' }, { id: 'GND', t: 'gnd', side: 'l' }, { id: 'CSI', t: 'bus', side: 'r' },
      { id: 'TX', t: 'sig', side: 'r' }, { id: 'RX', t: 'sig', side: 'r' }, { id: 'USB', t: 'bus', side: 'r' }],
    sch: { x: 1000, y: 430 }
  },
  {
    id: 'box', name: 'Caja de cartón', cat: 'estructura', on: true, core: true, mass: 25,
    short: 'Cubierta de ≈ 95 × 85 × 70 mm',
    desc: 'Cubre la Raspberry Pi y la electrónica. En el simulador, “Ver interior” la vuelve transparente.',
    specs: [['Material', 'Cartón blanco'], ['Medidas', '≈ 95 × 85 × 70 mm (estimado de fotos)']],
    pins: [], sch: null
  },
  /* ---------- Piezas que faltan ---------- */
  {
    id: 'switch', name: 'Interruptor de encendido', cat: 'potencia', on: false, mass: 4,
    short: 'Interruptor de palanca en el positivo',
    desc: 'Corta el positivo de las baterías para apagar el robot sin sacar las pilas.',
    specs: [['Tipo', 'Palanca SPST'], ['Corriente', '≥ 3 A'], ['Ubicación', 'Parte trasera']],
    pins: [{ id: 'IN', t: 'pwr', side: 'l' }, { id: 'OUT', t: 'pwr', side: 'r' }],
    sch: { x: 40, y: 220 }
  },
  {
    id: 'buck', name: 'Convertidor DC-DC 5 V', cat: 'potencia', on: true, mass: 15,
    short: 'Reductor tipo LM2596 / XL4015, 5 V 3 A',
    desc: 'Necesario para alimentar la Raspberry Pi 3 desde las baterías. El regulador del L298N no entrega los 2,5 A que la Pi puede pedir.',
    specs: [['Entrada', '7–24 V'], ['Salida', '5,1 V ajustable'], ['Corriente', '3 A'], ['Eficiencia', '≈ 85 %'], ['Medidas', '43 × 21 mm']],
    pins: [{ id: 'IN+', t: 'pwr', side: 'l' }, { id: 'IN-', t: 'gnd', side: 'l' }, { id: 'OUT+', t: 'pwr', side: 'r', v: 5.1 }, { id: 'OUT-', t: 'gnd', side: 'r' }],
    sch: { x: 660, y: 430 }
  },
  {
    id: 'cam', name: 'Cámara Raspberry Pi v2', cat: 'sensor', on: false, need: true, mass: 3,
    short: 'Sensor Sony IMX219 de 8 MP',
    desc: 'Lee el marcador ArUco del punto de acopio para la maniobra final de llegada, donde se necesita precisión de centímetros. En campo abierto la localización principal es el GNSS. En el simulador activa la vista “Cámara”.',
    specs: [['Sensor', 'Sony IMX219 · 8 MP'], ['Campo de visión', '62° horizontal'], ['Conexión', 'Cable plano CSI de 15 pines'], ['Medidas', '25 × 24 mm']],
    pins: [{ id: 'CSI', t: 'bus', side: 'l' }],
    sch: { x: 1270, y: 430 }
  },
  {
    id: 'imu', name: 'IMU MPU-6050', cat: 'sensor', on: false, need: true, mass: 2,
    short: 'Acelerómetro + giroscopio de 6 ejes, I2C',
    desc: 'Mide el giro real del robot. Con ella el filtro de Kalman corrige el error que causa el deslizamiento de las orugas.',
    specs: [['Ejes', '3 acelerómetro + 3 giroscopio'], ['Bus', 'I2C, dirección 0x68'], ['Alimentación', '3,3–5 V'], ['Medidas', '21 × 16 mm']],
    pins: [{ id: 'VCC', t: 'pwr', side: 'r' }, { id: 'GND', t: 'gnd', side: 'r' }, { id: 'SDA', t: 'bus', side: 'r' }, { id: 'SCL', t: 'bus', side: 'r' }],
    sch: { x: 40, y: 380 }
  },
  {
    id: 'sonar', name: 'Sensor ultrasónico JSN-SR04T', cat: 'sensor', on: false, need: true, mass: 14,
    short: 'Distancia 25–450 cm, frente resistente al agua',
    desc: 'Detecta obstáculos al frente (OE4). Se eligió en lugar del HC-SR04 y de los sensores láser porque su frente resiste el agua y no pierde alcance con el sol. Su salida ECHO es de 5 V: necesita un divisor de tensión. En el simulador el robot reduce la velocidad a menos de 150 cm y se detiene a menos de 60 cm.',
    specs: [['Rango', '25–450 cm'], ['Ángulo', '< 50°'], ['Alimentación', '5 V · 30 mA'], ['Salida ECHO', '5 V (requiere divisor)'], ['Protección', 'Frente sellado contra agua'], ['Pines', 'TRIG en GPIO 23 · ECHO en GPIO 13']],
    pins: [{ id: 'VCC', t: 'pwr', side: 'r' }, { id: 'TRIG', t: 'sig', side: 'r' }, { id: 'ECHO', t: 'sig', side: 'r', v: 5.0, out5: true }, { id: 'GND', t: 'gnd', side: 'r' }],
    sch: { x: 40, y: 560 }
  },
  {
    id: 'divider', name: 'Divisor de tensión 1 kΩ / 2 kΩ', cat: 'accesorio', on: false, mass: 1,
    short: 'Baja la señal ECHO de 5 V a 3,3 V',
    desc: 'Dos resistencias que convierten la salida de 5 V del HC-SR04 en 3,3 V seguros para la ESP32.',
    specs: [['R1', '1 kΩ (serie)'], ['R2', '2 kΩ (a GND)'], ['Salida', '5 V × 2/3 = 3,3 V']],
    pins: [{ id: 'IN', t: 'sig', side: 'l' }, { id: 'OUT', t: 'sig', side: 'r' }, { id: 'GND', t: 'gnd', side: 'l' }],
    sch: { x: 330, y: 700 }
  },
  {
    id: 'leds', name: 'Luces LED delanteras', cat: 'accesorio', on: false, need: true, mass: 2,
    short: '2 LED blancos de 5 mm con resistencia',
    desc: 'El botón Luces de la app ya existe; faltan los LED físicos.',
    specs: [['LED', '2 × blanco 5 mm'], ['Resistencia', '68 Ω cada uno'], ['Corriente', '≈ 15 mA por LED']],
    pins: [{ id: 'A', t: 'sig', side: 'l' }, { id: 'K', t: 'gnd', side: 'l' }],
    sch: { x: 660, y: 600 }
  },
  {
    id: 'buzzer', name: 'Bocina (buzzer)', cat: 'accesorio', on: false, need: true, mass: 2,
    short: 'Buzzer activo de 12 mm',
    desc: 'El botón Bocina de la app ya existe; falta el buzzer físico.',
    specs: [['Tipo', 'Buzzer activo'], ['Tensión', '3,3–5 V'], ['Frecuencia', '≈ 2,3 kHz']],
    pins: [{ id: '+', t: 'sig', side: 'l' }, { id: '-', t: 'gnd', side: 'l' }],
    sch: { x: 660, y: 720 }
  },
  {
    id: 'enc', name: 'Encoders Hall en los motores', cat: 'sensor', on: false, need: true, mass: 10,
    short: 'Motores 33GB520 con encoder magnético',
    desc: 'Cuentan las vueltas de cada motor para medir la odometría. Requieren cambiar los motores por la versión con encoder.',
    specs: [['Tipo', 'Hall de 2 canales (A/B)'], ['Resolución', '≈ 11 pulsos por vuelta del motor'], ['Alimentación', '3,3–5 V'], ['Pines', 'Solo entrada: GPIO 34, 35, 36, 39']],
    pins: [{ id: 'A1', t: 'sig', side: 'r' }, { id: 'B1', t: 'sig', side: 'r' }, { id: 'A2', t: 'sig', side: 'r' }, { id: 'B2', t: 'sig', side: 'r' }, { id: 'VCC', t: 'pwr', side: 'r' }, { id: 'GND', t: 'gnd', side: 'r' }],
    sch: { x: 40, y: 740 }
  },
  {
    id: 'aruco', name: 'Marcadores ArUco', cat: 'accesorio', on: false, need: true, mass: 0, noModel: true,
    short: '1 marcador plastificado en la entrada del acopio',
    desc: 'En la finca ya no marcan toda la ruta: el GNSS cubre el campo abierto. El marcador se conserva en la entrada del punto de acopio, bajo techo, para que la cámara corrija la posición en los últimos metros y el robot se detenga frente a la báscula.',
    specs: [['Diccionario', 'DICT_4X4_50'], ['Tamaño', '20 × 20 cm, plastificado'], ['Cantidad', '1 (ID 7) en el acopio']],
    pins: [], sch: null
  },
  /* ---------- Piezas nuevas para la operación en finca ---------- */
  {
    id: 'gnss', name: 'Receptor GNSS u-blox NEO-M8N', cat: 'sensor', on: false, need: true, mass: 24,
    short: 'GPS + GLONASS/BeiDou, ≈ 2 m de precisión, por USB a la Raspberry Pi',
    desc: 'Localización principal en campo abierto. La Raspberry Pi lee sus mensajes por un adaptador USB-serie y los fusiona con los encoders y la IMU. Bajo árboles de sombrío la precisión empeora; para circular entre surcos se recomienda la corrección RTK (módulo ZED-F9P).',
    specs: [['Módulo', 'u-blox NEO-M8N con EEPROM'], ['Precisión', '≈ 2 m CEP autónomo · 0,01 m + 1 ppm con RTK (ZED-F9P)'], ['Actualización', 'hasta 10 Hz con dos constelaciones'], ['Conexión', 'Serie por adaptador USB a la Raspberry Pi'], ['Antena', 'En un mástil sobre la caja, lejos de los motores'], ['Precio', '$ 67.300 (Electronilab, oct. 2026)']],
    pins: [{ id: 'USB', t: 'bus', side: 'l' }],
    sch: { x: 1270, y: 600 }
  },
  {
    id: 'lora', name: 'Radio LoRa E220-900T22D', cat: 'control', on: false, need: true, mass: 9,
    short: '915 MHz · 22 dBm · enlace con el operador',
    desc: 'Enlace de largo alcance con la estación del operador, en el segmento de 915 a 928 MHz de uso libre en Colombia. Va conectada a la ESP32 y no a la Raspberry Pi: así la orden de parada llega a la capa de tiempo real aunque el sistema operativo esté ocupado.',
    specs: [['Chip', 'LLCC68 (LoRa)'], ['Banda', '915–928 MHz (uso libre en Colombia)'], ['Potencia', '22 dBm'], ['Interfaz', 'UART 3,3 V: TXD → GPIO 18, RXD ← GPIO 19'], ['Mensajes', 'Mando 5 Hz, latido 1 Hz, telemetría 1 Hz'], ['Precio', '$ 37.500 por unidad (se necesitan 2)']],
    pins: [{ id: 'VCC', t: 'pwr', side: 'r' }, { id: 'GND', t: 'gnd', side: 'r' }, { id: 'TXD', t: 'sig', side: 'r' }, { id: 'RXD', t: 'sig', side: 'r' }],
    sch: { x: 40, y: 960 }
  },
  {
    id: 'estop', name: 'Paro de emergencia', cat: 'potencia', on: false, need: true, mass: 38,
    short: 'Pulsador tipo hongo que corta la potencia de los motores',
    desc: 'Corta físicamente la alimentación del L298N sin depender del software (ISO 13850). La Raspberry Pi y la ESP32 siguen encendidas y un contacto auxiliar avisa a la ESP32 en GPIO 5 para registrar el evento.',
    specs: [['Tipo', 'Pulsador de hongo con enclavamiento'], ['Contactos', 'NC de potencia + NC auxiliar'], ['Corriente', '≥ 5 A'], ['Ubicación', 'Parte trasera, accesible desde ambos lados']],
    pins: [{ id: 'IN', t: 'pwr', side: 'l' }, { id: 'OUT', t: 'pwr', side: 'r' }, { id: 'AUX', t: 'sig', side: 'r' }],
    sch: { x: 330, y: 40 }
  }
];

/* Conexiones. requires: piezas que deben estar montadas. unless: si esa pieza está montada, la conexión se reemplaza.
   Formato de extremo: 'pieza.pin' */
UGV.WIRES = [
  { a: 'battery.BAT+', b: 'l298n.12V', unless: ['switch', 'estop'] },
  { a: 'battery.BAT+', b: 'switch.IN' }, { a: 'switch.OUT', b: 'l298n.12V', unless: 'estop' },
  { a: 'battery.BAT+', b: 'estop.IN', unless: 'switch' }, { a: 'switch.OUT', b: 'estop.IN' }, { a: 'estop.OUT', b: 'l298n.12V' },
  { a: 'estop.AUX', b: 'esp32.D5', sig: 'ESTOP' },
  { a: 'battery.BAT-', b: 'l298n.GND' },
  { a: 'l298n.GND', b: 'esp32.GND' },
  { a: 'l298n.5V', b: 'esp32.VIN' },
  { a: 'esp32.D14', b: 'l298n.ENA', sig: 'ENA' }, { a: 'esp32.D27', b: 'l298n.IN1', sig: 'IN1' },
  { a: 'esp32.D26', b: 'l298n.IN2', sig: 'IN2' }, { a: 'esp32.D25', b: 'l298n.IN3', sig: 'IN3' },
  { a: 'esp32.D33', b: 'l298n.IN4', sig: 'IN4' }, { a: 'esp32.D32', b: 'l298n.ENB', sig: 'ENB' },
  { a: 'l298n.OUT1', b: 'motorA.M+', sig: 'MA' }, { a: 'l298n.OUT2', b: 'motorA.M-', sig: 'MA' },
  { a: 'l298n.OUT3', b: 'motorB.M+', sig: 'MB' }, { a: 'l298n.OUT4', b: 'motorB.M-', sig: 'MB' },
  { a: 'battery.BAT+', b: 'buck.IN+', unless: 'switch' }, { a: 'switch.OUT', b: 'buck.IN+' },
  { a: 'battery.BAT-', b: 'buck.IN-' },
  { a: 'buck.OUT+', b: 'rpi.5V' }, { a: 'buck.OUT-', b: 'rpi.GND' },
  { a: 'cam.CSI', b: 'rpi.CSI', sig: 'CAM' },
  { a: 'rpi.TX', b: 'esp32.RX2', sig: 'UART' }, { a: 'esp32.TX2', b: 'rpi.RX', sig: 'UART' }, { a: 'rpi.GND', b: 'esp32.GND' },
  { a: 'gnss.USB', b: 'rpi.USB', sig: 'GNSS' },
  { a: 'esp32.3V3', b: 'lora.VCC', unless: 'buck' }, { a: 'buck.OUT+', b: 'lora.VCC' }, { a: 'esp32.GND', b: 'lora.GND' },
  { a: 'lora.TXD', b: 'esp32.D18', sig: 'LORA' }, { a: 'esp32.D19', b: 'lora.RXD', sig: 'LORA' },
  { a: 'esp32.3V3', b: 'imu.VCC' }, { a: 'esp32.GND', b: 'imu.GND' },
  { a: 'esp32.D21', b: 'imu.SDA', sig: 'I2C' }, { a: 'esp32.D22', b: 'imu.SCL', sig: 'I2C' },
  { a: 'l298n.5V', b: 'sonar.VCC' }, { a: 'esp32.GND', b: 'sonar.GND' },
  { a: 'esp32.D23', b: 'sonar.TRIG', sig: 'TRIG' },
  { a: 'sonar.ECHO', b: 'esp32.D13', unless: 'divider', sig: 'ECHO' },
  { a: 'sonar.ECHO', b: 'divider.IN', sig: 'ECHO' }, { a: 'divider.OUT', b: 'esp32.D13', sig: 'ECHO' }, { a: 'divider.GND', b: 'esp32.GND' },
  { a: 'esp32.D2', b: 'leds.A', sig: 'LUCES' }, { a: 'leds.K', b: 'esp32.GND' },
  { a: 'esp32.D4', b: 'buzzer.+', sig: 'BOCINA' }, { a: 'buzzer.-', b: 'esp32.GND' },
  { a: 'enc.A1', b: 'esp32.D34', sig: 'ENC' }, { a: 'enc.B1', b: 'esp32.D35', sig: 'ENC' },
  { a: 'enc.A2', b: 'esp32.VP', sig: 'ENC' }, { a: 'enc.B2', b: 'esp32.VN', sig: 'ENC' },
  { a: 'esp32.3V3', b: 'enc.VCC' }, { a: 'esp32.GND', b: 'enc.GND' }
];

UGV.PIN_FUNC = {
  'esp32.D14': 'PWM del motor A (ENA)', 'esp32.D27': 'Sentido motor A (IN1)', 'esp32.D26': 'Sentido motor A (IN2)',
  'esp32.D25': 'Sentido motor B (IN3)', 'esp32.D33': 'Sentido motor B (IN4)', 'esp32.D32': 'PWM del motor B (ENB)',
  'esp32.D21': 'I2C SDA (IMU)', 'esp32.D22': 'I2C SCL (IMU)', 'esp32.D23': 'TRIG del ultrasónico', 'esp32.D13': 'ECHO del ultrasónico (con divisor)',
  'esp32.D5': 'Contacto auxiliar del paro de emergencia', 'esp32.D18': 'UART1 RX ← radio LoRa', 'esp32.D19': 'UART1 TX → radio LoRa',
  'esp32.RX2': 'UART2 RX (GPIO 16) ← Raspberry Pi', 'esp32.TX2': 'UART2 TX (GPIO 17) → Raspberry Pi',
  'rpi.TX': 'GPIO 14 · TXD → ESP32', 'rpi.RX': 'GPIO 15 · RXD ← ESP32', 'rpi.USB': 'Receptor GNSS por adaptador USB-serie',
  'esp32.D2': 'Luces (también LED azul de la placa)', 'esp32.D4': 'Bocina', 'esp32.D34': 'Encoder A motor izq. (solo entrada)',
  'esp32.D35': 'Encoder B motor izq. (solo entrada)', 'esp32.VP': 'GPIO 36 · encoder A motor der.', 'esp32.VN': 'GPIO 39 · encoder B motor der.',
  'esp32.VIN': 'Entrada de 5 V', 'esp32.3V3': 'Salida de 3,3 V del regulador de la placa', 'l298n.5V': 'Salida del regulador 78M05 (con jumper)',
  'l298n.12V': 'Entrada de potencia (7,4 V con 2 celdas · 11,1 V con 3)', 'battery.BAT+': '7,4 V nominal (2 × 3,7 V) · 11,1 V con 3 celdas'
};

UGV.part = id => UGV.PARTS.find(p => p.id === id);
