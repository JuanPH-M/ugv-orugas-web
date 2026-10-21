/* Genera el firmware de la ESP32 (Arduino-ESP32 3.x) a partir del cableado actual */
(function () {
'use strict';
const GPIO = { VP: 36, VN: 39, RX2: 16, TX2: 17 };
const num = pin => GPIO[pin] !== undefined ? GPIO[pin] : +pin.replace('D', '');

UGV.genCode = function () {
  const an = UGV.analyze(7.4);
  const espFor = key => { // pin de la ESP32 conectado a esa red
    if (!UGV.isOn('esp32')) return null;
    const r = an.net(key), g = an.groups[r] || [];
    const e = g.find(k => k.startsWith('esp32.') && UGV.pinInfo(k) && UGV.pinInfo(k).gpio);
    if (e) return num(e.split('.')[1]);
    if (key === 'sonar.ECHO' && UGV.isOn('divider')) return espFor('divider.OUT');
    return null;
  };
  const pins = { ENA: espFor('l298n.ENA'), IN1: espFor('l298n.IN1'), IN2: espFor('l298n.IN2'), IN3: espFor('l298n.IN3'), IN4: espFor('l298n.IN4'), ENB: espFor('l298n.ENB') };
  const has = id => UGV.isOn(id);
  const trig = has('sonar') ? espFor('sonar.TRIG') : null, echo = has('sonar') ? espFor('sonar.ECHO') : null;
  const led = has('leds') ? espFor('leds.A') : null, buz = has('buzzer') ? espFor('buzzer.+') : null;
  const sda = has('imu') ? espFor('imu.SDA') : null, scl = has('imu') ? espFor('imu.SCL') : null;
  const e = has('enc') ? { A1: espFor('enc.A1'), B1: espFor('enc.B1'), A2: espFor('enc.A2'), B2: espFor('enc.B2') } : null;
  const piRx = has('rpi') ? espFor('rpi.TX') : null, piTx = has('rpi') ? espFor('rpi.RX') : null;   // RX de la ESP32 ← TX de la Pi
  const loRx = has('lora') ? espFor('lora.TXD') : null, loTx = has('lora') ? espFor('lora.RXD') : null;
  const stopPin = has('estop') ? espFor('estop.AUX') : null;
  const pi = piRx !== null && piTx !== null, lora = loRx !== null && loTx !== null, sonar = trig !== null && echo !== null, enc = e && Object.values(e).every(v => v !== null);
  const P = v => v === null || v === undefined ? '-1 /* SIN CONECTAR */' : v;
  const L = [];
  const add = (...l) => L.push(...l);
  add('// Firmware del UGV de orugas · ESP32 DevKit + L298N',
    '// Generado desde el gemelo digital con el cableado actual (' + new Date().toLocaleDateString('es-CO') + ').',
    '// Placa: "ESP32 Dev Module" · Núcleo Arduino-ESP32 3.x',
    '//',
    '// Capa de tiempo real: lazo de las orugas, sensores rápidos y seguridad.',
    '// La Raspberry Pi (unidad central) manda las velocidades por UART2 con tramas',
    '// 0xAA 0x55 | tipo | secuencia | longitud | datos | CRC-16/CCITT (informe, anexo B).',
    '// Si deja de recibir órdenes durante 300 ms, la ESP32 frena los motores.',
    '');
  add('#include <WiFi.h>', '#include <WebServer.h>'); if (sda !== null) add('#include <Wire.h>'); add('');
  add('// ---------- Pines (según el circuito) ----------');
  Object.entries(pins).forEach(([k, v]) => add(`const int PIN_${k} = ${P(v)};`));
  if (sonar || has('sonar')) { add(`const int PIN_TRIG = ${P(trig)};`); add(`const int PIN_ECHO = ${P(echo)};${UGV.isOn('divider') ? '  // con divisor 1k/2k' : '  // ¡ECHO es de 5 V! Usa un divisor 1k/2k'}`); }
  if (led !== null) add(`const int PIN_LUCES = ${P(led)};`);
  if (buz !== null) add(`const int PIN_BOCINA = ${P(buz)};`);
  if (sda !== null) { add(`const int PIN_SDA = ${P(sda)};`); add(`const int PIN_SCL = ${P(scl)};`); }
  if (e) Object.entries(e).forEach(([k, v]) => add(`const int PIN_ENC_${k} = ${P(v)};`));
  if (pi) { add(`const int PIN_PI_RX = ${piRx};   // UART2 RX ← GPIO 14 (TXD) de la Raspberry Pi`); add(`const int PIN_PI_TX = ${piTx};   // UART2 TX → GPIO 15 (RXD) de la Raspberry Pi`); }
  if (lora) { add(`const int PIN_LORA_RX = ${loRx}; // UART1 RX ← TXD de la radio E220`); add(`const int PIN_LORA_TX = ${loTx}; // UART1 TX → RXD de la radio E220`); }
  if (stopPin !== null) add(`const int PIN_PARO = ${stopPin};     // contacto auxiliar NC del paro de emergencia (LOW = liberado)`);
  add('');
  add('const char* SSID = "UGV-Orugas";', 'const char* CLAVE = "orugas2026";   // cámbiala', 'const int PWM_FREQ = 20000, PWM_BITS = 8;',
    'const unsigned long WATCHDOG_MS = 300;   // sin órdenes válidas → frenar');
  if (sonar) add('const float DIST_LENTO_CM = 150.0, DIST_FRENO_CM = 60.0;');
  add('const float V_MAX_MM_S = 570.0;          // velocidad de las orugas a PWM 255 con 3 celdas (calibrar)');
  if (enc) add('const float TICKS_POR_MM = 0.35;         // pulsos de encoder por mm de oruga (calibrar en el banco)');
  add('');
  add('WebServer server(80);');
  if (pi) add('HardwareSerial PiSerial(2);');
  if (lora) add('HardwareSerial Radio(1);');
  add('unsigned long tPi = 0, tRadio = 0, tWeb = 0;', 'int refPiL = 0, refPiR = 0, refRadioL = 0, refRadioR = 0, refWebL = 0, refWebR = 0;   // en mm/s o PWM', 'bool paro = false;', 'uint8_t secTx = 0;');
  if (enc) add('volatile long pulsosA = 0, pulsosB = 0;', 'void IRAM_ATTR isrA() { pulsosA += digitalRead(PIN_ENC_B1) ? 1 : -1; }', 'void IRAM_ATTR isrB() { pulsosB += digitalRead(PIN_ENC_B2) ? 1 : -1; }');
  add('');
  add('// ---------- Motores ----------', '// velocidad de -255 a 255 para cada oruga', 'void motor(int en, int a, int b, int vel) {', '  vel = constrain(vel, -255, 255);',
    '  digitalWrite(a, vel > 0); digitalWrite(b, vel < 0);', '  ledcWrite(en, abs(vel));', '}',
    'void mover(int izq, int der) { motor(PIN_ENA, PIN_IN1, PIN_IN2, izq); motor(PIN_ENB, PIN_IN3, PIN_IN4, der); }',
    'int aPwm(float mm_s) { return constrain((int)(mm_s / V_MAX_MM_S * 255.0f), -255, 255); }');
  if (sonar) add('', 'float distanciaCm() {', '  digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);', '  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(20); digitalWrite(PIN_TRIG, LOW);',
    '  unsigned long t = pulseIn(PIN_ECHO, HIGH, 30000);', '  float d = t ? t * 0.0343f / 2.0f : 999.0f;', '  return d < 25.0f ? 25.0f : d;   // zona ciega del JSN-SR04T', '}');
  if (pi) {
    add('', '// ---------- Tramas con la Raspberry Pi (anexo B del informe) ----------',
      'enum : uint8_t { VEL_CMD = 0x01, MODE = 0x02, STOP_CMD = 0x03, ODOM = 0x10, IMU_MSG = 0x11, RANGE = 0x12, POWER = 0x13, STATUS = 0x14, RADIO_RX = 0x15 };',
      'uint16_t crc16(const uint8_t* d, size_t n) {   // CRC-16/CCITT-FALSE',
      '  uint16_t c = 0xFFFF;', '  for (size_t i = 0; i < n; i++) { c ^= (uint16_t)d[i] << 8; for (int b = 0; b < 8; b++) c = (c & 0x8000) ? (c << 1) ^ 0x1021 : c << 1; }', '  return c;', '}',
      'void enviar(uint8_t tipo, const uint8_t* datos, uint8_t n) {',
      '  uint8_t buf[72]; buf[0] = 0xAA; buf[1] = 0x55; buf[2] = tipo; buf[3] = secTx++; buf[4] = n;',
      '  memcpy(buf + 5, datos, n); uint16_t c = crc16(buf + 2, n + 3); buf[5 + n] = c & 0xFF; buf[6 + n] = c >> 8;',
      '  PiSerial.write(buf, n + 7);', '}',
      'void recibirPi() {   // máquina de estados del analizador de tramas',
      '  static uint8_t b[72]; static int k = 0;',
      '  while (PiSerial.available()) {',
      '    uint8_t c = PiSerial.read();',
      '    if (k == 0 && c != 0xAA) continue; if (k == 1 && c != 0x55) { k = 0; continue; }',
      '    b[k++] = c;',
      '    if (k >= 5 && (b[4] > 64)) { k = 0; continue; }',
      '    if (k >= 5 && k == b[4] + 7) {',
      '      uint16_t c2 = b[k - 2] | (b[k - 1] << 8);',
      '      if (c2 == crc16(b + 2, b[4] + 3)) {',
      '        if (b[2] == VEL_CMD && b[4] == 4) { refPiL = (int16_t)(b[5] | b[6] << 8); refPiR = (int16_t)(b[7] | b[8] << 8); tPi = millis(); }',
      '        if (b[2] == STOP_CMD) { refPiL = refPiR = 0; tPi = 0; mover(0, 0); }',
      '      }',
      '      k = 0;', '    }', '  }', '}');
  }
  if (lora) add('', '// ---------- Radio LoRa del operador (texto: "J,x,y" mando · "H" latido · "S" parar · "M,..." misión) ----------',
    'void recibirRadio() {', '  static String linea;', '  while (Radio.available()) {', '    char c = Radio.read();', '    if (c != \'\\n\') { if (linea.length() < 60) linea += c; continue; }', '    linea.trim();',
    '    if (linea.startsWith("S")) { refRadioL = refRadioR = 0; tRadio = 0; refPiL = refPiR = 0; mover(0, 0); }   // la parada llega a la capa de tiempo real',
    '    else if (linea.startsWith("J,")) { int x = linea.substring(2).toInt(), y = linea.substring(linea.lastIndexOf(\',\') + 1).toInt();',
    '      float l = y + x, r = y - x, m = max(100.0f, max(fabsf(l), fabsf(r))); refRadioL = l / m * 255; refRadioR = r / m * 255; tRadio = millis(); }',
    pi ? '    { uint8_t n = min((int)linea.length(), 60); enviar(RADIO_RX, (const uint8_t*)linea.c_str(), n); }   // latidos y órdenes de misión → Raspberry Pi' : '',
    '    linea = "";', '  }', '}');
  add('', '// ---------- App WiFi de respaldo: /mover?x=-100..100&y=-100..100&max=0..100 ----------', 'void handleMover() {',
    '  int x = server.arg("x").toInt(), y = server.arg("y").toInt(), mx = server.hasArg("max") ? server.arg("max").toInt() : 100;',
    '  float l = y + x, r = y - x, m = max(100.0f, max(fabsf(l), fabsf(r)));', '  refWebL = l / m * 255 * mx / 100; refWebR = r / m * 255 * mx / 100; tWeb = millis();',
    '  server.send(200, "text/plain", "ok");', '}');
  add('', 'void setup() {', '  Serial.begin(115200);',
    '  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT); pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);',
    '  ledcAttach(PIN_ENA, PWM_FREQ, PWM_BITS); ledcAttach(PIN_ENB, PWM_FREQ, PWM_BITS);');
  if (sonar) add('  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT);');
  if (led !== null) add('  pinMode(PIN_LUCES, OUTPUT);');
  if (buz !== null) add('  pinMode(PIN_BOCINA, OUTPUT);');
  if (stopPin !== null) add('  pinMode(PIN_PARO, INPUT_PULLUP);');
  if (sda !== null) add('  Wire.begin(PIN_SDA, PIN_SCL);  // IMU en 0x68');
  if (enc) add('  pinMode(PIN_ENC_A1, INPUT); pinMode(PIN_ENC_B1, INPUT); pinMode(PIN_ENC_A2, INPUT); pinMode(PIN_ENC_B2, INPUT);', '  attachInterrupt(PIN_ENC_A1, isrA, RISING); attachInterrupt(PIN_ENC_A2, isrB, RISING);');
  if (pi) add('  PiSerial.begin(115200, SERIAL_8N1, PIN_PI_RX, PIN_PI_TX);');
  if (lora) add('  Radio.begin(9600, SERIAL_8N1, PIN_LORA_RX, PIN_LORA_TX);   // velocidad de fábrica de la E220');
  add('  mover(0, 0);', '  WiFi.softAP(SSID, CLAVE);  // IP por defecto: 192.168.4.1', '  server.on("/mover", handleMover);',
    '  server.on("/parar", []() { refWebL = refWebR = 0; tWeb = 0; mover(0, 0); server.send(200, "text/plain", "ok"); });');
  if (led !== null) add('  server.on("/luces", []() { digitalWrite(PIN_LUCES, server.arg("on") == "1"); server.send(200, "text/plain", "ok"); });');
  if (buz !== null) add('  server.on("/bocina", []() { digitalWrite(PIN_BOCINA, server.arg("on") == "1"); server.send(200, "text/plain", "ok"); });');
  add('  server.begin();', '  Serial.println("Listo: UART2 con la Raspberry Pi, radio LoRa y app de respaldo en http://192.168.4.1");', '}');
  add('', 'void loop() {', '  server.handleClient();');
  if (pi) add('  recibirPi();'); if (lora) add('  recibirRadio();');
  add('  static unsigned long t10 = 0; if (millis() - t10 < 10) return; t10 = millis();   // ciclo de 100 Hz', '  static uint8_t n = 0; n++;');
  if (stopPin !== null) add('  paro = digitalRead(PIN_PARO) == HIGH;   // contacto abierto = paro pulsado');
  add('  unsigned long ahora = millis(); int izq = 0, der = 0;',
    pi ? '  if (ahora - tPi < WATCHDOG_MS) { izq = aPwm(refPiL); der = aPwm(refPiR); }           // misión de la Raspberry Pi' : '  // sin Raspberry Pi conectada: solo radio o app WiFi',
    lora ? (pi ? '  else ' : '  ') + 'if (ahora - tRadio < 500) { izq = refRadioL; der = refRadioR; }                    // mando por radio' : '',
    '  ' + (pi || lora ? 'else ' : '') + 'if (ahora - tWeb < 500) { izq = refWebL; der = refWebR; }                       // app de respaldo');
  if (sonar) add('  static float d = 999.0f; if (n % 5 == 0) d = distanciaCm();   // ultrasonido a 20 Hz (pulseIn bloquea hasta 30 ms)','  if (izq + der > 0) {   // obstáculo al frente: reduce a < 150 cm y frena a < 60 cm',
    '    if (d < DIST_FRENO_CM) { int f = (izq + der) / 2; izq -= f; der -= f; }',
    '    else if (d < DIST_LENTO_CM) { float s = 0.35f + 0.65f * (d - DIST_FRENO_CM) / (DIST_LENTO_CM - DIST_FRENO_CM); izq *= s; der *= s; }', '  }');
  if (stopPin !== null) add('  if (paro) { izq = der = 0; }');
  add('  mover(izq, der);');
  if (pi) {
    if (enc) add('  if (n % 2 == 0) {   // odometría a 50 Hz', '    noInterrupts(); long a = pulsosA, b = pulsosB; interrupts();',
      '    uint8_t o[10]; memcpy(o, &a, 4); memcpy(o + 4, &b, 4); uint16_t dt = 20; memcpy(o + 8, &dt, 2); enviar(ODOM, o, 10);', '  }');
    if (sonar) add('  if (n % 10 == 0) { uint16_t mm = (uint16_t)(d * 10); enviar(RANGE, (uint8_t*)&mm, 2); }');
    add('  if (n % 20 == 0) { uint8_t f = (paro ? 1 : 0) | ((ahora - tPi < WATCHDOG_MS) ? 2 : 0)' + (lora ? ' | ((ahora - tRadio < 1000) ? 4 : 0)' : '') + '; enviar(STATUS, &f, 1); }');
  }
  add('}');
  const missing = Object.entries(pins).filter(([, v]) => v === null).map(([k]) => k);
  if (has('rpi') && !pi) missing.push('UART con la Raspberry Pi');
  return { code: L.filter(x => x !== '').join('\n').replace(/\n(\/\/ -{10})/g, '\n\n$1').replace(/\n(void |uint16_t crc16|enum |int aPwm)/g, '\n$1'), missing };
};
})();
