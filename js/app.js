/* Interfaz: pestañas, controles, recorrido programado, telemetría y avisos */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const Sim = UGV.Sim, S = UGV.state;
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Avisos ---------- */
let toastT;
UGV.on('toast', t => { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3400); });

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
Sim.init($('gl'));
UGV.Circuit.init({ wrap: $('schWrap'), palette: $('palette'), inspector: $('inspector'), warnings: $('warnings'), budget: $('budget'), fit: $('cFit'), zin: $('cZin'), zout: $('cZout'), restore: $('cRestore'), hint: $('schHint') });
UGV.Catalog.init({ grid: $('pgrid'), filters: $('filters'), modal: $('modal') });

// vistas y capas
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { if (b.dataset.view === 'field') { Sim.overview(); UGV.emit('view', 'field'); } else Sim.setView(b.dataset.view); }));
UGV.on('view', v => document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v)));
const toggle = (id, fn) => { const b = $(id); b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); fn(on); }); };
toggle('tWires', on => Sim.setWires(on)); toggle('tOpen', on => Sim.setOpen(on));

// modo
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === 'auto') { Sim.setMode('auto'); $('autoTxt').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else Sim.setMode('remoto');
}));
UGV.on('mode', m => { document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === (m === 'recorrido' ? 'auto' : m))); });

// joystick (hace de celular)
const joy = $('joy'), knob = $('knob'); let jid = null, jx = 0, jy = 0;
const setKnob = () => { knob.style.left = (50 + jx * 36) + '%'; knob.style.top = (50 - jy * 36) + '%'; };
const jmove = e => { const r = joy.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = -((e.clientY - r.top) / r.height * 2 - 1);
  const m = Math.hypot(x, y) / .78; if (m > 1) { x /= m; y /= m; } jx = x / .78; jy = y / .78; setKnob(); Sim.setJoy(jx, jy); };
joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === jid) jmove(e); });
const jend = e => { if (e.pointerId === jid) { jid = null; jx = jy = 0; setKnob(); Sim.setJoy(0, 0); } };
joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);

$('vmax').addEventListener('input', e => { Sim.st.vmax = e.target.value / 100; $('vmaxLbl').textContent = e.target.value + ' %'; });
$('slip').addEventListener('input', e => { Sim.st.slip = e.target.value / 100; $('slipLbl').textContent = 'χ = ' + fmt(Sim.st.slip); Sim.planRoute(); });
$('mism').addEventListener('input', e => { Sim.st.mismatch = e.target.value / 100; $('mismLbl').textContent = String(e.target.value).replace('.', ',') + ' %'; });
$('factor').addEventListener('input', e => { Sim.st.factorDer = e.target.value / 100; $('factorLbl').textContent = fmt(Sim.st.factorDer, 3); });
$('timeout').addEventListener('change', e => { Sim.st.timeoutMs = +e.target.value; });
$('tscale').addEventListener('change', e => { Sim.st.timeScale = +e.target.value; });
$('simspeed').addEventListener('change', e => { Sim.st.simSpeed = +e.target.value; });
$('bReset').addEventListener('click', () => Sim.cmd('reset'));
$('bInicio').addEventListener('click', () => { $('surface').value = 'finca'; Sim.toMark('finca'); UGV.emit('toast', 'Robot en su puesto, mirando al norte, como al encender la Raspberry Pi.'); });
$('bRecharge').addEventListener('click', () => { Sim.st.soc = 1; UGV.emit('toast', 'Batería cargada: 8,4 V (4,2 V por celda).'); });
$('bParar').addEventListener('click', () => { jx = jy = 0; setKnob(); Sim.cmd('stop'); if (Sim.st.wifiCut) UGV.emit('toast', 'Sin Wi-Fi la orden «parar» no llega: la Raspberry Pi se detendrá sola al pasar el tiempo de parada.'); });
$('bBorrar').addEventListener('click', () => { Sim.cmd('clear'); UGV.emit('toast', 'Ruta borrada.'); });
$('bOverview').addEventListener('click', () => { Sim.overview(); UGV.emit('view', 'field'); });
$('bSnap').addEventListener('click', () => Sim.snapshot());
toggle('bBench', on => { Sim.setBench(on); if (on) UGV.emit('toast', 'Vehículo levantado en el banco (prueba P1): las orugas giran sin tocar el piso.'); });
UGV.on('bench', on => $('bBench').setAttribute('aria-pressed', on));
toggle('bWifi', on => { Sim.setWifiCut(on); $('bWifi').textContent = on ? 'Restablecer Wi-Fi' : 'Cortar Wi-Fi del celular';
  UGV.emit('toast', on ? 'Wi-Fi cortado: las órdenes del celular ya no llegan a la Raspberry Pi.' : 'Wi-Fi restablecido.'); });
