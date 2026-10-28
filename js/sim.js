/* Simulador 3D: la finca (js/finca3d.js) con su patio de pruebas, el robot, cables, física,
   y el mismo programa de la Raspberry Pi que corre en el prototipo (raspberry/ugv.py y el paquete raspberry/robot/): control remoto con parada si dejan
   de llegar órdenes, recorrido por tramos de tiempo y modo automático por los puntos de la finca (js/auto.js), en lazo abierto. */
(function () {
'use strict';
const T = THREE, G = UGV.GEOM, S = UGV.state;
const Sim = UGV.Sim = {};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

/* ---------- Parámetros del modelo (supuestos de la simulación; ver pestaña Proyecto) ---------- */
const P = Sim.P = {
  rpm12: 350,       // RPM sin carga a 12 V (extremo del rango de la ficha)
  tstall12: .343,   // torque de bloqueo a 12 V (N·m) = 3,5 kg·cm
  istall12: 1.8,    // corriente de bloqueo a 12 V (A), supuesta
  i0: .1,           // corriente sin carga (A), de la ficha
  drop: 1.8,        // tensión que se pierde en el L298N (V), supuesta
  capAh: 2.6,       // capacidad de cada celda (Ah), supuesta; las celdas van en serie
  rint: .075,       // resistencia interna por celda (Ω), supuesta
  tau: .15,         // constante de tiempo de los motores (s)
  mulat: .45,       // fricción lateral oruga-suelo en los giros
  contact: .12,     // largo de contacto de la oruga (m)
  irpi: .5,         // consumo de la Raspberry Pi a 5 V (A), supuesto
  boot: 2.5         // segundos que tarda en arrancar el programa después de conectar la batería (simulado)
};
/* Superficies de prueba: resistencia a la rodadura, avance real frente al de las orugas y deslizamiento extra en giros (supuestos) */
const SOIL = Sim.SOIL = {
  firme: { name: 'superficie firme', mur: .05, slipLong: .99, chi: 1.0 },
  tierra: { name: 'tierra', mur: .10, slipLong: .93, chi: 1.15 },
  arena: { name: 'arena', mur: .17, slipLong: .80, chi: 1.35 },
  camino: { name: 'camino de tierra', mur: .08, slipLong: .96, chi: 1.08 },
  pasto: { name: 'pasto', mur: .13, slipLong: .9, chi: 1.2 }
};
const ocvCell = soc => { const t = [[0, 3.0], [.05, 3.3], [.1, 3.45], [.2, 3.6], [.5, 3.75], [.8, 3.95], [1, 4.2]];
  for (let i = 1; i < t.length; i++) if (soc <= t[i][0]) { const [a, va] = t[i - 1], [b, vb] = t[i]; return va + (vb - va) * (soc - a) / (b - a); } return 4.2; };
Sim.cells = () => 2;

/* ---------- La finca y el patio de pruebas (js/finca3d.js; unidades: cm; x = este, z = sur) ---------- */
const LY = UGV.LAYOUT, MAPA = Sim.MAPA = UGV.MAPA, FINCA = Sim.FINCA = UGV.FINCA;
const AREA = Sim.AREA = LY.AREA, ZONES = Sim.ZONES = LY.ZONES, RAMP = Sim.RAMP = LY.RAMP;
const marksFor = Sim.marksFor = LY.marksFor, H = Sim.H = LY.H, soilAt = Sim.soilAt = LY.soilAt;
Sim.LOTS = LY.LOTS; Sim.PATHS = LY.PATHS; Sim.LY = LY;
Sim.benchPos = LY.BENCH;
const ptXZ = id => [FINCA.puntos[id].x, -FINCA.puntos[id].y];
Sim.ptXZ = ptXZ;

/* ---------- Estado ---------- */
const st = Sim.st = {
  jx: 0, jy: 0, keys: {}, vmax: .6, slip: 1.6, mismatch: .02, factorDer: 1, timeoutMs: 800, load: 0,
  mode: 'remoto', surface: 'finca', bench: false, wifiCut: false, x: 0, z: 0, yaw: Math.PI / 2, vl: 0, vr: 0, dutyL: 0, dutyR: 0, sf: 1,
  soc: .86, vbat: 8.1, ibat: 0, iL: 0, iR: 0, timeScale: 1, simSpeed: 1, t: 0,
  path: [], plan: null, dev: null, devLast: null, routes: 0, quiet: false, testing: false, testCmd: null, grade: 0, soil: 'firme', bumps: 0, held: false,
  crops: 0, cropHit: null, esperarOrden: false, temporal: null, arrivals: [],
  cfg: { vel_auto: 60, cm_s: null, grados_s: null, espera_s: 1, pausa_giro_s: .5, prueba_s: 10, rampa_pct_s: 250, retroceder_si_vuelve: true, tolerancia_tiempo_s: 10 }   // config.json del modo automático (se calibra al iniciar)
};
/* El programa de la Raspberry Pi (misma lógica que raspberry/robot/) */
const pi = Sim.pi = { modo: 'ESPERA', izq: 0, der: 0, ultima: 0, rec: null, frozen: false, boot: 0, on: false,
  pos: FINCA.inicio, rumbo: +(FINCA.rumbo_inicial ?? 90), x: FINCA.puntos[FINCA.inicio].x, y: FINCA.puntos[FINCA.inicio].y, aprox: false,
  tourI: 0, plan: null, oI: 0, oD: 0, ultimaMision: null };
const hist = Sim.hist = []; const log = Sim.log = [];

let renderer, scene, camera, controls, robot, chassis, sun, canvas;
const groups = {}, built = {};
let view = 'orbit', wiresOn = true, openBox = false, selected = null, selBox = null;

/* ---------- Recorrido programado (mismo formato que la página del celular) ---------- */
const TIPOS = Sim.TIPOS = { avanzar: [1, 1], retroceder: [-1, -1], izquierda: [-1, 1], derecha: [1, -1], pausa: [0, 0] };
let route = Sim.route = [];
Sim.setRoute = r => { route = Sim.route = r.map(t => ({ tipo: t.tipo, velocidad: +t.velocidad || 0, duracion: +t.duracion || .1 })); planRoute(); UGV.emit('route', route); };

/* ---------- Texturas ---------- */
function contactTex() {
  return UGV.tex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(.6, 'rgba(0,0,0,.18)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
}
/* ---------- Inicio ---------- */
Sim.init = function (cv) {
  canvas = cv;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); }
  catch (e) { canvas.parentElement.insertAdjacentHTML('beforeend', '<p class="nogl">Tu navegador no tiene WebGL activado, así que no puede mostrar el modelo 3D. Prueba con Chrome, Edge o Firefox actualizados.</p>'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene(); scene.background = new T.Color(0xbcd6e8); scene.fog = new T.Fog(0xbcd6e8, 6000, 16000);
  const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new T.RoomEnvironment(), .04).texture;
  const m0 = marksFor('finca');
  camera = new T.PerspectiveCamera(36, 1, .5, 20000); camera.position.set(m0.A[0] + 34, 22, m0.A[1] + 38);
  controls = new T.OrbitControls(camera, canvas);
  controls.target.set(m0.A[0], 5, m0.A[1]); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .48; controls.minDistance = 9; controls.maxDistance = 6000;

  scene.add(new T.HemisphereLight(0xdfefff, 0x6b5a3a, .55));
  sun = new T.DirectionalLight(0xfff1d8, 1.35); sun.position.set(40, 300, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 1400 });
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .04; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xdfe9ff, .3); fill.position.set(-60, 40, -50); scene.add(fill);

  Sim.floor = UGV.Finca3D.build(scene);
  Sim.autoLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0x2d4fb8, dashSize: 14, gapSize: 9 })); Sim.autoLine.frustumCulled = false; scene.add(Sim.autoLine);
  const mkTrail = (col, dashed) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(12000 * 3), 3)); g.setDrawRange(0, 0);
    const l = new T.Line(g, dashed ? new T.LineDashedMaterial({ color: col, dashSize: 8, gapSize: 6 }) : new T.LineBasicMaterial({ color: col })); l.frustumCulled = false; scene.add(l); return { g, l, n: 0 }; };
  Sim.trail = mkTrail(0x1f9a6c);
  Sim.planLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0x2d4fb8, dashSize: 10, gapSize: 7 })); Sim.planLine.frustumCulled = false; scene.add(Sim.planLine);

  robot = new T.Group(); robot.rotation.order = 'YXZ'; scene.add(robot);
  const contact = new T.Mesh(new T.PlaneGeometry(26, 24), new T.MeshBasicMaterial({ map: contactTex(), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .2; robot.add(contact); Sim.contact = contact;
  chassis = UGV.buildChassis(); robot.add(chassis.group); tagPart(chassis.group, 'chassis');
  UGV.PARTS.forEach(p => { if (p.noModel || p.id === 'chassis') return; const r = UGV.build(p.id); if (!r) return;
    const g = new T.Group(); g.add(r.g); robot.add(g); groups[p.id] = g; built[p.id] = r; tagPart(g, p.id); placePart(p.id); });
  const parcel = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0x5b6670, roughness: .4, metalness: .7 })); parcel.visible = false; parcel.castShadow = true; robot.add(parcel); Sim.parcel = parcel;
  Sim.wireGroup = new T.Group(); robot.add(Sim.wireGroup);
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if ('envMapIntensity' in m && m.envMapIntensity === 1) m.envMapIntensity = .5; }); });

  Sim.setRoute(Sim.defaultRoute());
  Sim.auto.calibrar(true);
  Sim.toMark('finca');
  syncParts();
  UGV.on('parts', () => { syncParts(); rebuildWires(); });
  UGV.on('wires', rebuildWires);
  UGV.on('layout', () => { Object.keys(groups).forEach(placePart); rebuildWires(); });
  setupPointer();
  new ResizeObserver(Sim.resize).observe(canvas.parentElement); Sim.resize();
  requestAnimationFrame(loop);
};

