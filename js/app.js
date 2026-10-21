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
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { if (b.dataset.view === 'field') { Sim.overview(); UGV.emit('view', 'field'); } else Sim.setView(b.dataset.view); }));
UGV.on('view', v => document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v)));
const toggle = (id, fn) => { const b = $(id); b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); fn(on); }); };
toggle('tWires', on => Sim.setWires(on)); toggle('tOpen', on => Sim.setOpen(on));

// modo
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === 'auto') { // la misión necesita la Raspberry Pi encendida y, en campo abierto, el GNSS
    const add = [];
    if (!UGV.isOn('rpi')) { S.on.rpi = true; add.push('Raspberry Pi'); }
    if (!UGV.isOn('buck')) { S.on.buck = true; add.push('convertidor DC-DC de 5 V'); }
    if (!UGV.isOn('gnss')) { S.on.gnss = true; add.push('receptor GNSS'); }
    if (add.length) { UGV.save(); UGV.emit('parts'); UGV.emit('wires'); UGV.emit('toast', 'Se agregaron ' + add.join(', ') + ': la Raspberry Pi ejecuta la misión y se localiza con el GNSS.'); }
  }
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
$('bRecharge').addEventListener('click', () => { Sim.st.soc = 1; Sim.st.ms.done = false; UGV.emit('toast', `Batería cargada: ${fmt(4.2 * Sim.cells())} V (4,2 V por celda).`); });
$('cells').value = String(Sim.cells());
$('cells').addEventListener('change', e => { S.cells = +e.target.value; UGV.save(); UGV.emit('parts'); UGV.emit('wires'); UGV.emit('toast', S.cells === 3 ? 'Tres celdas (11,1 V): los motores reciben ≈ 9,3 V después del L298N y el robot va casi al doble de rápido.' : 'Dos celdas (7,4 V): los motores reciben ≈ 5,6 V después del L298N.'); });
$('simspeed').addEventListener('change', e => { Sim.st.simSpeed = +e.target.value; });
$('gnssMode').value = S.gnssMode || 'auto';
$('gnssMode').addEventListener('change', e => { S.gnssMode = e.target.value; UGV.save(); UGV.emit('toast', S.gnssMode === 'rtk' ? 'RTK: error de ≈ 2 cm en campo abierto (≈ 45 cm bajo los árboles). Permite circular entre surcos.' : 'GNSS autónomo: error de ≈ 2 m, suficiente para el camino de servicio, no para las calles entre surcos.'); });
$('bLink').addEventListener('click', () => { const on = $('bLink').getAttribute('aria-pressed') !== 'true'; $('bLink').setAttribute('aria-pressed', on); $('bLink').textContent = on ? 'Restablecer enlace' : 'Cortar enlace LoRa'; Sim.setLinkCut(on);
  if (on) UGV.emit('toast', UGV.isOn('lora') ? 'Enlace LoRa cortado: si el robot se mueve, en 1 s entra en PARADA DE EMERGENCIA.' : 'Sin radio LoRa el robot depende del WiFi de respaldo; se simula igual la pérdida del latido del operador.'); });
$('bOverview').addEventListener('click', () => { Sim.overview(); UGV.emit('view', 'field'); });
$('bEstop').addEventListener('click', () => {
  if (!UGV.isOn('estop')) { UGV.setOn('estop', true); UGV.emit('toast', 'Se montó el paro de emergencia en la línea de potencia del L298N.'); }
  const on = !S.estopPressed; Sim.setEstop(on); $('bEstop').setAttribute('aria-pressed', on); $('bEstop').textContent = on ? 'Soltar paro de emergencia' : 'Paro de emergencia';
  if (!on) UGV.emit('toast', 'Paro liberado. Pulsa “Rearmar” para volver a operar.'); });
