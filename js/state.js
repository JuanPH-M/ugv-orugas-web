/* Estado compartido, eventos y análisis eléctrico del circuito */
(function () {
'use strict';
const KEY = 'ugv-orugas-v3'; // v3: diseño final sin ESP32 (v2 era la finca con ESP32)
const bus = {};
UGV.on = (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); };
UGV.emit = (ev, d) => { (bus[ev] || []).forEach(fn => fn(d)); };

const def = () => ({
  on: Object.fromEntries(UGV.PARTS.map(p => [p.id, !!p.on])),
  pos: {}, sch: {}, custom: [], removed: [], switchClosed: true, batteryOn: true
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
  if (S.on.buck) union('buck.IN-', 'buck.OUT-'); // en el reductor la entrada y la salida negativas son la misma tierra
  const groups = {};
  Object.keys(parent).forEach(k => { const r = find(k); (groups[r] = groups[r] || []).push(k); });

  // fuentes de tensión, resueltas en pasadas (los reguladores dependen de su entrada)
  const netOf = k => find(k);
  const volt = {}; // raíz -> [{v, from}]
  const src = (pin, v) => { const r = netOf(pin); (volt[r] = volt[r] || []).push({ v, from: pin }); };
  const vAt = pin => { const l = volt[netOf(pin)]; return l && l.length ? Math.max(...l.map(s => s.v)) : null; };
  if (S.on.battery && S.batteryOn !== false) { src('battery.BAT-', 0); src('battery.BAT+', vbat); }
  for (let pass = 0; pass < 3; pass++) {
    if (S.on.l298n && !volt[netOf('l298n.5V')] && (vAt('l298n.12V') || 0) > 6.5 && vAt('l298n.GND') === 0) src('l298n.5V', 5.0);
    if (S.on.buck && !volt[netOf('buck.OUT+')] && (vAt('buck.IN+') || 0) > 6 && vAt('buck.IN-') === 0) src('buck.OUT+', 5.0);
  }
  const rpiOn = S.on.rpi && (vAt('rpi.5V') || 0) >= 4.6 && (vAt('rpi.5V') || 0) <= 5.5 && vAt('rpi.GND') === 0;

  const W = [];
  const name = k => { const [p, pin] = k.split('.'); return UGV.part(p).name.split(' · ')[0] + ' ' + pin; };
  Object.entries(volt).forEach(([r, l]) => {
    const vs = [...new Set(l.map(s => s.v))];
    if (vs.length > 1) W.push({ lvl: 'danger', parts: l.map(s => s.from.split('.')[0]), text: `Cortocircuito: ${l.map(s => name(s.from) + ' (' + s.v + ' V)').join(' con ')}.` });
    const v = Math.max(...vs);
    const gp = (groups[r] || []).filter(k => UGV.pinInfo(k) && UGV.pinInfo(k).gpio);
    if (v > 3.6 && gp.length) W.push({ lvl: 'danger', parts: ['rpi'], text: `${v} V llegan a ${gp.map(name).join(', ')}: los GPIO de la Raspberry Pi solo toleran 3,3 V.` });
    else if (v === 0 && gp.length && rpiOn) W.push({ lvl: 'danger', parts: ['rpi'], text: `${gp.map(name).join(', ')} está unido a tierra: al poner la salida en alto haría un cortocircuito.` });
  });
  if (S.on.rpi) {
    const v = vAt('rpi.5V');
    if (v === null) W.push({ lvl: 'warn', parts: ['rpi', 'buck'], text: S.batteryOn === false ? 'Batería desconectada: la Raspberry Pi está apagada.' : 'La Raspberry Pi no tiene alimentación: conecta la salida de 5 V del DC-DC al pin 2.' });
    else if ((groups[netOf('rpi.5V')] || []).includes('l298n.5V')) W.push({ lvl: 'warn', parts: ['rpi', 'l298n'], text: 'La Raspberry Pi toma 5 V del L298N: en el diseño final se alimenta del DC-DC, porque el regulador del módulo no da la corriente que pide la Raspberry Pi y los arranques de los motores la reiniciarían.' });
    else if (v > 5.5) W.push({ lvl: 'danger', parts: ['rpi'], text: `La Raspberry Pi recibe ${v} V en el pin de 5 V.` });
  }
  if (S.on.rpi && S.on.l298n && netOf('rpi.GND') !== netOf('l298n.GND'))
    W.push({ lvl: 'warn', parts: ['rpi', 'l298n'], text: 'La Raspberry Pi y el L298N no comparten tierra: las entradas del L298N no reconocen las señales.' });
  if (S.on.l298n && (vAt('l298n.12V') || 0) < 6) W.push({ lvl: 'warn', parts: ['l298n', 'battery'], text: S.batteryOn === false ? 'Batería desconectada: corte total de energía.' : S.on.switch && !S.switchClosed ? 'Interruptor apagado: el L298N no tiene energía.' : 'El L298N no recibe la tensión de las baterías.' });
  ['motorA', 'motorB'].forEach(m => { if (S.on[m] && (groups[netOf(m + '.M+')] || []).length < 2) W.push({ lvl: 'info', parts: [m], text: `${UGV.part(m).name} no está conectado al L298N.` }); });
  if (!S.on.switch) W.push({ lvl: 'info', parts: ['battery'], text: 'Sin paro físico: el corte total es desconectar la batería. El informe recomienda un interruptor o paro físico para versiones futuras.' });

  const netV = {}; Object.keys(groups).forEach(r => { netV[r] = volt[r] ? Math.max(...volt[r].map(s => s.v)) : null; });
  return { wires, net: k => netOf(k), netV: k => netV[netOf(k)] ?? null, groups, warnings: W, vAt, rpiOn };
};
})();