function tagPart(g, id) { g.traverse(m => { if (m.isMesh || m.isInstancedMesh) m.userData.partId = id; }); }
function placePart(id) {
  const g = groups[id]; if (!g) return; const pl = UGV.PLACE[id] || { pos: [0, 0, 0] }; const o = S.pos[id];
  g.position.set(o ? o[0] : pl.pos[0], pl.pos[1], o ? o[1] : pl.pos[2]); g.rotation.set(0, o ? o[2] : (pl.rot || 0), pl.tilt || 0); g.updateMatrix();
}
function syncParts() {
  Object.entries(groups).forEach(([id, g]) => g.visible = UGV.isOn(id));
  if (selected && selected !== 'chassis' && !UGV.isOn(selected)) Sim.select(null);
  applyBoxMode();
}

/* ---------- Cables 3D con los colores reales ---------- */
let wireMeshes = [];
const REAL = { ENA: 0xe8e8e8, IN1: 0x8b8f94, IN2: 0x2b5fd9, IN3: 0x2aa84a, IN4: 0xe3c51b, ENB: 0x7b4fc9 };
function realColor(w) {
  const pin = [w.a, w.b].map(UGV.pinInfo);
  if (w.sig && REAL[w.sig]) return REAL[w.sig];
  if (w.sig === 'MA') return (w.a + w.b).includes('OUT1') ? 0xe3c51b : 0x2aa84a;
  if (w.sig === 'MB') return (w.a + w.b).includes('OUT3') ? 0xc8261d : 0x141414;
  if (pin.some(p => p && p.t === 'gnd')) return 0x141414;
  if (pin.some(p => p && p.t === 'pwr')) return (w.a + w.b).includes('rpi.5V') ? 0xe07b1f : 0xc8261d;
  const pal = [0xe07b1f, 0x8a4b2a, 0x2b5fd9, 0x2aa84a, 0x7b4fc9, 0xe3c51b]; let h = 0; for (const ch of w.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return pal[h % pal.length];
}
function pinWorld(key) {
  const [pid, pin] = key.split('.'); const g = groups[pid], r = built[pid]; if (!g || !r) return null;
  const local = (r.pins[pin] || new T.Vector3(0, 1, 0)).clone(); g.updateMatrix(); return local.applyMatrix4(g.matrix);
}
Sim.wireColor = (w, an) => {
  const ia = UGV.pinInfo(w.a), ib = UGV.pinInfo(w.b), ty = [ia && ia.t, ib && ib.t];
  if (ty.includes('gnd')) return css('--w-gnd'); if (ty.includes('mot')) return css('--w-mot');
  if (ty.includes('pwr')) { const v = an ? an.netV(w.a) : null; return v === null || v > 6 ? css('--w-red') : v > 4 ? css('--w-5v') : css('--w-3v3'); }
  return css('--w-sig');
};
const isHeader = key => { const [p, pin] = key.split('.'); return p === 'rpi' || (p === 'l298n' && /^(EN|IN)/.test(pin)); };
function tubeAlong(curve, col, r, phase) { // cable (o mitad de un par trenzado si phase !== null)
  let geo;
  if (phase === null) geo = new T.TubeGeometry(curve, 64, r, 8, false);
  else { const N = 120, fr = curve.computeFrenetFrames(N, false), pts = [];
    for (let i = 0; i <= N; i++) { const u = i / N, p = curve.getPointAt(u), a = u * 22 * Math.PI + phase, k = Math.min(1, Math.min(u, 1 - u) * 12);
      pts.push(p.clone().addScaledVector(fr.normals[i], Math.cos(a) * r * 1.15 * k).addScaledVector(fr.binormals[i], Math.sin(a) * r * 1.15 * k)); }
    geo = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 240, r, 6, false); }
  const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0, roughness: .42 })); m.castShadow = true; Sim.wireGroup.add(m); return m;
}
function rebuildWires() {
  wireMeshes.forEach(o => { [o.m].concat(o.ends).forEach(x => { if (x.geometry) x.geometry.dispose(); Sim.wireGroup.remove(x); }); }); wireMeshes = [];
  if (!wiresOn || !Sim.wireGroup) return;
  const an = UGV.analyze(st.vbat);
  an.wires.forEach((w, i) => {
    const p1 = pinWorld(w.a), p2 = pinWorld(w.b); if (!p1 || !p2) return;
    const motorW = w.sig === 'MA' || w.sig === 'MB';
    let pts;
    if (motorW) { // bajan por la ranura de la base hasta el motor
      const hole = new T.Vector3(p1.x * .6 + p2.x * .4, G.PLATE_Y + .2, p1.z * .5); const under = new T.Vector3(p2.x * .8, G.PLATE_Y - 1.0, p2.z);
      pts = [p1, p1.clone().add(new T.Vector3(0, .6, 0)), hole.clone().add(new T.Vector3(0, .5, 0)), hole, under, p2];
    } else {
      const lift = Math.max(p1.y, p2.y) + .9 + (i % 4) * .28;
      const m1 = p1.clone().lerp(p2, .3); m1.y = lift; const m2 = p1.clone().lerp(p2, .7); m2.y = lift;
      pts = [p1, p1.clone().add(new T.Vector3(0, .7, 0)), m1, m2, p2.clone().add(new T.Vector3(0, .7, 0)), p2];
    }
    const curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
    const twisted = w.sig === 'MA';
    const m = tubeAlong(curve, realColor(w), motorW ? .085 : .06, twisted ? ((w.a + w.b).includes('OUT1') ? 0 : Math.PI) : null);
    const ends = [];
    [[w.a, p1], [w.b, p2]].forEach(([k, p]) => { if (!isHeader(k)) return; const e = new T.Mesh(new T.BoxGeometry(.25, .62, .25), UGV.MAT.blackGloss); e.position.copy(p); e.position.y += .32; e.castShadow = true; Sim.wireGroup.add(e); ends.push(e); });
    wireMeshes.push({ m, ends, w });
  });
}
Sim.rebuildWires = rebuildWires;

/* ---------- Selección, interior y arrastre ---------- */
function applyBoxMode() {
  const g = groups.box; if (!g) return;
  g.traverse(m => { if (m.isMesh) { if (!m.userData.solidMat) m.userData.solidMat = m.material;
    if (!m.userData.ghostMat) { m.userData.ghostMat = m.material.clone(); m.userData.ghostMat.transparent = true; m.userData.ghostMat.opacity = .13; m.userData.ghostMat.depthWrite = false; }
    m.material = openBox ? m.userData.ghostMat : m.userData.solidMat; m.castShadow = !openBox; } });
}
Sim.setOpen = v => { openBox = v; applyBoxMode(); };
Sim.setWires = v => { wiresOn = v; rebuildWires(); };
Sim.wiresOn = () => wiresOn;
Sim.select = id => {
  selected = id; if (selBox) { scene.remove(selBox); selBox = null; }
  if (id && (groups[id] || id === 'chassis')) { selBox = new T.BoxHelper(id === 'chassis' ? chassis.group : groups[id], new T.Color(0x1f9a6c)); scene.add(selBox); }
  UGV.emit('select', id);
};
Sim.selected = () => selected;
Sim.focus = id => { const g = groups[id]; if (!g) return; Sim.setView('orbit');
  const p = new T.Vector3(); g.getWorldPosition(p); controls.target.copy(p); camera.position.copy(p).add(new T.Vector3(14, 12, 16)); Sim.select(id); };

let drag = null; const ray = new T.Raycaster(), mouse = new T.Vector2();
const visibleChain = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
function setupPointer() {
  const pick = e => { const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); };
  const partHits = () => { const objs = []; robot.traverse(m => { if ((m.isMesh || m.isInstancedMesh) && m.userData.partId) objs.push(m); });
    let h = ray.intersectObjects(objs, false).filter(x => visibleChain(x.object)); if (openBox) h = h.filter(x => x.object.userData.partId !== 'box'); return h; };
  let downAt = null;
  canvas.addEventListener('pointerdown', e => {
    downAt = [e.clientX, e.clientY];
    pick(e); const h = partHits()[0]; if (!h) return;
    const id = h.object.userData.partId; Sim.select(id);
    if (id === 'chassis' || (UGV.PLACE[id] && UGV.PLACE[id].fixed)) return;
    const lp = robot.worldToLocal(h.point.clone());
    drag = { id, plane: new T.Plane(new T.Vector3(0, 1, 0), -lp.y), start: lp, orig: groups[id].position.clone(), moved: false };
    controls.enabled = false; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; pick(e);
    const inv = robot.matrixWorld.clone().invert(), r2 = ray.ray.clone().applyMatrix4(inv), p = new T.Vector3(); if (!r2.intersectPlane(drag.plane, p)) return;
    const d = p.sub(drag.start), g = groups[drag.id];
    g.position.x = T.MathUtils.clamp(drag.orig.x + d.x, -7.6, 7.8); g.position.z = T.MathUtils.clamp(drag.orig.z + d.z, -4.4, 4.4);
    drag.moved = true; if (selBox) selBox.update(); if (wiresOn) rebuildWires();
  });
  const end = () => { if (drag) { if (drag.moved) { const g = groups[drag.id]; S.pos[drag.id] = [g.position.x, g.position.z, g.rotation.y]; UGV.save(); rebuildWires(); }
    drag = null; controls.enabled = view === 'orbit'; } };
  canvas.addEventListener('pointerup', e => { end(); if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return; pick(e); if (!partHits().length) Sim.select(null); });
  canvas.addEventListener('pointercancel', end);
}
Sim.rotateSel = () => { if (!selected || !groups[selected] || (UGV.PLACE[selected] || {}).fixed) return; const g = groups[selected]; g.rotation.y += Math.PI / 2;
  S.pos[selected] = [g.position.x, g.position.z, g.rotation.y]; UGV.save(); if (selBox) selBox.update(); rebuildWires(); };
