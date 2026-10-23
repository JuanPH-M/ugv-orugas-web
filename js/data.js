/* Datos del robot: piezas, pines y conexiones del diseño final (la Raspberry Pi controla directamente el L298N).
   Unidades: cm para 3D, g para masa, V y A para electricidad.
   Lo marcado como "estimado" sale de fotos o fichas genéricas y debe verificarse con el prototipo. */
window.UGV = window.UGV || {};

UGV.CATS = {
  estructura: 'Estructura',
  potencia: 'Potencia',
  control: 'Control',
  actuador: 'Actuador'
};

/* Tipos de pin: pwr (alimentación), gnd, sig (señal digital/PWM), mot (salida a motor) */
UGV.PARTS = [
  {
    id: 'chassis', name: 'Chasis de orugas', cat: 'estructura', on: true, core: true, mass: 292,
    short: 'Base de aluminio de 2 mm, 2 orugas plásticas, 2 ruedas dentadas y 2 lisas',
    desc: 'Estructura del prototipo. La base de aluminio pintado sostiene la electrónica y la plataforma para la carga de prueba (hasta 2 kg); cada oruga tiene una rueda dentada de tracción unida al motor y una rueda lisa de giro libre.',
    specs: [['Dimensiones', '180 × 165 × 60 mm'], ['Peso del kit', '482 g (con motores)'], ['Base', 'Aluminio de 2 mm, pintado'], ['Rodaje', 'Orugas y ruedas plásticas'], ['Ancho de vía', '≈ 125 mm entre centros de oruga (estimado)'], ['Rueda dentada', '≈ 52 mm de diámetro (estimado; medir)']],
    pins: [], sch: null
  },
  {
    id: 'motorA', name: 'Motor A · izquierdo', cat: 'actuador', on: true, core: true, mass: 95,
    short: 'Motorreductor DC de 9–12 V, 3,5 kg·cm',
    desc: 'Mueve la oruga izquierda. Se conecta a OUT1 y OUT2 del L298N. Solo tiene dos terminales: no trae encoder, por eso el prototipo trabaja en lazo abierto.',
    specs: [['Tensión', '9–12 V'], ['Velocidad', '170–350 RPM'], ['Torque', '3,5 kg·cm'], ['Consumo sin carga', '100 mA'], ['Encoder', 'No']],
    pins: [{ id: 'M+', t: 'mot', side: 'l' }, { id: 'M-', t: 'mot', side: 'l' }],
    sch: { x: 1220, y: 40 }
  },
  {
    id: 'motorB', name: 'Motor B · derecho', cat: 'actuador', on: true, core: true, mass: 95,
    short: 'Motorreductor DC de 9–12 V, 3,5 kg·cm',
    desc: 'Mueve la oruga derecha. Se conecta a OUT3 y OUT4 del L298N. Solo tiene dos terminales: no trae encoder.',
    specs: [['Tensión', '9–12 V'], ['Velocidad', '170–350 RPM'], ['Torque', '3,5 kg·cm'], ['Consumo sin carga', '100 mA'], ['Encoder', 'No']],
    pins: [{ id: 'M+', t: 'mot', side: 'l' }, { id: 'M-', t: 'mot', side: 'l' }],
    sch: { x: 1220, y: 250 }
  },
  {
    id: 'battery', name: 'Baterías 2 × 3,7 V', cat: 'potencia', on: true, core: true, mass: 115,
    short: '2 celdas Li-ion 18650 en serie = 7,4 V nominal',
    desc: 'Dos celdas de ion-litio de 3,7 V nominales en un portapilas en serie. Alimentan la entrada de 12 V del L298N y la entrada del convertidor DC-DC. Desconectarlas es el corte total del prototipo.',
    specs: [['Celdas', '2 × 18650 ion-litio (referencia exacta: por registrar)'], ['Tensión por celda', '3,7 V nominal · 4,2 V llena · ≈ 3,0 V descargada'], ['Pack en serie', '7,4 V nominal · 8,4 V lleno'], ['Capacidad', '≈ 2600 mAh (supuesto de la simulación; verificar)'], ['Masa', '2 × 46 g + portapilas']],
    pins: [{ id: 'BAT+', t: 'pwr', side: 'r', v: 7.4 }, { id: 'BAT-', t: 'gnd', side: 'r', v: 0 }],
    sch: { x: 40, y: 40 }
  },
  {
    id: 'l298n', name: 'Puente H L298N', cat: 'potencia', on: true, core: true, mass: 30,
    short: 'Doble puente H; entradas lógicas compatibles con 3,3 V',
    desc: 'Recibe de la Raspberry Pi la PWM (ENA y ENB) y el sentido de giro (IN1 a IN4) y entrega la potencia de las baterías a los dos motores. Sus entradas reconocen los 3,3 V de la Raspberry Pi como nivel alto, así que no hace falta adaptador de niveles. Su salida de 5 V no se usa. Hay que quitar los puentes de ENA y ENB del módulo.',
    specs: [['Chip', 'L298 (STMicroelectronics)'], ['Canales', '2 puentes H completos'], ['Alimentación de potencia', 'hasta 46 V (se usan 7,4 V)'], ['Entradas', 'Nivel TTL: 3,3 V se reconoce como alto'], ['Caída interna', 'parte de la tensión se pierde en los transistores y se vuelve calor'], ['Salida de 5 V', 'No se usa en el diseño final']],
    pins: [
      { id: '12V', t: 'pwr', side: 'l' }, { id: 'GND', t: 'gnd', side: 'l' }, { id: '5V', t: 'pwr', side: 'l', v: 5.0 },
      { id: 'ENA', t: 'sig', side: 'l' }, { id: 'IN1', t: 'sig', side: 'l' }, { id: 'IN2', t: 'sig', side: 'l' },
      { id: 'IN3', t: 'sig', side: 'l' }, { id: 'IN4', t: 'sig', side: 'l' }, { id: 'ENB', t: 'sig', side: 'l' },
      { id: 'OUT1', t: 'mot', side: 'r' }, { id: 'OUT2', t: 'mot', side: 'r' }, { id: 'OUT3', t: 'mot', side: 'r' }, { id: 'OUT4', t: 'mot', side: 'r' }
    ],
    sch: { x: 920, y: 40 }
  },
  {
    id: 'rpi', name: 'Raspberry Pi 3 Model B', cat: 'control', on: true, core: true, mass: 42,
    short: 'Controlador único · 4 núcleos 1,2 GHz · 1 GB RAM · Wi-Fi',
    desc: 'Único controlador del prototipo. Un programa en Python sirve la página de control por su red Wi-Fi, guarda y ejecuta los recorridos programados, genera la PWM por hardware en GPIO 12 y GPIO 13, fija el sentido de giro en GPIO 17, 27, 22 y 23, y detiene los motores si deja de recibir órdenes del celular.',
    specs: [['Procesador', '4 núcleos a 1,2 GHz'], ['Memoria', '1 GB'], ['Red', 'Wi-Fi integrado (punto de acceso del vehículo)'], ['GPIO', '3,3 V; no toleran 5 V'], ['PWM por hardware', 'GPIO 12 (PWM0) y GPIO 13 (PWM1)'], ['Alimentación', '5 V por el pin 2, desde el DC-DC']],
    pins: [{ id: '5V', t: 'pwr', side: 'l' }, { id: 'GND', t: 'gnd', side: 'l' },
      { id: 'G12', t: 'sig', side: 'r', gpio: true }, { id: 'G17', t: 'sig', side: 'r', gpio: true }, { id: 'G27', t: 'sig', side: 'r', gpio: true },
      { id: 'G22', t: 'sig', side: 'r', gpio: true }, { id: 'G23', t: 'sig', side: 'r', gpio: true }, { id: 'G13', t: 'sig', side: 'r', gpio: true }],
    sch: { x: 620, y: 330 }
  },
  {
    id: 'buck', name: 'Convertidor DC-DC 5 V / 3 A', cat: 'potencia', on: true, core: true, mass: 15,
    short: 'Reductor (buck): 7,4 V → 5 V para la Raspberry Pi',
    desc: 'Baja los 7,4 V de las baterías a 5 V y alimenta la Raspberry Pi por el pin 2. Usar un convertidor dedicado evita que las caídas de tensión de los motores al arrancar reinicien la Raspberry Pi. Su entrada y su salida negativas son la misma tierra.',
    specs: [['Salida', '5 V'], ['Corriente máxima', '3 A (designación comercial)'], ['Referencia del módulo', 'por registrar']],
    pins: [{ id: 'IN+', t: 'pwr', side: 'l' }, { id: 'IN-', t: 'gnd', side: 'l' }, { id: 'OUT+', t: 'pwr', side: 'r', v: 5.0 }, { id: 'OUT-', t: 'gnd', side: 'r' }],
    sch: { x: 330, y: 230 }
  },
  {
    id: 'box', name: 'Caja de la electrónica', cat: 'estructura', on: true, core: true, mass: 25,
    short: 'Cubierta con aberturas de ventilación',
    desc: 'Cubre la Raspberry Pi y deja aberturas para su ventilación y la del L298N. En el simulador, “Ver interior” la vuelve transparente.',
    specs: [['Medidas', '≈ 95 × 85 × 70 mm (estimado)']],
    pins: [], sch: null
  },
  /* ---------- Recomendada para versiones futuras (no está en el diagrama final) ---------- */
  {
    id: 'switch', name: 'Interruptor general (trabajo futuro)', cat: 'potencia', on: false, need: true, mass: 4,
    short: 'Corta el positivo de las baterías sin depender del software',
    desc: 'No está en el diagrama final. El informe lo recomienda para versiones futuras: un interruptor o paro físico que corte la potencia aunque el programa de la Raspberry Pi se bloquee. Hoy el corte total es desconectar la batería.',
    specs: [['Tipo', 'Palanca o pulsador con enclavamiento'], ['Corriente', '≥ 3 A'], ['Estado', 'Recomendación del informe']],
    pins: [{ id: 'IN', t: 'pwr', side: 'l' }, { id: 'OUT', t: 'pwr', side: 'r' }],
    sch: { x: 40, y: 520 }
  }
];

