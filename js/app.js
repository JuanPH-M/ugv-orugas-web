/* Interfaz: pestañas, controles, telemetría y avisos */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const Sim = UGV.Sim, S = UGV.state;
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Avisos ---------- */
let toastT;
UGV.on('toast', t => { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); });

/* ---------- Pestañas ---------- */
const HASH = { sim: 'simulador', circ: 'circuito', parts: 'piezas', tests: 'pruebas', proj: 'proyecto' };
const firstShow = {};
UGV.goTab = name => {
  UGV.activeTab = name;
  document.querySelectorAll('section.tab').forEach(s => s.hidden = s.dataset.tab !== name);
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-selected', a.dataset.tab === name));
  if (location.hash.slice(1) !== HASH[name]) history.replaceState(null, '', '#' + HASH[name]);
  if (name === 'sim') Sim.resize();
  if (name === 'circ') { if (!firstShow.circ) { firstShow.circ = true; requestAnimationFrame(UGV.Circuit.fit); } }
  if (name === 'parts') setTimeout(UGV.Catalog.ensureThumbs, 30);
};
document.querySelectorAll('.tabs a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); UGV.goTab(a.dataset.tab); }));
const fromHash = () => { const h = location.hash.slice(1); return Object.keys(HASH).find(k => HASH[k] === h) || 'sim'; };
addEventListener('hashchange', () => UGV.goTab(fromHash()));

/* ---------- Tema ---------- */
$('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('ugv-theme', next); } catch (_) { }
  UGV.emit('theme'); Sim.applyTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { UGV.emit('theme'); Sim.applyTheme(); });

/* ---------- Simulador ---------- */
Sim.init($('gl'), $('camOverlay'));
UGV.Circuit.init({ wrap: $('schWrap'), palette: $('palette'), inspector: $('inspector'), warnings: $('warnings'), budget: $('budget'), fit: $('cFit'), zin: $('cZin'), zout: $('cZout'), restore: $('cRestore'), hint: $('schHint') });
UGV.Catalog.init({ grid: $('pgrid'), filters: $('filters'), modal: $('modal') });

// vistas y capas
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => Sim.setView(b.dataset.view)));
UGV.on('view', v => document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v)));
const toggle = (id, fn) => { const b = $(id); b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); fn(on); }); };
toggle('tWires', on => Sim.setWires(on)); toggle('tOpen', on => Sim.setOpen(on));

// modo
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === 'auto' && !UGV.isOn('aruco')) { UGV.setOn('aruco', true); UGV.emit('toast', 'Marcadores ArUco agregados al piso. El robot va al más cercano y recorre el cuadrado.'); }
  Sim.setMode(b.dataset.mode);
}));
UGV.on('mode', m => { document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m)); $('hErrRow').hidden = m !== 'auto'; });

// joystick
const joy = $('joy'), knob = $('knob'); let jid = null, jx = 0, jy = 0;
const setKnob = () => { knob.style.left = (50 + jx * 36) + '%'; knob.style.top = (50 - jy * 36) + '%'; };
const jmove = e => { const r = joy.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = -((e.clientY - r.top) / r.height * 2 - 1);
  const m = Math.hypot(x, y) / .78; if (m > 1) { x /= m; y /= m; } jx = x / .78; jy = y / .78; setKnob(); Sim.setJoy(jx, jy); };
joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === jid) jmove(e); });
const jend = e => { if (e.pointerId === jid) { jid = null; jx = jy = 0; setKnob(); Sim.setJoy(0, 0); } };
joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);

$('vmax').addEventListener('input', e => { Sim.st.vmax = e.target.value / 100; $('vmaxLbl').textContent = e.target.value + '%'; });
$('slip').addEventListener('input', e => { Sim.st.slip = e.target.value / 100; $('slipLbl').textContent = 'χ = ' + fmt(Sim.st.slip); });
$('comp').addEventListener('change', e => { Sim.st.comp = e.target.checked; Sim.st.errAcc = Sim.st.errN = 0; });
$('tscale').addEventListener('change', e => { Sim.st.timeScale = +e.target.value; });
$('bReset').addEventListener('click', () => Sim.cmd('reset'));
$('bRecharge').addEventListener('click', () => { Sim.st.soc = 1; UGV.emit('toast', 'Batería cargada: 8,4 V (4,2 V por celda).'); });