Sim.resetSel = () => { if (!selected) return; delete S.pos[selected]; UGV.save(); placePart(selected); if (selBox) selBox.update(); rebuildWires(); };

/* ---------- Cámara ---------- */
Sim.setView = v => { view = v; controls.enabled = v === 'orbit'; if (v === 'orbit') controls.target.set(st.x, H(st.x, st.z) + 5, st.z); camera.fov = 36; camera.updateProjectionMatrix(); UGV.emit('view', v); };
Sim.overview = () => { Sim.setView('orbit'); controls.target.set(80, 0, -20); camera.position.set(1050, 1500, -1500); }; // desde el noreste: la finca al frente y el patio detrás
Sim.snapshot = () => { renderer.render(scene, camera); canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ugv-orugas-finca.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }); };
Sim.applyTheme = () => { if (selBox) selBox.material.color.set(0x1f9a6c); rebuildWires(); };
Sim.resize = () => { if (!renderer) return; const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };

/* ---------- Electricidad: ¿llega la señal de la Raspberry Pi a cada motor? ---------- */
let an = null, anT = 0;
function driveOK(a, side) {
  const [EN, I1, I2, O1, O2, M, gEN, g1, g2] = side === 'A' ? ['ENA', 'IN1', 'IN2', 'OUT1', 'OUT2', 'motorA', 'G12', 'G17', 'G27'] : ['ENB', 'IN3', 'IN4', 'OUT3', 'OUT4', 'motorB', 'G13', 'G22', 'G23'];
  if (!a || !UGV.isOn(M) || !UGV.isOn('l298n') || !UGV.isOn('rpi') || !a.rpiOn) return 0;
  const same = (x, y) => a.net(x) === a.net(y);
  if (!(same('rpi.' + gEN, 'l298n.' + EN) && same('rpi.' + g1, 'l298n.' + I1) && same('rpi.' + g2, 'l298n.' + I2))) return 0;
  if ((a.vAt('l298n.12V') || 0) < 6 || !same('rpi.GND', 'l298n.GND')) return 0;
  if (same('l298n.' + O1, M + '.M+') && same('l298n.' + O2, M + '.M-')) return 1;
  if (same('l298n.' + O1, M + '.M-') && same('l298n.' + O2, M + '.M+')) return -1;
  return 0;
}
Sim.robotMass = () => UGV.PARTS.reduce((s, p) => s + (UGV.isOn(p.id) ? p.mass : 0), 0) / 1000;

/* ---------- Programa de la Raspberry Pi (igual que raspberry/robot/) ---------- */
// como Motores en robot/motores.py: potencia pedida (con el factor de ajuste) y rampa de aceleración en manual; frenar es inmediato
function piMover(izq, der, rampa = true) { pi.oI = clamp(izq, -100, 100); pi.oD = clamp(der * st.factorDer, -100, 100); pi.conRampa = rampa; piRampa(0); }
function piRampa(dt) { const r = +st.cfg.rampa_pct_s || 0, m = r > 0 && pi.conRampa ? r * dt : Infinity; pi.izq = UGV.Auto.rampa(pi.izq, pi.oI, m); pi.der = UGV.Auto.rampa(pi.der, pi.oD, m); }
const piMoviendo = () => !!(pi.izq || pi.der || pi.oI || pi.oD);
function piParar(motivo) { pi.izq = pi.der = pi.oI = pi.oD = 0; if (pi.rec) { pi.rec = null; if (motivo !== 'fin') st.routeAborted = true; }
  if (pi.plan) { pi.plan = null; drawAutoLine(null); }
  pi.modo = motivo === 'sin órdenes' ? 'DETENIDO POR SEGURIDAD' : 'ESPERA'; }
Sim.piParar = () => { if (pi.on && !pi.frozen && !st.wifiCut) piParar('detener'); };
function piStep(dt) {
  const powered = !!(an && an.rpiOn);
  if (!powered) { if (pi.on && !st.quiet) UGV.emit('toast', S.batteryOn === false ? 'Batería desconectada: todo se apaga (corte total).' : 'La Raspberry Pi se quedó sin alimentación.');
    Object.assign(pi, { on: false, modo: 'APAGADA', izq: 0, der: 0, oI: 0, oD: 0, rec: null, frozen: false, boot: P.boot }); return; }
  if (!pi.on) { pi.on = true; pi.boot = st.testing ? 0 : P.boot; }
  if (pi.boot > 0) { pi.boot -= dt; pi.modo = pi.boot > 0 ? 'ARRANCANDO' : 'ESPERA'; pi.izq = pi.der = pi.oI = pi.oD = 0; pi.ultima = st.t; return; }
  if (pi.frozen) return; // programa bloqueado: los pines se quedan como estaban
  const wifi = !st.wifiCut;
  if (st.mode === 'remoto' && !pi.rec && !pi.plan) {
    const [L, R] = phoneCmd(), active = !!(L || R);
    if (active && wifi) { piMover(L * 100, R * 100); pi.ultima = st.t; pi.modo = piMoviendo() ? 'CONTROL REMOTO' : 'ESPERA'; if (piMoviendo()) { pi.pos = pi.rumbo = pi.x = pi.y = null; pi.aprox = false; } }
    if (!active && st.held && wifi) piParar('detener'); // la página envía «parar» al soltar
    st.held = active;
  }
  if (pi.rec) {
    if (wifi) pi.ultima = st.t; // latido de la página
    const r = pi.rec; r.t += dt;
    while (r.i < route.length && r.t >= route[r.i].duracion) { r.t -= route[r.i].duracion; r.i++; }
    if (r.i >= route.length) { piParar('fin'); routeEnd(); }
    else { const t = route[r.i], [sl, sr] = TIPOS[t.tipo]; piMover(sl * t.velocidad, sr * t.velocidad, false); pi.modo = 'RECORRIDO PROGRAMADO'; }
  }
  if (pi.plan) autoStep(dt, wifi);
  if ((piMoviendo() || pi.rec || (pi.plan && pi.modo === 'AUTOMÁTICO')) && (st.t - pi.ultima) * 1000 > st.timeoutMs) {
    if (pi.plan) { pi.izq = pi.der = pi.oI = pi.oD = 0; pi.modo = 'DETENIDO POR SEGURIDAD'; }   // la misión queda pausada (se puede reanudar)
    else piParar('sin órdenes');
    if (!st.quiet) UGV.emit('toast', `Sin órdenes del celular durante ${st.timeoutMs} ms: la Raspberry Pi detuvo los motores` + (pi.plan ? ' y pausó la misión.' : '.'));
  }
  piRampa(dt);
}
function phoneCmd() { // órdenes del celular (joystick o teclado del simulador)
  let x = st.jx, y = st.jy; const k = st.keys;
  if (k.w || k.arrowup) y = 1; if (k.s || k.arrowdown) y = -1; if (k.a || k.arrowleft) x = -1; if (k.d || k.arrowright) x = 1;
  if (!x && !y) return [0, 0];
  let L = y + x, R = y - x; const mm = Math.max(1, Math.abs(L), Math.abs(R)); return [L / mm * st.vmax, R / mm * st.vmax];
}