toggle('bFreeze', on => { if (!Sim.pi.on) { $('bFreeze').setAttribute('aria-pressed', false); UGV.emit('toast', 'La Raspberry Pi está apagada.'); return; }
  Sim.setFrozen(on); $('bFreeze').textContent = on ? 'Reiniciar el programa' : 'Bloquear el programa';
  UGV.emit('toast', on ? 'Programa bloqueado: los pines quedan como estaban y la parada sin órdenes ya no funciona. Desconecta la batería.' : 'El programa se reinicia y deja los motores en cero.'); });
const syncBatt = () => { const off = S.batteryOn === false; $('bBatt').setAttribute('aria-pressed', off); $('bBatt').textContent = off ? 'Conectar batería' : 'Desconectar batería (corte total)'; };
$('bBatt').addEventListener('click', () => { const off = S.batteryOn !== false; Sim.setBattery(!off); syncBatt();
  if (off) { $('bFreeze').setAttribute('aria-pressed', false); $('bFreeze').textContent = 'Bloquear el programa'; } else UGV.emit('toast', 'Batería conectada: la Raspberry Pi arranca y el programa deja los motores en cero.'); });
syncBatt();

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
$('resetAll').addEventListener('click', () => { UGV.reset(); syncBatt(); Sim.cmd('reset'); UGV.emit('toast', 'Se restauró la configuración original del robot.'); });