// botones de la app
$('bLuces').addEventListener('click', () => { const on = $('bLuces').getAttribute('aria-pressed') !== 'true'; $('bLuces').setAttribute('aria-pressed', on); Sim.cmd('lights', on);
  if (on && !UGV.isOn('leds')) UGV.emit('toast', 'GPIO 2 encendido, pero faltan los LED. Agrégalos en Piezas o en Circuito.'); });
let actx, osc;
const hornOn = () => { Sim.cmd('horn', true);
  if (!UGV.isOn('buzzer')) { UGV.emit('toast', 'GPIO 4 activo, pero falta el buzzer.'); return; }
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); osc = actx.createOscillator(); const g = actx.createGain(); osc.type = 'square'; osc.frequency.value = 2300; g.gain.value = .04; osc.connect(g).connect(actx.destination); osc.start(); } catch (_) { } };
const hornOff = () => { Sim.cmd('horn', false); if (osc) { try { osc.stop(); } catch (_) { } osc = null; } };
$('bBocina').addEventListener('pointerdown', hornOn); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('bBocina').addEventListener(ev, hornOff));
$('bParar').addEventListener('click', () => { jx = jy = 0; setKnob(); Sim.cmd('stop'); });
$('bInicio').addEventListener('click', () => Sim.cmd('home'));
$('bBorrar').addEventListener('click', () => { Sim.cmd('clear'); UGV.emit('toast', 'Ruta borrada. El inicio ahora es la posición actual.'); });

// cajón de pieza seleccionada
UGV.on('select', id => {
  const d = $('drawer'); if (!id) { d.hidden = true; return; }
  const p = UGV.part(id); d.hidden = false;
  $('dName').textContent = p.name; $('dShort').textContent = p.short; $('dCat').textContent = UGV.CATS[p.cat]; $('dCat').className = 'chip c-' + p.cat;
  const fixed = id === 'chassis' || (UGV.PLACE[id] || {}).fixed;
  $('dRot').hidden = $('dReset').hidden = !!fixed; $('dToggle').hidden = !!p.core; $('dToggle').textContent = 'Quitar del robot';
});
$('dClose').addEventListener('click', () => Sim.select(null));
$('dInfo').addEventListener('click', () => { const n = $('dName').textContent; const p = UGV.PARTS.find(x => x.name === n); if (p) UGV.openPart(p.id); });
$('dRot').addEventListener('click', () => Sim.rotateSel());
$('dReset').addEventListener('click', () => Sim.resetSel());
$('dToggle').addEventListener('click', () => { const n = $('dName').textContent; const p = UGV.PARTS.find(x => x.name === n); if (p) { UGV.setOn(p.id, false); Sim.select(null); UGV.emit('toast', p.name + ' quitada. Puedes volver a agregarla en Piezas.'); } });
$('resetAll').addEventListener('click', () => { UGV.reset(); Sim.cmd('reset'); UGV.emit('toast', 'Se restauró la configuración original del robot.'); });

/* ---------- Telemetría ---------- */
const pinsMini = $('pinsMini');
pinsMini.innerHTML = [['ENA', 'GPIO 14'], ['IN1', 'GPIO 27'], ['IN2', 'GPIO 26'], ['IN3', 'GPIO 25'], ['IN4', 'GPIO 33'], ['ENB', 'GPIO 32']]
  .map(([p, g]) => `<div class="pinst" id="pm-${p}"><span>${p}</span><small>${g}</small><b>LOW</b></div>`).join('');