/* ---------- Modo autónomo y temporal (misma lógica que Controlador en raspberry/robot/misiones.py) ---------- */
const MOVS = UGV.Auto.MOVIMIENTOS;
function drawAutoLine(xz) {
  if (!Sim.autoLine) return; Sim.autoLine.geometry.dispose();
  Sim.autoLine.geometry = new T.BufferGeometry().setFromPoints((xz || []).map(([x, z]) => new T.Vector3(x, H(x, z) + 2, z)));
  Sim.autoLine.computeLineDistances(); Sim.autoLine.visible = !!xz && xz.length > 1;
}
// línea prevista en el mapa (x, z del simulador = x, −y del mapa)
function lineaPlan(pose, pasos) {
  const pts = pose ? [[pose.x, pose.y]] : [];
  pasos.forEach(p => { if (p.fin && p.fin.x !== null && p.fin.x !== undefined) { const u = pts[pts.length - 1]; if (!u || u[0] !== p.fin.x || u[1] !== p.fin.y) pts.push([p.fin.x, p.fin.y]); } });
  return pts.map(([x, y]) => [x, -y]);
}
const poseConocida = () => (pi.x !== null && pi.rumbo !== null ? { x: pi.x, y: pi.y, rumbo: pi.rumbo, nombre: pi.pos } : null);
function autoNext() { const pl = pi.plan, p = pl.pasos[pl.i]; if (pl.started || (pl.arrived && p.esperar !== 'orden')) pl.hecho += pl.t; pl.i++; pl.t = 0; pl.started = pl.arrived = false; pl.sigue = false; }
function autoCerrar(resultado, modo) {
  const pl = pi.plan, p = pl.pasos[pl.i] || {};
  pi.izq = pi.der = pi.oI = pi.oD = 0;
  if (pl.started && MOVS.includes(p.tipo)) { // quedó a mitad de un movimiento: posición aproximada
    const e = UGV.Auto.poseEnPaso(pl.p0, p, pl.dur ? pl.t / pl.dur : 1);
    pi.pos = null; pi.aprox = !!e; if (e) { pi.x = e.x; pi.y = e.y; pi.rumbo = e.rumbo; } else pi.x = pi.y = pi.rumbo = null;
  }
  if (pl.tour && pi.pos === FINCA.inicio && resultado === 'terminada') pi.tourI = 0;
  pi.ultimaMision = { nombre: pl.nombre, resultado };
  pi.plan = null; pi.modo = modo; drawAutoLine(null);
  if (!st.quiet) UGV.emit('toast', resultado === 'terminada' ? `Terminó: ${pl.nombre}. El robot cree estar en ${pi.pos || (pi.x !== null ? `x ${(pi.x / 100).toFixed(2)} m, y ${(pi.y / 100).toFixed(2)} m` : 'un lugar desconocido')}.`
    : `Misión ${resultado}: ${pl.nombre}.` + (pi.aprox ? ' Posición aproximada.' : ''));
  UGV.emit('autoEnd', pi.pos);
}
function autoVencer() { // venció el tiempo del modo temporal; devuelve true si ya se detuvo
  const pl = pi.plan, p = pl.pasos[pl.i] || {}, resto = pl.dur - pl.t; pl.vencido = true;
  if (pl.alTerminar === 'punto_seguro' && pl.started && (p.tipo === 'avanzar' || p.tipo === 'retroceder') && p.fin && p.fin.pos && resto <= st.cfg.tolerancia_tiempo_s) {
    pl.terminarTras = true; if (!st.quiet) UGV.emit('toast', `Tiempo cumplido: termina el tramo hacia ${p.fin.pos} (faltan ${resto.toFixed(1)} s) y se detiene.`); return false;
  }
  autoCerrar('tiempo cumplido', 'TIEMPO CUMPLIDO'); return true;
}
function autoStep(dt, wifi) {
  const pl = pi.plan;
  if (pi.modo === 'ESPERANDO ORDEN') { if (pl.sigue) { pi.modo = 'AUTOMÁTICO'; pi.ultima = st.t; autoNext(); } return; }
  if (pi.modo !== 'AUTOMÁTICO') return;                   // pausada o detenida por seguridad
  if (wifi) pi.ultima = st.t;                              // latido de la página
  pl.tTotal += dt;
  if (pl.limite && !pl.vencido && pl.tTotal >= pl.limite && autoVencer()) return;
  const p = pl.pasos[pl.i];
  if (!p) { piMover(0, 0); autoCerrar('terminada', 'ESPERA'); return; }
  if (p.llega !== undefined) {
    if (!pl.arrived) { pl.arrived = true; pl.t = 0; piMover(0, 0);
      if (p.x !== null && p.x !== undefined) { pi.x = p.x; pi.y = p.y; pi.aprox = false; }
      pi.pos = FINCA.puntos[p.llega] ? p.llega : null;
      if (pl.tour && pi.tourI < MAPA.orden.length && p.llega === MAPA.orden[pi.tourI]) pi.tourI++;
      if (p.x !== null && p.x !== undefined) st.arrivals.push({ id: p.llega, err: Math.hypot(st.x - p.x, st.z + p.y) });
      UGV.emit('autoArrive', p.llega);
      if (pl.vencido) { autoCerrar('tiempo cumplido', 'TIEMPO CUMPLIDO'); return; }
      if (p.esperar === 'orden') { pi.modo = 'ESPERANDO ORDEN'; return; } }
    pl.t += dt; if (pl.t >= p.esperar) autoNext();
    return;
  }
  if (!pl.started) {
    if (pl.vencido) { autoCerrar('tiempo cumplido', 'TIEMPO CUMPLIDO'); return; }   // vencido el tiempo no empieza nada nuevo
    pl.started = true; pl.t = 0; pl.dur = p.duracion; pl.p0 = poseConocida(); if (p.fin) pi.pos = null;
    const [sl, sr] = TIPOS[p.tipo]; piMover(sl * p.velocidad, sr * p.velocidad, false);
  }
  pl.t += dt;
  if (pl.t >= pl.dur) {
    if (p.fin) { pi.pos = FINCA.puntos[p.fin.pos] ? p.fin.pos : null; pi.rumbo = p.fin.rumbo; pi.x = p.fin.x; pi.y = p.fin.y; pi.aprox = false; }
    const term = pl.terminarTras; autoNext();
    const nx = pl.pasos[pl.i]; if (MOVS.includes(p.tipo) && !(nx && MOVS.includes(nx.tipo))) piMover(0, 0);
    if (term && !(nx && nx.llega !== undefined)) autoCerrar('tiempo cumplido', 'TIEMPO CUMPLIDO');
  }
}
Sim.auto = {
  listo(necesita) {
    if (!pi.on || pi.boot > 0) return 'La Raspberry Pi no está lista: revisa la batería y el circuito.';
    if (pi.frozen) return 'El programa está bloqueado: desconecta la batería para reiniciar.';
    if (st.wifiCut) return 'Sin Wi-Fi el celular no puede dar la orden.';
    if (pi.rec || (pi.plan && pi.modo === 'AUTOMÁTICO')) return 'El vehículo está en marcha: espera a que llegue, páusalo o deténlo.';
    if (necesita === 'punto' && (pi.pos === null || pi.rumbo === null || pi.aprox)) return 'No se sabe en qué punto está el robot: llévalo a uno y pulsa «El robot está aquí».';
    if (necesita === 'pose' && (pi.x === null || pi.rumbo === null)) return 'No se sabe dónde está el robot: indícalo con «El robot está aquí».';
    if (!st.cfg.cm_s || !st.cfg.grados_s) return 'Primero calibra el avance y el giro.';
    return null;
  },
  iniciar(nombre, necesita, planear, tour) {
    const err = this.listo(necesita); if (err) { UGV.emit('toast', err); return false; }
    if (st.bench) Sim.setBench(false);
    const pose = poseConocida(), tem = st.temporal;
    let r; try { r = planear(pose); } catch (e) { UGV.emit('toast', e.message); return false; }
    if (tem && !(tem.limite_s >= 5 && tem.limite_s <= 8 * 3600)) { UGV.emit('toast', 'El tiempo límite va de 5 s a 8 h.'); return false; }
    pi.plan = { nombre, pasos: r.pasos, nodos: r.nodos, i: 0, t: 0, dur: 0, hecho: 0, tTotal: 0, tour, started: false, arrived: false, sigue: false, p0: null,
      limite: tem ? tem.limite_s : null, alTerminar: tem ? tem.al_terminar : 'detener', vencido: false, terminarTras: false,
      total: r.pasos.reduce((s, p) => s + (p.duracion || 0) + (typeof p.esperar === 'number' ? p.esperar : 0), 0) };
    pi.plan.linea = lineaPlan(pose, r.pasos);
    pi.modo = 'AUTOMÁTICO'; pi.ultima = st.t; st.mode = 'auto'; st.jx = st.jy = 0; st.keys = {}; st.arrivals = [];
    drawAutoLine(pi.plan.linea); UGV.emit('mode', st.mode); return true;
  },
  ir(dest) { if (dest === pi.pos && !pi.plan) { UGV.emit('toast', `El robot ya está en ${dest}.`); return false; }
    return this.iniciar(`ir a ${dest}`, 'punto', () => UGV.Auto.planPuntos(MAPA, pi.pos, pi.rumbo, [dest], st.cfg, st.esperarOrden), false); },
  recorrido(desdeCero) {
    if (desdeCero || pi.tourI >= MAPA.orden.length) pi.tourI = 0;
    let dest = MAPA.orden.slice(pi.tourI).concat([MAPA.inicio]);
    if (dest[0] === pi.pos && !this.listo('punto')) { dest = dest.slice(1); if (pi.tourI < MAPA.orden.length) pi.tourI++; }
    return this.iniciar('recorrido completo' + (desdeCero ? ' desde cero' : ''), 'punto', () => UGV.Auto.planPuntos(MAPA, pi.pos, pi.rumbo, dest, st.cfg, st.esperarOrden), true);
  },
  coordenadas(puntos) { return this.iniciar('ruta por coordenadas', 'pose', pose => UGV.Auto.planCoordenadas(pose, puntos, st.cfg, st.esperarOrden, MAPA), false); },
  instrucciones(texto) { return this.iniciar('ruta en metros y grados', null, pose => UGV.Auto.planInstrucciones(pose, UGV.Auto.leerInstrucciones(texto), st.cfg, MAPA), false); },
  siguiente() { if (pi.modo !== 'ESPERANDO ORDEN' || !pi.plan) { UGV.emit('toast', 'El robot no está esperando una orden.'); return false; } pi.plan.sigue = true; return true; },
  pausar() {
    if (!pi.plan || pi.modo !== 'AUTOMÁTICO') { UGV.emit('toast', 'No hay una misión en marcha.'); return false; }
    pi.izq = pi.der = pi.oI = pi.oD = 0; pi.modo = 'PAUSADO'; return true;
  },
  reanudar() {
    const pl = pi.plan;
    if (!pl || !(pi.modo === 'PAUSADO' || pi.modo === 'DETENIDO POR SEGURIDAD')) { UGV.emit('toast', 'No hay una misión pausada.'); return false; }
    if (st.wifiCut) { UGV.emit('toast', 'Sin Wi-Fi el celular no puede dar la orden.'); return false; }
    if (pl.started) { // el resto del paso empieza desde la posición estimada
      const p = pl.pasos[pl.i], e = UGV.Auto.poseEnPaso(pl.p0, p, pl.dur ? pl.t / pl.dur : 1);
      pl.hecho += pl.t; pl.dur = Math.max(0, pl.dur - pl.t); pl.t = 0; pl.p0 = e;
      const [sl, sr] = TIPOS[p.tipo]; piMover(sl * p.velocidad, sr * p.velocidad, false);
    }
    pi.modo = 'AUTOMÁTICO'; pi.ultima = st.t; return true;
  },
  manual() { // tomar el control manual: solo con la misión pausada, esperando o detenida
    if (!pi.plan) return true;
    if (pi.modo === 'AUTOMÁTICO') { UGV.emit('toast', 'La misión está en marcha: primero pausa.'); return false; }
    autoCerrar('cancelada para tomar el control manual', 'ESPERA'); st.mode = 'remoto'; UGV.emit('mode', st.mode); return true;
  },
  posicion(id) { // el usuario lleva el robot al punto y lo indica (en el simulador, el robot se coloca allí)
    if (pi.rec || (pi.plan && pi.modo === 'AUTOMÁTICO') || piMoviendo()) { UGV.emit('toast', 'Detén el vehículo antes de indicar dónde está.'); return false; }
    if (pi.plan) { pi.plan = null; drawAutoLine(null); }
    const [x, z] = ptXZ(id), rumbo = +(FINCA.rumbo_inicial ?? 90);
    Object.assign(st, { x, z, yaw: rumbo * DEG, vl: 0, vr: 0, bench: false }); pi.pos = id; pi.rumbo = rumbo; pi.x = x; pi.y = -z; pi.aprox = false;
    pi.modo = pi.on ? 'ESPERA' : pi.modo; if (id === FINCA.inicio) pi.tourI = 0;
    st.surface = 'finca'; Sim.cmd('clear', true); UGV.emit('bench', false); return true;
  },
  /* Calibración como la haría el equipo: avanzar y girar 5 s a vel_auto en un camino de la finca y medir (aquí el simulador mide) */
  calibrar(silencio) {
    // tensión de la batería con los motores andando (la prueba se hace con el robot en marcha)
    const vb = 2 * ocvCell(st.soc) - (P.irpi * 5 / (8 * .88) + 2 * .3) * P.rint * 2;
    const v = st.cfg.vel_auto / 100, T5 = st.cfg.prueba_s, Te = T5, av = () => ghost([[v, v, T5], [0, 0, 1]], SOIL.camino, true, vb);
    const mide = () => { const d = av(), g = ghost([[-v, v, T5], [0, 0, 1]], SOIL.camino, true, vb);
      st.cfg.cm_s = Math.round(Math.hypot(d.x, d.z) / Te * 100) / 100; st.cfg.grados_s = Math.round(Math.abs(g.yaw) / DEG / Te * 100) / 100; return d; };
    // 1) avance y giro; 2) desvío lateral del avance → factor de cada motor (misma fórmula que _ajustar_motores en robot/misiones.py); 3) se repite con el factor nuevo
    //    como hace el equipo: se repite la prueba de avance hasta que casi no se desvíe (el simulador mide con más precisión que una cinta)
    const desvio = -mide().z; let d = desvio;
    for (let k = 0; k < 25 && Math.abs(d) >= .05; k++) {
      const largo = st.cfg.cm_s * Te, ancho = 2 * st.cfg.cm_s / (st.cfg.grados_s * DEG), r = .5 * 2 * d / (largo * largo) * ancho;
      st.factorDer = Math.round(Math.min(1, st.factorDer / (1 + r)) * 10000) / 10000; d = -mide().z;
    }
    st.calSoc = st.soc; UGV.emit('factor', st.factorDer);
    if (!silencio) UGV.emit('toast', `Calibración en el camino: ${Math.round(st.cfg.cm_s * Te)} cm y ${Math.round(st.cfg.grados_s * Te)}° en ${T5} s (desvío inicial ${Math.round(desvio)} cm) → ${String(st.cfg.cm_s).replace('.', ',')} cm/s, ${String(st.cfg.grados_s).replace('.', ',')} °/s y factor del motor B ${String(st.factorDer).replace('.', ',')}.`);
    UGV.emit('calib', st.cfg); return st.cfg;
  }
};
/* Modelo del robot real (con diferencia entre motores y factor de ajuste) en un suelo dado, desde reposo: para la calibración */
function ghost(steps, soil, real, vb) {
  let x = 0, z = 0, yaw = 0, vl = 0, vr = 0; const dt = 1 / 60; const vbat = vb || st.vbat;
  steps.forEach(([L, R, dur]) => { const turn = L !== R ? 1 : 0, Rf = real ? R * st.factorDer : R;
    const tl = trackSpeed(L, vbat, reqTorque(turn, 0, soil)).v, tr = trackSpeed(Rf, vbat, reqTorque(turn, 0, soil)).v * (real ? 1 + st.mismatch : 1);
    for (let k = 0, n = Math.round(dur / dt); k < n; k++) { vl += (tl - vl) * dt / P.tau; vr += (tr - vr) * dt / P.tau;
      yaw += (vr - vl) / (G.WB * st.slip * soil.chi) * dt; const v = (vl + vr) / 2 * soil.slipLong; x += v * Math.cos(yaw) * dt; z -= v * Math.sin(yaw) * dt; } });
  return { x, z, yaw };
}
Sim.ghost = ghost;