/* Conexiones del diagrama final. unless: si esa pieza está montada, la conexión se reemplaza.
   Formato de extremo: 'pieza.pin' */
UGV.WIRES = [
  { a: 'battery.BAT+', b: 'l298n.12V', unless: 'switch' },
  { a: 'battery.BAT+', b: 'buck.IN+', unless: 'switch' },
  { a: 'battery.BAT+', b: 'switch.IN' }, { a: 'switch.OUT', b: 'l298n.12V' }, { a: 'switch.OUT', b: 'buck.IN+' },
  { a: 'battery.BAT-', b: 'l298n.GND' },
  { a: 'battery.BAT-', b: 'buck.IN-' },
  { a: 'buck.OUT+', b: 'rpi.5V' }, { a: 'buck.OUT-', b: 'rpi.GND' },
  { a: 'rpi.G12', b: 'l298n.ENA', sig: 'ENA' }, { a: 'rpi.G17', b: 'l298n.IN1', sig: 'IN1' },
  { a: 'rpi.G27', b: 'l298n.IN2', sig: 'IN2' }, { a: 'rpi.G22', b: 'l298n.IN3', sig: 'IN3' },
  { a: 'rpi.G23', b: 'l298n.IN4', sig: 'IN4' }, { a: 'rpi.G13', b: 'l298n.ENB', sig: 'ENB' },
  { a: 'l298n.OUT1', b: 'motorA.M+', sig: 'MA' }, { a: 'l298n.OUT2', b: 'motorA.M-', sig: 'MA' },
  { a: 'l298n.OUT3', b: 'motorB.M+', sig: 'MB' }, { a: 'l298n.OUT4', b: 'motorB.M-', sig: 'MB' }
];

