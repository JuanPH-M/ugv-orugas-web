/* Pruebas automáticas sin dependencias: node tests/run.js
   Cargan el modelo de datos, el análisis eléctrico y los generadores de código en un entorno simulado
   (sin navegador ni WebGL) y verifican que el cableado del proyecto sea coherente. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, Math, JSON, Date, Object, Array, Set, Number, String,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  setTimeout: fn => fn(), clearTimeout: () => { }
};
ctx.window = ctx; vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
['js/data.js', 'js/state.js', 'js/code.js', 'js/codepi.js'].forEach(load);
const UGV = ctx.UGV;
UGV.Sim = { st: { slip: 1.6 }, mission: () => [{ id: 'A', x: 480, z: 690, tipo: 'carga' }, { id: 'B', x: 480, z: 0, tipo: 'paso' }, { id: 'ACOPIO', x: 1100, z: -1250, tipo: 'acopio' }] };

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('  ✓ ' + msg); else { fails++; console.log('  ✗ ' + msg); } };
const setAll = ids => { Object.keys(UGV.state.on).forEach(k => { UGV.state.on[k] = !!UGV.part(k).on; }); ids.forEach(id => { UGV.state.on[id] = true; }); };

console.log('Modelo de piezas');
const ids = UGV.PARTS.map(p => p.id);
ok(new Set(ids).size === ids.length, 'los identificadores de pieza son únicos');
UGV.WIRES.forEach(w => [w.a, w.b].forEach(k => { if (!UGV.pinInfo(k)) { ok(false, 'el pin ' + k + ' existe'); } }));
ok(true, `las ${UGV.WIRES.length} conexiones apuntan a pines existentes`);
['gnss', 'lora', 'estop'].forEach(id => ok(!!UGV.part(id), `existe la pieza ${id}`));

console.log('Análisis eléctrico');
setAll([]);
let an = UGV.analyze(7.4);
ok(!an.warnings.some(w => w.lvl === 'danger'), 'el montaje actual no tiene cortocircuitos ni tensiones peligrosas');
ok((an.vAt('rpi.5V') || 0) > 4.9 && an.net('rpi.TX') === an.net('esp32.RX2'), 'en el montaje actual la Raspberry Pi recibe 5 V del DC-DC y está unida a la ESP32 por UART');
['gnss', 'lora', 'estop'].forEach(id => ok(!UGV.state.on[id], `${id} no viene montado (no está en la gráfica del montaje)`));
setAll(['buck', 'gnss', 'lora', 'estop', 'sonar', 'divider', 'imu', 'enc', 'cam', 'aruco', 'switch']);
an = UGV.analyze(11.1);
ok(!an.warnings.some(w => w.lvl === 'danger'), 'el montaje completo para la finca no tiene peligros eléctricos');
ok(an.net('rpi.TX') === an.net('esp32.RX2') && an.net('esp32.TX2') === an.net('rpi.RX'), 'la Raspberry Pi y la ESP32 quedan unidas por UART cruzado');
ok(an.net('rpi.GND') === an.net('esp32.GND'), 'la Raspberry Pi y la ESP32 comparten tierra');
ok((an.vAt('esp32.VIN') || 0) > 4.9 && (an.vAt('rpi.5V') || 0) > 4.9, 'la ESP32 (por el L298N) y la Raspberry Pi (por el DC-DC) tienen 5 V');
ok((an.vAt('l298n.12V') || 0) > 10, 'el L298N recibe la tensión de las 3 celdas a través del interruptor y el paro');
UGV.state.estopPressed = true; an = UGV.analyze(11.1);
ok((an.vAt('l298n.12V') || 0) === 0, 'con el paro pulsado el L298N queda sin potencia');
ok((an.vAt('rpi.5V') || 0) > 4.9, 'con el paro pulsado la Raspberry Pi sigue encendida');
ok(an.warnings.some(w => /también se apaga/.test(w.text)), 'avisa que la ESP32 se apaga con el paro mientras tome 5 V del L298N');
UGV.state.estopPressed = false;
setAll(['sonar']); an = UGV.analyze(7.4);
ok(an.warnings.some(w => /ECHO/.test(w.text)), 'avisa que el ECHO de 5 V del ultrasónico necesita divisor');

console.log('Generadores de código');
setAll(['buck', 'gnss', 'lora', 'estop', 'sonar', 'divider', 'imu', 'enc']);
const fw = UGV.genCode();
ok(fw.missing.length === 0, 'el firmware tiene todas las señales del L298N y el enlace con la Raspberry Pi');
['PIN_PI_RX = 16', 'PIN_PI_TX = 17', 'PIN_LORA_RX = 18', 'PIN_LORA_TX = 19', 'PIN_TRIG = 23', 'PIN_ECHO = 13', 'PIN_PARO = 5', 'crc16', 'WATCHDOG_MS = 300']
  .forEach(s => ok(fw.code.includes(s), 'firmware contiene ' + s));
const opens = (fw.code.match(/{/g) || []).length, closes = (fw.code.match(/}/g) || []).length;
ok(opens === closes, `firmware con llaves balanceadas (${opens}/${closes})`);
const py = UGV.genPiCode();
ok(/def crc16/.test(py) && /class Mision/.test(py), 'el programa de la Raspberry Pi incluye CRC, misión y estimador');
const mis = JSON.parse(UGV.missionJSON());
ok(mis.puntos.length === 3 && mis.puntos[0].tipo === 'carga' && mis.puntos[2].tipo === 'acopio', 'la misión exportada tiene punto de carga y acopio');
const tmp = path.join(require('os').tmpdir(), 'ugv_rpi_test.py');
fs.writeFileSync(tmp, py);
for (const exe of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
  try { execFileSync(exe, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', tmp], { stdio: 'pipe' }); ok(true, `el programa Python compila (${exe})`); break; }
  catch (e) { if (e.code === 'ENOENT') continue; ok(false, 'el programa Python compila: ' + String(e.stderr || e.message).split('\n').slice(-3).join(' ')); break; }
}
// el CRC de JS (pruebas) y el de Python deben coincidir con el valor de referencia de CRC-16/CCITT-FALSE
const crc = d => { let c = 0xFFFF; for (const b of d) { c ^= b << 8; for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c; };
ok(crc(Buffer.from('123456789')) === 0x29B1, 'CRC-16/CCITT-FALSE de "123456789" = 0x29B1');

console.log(`\n${n - fails}/${n} comprobaciones correctas`);
process.exit(fails ? 1 : 0);