/* ---------- Recorrido por tramos: plan ideal (tramos rectos) y desviación final ---------- */
/* Velocidad (cm/s) y giro (rad/s) esperados en superficie firme, sin diferencia entre motores ni carga extra */
function nominal(vel, tipo) {
  const [sl, sr] = TIPOS[tipo]; if (!sl && !sr) return { v: 0, w: 0 };
  const d = vel / 100, soil = SOIL.firme, turn = sl !== sr ? 1 : 0, treq = reqTorque(turn, 0, soil, 0);
  const s = trackSpeed(d, Math.max(st.vbat, 7), treq).v;
  return { v: (sl + sr) / 2 * s * soil.slipLong, w: turn ? (sr - sl) * s / (G.WB * st.slip * soil.chi) : 0 };
}
Sim.nominal = nominal;
/* Recorrido previsto: el mismo modelo del robot en superficie firme, sin carga extra, sin diferencia entre motores
   y con la batería actual, incluido el tiempo que tardan los motores en acelerar y frenar */
function planRoute(from) {
  const o = from || { x: st.x, z: st.z, yaw: st.yaw }, pts = [[o.x, o.z]], soil = SOIL.firme, dt = 1 / 60;
  let { x, z, yaw } = o, vl = 0, vr = 0;
  const sp = (d, turn) => trackSpeed(d, Math.max(st.vbat, 7), reqTorque(turn, 0, soil, 0)).v;
  const avanza = (L, R, dur) => { const turn = L !== R ? 1 : 0, tl = sp(L, turn), tr = sp(R, turn);
    for (let k = 0, n = Math.round(dur / dt); k < n; k++) { vl += (tl - vl) * dt / P.tau; vr += (tr - vr) * dt / P.tau;
      yaw += (vr - vl) / (G.WB * st.slip * soil.chi) * dt; const v = (vl + vr) / 2 * soil.slipLong; x += v * Math.cos(yaw) * dt; z -= v * Math.sin(yaw) * dt;
      const q = pts[pts.length - 1]; if (Math.hypot(x - q[0], z - q[1]) > 3) pts.push([x, z]); } };
  route.forEach(t => { const [sl, sr] = TIPOS[t.tipo]; avanza(sl * t.velocidad / 100, sr * t.velocidad / 100, t.duracion); });
  avanza(0, 0, 1); pts.push([x, z]); // al final los motores frenan
  st.plan = { pts, end: [x, z] };
  if (Sim.planLine) { Sim.planLine.geometry.dispose(); Sim.planLine.geometry = new T.BufferGeometry().setFromPoints(pts.map(([px, pz]) => new T.Vector3(px, H(px, pz) + 1.2, pz))); Sim.planLine.computeLineDistances(); }
  return st.plan;
}
Sim.planRoute = planRoute;
/* Recorrido A-B-C de la Tabla 13 con las duraciones que en superficie firme dan A→B 200 cm, 90° a la derecha y B→C 150 cm */
Sim.defaultRoute = (vel = 60) => {
  const nv = nominal(vel, 'avanzar').v, nw = Math.abs(nominal(vel, 'derecha').w), r1 = x => Math.max(.1, Math.round(x * 10) / 10);
  return [{ tipo: 'avanzar', velocidad: vel, duracion: r1(200 / nv) }, { tipo: 'pausa', velocidad: 0, duracion: 1 },
    { tipo: 'derecha', velocidad: vel, duracion: r1(Math.PI / 2 / nw) }, { tipo: 'avanzar', velocidad: vel, duracion: r1(150 / nv) }, { tipo: 'pausa', velocidad: 0, duracion: .5 }];
};
Sim.runRoute = () => {
  if (!pi.on || pi.boot > 0) { UGV.emit('toast', 'La Raspberry Pi no está lista: revisa la batería y el circuito.'); return false; }
  if (pi.frozen) { UGV.emit('toast', 'El programa está bloqueado: desconecta la batería para reiniciar.'); return false; }
  if (st.wifiCut) { UGV.emit('toast', 'Sin Wi-Fi el celular no puede iniciar el recorrido.'); return false; }
  if (!route.length) { UGV.emit('toast', 'Agrega al menos un tramo.'); return false; }
  if (pi.plan && pi.modo === 'AUTOMÁTICO') { UGV.emit('toast', 'Hay un recorrido automático en curso.'); return false; }
  if (st.bench) Sim.setBench(false);
  if (pi.plan) { pi.plan = null; drawAutoLine(null); }
  st.mode = 'recorrido'; st.jx = st.jy = 0; st.keys = {}; st.routeAborted = false; st.dev = null;
  planRoute(); if (Sim.planLine) Sim.planLine.visible = true; pi.rec = { i: 0, t: 0 }; pi.ultima = st.t; pi.pos = pi.rumbo = pi.x = pi.y = null; Sim.cmd('clear', true);
  UGV.emit('mode', st.mode); return true;
};
function routeEnd() {
  const e = st.plan ? st.plan.end : [st.x, st.z]; st.dev = Math.hypot(st.x - e[0], st.z - e[1]); st.devLast = st.dev; st.routes++;
  if (!st.quiet) UGV.emit('toast', `Recorrido terminado: el vehículo quedó a ${st.dev.toFixed(1).replace('.', ',')} cm del punto final previsto.`);
  UGV.emit('routeEnd', st.dev);
}

