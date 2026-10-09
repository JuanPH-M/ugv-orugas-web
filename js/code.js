/* Genera un sketch de Arduino para la ESP32 a partir del cableado actual */
(function () {
'use strict';
const GPIO = { VP: 36, VN: 39 };
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
  const P = v => v === null || v === undefined ? '-1 /* SIN CONECTAR */' : v;
  const L = [];
  L.push('// Firmware base del UGV de orugas · ESP32 DevKit + L298N');
  L.push('// Generado desde el gemelo digital con el cableado actual (' + new Date().toLocaleDateString('es-CO') + ').');
  L.push('// Placa: "ESP32 Dev Module" · Núcleo Arduino-ESP32 3.x');
  L.push('// La app de control se sirve en http://192.168.4.1 (red WiFi del robot).');
  L.push('');
  L.push('#include <WiFi.h>');
  L.push('#include <WebServer.h>');
  if (sda !== null) L.push('#include <Wire.h>');
  L.push('');
  L.push('// ---------- Pines (según el circuito) ----------');
  Object.entries(pins).forEach(([k, v]) => L.push(`const int PIN_${k} = ${P(v)};`));
  if (trig !== null || echo !== null) { L.push(`const int PIN_TRIG = ${P(trig)};`); L.push(`const int PIN_ECHO = ${P(echo)};${UGV.isOn('divider') ? '' : '  // ¡ECHO es de 5 V! Usa un divisor 1k/2k'}`); }
  if (led !== null) L.push(`const int PIN_LUCES = ${P(led)};`);
  if (buz !== null) L.push(`const int PIN_BOCINA = ${P(buz)};`);
  if (sda !== null) { L.push(`const int PIN_SDA = ${P(sda)};`); L.push(`const int PIN_SCL = ${P(scl)};`); }
  if (e) Object.entries(e).forEach(([k, v]) => L.push(`const int PIN_ENC_${k} = ${P(v)};`));
  L.push('');
  L.push('const char* SSID = "UGV-Orugas";');
  L.push('const char* CLAVE = "orugas2025";   // cámbiala');
  L.push('const int PWM_FREQ = 20000, PWM_BITS = 8;');
  if (trig !== null) L.push('const float DIST_FRENO_CM = 20.0;');
  L.push('');
  L.push('WebServer server(80);');
  L.push('unsigned long ultimoComando = 0;');
  if (e) { L.push('volatile long pulsosA = 0, pulsosB = 0;'); L.push('void IRAM_ATTR isrA() { pulsosA += digitalRead(PIN_ENC_B1) ? 1 : -1; }'); L.push('void IRAM_ATTR isrB() { pulsosB += digitalRead(PIN_ENC_B2) ? 1 : -1; }'); }
  L.push('');
  L.push('// velocidad de -255 a 255 para cada oruga');
  L.push('void motor(int en, int a, int b, int vel) {');
  L.push('  vel = constrain(vel, -255, 255);');
  L.push('  digitalWrite(a, vel > 0); digitalWrite(b, vel < 0);');
  L.push('  ledcWrite(en, abs(vel));');
  L.push('}');
  L.push('void mover(int izq, int der) { motor(PIN_ENA, PIN_IN1, PIN_IN2, izq); motor(PIN_ENB, PIN_IN3, PIN_IN4, der); }');
  if (trig !== null) {
    L.push('');
    L.push('float distanciaCm() {');
    L.push('  digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);');
    L.push('  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10); digitalWrite(PIN_TRIG, LOW);');
    L.push('  unsigned long t = pulseIn(PIN_ECHO, HIGH, 25000);');
    L.push('  return t ? t * 0.0343 / 2.0 : 999;');
    L.push('}');
  }
  L.push('');
  L.push('// /mover?x=-100..100&y=-100..100&max=0..100  (joystick de la app)');
  L.push('void handleMover() {');
  L.push('  int x = server.arg("x").toInt(), y = server.arg("y").toInt(), mx = server.hasArg("max") ? server.arg("max").toInt() : 100;');
  L.push('  float l = y + x, r = y - x, m = max(100.0f, max(fabsf(l), fabsf(r)));');
  L.push('  int izq = l / m * 255 * mx / 100, der = r / m * 255 * mx / 100;');
  if (trig !== null) L.push('  if (izq + der > 0 && distanciaCm() < DIST_FRENO_CM) { izq = der = 0; }  // freno automático');
  L.push('  mover(izq, der); ultimoComando = millis();');
  L.push('  server.send(200, "text/plain", "ok");');
  L.push('}');
  L.push('');
  L.push('void setup() {');
  L.push('  Serial.begin(115200);');
  L.push('  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT); pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);');
  L.push('  ledcAttach(PIN_ENA, PWM_FREQ, PWM_BITS); ledcAttach(PIN_ENB, PWM_FREQ, PWM_BITS);');
  if (trig !== null) L.push('  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT);');
  if (led !== null) L.push('  pinMode(PIN_LUCES, OUTPUT);');
  if (buz !== null) L.push('  pinMode(PIN_BOCINA, OUTPUT);');
  if (sda !== null) L.push('  Wire.begin(PIN_SDA, PIN_SCL);  // MPU-6050 en 0x68');
  if (e) { L.push('  pinMode(PIN_ENC_A1, INPUT); pinMode(PIN_ENC_B1, INPUT); pinMode(PIN_ENC_A2, INPUT); pinMode(PIN_ENC_B2, INPUT);'); L.push('  attachInterrupt(PIN_ENC_A1, isrA, RISING); attachInterrupt(PIN_ENC_A2, isrB, RISING);'); }
  L.push('  mover(0, 0);');
  L.push('  WiFi.softAP(SSID, CLAVE);  // IP por defecto: 192.168.4.1');
  L.push('  server.on("/mover", handleMover);');
  L.push('  server.on("/parar", []() { mover(0, 0); server.send(200, "text/plain", "ok"); });');
  if (led !== null) L.push('  server.on("/luces", []() { digitalWrite(PIN_LUCES, server.arg("on") == "1"); server.send(200, "text/plain", "ok"); });');
  if (buz !== null) L.push('  server.on("/bocina", []() { digitalWrite(PIN_BOCINA, server.arg("on") == "1"); server.send(200, "text/plain", "ok"); });');
  L.push('  server.begin();');
  L.push('  Serial.println("Listo en http://192.168.4.1");');
  L.push('}');
  L.push('');
  L.push('void loop() {');
  L.push('  server.handleClient();');
  L.push('  if (millis() - ultimoComando > 500) mover(0, 0);  // seguridad: sin comandos, se detiene');
  L.push('}');
  const missing = Object.entries(pins).filter(([, v]) => v === null).map(([k]) => k);
  return { code: L.join('\n'), missing };
};
})();
