/* Estado compartido, eventos y análisis eléctrico del circuito */
(function () {
'use strict';
const KEY = 'ugv-orugas-v2'; // v2: finca (v1 era la habitación)
const bus = {};
UGV.on = (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); };
UGV.emit = (ev, d) => { (bus[ev] || []).forEach(fn => fn(d)); };

const def = () => ({
  on: Object.fromEntries(UGV.PARTS.map(p => [p.id, !!p.on])),
  pos: {}, sch: {}, custom: [], removed: [], switchClosed: true, estopPressed: false, cells: 2, gnssMode: 'auto'
});
let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { }
const S = UGV.state = Object.assign(def(), saved || {});
UGV.PARTS.forEach(p => { if (!(p.id in S.on)) S.on[p.id] = !!p.on; });

let saveT;
UGV.save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) { } }, 250); };
UGV.reset = () => { const d = def(); Object.keys(S).forEach(k => delete S[k]); Object.assign(S, d); UGV.save(); UGV.emit('parts'); UGV.emit('wires'); UGV.emit('layout'); };

UGV.setOn = (id, v) => { S.on[id] = v; UGV.save(); UGV.emit('parts', id); UGV.emit('wires'); };
UGV.isOn = id => !!S.on[id];

/* Conexiones activas */
const wkey = w => [w.a, w.b].sort().join('~');
UGV.netlist = () => {
  const list = [];
  UGV.WIRES.forEach(w => {
    const pa = w.a.split('.')[0], pb = w.b.split('.')[0];
    if (!S.on[pa] || !S.on[pb]) return;
    if (w.unless && [].concat(w.unless).some(id => S.on[id])) return;
    if (S.removed.includes(wkey(w))) return;
    list.push(Object.assign({ key: wkey(w), std: true }, w));
  });
  S.custom.forEach(w => {
    const pa = w.a.split('.')[0], pb = w.b.split('.')[0];
    if (S.on[pa] && S.on[pb]) list.push(Object.assign({ key: wkey(w), custom: true }, w));
  });
  return list;
};
UGV.addWire = (a, b) => {
  if (a === b) return false;
  const k = [a, b].sort().join('~');
  const ri = S.removed.indexOf(k);
  if (ri >= 0) { S.removed.splice(ri, 1); }
  else if (UGV.netlist().some(w => w.key === k)) return false;
  else S.custom.push({ a, b });
  UGV.save(); UGV.emit('wires'); return true;
};
UGV.removeWire = key => {
  const ci = S.custom.findIndex(w => wkey(w) === key);
  if (ci >= 0) S.custom.splice(ci, 1); else S.removed.push(key);
  UGV.save(); UGV.emit('wires');
};
UGV.pinInfo = key => {
  const [pid, pin] = key.split('.'); const p = UGV.part(pid);
  return p && p.pins.find(x => x.id === pin);
};

