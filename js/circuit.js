/* Esquema interactivo del circuito (SVG) */
(function () {
'use strict';
const S = UGV.state, NS = 'http://www.w3.org/2000/svg';
const C = UGV.Circuit = {};
const NW = 196, HEAD = 40, ROW = 22;
let svg, world, wiresG, nodesG, tempPath, el = {};
let view = { x: 0, y: 0, k: 1 }, pending = null, selWire = null, selPart = null, an = null;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

function nodePos(p) { const o = S.sch[p.id]; return o ? { x: o[0], y: o[1] } : { x: p.sch.x, y: p.sch.y }; }
function pinLayout(p) {
  const L = p.pins.filter(x => x.side === 'l'), R = p.pins.filter(x => x.side === 'r');
  const h = HEAD + Math.max(L.length, R.length, 1) * ROW + 10;
  const pos = {}; L.forEach((pin, i) => pos[pin.id] = { x: 0, y: HEAD + 4 + i * ROW + ROW / 2, side: -1 });
  R.forEach((pin, i) => pos[pin.id] = { x: NW, y: HEAD + 4 + i * ROW + ROW / 2, side: 1 });
  return { h, pos };
}
function pinXY(key) {
  const [pid, pin] = key.split('.'); const p = UGV.part(pid); if (!p || !p.sch) return null;
  const n = nodePos(p), l = pinLayout(p).pos[pin]; if (!l) return null;
  return { x: n.x + l.x, y: n.y + l.y, side: l.side };
}
function wirePath(a, b) {
  const d = Math.max(50, Math.abs(b.x - a.x) * .45);
  return `M${a.x},${a.y} C${a.x + a.side * d},${a.y} ${b.x + b.side * d},${b.y} ${b.x},${b.y}`;
}
const wireType = w => { const t = [UGV.pinInfo(w.a), UGV.pinInfo(w.b)].map(x => x && x.t);
  return t.includes('gnd') ? 'gnd' : t.includes('mot') ? 'mot' : t.includes('pwr') ? 'pwr' : t.includes('bus') ? 'bus' : 'sig'; };

C.init = function (refs) {
  el = refs;
  svg = mk('svg', { class: 'sch', role: 'img', 'aria-label': 'Esquema del circuito' }, el.wrap);
  const defs = mk('defs', {}, svg);
  const pat = mk('pattern', { id: 'grid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, defs);
  mk('circle', { cx: 1, cy: 1, r: 1, class: 'grid-dot' }, pat);
  mk('rect', { x: -5000, y: -5000, width: 10000, height: 10000, fill: 'url(#grid)', class: 'bg' }, svg);
  world = mk('g', {}, svg);
  wiresG = mk('g', {}, world); nodesG = mk('g', {}, world);
  tempPath = mk('path', { class: 'wire temp', d: '' }, world);
  setupPanZoom();
  el.fit.addEventListener('click', fit);
  el.zin.addEventListener('click', () => zoomAt(1.2)); el.zout.addEventListener('click', () => zoomAt(1 / 1.2));
  el.restore.addEventListener('click', () => { S.custom = []; S.removed = []; S.sch = {}; UGV.save(); UGV.emit('wires'); render(); fit(); UGV.emit('toast', 'Cableado y posiciones originales restaurados.'); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { cancelPending(); } if ((e.key === 'Delete' || e.key === 'Backspace') && selWire && UGV.activeTab === 'circ' && !/INPUT/.test(e.target.tagName)) { UGV.removeWire(selWire); selWire = null; } });
  UGV.on('wires', render); UGV.on('parts', () => { render(); renderPalette(); });
  UGV.on('telemetry', live);
  UGV.on('theme', render);
  render(); renderPalette();
  requestAnimationFrame(fit);
};

/* ---------- Dibujo ---------- */
function render() {
  if (!svg) return;
  an = UGV.analyze(UGV.Sim.st ? UGV.Sim.st.vbat : 7.4);
  wiresG.innerHTML = ''; nodesG.innerHTML = '';
  const conn = {};
  an.wires.forEach(w => {
    const a = pinXY(w.a), b = pinXY(w.b); if (!a || !b) return;
    (conn[w.a] = conn[w.a] || []).push(w); (conn[w.b] = conn[w.b] || []).push(w);
    const g = mk('g', { class: 'wg' + (selWire === w.key ? ' sel' : ''), 'data-key': w.key }, wiresG);
    const d = wirePath(a, b);
    mk('path', { d, class: 'hit' }, g);
    const p = mk('path', { d, class: 'wire t-' + wireType(w) + (w.custom ? ' custom' : ''), stroke: UGV.Sim.wireColor ? UGV.Sim.wireColor(w, an) : '' }, g);
    p.dataset.sig = w.sig || '';
    g.addEventListener('pointerdown', e => { e.stopPropagation(); if (pending) return; selWire = w.key; selPart = null; render(); });
  });
  UGV.PARTS.forEach(p => {
    if (!p.sch || !UGV.isOn(p.id)) return;
    const n = nodePos(p), lay = pinLayout(p);
    const g = mk('g', { class: `node c-${p.cat}` + (selPart === p.id ? ' sel' : '') + (an.warnings.some(w => w.parts.includes(p.id) && w.lvl !== 'info') ? ' bad' : ''), transform: `translate(${n.x},${n.y})`, 'data-id': p.id }, nodesG);
    mk('rect', { class: 'body', width: NW, height: lay.h, rx: 12 }, g);
    mk('rect', { class: 'head', width: NW, height: HEAD - 6, rx: 12 }, g);
    mk('rect', { class: 'head', width: NW, height: 12, y: HEAD - 18 }, g);
    const t = mk('text', { x: 14, y: 21, class: 'title' }, g); t.textContent = p.name.split(' · ')[0];
    const sub = mk('text', { x: 14, y: HEAD - 4 + 14, class: 'live', 'data-live': p.id }, g); sub.textContent = '';
    p.pins.forEach(pin => {
      const pp = lay.pos[pin.id], key = p.id + '.' + pin.id, v = an.netV(key);
      const pg = mk('g', { class: 'pin t-' + pin.t + (conn[key] ? ' on' : '') + (pending === key ? ' pending' : ''), transform: `translate(${pp.x},${pp.y + 8})`, 'data-key': key }, g);
      mk('circle', { r: 9, class: 'pin-hit' }, pg);
      mk('circle', { r: 4.5, class: 'pin-dot' }, pg);
      const lt = mk('text', { x: pp.side < 0 ? 12 : -12, y: 4, class: 'pin-lbl', 'text-anchor': pp.side < 0 ? 'start' : 'end' }, pg);
      lt.textContent = pin.id + (v !== null && pin.t !== 'gnd' && (pin.t === 'pwr' || pin.v) ? `  ${String(v).replace('.', ',')} V` : '');
      const tt = mk('title', {}, pg); tt.textContent = `${p.name} · ${pin.id}${UGV.PIN_FUNC[key] ? ' — ' + UGV.PIN_FUNC[key] : ''}${v !== null ? ` (${v} V)` : ''}`;
      pg.addEventListener('pointerdown', e => e.stopPropagation());
      pg.addEventListener('click', e => { e.stopPropagation(); pinClick(key); });
    });
    dragNode(g, p);
  });
  if (selWire && !an.wires.some(w => w.key === selWire)) selWire = null;
  renderWarnings(); inspect(); live(UGV.Sim.tel || {});
}

/* ---------- Estado en vivo ---------- */
function fmtV(v) { return v.toFixed(1).replace('.', ','); }
function live(t) {
  if (!svg || UGV.activeTab !== 'circ') return;
  const act = { ENA: Math.abs(t.dutyL || 0), ENB: Math.abs(t.dutyR || 0), IN1: (t.dutyL || 0) > 0, IN2: (t.dutyL || 0) < 0, IN3: (t.dutyR || 0) > 0, IN4: (t.dutyR || 0) < 0,
    MA: Math.abs(t.dutyL || 0) * (t.okA ? 1 : 0), MB: Math.abs(t.dutyR || 0) * (t.okB ? 1 : 0) };
  wiresG.querySelectorAll('path.wire').forEach(p => { const s = p.dataset.sig; const a = s ? +act[s] : 0;
    p.classList.toggle('flow', a > .02); if (a > .02) p.style.animationDuration = (1.4 - Math.min(1, a) * 1.1).toFixed(2) + 's'; });
  const set = (id, txt) => { const e = nodesG.querySelector(`[data-live="${id}"]`); if (e) e.textContent = txt; };
  if (t.vbat !== undefined) {
    set('battery', `${fmtV(t.vbat)} V · ${Math.round(t.soc * 100)} % · ${fmtV(t.ibat)} A`);
    set('l298n', `A: ${Math.round(Math.abs(t.dutyL) * 255)}  B: ${Math.round(Math.abs(t.dutyR) * 255)} (PWM)`);
    set('motorA', t.okA ? (t.dutyL ? `${t.dutyL > 0 ? 'adelante' : 'atrás'} ${Math.round(Math.abs(t.dutyL) * 100)} %` : 'detenido') : 'sin señal');
    set('motorB', t.okB ? (t.dutyR ? `${t.dutyR > 0 ? 'adelante' : 'atrás'} ${Math.round(Math.abs(t.dutyR) * 100)} %` : 'detenido') : 'sin señal');
    set('rpi', t.piOn ? (t.frozen ? 'programa bloqueado' : (t.state || '').toLowerCase()) : (t.battery === false ? 'apagada (batería desconectada)' : 'sin alimentación'));
    set('buck', an && (an.vAt('buck.OUT+') || 0) > 4 ? '5 V' : 'sin entrada');
    set('switch', S.switchClosed ? 'encendido' : 'apagado');
  }
  renderBudget(t);
}

/* ---------- Pines y cables ---------- */
function pinClick(key) {
  if (!pending) { pending = key; selWire = null; render(); el.hint.textContent = 'Ahora toca el pin de destino. Esc para cancelar.'; el.hint.hidden = false; return; }
  if (pending === key) { cancelPending(); return; }
  const a = pending; pending = null; el.hint.hidden = true; tempPath.setAttribute('d', '');
  if (a.split('.')[0] === key.split('.')[0]) { UGV.emit('toast', 'Elige un pin de otra pieza.'); render(); return; }
  if (!UGV.addWire(a, key)) UGV.emit('toast', 'Esa conexión ya existe.');
  else { const w = UGV.analyze(UGV.Sim.st.vbat).warnings.filter(w => w.lvl === 'danger'); if (w.length) UGV.emit('toast', '⚠ ' + w[0].text); }
}
function cancelPending() { if (!pending) return; pending = null; tempPath.setAttribute('d', ''); el.hint.hidden = true; render(); }

/* ---------- Inspector ---------- */
function inspect() {
  const box = el.inspector; if (!box) return;
  if (selWire) {
    const w = an.wires.find(x => x.key === selWire); if (!w) { box.innerHTML = ''; return; }
    const nm = k => { const [p, pin] = k.split('.'); return `<b>${esc(UGV.part(p).name.split(' · ')[0])}</b> · ${esc(pin)}`; };
    const v = an.netV(w.a);
    box.innerHTML = `<h3>Conexión</h3><p>${nm(w.a)}<br>→ ${nm(w.b)}</p>
      <dl class="kv"><dt>Tipo</dt><dd>${{ pwr: 'Alimentación', gnd: 'Tierra común', sig: 'Señal', bus: 'Bus de datos', mot: 'Salida a motor' }[wireType(w)]}</dd>
      <dt>Tensión</dt><dd>${v === null ? 'sin fuente' : String(v).replace('.', ',') + ' V'}</dd>
      <dt>Origen</dt><dd>${w.custom ? 'agregada por ti' : 'cableado del proyecto'}</dd>
      ${UGV.PIN_FUNC[w.a] || UGV.PIN_FUNC[w.b] ? `<dt>Función</dt><dd>${esc(UGV.PIN_FUNC[w.a] || UGV.PIN_FUNC[w.b])}</dd>` : ''}</dl>
      <div class="row"><button class="btn small danger" id="delWire">Eliminar conexión</button></div>`;
    box.querySelector('#delWire').onclick = () => { UGV.removeWire(selWire); selWire = null; };
    return;
  }
  if (selPart) {
    const p = UGV.part(selPart);
    const rows = p.pins.map(pin => { const key = p.id + '.' + pin.id, v = an.netV(key);
      const to = an.wires.filter(w => w.a === key || w.b === key).map(w => (w.a === key ? w.b : w.a).replace('.', ' · ')).join(', ');
      return `<tr><td class="mono">${esc(pin.id)}</td><td>${to ? esc(to) : '<span class="muted">libre</span>'}</td><td class="mono">${v === null ? '–' : String(v).replace('.', ',') + ' V'}</td></tr>`; }).join('');
    box.innerHTML = `<h3>${esc(p.name)}</h3><p class="muted">${esc(p.desc)}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Pin</th><th>Conectado a</th><th>Tensión</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row">${p.core ? '' : `<button class="btn small" id="tglPart">${UGV.isOn(p.id) ? 'Quitar del robot' : 'Agregar al robot'}</button>`}
      ${p.id === 'switch' ? `<button class="btn small" id="tglSw">${S.switchClosed ? 'Apagar interruptor' : 'Encender interruptor'}</button>` : ''}
      <button class="btn small" id="seeCat">Ver ficha</button></div>`;
    const tg = box.querySelector('#tglPart'); if (tg) tg.onclick = () => UGV.setOn(p.id, !UGV.isOn(p.id));
    const sw = box.querySelector('#tglSw'); if (sw) sw.onclick = () => { S.switchClosed = !S.switchClosed; UGV.save(); UGV.emit('wires'); };
    box.querySelector('#seeCat').onclick = () => UGV.openPart(p.id);
    return;
  }
  box.innerHTML = `<h3>Cómo usar el esquema</h3><ul class="steps"><li>Arrastra una pieza por su título para moverla.</li><li>Toca un pin y luego otro para conectarlos.</li><li>Toca un cable para ver su tensión o eliminarlo.</li><li>Arrastra el fondo para moverte; usa la rueda para acercar.</li></ul>`;
}

function renderWarnings() {
  const w = an.warnings; const box = el.warnings; if (!box) return;
  if (!w.length) { box.innerHTML = '<p class="ok">✓ Sin problemas eléctricos detectados.</p>'; return; }
  const lbl = { danger: 'Peligro', warn: 'Atención', info: 'Nota' };
  box.innerHTML = w.map((x, i) => `<button class="warn lvl-${x.lvl}" data-i="${i}"><b>${lbl[x.lvl]}</b> ${esc(x.text)}</button>`).join('');
  box.querySelectorAll('.warn').forEach(b => b.onclick = () => { const x = w[+b.dataset.i]; const id = x.parts.find(id => UGV.isOn(id)) || x.parts[0];
    if (!UGV.isOn(id)) { UGV.openPart(id); return; } selPart = id; selWire = null; render(); centerOn(id); });
}

function renderBudget(t) {
  const box = el.budget; if (!box || t.vbat === undefined) return;
  const items = [
    ['Motor A', t.iL || 0],
    ['Motor B', t.iR || 0],
    ['Raspberry Pi (vía DC-DC)', an && an.rpiOn ? UGV.Sim.P.irpi * 5 / (Math.max(1, t.vbat) * .88) : 0]
  ];
  const tot = t.ibat, rem = UGV.Sim.P.capAh * t.soc, mins = tot > .005 ? rem / tot * 60 : Infinity;
  box.innerHTML = `<table><tbody>${items.map(([n, a]) => `<tr><td>${n}</td><td class="mono r">${(a * 1000).toFixed(0)} mA</td></tr>`).join('')}
    <tr class="tot"><td>Total desde la batería</td><td class="mono r">${(tot * 1000).toFixed(0)} mA</td></tr></tbody></table>
    <p class="muted small">Autonomía al ritmo actual: <b>${isFinite(mins) ? (mins > 600 ? '> 10 h' : Math.round(mins) + ' min') : '—'}</b> con ${Math.round(t.soc * 100)} % de carga (2600 mAh supuestos, 2 celdas en serie).</p>`;
}

/* ---------- Paleta ---------- */
function renderPalette() {
  const box = el.palette; if (!box) return;
  const item = p => `<div class="pal ${UGV.isOn(p.id) ? 'on' : ''}"><span class="dot c-${p.cat}"></span><span class="nm">${esc(p.name)}${p.need && !UGV.isOn(p.id) ? '<span class="pill need">falta</span>' : ''}</span>
    ${p.core ? '<span class="pill">base</span>' : `<button class="btn tiny" data-id="${p.id}">${UGV.isOn(p.id) ? 'Quitar' : 'Agregar'}</button>`}</div>`;
  const parts = UGV.PARTS.filter(p => p.sch);
  box.innerHTML = `<p class="sec-label">En el robot</p>${parts.filter(p => UGV.isOn(p.id)).map(item).join('')}<p class="sec-label">Recomendadas a futuro</p>${parts.filter(p => !UGV.isOn(p.id)).map(item).join('') || '<p class="muted small">No hay más piezas.</p>'}`;
  box.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { const id = b.dataset.id; UGV.setOn(id, !UGV.isOn(id)); if (UGV.isOn(id)) { selPart = id; selWire = null; render(); centerOn(id); } });
}

/* ---------- Arrastre, paneo y zoom ---------- */
function applyView() { world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
function toWorld(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; }
function dragNode(g, p) {
  let st = null;
  g.addEventListener('pointerdown', e => { if (pending) return; e.stopPropagation(); const w = toWorld(e), n = nodePos(p); st = { dx: w.x - n.x, dy: w.y - n.y, moved: false }; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if (!st) return; const w = toWorld(e); const x = Math.round((w.x - st.dx) / 6) * 6, y = Math.round((w.y - st.dy) / 6) * 6;
    S.sch[p.id] = [x, y]; st.moved = true; g.setAttribute('transform', `translate(${x},${y})`); redrawWires(); });
  g.addEventListener('pointerup', () => { if (!st) return; const moved = st.moved; st = null; if (moved) { UGV.save(); render(); } else { selPart = p.id; selWire = null; render(); } });
}
function redrawWires() { wiresG.querySelectorAll('.wg').forEach(g => { const w = an.wires.find(x => x.key === g.dataset.key); if (!w) return; const a = pinXY(w.a), b = pinXY(w.b); if (!a || !b) return; const d = wirePath(a, b); g.querySelectorAll('path').forEach(p => p.setAttribute('d', d)); });
  nodesG.querySelectorAll('.node').forEach(g => { const p = UGV.part(g.dataset.id); const n = nodePos(p); g.setAttribute('transform', `translate(${n.x},${n.y})`); }); }
function setupPanZoom() {
  let pan = null;
  svg.addEventListener('pointerdown', e => { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => {
    if (pending) { const a = pinXY(pending), w = toWorld(e); if (a) tempPath.setAttribute('d', wirePath(a, { x: w.x, y: w.y, side: w.x > a.x ? -1 : 1 })); }
    if (!pan) return; const dx = e.clientX - pan.x, dy = e.clientY - pan.y; if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true; view.x = pan.vx + dx; view.y = pan.vy + dy; applyView(); });
  svg.addEventListener('pointerup', () => { if (pan && !pan.moved) { if (pending) cancelPending(); else if (selWire || selPart) { selWire = selPart = null; render(); } } pan = null; });
  svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
}
function zoomAt(f, cx, cy) { const r = svg.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  const k = Math.max(.3, Math.min(2.5, view.k * f)); view.x = cx - (cx - view.x) * k / view.k; view.y = cy - (cy - view.y) * k / view.k; view.k = k; applyView(); }
function bounds() { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  UGV.PARTS.forEach(p => { if (!p.sch || !UGV.isOn(p.id)) return; const n = nodePos(p), h = pinLayout(p).h; x0 = Math.min(x0, n.x - 60); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + NW + 60); y1 = Math.max(y1, n.y + h); });
  return { x0, y0, x1, y1 }; }
function fit() { const r = svg.getBoundingClientRect(); if (!r.width) return; const b = bounds(), top = 62, bot = 54; const k = Math.min(1.2, (r.width - 32) / (b.x1 - b.x0), (r.height - top - bot) / (b.y1 - b.y0));
  view.k = k; view.x = (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k; view.y = top + (r.height - top - bot - (b.y1 - b.y0) * k) / 2 - b.y0 * k; applyView(); }
C.fit = fit;
function centerOn(id) { const p = UGV.part(id); if (!p || !p.sch) return; const r = svg.getBoundingClientRect(), n = nodePos(p);
  view.x = r.width / 2 - (n.x + NW / 2) * view.k; view.y = r.height / 2 - (n.y + 60) * view.k; applyView(); }
C.select = id => { selPart = id; selWire = null; render(); centerOn(id); };
})();