/* ---------- Comandos de la interfaz ---------- */
Sim.cmd = (name, quiet) => {
  if (name === 'stop') { st.jx = st.jy = 0; st.keys = {}; Sim.piParar(); if (st.mode !== 'remoto') { st.mode = 'remoto'; UGV.emit('mode', st.mode); } }
  if (name === 'clear') { st.path = [[st.x, st.z]]; clearTrail(Sim.trail); if (!quiet) st.dev = null; }
  if (name === 'reset') Sim.toMark(st.surface);
};
Sim.toMark = id => {
  if (id === 'finca') { st.surface = 'finca'; if (pi.on && !pi.frozen) piParar('detener'); Sim.auto.posicion(FINCA.inicio); planRoute(); if (Sim.planLine) Sim.planLine.visible = false;
    if (controls && view === 'orbit') { controls.target.set(st.x, H(st.x, st.z) + 5, st.z); camera.position.set(st.x + 90, 80, st.z + 110); } return; }
  st.surface = id; const m = marksFor(id); pi.pos = pi.rumbo = pi.x = pi.y = null; if (Sim.planLine) Sim.planLine.visible = true;
  Object.assign(st, { x: m.A[0], z: m.A[1], yaw: m.yaw, vl: 0, vr: 0, dev: null });
  if (pi.on && !pi.frozen) piParar('detener');
  if (st.bench) Sim.setBench(false);
  Sim.cmd('clear', true); planRoute(); if (controls && view === 'orbit') { controls.target.set(st.x, H(st.x, st.z) + 5, st.z); camera.position.set(st.x + 60, 55, st.z + 70); }
};
Sim.setMode = m => { if (m === 'remoto' && (pi.rec || pi.plan) && pi.on && !pi.frozen) piParar('detener'); st.mode = m; UGV.emit('mode', m); };
Sim.setJoy = (x, y) => {
  if ((x || y) && (pi.plan || pi.rec)) { if (!st.busyMsg) UGV.emit('toast', 'Hay un recorrido en curso: deténgalo primero (Parar).'); st.busyMsg = true; return; }
  st.busyMsg = false; st.jx = x; st.jy = y; if ((x || y) && st.mode !== 'remoto') Sim.setMode('remoto'); };
Sim.setLoad = kg => { st.load = kg; const p = Sim.parcel; p.visible = kg > 0; if (kg > 0) { const s = 3 + kg * 1.2; p.scale.set(s, s * .55, s); p.position.set(-2.6, G.PLATE_Y + 6.8 + s * .27, 0); } };
Sim.setBench = on => { st.bench = on; if (on) { st.keepPose = { x: st.x, z: st.z, yaw: st.yaw }; Object.assign(st, { x: Sim.benchPos.x, z: Sim.benchPos.z, yaw: Math.PI / 2, vl: 0, vr: 0 }); }
  else if (st.keepPose) { Object.assign(st, st.keepPose, { vl: 0, vr: 0 }); st.keepPose = null; } Sim.cmd('clear', true); UGV.emit('bench', on); };
Sim.setWifiCut = on => { st.wifiCut = on; };
Sim.setFrozen = on => { if (!pi.on) return; pi.frozen = on; if (!on) { pi.boot = P.boot; piParar('detener'); } };
Sim.setBattery = on => { S.batteryOn = on; UGV.save(); an = UGV.analyze(st.vbat); anT = .25; UGV.emit('wires'); };
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && UGV.activeTab === 'sim') { st.keys[k] = true; if (st.mode !== 'remoto') Sim.setMode('remoto'); e.preventDefault(); }
  if (k === ' ' && UGV.activeTab === 'sim') { Sim.cmd('stop'); e.preventDefault(); } });
addEventListener('keydown', e => { if (pi.plan || pi.rec) { const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) st.keys = {}; } }, true);
addEventListener('keyup', e => { st.keys[e.key.toLowerCase()] = false; });

function clearTrail(t) { if (!t) return; t.n = 0; t.g.setDrawRange(0, 0); }
function pushTrail(t, x, z) { if (!t || t.n >= 12000) return; t.g.attributes.position.setXYZ(t.n, x, H(x, z) + .5, z); t.n++; t.g.attributes.position.needsUpdate = true; t.g.setDrawRange(0, t.n); }

/* Colisiones (radio del robot ≈ 10 cm): cerca, lotes de cultivo, paredes, troncos, rampa y banco */
const RR = 10;
function blockedAt(x, z, m) {
  if (x < AREA.x0 + m || x > AREA.x1 - m || z < AREA.z0 + m || z > AREA.z1 - m) return 'cerca';
  const lot = LY.lotAt(x, z, m); if (lot) return lot;
  for (const w of LY.WALLS) if (LY.inRect(x, z, w, m)) return 'pared';
  for (const t of LY.TREES) if (Math.hypot(x - t.x, z - t.z) < (t.k === 'guadua' ? 40 : 22) + m) return 'árbol';
  if (z < RAMP.zBase - 15 && z > RAMP.zEnd - 10 && (x < RAMP.x0 + m || x > RAMP.x1 - m) && x > RAMP.x0 - 60 && x < RAMP.x1 + 60) return 'rampa';
  if (Math.hypot(x - Sim.benchPos.x, z - Sim.benchPos.z) < 45 + m && !st.bench) return 'banco';
  return null;
}
Sim.blockedAt = blockedAt;

/* Velocidad de oruga (cm/s) con curva torque-velocidad del motor */
function trackSpeed(duty, vbat, treq) {
  const ve = Math.max(0, vbat * Math.abs(duty) - P.drop), ts = P.tstall12 * ve / 12;
  const f = ts > 0 ? clamp(1 - treq / ts, 0, 1.15) : 0;
  return { v: Math.sign(duty) * P.rpm12 * ve / 12 * f * 2 * Math.PI * G.WR / 60, f, ve };
}
Sim.vTop = () => trackSpeed(1, st.vbat, reqTorque(0, 0, SOIL.firme)).v;
/* Torque por oruga: rodadura + giro + componente del peso en la pendiente (positiva cuesta arriba) */
function reqTorque(turnFrac, grade, soil, load = st.load) { const m = Sim.robotMass() + load, g = 9.81, r = G.WR / 100, cb = Math.cos(grade);
  return r * (soil.mur * m * g * cb / 2 + P.mulat * (soil === SOIL.arena ? 1.2 : 1) * m * g * cb * P.contact / (2 * G.WB / 100) * turnFrac + m * g * Math.sin(grade) / 2); }
Sim.reqTorque = reqTorque;