/* Señales de control: pin de la Raspberry Pi, pin físico y entrada del L298N */
UGV.SIGNALS = [
  ['ENA', 'G12', 12, 32], ['IN1', 'G17', 17, 11], ['IN2', 'G27', 27, 13],
  ['IN3', 'G22', 22, 15], ['IN4', 'G23', 23, 16], ['ENB', 'G13', 13, 33]
];

UGV.PIN_FUNC = {
  'rpi.G12': 'GPIO 12 · pin 32 · PWM por hardware del motor A (ENA)', 'rpi.G17': 'GPIO 17 · pin 11 · sentido del motor A (IN1)',
  'rpi.G27': 'GPIO 27 · pin 13 · sentido del motor A (IN2)', 'rpi.G22': 'GPIO 22 · pin 15 · sentido del motor B (IN3)',
  'rpi.G23': 'GPIO 23 · pin 16 · sentido del motor B (IN4)', 'rpi.G13': 'GPIO 13 · pin 33 · PWM por hardware del motor B (ENB)',
  'rpi.5V': 'Pin 2 · entrada de 5 V desde el DC-DC', 'rpi.GND': 'Pin 6 · tierra común',
  'l298n.5V': 'Salida del regulador del módulo: no se usa en el diseño final', 'l298n.12V': 'Entrada de potencia (7,4 V de las baterías)',
  'battery.BAT+': '7,4 V nominal (2 × 3,7 V en serie)', 'buck.OUT+': 'Salida de 5 V hacia el pin 2 de la Raspberry Pi'
};

UGV.part = id => UGV.PARTS.find(p => p.id === id);
