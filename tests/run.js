/* Pruebas automáticas sin dependencias: node tests/run.js
   1. Cargan el modelo de datos y el análisis eléctrico en un entorno simulado (sin navegador ni WebGL) y verifican
      que el cableado sea exactamente el del diagrama final (Raspberry Pi → L298N, sin ESP32).
   2. Verifican que js/codepi.js tenga la misma copia de los archivos de raspberry/.
   3. Ejecutan las pruebas de extremo a extremo del programa real de la Raspberry Pi (raspberry/test_ugv.py). */
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
['js/data.js', 'js/state.js', 'js/codepi.js'].forEach(load);
const UGV = ctx.UGV;
UGV.Sim = { st: { vbat: 7.4 } };

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('  ✓ ' + msg); else { fails++; console.log('  ✗ ' + msg); } };
const S = UGV.state;
const base = () => { Object.keys(S.on).forEach(k => { S.on[k] = !!UGV.part(k).on; }); S.custom = []; S.removed = []; S.batteryOn = true; S.switchClosed = true; };

console.log('Piezas del diseño final');
const ids = UGV.PARTS.map(p => p.id);
ok(new Set(ids).size === ids.length, 'los identificadores de pieza son únicos');
const montadas = UGV.PARTS.filter(p => p.on).map(p => p.id).sort().join(',');
ok(montadas === 'battery,box,buck,chassis,l298n,motorA,motorB,rpi', 'solo vienen montadas las piezas del diagrama final: ' + montadas);
ok(!ids.some(id => /esp32|gnss|lora|sonar|imu|enc|cam|estop/.test(id)), 'no quedan piezas retiradas (ESP32, GNSS, LoRa, sensores, cámara, paro)');
UGV.WIRES.forEach(w => [w.a, w.b].forEach(k => { if (!UGV.pinInfo(k)) ok(false, 'el pin ' + k + ' existe'); }));
ok(true, `las ${UGV.WIRES.length} conexiones apuntan a pines existentes`);

console.log('Conexiones del diagrama final');
base();
let an = UGV.analyze(7.4);
const same = (a, b) => an.net(a) === an.net(b);
[['G12', 'ENA'], ['G17', 'IN1'], ['G27', 'IN2'], ['G22', 'IN3'], ['G23', 'IN4'], ['G13', 'ENB']].forEach(([g, l]) => ok(same('rpi.' + g, 'l298n.' + l), `Raspberry Pi ${g.replace('G', 'GPIO ')} → L298N ${l}`));
ok(UGV.SIGNALS.map(s => s[3]).join(',') === '32,11,13,15,16,33', 'pines físicos 32, 11, 13, 15, 16 y 33');
ok(same('l298n.OUT1', 'motorA.M+') && same('l298n.OUT2', 'motorA.M-') && same('l298n.OUT3', 'motorB.M+') && same('l298n.OUT4', 'motorB.M-'), 'OUT1/OUT2 → motor A y OUT3/OUT4 → motor B');
ok(same('battery.BAT+', 'l298n.12V') && same('battery.BAT+', 'buck.IN+'), 'baterías (+) → 12V del L298N y entrada del DC-DC');
ok(same('buck.OUT+', 'rpi.5V'), 'DC-DC 5 V → pin 2 de la Raspberry Pi');
ok(same('battery.BAT-', 'l298n.GND') && same('l298n.GND', 'rpi.GND') && same('buck.IN-', 'rpi.GND'), 'tierra común: baterías, DC-DC, L298N y Raspberry Pi (pin 6)');
ok((an.groups[an.net('l298n.5V')] || []).length === 1, 'la salida de 5 V del L298N no se usa');

console.log('Análisis eléctrico');
ok(!an.warnings.some(w => w.lvl === 'danger' || w.lvl === 'warn'), 'el montaje final no tiene peligros ni advertencias');
ok(an.rpiOn && Math.abs(an.vAt('rpi.5V') - 5) < .01 && an.vAt('l298n.12V') === 7.4, 'la Raspberry Pi recibe 5 V y el L298N 7,4 V');
ok(an.warnings.some(w => /desconectar la batería/.test(w.text)), 'recuerda que el corte total es desconectar la batería');
S.batteryOn = false; an = UGV.analyze(7.4);
ok(!an.rpiOn && !an.vAt('l298n.12V'), 'con la batería desconectada no hay energía en ninguna parte');
base(); S.custom = [{ a: 'l298n.5V', b: 'rpi.G17' }]; an = UGV.analyze(7.4);
ok(an.warnings.some(w => w.lvl === 'danger' && /solo toleran 3,3 V/.test(w.text)), 'avisa del peligro si llegan 5 V a un GPIO');
base(); S.removed = ['buck.OUT-~rpi.GND']; an = UGV.analyze(7.4);
ok(an.warnings.some(w => /no tiene alimentación|no comparten tierra/.test(w.text)), 'avisa si la Raspberry Pi pierde la tierra común');
base(); S.custom = [{ a: 'l298n.5V', b: 'rpi.5V' }]; S.removed = ['buck.OUT+~rpi.5V']; an = UGV.analyze(7.4);
ok(an.warnings.some(w => /toma 5 V del L298N/.test(w.text)), 'avisa si la Raspberry Pi se alimenta del 5 V del L298N');
base(); S.on.switch = true; S.switchClosed = false; an = UGV.analyze(7.4);
ok(!an.vAt('l298n.12V') && !an.rpiOn, 'el interruptor (trabajo futuro) corta toda la energía');
base();