/* ---------- Análisis eléctrico ---------- */
UGV.analyze = (vbat = 7.4) => {
  const wires = UGV.netlist();
  const parent = {};
  const find = x => { if (parent[x] === undefined) parent[x] = x; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const add = x => { if (parent[x] === undefined) parent[x] = x; };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  UGV.PARTS.forEach(p => { if (S.on[p.id]) p.pins.forEach(pin => add(p.id + '.' + pin.id)); });
  wires.forEach(w => union(w.a, w.b));
  if (S.on.switch && S.switchClosed) union('switch.IN', 'switch.OUT');
  if (S.on.estop && !S.estopPressed) union('estop.IN', 'estop.OUT');
  const groups = {};
  Object.keys(parent).forEach(k => { const r = find(k); (groups[r] = groups[r] || []).push(k); });

  // fuentes de tensión, resueltas en pasadas (los reguladores dependen de su entrada)
  const netOf = k => find(k);
  const volt = {}; // raíz -> [{v, from}]
  const src = (pin, v) => { const r = netOf(pin); (volt[r] = volt[r] || []).push({ v, from: pin }); };
  const vAt = pin => { const l = volt[netOf(pin)]; return l && l.length ? Math.max(...l.map(s => s.v)) : null; };
  if (S.on.battery) { src('battery.BAT-', 0); src('battery.BAT+', vbat); }
  const gnd = pin => src(pin, 0);
  for (let pass = 0; pass < 3; pass++) {
    if (S.on.l298n && !volt[netOf('l298n.5V')] && (vAt('l298n.12V') || 0) > 6.5 && vAt('l298n.GND') === 0) src('l298n.5V', 5.0);
    if (S.on.buck && !volt[netOf('buck.OUT+')] && (vAt('buck.IN+') || 0) > 6.5 && vAt('buck.IN-') === 0) { src('buck.OUT+', 5.1); }
    if (S.on.esp32 && !volt[netOf('esp32.3V3')] && (vAt('esp32.VIN') || 0) >= 4.5 && vAt('esp32.GND') === 0) src('esp32.3V3', 3.3);
    if (S.on.sonar && !volt[netOf('sonar.ECHO')] && (vAt('sonar.VCC') || 0) >= 4.5) src('sonar.ECHO', 5.0);
    if (S.on.divider && !volt[netOf('divider.OUT')] && (vAt('divider.IN') || 0) > 0 && vAt('divider.GND') === 0) src('divider.OUT', +(vAt('divider.IN') * 2 / 3).toFixed(1));
  }
  if (S.on.buck && vAt('buck.OUT+') !== null) gnd('buck.OUT-');

  const W = [];
  const name = k => { const [p, pin] = k.split('.'); return UGV.part(p).name.split(' · ')[0] + ' ' + pin; };
  Object.entries(volt).forEach(([r, l]) => {
    const vs = [...new Set(l.map(s => s.v))];
    if (vs.length > 1) W.push({ lvl: 'danger', parts: l.map(s => s.from.split('.')[0]), text: `Cortocircuito: ${l.map(s => name(s.from) + ' (' + s.v + ' V)').join(' con ')}.` });
    const v = Math.max(...vs);
    const gp = (groups[r] || []).filter(k => UGV.pinInfo(k) && UGV.pinInfo(k).gpio);
    if (v > 3.6 && gp.length) {
      const fromEcho = l.some(s => s.from === 'sonar.ECHO');
      W.push({ lvl: fromEcho && vs.length === 1 ? 'warn' : 'danger', parts: ['esp32'].concat(fromEcho ? ['sonar'] : []),
        text: fromEcho ? `ECHO del HC-SR04 (5 V) entra directo a ${gp.map(name).join(', ')}. Agrega el divisor de tensión.` :
          `${v} V llegan a ${gp.map(name).join(', ')}: los GPIO de la ESP32 solo toleran 3,3 V.` });
    }
  });
  if (S.on.rpi) {
    const v = vAt('rpi.5V');
    if (v === null) W.push({ lvl: 'warn', parts: ['rpi', 'buck'], text: 'La Raspberry Pi no tiene alimentación. Agrega el convertidor DC-DC de 5 V.' });
    else if ((groups[netOf('rpi.5V')] || []).includes('l298n.5V')) W.push({ lvl: 'warn', parts: ['rpi', 'l298n'], text: 'La Raspberry Pi toma 5 V del L298N: su regulador da ≈ 0,5 A y la Pi puede pedir 2,5 A.' });
    else if (v > 5.5) W.push({ lvl: 'danger', parts: ['rpi'], text: `La Raspberry Pi recibe ${v} V en el pin de 5 V.` });
  }
  if (S.on.cam && !S.on.rpi) W.push({ lvl: 'warn', parts: ['cam'], text: 'La cámara necesita la Raspberry Pi.' });
  if (S.on.gnss && !S.on.rpi) W.push({ lvl: 'warn', parts: ['gnss'], text: 'El receptor GNSS se conecta a la Raspberry Pi.' });
  if (S.on.rpi && S.on.esp32 && !(netOf('rpi.TX') === netOf('esp32.RX2') && netOf('esp32.TX2') === netOf('rpi.RX')))
    W.push({ lvl: 'warn', parts: ['rpi', 'esp32'], text: 'La Raspberry Pi y la ESP32 no están unidas por el puerto serie (GPIO 14/15 ↔ RX2/TX2): el modo automático no puede mandar órdenes a los motores.' });
  else if (S.on.rpi && S.on.esp32 && netOf('rpi.GND') !== netOf('esp32.GND')) W.push({ lvl: 'warn', parts: ['rpi', 'esp32'], text: 'La Raspberry Pi y la ESP32 no comparten tierra: el enlace serie no funcionará.' });
  if (S.on.estop && S.estopPressed) W.push({ lvl: 'info', parts: ['estop'], text: 'Paro de emergencia pulsado: los motores no tienen potencia. Suéltalo para volver a moverte.' });
  if (S.on.l298n && !S.on.estop) W.push({ lvl: 'info', parts: ['estop'], text: 'Falta el paro de emergencia físico en la línea de potencia de los motores (requisito RNF6).' });
  if (S.on.esp32 && (vAt('esp32.VIN') || 0) < 4.5) W.push({ lvl: 'warn', parts: ['esp32'], text: 'La ESP32 no recibe 5 V en VIN.' });
  if (S.on.l298n && (vAt('l298n.12V') || 0) < 6) W.push({ lvl: 'warn', parts: ['l298n'], text: S.on.switch && !S.switchClosed ? 'Interruptor apagado: el L298N no tiene energía.' : 'El L298N no recibe la tensión de las baterías.' });
  ['motorA', 'motorB'].forEach(m => { if (S.on[m] && (groups[netOf(m + '.M+')] || []).length < 2) W.push({ lvl: 'info', parts: [m], text: `${UGV.part(m).name} no está conectado al driver.` }); });

  const netV = {}; Object.keys(groups).forEach(r => { netV[r] = volt[r] ? Math.max(...volt[r].map(s => s.v)) : null; });
  return { wires, net: k => netOf(k), netV: k => netV[netOf(k)] ?? null, groups, warnings: W, vAt };
};
})();