/* ---------- Recorrido programado (editor igual al de la página del celular) ---------- */
const TIPOS = { avanzar: 'Avanzar', retroceder: 'Retroceder', izquierda: 'Girar a la izq.', derecha: 'Girar a la der.', pausa: 'Pausa' };
function leer() { return [...$('tramos').querySelectorAll('tr')].map(tr => { const [v, d] = tr.querySelectorAll('input'); return { tipo: tr.querySelector('select').value, velocidad: +v.value || 0, duracion: Math.max(.1, +d.value || .1) }; }); }
function aplicar() { Sim.setRoute(leer()); }
function fila(t) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="n mono"></td><td><select aria-label="Tipo de tramo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === t.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><input type="number" min="0" max="100" step="5" value="${t.velocidad}" aria-label="Velocidad en %"></td><td><input type="number" min="0.1" max="60" step="0.1" value="${t.duracion}" aria-label="Duración en s"></td>
    <td><button class="btn tiny" title="Quitar tramo" aria-label="Quitar tramo">✕</button></td>`;
  const sel = tr.querySelector('select'), vel = tr.querySelector('input');
  const sync = () => { vel.disabled = sel.value === 'pausa'; if (vel.disabled) vel.value = 0; };
  sel.addEventListener('change', () => { sync(); if (sel.value !== 'pausa' && !+vel.value) vel.value = 60; aplicar(); });
  tr.querySelectorAll('input').forEach(i => i.addEventListener('input', aplicar));
  tr.querySelector('button').addEventListener('click', () => { tr.remove(); aplicar(); });
  $('tramos').appendChild(tr); sync();
}
function pintarTramos(r) {
  if (document.activeElement && $('tramos').contains(document.activeElement)) { resumen(r); return; } // no rehacer mientras se edita
  $('tramos').innerHTML = ''; r.forEach(fila); resumen(r);
}
function resumen(r) {
  document.querySelectorAll('#tramos td.n').forEach((td, i) => td.textContent = i + 1);
  const p = Sim.st.plan, len = p ? p.pts.reduce((s, q, i, a) => i ? s + Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) : 0, 0) : 0;
  $('tramosTot').textContent = `${r.length} tramos · ${fmt(r.reduce((s, t) => s + t.duracion, 0))} s · ≈ ${Math.round(len)} cm previstos en superficie firme`;
}
UGV.on('route', pintarTramos); pintarTramos(Sim.route);
$('bAddT').addEventListener('click', () => { fila({ tipo: 'avanzar', velocidad: 60, duracion: 2 }); aplicar(); });
$('bAbc').addEventListener('click', () => { Sim.setRoute(Sim.defaultRoute()); UGV.emit('toast', 'Recorrido A-B-C: 200 cm hacia B, giro de 90° a la derecha y 150 cm hacia C (tiempos calculados para superficie firme).'); });
$('bRun').addEventListener('click', () => { aplicar(); if (Sim.runRoute()) UGV.emit('toast', 'Recorrido iniciado: la Raspberry Pi cumple cada tramo por tiempo.'); });
$('surface').addEventListener('change', e => { Sim.toMark(e.target.value); });
$('bJson').addEventListener('click', () => download('recorrido-' + $('surface').value + '.json', JSON.stringify({ nombre: 'A-B-C ' + $('surface').value, tramos: Sim.route }, null, 2), 'application/json;charset=utf-8'));
$('bImport').addEventListener('click', () => $('fImport').click());
$('fImport').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()), t = Array.isArray(d) ? d : d.tramos; if (!Array.isArray(t) || !t.every(x => Sim.TIPOS[x.tipo])) throw 0; Sim.setRoute(t); UGV.emit('toast', 'Recorrido importado.'); }
  catch (_) { UGV.emit('toast', 'El archivo no es un recorrido válido.'); } e.target.value = ''; });
UGV.on('routeEnd', () => { if (Sim.st.mode === 'recorrido') Sim.setMode('remoto'); });

/* ---------- Modos autónomo y temporal ---------- */
const F = Sim.FINCA, ptName = id => id ? (id === 'ALMACEN' ? 'Almacén' : id === 'PUESTO' ? 'Puesto' : id) : 'desconocido';
const paradas = Object.entries(F.puntos).filter(([, q]) => q.tipo !== 'cruce');
$('ptGrid').innerHTML = paradas.map(([id, q]) => `<button class="btn small" data-p="${id}">${ptName(id)}<small>${esc(q.nombre)}</small></button>`).join('');
$('ptGrid').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { Sim.auto.ir(b.dataset.p); }));
$('posSel').innerHTML = Object.entries(F.puntos).map(([id, q]) => `<option value="${id}">${id} · ${esc(q.nombre)}</option>`).join('');
$('esperarOrden').addEventListener('change', e => { Sim.st.esperarOrden = e.target.checked; });
$('bTour').addEventListener('click', () => Sim.auto.recorrido(false));
$('bCero').addEventListener('click', () => Sim.auto.recorrido(true));
$('bSig').addEventListener('click', () => Sim.auto.siguiente());
$('bVolver').addEventListener('click', () => Sim.auto.ir(F.inicio));
$('bPos').addEventListener('click', () => { if (Sim.auto.posicion($('posSel').value)) { $('surface').value = 'finca'; UGV.emit('toast', `Posición indicada: ${$('posSel').value}.`); } });
$('bCal').addEventListener('click', () => Sim.auto.calibrar());
const temporal = () => { Sim.st.temporal = $('modoMis').value === 'temporal' ? { limite_s: +$('limS').value, al_terminar: $('alTerm').value } : null; };
$('modoMis').addEventListener('change', () => { $('temOpc').hidden = $('modoMis').value !== 'temporal'; temporal(); });
['limS', 'alTerm'].forEach(id => $(id).addEventListener('change', temporal));
$('bPausa').addEventListener('click', () => { if (Sim.pi.plan && Sim.pi.modo === 'AUTOMÁTICO') Sim.auto.pausar(); else Sim.auto.reanudar(); });
$('bManual').addEventListener('click', () => { if (Sim.auto.manual()) UGV.emit('toast', 'Control manual: la misión se canceló.'); });
$('bInstr').addEventListener('click', () => Sim.auto.instrucciones($('instrTxt').value));
$('bCoord').addEventListener('click', () => Sim.auto.coordenadas([{ x_m: $('cX').value, y_m: $('cY').value, nombre: 'destino' }]));
const calTxt = c => { $('calTxt').textContent = c.cm_s ? `avance ${fmt(c.cm_s, 2)} cm/s · giro ${fmt(c.grados_s, 2)} °/s a ${c.vel_auto} % · espera ${fmt(c.espera_s, 0)} s` : 'sin calibrar'; };
UGV.on('calib', calTxt); calTxt(Sim.st.cfg);
const syncFactor = f => { $('factor').value = Math.round(f * 100); $('factorLbl').textContent = fmt(f, 3); }; UGV.on('factor', syncFactor); syncFactor(Sim.st.factorDer);
function pintarAuto(t) {
  const marcha = !!t.auto && t.state === 'AUTOMÁTICO', ocupado = marcha || !!t.rec, sinPos = !t.pos, pz = t.pose || {};
  const donde = t.pos ? ptName(t.pos) : pz.x !== null && pz.x !== undefined ? `x ${fmt(pz.x / 100, 2)} m, y ${fmt(pz.y / 100, 2)} m${pz.aprox ? ' (aproximada)' : ''}` : 'un lugar desconocido';
  $('autoTxt').textContent = t.state === 'ESPERANDO ORDEN' ? `En ${ptName(t.pos)}: esperando tu orden. «Siguiente punto» va a ${ptName(t.auto && t.auto.destino) || 'fin'}; o elige otro punto.`
    : t.state === 'PAUSADO' ? `${t.auto.nombre}: en pausa. «Reanudar» sigue desde aquí; «Tomar control manual» la cancela.`
    : t.auto && t.state.startsWith('DETENIDO') ? `${t.auto.nombre}: detenida por seguridad (sin órdenes del celular). «Reanudar» cuando vuelva la conexión.`
    : t.auto ? `${t.auto.nombre}: ${t.auto.nodos.map(ptName).join(' → ')} · ahora hacia ${ptName(t.auto.hacia)}` + (t.auto.limite ? ` · quedan ${Math.ceil(t.auto.restante)} s` : '')
    : t.state === 'TIEMPO CUMPLIDO' ? `Se cumplió el tiempo: el robot se detuvo en ${donde}.`
    : sinPos ? (pz.x !== null && pz.x !== undefined ? `Está en ${donde}: sirven las rutas en metros o por coordenadas; para ir a un punto del mapa, indícalo con «El robot está aquí».` : 'No se sabe dónde está el robot: indícalo con «El robot está aquí».')
    : `Listo en ${ptName(t.pos)} · próximo del recorrido: ${ptName(F.orden[t.tourI] || F.inicio)}`;
  const pr = $('autoProg'); pr.hidden = !t.auto; if (t.auto) pr.firstElementChild.style.width = t.auto.progreso + '%';
  $('bPausa').disabled = !(t.auto && ['AUTOMÁTICO', 'PAUSADO', 'DETENIDO POR SEGURIDAD'].includes(t.state));
  $('bPausa').textContent = t.auto && t.state !== 'AUTOMÁTICO' ? 'Reanudar' : 'Pausar';
  $('bManual').disabled = !t.auto || t.state === 'AUTOMÁTICO';
  ['bInstr', 'bCoord'].forEach(id => $(id).disabled = ocupado);
  if (!t.auto && Sim.st.calSoc !== undefined && Math.abs(Sim.st.soc - Sim.st.calSoc) > .015) $('autoTxt').textContent += ' · La batería cambió desde la calibración: vuelve a calibrar para no salirse del camino.';
  $('autoSub').textContent = t.auto ? ({ 'ESPERANDO ORDEN': 'esperando orden', PAUSADO: 'en pausa', 'DETENIDO POR SEGURIDAD': 'detenida' }[t.state] || (t.auto.limite ? 'temporal · en marcha' : 'en marcha')) : 'manual / listo';
  $('bSig').disabled = t.state !== 'ESPERANDO ORDEN';
  ['bTour', 'bCero', 'bVolver'].forEach(id => $(id).disabled = ocupado || sinPos);
  $('ptGrid').querySelectorAll('button').forEach(b => { b.disabled = ocupado || sinPos || b.dataset.p === t.pos; b.classList.toggle('aqui', b.dataset.p === t.pos); });
}

/* ---------- Telemetría ---------- */
$('pinsMini').innerHTML = UGV.SIGNALS.map(([p, , g, f]) => `<div class="pinst" id="pm-${p}"><span>${p}</span><small>GPIO ${g} · ${f}</small><b>LOW</b></div>`).join('');
const setBar = (el, v) => { el.style.left = (v < 0 ? 50 + v * 50 : 50) + '%'; el.style.width = Math.abs(v) * 50 + '%'; };
UGV.on('telemetry', t => {
  if (UGV.activeTab !== 'sim') return;
  $('hV').textContent = fmt(t.v); $('hW').textContent = Math.round(t.w * 57.2958);
  $('hBat').textContent = t.battery ? `${fmt(t.vbat, 2)} V · ${Math.round(t.soc * 100)} %` : 'desconectada';
  const bb = $('hBatBar'); bb.style.width = (t.battery ? t.soc * 100 : 0) + '%'; bb.dataset.lvl = t.soc < .15 ? 'low' : t.soc < .35 ? 'mid' : 'ok';
  const sb = $('hState'); sb.textContent = t.state; sb.dataset.s = t.state.startsWith('DETENIDO') || t.state.startsWith('PROGRAMA') ? 'PARADA' : t.state.startsWith('RECORRIDO') || t.state === 'AUTOMÁTICO' ? 'AUTÓNOMO' : t.state.startsWith('ESPERANDO') || t.state === 'PAUSADO' || t.state === 'TIEMPO CUMPLIDO' ? 'PAUSA' : t.state.startsWith('CONTROL') ? 'MANUAL' : 'ESPERA';
  $('hPos').textContent = t.pos ? ptName(t.pos) : (t.auto ? 'en camino' : 'desconocido');
  $('hCrops').textContent = t.crops; $('hCrops').style.color = t.crops ? 'var(--danger)' : '';
  $('routeSec').textContent = t.soil;
  pintarAuto(t);
  $('hWifi').textContent = t.wifiCut ? 'cortado' : 'conectado';
  $('hSoil').textContent = `${t.soil}${Math.abs(t.grade) > .02 ? ' · ' + Math.round(t.grade * 57.2958) + '°' : ''}`;
  $('hMass').textContent = `${fmt(t.mass, 2)} kg`;
  $('hErrRow').hidden = !t.rec; if (t.rec) $('hErr').textContent = `${t.rec.i + 1} de ${Sim.route.length} · ${(Sim.route[t.rec.i] || {}).tipo || ''}`;
  $('hDev').textContent = t.dev === null || t.dev === undefined ? '—' : fmt(t.dev) + ' cm';
  const ban = $('haltBanner'), halt = t.frozen || t.state.startsWith('DETENIDO');
  ban.hidden = !halt; if (halt) { $('haltTitle').textContent = t.frozen ? 'PROGRAMA BLOQUEADO' : 'DETENIDO POR SEGURIDAD';
    $('haltWhy').textContent = t.frozen ? 'los pines quedaron en su último estado · desconecta la batería' : `sin órdenes del celular durante ${Sim.st.timeoutMs} ms · ${t.auto ? 'la misión quedó en pausa: «Reanudar»' : 'mueve el joystick para seguir'}`; }
  const chip = (ok, txt) => `<span class="lk ${ok ? 'on' : ''}">${txt}</span>`;
  $('links').innerHTML = chip(!t.wifiCut && t.piOn, 'Wi-Fi celular') + chip(t.piOn && !t.frozen, t.frozen ? 'programa bloqueado' : 'programa') + chip(t.gnd, 'tierra común') + chip(t.okA && t.okB, 'L298N');
  setBar($('pwmA'), t.dutyL); setBar($('pwmB'), t.dutyR);
  $('pwmAv').textContent = Math.round(t.dutyL * 100) + '%'; $('pwmBv').textContent = Math.round(t.dutyR * 100) + '%';
  const st = { ENA: Math.round(Math.abs(t.dutyL) * 100), ENB: Math.round(Math.abs(t.dutyR) * 100), IN1: t.dutyL > 0, IN2: t.dutyL < 0, IN3: t.dutyR > 0, IN4: t.dutyR < 0 };
  Object.entries(st).forEach(([k, v]) => { const el = $('pm-' + k); const pwm = k[0] === 'E'; el.querySelector('b').textContent = pwm ? (v ? 'PWM ' + v + ' %' : '0') : (v ? 'HIGH' : 'LOW'); el.classList.toggle('hi', !!v); });
  $('tI').textContent = Math.round(t.ibat * 1000) + ' mA';
  const mins = t.ibat > .005 ? UGV.Sim.P.capAh * t.soc / t.ibat * 60 : Infinity;
  $('tAut').textContent = isFinite(mins) ? (mins > 600 ? '> 10 h' : Math.round(mins) + ' min') : '—';
  $('physNote').textContent = `Velocidad tope en superficie firme con la batería actual: ${Math.round(UGV.Sim.vTop())} cm/s (${fmt(t.vbat)} V menos la pérdida supuesta del L298N).`;
  drawChart(); drawRoute();
});

/* Mapa de la ruta: la finca con sus lotes y caminos, o el patio de pruebas */
const rc = $('route'), rg = rc.getContext('2d');
function drawRoute() {
  const r = rc.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (!r.width) return;
  if (rc.width !== Math.round(r.width * dpr) || rc.height !== Math.round(r.height * dpr)) { rc.width = Math.round(r.width * dpr); rc.height = Math.round(r.height * dpr); }
  const W = rc.width, H = rc.height; rg.clearRect(0, 0, W, H);
  const st = Sim.st, LY = Sim.LY, pts = st.path.concat([[st.x, st.z]]), enFinca = st.z < LY.PATIO.z0 - 20 && !st.bench;
  const box = enFinca ? { x0: LY.AREA.x0, x1: LY.AREA.x1, z0: LY.AREA.z0, z1: 600 } : LY.PATIO;
  const pad = 30, cxw = (box.x0 + box.x1) / 2, czw = (box.z0 + box.z1) / 2, s = Math.min(W / (box.x1 - box.x0 + 2 * pad), H / (box.z1 - box.z0 + 2 * pad));
  const P = (x, z) => [W / 2 + (x - cxw) * s, H / 2 + (z - czw) * s];
  const rect = (q, fill) => { const [a, b] = P(q.x0, q.z0), [c, d] = P(q.x1, q.z1); rg.fillStyle = fill; rg.fillRect(a, b, c - a, d - b); };
  const line = (arr, col, w, dash) => { if (arr.length < 2) return; rg.setLineDash(dash ? [5 * dpr, 4 * dpr] : []); rg.strokeStyle = col; rg.lineWidth = w * dpr; rg.lineJoin = 'round'; rg.lineCap = 'round'; rg.beginPath(); arr.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? rg.lineTo(a, b) : rg.moveTo(a, b); }); rg.stroke(); rg.setLineDash([]); };
  rg.font = `600 ${10 * dpr}px "IBM Plex Sans", sans-serif`; rg.textAlign = 'center';
  if (enFinca) {
    rect(box, 'rgba(111,143,62,.35)');
    LY.PATHS.forEach(q => line([[q.a.x, q.a.z], [q.b.x, q.b.z]], 'rgba(181,157,118,.9)', 2 * LY.PATH_HALF * s / dpr, false));
    const C = { cafe: 'rgba(47,107,42,.85)', platano: 'rgba(79,154,53,.85)', maiz: 'rgba(184,162,58,.85)', huerta: 'rgba(109,143,58,.85)' };
    LY.LOTS.forEach(l => { rect(l, C[l.cultivo]); const [a, b] = P((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2); rg.fillStyle = '#fff'; rg.fillText(l.name.split(' ')[0], a, b + 4 * dpr); });
    rect(LY.ALMACEN, 'rgba(200,38,29,.55)'); rect(LY.SHED, 'rgba(31,154,108,.5)');
    if (Sim.pi.plan) line(Sim.pi.plan.linea, css('--w-bus'), 2, true);
    line(pts.slice(-3000), css('--mint'), 2.2, false);
    Object.entries(Sim.FINCA.puntos).forEach(([id, q]) => { const [a, b] = P(q.x, -q.y); if (q.tipo === 'cruce') return;
      rg.fillStyle = q.tipo === 'puesto' ? '#1f9a6c' : q.tipo === 'almacen' ? '#c8261d' : '#e39b12'; rg.beginPath(); rg.arc(a, b, (id === Sim.pi.pos ? 6 : 4.5) * dpr, 0, 7); rg.fill();
      rg.fillStyle = css('--fg'); rg.fillText(ptName(id), a, b - 8 * dpr); });
  } else {
    const m = Sim.marksFor(st.surface === 'finca' ? 'firme' : st.surface), plan = st.plan ? st.plan.pts : [];
    rect(LY.PATIO, 'rgba(167,163,154,.4)'); rect(LY.ZONES[0], 'rgba(150,150,150,.45)'); rect(LY.ZONES[1], 'rgba(122,90,58,.55)'); rect(LY.ZONES[2], 'rgba(216,192,138,.65)');
    rect({ x0: LY.RAMP.x0, x1: LY.RAMP.x1, z0: LY.RAMP.zEnd, z1: LY.RAMP.zBase }, 'rgba(111,81,52,.6)');
    line(plan, css('--w-bus'), 1.8, true);
    line(st.bench ? [] : pts.slice(-1500), css('--mint'), 2.4, false);
    [['A', m.A], ['B', m.B]].concat(st.surface === 'rampa' ? [] : [['C', m.C]]).forEach(([k, [x, z]]) => { const [a, b] = P(x, z); rg.fillStyle = css('--w-5v'); rg.beginPath(); rg.arc(a, b, 4 * dpr, 0, 7); rg.fill(); rg.fillStyle = css('--fg'); rg.fillText(k, a, b - 8 * dpr); });
    if (st.plan && Sim.planLine && Sim.planLine.visible) { const [a, b] = P(...st.plan.end); rg.strokeStyle = css('--w-bus'); rg.lineWidth = 1.5 * dpr; rg.beginPath(); rg.arc(a, b, 6 * dpr, 0, 7); rg.stroke(); }
  }
  const [rx, ry] = P(st.x, st.z); rg.save(); rg.translate(rx, ry); rg.rotate(-st.yaw);
  rg.fillStyle = '#fff'; rg.strokeStyle = '#123'; rg.lineWidth = dpr; rg.beginPath(); rg.moveTo(10 * dpr, 0); rg.lineTo(-6 * dpr, 6 * dpr); rg.lineTo(-3 * dpr, 0); rg.lineTo(-6 * dpr, -6 * dpr); rg.closePath(); rg.fill(); rg.stroke(); rg.restore();
}

/* ---------- Carga ---------- */
$('load').addEventListener('input', e => { const kg = +e.target.value; Sim.setLoad(kg); $('loadLbl').textContent = fmt(kg) + ' kg'; });

/* ---------- Descargas ---------- */
function download(name, text, type = 'text/csv;charset=utf-8') {
  const b = new Blob([(type.startsWith('text/csv') ? '﻿' : '') + text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('bCsv').addEventListener('click', () => { if (!Sim.log.length) { UGV.emit('toast', 'Todavía no hay datos: maneja el robot un momento.'); return; } download('telemetria-ugv.csv', Sim.csv()); });

/* ---------- Gráfica en vivo ---------- */
let chartVar = 'v';
document.querySelectorAll('[data-chart]').forEach(b => b.addEventListener('click', () => { chartVar = b.dataset.chart; document.querySelectorAll('[data-chart]').forEach(x => x.setAttribute('aria-pressed', x === b)); drawChart(); }));
const CH = { v: { lbl: 'cm/s', f: r => r.v }, i: { lbl: 'mA', f: r => r.i * 1000 }, vbat: { lbl: 'V', f: r => r.vbat }, err: { lbl: 'cm al final previsto', f: r => r.err === '' ? null : r.err } };
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
}

/* ---------- Banco de pruebas ---------- */
let testRes = [];
$('bRunTests').addEventListener('click', async () => {
  const b = $('bRunTests'); b.disabled = true; $('testsBody').innerHTML = '<tr><td colspan="5" class="muted">Ejecutando…</td></tr>';
  try { testRes = await Sim.runTests(m => { $('testsStatus').textContent = 'Ejecutando: ' + m + '…'; }); }
  catch (e) { console.error(e); $('testsStatus').textContent = 'No se pudieron completar las pruebas: ' + e.message; }
  b.disabled = false;
  if (testRes.length) {
    $('testsBody').innerHTML = testRes.map(r => `<tr><td>${esc(r.prueba)}</td><td>${esc(r.superficie)}</td><td class="mono">${esc(r.carga)}</td><td class="mono"><b>${esc(r.resultado)}</b></td><td class="muted">${esc(r.detalle)}</td></tr>`).join('');
    $('testsStatus').textContent = `Listo: ${testRes.length} resultados simulados con ${fmt(Sim.robotMass(), 2)} kg de robot, χ = ${fmt(Sim.st.slip)}, motores ${fmt(Sim.st.mismatch * 100, 1)} % distintos y batería al 90 %.`;
    $('bTestsCsv').disabled = $('bTestsCopy').disabled = false;
  }
});
const COLS = ['prueba', 'superficie', 'carga', 'resultado', 'detalle'];
const testsCsv = () => 'prueba,superficie,carga,resultado_simulado,detalle\n' + testRes.map(r => COLS.map(k => '"' + String(r[k]).replace(/"/g, '""') + '"').join(',')).join('\n');
$('bTestsCsv').addEventListener('click', () => download('pruebas-simuladas-ugv.csv', testsCsv()));
$('bTestsCopy').addEventListener('click', () => { const txt = 'Prueba\tSuperficie\tCarga\tResultado simulado\tDetalle\n' + testRes.map(r => COLS.map(k => r[k]).join('\t')).join('\n');
  navigator.clipboard.writeText(txt).then(() => UGV.emit('toast', 'Tabla copiada: pégala en Word o Excel.')).catch(() => UGV.emit('toast', 'No se pudo copiar; usa “Descargar CSV”.')); });

/* ---------- Programa real de la Raspberry Pi ---------- */
$('bCodePi').addEventListener('click', () => {
  const files = UGV.PI_FILES || [], m = $('modal');
  m.querySelector('.m-body').innerHTML = `<div class="code-wrap"><h2 id="mTitle">Programa de la Raspberry Pi</h2>
    <p class="muted">Es el programa real del prototipo (carpeta <code>raspberry/</code> del proyecto). Cópialo a la Raspberry Pi y ejecuta <code>sudo ./instalar.sh</code>; después conecta el celular a la red <b>UGV-Orugas</b> y abre <b>http://10.42.0.1</b>. En un computador se prueba sin hardware con <code>python3 ugv.py --simular</code> (PIN 1234). Para actualizarlo desde GitHub: <code>sudo ./actualizar.sh</code>.</p>
    <div class="seg code-tabs" role="tablist">${files.map((f, i) => `<button data-i="${i}" aria-pressed="${!i}">${esc(f.name)}</button>`).join('')}</div>
    <p class="muted small" id="cDesc"></p>
    <div class="row"><button class="btn small" id="cCopy">Copiar</button><button class="btn small" id="cDl">Descargar este archivo</button><button class="btn small" id="cAll">Descargar todo (.zip)</button></div>
    <pre class="code"><code id="cCode"></code></pre></div>`;
  let cur = 0;
  const show = i => { cur = i; $('cCode').textContent = files[i].text; $('cDesc').textContent = files[i].desc + ' · raspberry/' + files[i].name; m.querySelectorAll('.code-tabs button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.i === i)); };
  m.querySelectorAll('.code-tabs button').forEach(b => b.onclick = () => show(+b.dataset.i)); show(0);
  m.hidden = false; document.body.classList.add('modal-open');
  const base = n => n.split('/').pop();
  $('cCopy').onclick = () => navigator.clipboard.writeText(files[cur].text).then(() => UGV.emit('toast', 'Código copiado.')).catch(() => UGV.emit('toast', 'No se pudo copiar; usa “Descargar”.'));
  $('cDl').onclick = () => download(base(files[cur].name), files[cur].text, 'text/plain;charset=utf-8');
  $('cAll').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(zip(files.map(f => ({ name: 'raspberry/' + f.name, text: f.text }))));
    a.download = 'ugv-raspberry.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); UGV.emit('toast', 'Descargado ugv-raspberry.zip con la carpeta raspberry/ completa.'); };
});

/* ZIP sin compresión (método «store»), suficiente para descargar la carpeta raspberry/ completa sin librerías */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), partes = [], central = []; let off = 0;
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  files.forEach(f => {
    const nom = enc.encode(f.name), dat = enc.encode(f.text), crc = crc32(dat);
    const comun = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(dat.length), ...u32(dat.length), ...u16(nom.length), ...u16(0)];
    const loc = new Uint8Array([...u32(0x04034b50), ...comun]);
    partes.push(loc, nom, dat);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...comun, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nom);
    off += loc.length + nom.length + dat.length;
  });
  const tam = central.reduce((s, b) => s + b.length, 0);
  const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(tam), ...u32(off), ...u16(0)]);
  return new Blob([...partes, ...central, fin], { type: 'application/zip' });
}

/* ---------- Presupuesto (solo los materiales del diagrama final) ---------- */
const REF_PRICES = { chassis: 52300 }; // referencia de un chasis similar citada en el informe; los demás quedan por completar
const prices = (() => { let p = {}; try { p = JSON.parse(localStorage.getItem('ugv-precios-v3') || '{}'); } catch (_) { } return Object.assign({}, REF_PRICES, p); })();
const QTY = { battery: 2 };
const NAMES = { battery: 'Celdas Li-ion de 3,7 V', motorA: null, motorB: null, box: null };
const money = v => '$ ' + Math.round(v).toLocaleString('es-CO');
const bomParts = () => UGV.PARTS.filter(p => NAMES[p.id] !== null && UGV.isOn(p.id)).concat([{ id: 'cables', name: 'Cables y conexiones' }]);
const pname = p => p.id === 'chassis' ? 'Chasis de orugas con dos motores DC' : NAMES[p.id] || p.name;
function renderBom() {
  $('bomBody').innerHTML = bomParts().map(p => { const q = QTY[p.id] || 1, pr = +prices[p.id] || 0;
    return `<tr><td>${esc(pname(p))}</td><td><span class="chip st-on">${p.id === 'chassis' ? 'Precio de referencia' : 'Por completar'}</span></td><td class="mono">${q}</td>
      <td><input class="price" type="number" min="0" step="500" inputmode="numeric" id="pr-${p.id}" value="${pr || ''}" placeholder="[completar]" aria-label="Precio de ${esc(pname(p))}"></td><td class="r mono" id="st-${p.id}">${money(q * pr)}</td></tr>`; }).join('');
  bomParts().forEach(p => $('pr-' + p.id).addEventListener('input', e => { prices[p.id] = +e.target.value || 0; try { localStorage.setItem('ugv-precios-v3', JSON.stringify(prices)); } catch (_) { } $('st-' + p.id).textContent = money((QTY[p.id] || 1) * prices[p.id]); bomTotal(); }));
  bomTotal();
}
function bomTotal() { const faltan = bomParts().some(p => !+prices[p.id]); $('bomTotal').textContent = money(bomParts().reduce((s, p) => s + (QTY[p.id] || 1) * (+prices[p.id] || 0), 0)) + (faltan ? ' + [completar]' : ''); }
$('bBomCsv').addEventListener('click', () => download('presupuesto-ugv.csv', 'item,cantidad,valor_unitario_cop,subtotal_cop\n' + bomParts().map(p => { const q = QTY[p.id] || 1, pr = +prices[p.id] || 0; return `"${pname(p)}",${q},${pr || '[completar]'},${pr ? q * pr : '[completar]'}`; }).join('\n')));
UGV.on('parts', renderBom); renderBom();

/* Tiles de la pestaña Proyecto */
const tiles = [['6', 'elementos en el diseño final'], ['2 kg', 'carga útil máxima'], ['GPIO 12 y 13', 'PWM por hardware'], ['3 modos', 'manual · autónomo · temporal'], ['0', 'cultivos pisados: solo usa los caminos'], ['P1 – P10', 'protocolo de pruebas']];
$('tiles').innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

UGV.goTab(fromHash());
})();