/* ---------- Paso de simulación ---------- */
function step(dt) {
  st.t += dt;
  anT -= dt; if (!an || anT <= 0) { an = UGV.analyze(st.vbat); anT = .25; Sim.an = an; }
  if (st.testCmd) { // pruebas automáticas: el programa recibe la orden directamente
    if (an.rpiOn && !pi.frozen) { piMover(st.testCmd[0] * 100, st.testCmd[1] * 100, false); pi.ultima = st.t; pi.on = true; pi.boot = 0; pi.modo = 'PRUEBA'; }
  } else piStep(dt);
  const okA = driveOK(an, 'A'), okB = driveOK(an, 'B');
  const L = pi.izq / 100, R = pi.der / 100;
  const soil = SOIL[st.soil = soilAt(st.x, st.z)];
  st.dutyL = L; st.dutyR = R;
  const effL = okA ? L * okA : 0, effR = okB ? R * okB : 0;
  if ((L || R) && (!okA || !okB) && !st.noDriveMsg && !st.quiet) { st.noDriveMsg = true; UGV.emit('toast', !okA && !okB ? 'Los motores no reciben señal: revisa las conexiones en Circuito.' : `El motor ${!okA ? 'A' : 'B'} no recibe señal: revisa su conexión.`); }
  if (!L && !R) st.noDriveMsg = false;
  const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw);
  const hF = H(st.x + fx * 7, st.z + fz * 7), hB = H(st.x - fx * 7, st.z - fz * 7); st.grade = st.bench ? 0 : Math.atan2(hF - hB, 14);
  const dirS = Math.sign(effL + effR);
  const turnFrac = (Math.abs(effL) + Math.abs(effR)) > .01 ? Math.abs(effL - effR) / (Math.abs(effL) + Math.abs(effR)) : 0;
  const treq = st.bench ? reqTorque(0, 0, SOIL.firme, -Sim.robotMass() * .9) : reqTorque(turnFrac, st.grade * dirS, soil);
  const A = trackSpeed(effL, st.vbat, treq), Bm = trackSpeed(effR, st.vbat, treq);
  st.sf = Math.min(Math.abs(effL) > .05 ? A.f : 1, Math.abs(effR) > .05 ? Bm.f : 1);
  if (st.sf < .06 && (Math.abs(effL) > .2 || Math.abs(effR) > .2)) { if (!st.stallMsg && !st.quiet) { st.stallMsg = true; UGV.emit('toast', st.grade * dirS > 3 * DEG ? `Rampa de ${Math.round(st.grade * dirS / DEG)}° con ${String(st.load).replace('.', ',')} kg: los motores no tienen torque suficiente.` : `Los motores no tienen fuerza para ${turnFrac > .5 ? 'girar en el sitio' : 'moverse'} a esta velocidad.`); } } else st.stallMsg = false;
  const a = Math.min(1, dt / P.tau);
  st.vl += (A.v - st.vl) * a; st.vr += (Bm.v * (1 + st.mismatch) - st.vr) * a;
  let v = 0, w = 0;
  if (!st.bench) {
    v = (st.vl + st.vr) / 2 * soil.slipLong * Math.cos(st.grade); w = (st.vr - st.vl) / (G.WB * st.slip * soil.chi);
    const ny = st.yaw + w * dt, nx = st.x + v * Math.cos(ny) * dt, nz = st.z - v * Math.sin(ny) * dt;
    const hit = blockedAt(nx, nz, RR);
    if (!hit) { st.x = nx; st.z = nz; st.bump = false; st.cropHit = null; }
    else { if (!st.bump) { st.bumps++; if (hit.cultivo && st.cropHit !== hit) { st.crops++; st.cropHit = hit; if (!st.quiet) UGV.emit('toast', `¡El robot se metió en el lote «${hit.name}»! En lazo abierto la desviación acumulada lo sacó del camino.`); } }
      st.vl *= .2; st.vr *= .2; st.bump = true; }
    st.yaw = ny;
  }
  if (chassis) { chassis.tracks[-1].off += st.vl * dt; chassis.tracks[1].off += st.vr * dt; }
  const lp = st.path[st.path.length - 1]; if (!lp || Math.hypot(st.x - lp[0], st.z - lp[1]) > 3) { st.path.push([st.x, st.z]); if (st.path.length > 12000) st.path.shift(); if (!st.quiet && !st.bench) pushTrail(Sim.trail, st.x, st.z); }
  if (st.plan && pi.rec) { const e = st.plan.end; st.err = Math.hypot(st.x - e[0], st.z - e[1]); }
  // batería: 2 celdas en serie; motores por el L298N y la Raspberry Pi por el DC-DC
  const ve = Math.max(.1, st.vbat - P.drop), istall = P.istall12 * ve / 12;
  const im = (eff) => Math.abs(eff) > .01 ? Math.min(istall * Math.abs(eff) + .02, P.i0 + (P.istall12 - P.i0) * Math.max(0, treq) / P.tstall12) : 0;
  st.iL = im(effL); st.iR = im(effR);
  let i = st.iL + st.iR;
  if (an.rpiOn) i += P.irpi * 5 / (Math.max(1, st.vbat) * .88);
  if (S.batteryOn === false || (S.on.switch && !S.switchClosed)) i = 0;
  st.ibat = i; st.soc = Math.max(0, st.soc - i * dt * st.timeScale / 3600 / P.capAh);
  st.vbat = Math.max(0, 2 * ocvCell(st.soc) - i * P.rint * 2);
  st.pl298 = (st.iL + st.iR) * P.drop; // potencia que se vuelve calor en el L298N (W)
  // registro
  st.logT = (st.logT || 0) + dt;
  if (st.logT >= .1 && !st.quiet) { st.logT = 0; const row = { t: +st.t.toFixed(1), v: +v.toFixed(2), w: +(w * 57.2958).toFixed(1), i: +i.toFixed(3), vbat: +st.vbat.toFixed(3), soc: +(st.soc * 100).toFixed(1), pwmA: Math.round(effL * 100), pwmB: Math.round(effR * 100),
    x: +st.x.toFixed(1), z: +st.z.toFixed(1), err: pi.rec && st.err !== undefined ? +st.err.toFixed(1) : '', grade: +(st.grade / DEG).toFixed(1), soil: st.bench ? 'banco' : st.soil, load: st.load, state: pi.frozen ? 'PROGRAMA BLOQUEADO' : pi.modo };
    hist.push(row); if (hist.length > 600) hist.shift(); log.push(row); if (log.length > 30000) log.shift(); }
  return { v, w };
}
Sim.stepN = (n, dt = 1 / 60) => { let r; for (let i = 0; i < n; i++) r = step(dt); return Object.assign({}, st, r); };
Sim.csv = () => { const cols = ['t', 'state', 'v', 'w', 'i', 'vbat', 'soc', 'pwmA', 'pwmB', 'x', 'z', 'err', 'grade', 'soil', 'load'],
  head = ['tiempo_s', 'estado', 'velocidad_cm_s', 'giro_grados_s', 'corriente_A', 'bateria_V', 'carga_bateria_pct', 'pwm_A_pct', 'pwm_B_pct', 'x_cm', 'z_cm', 'distancia_al_final_previsto_cm', 'pendiente_grados', 'superficie', 'carga_kg'];
  return head.join(',') + '\n' + log.map(r => cols.map(c => r[c]).join(',')).join('\n'); };

/* ---------- Banco de pruebas simulado (protocolo P1–P10 del informe) ---------- */
Sim.runTests = async function (onProgress) {
  const keep = JSON.parse(JSON.stringify({ x: st.x, z: st.z, yaw: st.yaw, soc: st.soc, load: st.load, mode: st.mode, surface: st.surface, bench: st.bench, wifiCut: st.wifiCut }));
  const keepPath = st.path.slice(), keepRoute = route.map(t => Object.assign({}, t)), keepBatt = S.batteryOn, keepPi = Object.assign({}, pi, { rec: null, plan: null }), keepCfg = Object.assign({}, st.cfg);
  st.quiet = true; st.testing = true; const res = []; const tick = () => new Promise(r => setTimeout(r, 0));
  const refresh = () => { an = UGV.analyze(st.vbat); anT = .25; };
  const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
  const place = (id, load = 0) => { const m = marksFor(id); st.bench = false; st.load = load; st.testCmd = null; pi.plan = null; Object.assign(st, { x: m.A[0], z: m.A[1], yaw: m.yaw, vl: 0, vr: 0, bumps: 0, wifiCut: false }); Object.assign(pi, { izq: 0, der: 0, oI: 0, oD: 0, rec: null, frozen: false, boot: 0, on: true, ultima: st.t }); st.path = [[st.x, st.z]]; };
  const run = async (secs, until) => { const N = Math.round(secs * 60); for (let i = 0; i < N; i++) { step(1 / 60); if (until && until()) return (i + 1) / 60; if (i % 3000 === 0) await tick(); } return secs; };
  const add = (prueba, superficie, carga, resultado, detalle) => res.push({ prueba, superficie, carga, resultado, detalle });
  const vel = .6;
  try {
    S.batteryOn = true; st.soc = .9; refresh();
    onProgress && onProgress('P1 · motores con el vehículo levantado');
    place('firme'); st.bench = true; Object.assign(st, { x: Sim.benchPos.x, z: Sim.benchPos.z });
    const dirs = [['avanzar', [vel, vel]], ['retroceder', [-vel, -vel]], ['izquierda', [-vel, vel]], ['derecha', [vel, -vel]]], okDirs = [];
    for (const [n, c] of dirs) { st.testCmd = c; await run(1.2); okDirs.push(Math.sign(st.vl) === Math.sign(c[0]) && Math.sign(st.vr) === Math.sign(c[1]) ? n : n + ' (mal)'); }
    st.testCmd = [0, 0]; await run(1); st.bench = false;
    add('P1 · Respuesta de los motores', 'banco', '0 kg', okDirs.every(x => !/mal/.test(x)) ? 'correcta' : 'revisar', `cada oruga giró en el sentido ordenado: ${okDirs.join(', ')}; se detienen con la orden 0`);
    for (const s of ['firme', 'tierra', 'arena']) {
      onProgress && onProgress('P2 · línea recta en ' + s); place(s); st.testCmd = [vel, vel]; const x0 = st.x, z0 = st.z;
      const tt = await run(40, () => Math.hypot(st.x - x0, st.z - z0) >= 200);
      add('P2 · Avance en línea recta (200 cm)', s, '0 kg', `${fmt(200 / tt)} cm/s`, `desvío lateral ${fmt(Math.abs(st.x - x0))} cm en ${fmt(tt)} s (motores ${Math.round(st.mismatch * 100)} % distintos, factor del motor B ${fmt(st.factorDer, 2)})`);
      await tick();
    }
    for (const s of ['firme', 'tierra', 'arena']) {
      onProgress && onProgress('P3 · giro en ' + s); place(s); st.testCmd = [-vel, vel]; const y0 = st.yaw, x0 = st.x, z0 = st.z;
      const tg = await run(30, () => st.yaw - y0 >= 2 * Math.PI);
      add('P3 · Giro sobre su propio eje (una vuelta)', s, '0 kg', st.yaw - y0 >= 2 * Math.PI ? `${fmt(tg)} s` : 'no completó la vuelta', `el centro se desplazó ${fmt(Math.hypot(st.x - x0, st.z - z0))} cm`);
      await tick();
    }
    for (const kg of [0, 1, 2]) {
      onProgress && onProgress(`P4 · desempeño con ${kg} kg`); const vs = [];
      for (const s of ['firme', 'tierra', 'arena']) { place(s, kg); st.testCmd = [vel, vel]; const x0 = st.x, z0 = st.z; const tt = await run(40, () => Math.hypot(st.x - x0, st.z - z0) >= 150); vs.push(`${s} ${fmt(150 / tt)} cm/s`); }
      add('P4 · Desempeño con carga (150 cm)', 'firme, tierra y arena', `${kg} kg`, 'avanza', vs.join(' · '));
      await tick();
    }
    for (const kg of [0, 1, 2]) {
      onProgress && onProgress(`P5 · rampa con ${kg} kg`); place('rampa', kg); st.testCmd = [vel, vel]; const vr = [];
      await run(60, () => { if (st.grade > (RAMP.deg - 1) * DEG) vr.push(Math.abs(st.vl + st.vr) / 2); return st.z < RAMP.zBase - RAMP.len - 20 || (st.sf < .06 && st.t > 1); });
      const up = st.z < RAMP.zBase - RAMP.len - 20, avg = vr.length ? vr.reduce((s, x) => s + x, 0) / vr.length : 0;
      add(`P5 · Subida de rampa de ${RAMP.deg}°`, 'tierra (rampa)', `${kg} kg`, up ? 'sube' : 'no sube', up ? `velocidad de las orugas en la pendiente ${fmt(avg)} cm/s · margen de torque ${Math.round(st.sf * 100)} %` : 'los motores no tienen torque suficiente');
      await tick();
    }
    add('P6 · Alcance y respuesta del control por Wi-Fi', 'firme', '0 kg', 'medir en el prototipo', 'el alcance depende de la antena y del entorno: el simulador no lo estima');
    onProgress && onProgress('P7 · detención por pérdida de comunicación');
    place('firme'); st.mode = 'remoto'; st.jy = 1; st.held = false; pi.modo = 'ESPERA'; await run(1.5); st.wifiCut = true; const t0 = st.t;
    await run(5, () => pi.modo === 'DETENIDO POR SEGURIDAD'); const tStop = st.t - t0; await run(2, () => Math.abs(st.vl + st.vr) < .5); const tHalt = st.t - t0;
    st.jy = 0; st.wifiCut = false;
    add('P7 · Detención sin órdenes (Wi-Fi cortado)', 'firme', '0 kg', `${fmt(tHalt, 2)} s`, `el programa detuvo los motores a los ${fmt(tStop, 2)} s (parada a los ${st.timeoutMs} ms sin órdenes); el resto es la inercia`);
    await tick();
    for (const s of ['firme', 'tierra', 'arena']) for (const kg of [0, 2]) {
      onProgress && onProgress(`P8 · recorrido A-B-C en ${s} con ${kg} kg`); place(s, kg); st.testCmd = null; st.mode = 'recorrido';
      route = Sim.route = Sim.defaultRoute(); planRoute(); pi.rec = { i: 0, t: 0 }; pi.ultima = st.t;
      await run(60, () => !pi.rec); const e = st.plan.end;
      add('P8 · Recorrido programado A-B-C', s, `${kg} kg`, `${fmt(Math.hypot(st.x - e[0], st.z - e[1]))} cm`, `distancia entre el punto C previsto y el alcanzado (tramos por tiempo calibrados en superficie firme sin carga)`);
      await tick();
    }
    st.mode = 'remoto';
    onProgress && onProgress('Recorrido automático completo por la finca');
    { st.testCmd = null; st.load = 0; st.wifiCut = false; Sim.auto.posicion(FINCA.inicio); pi.on = true; pi.boot = 0; Sim.auto.calibrar(true); const c0 = st.crops; let maxOff = 0; st.esperarOrden = false;
      Sim.auto.recorrido(true); const tt = await run(900, () => { maxOff = Math.max(maxOff, LY.pathDist(st.x, st.z)); return !pi.plan; });
      const arr = st.arrivals.filter(a => a.id !== FINCA.inicio || st.arrivals.length), errs = arr.map(a => `${a.id} ${fmt(a.err, 0)} cm`);
      add('Autónomo · recorrido completo por los caminos', 'finca (caminos de tierra)', '0 kg', st.crops - c0 ? `${st.crops - c0} lotes tocados` : '0 cultivos tocados',
        `${fmt(tt, 0)} s · ${arr.length} llegadas con 1 s de espera · separación máxima del centro del camino ${fmt(maxOff, 0)} cm (el borde de los lotes está a ${LY.PATH_HALF} cm) · error al llegar: ${errs.join(', ')}`);
      st.mode = 'remoto'; await tick(); }
    onProgress && onProgress('P9 · duración de la batería'); place('firme', 1); st.testCmd = [vel, vel]; await run(3); const ia = st.ibat;
    add('P9 · Duración de la batería (estimada)', 'firme', '1 kg', `≈ ${Math.round(P.capAh * .85 / ia * 60)} min`, `${Math.round(ia * 1000)} mA con la Raspberry Pi y los dos motores al ${Math.round(vel * 100)} %; usa el 85 % de ${P.capAh * 1000} mAh (capacidad supuesta)`);
    onProgress && onProgress('P10 · calentamiento del L298N'); place('firme', 2); st.testCmd = [vel, vel]; await run(3);
    add('P10 · Calentamiento del L298N', 'firme', '2 kg', `≈ ${fmt(st.pl298, 2)} W`, 'potencia que se pierde como calor en el puente H con la caída supuesta; la temperatura se mide en el prototipo');
  } finally {
    st.testCmd = null; S.batteryOn = keepBatt; route = Sim.route = keepRoute;
    Object.assign(st, keep, { vl: 0, vr: 0, quiet: false, testing: false, jy: 0, jx: 0, held: false }); st.path = keepPath; st.cfg = keepCfg; drawAutoLine(null);
    Object.assign(pi, keepPi, { izq: 0, der: 0, rec: null, modo: keepPi.on ? 'ESPERA' : keepPi.modo, ultima: st.t });
    refresh(); Sim.setLoad(st.load); planRoute(); UGV.emit('mode', st.mode); UGV.emit('route', route);
  }
  return res;
};

