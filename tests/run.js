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
ok(UGV.PI_FILES.length === FILES.length && UGV.PI_FILES[0].name === 'ugv.py' && UGV.PI_FILES.some(f => f.name === 'finca.json') && UGV.PI_FILES.some(f => f.name === 'robot/misiones.py'),
  'la página incluye los archivos del programa real (paquete robot/) y el mapa');
const leerPi = f => fs.readFileSync(path.join(root, 'raspberry', f), 'utf8');
const mot = leerPi('robot/motores.py'), conf = leerPi('robot/config.py');
[[mot, 'PIN_ENA, PIN_IN1, PIN_IN2 = 12, 17, 27', 'motor A en GPIO 12, 17 y 27'], [mot, 'PIN_IN3, PIN_IN4, PIN_ENB = 22, 23, 13', 'motor B en GPIO 22, 23 y 13'],
 [conf, '"timeout_ms": 800', 'parada sin órdenes a los 800 ms por defecto']].forEach(([t, s, m]) => ok(t.includes(s), m));
const todoPy = fs.readdirSync(path.join(root, 'raspberry', 'robot')).filter(f => f.endsWith('.py')).map(f => leerPi('robot/' + f)).join('\n') + leerPi('ugv.py');
ok(!/esp32|serial|uart/i.test(todoPy), 'el programa no usa ESP32 ni puerto serie');
ok(!/^\s*(import|from)\s+(requests|numpy|flask|websockets|aiohttp|cv2|tensorflow)\b/m.test(todoPy), 'solo usa la biblioteca estándar de Python (y gpiozero en la Raspberry Pi): nada que pagar ni instalar aparte');
const inst = leerPi('instalar.sh');
ok(inst.includes('dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4'), 'el instalador activa la PWM por hardware en GPIO 12 y 13');
ok(inst.includes('cp -r robot web') && inst.includes('[ -f "$DEST/config.json" ]'), 'el instalador copia el paquete robot/ y conserva config.json (PIN y calibración)');
ok(/pruebas fallaron: NO se instaló/.test(leerPi('actualizar.sh')), 'actualizar.sh (git) solo instala si pasan las pruebas');

console.log('Modo autónomo: el simulador planea igual que la Raspberry Pi');
const Auto = require(path.join(root, 'js', 'auto.js'));
const finca = JSON.parse(leerPi('finca.json'));
const mapa = Auto.Mapa(finca);
ok(finca.caminos.every(([a, b]) => finca.lotes.every(l => Auto.distanciaSegmentoLote([finca.puntos[a].x, finca.puntos[a].y], [finca.puntos[b].x, finca.puntos[b].y], l) >= finca.margen_cm)),
  `ningún camino pasa a menos de ${finca.margen_cm} cm de un lote de cultivo`);
let cruza = false; try { Auto.Mapa(Object.assign({}, finca, { caminos: finca.caminos.concat([['J1', 'C']]) })); } catch (e) { cruza = /pisaría|cm del lote/.test(e.message); }
ok(cruza, 'un camino que atraviesa los cultivos se rechaza al cargar el mapa');
const cfgAuto = { vel_auto: 60, cm_s: 21.7, grados_s: 54.9, espera_s: 1, pausa_giro_s: .5, rampa_pct_s: 250, retroceder_si_vuelve: true };
const P0 = { x: -450, y: -420, rumbo: 90, nombre: 'PUESTO' };
const casos = [
  ['puntos', ['PUESTO', 90, finca.orden.concat([finca.inicio]), false]], ['puntos', ['PUESTO', 90, ['C'], false]], ['puntos', ['B', 0, ['ALMACEN'], true]], ['puntos', ['D', 0, ['A', 'PUESTO'], false]],
  ['coordenadas', [P0, [{ x_m: -4.5, y_m: 0 }, { x_m: -0.5, y_m: 0, nombre: 'J' }, { x_m: -4.5, y_m: 0.3 }], false]],
  ['coordenadas', [{ x: 0, y: 0, rumbo: 37 }, [{ x_m: 3, y_m: 4 }, { x_m: -2, y_m: 1.5 }, { x_m: 0, y_m: 0 }], true]],
  ['instrucciones', [{ x: 0, y: 0, rumbo: 0 }, [{ accion: 'avanzar', valor: 1.5, unidad: 'm' }, { accion: 'izquierda', valor: 90 }, { accion: 'esperar', valor: 2 }, { accion: 'avanzar', valor: 0.002, unidad: 'km' }, { accion: 'derecha', valor: 45 }, { accion: 'retroceder', valor: 30, unidad: 'cm' }]]],
  ['instrucciones', [null, [{ accion: 'avanzar', valor: 1, unidad: 'm' }, { accion: 'derecha', valor: 180 }, { accion: 'avanzar', valor: 1, unidad: 'm' }]]]];
