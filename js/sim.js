/* Simulador 3D: escena, robot, cables, física simple y control */
(function () {
'use strict';
const T = THREE, G = UGV.GEOM, S = UGV.state;
const Sim = UGV.Sim = {};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Parámetros del modelo (estimados, ver pestaña Proyecto) ---------- */
const P = Sim.P = {
  rpm12: 350,        // RPM sin carga a 12 V
  drop: 1.8,         // caída del L298N (V)
  capAh: 2.6,        // capacidad del pack (Ah)
  rint: .15,         // resistencia interna del pack (Ω)
  tau: .15           // constante de tiempo de los motores (s)
};
const ocvCell = soc => { const t = [[0, 3.0], [.05, 3.3], [.1, 3.45], [.2, 3.6], [.5, 3.75], [.8, 3.95], [1, 4.2]];
  for (let i = 1; i < t.length; i++) if (soc <= t[i][0]) { const [a, va] = t[i - 1], [b, vb] = t[i]; return va + (vb - va) * (soc - a) / (b - a); } return 4.2; };

/* ---------- Estado de simulación ---------- */
const st = Sim.st = {
  jx: 0, jy: 0, keys: {}, vmax: 1, slip: 1.6, comp: true, lights: false, horn: false,
  mode: 'manual', x: 0, z: 0, yaw: 0, vl: 0, vr: 0, dutyL: 0, dutyR: 0,
  soc: .86, vbat: 8.1, ibat: 0, timeScale: 1,
  rec: [], recT: 0, path: [[0, 0]], est: null, estPath: [], err: 0, errAcc: 0, errN: 0, dist: null,
  origin: { x: 0, z: 0 }, wpi: 0, seen: []
};

let renderer, scene, camera, controls, robot, chassis, sun, canvas, overlay;
const groups = {}, built = {};
let view = 'orbit', wiresOn = false, openBox = false, selected = null, selBox = null;
const obstacles = [{ x: 105, z: -40, w: 32, d: 28, h: 26 }, { x: -70, z: 95, w: 46, d: 22, h: 30 }, { x: 30, z: 150, w: 26, d: 26, h: 22 }, { x: -120, z: -60, w: 30, d: 30, h: 34 }];
const markers = [{ id: 3, x: 60, z: -60 }, { id: 4, x: 60, z: 60 }, { id: 5, x: -60, z: 60 }, { id: 6, x: -60, z: -60 }];
Sim.markers = markers;

/* ---------- Construcción de la escena ---------- */
function floorTexture() {
  return UGV.tex(512, 512, (g, w, h) => {
    g.fillStyle = css('--floor-a') || '#e8e1d4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { g.strokeStyle = `rgba(150,140,125,${.1 + Math.random() * .12})`; g.lineWidth = .8 + Math.random() * 1.6;
      g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - .5) * 140; y += (Math.random() - .3) * 90; g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = css('--floor-b') || '#cfc6b6'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  }, { repeat: [1000 / 30, 1000 / 30] });
}
function cardboardTex() {
  return UGV.tex(256, 256, (g, w, h) => { g.fillStyle = '#c4a067'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(90,60,20,${Math.random() * .08})`; g.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2); }
    g.fillStyle = 'rgba(210,190,150,.65)'; g.fillRect(w * .44, 0, w * .12, h); });
}
function arucoTex(id) {
  return UGV.tex(120, 120, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 120, 120); g.fillStyle = '#000'; g.fillRect(10, 10, 100, 100);
    let s = (id * 2654435761) >>> 0;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { s = (s * 1103515245 + 12345) >>> 0; if (s & 0x10000) { g.fillStyle = '#fff'; g.fillRect(30 + k * 15, 30 + r * 15, 15, 15); } }
    g.fillStyle = '#555'; g.font = '600 9px monospace'; g.fillText('ID ' + id, 12, 118);
  });
}

Sim.init = function (cv, ov) {
  canvas = cv; overlay = ov;
  renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene();
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new T.RoomEnvironment(), .04).texture;
  camera = new T.PerspectiveCamera(38, 1, .5, 4000); camera.position.set(42, 30, 46);
  controls = new T.OrbitControls(camera, canvas);
  controls.target.set(0, 5, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495; controls.minDistance = 10; controls.maxDistance = 700;

  scene.add(new T.HemisphereLight(0xffffff, 0x887766, .25));
  sun = new T.DirectionalLight(0xffffff, 1.35); sun.position.set(40, 90, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 }); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  scene.add(sun, sun.target);

  const floor = new T.Mesh(new T.PlaneGeometry(1000, 1000), new T.MeshStandardMaterial({ map: floorTexture(), roughness: .42, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); Sim.floor = floor;
  const cb = new T.MeshStandardMaterial({ map: cardboardTex(), roughness: .9 });
  obstacles.forEach(o => { const m = new T.Mesh(new T.BoxGeometry(o.w, o.h, o.d), cb); m.position.set(o.x, o.h / 2, o.z); m.castShadow = m.receiveShadow = true; scene.add(m); });
  Sim.arucoGroup = new T.Group(); scene.add(Sim.arucoGroup);
  markers.forEach(mk => { const m = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshStandardMaterial({ map: arucoTex(mk.id), roughness: .8 }));
    m.rotation.x = -Math.PI / 2; m.position.set(mk.x, .06, mk.z); m.receiveShadow = true; Sim.arucoGroup.add(m); });
  // ruta de referencia del modo automático
  const pathPts = autoPath().map(([x, z]) => new T.Vector3(x, .1, z));
  Sim.refLine = new T.Line(new T.BufferGeometry().setFromPoints(pathPts.concat([pathPts[0]])), new T.LineDashedMaterial({ color: 0x7a8a99, dashSize: 3, gapSize: 2 }));
  Sim.refLine.computeLineDistances(); scene.add(Sim.refLine);

  // rastro real y rastro estimado
  const mkTrail = (col, dashed) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(8000 * 3), 3)); g.setDrawRange(0, 0);
    const l = new T.Line(g, dashed ? new T.LineDashedMaterial({ color: col, dashSize: 2, gapSize: 1.5 }) : new T.LineBasicMaterial({ color: col })); l.frustumCulled = false; scene.add(l); return { g, l, n: 0 }; };
  Sim.trail = mkTrail(0x2fbf8a); Sim.etrail = mkTrail(0xe0a020, true);

  robot = new T.Group(); scene.add(robot);
  chassis = UGV.buildChassis(); robot.add(chassis.group); tagPart(chassis.group, 'chassis');
  UGV.PARTS.forEach(p => { if (p.noModel || p.id === 'chassis') return; const r = UGV.build(p.id); if (!r) return;
    const g = new T.Group(); g.add(r.g); robot.add(g); groups[p.id] = g; built[p.id] = r; tagPart(g, p.id); placePart(p.id); });
  Sim.wireGroup = new T.Group(); robot.add(Sim.wireGroup);
  syncParts();
  UGV.on('parts', () => { syncParts(); rebuildWires(); });
  UGV.on('wires', rebuildWires);
  UGV.on('layout', () => { Object.keys(groups).forEach(placePart); rebuildWires(); });

  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if ('envMapIntensity' in m) m.envMapIntensity = .45; }); });
  setupPointer();
  Sim.applyTheme();
  new ResizeObserver(Sim.resize).observe(canvas.parentElement); Sim.resize();
  requestAnimationFrame(loop);
};

function tagPart(g, id) { g.traverse(m => { if (m.isMesh || m.isInstancedMesh) { m.userData.partId = id; } }); }
function placePart(id) {
  const g = groups[id]; if (!g) return; const pl = UGV.PLACE[id] || { pos: [0, 0, 0] }; const o = S.pos[id];
  g.position.set(o ? o[0] : pl.pos[0], pl.pos[1], o ? o[1] : pl.pos[2]); g.rotation.y = o ? o[2] : (pl.rot || 0); g.updateMatrix();
}
function syncParts() {
  Object.entries(groups).forEach(([id, g]) => g.visible = UGV.isOn(id));
  Sim.arucoGroup.visible = UGV.isOn('aruco'); Sim.refLine.visible = UGV.isOn('aruco') || st.mode === 'auto';
  if (selected && !UGV.isOn(selected)) Sim.select(null);
  applyBoxMode();
}

/* ---------- Cables 3D ---------- */
const typeColor = { pwr: '--w-red', gnd: '--w-gnd', sig: '--w-sig', bus: '--w-bus', mot: '--w-mot' };
let wireMeshes = [];
function pinWorld(key) {
  const [pid, pin] = key.split('.'); const g = groups[pid], r = built[pid]; if (!g || !r) return null;
  const local = (r.pins[pin] || new T.Vector3(0, 1, 0)).clone();
  g.updateMatrix(); return local.applyMatrix4(g.matrix);
}
Sim.wireColor = (w, an) => {
  const ia = UGV.pinInfo(w.a), ib = UGV.pinInfo(w.b);
  const ty = [ia && ia.t, ib && ib.t];
  if (ty.includes('gnd')) return css('--w-gnd');
  if (ty.includes('mot')) return css('--w-mot');
  if (ty.includes('pwr')) { const v = an ? an.netV(w.a) : null; return v === null ? css('--w-red') : v > 6 ? css('--w-red') : v > 4 ? css('--w-5v') : css('--w-3v3'); }
  if (ty.includes('bus')) return css('--w-bus');
  return css('--w-sig');
};
function rebuildWires() {
  wireMeshes.forEach(o => { o.m.geometry.dispose(); Sim.wireGroup.remove(o.m); o.ends.forEach(e => Sim.wireGroup.remove(e)); }); wireMeshes = [];
  if (!wiresOn) return;
  const an = UGV.analyze(st.vbat);
  an.wires.forEach((w, i) => {
    const p1 = pinWorld(w.a), p2 = pinWorld(w.b); if (!p1 || !p2) return;
    const lift = Math.max(p1.y, p2.y) + 1.0 + (i % 5) * .3;
    const m1 = p1.clone().lerp(p2, .25); m1.y = lift; const m2 = p1.clone().lerp(p2, .75); m2.y = lift;
    const a1 = p1.clone(); a1.y += .8; const a2 = p2.clone(); a2.y += .8;
    const curve = new T.CatmullRomCurve3([p1, a1, m1, m2, a2, p2]);
    const col = new T.Color(Sim.wireColor(w, an));
    const m = new T.Mesh(new T.TubeGeometry(curve, 48, .07, 8, false), new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0, roughness: .45 }));
    m.castShadow = true; Sim.wireGroup.add(m);
    const ends = [p1, p2].map(p => { const e = new T.Mesh(new T.BoxGeometry(.26, .55, .26), UGV.MAT.blackGloss); e.position.copy(p); e.position.y += .3; Sim.wireGroup.add(e); return e; });
    wireMeshes.push({ m, ends, w });
  });
}
Sim.rebuildWires = rebuildWires;

/* ---------- Selección, interior y arrastre ---------- */
function applyBoxMode() {
  const g = groups.box; if (!g) return;
  g.traverse(m => { if (m.isMesh) { if (!m.userData.solidMat) m.userData.solidMat = m.material;
    if (!m.userData.ghostMat) { m.userData.ghostMat = m.material.clone(); m.userData.ghostMat.transparent = true; m.userData.ghostMat.opacity = .12; m.userData.ghostMat.depthWrite = false; }
    m.material = openBox ? m.userData.ghostMat : m.userData.solidMat; m.castShadow = !openBox; } });
}
Sim.setOpen = v => { openBox = v; applyBoxMode(); };
Sim.setWires = v => { wiresOn = v; rebuildWires(); };
Sim.select = id => {
  selected = id;
  if (selBox) { scene.remove(selBox); selBox = null; }
  if (id && (groups[id] || id === 'chassis')) { selBox = new T.BoxHelper(id === 'chassis' ? chassis.group : groups[id], new T.Color(css('--accent'))); scene.add(selBox); }
  UGV.emit('select', id);
};
Sim.focus = id => { const g = groups[id]; if (!g) return; view = 'orbit'; controls.enabled = true; UGV.emit('view', view);
  const p = new T.Vector3(); g.getWorldPosition(p); controls.target.copy(p); camera.position.copy(p).add(new T.Vector3(16, 14, 18)); Sim.select(id); };

let drag = null; const ray = new T.Raycaster(), mouse = new T.Vector2();
function setupPointer() {
  const pick = e => { const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); };
  let downAt = null;
  canvas.addEventListener('pointerdown', e => {
    downAt = [e.clientX, e.clientY]; if (view === 'robotcam') return;
    pick(e);
    const objs = []; robot.traverse(m => { if ((m.isMesh || m.isInstancedMesh) && m.userData.partId && m.visible !== false) objs.push(m); });
    let hits = ray.intersectObjects(objs, false).filter(h => { let o = h.object; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
    if (openBox) hits = hits.filter(h => h.object.userData.partId !== 'box');
    const h = hits[0]; if (!h) return;
    const id = h.object.userData.partId; Sim.select(id);
    if (id === 'chassis' || (UGV.PLACE[id] && UGV.PLACE[id].fixed)) return;
    const wp = new T.Vector3(); groups[id].getWorldPosition(wp);
    drag = { id, plane: new T.Plane(new T.Vector3(0, 1, 0), -h.point.y), start: robot.worldToLocal(h.point.clone()), orig: groups[id].position.clone(), moved: false };
    controls.enabled = false; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; pick(e); const p = new T.Vector3(); if (!ray.ray.intersectPlane(drag.plane, p)) return;
    const d = robot.worldToLocal(p).sub(drag.start); const g = groups[drag.id];
    g.position.x = T.MathUtils.clamp(drag.orig.x + d.x, -7.4, 7.6); g.position.z = T.MathUtils.clamp(drag.orig.z + d.z, -4.6, 4.6);
    drag.moved = true; if (selBox) selBox.update(); if (wiresOn) rebuildWires();
  });
  const end = () => { if (drag) { if (drag.moved) { const g = groups[drag.id]; S.pos[drag.id] = [g.position.x, g.position.z, g.rotation.y]; UGV.save(); rebuildWires(); }
    drag = null; controls.enabled = view === 'orbit'; } };
  canvas.addEventListener('pointerup', e => { end(); if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4 && view !== 'robotcam') {
    pick(e); const objs = []; robot.traverse(m => { if ((m.isMesh || m.isInstancedMesh) && m.userData.partId) objs.push(m); });
    if (!ray.intersectObjects(objs, false).some(h => { let o = h.object; while (o) { if (!o.visible) return false; o = o.parent; } return true; })) Sim.select(null); } });
  canvas.addEventListener('pointercancel', end);
}
Sim.rotateSel = () => { if (!selected || !groups[selected] || (UGV.PLACE[selected] || {}).fixed) return; const g = groups[selected]; g.rotation.y += Math.PI / 2;
  S.pos[selected] = [g.position.x, g.position.z, g.rotation.y]; UGV.save(); if (selBox) selBox.update(); rebuildWires(); };
Sim.resetSel = () => { if (!selected) return; delete S.pos[selected]; UGV.save(); placePart(selected); if (selBox) selBox.update(); rebuildWires(); };

/* ---------- Cámara ---------- */
Sim.setView = v => {
  if (v === 'robotcam' && !UGV.isOn('cam')) { UGV.emit('toast', 'Agrega la cámara Raspberry Pi v2 para usar esta vista.'); return; }
  view = v; controls.enabled = v === 'orbit'; if (v === 'orbit') controls.target.set(st.x, 5, st.z);
  camera.fov = v === 'robotcam' ? 48 : 38; camera.updateProjectionMatrix(); UGV.emit('view', v);
};

/* ---------- Tema ---------- */
Sim.applyTheme = () => {
  if (!scene) return;
  const bg = new T.Color(css('--scene-bg')); scene.background = bg; scene.fog = new T.Fog(bg, 260, 900);
  Sim.floor.material.map = floorTexture(); Sim.floor.material.needsUpdate = true; rebuildWires();
  if (selBox) selBox.material.color.set(css('--accent'));
};
Sim.resize = () => { if (!renderer) return; const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };

/* ---------- Ruta automática (Pure Pursuit sobre los marcadores) ---------- */
function autoPath() { // cuadrado de 120 cm con esquinas redondeadas que pasa por los marcadores
  const pts = [], R = 25, h = 60;
  const corners = [[h, -h], [h, h], [-h, h], [-h, -h]];
  for (let c = 0; c < 4; c++) {
    const [cx, cz] = corners[c], [nx, nz] = corners[(c + 1) % 4];
    for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([cx + (nx - cx) * t, cz + (nz - cz) * t]); }
  }
  return pts;
}
const AUTO = autoPath();
function closestOnPath(x, z) {
  let best = 1e9, bi = 0, bp = null;
  for (let i = 0; i < AUTO.length; i++) { const [ax, az] = AUTO[i], [bx, bz] = AUTO[(i + 1) % AUTO.length]; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t)); const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bi = i; bp = [px, pz, t]; } }
  return { d: best, i: bi, p: bp };
}
function lookahead(x, z, Ld) {
  const c = closestOnPath(x, z); let i = c.i, px = c.p[0], pz = c.p[1], rem = Ld;
  for (let n = 0; n < AUTO.length * 2; n++) { const [bx, bz] = AUTO[(i + 1) % AUTO.length]; const seg = Math.hypot(bx - px, bz - pz);
    if (seg >= rem) { const t = rem / seg; return [px + (bx - px) * t, pz + (bz - pz) * t, c.d]; } rem -= seg; px = bx; pz = bz; i = (i + 1) % AUTO.length; }
  return [px, pz, c.d];
}

/* ---------- Electricidad ---------- */
let an = null, anT = 0;
function driveOK(an, side) {
  const [EN, I1, I2, O1, O2, M, gEN, g1, g2] = side === 'A' ? ['ENA', 'IN1', 'IN2', 'OUT1', 'OUT2', 'motorA', 'D14', 'D27', 'D26'] : ['ENB', 'IN3', 'IN4', 'OUT3', 'OUT4', 'motorB', 'D32', 'D25', 'D33'];
  if (!UGV.isOn(M) || !UGV.isOn('l298n') || !UGV.isOn('esp32')) return 0;
  const same = (a, b) => an.net(a) === an.net(b);
  if (!(same('esp32.' + gEN, 'l298n.' + EN) && same('esp32.' + g1, 'l298n.' + I1) && same('esp32.' + g2, 'l298n.' + I2))) return 0;
  if ((an.vAt('esp32.VIN') || 0) < 4.5 || (an.vAt('l298n.12V') || 0) < 6) return 0;
  if (same('l298n.' + O1, M + '.M+') && same('l298n.' + O2, M + '.M-')) return 1;
  if (same('l298n.' + O1, M + '.M-') && same('l298n.' + O2, M + '.M+')) return -1;
  return 0;
}
function sensorOK(an) {
  return UGV.isOn('sonar') && UGV.isOn('esp32') && (an.vAt('sonar.VCC') || 0) >= 4.5 && an.net('sonar.TRIG') === an.net('esp32.D5') &&
    (an.net('sonar.ECHO') === an.net('esp32.D18') || (UGV.isOn('divider') && an.net('sonar.ECHO') === an.net('divider.IN') && an.net('divider.OUT') === an.net('esp32.D18')));
}

/* ---------- Comandos ---------- */
Sim.cmd = (name, v) => {
  if (name === 'stop') { st.jx = st.jy = 0; st.keys = {}; st.replay = null; if (st.mode !== 'manual') Sim.setMode('manual'); st.vl = st.vr = 0; }
  if (name === 'lights') st.lights = v;
  if (name === 'horn') st.horn = v;
  if (name === 'clear') { st.rec = []; st.recT = 0; st.path = [[st.x, st.z]]; st.origin = { x: st.x, z: st.z }; st.estPath = []; if (st.est) st.est = { x: st.x, z: st.z, yaw: st.yaw }; clearTrail(Sim.trail); clearTrail(Sim.etrail); st.errAcc = st.errN = 0; }
  if (name === 'home') { if (!st.rec.length) { UGV.emit('toast', 'No hay ruta guardada todavía.'); return; } if (st.mode !== 'manual') Sim.setMode('manual'); st.replay = { i: st.rec.length - 1, t: 0 }; UGV.emit('toast', 'Volviendo al inicio por la misma ruta, en reversa.'); }
  if (name === 'reset') { Object.assign(st, { x: 0, z: 0, yaw: 0, vl: 0, vr: 0, replay: null }); Sim.cmd('clear'); }
};
Sim.setMode = m => { st.mode = m; st.replay = null; st.errAcc = st.errN = 0; Sim.refLine.visible = UGV.isOn('aruco') || m === 'auto'; UGV.emit('mode', m); };
Sim.setJoy = (x, y) => { st.jx = x; st.jy = y; if (x || y) { st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); } };
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && UGV.activeTab === 'sim') { st.keys[k] = true; st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); e.preventDefault(); }
  if (k === ' ' && UGV.activeTab === 'sim') { Sim.cmd('stop'); e.preventDefault(); } });
addEventListener('keyup', e => { st.keys[e.key.toLowerCase()] = false; });

function clearTrail(t) { t.n = 0; t.g.setDrawRange(0, 0); }
function pushTrail(t, x, z) { if (t.n >= 8000) return; t.g.attributes.position.setXYZ(t.n, x, .12, z); t.n++; t.g.attributes.position.needsUpdate = true; t.g.setDrawRange(0, t.n); if (t.l.material.isLineDashedMaterial) t.l.computeLineDistances(); }
function hitsObstacle(x, z) { for (const o of obstacles) if (Math.abs(x - o.x) < o.w / 2 + 9 && Math.abs(z - o.z) < o.d / 2 + 9) return true; return false; }
function rayDist(ox, oz, dx, dz) { for (let d = 0; d <= 400; d += 1) { const x = ox + dx * d, z = oz + dz * d; for (const o of obstacles) if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2) return d; } return null; }
const trackSpeed = (duty, vbat) => { const ve = Math.max(0, vbat * Math.abs(duty) - P.drop); return Math.sign(duty) * P.rpm12 * ve / 12 * 2 * Math.PI * G.WR / 60; };
Sim.vTop = () => trackSpeed(1, st.vbat);

/* ---------- Paso de simulación ---------- */
function step(dt) {
  anT -= dt; if (!an || anT <= 0) { an = UGV.analyze(st.vbat); anT = .25; Sim.an = an; }
  const okA = driveOK(an, 'A'), okB = driveOK(an, 'B');
  let L = 0, R = 0; const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw);
  const chiEst = st.comp ? st.slip : 1;
  if (st.replay) {
    const r = st.replay, c = st.rec[r.i]; L = -c[0]; R = -c[1]; r.t += dt;
    if (r.t >= c[2]) { r.t = 0; r.i--; if (r.i < 0) { st.replay = null; st.rec = []; st.recT = 0; UGV.emit('toast', 'Llegó al inicio.'); } }
  } else if (st.mode === 'auto') {
    const Ld = 25, [tx, tz, cte] = lookahead(st.x, st.z, Ld);
    const dx = tx - st.x, dz = tz - st.z;
    const yL = dx * fz - dz * fx; // desplazamiento lateral del objetivo (izquierda = +)
    const k = 2 * yL / (Ld * Ld);
    const v = .55 * st.vmax * Sim.vTop(); const w = v * k;
    const vlD = v - w * G.WB * chiEst / 2, vrD = v + w * G.WB * chiEst / 2, top = Math.max(1, Sim.vTop());
    L = Math.max(-1, Math.min(1, vlD / top)); R = Math.max(-1, Math.min(1, vrD / top));
    const lx = dx * fx + dz * fz; // si el objetivo queda detrás, gira en el sitio hacia él
    if (lx < Ld * .35) { const sg = yL >= 0 ? 1 : -1; L = -.55 * sg * st.vmax; R = .55 * sg * st.vmax; }
    st.err = cte; st.errAcc += cte * cte; st.errN++;
  } else {
    let x = st.jx, y = st.jy; const k = st.keys;
    if (k.w || k.arrowup) y = 1; if (k.s || k.arrowdown) y = -1; if (k.a || k.arrowleft) x = -1; if (k.d || k.arrowright) x = 1;
    L = y + x; R = y - x; const m = Math.max(1, Math.abs(L), Math.abs(R)); L = L / m * st.vmax; R = R / m * st.vmax;
  }
  // sensor frontal y freno automático
  if (sensorOK(an)) { st.dist = rayDist(st.x + fx * 9, st.z + fz * 9, fx, fz);
    if (st.dist !== null && st.dist < 20 && (L + R) > 0 && !st.replay) { const f = (L + R) / 2; L -= f; R -= f; if (!st.brake) UGV.emit('toast', `Freno automático: obstáculo a ${Math.round(st.dist)} cm.`); st.brake = true; } else st.brake = false;
  } else st.dist = null;
  st.dutyL = L; st.dutyR = R;
  const effL = okA ? L * okA : 0, effR = okB ? R * okB : 0;
  if ((L || R) && (!okA || !okB) && !st.noDriveMsg) { st.noDriveMsg = true; UGV.emit('toast', !okA && !okB ? 'Los motores no reciben señal: revisa las conexiones en la pestaña Circuito.' : `El motor ${!okA ? 'A' : 'B'} no recibe señal: revisa su conexión.`); }
  if (!L && !R) st.noDriveMsg = false;
  // dinámica de motores
  const a = Math.min(1, dt / P.tau);
  st.vl += (trackSpeed(effL, st.vbat) - st.vl) * a; st.vr += (trackSpeed(effR, st.vbat) - st.vr) * a;
  // cinemática con deslizamiento: ancho de vía efectivo = χ · B
  const slipLong = .96;
  const v = (st.vl + st.vr) / 2 * slipLong, w = (st.vr - st.vl) / (G.WB * st.slip);
  const ny = st.yaw + w * dt, nx = st.x + v * Math.cos(ny) * dt, nz = st.z - v * Math.sin(ny) * dt;
  if (!hitsObstacle(nx, nz)) { st.x = nx; st.z = nz; } else { st.vl *= .2; st.vr *= .2; }
  st.yaw = ny;
  chassis.tracks[-1].off += st.vl * dt; chassis.tracks[1].off += st.vr * dt;
  // odometría estimada (encoders + IMU + ArUco)
  if (UGV.isOn('enc')) {
    if (!st.est) st.est = { x: st.x, z: st.z, yaw: st.yaw };
    const e = st.est; const ve = (st.vl + st.vr) / 2; let we = (st.vr - st.vl) / G.WB;
    if (UGV.isOn('imu')) we = w + (Math.random() - .5) * .01;
    e.yaw += we * dt; e.x += ve * Math.cos(e.yaw) * dt; e.z -= ve * Math.sin(e.yaw) * dt;
    st.seen = UGV.isOn('cam') && UGV.isOn('rpi') ? markers.filter(mk => { const dx = mk.x - st.x, dz = mk.z - st.z, d = Math.hypot(dx, dz), ang = Math.atan2(-(dz * fx - dx * fz), dx * fx + dz * fz); return d < 110 && d > 12 && Math.abs(ang) < .5; }) : [];
    if (st.seen.length) { e.x += (st.x - e.x) * .06; e.z += (st.z - e.z) * .06; e.yaw += (st.yaw - e.yaw) * .06; }
    const lp = st.estPath[st.estPath.length - 1]; if (!lp || Math.hypot(e.x - lp[0], e.z - lp[1]) > 1.5) { st.estPath.push([e.x, e.z]); pushTrail(Sim.etrail, e.x, e.z); }
  } else { st.est = null; st.seen = []; }
  // grabación de la ruta
  if (!st.replay && st.mode === 'manual' && (L || R)) { const lr = st.rec[st.rec.length - 1]; if (lr && lr[0] === L && lr[1] === R) lr[2] += dt; else st.rec.push([L, R, dt]); st.recT += dt; }
  const lp = st.path[st.path.length - 1]; if (Math.hypot(st.x - lp[0], st.z - lp[1]) > 1.5) { st.path.push([st.x, st.z]); pushTrail(Sim.trail, st.x, st.z); }
  // batería
  const on5 = (an.vAt('l298n.5V') || 0) > 4;
  let i = (Math.abs(effL) > .01 ? .1 + .9 * Math.abs(effL) : 0) + (Math.abs(effR) > .01 ? .1 + .9 * Math.abs(effR) : 0);
  if (on5) i += (UGV.isOn('esp32') ? .12 : 0) + (UGV.isOn('sonar') ? .015 : 0) + (st.lights && UGV.isOn('leds') ? .03 : 0) + (st.horn && UGV.isOn('buzzer') ? .03 : 0) + (UGV.isOn('imu') ? .004 : 0) + (UGV.isOn('enc') ? .02 : 0);
  if ((an.vAt('rpi.5V') || 0) > 4.5) i += .65 * 5.1 / (st.vbat * .85);
  if (S.on.switch && !S.switchClosed) i = 0;
  st.ibat = i; st.soc = Math.max(0, st.soc - i * dt * st.timeScale / 3600 / P.capAh);
  st.vbat = Math.max(0, 2 * ocvCell(st.soc) - i * P.rint);
  return { v, w };
}

/* Avanza la simulación sin dibujar (pruebas automáticas) */
Sim.stepN = (n, dt = 1 / 60) => { let r; for (let i = 0; i < n; i++) r = step(dt); return Object.assign({}, st, r); };

/* ---------- Bucle principal ---------- */
let last = performance.now(), telT = 0, wireT = 0;
const tel = Sim.tel = {};
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (UGV.activeTab === 'sim' || UGV.activeTab === 'circ') {
    const { v, w } = step(dt);
    robot.position.set(st.x, 0, st.z); robot.rotation.y = st.yaw;
    chassis.updateTrack(chassis.tracks[-1]); chassis.updateTrack(chassis.tracks[1]);
    const lit = st.lights && UGV.isOn('leds') && an && an.net('leds.A') === an.net('esp32.D2');
    if (built.leds) built.leds.g.userData.leds.forEach(m => { m.emissive.set(lit ? 0xfff1c4 : 0x000000); m.emissiveIntensity = lit ? 2.2 : 0; });
    if (!Sim.ledLights && built.leds) { Sim.ledLights = [-3, 3].map(z => { const L = new T.SpotLight(0xfff3d6, 0, 220, Math.PI / 6, .55, 1); L.position.set(.6, .55, z); L.target.position.set(60, -6, z * 1.6); built.leds.g.add(L, L.target); return L; }); }
    if (Sim.ledLights) Sim.ledLights.forEach(L => L.intensity = lit ? 2.5 : 0);
    wireT -= dt; if (wiresOn && wireT <= 0) { wireT = .05; wireMeshes.forEach(o => { const s = o.w.sig; let lv = 0;
      if (s === 'ENA') lv = Math.abs(st.dutyL); else if (s === 'ENB') lv = Math.abs(st.dutyR); else if (s === 'IN1') lv = st.dutyL > 0; else if (s === 'IN2') lv = st.dutyL < 0;
      else if (s === 'IN3') lv = st.dutyR > 0; else if (s === 'IN4') lv = st.dutyR < 0; else if (s === 'MA') lv = Math.abs(st.dutyL); else if (s === 'MB') lv = Math.abs(st.dutyR);
      else if (s === 'LUCES') lv = st.lights; else if (s === 'BOCINA') lv = st.horn; else if (s === 'TRIG' || s === 'ECHO') lv = st.dist !== null ? .5 + .5 * Math.sin(now / 60) : 0;
      else if (s === 'I2C' || s === 'ENC') lv = (Math.abs(st.vl) + Math.abs(st.vr)) > 1 ? .4 + .4 * Math.sin(now / 40) : .1;
      o.m.material.emissiveIntensity = +lv * .9; }); }
    if (view === 'follow') { const back = new T.Vector3(-Math.cos(st.yaw) * 52, 32, Math.sin(st.yaw) * 52).add(robot.position); camera.position.lerp(back, .07); camera.lookAt(st.x, 6, st.z); }
    else if (view === 'top') { camera.position.lerp(new T.Vector3(st.x, 170, st.z + .01), .1); camera.lookAt(st.x, 0, st.z); }
    else if (view === 'robotcam' && groups.cam) { const p = new T.Vector3(1.2, 1.2, 0); groups.cam.localToWorld(p); camera.position.copy(p);
      const f = new T.Vector3(Math.cos(st.yaw), -.08, -Math.sin(st.yaw)); camera.lookAt(p.clone().add(f)); }
    else controls.update();
    sun.position.set(st.x + 40, 90, st.z + 30); sun.target.position.set(st.x, 0, st.z);
    if (selBox) selBox.update();
    renderer.render(scene, camera);
    drawOverlay();
    telT -= dt; if (telT <= 0) { telT = .1;
      Object.assign(tel, { v, w, vbat: st.vbat, soc: st.soc, ibat: st.ibat, dutyL: st.dutyL, dutyR: st.dutyR, dist: st.dist, sonar: sensorOK(an), mode: st.mode, replay: !!st.replay,
        err: st.err, rms: st.errN ? Math.sqrt(st.errAcc / st.errN) : 0, est: st.est, x: st.x, z: st.z, yaw: st.yaw, recT: st.recT, seen: st.seen, warnings: an.warnings,
        okA: driveOK(an, 'A'), okB: driveOK(an, 'B'), lights: st.lights, horn: st.horn });
      UGV.emit('telemetry', tel); }
  }
  requestAnimationFrame(loop);
}

/* Recuadros de detección ArUco en la vista de la cámara */
function drawOverlay() {
  if (!overlay) return;
  if (view !== 'robotcam') { if (overlay.childElementCount) overlay.innerHTML = ''; return; }
  const r = canvas.getBoundingClientRect(); let html = '';
  markers.forEach(mk => { const p = new T.Vector3(mk.x, .1, mk.z).project(camera); const d = Math.hypot(mk.x - st.x, mk.z - st.z);
    if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && d < 160) { const s = Math.max(18, 900 / d);
      html += `<div class="det" style="left:${(p.x + 1) / 2 * r.width - s / 2}px;top:${(1 - p.y) / 2 * r.height - s / 2}px;width:${s}px;height:${s}px"><span>ID ${mk.id} · ${Math.round(d)} cm</span></div>`; } });
  overlay.innerHTML = html + '<div class="rec">● CÁMARA · 640×480</div>';
}
})();