$('bEstop').setAttribute('aria-pressed', !!S.estopPressed); if (S.estopPressed) $('bEstop').textContent = 'Soltar paro de emergencia';
$('bRearm').addEventListener('click', () => Sim.cmd('rearm'));

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
  $('hD').textContent = t.sonar ? (t.dist === null ? '> 450 cm' : Math.round(t.dist) + ' cm') : (UGV.isOn('sonar') ? 'sin conexión' : 'sin sensor');
  const sb = $('hState'); sb.textContent = t.state; sb.dataset.s = t.state.split(' ')[0];
  $('hGnss').textContent = t.gnss ? `${t.gnss.rtk ? 'RTK' : 'autónomo'} ±${t.gnss.sigma >= 100 ? fmt(t.gnss.sigma / 100) + ' m' : Math.round(t.gnss.sigma) + ' cm'}${t.gnss.canopy ? ' · bajo árbol' : ''}` : (UGV.isOn('gnss') ? (t.rpiOK ? 'sin conexión USB' : 'Raspberry Pi apagada') : 'sin receptor');
  $('hSoil').textContent = `${t.soil}${Math.abs(t.grade) > .02 ? ' · ' + Math.round(t.grade * 57.2958) + '°' : ''}`;
  $('hTrips').textContent = `${t.ms.trips} ${t.ms.trips === 1 ? 'viaje' : 'viajes'} · ${fmt(t.ms.kg)} kg`;
  $('haltBanner').hidden = !t.halt; if (t.halt) $('haltWhy').textContent = t.halt;
  const chip = (ok, txt) => `<span class="lk ${ok ? 'on' : ''}">${txt}</span>`;
  $('links').innerHTML = chip(t.rpiOK, 'UART Pi ⇄ ESP32') + chip(t.gnssOK, 'GNSS') + chip(t.loraOK && !t.linkCut, t.linkCut ? 'LoRa cortado' : 'LoRa');
  const cf = $('bConfirm'); cf.disabled = !t.ms.wait; cf.textContent = t.ms.wait === 'acopio' ? 'Confirmar descarga' : 'Confirmar carga';
  renderMission(t.ms);
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
  $('physNote').textContent = `Velocidad tope en el camino con la batería actual: ${Math.round(UGV.Sim.vTop())} cm/s (${fmt(t.vbat * 1, 1)} V menos 1,8 V del L298N, ${t.cells} celdas).`;
  $('routeSec').textContent = (t.mode === 'auto' ? 'misión por puntos' : fmt(t.recT) + ' s guardados') + (t.replay ? ' · regresando' : '');
  $('lgEst').hidden = !t.est; $('lgRef').hidden = false;
  drawRoute(t);
});

