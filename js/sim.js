/* Simulador 3D: habitación, robot, cables, física y control */
(function () {
'use strict';
const T = THREE, G = UGV.GEOM, S = UGV.state;
const Sim = UGV.Sim = {};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Parámetros del modelo (estimados; ver pestaña Proyecto) ---------- */
const P = Sim.P = {
  rpm12: 350,       // RPM sin carga a 12 V
  tstall12: .343,   // torque de bloqueo a 12 V (N·m) = 3,5 kg·cm
  istall12: 1.8,    // corriente de bloqueo a 12 V (A)
  i0: .1,           // corriente sin carga (A)
  drop: 1.8,        // caída del L298N (V)
  capAh: 2.6,       // capacidad del pack (Ah)
  rint: .15,        // resistencia interna del pack (Ω)
  tau: .15,         // constante de tiempo de los motores (s)
  mur: .06,         // resistencia a la rodadura de las orugas
  mulat: .45,       // fricción lateral oruga-cerámica (giros)
  contact: .12,     // largo de contacto de la oruga (m)
  mismatch: .02     // el motor B gira 2 % más rápido (asimetría real de motores)
};
const ocvCell = soc => { const t = [[0, 3.0], [.05, 3.3], [.1, 3.45], [.2, 3.6], [.5, 3.75], [.8, 3.95], [1, 4.2]];
  for (let i = 1; i < t.length; i++) if (soc <= t[i][0]) { const [a, va] = t[i - 1], [b, vb] = t[i]; return va + (vb - va) * (soc - a) / (b - a); } return 4.2; };

/* ---------- Estado ---------- */
const st = Sim.st = {
  jx: 0, jy: 0, keys: {}, vmax: 1, slip: 1.6, comp: true, lights: false, horn: false, load: 0,
  mode: 'manual', x: 0, z: 0, yaw: 0, vl: 0, vr: 0, dutyL: 0, dutyR: 0, sf: 1,
  soc: .86, vbat: 8.1, ibat: 0, iL: 0, iR: 0, timeScale: 1, t: 0,
  rec: [], recT: 0, path: [[0, 0]], est: null, estPath: [], err: 0, errAcc: 0, errN: 0, dist: null,
  origin: { x: 0, z: 0 }, seen: [], quiet: false, testCmd: [0, 0]
};
const hist = Sim.hist = []; const log = Sim.log = [];

let renderer, scene, camera, controls, robot, chassis, sun, canvas, overlay, contact, parcel;
const groups = {}, built = {};
let view = 'orbit', wiresOn = true, openBox = false, selected = null, selBox = null, drawMode = false;
const ROOM = 460; // habitación de 4,6 × 4,6 m
let obstacles = [];
const DEFAULT_OBS = [{ x: 115, z: -55, w: 32, d: 28, h: 26 }, { x: -85, z: 110, w: 46, d: 22, h: 30 }, { x: -130, z: -85, w: 30, d: 30, h: 34 }];
const markers = Sim.markers = [{ id: 3, x: 60, z: -60 }, { id: 4, x: 60, z: 60 }, { id: 5, x: -60, z: 60 }, { id: 6, x: -60, z: -60 }];
const custom = Sim.custom = []; // ruta dibujada [[x,z]]

/* ---------- Texturas de la habitación ---------- */
function floorTex() {
  return UGV.tex(1024, 1024, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#d9ccb6'); grad.addColorStop(1, '#cfc1a9'); g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${150 + Math.random() * 60},${140 + Math.random() * 50},${120 + Math.random() * 40},.08)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    for (let i = 0; i < 7; i++) { g.strokeStyle = `rgba(255,255,255,${.25 + Math.random() * .3})`; g.lineWidth = 1 + Math.random() * 3;
      g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (Math.random() - .5) * 220; y += (Math.random() - .4) * 120; g.lineTo(x, y); } g.stroke();
      g.strokeStyle = 'rgba(140,128,110,.18)'; g.lineWidth = .8; g.stroke(); }
    g.strokeStyle = '#bfb39f'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, w - 5, h - 5);
  }, { repeat: [ROOM / 45, ROOM / 45] });
}
function wallTex() {
  return UGV.tex(512, 512, (g, w, h) => { g.fillStyle = '#ece8dc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(120,110,90,${Math.random() * .05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, { repeat: [6, 3] });
}
function cardboardTex() {
  return UGV.tex(256, 256, (g, w, h) => { g.fillStyle = '#c4a067'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(90,60,20,${Math.random() * .08})`; g.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2); }
    g.fillStyle = 'rgba(210,190,150,.7)'; g.fillRect(w * .44, 0, w * .12, h); });
}
function arucoTex(id) {
  return UGV.tex(120, 120, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 120, 120); g.fillStyle = '#000'; g.fillRect(10, 10, 100, 100);
    let s = (id * 2654435761) >>> 0;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { s = (s * 1103515245 + 12345) >>> 0; if (s & 0x10000) { g.fillStyle = '#fff'; g.fillRect(30 + k * 15, 30 + r * 15, 15, 15); } }
    g.fillStyle = '#666'; g.font = '600 9px monospace'; g.fillText('ID ' + id, 12, 118);
  });
}
function contactTex() {
  return UGV.tex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(.6, 'rgba(0,0,0,.18)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
}

/* ---------- Inicio ---------- */
Sim.init = function (cv, ov) {
  canvas = cv; overlay = ov;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { canvas.parentElement.insertAdjacentHTML('beforeend', '<p class="nogl">Tu navegador no tiene WebGL activado, así que no puede mostrar el modelo 3D. Prueba con Chrome, Edge o Firefox actualizados.</p>'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .74;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene(); scene.background = new T.Color(0xe7e2d6);
  const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new T.RoomEnvironment(), .04).texture;
  camera = new T.PerspectiveCamera(36, 1, .5, 3000); camera.position.set(34, 22, 38);
  controls = new T.OrbitControls(camera, canvas);
  controls.target.set(0, 5, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495; controls.minDistance = 9; controls.maxDistance = 380;

  scene.add(new T.HemisphereLight(0xfffaf0, 0x8a7f6e, .3));
  sun = new T.DirectionalLight(0xfff4e2, 1.15); sun.position.set(40, 90, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
  sun.shadow.bias = -.0003; sun.shadow.normalBias = .02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xdfe9ff, .35); fill.position.set(-60, 40, -50); scene.add(fill);

  // habitación
  const floor = new T.Mesh(new T.PlaneGeometry(ROOM, ROOM), new T.MeshStandardMaterial({ map: floorTex(), roughness: .4, metalness: 0, envMapIntensity: .3 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); Sim.floor = floor;
  const wm = new T.MeshStandardMaterial({ map: wallTex(), roughness: .95 }), bm = new T.MeshStandardMaterial({ color: 0xd9cfbd, roughness: .6 });
  [[0, -ROOM / 2, 0], [0, ROOM / 2, Math.PI], [-ROOM / 2, 0, Math.PI / 2], [ROOM / 2, 0, -Math.PI / 2]].forEach(([x, z, r]) => {
    const w = new T.Mesh(new T.PlaneGeometry(ROOM, 240), wm); w.position.set(x, 120, z); w.rotation.y = r; w.receiveShadow = true; scene.add(w);
    const b = new T.Mesh(new T.BoxGeometry(ROOM, 9, 1.2), bm); b.position.set(x * .997, 4.5, z * .997); b.rotation.y = r; scene.add(b);
  });
  const door = new T.Mesh(new T.BoxGeometry(80, 200, 3), new T.MeshStandardMaterial({ color: 0xc9a77a, roughness: .7 })); door.position.set(60, 100, -ROOM / 2 + 1.6); scene.add(door);

  Sim.obsGroup = new T.Group(); scene.add(Sim.obsGroup); Sim.cardboard = new T.MeshStandardMaterial({ map: cardboardTex(), roughness: .9 });
  (S.obstacles || DEFAULT_OBS).forEach(o => addObstacle(o, true));
  Sim.arucoGroup = new T.Group(); scene.add(Sim.arucoGroup);
  markers.forEach(mk => { const m = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshStandardMaterial({ map: arucoTex(mk.id), roughness: .8 }));
    m.rotation.x = -Math.PI / 2; m.position.set(mk.x, .06, mk.z); m.receiveShadow = true; Sim.arucoGroup.add(m); });
  Sim.refLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0x6f8191, dashSize: 3, gapSize: 2 })); scene.add(Sim.refLine);
  Sim.wpGroup = new T.Group(); scene.add(Sim.wpGroup);

  const mkTrail = (col, dashed) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(8000 * 3), 3)); g.setDrawRange(0, 0);
    const l = new T.Line(g, dashed ? new T.LineDashedMaterial({ color: col, dashSize: 2, gapSize: 1.5 }) : new T.LineBasicMaterial({ color: col })); l.frustumCulled = false; scene.add(l); return { g, l, n: 0 }; };
  Sim.trail = mkTrail(0x1f9a6c); Sim.etrail = mkTrail(0xd99a12, true);

  robot = new T.Group(); scene.add(robot);
  contact = new T.Mesh(new T.PlaneGeometry(26, 24), new T.MeshBasicMaterial({ map: contactTex(), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .04; robot.add(contact);
  chassis = UGV.buildChassis(); robot.add(chassis.group); tagPart(chassis.group, 'chassis');
  UGV.PARTS.forEach(p => { if (p.noModel || p.id === 'chassis') return; const r = UGV.build(p.id); if (!r) return;
    const g = new T.Group(); g.add(r.g); robot.add(g); groups[p.id] = g; built[p.id] = r; tagPart(g, p.id); placePart(p.id); });
  parcel = new T.Mesh(new T.BoxGeometry(1, 1, 1), Sim.cardboard); parcel.castShadow = true; parcel.visible = false; robot.add(parcel);
  Sim.wireGroup = new T.Group(); robot.add(Sim.wireGroup);
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if ('envMapIntensity' in m && m.envMapIntensity === 1) m.envMapIntensity = .5; }); });

  syncParts(); updateRef();
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
  Sim.arucoGroup.visible = UGV.isOn('aruco');
  if (selected && selected !== 'chassis' && !UGV.isOn(selected)) Sim.select(null);
  applyBoxMode(); updateRef();
}

/* ---------- Obstáculos ---------- */
function addObstacle(o, silent) {
  const m = new T.Mesh(new T.BoxGeometry(o.w, o.h, o.d), Sim.cardboard); m.position.set(o.x, o.h / 2, o.z); m.castShadow = m.receiveShadow = true;
  Sim.obsGroup.add(m); obstacles.push(Object.assign({ mesh: m }, o)); if (!silent) saveObs();
}
function saveObs() { S.obstacles = obstacles.map(({ x, z, w, d, h }) => ({ x, z, w, d, h })); UGV.save(); }
Sim.addObstacle = () => {
  const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw), d = 55;
  addObstacle({ x: Math.round(st.x + fx * d), z: Math.round(st.z + fz * d), w: 24, d: 24, h: 20 });
  UGV.emit('toast', 'Caja puesta 55 cm delante del robot.');
};
Sim.clearObstacles = () => { obstacles.forEach(o => Sim.obsGroup.remove(o.mesh)); obstacles = []; saveObs(); UGV.emit('toast', 'Obstáculos quitados.'); };
Sim.resetObstacles = () => { Sim.clearObstacles(); DEFAULT_OBS.forEach(o => addObstacle(o, true)); saveObs(); };

/* ---------- Ruta de referencia (marcadores o dibujada) ---------- */
function squarePath() { const pts = [], h = 60, c = [[h, -h], [h, h], [-h, h], [-h, -h]];
  for (let k = 0; k < 4; k++) { const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4]; for (let i = 0; i < 10; i++) { const t = i / 10; pts.push([ax + (bx - ax) * t, az + (bz - az) * t]); } } return pts; }
const SQUARE = squarePath();
function activePath() { return custom.length >= 2 ? { pts: custom, closed: false } : { pts: SQUARE, closed: true }; }
Sim.activePath = activePath;
function updateRef() {
  if (!Sim.refLine) return;
  const p = activePath(); const pts = p.pts.map(([x, z]) => new T.Vector3(x, .12, z)); if (p.closed) pts.push(pts[0].clone());
  Sim.refLine.geometry.dispose(); Sim.refLine.geometry = new T.BufferGeometry().setFromPoints(pts); Sim.refLine.computeLineDistances();
  Sim.refLine.visible = custom.length >= 2 || UGV.isOn('aruco') || st.mode === 'auto';
  while (Sim.wpGroup.children.length) Sim.wpGroup.remove(Sim.wpGroup.children[0]);
  custom.forEach(([x, z], i) => { const m = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, .4, 20), new T.MeshStandardMaterial({ color: i === custom.length - 1 ? 0xd9472f : 0x1f9a6c })); m.position.set(x, .2, z); Sim.wpGroup.add(m); });
}
Sim.setDraw = v => { drawMode = v; if (v) { Sim.setView('top'); UGV.emit('toast', 'Toca el piso para poner puntos de la ruta. Luego usa “Automático”.'); } };
Sim.clearCustom = () => { custom.length = 0; updateRef(); };
function closest(path, x, z) {
  const P2 = path.pts, n = P2.length, segs = path.closed ? n : n - 1; let best = 1e9, bi = 0, bp = [P2[0][0], P2[0][1]];
  for (let i = 0; i < segs; i++) { const [ax, az] = P2[i], [bx, bz] = P2[(i + 1) % n]; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t)); const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bi = i; bp = [px, pz]; } }
  return { d: best, i: bi, p: bp };
}
function lookahead(path, x, z, Ld) {
  const c = closest(path, x, z), P2 = path.pts, n = P2.length; let i = c.i, [px, pz] = c.p, rem = Ld;
  for (let k = 0; k < n * 2; k++) { if (!path.closed && i >= n - 1) return [P2[n - 1][0], P2[n - 1][1], c.d, true];
    const [bx, bz] = P2[(i + 1) % n]; const seg = Math.hypot(bx - px, bz - pz);
    if (seg >= rem) { const t = rem / seg; return [px + (bx - px) * t, pz + (bz - pz) * t, c.d, false]; } rem -= seg; px = bx; pz = bz; i = (i + 1) % n; }
  return [px, pz, c.d, false];
}

/* ---------- Cables 3D con los colores reales ---------- */
let wireMeshes = [];
const REAL = { ENA: 0xe8e8e8, IN1: 0x8b8f94, IN2: 0x2b5fd9, IN3: 0x2aa84a, IN4: 0xe3c51b, ENB: 0x7b4fc9 };
function realColor(w) {
  const k = [w.a, w.b], has = s => k.some(x => x.endsWith(s)), pin = k.map(UGV.pinInfo);
  if (w.sig && REAL[w.sig]) return REAL[w.sig];
  if (w.sig === 'MA') return (w.a + w.b).includes('OUT1') ? 0xe3c51b : 0x2aa84a;
  if (w.sig === 'MB') return (w.a + w.b).includes('OUT3') ? 0xc8261d : 0x141414;
  if (pin.some(p => p && p.t === 'gnd')) return 0x141414;
  if (pin.some(p => p && p.t === 'pwr')) return 0xc8261d;
  if (w.sig === 'CAM') return 0xd8d2c0;
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
  if (ty.includes('bus')) return css('--w-bus'); return css('--w-sig');
};
const isHeader = key => { const [p, pin] = key.split('.'); return ['esp32', 'imu', 'sonar', 'buzzer', 'leds', 'divider', 'enc', 'rpi'].includes(p) || (p === 'l298n' && /^(EN|IN)/.test(pin)); };
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
    downAt = [e.clientX, e.clientY]; if (view === 'robotcam' || drawMode) return;
    pick(e); const h = partHits()[0]; if (!h) return;
    const id = h.object.userData.partId; Sim.select(id);
    if (id === 'chassis' || (UGV.PLACE[id] && UGV.PLACE[id].fixed)) return;
    drag = { id, plane: new T.Plane(new T.Vector3(0, 1, 0), -h.point.y), start: robot.worldToLocal(h.point.clone()), orig: groups[id].position.clone(), moved: false };
    controls.enabled = false; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; pick(e); const p = new T.Vector3(); if (!ray.ray.intersectPlane(drag.plane, p)) return;
    const d = robot.worldToLocal(p).sub(drag.start), g = groups[drag.id];
    g.position.x = T.MathUtils.clamp(drag.orig.x + d.x, -7.6, 7.8); g.position.z = T.MathUtils.clamp(drag.orig.z + d.z, -4.4, 4.4);
    drag.moved = true; if (selBox) selBox.update(); if (wiresOn) rebuildWires();
  });
  const end = () => { if (drag) { if (drag.moved) { const g = groups[drag.id]; S.pos[drag.id] = [g.position.x, g.position.z, g.rotation.y]; UGV.save(); rebuildWires(); }
    drag = null; controls.enabled = view === 'orbit'; } };
  canvas.addEventListener('pointerup', e => {
    end(); if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || view === 'robotcam') return;
    pick(e);
    if (drawMode) { const p = new T.Vector3(); if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p)) { custom.push([Math.round(p.x), Math.round(p.z)]); updateRef(); UGV.emit('custom', custom.length); } return; }
    if (!partHits().length) Sim.select(null);
  });
  canvas.addEventListener('pointercancel', end);
}
Sim.rotateSel = () => { if (!selected || !groups[selected] || (UGV.PLACE[selected] || {}).fixed) return; const g = groups[selected]; g.rotation.y += Math.PI / 2;
  S.pos[selected] = [g.position.x, g.position.z, g.rotation.y]; UGV.save(); if (selBox) selBox.update(); rebuildWires(); };
Sim.resetSel = () => { if (!selected) return; delete S.pos[selected]; UGV.save(); placePart(selected); if (selBox) selBox.update(); rebuildWires(); };

/* ---------- Cámara ---------- */
Sim.setView = v => {
  if (v === 'robotcam' && !UGV.isOn('cam')) { UGV.emit('toast', 'Agrega la cámara Raspberry Pi v2 para usar esta vista.'); return; }
  if (v !== 'top' && drawMode) { drawMode = false; UGV.emit('draw', false); }
  view = v; controls.enabled = v === 'orbit'; if (v === 'orbit') controls.target.set(st.x, 5, st.z);
  camera.fov = v === 'robotcam' ? 50 : 36; camera.updateProjectionMatrix(); UGV.emit('view', v);
};
Sim.snapshot = () => { renderer.render(scene, camera); canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ugv-orugas.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }); };
Sim.cam = (p, t) => { Sim.setView('orbit'); camera.position.set(p[0], p[1], p[2]); controls.target.set(t[0], t[1], t[2]); };
Sim.applyTheme = () => { if (selBox) selBox.material.color.set(0x1f9a6c); rebuildWires(); };
Sim.resize = () => { if (!renderer) return; const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };

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
Sim.robotMass = () => UGV.PARTS.reduce((s, p) => s + (UGV.isOn(p.id) ? p.mass : 0), 0) / 1000;

/* ---------- Comandos ---------- */
Sim.cmd = (name, v) => {
  if (name === 'stop') { st.jx = st.jy = 0; st.keys = {}; st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); st.vl = st.vr = 0; }
  if (name === 'lights') st.lights = v;
  if (name === 'horn') st.horn = v;
  if (name === 'clear') { st.rec = []; st.recT = 0; st.path = [[st.x, st.z]]; st.origin = { x: st.x, z: st.z }; st.estPath = []; if (st.est) st.est = { x: st.x, z: st.z, yaw: st.yaw }; clearTrail(Sim.trail); clearTrail(Sim.etrail); st.errAcc = st.errN = 0; }
  if (name === 'home') { if (!st.rec.length) { UGV.emit('toast', 'No hay ruta guardada todavía.'); return; } if (st.mode === 'auto') Sim.setMode('manual'); st.replay = { i: st.rec.length - 1, t: 0 }; UGV.emit('toast', 'Volviendo al inicio por la misma ruta, en reversa.'); }
  if (name === 'reset') { Object.assign(st, { x: 0, z: 0, yaw: 0, vl: 0, vr: 0, replay: null }); Sim.cmd('clear'); }
};
Sim.setMode = m => { st.mode = m; st.replay = null; st.errAcc = st.errN = 0; st.done = false; updateRef(); UGV.emit('mode', m); };
Sim.setJoy = (x, y) => { st.jx = x; st.jy = y; if (x || y) { st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); } };
Sim.setLoad = kg => { st.load = kg; parcel.visible = kg > 0; if (kg > 0) { const h = 1.5 + kg * 2.2; parcel.scale.set(7.5, h, 6.8); parcel.position.set(2.6, G.PLATE_Y + 6.6 + h / 2, 0); } };
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && UGV.activeTab === 'sim') { st.keys[k] = true; st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); e.preventDefault(); }
  if (k === ' ' && UGV.activeTab === 'sim') { Sim.cmd('stop'); e.preventDefault(); } });
addEventListener('keyup', e => { st.keys[e.key.toLowerCase()] = false; });

function clearTrail(t) { if (!t) return; t.n = 0; t.g.setDrawRange(0, 0); }
function pushTrail(t, x, z) { if (!t || t.n >= 8000) return; t.g.attributes.position.setXYZ(t.n, x, .12, z); t.n++; t.g.attributes.position.needsUpdate = true; t.g.setDrawRange(0, t.n); if (t.l.material.isLineDashedMaterial && t.n % 10 === 0) t.l.computeLineDistances(); }
function hitsObstacle(x, z) { if (Math.abs(x) > ROOM / 2 - 12 || Math.abs(z) > ROOM / 2 - 12) return true; for (const o of obstacles) if (Math.abs(x - o.x) < o.w / 2 + 9 && Math.abs(z - o.z) < o.d / 2 + 9) return true; return false; }
function rayDist(ox, oz, dx, dz) { for (let d = 0; d <= 400; d += 1) { const x = ox + dx * d, z = oz + dz * d; if (Math.abs(x) > ROOM / 2 || Math.abs(z) > ROOM / 2) return d; for (const o of obstacles) if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2) return d; } return null; }

/* Velocidad de oruga (cm/s) con curva torque-velocidad del motor */
function trackSpeed(duty, vbat, treq) {
  const ve = Math.max(0, vbat * Math.abs(duty) - P.drop), ts = P.tstall12 * ve / 12;
  const f = ts > 0 ? Math.max(0, 1 - treq / ts) : 0;
  return { v: Math.sign(duty) * P.rpm12 * ve / 12 * f * 2 * Math.PI * G.WR / 60, f, ve };
}
Sim.vTop = () => trackSpeed(1, st.vbat, reqTorque(0)).v;
function reqTorque(turnFrac) { const m = Sim.robotMass() + st.load, g = 9.81, r = G.WR / 100;
  return r * (P.mur * m * g / 2 + P.mulat * m * g * P.contact / (2 * G.WB / 100) * turnFrac); }

/* ---------- Paso de simulación ---------- */
function step(dt) {
  st.t += dt;
  anT -= dt; if (!an || anT <= 0) { an = UGV.analyze(st.vbat); anT = .25; Sim.an = an; }
  const okA = driveOK(an, 'A'), okB = driveOK(an, 'B');
  let L = 0, R = 0; const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw);
  const chiEst = st.comp ? st.slip : 1;
  if (st.mode === 'test') { [L, R] = st.testCmd; }
  else if (st.replay) {
    const r = st.replay, c = st.rec[r.i]; L = -c[0]; R = -c[1]; r.t += dt;
    if (r.t >= c[2]) { r.t = 0; r.i--; if (r.i < 0) { st.replay = null; st.rec = []; st.recT = 0; UGV.emit('toast', 'Llegó al inicio.'); } }
  } else if (st.mode === 'auto') {
    const path = activePath(), Ld = 25, [tx, tz, cte, end] = lookahead(path, st.x, st.z, Ld);
    const dx = tx - st.x, dz = tz - st.z, yL = dx * fz - dz * fx, lx = dx * fx + dz * fz;
    if (end && Math.hypot(dx, dz) < 6) { if (!st.done) { st.done = true; UGV.emit('toast', 'Ruta completada.'); } }
    else {
      const k = 2 * yL / (Ld * Ld), top = Math.max(1, Sim.vTop()), v = .55 * st.vmax * top, w = v * k;
      L = Math.max(-1, Math.min(1, (v - w * G.WB * chiEst / 2) / top)); R = Math.max(-1, Math.min(1, (v + w * G.WB * chiEst / 2) / top));
      if (lx < Ld * .35) { const sg = yL >= 0 ? 1 : -1; L = -.6 * sg * st.vmax; R = .6 * sg * st.vmax; }
    }
    st.err = cte; st.errAcc += cte * cte; st.errN++;
  } else {
    let x = st.jx, y = st.jy; const k = st.keys;
    if (k.w || k.arrowup) y = 1; if (k.s || k.arrowdown) y = -1; if (k.a || k.arrowleft) x = -1; if (k.d || k.arrowright) x = 1;
    L = y + x; R = y - x; const m = Math.max(1, Math.abs(L), Math.abs(R)); L = L / m * st.vmax; R = R / m * st.vmax;
  }
  // sensor frontal y freno automático
  if (sensorOK(an)) { st.dist = rayDist(st.x + fx * 9.5, st.z + fz * 9.5, fx, fz);
    if (st.dist !== null && st.dist < 20 && (L + R) > 0 && !st.replay) { const f = (L + R) / 2; L -= f; R -= f; if (!st.brake && !st.quiet) UGV.emit('toast', `Freno automático: obstáculo a ${Math.round(st.dist)} cm.`); st.brake = true; } else st.brake = false;
  } else st.dist = null;
  st.dutyL = L; st.dutyR = R;
  const effL = okA ? L * okA : 0, effR = okB ? R * okB : 0;
  if ((L || R) && (!okA || !okB) && !st.noDriveMsg && !st.quiet) { st.noDriveMsg = true; UGV.emit('toast', !okA && !okB ? 'Los motores no reciben señal: revisa las conexiones en Circuito.' : `El motor ${!okA ? 'A' : 'B'} no recibe señal: revisa su conexión.`); }
  if (!L && !R) st.noDriveMsg = false;
  // motores con carga
  const turnFrac = (Math.abs(effL) + Math.abs(effR)) > .01 ? Math.abs(effL - effR) / (Math.abs(effL) + Math.abs(effR)) : 0;
  const treq = reqTorque(turnFrac);
  const A = trackSpeed(effL, st.vbat, treq), Bm = trackSpeed(effR, st.vbat, treq);
  st.sf = Math.min(Math.abs(effL) > .05 ? A.f : 1, Math.abs(effR) > .05 ? Bm.f : 1);
  if (st.sf < .06 && (Math.abs(effL) > .2 || Math.abs(effR) > .2)) { if (!st.stallMsg && !st.quiet) { st.stallMsg = true; const pw = Math.max(Math.abs(effL), Math.abs(effR)); UGV.emit('toast', pw < .75 ? `PWM de ${Math.round(pw * 100)} %: los motores no tienen fuerza para ${turnFrac > .5 ? 'girar en el sitio' : 'moverse'}. Inclina más el joystick.` : `Motores bloqueados: no hay torque suficiente${turnFrac > .5 ? ' para girar en el sitio' : ''} con ${String(st.load).replace('.', ',')} kg de carga.`); } } else st.stallMsg = false;
  const a = Math.min(1, dt / P.tau);
  st.vl += (A.v - st.vl) * a; st.vr += (Bm.v * (1 + P.mismatch) - st.vr) * a;
  const slipLong = .96, v = (st.vl + st.vr) / 2 * slipLong, w = (st.vr - st.vl) / (G.WB * st.slip);
  const ny = st.yaw + w * dt, nx = st.x + v * Math.cos(ny) * dt, nz = st.z - v * Math.sin(ny) * dt;
  if (!hitsObstacle(nx, nz)) { st.x = nx; st.z = nz; st.bump = false; } else { st.vl *= .2; st.vr *= .2; st.bump = true; }
  st.yaw = ny;
  if (chassis) { chassis.tracks[-1].off += st.vl * dt; chassis.tracks[1].off += st.vr * dt; }
  // odometría (encoders + IMU + ArUco)
  if (UGV.isOn('enc')) {
    if (!st.est) st.est = { x: st.x, z: st.z, yaw: st.yaw };
    const e = st.est, ve = (st.vl + st.vr) / 2; let we = (st.vr - st.vl) / G.WB;
    if (UGV.isOn('imu')) we = w + (Math.random() - .5) * .01;
    e.yaw += we * dt; e.x += ve * Math.cos(e.yaw) * dt; e.z -= ve * Math.sin(e.yaw) * dt;
    st.seen = UGV.isOn('cam') && UGV.isOn('rpi') ? markers.filter(mk => { if (!UGV.isOn('aruco')) return false; const dx = mk.x - st.x, dz = mk.z - st.z, d = Math.hypot(dx, dz), ang = Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz); return d < 110 && d > 12 && Math.abs(ang) < .5; }) : [];
    if (st.seen.length) { e.x += (st.x - e.x) * .06; e.z += (st.z - e.z) * .06; e.yaw += (st.yaw - e.yaw) * .06; }
    const lp = st.estPath[st.estPath.length - 1]; if (!lp || Math.hypot(e.x - lp[0], e.z - lp[1]) > 1.5) { st.estPath.push([e.x, e.z]); if (!st.quiet) pushTrail(Sim.etrail, e.x, e.z); }
  } else { st.est = null; st.seen = []; }
  if (st.mode === 'manual' && !st.replay && (L || R)) { const lr = st.rec[st.rec.length - 1]; if (lr && lr[0] === L && lr[1] === R) lr[2] += dt; else st.rec.push([L, R, dt]); st.recT += dt; }
  const lp = st.path[st.path.length - 1]; if (Math.hypot(st.x - lp[0], st.z - lp[1]) > 1.5) { st.path.push([st.x, st.z]); if (!st.quiet) pushTrail(Sim.trail, st.x, st.z); }
  // batería
  const ve = Math.max(.1, st.vbat - P.drop), istall = P.istall12 * ve / 12;
  const im = (eff) => Math.abs(eff) > .01 ? Math.min(istall * Math.abs(eff) + .02, P.i0 + (P.istall12 - P.i0) * treq / P.tstall12) : 0;
  st.iL = im(effL); st.iR = im(effR);
  const on5 = (an.vAt('l298n.5V') || 0) > 4;
  let i = st.iL + st.iR;
  if (on5) i += (UGV.isOn('esp32') ? .12 : 0) + (UGV.isOn('sonar') ? .015 : 0) + (st.lights && UGV.isOn('leds') ? .03 : 0) + (st.horn && UGV.isOn('buzzer') ? .03 : 0) + (UGV.isOn('imu') ? .004 : 0) + (UGV.isOn('enc') ? .02 : 0);
  if ((an.vAt('rpi.5V') || 0) > 4.5) i += .65 * 5.1 / (st.vbat * .85);
  if (S.on.switch && !S.switchClosed) i = 0;
  st.ibat = i; st.soc = Math.max(0, st.soc - i * dt * st.timeScale / 3600 / P.capAh);
  st.vbat = Math.max(0, 2 * ocvCell(st.soc) - i * P.rint);
  // registro
  st.logT = (st.logT || 0) + dt;
  if (st.logT >= .1 && !st.quiet) { st.logT = 0; const row = { t: +st.t.toFixed(1), v: +v.toFixed(2), w: +(w * 57.2958).toFixed(1), i: +i.toFixed(3), vbat: +st.vbat.toFixed(3), soc: +(st.soc * 100).toFixed(1), pwmA: Math.round(effL * 255), pwmB: Math.round(effR * 255), x: +st.x.toFixed(1), z: +st.z.toFixed(1), err: st.mode === 'auto' ? +st.err.toFixed(2) : '' };
    hist.push(row); if (hist.length > 600) hist.shift(); log.push(row); if (log.length > 30000) log.shift(); }
  return { v, w };
}
Sim.stepN = (n, dt = 1 / 60) => { let r; for (let i = 0; i < n; i++) r = step(dt); return Object.assign({}, st, r); };
Sim.csv = () => { const cols = ['t', 'v', 'w', 'i', 'vbat', 'soc', 'pwmA', 'pwmB', 'x', 'z', 'err'], head = ['tiempo_s', 'velocidad_cm_s', 'giro_grados_s', 'corriente_A', 'bateria_V', 'carga_pct', 'pwm_A', 'pwm_B', 'x_cm', 'z_cm', 'error_ruta_cm'];
  return head.join(',') + '\n' + log.map(r => cols.map(c => r[c]).join(',')).join('\n'); };

/* ---------- Banco de pruebas (simulado) ---------- */
Sim.runTests = async function (onProgress) {
  const keep = JSON.parse(JSON.stringify({ x: st.x, z: st.z, yaw: st.yaw, soc: st.soc, load: st.load, comp: st.comp, mode: st.mode, vmax: st.vmax }));
  const keepPath = st.path.slice(), keepRec = st.rec.slice();
  st.quiet = true; const res = []; const tick = () => new Promise(r => setTimeout(r, 0));
  const place = (x, z, yaw) => { Object.assign(st, { x, z, yaw, vl: 0, vr: 0, replay: null, est: null }); st.path = [[x, z]]; };
  const run = async (secs, until) => { const N = Math.round(secs * 60); for (let i = 0; i < N; i++) { step(1 / 60); if (until && until()) return i / 60; if (i % 600 === 0) await tick(); } return secs; };
  const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
  try {
    st.mode = 'test'; st.soc = .9; st.load = 0;
    onProgress && onProgress('Recorrido recto de 100 cm');
    place(-150, -170, 0); st.testCmd = [1, 1]; let x0 = st.x, z0 = st.z, iAcc = 0, n = 0;
    const tt = await run(10, () => { iAcc += st.ibat; n++; return st.x - x0 >= 100; });
    res.push({ prueba: 'Recorrido recto 100 cm (PWM 100 %)', resultado: `${fmt(tt, 2)} s`, detalle: `velocidad media ${fmt(100 / tt)} cm/s · desvío lateral ${fmt(Math.abs(st.z - z0))} cm por la diferencia entre motores · corriente media ${Math.round(iAcc / n * 1000)} mA` });
    await tick();
    onProgress && onProgress('Giro de 360° en el sitio');
    place(-150, 150, 0); st.testCmd = [-.8, .8]; let ang = 0, angEnc = 0; const y0 = st.yaw;
    const tg = await run(15, () => { angEnc += (st.vr - st.vl) / G.WB / 60; return st.yaw - y0 >= 2 * Math.PI; });
    res.push({ prueba: 'Giro de 360° en el sitio (PWM 80 %)', resultado: st.yaw - y0 >= 2 * Math.PI ? `${fmt(tg, 2)} s` : 'no completó el giro', detalle: `los encoders sin compensar estimarían ${Math.round(angEnc * 57.2958)}°: error de odometría de ${Math.round((angEnc / (2 * Math.PI) - 1) * 100)} % por el deslizamiento (χ = ${fmt(st.slip)})` });
    await tick();
    for (const comp of [true, false]) {
      onProgress && onProgress(`Seguimiento de ruta ${comp ? 'con' : 'sin'} compensación`);
      st.comp = comp; place(60, 0, -Math.PI / 2); st.mode = 'auto'; const keepCustom = custom.splice(0); await run(6); st.errAcc = 0; st.errN = 0; let mx = 0;
      await run(22, () => { mx = Math.max(mx, st.err); return false; }); custom.push(...keepCustom);
      res.push({ prueba: `Pure Pursuit sobre el cuadrado de 120 cm, ${comp ? 'con' : 'sin'} compensación`, resultado: `RMS ${fmt(Math.sqrt(st.errAcc / Math.max(1, st.errN)), 2)} cm`, detalle: `error máximo ${fmt(mx)} cm en 22 s · 55 % de velocidad` });
      st.mode = 'test'; await tick();
    }
    st.comp = keep.comp;
    onProgress && onProgress('Frenado ante obstáculo');
    const ob = obstacles[0];
    if (ob) { place(ob.x - ob.w / 2 - 120, ob.z, 0); st.testCmd = [1, 1]; await run(8, () => st.bump);
      const gap = ob.x - ob.w / 2 - (st.x + 9.5);
      res.push({ prueba: 'Avance hacia una caja a 1,2 m (PWM 100 %)', resultado: st.bump ? 'choca' : `se detiene a ${fmt(Math.max(0, gap))} cm`, detalle: sensorOK(an) ? 'con HC-SR04 y freno a 20 cm' : 'sin sensor ultrasónico montado y conectado no hay freno automático' }); }
    await tick();
    onProgress && onProgress('Velocidad con carga');
    for (const kg of [0, .5, 1, 1.5, 2]) { st.load = kg; place(-150, -170, 0); st.testCmd = [1, 1]; await run(1.5); const vs = (st.vl + st.vr) / 2; const istr = st.ibat;
      st.testCmd = [-1, 1]; place(-150, 150, 0); const y1 = st.yaw; await run(1.5); const wsp = (st.yaw - y1) / 1.5 * 57.2958;
      res.push({ prueba: `Carga de ${fmt(kg, 1)} kg`, resultado: `${fmt(vs)} cm/s en recta`, detalle: `corriente ${Math.round(istr * 1000)} mA · giro en el sitio ${wsp < 5 ? 'no posible (motores bloqueados)' : Math.round(wsp) + ' °/s'}` }); await tick(); }
    st.load = keep.load;
    onProgress && onProgress('Autonomía estimada');
    place(-150, -170, 0); st.testCmd = [.6, .6]; await run(2); const ia = st.ibat;
    res.push({ prueba: 'Autonomía conduciendo al 60 % de PWM', resultado: `≈ ${Math.round(P.capAh * .85 / ia * 60)} min`, detalle: `consumo ${Math.round(ia * 1000)} mA con la electrónica montada; usa el 85 % de ${P.capAh * 1000} mAh` });
  } finally {
    Object.assign(st, keep, { vl: 0, vr: 0, quiet: false, testCmd: [0, 0], replay: null }); st.path = keepPath; st.rec = keepRec; st.mode = keep.mode; st.est = null;
    Sim.setLoad(st.load); UGV.emit('mode', st.mode);
  }
  return res;
};

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
    if (!Sim.ledLights && built.leds) Sim.ledLights = [-3, 3].map(z => { const L = new T.SpotLight(0xfff3d6, 0, 220, Math.PI / 6, .55, 1); L.position.set(.6, .55, z); L.target.position.set(60, -6, z * 1.6); built.leds.g.add(L, L.target); return L; });
    if (Sim.ledLights) Sim.ledLights.forEach(L => L.intensity = lit ? 2.5 : 0);
    wireT -= dt; if (wiresOn && wireT <= 0) { wireT = .05; wireMeshes.forEach(o => { const s = o.w.sig; let lv = 0;
      if (s === 'ENA') lv = Math.abs(st.dutyL); else if (s === 'ENB') lv = Math.abs(st.dutyR); else if (s === 'IN1') lv = st.dutyL > 0; else if (s === 'IN2') lv = st.dutyL < 0;
      else if (s === 'IN3') lv = st.dutyR > 0; else if (s === 'IN4') lv = st.dutyR < 0; else if (s === 'LUCES') lv = st.lights; else if (s === 'BOCINA') lv = st.horn;
      o.m.material.emissiveIntensity = +lv * .55; }); }
    if (view === 'follow') { const back = new T.Vector3(-Math.cos(st.yaw) * 46, 26, Math.sin(st.yaw) * 46).add(robot.position); camera.position.lerp(back, .07); camera.lookAt(st.x, 6, st.z); }
    else if (view === 'top') { camera.position.lerp(new T.Vector3(st.x * (drawMode ? 0 : 1), drawMode ? 380 : 170, st.z * (drawMode ? 0 : 1) + .01), .1); camera.lookAt(drawMode ? 0 : st.x, 0, drawMode ? 0 : st.z); }
    else if (view === 'robotcam' && groups.cam) { const p = new T.Vector3(1.2, 1.2, 0); groups.cam.localToWorld(p); camera.position.copy(p); camera.lookAt(p.clone().add(new T.Vector3(Math.cos(st.yaw), -.1, -Math.sin(st.yaw)))); }
    else controls.update();
    sun.position.set(st.x + 40, 90, st.z + 30); sun.target.position.set(st.x, 0, st.z);
    if (selBox) selBox.update();
    renderer.render(scene, camera); drawOverlay();
    telT -= dt; if (telT <= 0) { telT = .1;
      Object.assign(tel, { v, w, vbat: st.vbat, soc: st.soc, ibat: st.ibat, iL: st.iL, iR: st.iR, dutyL: st.dutyL, dutyR: st.dutyR, dist: st.dist, sonar: sensorOK(an), mode: st.mode, replay: !!st.replay,
        err: st.err, rms: st.errN ? Math.sqrt(st.errAcc / st.errN) : 0, est: st.est, x: st.x, z: st.z, yaw: st.yaw, recT: st.recT, seen: st.seen, warnings: an.warnings,
        okA: driveOK(an, 'A'), okB: driveOK(an, 'B'), lights: st.lights, horn: st.horn, load: st.load, mass: Sim.robotMass() + st.load, sf: st.sf });
      UGV.emit('telemetry', tel); }
  }
  requestAnimationFrame(loop);
}
function drawOverlay() {
  if (!overlay) return;
  if (view !== 'robotcam') { if (overlay.childElementCount) overlay.innerHTML = ''; return; }
  const r = canvas.getBoundingClientRect(); let html = '';
  if (UGV.isOn('aruco')) markers.forEach(mk => { const p = new T.Vector3(mk.x, .1, mk.z).project(camera); const d = Math.hypot(mk.x - st.x, mk.z - st.z);
    if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && d < 160) { const s = Math.max(18, 900 / d);
      html += `<div class="det" style="left:${(p.x + 1) / 2 * r.width - s / 2}px;top:${(1 - p.y) / 2 * r.height - s / 2}px;width:${s}px;height:${s}px"><span>ID ${mk.id} · ${Math.round(d)} cm</span></div>`; } });
  overlay.innerHTML = html + '<div class="rec">● CÁMARA · 640×480</div>';
}
})();