const setBar = (el, v) => { el.style.left = (v < 0 ? 50 + v * 50 : 50) + '%'; el.style.width = Math.abs(v) * 50 + '%'; };
UGV.on('telemetry', t => {
  if (UGV.activeTab !== 'sim') return;
  $('hV').textContent = fmt(t.v); $('hW').textContent = Math.round(t.w * 57.2958);
  $('hBat').textContent = `${fmt(t.vbat, 2)} V · ${Math.round(t.soc * 100)} %`;
  const bb = $('hBatBar'); bb.style.width = (t.soc * 100) + '%'; bb.dataset.lvl = t.soc < .15 ? 'low' : t.soc < .35 ? 'mid' : 'ok';
  $('hD').textContent = t.sonar ? (t.dist === null ? '> 400 cm' : Math.round(t.dist) + ' cm') : (UGV.isOn('sonar') ? 'sin conexión' : 'sin sensor');
  $('hErr').textContent = `${fmt(t.err || 0)} cm · RMS ${fmt(t.rms || 0)} cm`;
  setBar($('pwmA'), t.dutyL); setBar($('pwmB'), t.dutyR);
  $('pwmAv').textContent = Math.round(t.dutyL * 255); $('pwmBv').textContent = Math.round(t.dutyR * 255);
  const st = { ENA: Math.round(Math.abs(t.dutyL) * 255), ENB: Math.round(Math.abs(t.dutyR) * 255), IN1: t.dutyL > 0, IN2: t.dutyL < 0, IN3: t.dutyR > 0, IN4: t.dutyR < 0 };
  Object.entries(st).forEach(([k, v]) => { const el = $('pm-' + k); const pwm = k[0] === 'E'; el.querySelector('b').textContent = pwm ? (v ? 'PWM ' + v : '0') : (v ? 'HIGH' : 'LOW'); el.classList.toggle('hi', !!v); });
  $('tI').textContent = Math.round(t.ibat * 1000) + ' mA';
  const mins = t.ibat > .005 ? UGV.Sim.P.capAh * t.soc / t.ibat * 60 : Infinity;
  $('tAut').textContent = isFinite(mins) ? (mins > 600 ? '> 10 h' : Math.round(mins) + ' min') : '—';
  $('hMass').textContent = `${fmt(t.mass, 2)} kg`;
  drawChart();
  $('physNote').textContent = `Velocidad tope con la batería actual: ${Math.round(UGV.Sim.vTop())} cm/s (motor a ${fmt(t.vbat * 1, 1)} V menos 1,8 V del L298N).`;
  $('routeSec').textContent = (t.mode === 'auto' ? 'modo automático' : fmt(t.recT) + ' s guardados') + (t.replay ? ' · regresando' : '');
  $('lgEst').hidden = !t.est; $('lgRef').hidden = !(UGV.isOn('aruco') || t.mode === 'auto');
  drawRoute(t);
});