/* Mapa de la ruta */
const rc = $('route'), rg = rc.getContext('2d');
function drawRoute(t) {
  const r = rc.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (rc.width !== Math.round(r.width * dpr) || rc.height !== Math.round(r.height * dpr)) { rc.width = Math.round(r.width * dpr); rc.height = Math.round(r.height * dpr); }
  const W = rc.width, H = rc.height; rg.clearRect(0, 0, W, H);
  const st = Sim.st, ms = Sim.mission(), pts = st.path.concat([[st.x, st.z]]);
  // encuadre: la misión, el recorrido y el robot
  let x0 = st.x, x1 = st.x, z0 = st.z, z1 = st.z;
  ms.map(p => [p.x, p.z]).concat(pts.slice(-800)).forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  const pad = 180, cxw = (x0 + x1) / 2, czw = (z0 + z1) / 2, s = Math.min(W / (x1 - x0 + 2 * pad), H / (z1 - z0 + 2 * pad));
  const P = (x, z) => [W / 2 + (x - cxw) * s, H / 2 + (z - czw) * s];
  const rect = (q, fill) => { const [a, b] = P(q.x0, q.z0), [c, d] = P(q.x1, q.z1); rg.fillStyle = fill; rg.fillRect(a, b, c - a, d - b); };
  Sim.ROADS.forEach(q => rect(q, 'rgba(181,157,118,.45)'));
  Sim.LOTS.forEach(l => l.rows.forEach(rw => rect({ x0: l.x0, x1: l.x1, z0: rw - 42, z1: rw + 42 }, 'rgba(47,107,42,.55)')));
  Sim.MUD.forEach(m => { const [a, b] = P(m.x, m.z); rg.fillStyle = 'rgba(80,56,34,.5)'; rg.beginPath(); rg.arc(a, b, m.r * s, 0, 7); rg.fill(); });
  Sim.TREES.forEach(m => { const [a, b] = P(m.x, m.z); rg.strokeStyle = 'rgba(47,107,42,.6)'; rg.lineWidth = dpr; rg.setLineDash([3 * dpr, 3 * dpr]); rg.beginPath(); rg.arc(a, b, m.r * s, 0, 7); rg.stroke(); rg.setLineDash([]); });
  rect(Sim.SHED, 'rgba(120,120,120,.35)');
  rg.setLineDash([5 * dpr, 4 * dpr]); rg.strokeStyle = css('--w-bus'); rg.lineWidth = 1.6 * dpr; rg.beginPath(); ms.forEach((p, i) => { const [a, b] = P(p.x, p.z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke(); rg.setLineDash([]);
  if (st.estPath.length > 1) { rg.setLineDash([5 * dpr, 4 * dpr]); rg.strokeStyle = css('--w-5v'); rg.lineWidth = 2 * dpr; rg.beginPath(); st.estPath.slice(-1500).forEach(([x, z], i) => { const [a, b] = P(x, z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke(); rg.setLineDash([]); }
  rg.strokeStyle = css('--mint'); rg.lineWidth = 2.4 * dpr; rg.lineJoin = 'round'; rg.beginPath(); pts.slice(-1500).forEach(([x, z], i) => { const [a, b] = P(x, z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke();
  if (st.gnss) { const [a, b] = P(st.gnss.x, st.gnss.z); rg.fillStyle = '#7b4fc9'; rg.beginPath(); rg.arc(a, b, 3 * dpr, 0, 7); rg.fill(); }
  rg.font = `600 ${10.5 * dpr}px "IBM Plex Sans", sans-serif`; rg.textAlign = 'center';
  const col = { carga: css('--w-5v'), acopio: css('--stop'), paso: css('--w-bus') };
  ms.forEach((p, i) => { const [a, b] = P(p.x, p.z); rg.fillStyle = col[p.tipo]; rg.beginPath(); rg.arc(a, b, (i === st.ms.i ? 6 : 4.5) * dpr, 0, 7); rg.fill(); rg.fillStyle = css('--fg'); rg.fillText(p.id === 'ACOPIO' ? 'Acopio' : p.id, a, b - 9 * dpr); });
  const [rx, ry] = P(st.x, st.z); rg.save(); rg.translate(rx, ry); rg.rotate(-st.yaw);
  rg.fillStyle = css('--mint'); rg.beginPath(); rg.moveTo(11 * dpr, 0); rg.lineTo(-6 * dpr, 6 * dpr); rg.lineTo(-3 * dpr, 0); rg.lineTo(-6 * dpr, -6 * dpr); rg.closePath(); rg.fill(); rg.restore();
}


/* ---------- Misión por puntos ---------- */
const TIPO = { carga: 'punto de carga', paso: 'paso', acopio: 'acopio · descarga' };
let msSig = '';
function renderMission(m) {
  const list = Sim.mission(), sig = list.map(p => p.id).join() + m.i + m.dir + m.wait + m.done;
  if (sig === msSig) return; msSig = sig;
  $('missionList').innerHTML = list.map((p, i) => { const cur = i === m.i && !m.done, wait = m.wait && ((m.dir > 0 && i === m.i - 1) || (m.dir < 0 && i === m.i + 1) || (m.dir < 0 && m.i === -1 && i === 0));
    return `<li class="${cur ? 'cur' : ''} ${wait ? 'wait' : ''} t-${p.tipo}"><b>${p.id === 'ACOPIO' ? 'Acopio' : p.id}</b><span>${TIPO[p.tipo]}</span><small class="mono">${(p.x / 100).toFixed(1).replace('.', ',')} ; ${(-p.z / 100).toFixed(1).replace('.', ',')} m</small>${cur ? `<em>${m.dir > 0 ? 'hacia acá' : 'regreso'}</em>` : ''}${wait ? '<em>esperando</em>' : ''}</li>`; }).join('');
}
UGV.on('mission', () => { msSig = ''; renderMission(Sim.st.ms); });
renderMission(Sim.st.ms);
$('bConfirm').addEventListener('click', () => Sim.confirm());
$('autoConfirm').addEventListener('change', e => { Sim.st.ms.autoConfirm = e.target.checked; });
Sim.st.ms.autoConfirm = $('autoConfirm').checked;

/* ---------- Carga, escenario, ruta dibujada y foto ---------- */
$('load').addEventListener('input', e => { const kg = +e.target.value; Sim.setLoad(kg); $('loadLbl').textContent = fmt(kg) + ' kg'; });
$('bDraw').addEventListener('click', () => { const on = $('bDraw').getAttribute('aria-pressed') !== 'true'; $('bDraw').setAttribute('aria-pressed', on); Sim.setDraw(on); });
UGV.on('draw', v => $('bDraw').setAttribute('aria-pressed', v));
UGV.on('custom', n => { $('wpCount').textContent = n ? n + (n === 1 ? ' punto dibujado' : ' puntos dibujados') : 'misión de la finca'; });
$('bClearWp').addEventListener('click', () => { Sim.clearCustom(); $('bDraw').setAttribute('aria-pressed', false); Sim.setDraw(false); UGV.emit('toast', 'Misión de la finca: A (carga) → B → C → D → acopio.'); });
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
  let lo = Math.min(0, ...vals), hi = Math.max(1, ...vals); if (chartVar === 'vbat') { lo = Math.min(3 * Sim.cells(), ...vals); hi = Math.max(4.2 * Sim.cells(), ...vals); }
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
    $('testsStatus').textContent = `Listo: ${testRes.length} pruebas en la finca virtual con ${fmt(Sim.robotMass(), 2)} kg de robot, χ = ${fmt(Sim.st.slip)}, ${Sim.cells()} celdas y batería al 90 %.`;
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

$('bCodePi').addEventListener('click', () => {
  const code = UGV.genPiCode(); const m = $('modal');
  m.querySelector('.m-body').innerHTML = `<div class="code-wrap"><h2 id="mTitle">Programa de la Raspberry Pi (Python 3)</h2>
    <p class="muted">Unidad central del vehículo: lee el GNSS, fusiona la posición, ejecuta la misión por puntos con Pure Pursuit y manda las velocidades de las orugas a la ESP32 por el puerto serie, con el mismo formato de tramas del firmware. Instala <code>pip install pyserial</code> y ejecútalo con <code>python3 ugv_rpi.py mision.json</code>.</p>
    <div class="row"><button class="btn small" id="cCopy">Copiar código</button><button class="btn small" id="cDl">Descargar .py</button><button class="btn small" id="cMis">Descargar misión (JSON)</button></div>
    <pre class="code"><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre></div>`;
  m.hidden = false; document.body.classList.add('modal-open');
  $('cCopy').onclick = () => navigator.clipboard.writeText(code).then(() => UGV.emit('toast', 'Código copiado.')).catch(() => UGV.emit('toast', 'No se pudo copiar; usa “Descargar .py”.'));
  $('cDl').onclick = () => download('ugv_rpi.py', code, 'text/x-python;charset=utf-8');
  $('cMis').onclick = () => download('mision.json', UGV.missionJSON(), 'application/json;charset=utf-8');
});

/* ---------- Presupuesto ---------- */
/* Precios verificados en Electronilab (oct. 2026, IVA incluido) que usa el informe; los demás quedan por cotizar */
const REF_PRICES = { chassis: 52300, esp32: 38500, rpi: 279900, buck: 9900, sonar: 36900, gnss: 67300, lora: 37500 };
const prices = (() => { let p = {}; try { p = JSON.parse(localStorage.getItem('ugv-precios') || '{}'); } catch (_) { } return Object.assign({}, REF_PRICES, p); })();
const QTY = { aruco: 1, lora: 2 };
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
const tiles = [['36 × 36 m', 'parcela de la finca virtual'], ['A → B → C → acopio', 'misión por puntos'], ['≈ 2 m · 2 cm', 'GNSS autónomo · RTK'], ['15°', 'pendiente de diseño'], ['≈ $ 781.500', 'componentes verificados'], ['≈ 1 %', 'del precio de un robot comercial']];
$('tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

UGV.goTab(fromHash());
})();
