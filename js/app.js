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
const HASH = { sim: 'simulador', circ: 'circuito', parts: 'piezas', proj: 'proyecto' };
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

/* Tiles de la pestaña Proyecto */
const tiles = [['180 × 165 × 60', 'mm · chasis'], ['7,4 V', '2 × 18650 de 3,7 V'], ['≈ 0,8 kg', 'masa con electrónica'], ['≈ 40 cm/s', 'velocidad tope estimada'], ['2 A', 'por canal del L298N'], ['192.168.4.1', 'app de control WiFi']];
$('tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

UGV.goTab(fromHash());
})();