/* Mapa de la ruta */
const rc = $('route'), rg = rc.getContext('2d');
function drawRoute(t) {
  const r = rc.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (rc.width !== Math.round(r.width * dpr) || rc.height !== Math.round(r.height * dpr)) { rc.width = Math.round(r.width * dpr); rc.height = Math.round(r.height * dpr); }
  const W = rc.width, H = rc.height; rg.clearRect(0, 0, W, H);
  const st = Sim.st, o = st.origin, showRef = UGV.isOn('aruco') || t.mode === 'auto';
  const pts = st.path.concat([[st.x, st.z]]);
  let ext = showRef ? 85 : 60; pts.concat(st.estPath).forEach(([x, z]) => { ext = Math.max(ext, Math.abs(x - o.x) * 1.12, Math.abs(z - o.z) * 1.12); });
  if (showRef) ext = Math.max(ext, Math.abs(o.x) + 75, Math.abs(o.z) + 75);
  const s = Math.min(W, H) / 2 / ext, cx = W / 2, cy = H / 2, P = (x, z) => [cx + (x - o.x) * s, cy + (z - o.z) * s];
  rg.strokeStyle = css('--line'); rg.lineWidth = dpr; rg.beginPath(); rg.moveTo(cx, 0); rg.lineTo(cx, H); rg.moveTo(0, cy); rg.lineTo(W, cy); rg.stroke();
  if (showRef) { rg.setLineDash([4 * dpr, 4 * dpr]); rg.strokeStyle = css('--muted'); rg.beginPath(); [[60, -60], [60, 60], [-60, 60], [-60, -60], [60, -60]].forEach(([x, z], i) => { const [a, b] = P(x, z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke(); rg.setLineDash([]);
    Sim.markers.forEach(m => { const [a, b] = P(m.x, m.z); rg.fillStyle = css('--fg'); rg.fillRect(a - 3.5 * dpr, b - 3.5 * dpr, 7 * dpr, 7 * dpr); }); }
  if (st.estPath.length > 1) { rg.setLineDash([5 * dpr, 4 * dpr]); rg.strokeStyle = css('--w-5v'); rg.lineWidth = 2 * dpr; rg.beginPath(); st.estPath.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke(); rg.setLineDash([]); }
  rg.strokeStyle = css('--mint'); rg.lineWidth = 2.4 * dpr; rg.lineJoin = 'round'; rg.beginPath(); pts.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke();
  rg.fillStyle = css('--muted'); rg.font = `${11 * dpr}px "IBM Plex Sans", sans-serif`; rg.textAlign = 'center';
  rg.beginPath(); rg.arc(cx, cy, 4 * dpr, 0, 7); rg.fill(); rg.fillText('Inicio', cx, cy + 16 * dpr);
  const [rx, ry] = P(st.x, st.z); rg.save(); rg.translate(rx, ry); rg.rotate(-st.yaw);
  rg.fillStyle = css('--mint'); rg.beginPath(); rg.moveTo(11 * dpr, 0); rg.lineTo(-6 * dpr, 6 * dpr); rg.lineTo(-3 * dpr, 0); rg.lineTo(-6 * dpr, -6 * dpr); rg.closePath(); rg.fill(); rg.restore();
}


/* ---------- Carga, escenario, ruta dibujada y foto ---------- */
$('load').addEventListener('input', e => { const kg = +e.target.value; Sim.setLoad(kg); $('loadLbl').textContent = fmt(kg) + ' kg'; });
$('bDraw').addEventListener('click', () => { const on = $('bDraw').getAttribute('aria-pressed') !== 'true'; $('bDraw').setAttribute('aria-pressed', on); Sim.setDraw(on); });
UGV.on('draw', v => $('bDraw').setAttribute('aria-pressed', v));
UGV.on('custom', n => { $('wpCount').textContent = n + (n === 1 ? ' punto' : ' puntos'); });
$('bClearWp').addEventListener('click', () => { Sim.clearCustom(); $('wpCount').textContent = '0 puntos'; });
$('bAddObs').addEventListener('click', () => Sim.addObstacle());
$('bClrObs').addEventListener('click', () => Sim.clearObstacles());
$('bDefObs').addEventListener('click', () => Sim.resetObstacles());
$('bSnap').addEventListener('click', () => Sim.snapshot());

/* ---------- Descargas ---------- */
function download(name, text, type = 'text/csv;charset=utf-8') {
  const b = new Blob(['﻿' + text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('bCsv').addEventListener('click', () => { if (!Sim.log.length) { UGV.emit('toast', 'Todavía no hay datos: maneja el robot un momento.'); return; } download('telemetria-ugv.csv', Sim.csv()); });

/* ---------- Gráfica en vivo ---------- */
let chartVar = 'v';
document.querySelectorAll('[data-chart]').forEach(b => b.addEventListener('click', () => { chartVar = b.dataset.chart; document.querySelectorAll('[data-chart]').forEach(x => x.setAttribute('aria-pressed', x === b)); drawChart(); }));
const CH = { v: { lbl: 'cm/s', f: r => r.v }, i: { lbl: 'mA', f: r => r.i * 1000 }, vbat: { lbl: 'V', f: r => r.vbat }, err: { lbl: 'cm', f: r => r.err === '' ? null : r.err } };
function niceStep(range) { const p = Math.pow(10, Math.floor(Math.log10(range / 4))); for (const m of [1, 2, 2.5, 5, 10]) if (range / (m * p) <= 5) return m * p; return 10 * p; }
function drawChart() {
  const cv = $('chart'); if (!cv || UGV.activeTab !== 'sim') return; const g = cv.getContext('2d'), r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (!r.width) return;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const W = cv.width, H = cv.height, padL = 40 * dpr, padB = 18 * dpr, padT = 8 * dpr, padR = 8 * dpr; g.clearRect(0, 0, W, H);
  const rows = Sim.hist, c = CH[chartVar]; const vals = rows.map(c.f).filter(v => v !== null && isFinite(v));
  let lo = Math.min(0, ...vals), hi = Math.max(1, ...vals); if (chartVar === 'vbat') { lo = Math.min(6, ...vals); hi = Math.max(8.4, ...vals); }
  const stp = niceStep(hi - lo || 1); lo = Math.floor(lo / stp) * stp; hi = Math.ceil(hi / stp) * stp; if (hi === lo) hi = lo + stp;
  const X = i => padL + (W - padL - padR) * i / 599, Y = v => H - padB - (H - padB - padT) * (v - lo) / (hi - lo);
  g.font = `${10 * dpr}px "IBM Plex Mono", monospace`; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = lo; v <= hi + 1e-9; v += stp) { g.strokeStyle = css('--line'); g.lineWidth = dpr; g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke(); g.fillStyle = css('--muted'); g.fillText(String(+v.toFixed(2)).replace('.', ','), padL - 5 * dpr, Y(v)); }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(c.lbl, padL + 4 * dpr, padT + 10 * dpr);
  g.textAlign = 'right'; g.fillText('ahora', W - padR, H - 4 * dpr); g.textAlign = 'left'; g.fillText('hace 60 s', padL, H - 4 * dpr);
  const off = 600 - rows.length; g.strokeStyle = css('--mint'); g.lineWidth = 2 * dpr; g.lineJoin = 'round'; g.beginPath(); let started = false;
  rows.forEach((row, i) => { const v = c.f(row); if (v === null || !isFinite(v)) { started = false; return; } const x = X(i + off), y = Y(v); if (started) g.lineTo(x, y); else g.moveTo(x, y); started = true; });
  g.stroke();
  const lastRow = rows[rows.length - 1]; if (lastRow && c.f(lastRow) !== null) { g.fillStyle = css('--mint'); g.beginPath(); g.arc(X(599), Y(c.f(lastRow)), 3.5 * dpr, 0, 7); g.fill(); }
}

/* ---------- Banco de pruebas ---------- */
let testRes = [];
$('bRunTests').addEventListener('click', async () => {
  const b = $('bRunTests'); b.disabled = true; $('testsBody').innerHTML = '<tr><td colspan="3" class="muted">Ejecutando…</td></tr>';
  try { testRes = await Sim.runTests(m => { $('testsStatus').textContent = 'Ejecutando: ' + m + '…'; }); }
  catch (e) { console.error(e); $('testsStatus').textContent = 'No se pudieron completar las pruebas: ' + e.message; }
  b.disabled = false;
  if (testRes.length) {
    $('testsBody').innerHTML = testRes.map(r => `<tr><td>${r.prueba}</td><td class="mono"><b>${r.resultado}</b></td><td class="muted">${r.detalle}</td></tr>`).join('');
    $('testsStatus').textContent = `Listo: ${testRes.length} pruebas con ${fmt(Sim.robotMass(), 2)} kg de robot, χ = ${fmt(Sim.st.slip)} y batería al 90 %.`;
    $('bTestsCsv').disabled = $('bTestsCopy').disabled = false;
  }
});
const testsCsv = () => 'prueba,resultado,detalle\n' + testRes.map(r => [r.prueba, r.resultado, r.detalle].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
$('bTestsCsv').addEventListener('click', () => download('pruebas-simuladas-ugv.csv', testsCsv()));
$('bTestsCopy').addEventListener('click', () => { const txt = 'Prueba\tResultado\tDetalle\n' + testRes.map(r => [r.prueba, r.resultado, r.detalle].join('\t')).join('\n');
  navigator.clipboard.writeText(txt).then(() => UGV.emit('toast', 'Tabla copiada: pégala en Word o Excel.')).catch(() => UGV.emit('toast', 'No se pudo copiar; usa “Descargar CSV”.')); });

/* ---------- Código de la ESP32 ---------- */
$('bCode').addEventListener('click', () => {
  const { code, missing } = UGV.genCode(); const m = $('modal');
  m.querySelector('.m-body').innerHTML = `<div class="code-wrap"><h2 id="mTitle">Programa base para la ESP32</h2>
    <p class="muted">Generado con los pines del circuito actual. ${missing.length ? `<b class="warn-t">Faltan conexiones: ${missing.join(', ')}.</b>` : 'Todas las señales del L298N están conectadas.'} Ábrelo en Arduino IDE con la placa “ESP32 Dev Module”.</p>
    <div class="row"><button class="btn small" id="cCopy">Copiar código</button><button class="btn small" id="cDl">Descargar .ino</button></div>
    <pre class="code"><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre></div>`;
  m.hidden = false; document.body.classList.add('modal-open');
  $('cCopy').onclick = () => navigator.clipboard.writeText(code).then(() => UGV.emit('toast', 'Código copiado.')).catch(() => UGV.emit('toast', 'No se pudo copiar; usa “Descargar .ino”.'));
  $('cDl').onclick = () => download('ugv_orugas.ino', code, 'text/plain;charset=utf-8');
});

/* ---------- Presupuesto ---------- */
const prices = (() => { try { return JSON.parse(localStorage.getItem('ugv-precios') || '{}'); } catch (_) { return {}; } })();
const QTY = { aruco: 4 };
const money = v => '$ ' + Math.round(v).toLocaleString('es-CO');
const bomParts = () => UGV.PARTS.filter(p => p.id !== 'box');
function renderBom() {
  $('bomBody').innerHTML = bomParts().map(p => { const q = QTY[p.id] || 1, pr = +prices[p.id] || 0;
    return `<tr><td>${p.name}</td><td><span class="chip ${UGV.isOn(p.id) ? 'st-on' : 'st-off'}">${UGV.isOn(p.id) ? 'Montada' : 'Falta'}</span></td><td class="mono">${q}</td>
      <td><input class="price" type="number" min="0" step="500" inputmode="numeric" id="pr-${p.id}" value="${pr || ''}" placeholder="0" aria-label="Precio de ${p.name}"></td><td class="r mono" id="st-${p.id}">${money(q * pr)}</td></tr>`; }).join('');
  bomParts().forEach(p => $('pr-' + p.id).addEventListener('input', e => { prices[p.id] = +e.target.value || 0; try { localStorage.setItem('ugv-precios', JSON.stringify(prices)); } catch (_) { } $('st-' + p.id).textContent = money((QTY[p.id] || 1) * prices[p.id]); bomTotal(); }));
  bomTotal();
}
function bomTotal() { $('bomTotal').textContent = money(bomParts().reduce((s, p) => s + (QTY[p.id] || 1) * (+prices[p.id] || 0), 0)); }
$('bBomCsv').addEventListener('click', () => download('presupuesto-ugv.csv', 'pieza,estado,cantidad,precio_unitario_cop,subtotal_cop\n' + bomParts().map(p => { const q = QTY[p.id] || 1, pr = +prices[p.id] || 0; return `"${p.name}",${UGV.isOn(p.id) ? 'montada' : 'falta'},${q},${pr},${q * pr}`; }).join('\n')));
UGV.on('parts', renderBom); renderBom();

/* Tiles de la pestaña Proyecto */
const tiles = [['180 × 165 × 60', 'mm · chasis'], ['7,4 V', '2 × 18650 de 3,7 V'], ['≈ 0,8 kg', 'masa con electrónica'], ['≈ 40 cm/s', 'velocidad tope estimada'], ['2 A', 'por canal del L298N'], ['192.168.4.1', 'app de control WiFi']];
$('tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

UGV.goTab(fromHash());
})();