const PY_PLAN = [
  "import sys, json; sys.path.insert(0, 'raspberry')",
  'from robot import navegacion as nav',
  'from robot.mapa import Mapa',
  'from robot.config import CONFIG_DEF',
  "m = Mapa('raspberry/finca.json'); cfg = dict(CONFIG_DEF, **json.loads(sys.argv[1])); out = []",
  'for tipo, a in json.loads(sys.argv[2]):',
  "    if tipo == 'puntos': out.append(nav.plan_puntos(m, a[0], a[1], a[2], cfg, a[3]))",
  "    elif tipo == 'coordenadas': out.append(nav.plan_coordenadas(a[0], a[1], cfg, a[2]))",
  '    else: out.append(nav.plan_instrucciones(a[0], a[1], cfg))',
  'print(json.dumps(out))'].join('\n');
const pyPlan = exe => execFileSync(exe, ['-c', PY_PLAN, JSON.stringify(cfgAuto), JSON.stringify(casos)], { cwd: root, encoding: 'utf8' });
let planPy = null;
for (const exe of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) { try { planPy = JSON.parse(pyPlan(exe)); break; } catch (e) { if (e.code !== 'ENOENT') { ok(false, 'el planificador de Python corre: ' + String(e.stderr || e.message).split('\n').slice(-2).join(' ')); break; } } }
const cerca = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < tol);
if (planPy) casos.forEach(([tipo, a], i) => {
  const js = tipo === 'puntos' ? Auto.planPuntos(mapa, a[0], a[1], a[2], cfgAuto, a[3]) : tipo === 'coordenadas' ? Auto.planCoordenadas(a[0], a[1], cfgAuto, a[2]) : Auto.planInstrucciones(a[0], a[1], cfgAuto), [pp, pn] = planPy[i];
  const igual = js.nodos.join() === pn.join() && js.pasos.length === pp.length && js.pasos.every((p, k) => {
    const q = pp[k]; return p.tipo === q.tipo && p.llega === q.llega && p.hacia === q.hacia && String(p.esperar) === String(q.esperar) && cerca(p.duracion, q.duracion, .011) &&
      cerca(p.giro, q.giro, .11) && cerca(p.rumbo_obj, q.rumbo_obj, .11) && cerca(p.rumbo_rec, q.rumbo_rec, .11) && cerca(p.x, q.x, .11) && cerca(p.y, q.y, .11) &&
      (!p.fin || ((p.fin.pos ?? null) === (q.fin.pos ?? null) && cerca(p.fin.rumbo, q.fin.rumbo, .11) && cerca(p.fin.x, q.fin.x, .11) && cerca(p.fin.y, q.fin.y, .11))); });
  ok(igual, `mismos pasos en JavaScript y en Python: ${tipo} ${tipo === 'puntos' ? a[0] + ' → ' + a[2].join(', ') : '(' + a[1].length + ')'} (${js.pasos.length} pasos)`);
});
const tour = Auto.planPuntos(mapa, 'PUESTO', 90, finca.orden.concat(['PUESTO']), cfgAuto, false);
ok(finca.orden.every(p => tour.pasos.some(q => q.llega === p && q.esperar === 1)), 'el recorrido completo se detiene 1 s en cada punto');
ok(tour.pasos.some(q => q.tipo === 'retroceder') && !tour.pasos.some(q => /izquierda|derecha/.test(q.tipo) && Math.abs(q.giro) > 135), 'no da medias vueltas: retrocede en línea recta');
const av = Auto.planInstrucciones(null, [{ accion: 'avanzar', valor: 2, unidad: 'km' }], cfgAuto).pasos[0];
ok(Math.abs(av.duracion - 200000 / 21.7) < .011, 'los kilómetros se convierten en tiempo con la calibración');
let fuera = false; try { Auto.planCoordenadas(P0, [{ x_m: 0, y_m: -2 }], cfgAuto, false, mapa); } catch (e) { fuera = /Huerta/.test(e.message); }
ok(fuera, 'una ruta por coordenadas que pisa un lote se rechaza');
ok(JSON.stringify(Auto.leerInstrucciones('avanzar 2 m; derecha 90; esperar 3; retroceder 50 cm')) === JSON.stringify([{ accion: 'avanzar', valor: 2, unidad: 'm' }, { accion: 'derecha', valor: 90 }, { accion: 'esperar', valor: 3 }, { accion: 'retroceder', valor: 50, unidad: 'cm' }]),
  'el simulador entiende rutas escritas como «avanzar 2 m; derecha 90»');

let ran = false;
for (const exe of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
  try {
    const out = execFileSync(exe, ['test_ugv.py'], { cwd: path.join(root, 'raspberry'), stdio: 'pipe', encoding: 'utf8' });
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