console.log('Programa de la Raspberry Pi');
const { generar, FILES } = require(path.join(root, 'tools', 'empaquetar.js'));
ok(fs.readFileSync(path.join(root, 'js', 'codepi.js'), 'utf8') === generar(), 'js/codepi.js está al día con raspberry/ (si falla: node tools/empaquetar.js)');
ok(UGV.PI_FILES.length === FILES.length && UGV.PI_FILES[0].name === 'ugv.py' && UGV.PI_FILES.some(f => f.name === 'finca.json'), 'la página incluye los archivos del programa real y el mapa de la finca');
const py = fs.readFileSync(path.join(root, 'raspberry', 'ugv.py'), 'utf8');
[['PIN_ENA, PIN_IN1, PIN_IN2 = 12, 17, 27', 'motor A en GPIO 12, 17 y 27'], ['PIN_IN3, PIN_IN4, PIN_ENB = 22, 23, 13', 'motor B en GPIO 22, 23 y 13'],
 ['"timeout_ms": 800', 'parada sin órdenes a los 800 ms por defecto']].forEach(([s, m]) => ok(py.includes(s), m));
ok(!/esp32|serial|uart/i.test(py), 'el programa no usa ESP32 ni puerto serie');
const inst = fs.readFileSync(path.join(root, 'raspberry', 'instalar.sh'), 'utf8');
ok(inst.includes('dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4'), 'el instalador activa la PWM por hardware en GPIO 12 y 13');
console.log('Modo automático: el simulador planea igual que la Raspberry Pi');
const Auto = require(path.join(root, 'js', 'auto.js'));
const finca = JSON.parse(fs.readFileSync(path.join(root, 'raspberry', 'finca.json'), 'utf8'));
const mapa = Auto.Mapa(finca);
ok(finca.caminos.every(([a, b]) => finca.lotes.every(l => Auto.distanciaSegmentoLote([finca.puntos[a].x, finca.puntos[a].y], [finca.puntos[b].x, finca.puntos[b].y], l) >= finca.margen_cm)),
  `ningún camino pasa a menos de ${finca.margen_cm} cm de un lote de cultivo`);
let cruza = false; try { Auto.Mapa(Object.assign({}, finca, { caminos: finca.caminos.concat([['J1', 'C']]) })); } catch (e) { cruza = /pisaría|cm del lote/.test(e.message); }
ok(cruza, 'un camino que atraviesa los cultivos se rechaza al cargar el mapa');
const cfgAuto = { vel_auto: 60, cm_s: 21.7, grados_s: 54.9, espera_s: 1, pausa_giro_s: .5 };
const casos = [['PUESTO', 90, finca.orden.concat([finca.inicio]), false], ['PUESTO', 90, ['C'], false], ['B', 0, ['ALMACEN'], true], ['D', 0, ['A', 'PUESTO'], false]];
const pyPlan = (exe) => execFileSync(exe, ['-c', `import sys, json; sys.path.insert(0, 'raspberry'); import ugv
m = ugv.Mapa('raspberry/finca.json'); cfg = dict(ugv.CONFIG_DEF, **json.loads(sys.argv[1]))
print(json.dumps([ugv.plan_auto(m, d, r, t, cfg, e) for d, r, t, e in json.loads(sys.argv[2])]))`, JSON.stringify(cfgAuto), JSON.stringify(casos)], { cwd: root, encoding: 'utf8' });
let planPy = null;
for (const exe of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) { try { planPy = JSON.parse(pyPlan(exe)); break; } catch (e) { if (e.code !== 'ENOENT') { ok(false, 'el planificador de Python corre: ' + String(e.stderr || e.message).split('\n').slice(-2).join(' ')); break; } } }
if (planPy) casos.forEach(([d, r, t, e], i) => {
  const js = Auto.plan(mapa, d, r, t, cfgAuto, e), [pp, pn] = planPy[i];
  const igual = js.nodos.join() === pn.join() && js.pasos.length === pp.length && js.pasos.every((p, k) => {
    const q = pp[k]; return p.tipo === q.tipo && p.llega === q.llega && p.hacia === q.hacia && String(p.esperar) === String(q.esperar) &&
      Math.abs((p.duracion || 0) - (q.duracion || 0)) < .011 && (!p.fin || (p.fin.pos === q.fin.pos && Math.abs(p.fin.rumbo - q.fin.rumbo) < .11)); });
  ok(igual, `mismos pasos en JavaScript y en Python: ${d} → ${t.join(', ')} (${js.pasos.length} pasos)`);
});
const tour = Auto.plan(mapa, 'PUESTO', 90, finca.orden.concat(['PUESTO']), cfgAuto, false);
ok(finca.orden.every(p => tour.pasos.some(q => q.llega === p && q.esperar === 1)), 'el recorrido completo se detiene 1 s en cada punto');
ok(tour.pasos.some(q => q.tipo === 'retroceder') && !tour.pasos.some(q => /izquierda|derecha/.test(q.tipo) && q.duracion > 135 / cfgAuto.grados_s), 'no da medias vueltas: retrocede en línea recta');

let ran = false;
for (const exe of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
  try {
    const out = execFileSync(exe, ['-m', 'unittest', 'raspberry/test_ugv.py'], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    ok(true, `pruebas de extremo a extremo del servidor real (${exe}): ${((out.match(/Ran (\d+) tests/) || [])[1]) || 'ok'}`); ran = true; break;
  } catch (e) {
    if (e.code === 'ENOENT') continue;
    const txt = String(e.stderr || '') + String(e.stdout || '');
    ok(false, 'pruebas del servidor real: ' + txt.split('\n').filter(l => /FAIL|Error|assert/i.test(l)).slice(0, 6).join(' | ')); ran = true; break;
  }
}
if (!ran) ok(false, 'hay Python 3 para probar el programa de la Raspberry Pi');

console.log(`\n${n - fails}/${n} comprobaciones correctas`);
process.exit(fails ? 1 : 0);