/* ---------- Bucle principal ---------- */
let last = performance.now(), telT = 0, wireT = 0;
const tel = Sim.tel = {};
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (UGV.activeTab === 'sim' || UGV.activeTab === 'circ') {
    let r = { v: 0, w: 0 }; const k = st.testing ? 0 : st.simSpeed || 1; for (let i = 0; i < k; i++) r = step(dt);
    const { v, w } = r;
    const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw), sx = -fz, sz = fx;
    let y = H(st.x, st.z), pitch = Math.atan2(H(st.x + fx * 7, st.z + fz * 7) - H(st.x - fx * 7, st.z - fz * 7), 14), roll = Math.atan2(H(st.x + sx * 6, st.z + sz * 6) - H(st.x - sx * 6, st.z - sz * 6), 12);
    if (st.bench) { y = Sim.benchPos.y; pitch = roll = 0; }
    robot.position.set(st.x, y, st.z); robot.rotation.set(-roll, st.yaw, pitch); Sim.contact.visible = !st.bench;
    chassis.updateTrack(chassis.tracks[-1]); chassis.updateTrack(chassis.tracks[1]);
    wireT -= dt; if (wiresOn && wireT <= 0) { wireT = .05; wireMeshes.forEach(o => { const s = o.w.sig; let lv = 0;
      if (s === 'ENA') lv = Math.abs(st.dutyL); else if (s === 'ENB') lv = Math.abs(st.dutyR); else if (s === 'IN1') lv = st.dutyL > 0; else if (s === 'IN2') lv = st.dutyL < 0;
      else if (s === 'IN3') lv = st.dutyR > 0; else if (s === 'IN4') lv = st.dutyR < 0; else if (s === 'MA') lv = Math.abs(st.dutyL); else if (s === 'MB') lv = Math.abs(st.dutyR);
      o.m.material.emissiveIntensity = +lv * .55; }); }
    if (view === 'follow') { const back = new T.Vector3(-fx * 60, 34, -fz * 60).add(new T.Vector3(st.x, y, st.z)); camera.position.lerp(back, .07); camera.lookAt(st.x, y + 6, st.z); }
    else if (view === 'top') { camera.position.lerp(new T.Vector3(st.x, y + 520, st.z + .01), .1); camera.lookAt(st.x, y, st.z); }
    else controls.update();
    sun.position.set(st.x + 120, y + 420, st.z + 90); sun.target.position.set(st.x, y, st.z);
    if (selBox) selBox.update();
    renderer.render(scene, camera);
    telT -= dt; if (telT <= 0) { telT = .1;
      Object.assign(tel, { v, w, vbat: st.vbat, soc: st.soc, ibat: st.ibat, iL: st.iL, iR: st.iR, dutyL: st.dutyL, dutyR: st.dutyR, mode: st.mode,
        x: st.x, z: st.z, yaw: st.yaw, warnings: an.warnings, okA: driveOK(an, 'A'), okB: driveOK(an, 'B'), load: st.load, mass: Sim.robotMass() + st.load, sf: st.sf,
        state: pi.frozen ? 'PROGRAMA BLOQUEADO' : pi.modo, piOn: pi.on, pos: pi.pos, rumbo: pi.rumbo, pose: { x: pi.x, y: pi.y, rumbo: pi.rumbo, aprox: pi.aprox }, tourI: pi.tourI, crops: st.crops, ultimaMision: pi.ultimaMision,
        auto: pi.plan ? { nombre: pi.plan.nombre, nodos: pi.plan.nodos, i: pi.plan.i, limite: pi.plan.limite, restante: pi.plan.limite ? Math.max(0, pi.plan.limite - pi.plan.tTotal) : null,
          progreso: Math.min(100, 100 * (pi.plan.hecho + (pi.plan.started ? pi.plan.t : 0)) / (pi.plan.total || 1)), hacia: (pi.plan.pasos[pi.plan.i] || {}).hacia || (pi.plan.pasos[pi.plan.i] || {}).llega,
          destino: (pi.plan.pasos.slice(pi.plan.i + ((pi.plan.pasos[pi.plan.i] || {}).llega !== undefined ? 1 : 0)).find(q => q.llega !== undefined) || {}).llega } : null, frozen: pi.frozen, rec: pi.rec ? { i: pi.rec.i, t: pi.rec.t } : null, wifiCut: st.wifiCut, battery: S.batteryOn !== false,
        gnd: !!(an.rpiOn && an.net('rpi.GND') === an.net('l298n.GND')), grade: st.grade, soil: st.bench ? 'banco' : SOIL[st.soil].name, bench: st.bench, err: st.err, dev: st.dev, routes: st.routes, pl298: st.pl298, cells: 2 });
      UGV.emit('telemetry', tel); }
  }
  requestAnimationFrame(loop);
}
})();
