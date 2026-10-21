/* Simulador 3D: parcela de finca, robot, cables, física, localización GNSS y misión por puntos */
(function () {
'use strict';
const T = THREE, G = UGV.GEOM, S = UGV.state;
const Sim = UGV.Sim = {};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

/* ---------- Parámetros del modelo (estimados; ver pestaña Proyecto) ---------- */
const P = Sim.P = {
  rpm12: 350,       // RPM sin carga a 12 V
  tstall12: .343,   // torque de bloqueo a 12 V (N·m) = 3,5 kg·cm
  istall12: 1.8,    // corriente de bloqueo a 12 V (A)
  i0: .1,           // corriente sin carga (A)
  drop: 1.8,        // caída del L298N (V)
  capAh: 2.6,       // capacidad de cada celda (Ah), las celdas van en serie
  rint: .075,       // resistencia interna por celda (Ω)
  tau: .15,         // constante de tiempo de los motores (s)
  mulat: .45,       // fricción lateral oruga-suelo (giros)
  contact: .12,     // largo de contacto de la oruga (m)
  mismatch: .02,    // el motor B gira 2 % más rápido (asimetría real de motores)
  sonarSlow: 150,   // por debajo de esta distancia reduce la velocidad (cm)
  sonarStop: 60,    // por debajo de esta distancia se detiene (cm)
  linkTimeout: 1.0  // sin latido del operador durante 1 s → parada de emergencia
};
/* Suelos de la finca: resistencia a la rodadura, avance real frente al de las orugas y deslizamiento extra en giros */
const SOIL = {
  camino: { name: 'camino compactado', mur: .08, slipLong: .97, chi: 1.0 },
  suelo: { name: 'suelo del lote', mur: .10, slipLong: .95, chi: 1.1 },
  barro: { name: 'barro', mur: .15, slipLong: .82, chi: 1.3 },
  piso: { name: 'piso del acopio', mur: .06, slipLong: .98, chi: .95 }
};
const ocvCell = soc => { const t = [[0, 3.0], [.05, 3.3], [.1, 3.45], [.2, 3.6], [.5, 3.75], [.8, 3.95], [1, 4.2]];
  for (let i = 1; i < t.length; i++) if (soc <= t[i][0]) { const [a, va] = t[i - 1], [b, vb] = t[i]; return va + (vb - va) * (soc - a) / (b - a); } return 4.2; };
const cells = () => (S.cells === 3 ? 3 : 2);
Sim.cells = cells;

/* ---------- La finca (unidades: cm; x = este, z = sur) ---------- */
const FIELD = Sim.FIELD = 3600;
const ROADS = Sim.ROADS = [{ x0: -1750, x1: 1750, z0: -150, z1: 150 }, { x0: 950, x1: 1250, z0: -1060, z1: 150 }];
const LOTS = Sim.LOTS = [
  { name: 'Lote 1 · café', x0: -1350, x1: 320, rows: [400, 580, 760, 940, 1120, 1300] },
  { name: 'Lote 2 · ladera', x0: -1350, x1: 120, rows: [-500, -680, -860, -1040, -1220, -1400] }
];
const ROW_HALF = 42;                       // media anchura de un surco de plantas
const MUD = Sim.MUD = [{ x: -520, z: 0, r: 170 }, { x: 470, z: 330, r: 120 }, { x: 1100, z: -430, r: 115 }];
const TREES = Sim.TREES = [{ x: -880, z: 760, r: 330 }, { x: -230, z: 1120, r: 300 }, { x: -600, z: -860, r: 300 }];
const SHED = Sim.SHED = { x0: 900, x1: 1500, z0: -1560, z1: -1060 };
const PEOPLE = [{ x: -720, z: 850 }, { x: -90, z: 1030 }, { x: 380, z: 560 }];
const STACK = [{ x: 380, z: 780 }, { x: 410, z: 820 }];
const markers = Sim.markers = [{ id: 7, x: 1100, z: -1100 }];
/* Misión de ejemplo: carga en la cabecera del lote 1, camino de servicio y acopio */
const MISSION_DEF = [
  { id: 'A', x: 480, z: 690, tipo: 'carga' }, { id: 'B', x: 480, z: 0, tipo: 'paso' },
  { id: 'C', x: 1100, z: 0, tipo: 'paso' }, { id: 'D', x: 1100, z: -720, tipo: 'paso' },
  { id: 'ACOPIO', x: 1100, z: -1250, tipo: 'acopio' }
];
const START = { x: 480, z: 690, yaw: Math.PI / 2 };

/* Altura del terreno: ladera al norte del camino (10° y luego 15°) en la zona del lote 2 */
const TAN10 = Math.tan(10 * DEG), TAN15 = Math.tan(15 * DEG);
function H(x, z) {
  const wx = clamp((620 - x) / 260, 0, 1); if (!wx) return 0;
  let d = -260 - z; if (d <= 0) return 0;
  const blend = 60; let h;
  if (d < blend) h = TAN10 * d * d / (2 * blend); else if (d < 660) h = TAN10 * (d - blend / 2);
  else h = TAN10 * (660 - blend / 2) + TAN15 * (d - 660);
  const sx = wx * wx * (3 - 2 * wx); return h * sx;
}
Sim.H = H;
const inRect = (x, z, r, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
function soilAt(x, z) {
  for (const m of MUD) if (Math.hypot(x - m.x, z - m.z) < m.r) return 'barro';
  if (inRect(x, z, SHED)) return 'piso';
  if (ROADS.some(r => inRect(x, z, r))) return 'camino';
  return 'suelo';
}
Sim.soilAt = soilAt;
const underCanopy = (x, z) => TREES.some(t => Math.hypot(x - t.x, z - t.z) < t.r);
Sim.underCanopy = underCanopy;

/* ---------- Estado ---------- */
const st = Sim.st = {
  jx: 0, jy: 0, keys: {}, vmax: 1, slip: 1.6, comp: true, lights: false, horn: false, load: 0,
  mode: 'manual', testHold: null, x: START.x, z: START.z, yaw: START.yaw, vl: 0, vr: 0, dutyL: 0, dutyR: 0, sf: 1,
  soc: .86, vbat: 8.1, ibat: 0, iL: 0, iR: 0, timeScale: 1, simSpeed: 1, t: 0,
  rec: [], recT: 0, path: [[START.x, START.z]], est: null, estPath: [], err: 0, errAcc: 0, errN: 0, dist: null,
  origin: { x: START.x, z: START.z }, seen: [], quiet: false, testCmd: [0, 0],
  grade: 0, soil: 'camino', gnss: null, gnssBias: [0, 0], gnssT: 0, linkCut: false, linkLostT: 0, halt: null,
  ms: { i: 1, dir: 1, wait: null, waitT: 0, trips: 0, kg: 0, autoConfirm: true, done: false }, bumps: 0
};
const hist = Sim.hist = []; const log = Sim.log = [];

let renderer, scene, camera, controls, robot, chassis, sun, canvas, overlay, contact, parcel, ground;
const groups = {}, built = {};
let view = 'orbit', wiresOn = true, openBox = false, selected = null, selBox = null, drawMode = false;
let obstacles = [];
const DEFAULT_OBS = [{ x: -900, z: 230, w: 60, d: 42, h: 32 }, { x: -1250, z: -215, w: 60, d: 42, h: 32 }];
const custom = Sim.custom = []; // ruta dibujada [[x,z]]

/* ---------- Texturas ---------- */
function fieldTex() {
  const N = 2048, k = N / FIELD, X = x => (x + FIELD / 2) * k, Z = z => (z + FIELD / 2) * k;
  return UGV.tex(N, N, (g) => {
    g.fillStyle = '#7d9a4a'; g.fillRect(0, 0, N, N); // pasto
    for (let i = 0; i < 26000; i++) { const s = Math.random(); g.fillStyle = s < .5 ? `rgba(60,95,30,${Math.random() * .25})` : `rgba(160,170,80,${Math.random() * .18})`; g.fillRect(Math.random() * N, Math.random() * N, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    LOTS.forEach(l => { // suelo labrado del lote con calles
      const z0 = Math.min(...l.rows) - 150, z1 = Math.max(...l.rows) + 150;
      g.fillStyle = '#7a5a3a'; g.fillRect(X(l.x0 - 140), Z(z0), (l.x1 - l.x0 + 280) * k, (z1 - z0) * k);
      l.rows.forEach(r => { g.fillStyle = 'rgba(70,48,28,.55)'; g.fillRect(X(l.x0), Z(r - ROW_HALF - 10), (l.x1 - l.x0) * k, (2 * ROW_HALF + 20) * k); });
    });
    ROADS.forEach(r => { g.fillStyle = '#b59d76'; g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k);
      g.strokeStyle = 'rgba(120,96,60,.5)'; g.lineWidth = 3; for (let i = 0; i < 6; i++) { g.beginPath(); const vert = r.x1 - r.x0 < r.z1 - r.z0;
        if (vert) { const x = X(r.x0 + (r.x1 - r.x0) * (.3 + .4 * (i % 2))); g.moveTo(x, Z(r.z0)); g.lineTo(x + (Math.random() - .5) * 6, Z(r.z1)); }
        else { const z = Z(r.z0 + (r.z1 - r.z0) * (.3 + .4 * (i % 2))); g.moveTo(X(r.x0), z); g.lineTo(X(r.x1), z + (Math.random() - .5) * 6); } g.stroke(); } });
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(90,70,45,${Math.random() * .12})`; g.fillRect(Math.random() * N, Math.random() * N, 2, 2); }
    MUD.forEach(m => { const rg = g.createRadialGradient(X(m.x), Z(m.z), 0, X(m.x), Z(m.z), m.r * k); rg.addColorStop(0, '#3e2c1c'); rg.addColorStop(.75, 'rgba(62,44,28,.85)'); rg.addColorStop(1, 'rgba(62,44,28,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(X(m.x), Z(m.z), m.r * k, 0, 7); g.fill();
      g.fillStyle = 'rgba(150,170,190,.35)'; g.beginPath(); g.ellipse(X(m.x) + 4, Z(m.z) - 3, m.r * k * .35, m.r * k * .18, .4, 0, 7); g.fill(); });
    g.fillStyle = '#9b958a'; g.fillRect(X(SHED.x0), Z(SHED.z0), (SHED.x1 - SHED.x0) * k, (SHED.z1 - SHED.z0) * k); // placa del acopio
  });
}
function barkTex() { return UGV.tex(64, 256, (g, w, h) => { g.fillStyle = '#5b4632'; g.fillRect(0, 0, w, h); for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(30,20,10,${Math.random() * .4})`; g.fillRect(Math.random() * w, 0, 1 + Math.random() * 2, h); } }); }
function sackTex() {
  return UGV.tex(256, 256, (g, w, h) => { g.fillStyle = '#b89a66'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(110,85,45,.25)'; g.fillRect(0, y, w, 1.5); }
    for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(110,85,45,.2)'; g.fillRect(x, 0, 1.5, h); }
    g.fillStyle = 'rgba(60,90,40,.7)'; g.font = '600 34px sans-serif'; g.textAlign = 'center'; g.fillText('CAFÉ', w / 2, h / 2 + 12); });
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
function signTex(txt, sub) {
  return UGV.tex(512, 192, (g, w, h) => { g.fillStyle = '#1e5b3a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2efe2'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#f2efe2'; g.textAlign = 'center'; g.font = '700 64px "Saira Condensed", sans-serif'; g.fillText(txt, w / 2, 92); g.font = '500 30px "IBM Plex Sans", sans-serif'; g.fillText(sub, w / 2, 148); });
}

/* ---------- Escenario ---------- */
function buildField() {
  const geo = new T.PlaneGeometry(FIELD, FIELD, 180, 180); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, H(pos.getX(i), pos.getZ(i))); geo.computeVertexNormals();
  ground = new T.Mesh(geo, new T.MeshStandardMaterial({ map: fieldTex(), roughness: .96, metalness: 0, envMapIntensity: .15 }));
  ground.receiveShadow = true; scene.add(ground); Sim.floor = ground;
  // borde de pasto alrededor de la parcela
  const out = new T.Mesh(new T.PlaneGeometry(FIELD * 4, FIELD * 4), new T.MeshStandardMaterial({ color: 0x6f8c40, roughness: 1 }));
  out.rotation.x = -Math.PI / 2; out.position.y = -1.5; scene.add(out);

  // matas de café (instanciadas) sobre los surcos
  const plants = [];
  LOTS.forEach(l => l.rows.forEach((r, ri) => { for (let x = l.x0 + 40; x <= l.x1 - 30; x += 115) plants.push([x + (Math.random() - .5) * 18, r + (Math.random() - .5) * 10, .8 + Math.random() * .35, ri]); }));
  const leafM = new T.MeshStandardMaterial({ color: 0x2f6b2a, roughness: .85 }), leafM2 = new T.MeshStandardMaterial({ color: 0x3f8a36, roughness: .8 });
  const trunkM = new T.MeshStandardMaterial({ color: 0x5a4330, roughness: .9 });
  const bush = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), leafM, plants.length), top = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), leafM2, plants.length);
  const stem = new T.InstancedMesh(new T.CylinderGeometry(3, 4, 1, 6), trunkM, plants.length);
  const cherry = new T.InstancedMesh(new T.SphereGeometry(2.2, 6, 4), new T.MeshStandardMaterial({ color: 0xb3261e, roughness: .4 }), plants.length * 6);
  const d = new T.Object3D(); let ci = 0;
  plants.forEach(([x, z, s], i) => { const y = H(x, z);
    d.position.set(x, y + 30, z); d.scale.set(3, 60, 3); d.rotation.set(0, 0, 0); d.updateMatrix(); stem.setMatrixAt(i, d.matrix);
    d.position.set(x, y + 70 * s, z); d.scale.set(44 * s, 52 * s, 40 * s); d.rotation.set(0, Math.random() * 6, 0); d.updateMatrix(); bush.setMatrixAt(i, d.matrix);
    d.position.set(x + 4, y + 108 * s, z - 3); d.scale.set(28 * s, 30 * s, 26 * s); d.updateMatrix(); top.setMatrixAt(i, d.matrix);
    for (let k = 0; k < 6; k++) { const a = Math.random() * 6.28; d.position.set(x + Math.cos(a) * 38 * s, y + (45 + Math.random() * 50) * s, z + Math.sin(a) * 34 * s); d.scale.set(1, 1, 1); d.updateMatrix(); cherry.setMatrixAt(ci++, d.matrix); } });
  [bush, top, stem].forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); }); scene.add(cherry);

  // árboles de sombrío (degradan la señal GNSS)
  const bark = new T.MeshStandardMaterial({ map: barkTex(), roughness: .9 }), crown = new T.MeshStandardMaterial({ color: 0x3d6b2c, roughness: .85 });
  TREES.forEach(t => { const y = H(t.x, t.z);
    const tr = new T.Mesh(new T.CylinderGeometry(16, 24, 480, 10), bark); tr.position.set(t.x, y + 240, t.z); tr.castShadow = true; scene.add(tr);
    for (let k = 0; k < 5; k++) { const c = new T.Mesh(new T.IcosahedronGeometry(t.r * (.45 + Math.random() * .2), 1), crown); c.position.set(t.x + (Math.random() - .5) * t.r * .8, y + 500 + Math.random() * 120, t.z + (Math.random() - .5) * t.r * .8); c.scale.y = .55; c.castShadow = true; scene.add(c); } });

  // recolectores (figuras simples)
  const shirt = [0x2b5fd9, 0xd9472f, 0xe3c51b], skin = new T.MeshStandardMaterial({ color: 0x8a5a3c, roughness: .7 }), pants = new T.MeshStandardMaterial({ color: 0x2a3340, roughness: .8 });
  PEOPLE.forEach((p, i) => { const g = new T.Group(), y = H(p.x, p.z); g.position.set(p.x, y, p.z); g.rotation.y = Math.random() * 6;
    const leg = new T.Mesh(new T.CylinderGeometry(9, 10, 85, 10), pants); leg.position.y = 42; g.add(leg);
    const body = new T.Mesh(new T.CylinderGeometry(15, 12, 65, 12), new T.MeshStandardMaterial({ color: shirt[i % 3], roughness: .8 })); body.position.y = 117; g.add(body);
    const head = new T.Mesh(new T.SphereGeometry(11, 14, 10), skin); head.position.y = 162; g.add(head);
    const hat = new T.Mesh(new T.CylinderGeometry(24, 24, 3, 18), new T.MeshStandardMaterial({ color: 0xe7dcb8, roughness: .8 })); hat.position.y = 172; g.add(hat);
    const crownH = new T.Mesh(new T.CylinderGeometry(10, 12, 12, 14), hat.material); crownH.position.y = 178; g.add(crownH);
    const basket = new T.Mesh(new T.CylinderGeometry(14, 11, 20, 12), new T.MeshStandardMaterial({ color: 0x9c7a44, roughness: .9 })); basket.position.set(0, 95, 18); g.add(basket);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); });

  // acopio: techo sobre postes, muros bajos, báscula y bultos
  const metal = new T.MeshStandardMaterial({ color: 0x8f969c, roughness: .5, metalness: .6 }), wall = new T.MeshStandardMaterial({ color: 0xd8cdb5, roughness: .9 });
  const { x0, x1, z0, z1 } = SHED, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, z1], [cx, z0]].forEach(([x, z]) => { const p = new T.Mesh(new T.BoxGeometry(12, 300, 12), metal); p.position.set(x, 150, z); p.castShadow = true; scene.add(p); });
  const roof = new T.Mesh(new T.BoxGeometry(x1 - x0 + 80, 6, z1 - z0 + 80), new T.MeshStandardMaterial({ color: 0xa9b1b6, roughness: .45, metalness: .7 }));
  roof.position.set(cx, 305, cz); roof.rotation.x = .06; roof.castShadow = true; roof.receiveShadow = true; scene.add(roof);
  [[cx, z0, x1 - x0, 8], [x0, cz, 8, z1 - z0], [x1, cz, 8, z1 - z0]].forEach(([x, z, w, dd]) => { const m = new T.Mesh(new T.BoxGeometry(w, 110, dd), wall); m.position.set(x, 55, z); m.castShadow = m.receiveShadow = true; scene.add(m); });
  const scale = new T.Mesh(new T.BoxGeometry(110, 6, 110), metal); scale.position.set(cx + 100, 3, cz - 60); scale.receiveShadow = true; scene.add(scale);
  const sign = new T.Mesh(new T.PlaneGeometry(220, 82), new T.MeshStandardMaterial({ map: signTex('ACOPIO', 'báscula · recibo de cosecha'), roughness: .7 }));
  sign.position.set(cx, 250, z1 + 1); scene.add(sign);
  const sackM = new T.MeshStandardMaterial({ map: sackTex(), roughness: .95 }); Sim.sackMat = sackM;
  [[x1 - 70, z0 + 50], [x1 - 70, z0 + 100], [x1 - 130, z0 + 50], [x1 - 100, z0 + 75, 1]].forEach(([x, z, up]) => { const s = sackShape(sackM); s.position.set(x, up ? 62 : 16, z); scene.add(s); });
  STACK.forEach(o => { const s = sackShape(sackM); s.position.set(o.x, H(o.x, o.z) + 16, o.z); s.rotation.y = Math.random(); scene.add(s); });
  // letreros de los lotes
  [['LOTE 1', 'café · surcos a 1,8 m', 420, 1450], ['LOTE 2', 'café en ladera', 260, -320]].forEach(([a, b, x, z]) => { const m = new T.Mesh(new T.PlaneGeometry(170, 64), new T.MeshStandardMaterial({ map: signTex(a, b), roughness: .7 }));
    m.position.set(x, H(x, z) + 120, z); m.rotation.y = -Math.PI / 2; scene.add(m); const post = new T.Mesh(new T.BoxGeometry(6, 120, 6), trunkM); post.position.set(x + 2, H(x, z) + 60, z); scene.add(post); });
}
function sackShape(mat) {
  const g = new T.Mesh(new T.CapsuleGeometry ? new T.CapsuleGeometry(15, 32, 6, 12) : new T.CylinderGeometry(15, 15, 62, 12), mat);
  g.rotation.z = Math.PI / 2; g.scale.set(1, 1, 1.35); g.castShadow = g.receiveShadow = true; return g;
}

/* ---------- Inicio ---------- */
Sim.init = function (cv, ov) {
  canvas = cv; overlay = ov;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); }
  catch (e) { canvas.parentElement.insertAdjacentHTML('beforeend', '<p class="nogl">Tu navegador no tiene WebGL activado, así que no puede mostrar el modelo 3D. Prueba con Chrome, Edge o Firefox actualizados.</p>'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene(); scene.background = new T.Color(0xbcd6e8); scene.fog = new T.Fog(0xbcd6e8, 2600, 7600);
  const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new T.RoomEnvironment(), .04).texture;
  camera = new T.PerspectiveCamera(36, 1, .5, 12000); camera.position.set(START.x + 34, 22, START.z + 38);
  controls = new T.OrbitControls(camera, canvas);
  controls.target.set(START.x, 5, START.z); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .48; controls.minDistance = 9; controls.maxDistance = 3200;

  scene.add(new T.HemisphereLight(0xdfefff, 0x6b5a3a, .55));
  sun = new T.DirectionalLight(0xfff1d8, 1.35); sun.position.set(40, 300, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 1400 });
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .04; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new T.DirectionalLight(0xdfe9ff, .3); fill.position.set(-60, 40, -50); scene.add(fill);

  buildField();
  Sim.obsGroup = new T.Group(); scene.add(Sim.obsGroup);
  (S.obstacles || DEFAULT_OBS).forEach(o => addObstacle(o, true));
  Sim.arucoGroup = new T.Group(); scene.add(Sim.arucoGroup);
  markers.forEach(mk => { const m = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshStandardMaterial({ map: arucoTex(mk.id), roughness: .8 }));
    m.rotation.x = -Math.PI / 2; m.position.set(mk.x, .3, mk.z); m.receiveShadow = true; Sim.arucoGroup.add(m); });
  Sim.refLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0x2d4fb8, dashSize: 14, gapSize: 9 })); scene.add(Sim.refLine);
  Sim.wpGroup = new T.Group(); scene.add(Sim.wpGroup);

  const mkTrail = (col, dashed) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(12000 * 3), 3)); g.setDrawRange(0, 0);
    const l = new T.Line(g, dashed ? new T.LineDashedMaterial({ color: col, dashSize: 6, gapSize: 4 }) : new T.LineBasicMaterial({ color: col })); l.frustumCulled = false; scene.add(l); return { g, l, n: 0 }; };
  Sim.trail = mkTrail(0x1f9a6c); Sim.etrail = mkTrail(0xd99a12, true);
  Sim.gnssDots = new T.Points(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(new Float32Array(60 * 3), 3)), new T.PointsMaterial({ color: 0x7b4fc9, size: 5 }));
  Sim.gnssDots.frustumCulled = false; scene.add(Sim.gnssDots); Sim.gnssDots.geometry.setDrawRange(0, 0);

  robot = new T.Group(); robot.rotation.order = 'YXZ'; scene.add(robot);
  contact = new T.Mesh(new T.PlaneGeometry(26, 24), new T.MeshBasicMaterial({ map: contactTex(), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = .2; robot.add(contact);
  chassis = UGV.buildChassis(); robot.add(chassis.group); tagPart(chassis.group, 'chassis');
  UGV.PARTS.forEach(p => { if (p.noModel || p.id === 'chassis') return; const r = UGV.build(p.id); if (!r) return;
    const g = new T.Group(); g.add(r.g); robot.add(g); groups[p.id] = g; built[p.id] = r; tagPart(g, p.id); placePart(p.id); });
  parcel = sackShape(Sim.sackMat); parcel.visible = false; robot.add(parcel);
  Sim.wireGroup = new T.Group(); robot.add(Sim.wireGroup);
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if ('envMapIntensity' in m && m.envMapIntensity === 1) m.envMapIntensity = .5; }); });

  loadMission(); syncParts(); updateRef();
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
  if (built.estop) built.estop.g.userData.cap.position.y = S.estopPressed ? 2.0 : 2.2;
  applyBoxMode(); updateRef();
}

/* ---------- Obstáculos: bultos de cosecha puestos por el usuario ---------- */
function addObstacle(o, silent) {
  const m = sackShape(Sim.sackMat); m.position.set(o.x, H(o.x, o.z) + 16, o.z); m.rotation.y = o.rot || 0;
  Sim.obsGroup.add(m); obstacles.push(Object.assign({ mesh: m }, o)); if (!silent) saveObs();
}
function saveObs() { S.obstacles = obstacles.map(({ x, z, w, d, h }) => ({ x, z, w, d, h })); UGV.save(); }
Sim.addObstacle = () => {
  const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw), d = 110;
  addObstacle({ x: Math.round(st.x + fx * d), z: Math.round(st.z + fz * d), w: 60, d: 42, h: 32 });
  UGV.emit('toast', 'Bulto de café puesto 1,1 m delante del robot.');
};
Sim.clearObstacles = () => { obstacles.forEach(o => Sim.obsGroup.remove(o.mesh)); obstacles = []; saveObs(); UGV.emit('toast', 'Bultos quitados.'); };
Sim.resetObstacles = () => { Sim.clearObstacles(); DEFAULT_OBS.forEach(o => addObstacle(o, true)); saveObs(); };

/* ---------- Misión por puntos ---------- */
let mission = [];
Sim.mission = () => mission;
function loadMission() {
  if (custom.length >= 2) mission = custom.map(([x, z], i, a) => ({ id: i === a.length - 1 ? 'ACOPIO' : String.fromCharCode(65 + i), x, z, tipo: i === 0 ? 'carga' : i === a.length - 1 ? 'acopio' : 'paso' }));
  else mission = MISSION_DEF.map(p => Object.assign({}, p));
  Object.assign(st.ms, { i: 1, dir: 1, wait: null, waitT: 0, done: false });
  UGV.emit('mission', mission);
}
Sim.loadMission = loadMission;
/* Tramo activo: del punto anterior hasta el final, en el sentido actual */
function activePath() {
  const m = st.ms, pts = mission.map(p => [p.x, p.z]);
  if (pts.length < 2) return { pts: [[st.x, st.z], [st.x + 1, st.z]], closed: false };
  if (m.dir > 0) return { pts: pts.slice(Math.max(0, m.i - 1)), closed: false };
  return { pts: pts.slice(0, Math.min(pts.length, m.i + 2)).reverse(), closed: false };
}
Sim.activePath = activePath;
function updateRef() {
  if (!Sim.refLine) return;
  const pts = mission.map(p => new T.Vector3(p.x, H(p.x, p.z) + 1.2, p.z));
  Sim.refLine.geometry.dispose(); Sim.refLine.geometry = new T.BufferGeometry().setFromPoints(pts); Sim.refLine.computeLineDistances();
  Sim.refLine.visible = true;
  while (Sim.wpGroup.children.length) Sim.wpGroup.remove(Sim.wpGroup.children[0]);
  const col = { carga: 0xe39b12, acopio: 0xd9472f, paso: 0x2d4fb8 };
  mission.forEach(p => { const y = H(p.x, p.z), g = new T.Group(); g.position.set(p.x, y, p.z);
    const pole = new T.Mesh(new T.CylinderGeometry(1.4, 1.4, 70, 8), new T.MeshStandardMaterial({ color: 0xf2efe2 })); pole.position.set(28, 35, 28); g.add(pole);
    const flag = new T.Mesh(new T.PlaneGeometry(26, 16), new T.MeshStandardMaterial({ map: UGV.tex(128, 80, (c) => { c.fillStyle = '#' + col[p.tipo].toString(16).padStart(6, '0'); c.fillRect(0, 0, 128, 80); c.fillStyle = '#fff'; c.font = '700 44px "Saira Condensed", sans-serif'; c.textAlign = 'center'; c.fillText(p.id.length > 2 ? 'AC' : p.id, 64, 58); }), side: T.DoubleSide }));
    flag.position.set(41, 61, 28); g.add(flag);
    const ring = new T.Mesh(new T.RingGeometry(20, 24, 32), new T.MeshBasicMaterial({ color: col[p.tipo], side: T.DoubleSide, transparent: true, opacity: .8 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);
    Sim.wpGroup.add(g); });
}
Sim.setDraw = v => { drawMode = v; if (v) { custom.length = 0; Sim.setView('top'); UGV.emit('toast', 'Toca el terreno para poner los puntos: el primero es el punto de carga y el último el acopio.'); } else if (custom.length >= 2) { loadMission(); updateRef(); } };
Sim.clearCustom = () => { custom.length = 0; loadMission(); updateRef(); UGV.emit('custom', 0); };
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
Sim.confirm = () => { // el recolector confirma la carga o la descarga
  const m = st.ms; if (!m.wait) return false;
  if (m.wait === 'carga') { st.load = Math.min(2, +(st.load + 1).toFixed(1)); Sim.setLoad(st.load); if (!st.quiet) UGV.emit('toast', `Carga confirmada: ${String(st.load).replace('.', ',')} kg a bordo. Sale hacia el acopio.`); }
  if (m.wait === 'acopio') { m.trips++; m.kg = +(m.kg + st.load).toFixed(1); if (!st.quiet) UGV.emit('toast', `Descarga confirmada en el acopio: viaje ${m.trips}, ${String(m.kg).replace('.', ',')} kg en total.`); st.load = 0; Sim.setLoad(0); }
  m.wait = null; m.waitT = 0; UGV.emit('mission', mission); return true;
};
function arrivalRadius(p) {
  if (p.tipo === 'acopio' && UGV.isOn('aruco') && UGV.isOn('cam') && rpiOK()) return 18;
  if (!st.est) return 25;
  return S.gnssMode === 'rtk' && gnssOK() ? 30 : gnssOK() ? 250 : 120;
}

/* ---------- Cables 3D con los colores reales ---------- */
let wireMeshes = [];
const REAL = { ENA: 0xe8e8e8, IN1: 0x8b8f94, IN2: 0x2b5fd9, IN3: 0x2aa84a, IN4: 0xe3c51b, ENB: 0x7b4fc9, UART: 0xe07b1f, LORA: 0x2b9fd9, ESTOP: 0xe3c51b, GNSS: 0x141414 };
function realColor(w) {
  const k = [w.a, w.b], pin = k.map(UGV.pinInfo);
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
const isHeader = key => { const [p, pin] = key.split('.'); return ['esp32', 'imu', 'sonar', 'buzzer', 'leds', 'divider', 'enc', 'rpi', 'lora'].includes(p) || (p === 'l298n' && /^(EN|IN)/.test(pin)); };
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
  canvas.addEventListener('pointerup', e => {
    end(); if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || view === 'robotcam') return;
    pick(e);
    if (drawMode) { const h = ray.intersectObject(ground, false)[0]; if (h) { custom.push([Math.round(h.point.x), Math.round(h.point.z)]); if (custom.length >= 2) loadMission(); updateRef(); UGV.emit('custom', custom.length); } return; }
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
  if (v !== 'top' && drawMode) { drawMode = false; UGV.emit('draw', false); if (custom.length >= 2) { loadMission(); updateRef(); } }
  view = v; controls.enabled = v === 'orbit'; if (v === 'orbit') controls.target.set(st.x, H(st.x, st.z) + 5, st.z);
  camera.fov = v === 'robotcam' ? 50 : 36; camera.updateProjectionMatrix(); UGV.emit('view', v);
};
Sim.overview = () => { Sim.setView('orbit'); controls.target.set(150, 0, -150); camera.position.set(2300, 1700, 2600); };
Sim.snapshot = () => { renderer.render(scene, camera); canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ugv-orugas-finca.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }); };
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
  return UGV.isOn('sonar') && UGV.isOn('esp32') && (an.vAt('sonar.VCC') || 0) >= 4.5 && an.net('sonar.TRIG') === an.net('esp32.D23') &&
    (an.net('sonar.ECHO') === an.net('esp32.D13') || (UGV.isOn('divider') && an.net('sonar.ECHO') === an.net('divider.IN') && an.net('divider.OUT') === an.net('esp32.D13')));
}
/* La Raspberry Pi manda en modo automático: necesita alimentación y el puerto serie con la ESP32 */
function rpiOK(a = an) {
  if (!a || !UGV.isOn('rpi') || !UGV.isOn('esp32')) return false;
  return (a.vAt('rpi.5V') || 0) > 4.5 && a.net('rpi.TX') === a.net('esp32.RX2') && a.net('esp32.TX2') === a.net('rpi.RX') && a.net('rpi.GND') === a.net('esp32.GND');
}
function gnssOK(a = an) { return !!a && UGV.isOn('gnss') && rpiOK(a) && a.net('gnss.USB') === a.net('rpi.USB'); }
function loraOK(a = an) { return !!a && UGV.isOn('lora') && UGV.isOn('esp32') && (a.vAt('lora.VCC') || 0) >= 3 && a.net('lora.TXD') === a.net('esp32.D18') && a.net('esp32.D19') === a.net('lora.RXD'); }
Sim.rpiOK = () => rpiOK(); Sim.gnssOK = () => gnssOK(); Sim.loraOK = () => loraOK();
Sim.robotMass = () => UGV.PARTS.reduce((s, p) => s + (UGV.isOn(p.id) ? p.mass : 0), 0) / 1000 + (cells() === 3 ? .046 : 0);

/* ---------- Comandos ---------- */
Sim.cmd = (name, v) => {
  if (name === 'stop') { st.jx = st.jy = 0; st.keys = {}; st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); st.vl = st.vr = 0; }
  if (name === 'lights') st.lights = v;
  if (name === 'horn') st.horn = v;
  if (name === 'clear') { st.rec = []; st.recT = 0; st.path = [[st.x, st.z]]; st.origin = { x: st.x, z: st.z }; st.estPath = []; if (st.est) Object.assign(st.est, { x: st.x, z: st.z, yaw: st.yaw }); clearTrail(Sim.trail); clearTrail(Sim.etrail); st.errAcc = st.errN = 0; }
  if (name === 'home') { if (!st.rec.length) { UGV.emit('toast', 'No hay ruta guardada todavía.'); return; } if (st.mode === 'auto') Sim.setMode('manual'); st.replay = { i: st.rec.length - 1, t: 0 }; UGV.emit('toast', 'Volviendo al inicio por la misma ruta, en reversa.'); }
  if (name === 'reset') { const p0 = mission[0] || START; Object.assign(st, { x: p0.x, z: p0.z, yaw: START.yaw, vl: 0, vr: 0, replay: null, est: null, halt: null, linkLostT: 0 }); Object.assign(st.ms, { i: 1, dir: 1, wait: null, waitT: 0, done: false }); Sim.cmd('clear'); UGV.emit('mission', mission); }
  if (name === 'rearm') { if (S.estopPressed) { UGV.emit('toast', 'Primero suelta el paro de emergencia.'); return; } if (st.linkCut) { UGV.emit('toast', 'El enlace con el operador sigue cortado.'); return; } st.halt = null; st.linkLostT = 0; UGV.emit('toast', 'Sistema rearmado por el operador.'); }
};
Sim.setMode = m => {
  if (m === 'auto' && !rpiOK(UGV.analyze(st.vbat))) { UGV.emit('toast', 'El modo automático lo ejecuta la Raspberry Pi: necesita su DC-DC de 5 V y el puerto serie con la ESP32 (revisa Circuito).'); m = 'manual'; }
  st.mode = m; st.replay = null; st.errAcc = st.errN = 0; st.ms.done = false; updateRef(); UGV.emit('mode', m);
};
Sim.setJoy = (x, y) => { st.jx = x; st.jy = y; if (x || y) { st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); } };
Sim.setLoad = kg => { st.load = kg; parcel.visible = kg > 0; if (kg > 0) { const s = .2 + kg * .17; parcel.scale.set(s, s, s * 1.35); parcel.position.set(2.6, G.PLATE_Y + 6.6 + 15 * s, 0); } };
Sim.setEstop = on => { S.estopPressed = on; UGV.save(); UGV.emit('wires'); UGV.emit('parts'); if (on) st.halt = 'paro de emergencia'; };
Sim.setLinkCut = on => { st.linkCut = on; if (!on) st.linkLostT = 0; };
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && UGV.activeTab === 'sim') { st.keys[k] = true; st.replay = null; if (st.mode === 'auto') Sim.setMode('manual'); e.preventDefault(); }
  if (k === ' ' && UGV.activeTab === 'sim') { Sim.cmd('stop'); e.preventDefault(); } });
addEventListener('keyup', e => { st.keys[e.key.toLowerCase()] = false; });

function clearTrail(t) { if (!t) return; t.n = 0; t.g.setDrawRange(0, 0); }
function pushTrail(t, x, z) { if (!t || t.n >= 12000) return; t.g.attributes.position.setXYZ(t.n, x, H(x, z) + .5, z); t.n++; t.g.attributes.position.needsUpdate = true; t.g.setDrawRange(0, t.n); if (t.l.material.isLineDashedMaterial && t.n % 10 === 0) t.l.computeLineDistances(); }

/* Colisiones: surcos, troncos, recolectores, muros del acopio, bultos y borde de la parcela (radio del robot ≈ 10 cm) */
const RR = 10;
function blockedAt(x, z, m) {
  if (Math.abs(x) > FIELD / 2 - 20 || Math.abs(z) > FIELD / 2 - 20) return true;
  for (const l of LOTS) if (x > l.x0 - m && x < l.x1 + m) for (const r of l.rows) if (Math.abs(z - r) < ROW_HALF + m) return true;
  for (const t of TREES) if (Math.hypot(x - t.x, z - t.z) < 22 + m) return true;
  for (const p of PEOPLE) if (Math.hypot(x - p.x, z - p.z) < 18 + m) return true;
  for (const s of STACK) if (Math.hypot(x - s.x, z - s.z) < 26 + m) return true;
  const sh = SHED; if (x > sh.x0 - m && x < sh.x1 + m && z > sh.z0 - m && z < sh.z1 + m && (z < sh.z0 + 6 + m || x < sh.x0 + 6 + m || x > sh.x1 - 6 - m)) return true;
  for (const o of obstacles) if (Math.abs(x - o.x) < o.w / 2 + m && Math.abs(z - o.z) < o.d / 2 + m) return true;
  return false;
}
Sim.blockedAt = blockedAt;
function hitsObstacle(x, z) { return blockedAt(x, z, RR); }
function rayDist(ox, oz, dx, dz) { for (let d = 25; d <= 450; d += 2) { const x = ox + dx * d, z = oz + dz * d; if (blockedAt(x, z, 0)) return d; } return null; }

/* Velocidad de oruga (cm/s) con curva torque-velocidad del motor */
function trackSpeed(duty, vbat, treq) {
  const ve = Math.max(0, vbat * Math.abs(duty) - P.drop), ts = P.tstall12 * ve / 12;
  const f = ts > 0 ? clamp(1 - treq / ts, 0, 1.15) : 0;
  return { v: Math.sign(duty) * P.rpm12 * ve / 12 * f * 2 * Math.PI * G.WR / 60, f, ve };
}
Sim.vTop = () => trackSpeed(1, st.vbat, reqTorque(0, 0, SOIL.camino)).v;
/* Torque por oruga: rodadura + giro + componente del peso en la pendiente (positiva cuesta arriba) */
function reqTorque(turnFrac, grade, soil) { const m = Sim.robotMass() + st.load, g = 9.81, r = G.WR / 100, cb = Math.cos(grade);
  return r * (soil.mur * m * g * cb / 2 + P.mulat * (soil === SOIL.barro ? 1.2 : 1) * m * g * cb * P.contact / (2 * G.WB / 100) * turnFrac + m * g * Math.sin(grade) / 2); }
Sim.reqTorque = reqTorque;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
Sim.gnssSigma = (x = st.x, z = st.z) => { const rtk = S.gnssMode === 'rtk', c = underCanopy(x, z); return rtk ? (c ? 45 : 2) : (c ? 480 : 170); };

/* ---------- Estado de operación (como en el informe) ---------- */
function opState() {
  if (st.halt) return 'PARADA DE EMERGENCIA';
  if (st.mode === 'auto') { if (st.ms.done) return 'ESPERA'; if (st.ms.wait || st.obsPause) return 'PAUSA'; if (st.ms.ret) return 'RETORNO'; return 'AUTÓNOMO'; }
  if (st.replay) return 'MANUAL';
  const k = st.keys; return (st.jx || st.jy || k.w || k.a || k.s || k.d || k.arrowup || k.arrowdown || k.arrowleft || k.arrowright) ? 'MANUAL' : 'ESPERA';
}
Sim.opState = opState;

/* ---------- Paso de simulación ---------- */
function step(dt) {
  st.t += dt;
  anT -= dt; if (!an || anT <= 0) { an = UGV.analyze(st.vbat); anT = .25; Sim.an = an; }
  const okA = driveOK(an, 'A'), okB = driveOK(an, 'B');
  let L = 0, R = 0; const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw);
  const soil = SOIL[st.soil = soilAt(st.x, st.z)];
  const chiReal = st.slip * soil.chi, chiEst = st.comp ? (st.est && st.est.chi ? st.est.chi : st.slip) : 1;
  // vigilancia del enlace con el operador (latido cada segundo por LoRa)
  if (st.linkCut && (st.mode === 'auto' || opState() === 'MANUAL')) { st.linkLostT += dt; if (st.linkLostT > P.linkTimeout && !st.halt) { st.halt = 'enlace perdido'; if (!st.quiet) UGV.emit('toast', 'Sin latido del operador por más de 1 s: PARADA DE EMERGENCIA.'); } }
  if (S.estopPressed && UGV.isOn('estop') && !st.halt) st.halt = 'paro de emergencia';
  const pose = st.est || { x: st.x, z: st.z, yaw: st.yaw };
  st.obsPause = false;
  if (st.halt) { L = R = 0; st.replay = null; }
  else if (st.mode === 'test') { [L, R] = st.testCmd;
    if (st.testHold !== null && st.testHold !== undefined && L === R) { // mantener el rumbo (acoplamiento cruzado de la ESP32)
      const e = Math.atan2(Math.sin(st.testHold - st.yaw), Math.cos(st.testHold - st.yaw)); L = clamp(L - 1.2 * e, -1, 1); R = clamp(R + 1.2 * e, -1, 1); } }
  else if (st.replay) {
    const r = st.replay, c = st.rec[r.i]; L = -c[0]; R = -c[1]; r.t += dt;
    if (r.t >= c[2]) { r.t = 0; r.i--; if (r.i < 0) { st.replay = null; st.rec = []; st.recT = 0; UGV.emit('toast', 'Llegó al inicio.'); } }
  } else if (st.mode === 'auto' && rpiOK()) {
    const m = st.ms, target = mission[m.i];
    if (!m.ret && st.soc < .2 && m.dir < 0) { m.ret = true; m.dir = 1; m.i = Math.min(mission.length - 1, m.i + 1); if (!st.quiet) UGV.emit('toast', 'Batería baja: RETORNO al acopio.'); }
    if (m.wait) { m.waitT += dt; if (m.autoConfirm && m.waitT > 3) Sim.confirm(); }
    else if (target && !m.done) {
      const efx = Math.cos(pose.yaw), efz = -Math.sin(pose.yaw);
      const path = activePath(), v0 = Math.abs(st.vl + st.vr) / 2, Ld = 45 + .9 * v0, [tx, tz, , end] = lookahead(path, pose.x, pose.z, Ld);
      const dx = tx - pose.x, dz = tz - pose.z, yL = dx * efz - dz * efx, lx = dx * efx + dz * efz;
      const dTarget = Math.hypot(target.x - pose.x, target.z - pose.z);
      if (dTarget < arrivalRadius(target) || (end && Math.hypot(dx, dz) < 8)) {
        if (target.tipo === 'carga' || target.tipo === 'acopio') { m.wait = target.tipo; m.waitT = 0; if (!st.quiet) UGV.emit('toast', target.tipo === 'carga' ? `Llegó al punto de carga ${target.id}: esperando que los recolectores suban la cosecha.` : 'Llegó al acopio: esperando la descarga.'); }
        const last = m.dir > 0 ? mission.length - 1 : 0;
        if (m.i === last) { if (m.ret) { m.ret = false; m.done = true; if (!st.quiet) UGV.emit('toast', 'RETORNO completo: el robot quedó en el acopio para cargar la batería.'); } else { m.dir = -m.dir; m.i += m.dir; } }
        else m.i += m.dir;
        UGV.emit('mission', mission);
      } else {
        const k = 2 * yL / (Ld * Ld), top = Math.max(1, Sim.vTop()), slowDown = dTarget < 120 ? .55 : 1;
        const v = .7 * st.vmax * top * slowDown, w = v * k;
        L = clamp((v - w * G.WB * chiEst / 2) / top, -1, 1); R = clamp((v + w * G.WB * chiEst / 2) / top, -1, 1);
        if (lx < Ld * .35) { const sg = yL >= 0 ? 1 : -1; L = -.6 * sg * st.vmax; R = .6 * sg * st.vmax; }
      }
    }
    const cl = closest(activePath(), st.x, st.z); st.err = cl.d; st.errAcc += cl.d * cl.d; st.errN++;
  } else if (st.mode !== 'auto') {
    let x = st.jx, y = st.jy; const k = st.keys;
    if (k.w || k.arrowup) y = 1; if (k.s || k.arrowdown) y = -1; if (k.a || k.arrowleft) x = -1; if (k.d || k.arrowright) x = 1;
    L = y + x; R = y - x; const mm = Math.max(1, Math.abs(L), Math.abs(R)); L = L / mm * st.vmax; R = R / mm * st.vmax;
  }
  // ultrasonido frontal: reduce a menos de 1,5 m y frena a menos de 0,6 m
  if (sensorOK(an)) { st.dist = rayDist(st.x + fx * 9.5, st.z + fz * 9.5, fx, fz);
    if (st.dist !== null && (L + R) > 0 && !st.replay) {
      const f = (L + R) / 2;
      if (st.dist < P.sonarStop) { L -= f; R -= f; st.obsPause = st.mode === 'auto'; if (!st.brake && !st.quiet) UGV.emit('toast', `Obstáculo a ${Math.round(st.dist)} cm: el robot se detiene.`); st.brake = true; }
      else if (st.dist < P.sonarSlow) { const s = (st.dist - P.sonarStop) / (P.sonarSlow - P.sonarStop); L = L * (.35 + .65 * s); R = R * (.35 + .65 * s); st.brake = false; }
      else st.brake = false;
    } else st.brake = false;
  } else st.dist = null;
  st.dutyL = L; st.dutyR = R;
  const effL = okA ? L * okA : 0, effR = okB ? R * okB : 0;
  if ((L || R) && (!okA || !okB) && !st.noDriveMsg && !st.quiet && !st.halt) { st.noDriveMsg = true; UGV.emit('toast', !okA && !okB ? (S.estopPressed && UGV.isOn('estop') ? 'Paro de emergencia pulsado: los motores no tienen potencia.' : 'Los motores no reciben señal: revisa las conexiones en Circuito.') : `El motor ${!okA ? 'A' : 'B'} no recibe señal: revisa su conexión.`); }
  if (!L && !R) st.noDriveMsg = false;
  // pendiente bajo el robot, en el sentido de avance
  const hF = H(st.x + fx * 7, st.z + fz * 7), hB = H(st.x - fx * 7, st.z - fz * 7); st.grade = Math.atan2(hF - hB, 14);
  const dirS = Math.sign(effL + effR);
  const turnFrac = (Math.abs(effL) + Math.abs(effR)) > .01 ? Math.abs(effL - effR) / (Math.abs(effL) + Math.abs(effR)) : 0;
  const treq = reqTorque(turnFrac, st.grade * dirS, soil);
  const A = trackSpeed(effL, st.vbat, treq), Bm = trackSpeed(effR, st.vbat, treq);
  st.sf = Math.min(Math.abs(effL) > .05 ? A.f : 1, Math.abs(effR) > .05 ? Bm.f : 1);
  if (st.sf < .06 && (Math.abs(effL) > .2 || Math.abs(effR) > .2)) { if (!st.stallMsg && !st.quiet) { st.stallMsg = true; const pw = Math.max(Math.abs(effL), Math.abs(effR)); UGV.emit('toast', st.grade * dirS > 5 * DEG ? `Pendiente de ${Math.round(st.grade * dirS / DEG)}° con ${String(st.load).replace('.', ',')} kg: los motores no tienen torque suficiente.` : pw < .75 ? `PWM de ${Math.round(pw * 100)} %: los motores no tienen fuerza para ${turnFrac > .5 ? 'girar en el sitio' : 'moverse'}.` : `Motores bloqueados: no hay torque suficiente${turnFrac > .5 ? ' para girar en el sitio' : ''} con ${String(st.load).replace('.', ',')} kg de carga.`); } } else st.stallMsg = false;
  const a = Math.min(1, dt / P.tau);
  st.vl += (A.v - st.vl) * a; st.vr += (Bm.v * (1 + P.mismatch) - st.vr) * a;
  const v = (st.vl + st.vr) / 2 * soil.slipLong * Math.cos(st.grade), w = (st.vr - st.vl) / (G.WB * chiReal);
  const ny = st.yaw + w * dt, nx = st.x + v * Math.cos(ny) * dt, nz = st.z - v * Math.sin(ny) * dt;
  if (!hitsObstacle(nx, nz)) { st.x = nx; st.z = nz; st.bump = false; } else { if (!st.bump) st.bumps++; st.vl *= .2; st.vr *= .2; st.bump = true; }
  st.bumpT = st.bump && (L || R) ? (st.bumpT || 0) + dt : 0;
  if (st.bumpT > 1.5 && st.mode === 'auto') { st.bumpT = 0; if (!st.quiet) { UGV.emit('toast', sensorOK(an) ? 'El robot chocó y no puede avanzar: la misión se detuvo. Llévalo a mano a un lugar libre.' : 'Choque: sin el ultrasonido conectado el robot no ve el obstáculo. La misión se detuvo; agrégalo en Piezas.'); Sim.setMode('manual'); } }
  st.yaw = ny;
  if (chassis) { chassis.tracks[-1].off += st.vl * dt; chassis.tracks[1].off += st.vr * dt; }
  localize(dt, fx, fz, w, chiEst);
  if (st.mode === 'manual' && !st.replay && (L || R)) { const lr = st.rec[st.rec.length - 1]; if (lr && lr[0] === L && lr[1] === R) lr[2] += dt; else st.rec.push([L, R, dt]); st.recT += dt; }
  const lp = st.path[st.path.length - 1]; if (Math.hypot(st.x - lp[0], st.z - lp[1]) > 4) { st.path.push([st.x, st.z]); if (st.path.length > 12000) st.path.shift(); if (!st.quiet) pushTrail(Sim.trail, st.x, st.z); }
  // batería: n celdas en serie
  const n = cells(), ve = Math.max(.1, st.vbat - P.drop), istall = P.istall12 * ve / 12;
  const im = (eff) => Math.abs(eff) > .01 ? Math.min(istall * Math.abs(eff) + .02, P.i0 + (P.istall12 - P.i0) * Math.max(0, treq) / P.tstall12) : 0;
  st.iL = im(effL); st.iR = im(effR);
  const espOn = (an.vAt('esp32.VIN') || 0) >= 4.5, on5 = (an.vAt('l298n.5V') || 0) > 4 || (an.vAt('buck.OUT+') || 0) > 4;
  let i = st.iL + st.iR;
  if (espOn) i += .12;
  if (on5) i += (UGV.isOn('sonar') ? .03 : 0) + (st.lights && UGV.isOn('leds') ? .03 : 0) + (st.horn && UGV.isOn('buzzer') ? .03 : 0) + (UGV.isOn('imu') ? .004 : 0) + (UGV.isOn('enc') ? .02 : 0) + (loraOK() ? .03 : 0);
  if ((an.vAt('rpi.5V') || 0) > 4.5) i += (.65 + (gnssOK() ? .05 : 0)) * 5.1 / (Math.max(1, st.vbat) * .88);
  if (S.on.switch && !S.switchClosed) i = 0;
  st.ibat = i; st.soc = Math.max(0, st.soc - i * dt * st.timeScale / 3600 / P.capAh);
  st.vbat = Math.max(0, n * ocvCell(st.soc) - i * P.rint * n);
  // registro
  st.logT = (st.logT || 0) + dt;
  if (st.logT >= .1 && !st.quiet) { st.logT = 0; const row = { t: +st.t.toFixed(1), v: +v.toFixed(2), w: +(w * 57.2958).toFixed(1), i: +i.toFixed(3), vbat: +st.vbat.toFixed(3), soc: +(st.soc * 100).toFixed(1), pwmA: Math.round(effL * 255), pwmB: Math.round(effR * 255),
    x: +st.x.toFixed(1), z: +st.z.toFixed(1), ex: st.est ? +st.est.x.toFixed(1) : '', ez: st.est ? +st.est.z.toFixed(1) : '', gx: st.gnss ? +st.gnss.x.toFixed(1) : '', gz: st.gnss ? +st.gnss.z.toFixed(1) : '',
    err: st.mode === 'auto' ? +st.err.toFixed(2) : '', grade: +(st.grade / DEG).toFixed(1), soil: st.soil, load: st.load, state: opState() };
    hist.push(row); if (hist.length > 600) hist.shift(); log.push(row); if (log.length > 30000) log.shift(); }
  return { v, w };
}

/* ---------- Localización: odometría + IMU + GNSS (filtro de Kalman simplificado) + ArUco en el acopio ---------- */
function localize(dt, fx, fz, wTrue, chiEst) {
  const enc = UGV.isOn('enc'), gnss = gnssOK();
  if (!enc && !gnss) { st.est = null; st.seen = []; st.gnss = null; return; }
  if (!st.est) st.est = { x: st.x, z: st.z, yaw: st.yaw, P: gnss ? 900 : 4, chi: st.slip };
  const e = st.est;
  if (enc) { const ve = (st.vl + st.vr) / 2; let we = (st.vr - st.vl) / (G.WB * chiEst);
    if (UGV.isOn('imu')) { we = wTrue + gauss() * .004; if (Math.abs(st.vr - st.vl) > 3) e.chi += ((st.vr - st.vl) / (G.WB * Math.max(.05, Math.abs(wTrue)) * Math.sign(wTrue || 1)) - e.chi) * .01; }
    e.yaw += we * dt; e.x += ve * Math.cos(e.yaw) * dt; e.z -= ve * Math.sin(e.yaw) * dt; e.P += .09 * Math.abs(ve) * dt;
  } else { e.yaw = st.yaw; e.P += 900 * dt; }
  e.chi = clamp(e.chi, 1, 2.6);
  // GNSS a 5 Hz con error correlacionado (deriva lenta, como un receptor real)
  if (gnss) { st.gnssT += dt; if (st.gnssT >= .2) { st.gnssT = 0;
    const sg = Sim.gnssSigma(), rho = .985; st.gnssBias = st.gnssBias.map(b => clamp(b * rho + Math.sqrt(1 - rho * rho) * sg * .8 * gauss(), -2.5 * sg, 2.5 * sg));
    const zx = st.x + st.gnssBias[0] + gauss() * sg * .35, zz = st.z + st.gnssBias[1] + gauss() * sg * .35;
    st.gnss = { x: zx, z: zz, sigma: sg, canopy: underCanopy(st.x, st.z), rtk: S.gnssMode === 'rtk' };
    const Rm = sg * sg, K = e.P / (e.P + Rm); e.x += K * (zx - e.x); e.z += K * (zz - e.z); e.P = (1 - K) * e.P;
    const vv = Math.abs(st.vl + st.vr) / 2; if (!enc || vv > 8) e.yaw += (st.yaw - e.yaw) * (UGV.isOn('imu') ? .01 : .05);
    if (!st.quiet && Sim.gnssDots) { const g = Sim.gnssDots.geometry, a = g.attributes.position, k = (st.gnssK = ((st.gnssK || 0) + 1) % 60); a.setXYZ(k, zx, H(zx, zz) + 1.5, zz); a.needsUpdate = true; g.setDrawRange(0, Math.max(g.drawRange.count === Infinity ? 0 : g.drawRange.count, k + 1)); }
  } } else st.gnss = null;
  // marcador ArUco del acopio visto por la cámara
  st.seen = UGV.isOn('cam') && rpiOK() && UGV.isOn('aruco') ? markers.filter(mk => { const dx = mk.x - st.x, dz = mk.z - st.z, d = Math.hypot(dx, dz), ang = Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz); return d < 260 && d > 15 && Math.abs(ang) < .5; }) : [];
  if (st.seen.length) { e.x += (st.x - e.x) * .08; e.z += (st.z - e.z) * .08; e.yaw += (st.yaw - e.yaw) * .08; e.P = Math.min(e.P, 4); }
  const lp = st.estPath[st.estPath.length - 1]; if (!lp || Math.hypot(e.x - lp[0], e.z - lp[1]) > 4) { st.estPath.push([e.x, e.z]); if (st.estPath.length > 12000) st.estPath.shift(); if (!st.quiet) pushTrail(Sim.etrail, e.x, e.z); }
}
Sim.stepN = (n, dt = 1 / 60) => { let r; for (let i = 0; i < n; i++) r = step(dt); return Object.assign({}, st, r); };
Sim.csv = () => { const cols = ['t', 'state', 'v', 'w', 'i', 'vbat', 'soc', 'pwmA', 'pwmB', 'x', 'z', 'ex', 'ez', 'gx', 'gz', 'err', 'grade', 'soil', 'load'],
  head = ['tiempo_s', 'estado', 'velocidad_cm_s', 'giro_grados_s', 'corriente_A', 'bateria_V', 'carga_bateria_pct', 'pwm_A', 'pwm_B', 'x_real_cm', 'z_real_cm', 'x_estimada_cm', 'z_estimada_cm', 'x_gnss_cm', 'z_gnss_cm', 'error_ruta_cm', 'pendiente_grados', 'suelo', 'carga_kg'];
  return head.join(',') + '\n' + log.map(r => cols.map(c => r[c]).join(',')).join('\n'); };

/* ---------- Banco de pruebas (simulado, en la finca) ---------- */
Sim.runTests = async function (onProgress) {
  const keep = JSON.parse(JSON.stringify({ x: st.x, z: st.z, yaw: st.yaw, soc: st.soc, load: st.load, comp: st.comp, mode: st.mode, vmax: st.vmax }));
  const keepOn = Object.assign({}, S.on), keepCells = S.cells, keepGnss = S.gnssMode, keepEstop = S.estopPressed, keepMs = JSON.parse(JSON.stringify(st.ms));
  const keepPath = st.path.slice(), keepRec = st.rec.slice(), keepCustom = custom.splice(0), keepObs = obstacles.slice();
  st.quiet = true; st.testing = true; const res = []; const tick = () => new Promise(r => setTimeout(r, 0));
  const refresh = () => { an = UGV.analyze(st.vbat); anT = .25; };
  const need = (...ids) => { ids.forEach(id => { S.on[id] = true; }); refresh(); };
  const place = (x, z, yaw, hold = true) => { Object.assign(st, { x, z, yaw, vl: 0, vr: 0, replay: null, est: null, halt: null, linkCut: false, linkLostT: 0, bumps: 0, gnssBias: [0, 0], testHold: hold ? yaw : null }); st.path = [[x, z]]; };
  const run = async (secs, until) => { const N = Math.round(secs * 60); for (let i = 0; i < N; i++) { step(1 / 60); if (until && until()) return i / 60; if (i % 3000 === 0) await tick(); } return secs; };
  const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
  const speed = () => Math.hypot(...[0, 0]) + Math.abs(st.vl + st.vr) / 2;
  try {
    S.estopPressed = false; st.mode = 'test'; st.soc = .9; st.load = 0; refresh();
    onProgress && onProgress('Recorrido recto de 3 m en el camino');
    place(-1500, 60, 0); st.testCmd = [1, 1]; let x0 = st.x, z0 = st.z, iAcc = 0, n = 0;
    const tt = await run(30, () => { iAcc += st.ibat; n++; return st.x - x0 >= 300; });
    const lat1 = Math.abs(st.z - z0);
    place(-1500, 60, 0, false); st.testCmd = [1, 1]; await run(30, () => st.x - x0 >= 300);
    res.push({ prueba: 'P2 · Recto 3 m en camino compactado (PWM 100 %)', resultado: `${fmt(tt, 1)} s`, detalle: `${fmt(300 / tt)} cm/s · desvío lateral ${fmt(lat1)} cm con acoplamiento cruzado y ${fmt(Math.abs(st.z - z0))} cm sin él (motores 2 % distintos) · ${Math.round(iAcc / n * 1000)} mA con ${cells()} celdas` });
    await tick();
    onProgress && onProgress('Giro de 360° en el sitio');
    place(-1500, -60, 0, false); st.testCmd = [-.8, .8]; let angEnc = 0; const y0 = st.yaw;
    const tg = await run(20, () => { angEnc += (st.vr - st.vl) / G.WB / 60; return st.yaw - y0 >= 2 * Math.PI; });
    res.push({ prueba: 'Giro de 360° en el sitio (PWM 80 %)', resultado: st.yaw - y0 >= 2 * Math.PI ? `${fmt(tg, 1)} s` : 'no completó el giro', detalle: `los encoders sin compensar estimarían ${Math.round(angEnc * 57.2958)}°: error de odometría de ${Math.round((angEnc / (2 * Math.PI) - 1) * 100)} % por el deslizamiento (χ = ${fmt(st.slip)})` });
    await tick();
    onProgress && onProgress('Velocidad en barro');
    place(-1500, 0, 0); st.testCmd = [1, 1]; await run(3); const vCam = (st.vl + st.vr) / 2 * SOIL.camino.slipLong;
    place(-650, 0, 0); st.testCmd = [1, 1]; let vMud = 0, nm = 0; await run(12, () => { if (st.soil === 'barro') { vMud += (st.vl + st.vr) / 2 * SOIL.barro.slipLong; nm++; } return st.x > -380; });
    res.push({ prueba: 'P11 · Paso por un charco de barro', resultado: nm ? `${fmt(vMud / nm)} cm/s` : 'no llegó al barro', detalle: `frente a ${fmt(vCam)} cm/s en el camino: la rodadura sube a ${String(SOIL.barro.mur).replace('.', ',')} y el avance real cae al ${Math.round(SOIL.barro.slipLong * 100)} % del de las orugas` });
    await tick();
    for (const kg of [0, 1, 2]) {
      onProgress && onProgress(`Pendiente con ${kg} kg`);
      st.load = kg; place(330, -290, Math.PI / 2); st.testCmd = [1, 1]; let v10 = [], v15 = [];
      await run(90, () => { const gd = st.grade / DEG; if (gd > 8.5 && gd < 11) v10.push((st.vl + st.vr) / 2); if (gd > 13.5) v15.push((st.vl + st.vr) / 2); return st.z < -1450 || (st.sf < .06 && st.t > 2); });
      const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
      res.push({ prueba: `P10 · Ladera de 10° y 15° con ${kg} kg`, resultado: v15.length ? `${fmt(avg(v10))} / ${fmt(avg(v15))} cm/s` : v10.length ? `${fmt(avg(v10))} cm/s en 10°; no sube 15°` : 'no sube la ladera', detalle: `velocidad media en el tramo de 10° / 15° · ${cells()} celdas · margen de torque ${Math.round(st.sf * 100)} % al final` });
      await tick();
    }
    st.load = keep.load;
    onProgress && onProgress('Misión completa A → acopio con GNSS');
    need('rpi', 'buck', 'gnss', 'enc', 'imu', 'cam', 'aruco'); S.gnssMode = 'auto'; loadMission();
    place(mission[0].x, mission[0].z, START.yaw); st.mode = 'auto'; Object.assign(st.ms, { i: 1, dir: 1, wait: null, waitT: 0, done: false, autoConfirm: true, trips: 0, kg: 0 });
    st.load = 1; let mxErr = 0; st.errAcc = st.errN = 0;
    const tm = await run(400, () => { mxErr = Math.max(mxErr, st.err); return st.ms.wait === 'acopio'; });
    const acc = mission[mission.length - 1], arrErr = Math.hypot(st.x - acc.x, st.z - acc.z);
    res.push({ prueba: 'P9 · Misión A → B → C → D → acopio (GNSS autónomo + ArUco)', resultado: st.ms.wait === 'acopio' ? `${fmt(tm, 0)} s` : 'no llegó', detalle: `error de llegada ${fmt(arrErr)} cm · desvío RMS ${fmt(Math.sqrt(st.errAcc / Math.max(1, st.errN)))} cm, máximo ${fmt(mxErr)} cm · ${st.bumps} choques` });
    st.mode = 'test'; await tick();
    for (const mode of ['auto', 'rtk']) {
      onProgress && onProgress(`Calle entre surcos con GNSS ${mode === 'rtk' ? 'RTK' : 'autónomo'}`);
      S.gnssMode = mode; custom.length = 0; custom.push([-1250, 670], [-500, 670], [200, 670]); loadMission();
      place(-1250, 670, 0); st.mode = 'auto'; Object.assign(st.ms, { i: 1, dir: 1, wait: null, done: false, autoConfirm: true }); st.errAcc = st.errN = 0; let mx = 0;
      await run(120, () => { mx = Math.max(mx, st.err); return st.x > 150 || !!st.ms.wait; });
      res.push({ prueba: `P12 · Calle de 1 m entre surcos, GNSS ${mode === 'rtk' ? 'RTK (ZED-F9P)' : 'autónomo (NEO-M8N)'}`, resultado: `RMS ${fmt(Math.sqrt(st.errAcc / Math.max(1, st.errN)))} cm`, detalle: `${st.bumps} choques con las matas · error máximo ${fmt(mx)} cm · ${st.x > 150 ? 'recorrió la calle' : 'no terminó la calle'} (pasa bajo un árbol de sombrío)` });
      st.mode = 'test'; custom.length = 0; await tick();
    }
    S.gnssMode = keepGnss; loadMission();
    onProgress && onProgress('Frenado ante un bulto en el camino');
    need('sonar', 'divider'); obstacles = [];
    const ob = { x: -1100, z: -60, w: 60, d: 42, h: 32 }; obstacles.push(ob);
    place(-1400, -60, 0); st.testCmd = [1, 1]; await run(30, () => st.bump || (Math.abs(st.vl + st.vr) < .5 && st.t > 1 && st.dist !== null && st.dist < P.sonarStop + 5));
    await run(1.5);
    const gap = ob.x - ob.w / 2 - (st.x + 9.5);
    res.push({ prueba: 'P5 · Avance hacia un bulto de café a 3 m', resultado: st.bump ? 'choca' : `se detiene a ${fmt(Math.max(0, gap))} cm`, detalle: 'JSN-SR04T: reduce la velocidad a menos de 150 cm y frena a menos de 60 cm' });
    obstacles = keepObs; await tick();
    onProgress && onProgress('Pérdida del enlace con el operador');
    place(-1500, 60, 0); st.mode = 'test'; st.testCmd = [1, 1]; await run(2); st.mode = 'manual'; st.jy = 1; st.linkCut = true;
    const tl = await run(5, () => !!st.halt); await run(1.2, () => Math.abs(st.vl + st.vr) < 1);
    res.push({ prueba: 'P6 · Corte del enlace LoRa durante la marcha', resultado: st.halt ? `parada a los ${fmt(tl + 0, 2)} s` : 'no se detuvo', detalle: `el vehículo queda en PARADA DE EMERGENCIA hasta que el operador lo rearme (criterio: < 1,5 s)` });
    st.jy = 0; st.linkCut = false; st.halt = null; st.mode = 'test'; await tick();
    for (const nC of [2, 3]) {
      onProgress && onProgress(`Autonomía con ${nC} celdas`);
      S.cells = nC; st.soc = .9; refresh(); place(-1500, 60, 0); st.testCmd = [.6, .6]; await run(3); const ia = st.ibat, vs = (st.vl + st.vr) / 2;
      res.push({ prueba: `P8 · Autonomía al 60 % de PWM con ${nC} celdas (${nC === 2 ? '7,4' : '11,1'} V)`, resultado: `≈ ${Math.round(P.capAh * .85 / ia * 60)} min`, detalle: `${Math.round(ia * 1000)} mA con la electrónica montada · ${fmt(vs)} cm/s · usa el 85 % de ${P.capAh * 1000} mAh` });
      await tick();
    }
  } finally {
    Object.keys(S.on).forEach(k => { S.on[k] = keepOn[k]; }); S.cells = keepCells; S.gnssMode = keepGnss; S.estopPressed = keepEstop;
    custom.length = 0; custom.push(...keepCustom); obstacles = keepObs; loadMission(); Object.assign(st.ms, keepMs);
    Object.assign(st, keep, { vl: 0, vr: 0, quiet: false, testing: false, testCmd: [0, 0], testHold: null, replay: null, halt: null, linkCut: false, jy: 0, jx: 0 }); st.path = keepPath; st.rec = keepRec; st.mode = keep.mode; st.est = null;
    refresh(); Sim.setLoad(st.load); UGV.emit('mode', st.mode); UGV.emit('mission', mission);
  }
  void speed;
  return res;
};

/* ---------- Bucle principal ---------- */
let last = performance.now(), telT = 0, wireT = 0;
const tel = Sim.tel = {};
const up = new T.Vector3();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (UGV.activeTab === 'sim' || UGV.activeTab === 'circ') {
    let r = { v: 0, w: 0 }; const k = st.testing ? 0 : st.simSpeed || 1; for (let i = 0; i < k; i++) r = step(dt);
    const { v, w } = r;
    // el robot sigue el terreno (altura, cabeceo y alabeo)
    const fx = Math.cos(st.yaw), fz = -Math.sin(st.yaw), sx = -fz, sz = fx;
    const y = H(st.x, st.z), pitch = Math.atan2(H(st.x + fx * 7, st.z + fz * 7) - H(st.x - fx * 7, st.z - fz * 7), 14), roll = Math.atan2(H(st.x + sx * 6, st.z + sz * 6) - H(st.x - sx * 6, st.z - sz * 6), 12);
    robot.position.set(st.x, y, st.z); robot.rotation.set(-roll, st.yaw, pitch);
    chassis.updateTrack(chassis.tracks[-1]); chassis.updateTrack(chassis.tracks[1]);
    const lit = st.lights && UGV.isOn('leds') && an && an.net('leds.A') === an.net('esp32.D2');
    if (built.leds) built.leds.g.userData.leds.forEach(m => { m.emissive.set(lit ? 0xfff1c4 : 0x000000); m.emissiveIntensity = lit ? 2.2 : 0; });
    if (!Sim.ledLights && built.leds) Sim.ledLights = [-3, 3].map(z => { const L = new T.SpotLight(0xfff3d6, 0, 220, Math.PI / 6, .55, 1); L.position.set(.6, .55, z); L.target.position.set(60, -6, z * 1.6); built.leds.g.add(L, L.target); return L; });
    if (Sim.ledLights) Sim.ledLights.forEach(L => L.intensity = lit ? 2.5 : 0);
    wireT -= dt; if (wiresOn && wireT <= 0) { wireT = .05; wireMeshes.forEach(o => { const s = o.w.sig; let lv = 0;
      if (s === 'ENA') lv = Math.abs(st.dutyL); else if (s === 'ENB') lv = Math.abs(st.dutyR); else if (s === 'IN1') lv = st.dutyL > 0; else if (s === 'IN2') lv = st.dutyL < 0;
      else if (s === 'IN3') lv = st.dutyR > 0; else if (s === 'IN4') lv = st.dutyR < 0; else if (s === 'LUCES') lv = st.lights; else if (s === 'BOCINA') lv = st.horn;
      else if (s === 'UART') lv = rpiOK() ? .6 : 0; else if (s === 'LORA') lv = loraOK() && !st.linkCut ? .5 : 0; else if (s === 'GNSS') lv = gnssOK() ? .4 : 0;
      o.m.material.emissiveIntensity = +lv * .55; }); }
    up.set(st.x, y, st.z);
    if (view === 'follow') { const back = new T.Vector3(-fx * 60, 34, -fz * 60).add(up); camera.position.lerp(back, .07); camera.lookAt(st.x, y + 6, st.z); }
    else if (view === 'top') { const hgt = drawMode ? 4300 : 520; camera.position.lerp(new T.Vector3(drawMode ? 150 : st.x, hgt, (drawMode ? -150 : st.z) + .01), .1); camera.lookAt(drawMode ? 150 : st.x, 0, drawMode ? -150 : st.z); }
    else if (view === 'robotcam' && groups.cam) { const p = new T.Vector3(1.2, 1.2, 0); groups.cam.localToWorld(p); camera.position.copy(p); camera.lookAt(p.clone().add(new T.Vector3(fx, -.1, fz))); }
    else controls.update();
    sun.position.set(st.x + 120, y + 420, st.z + 90); sun.target.position.set(st.x, y, st.z);
    if (selBox) selBox.update();
    renderer.render(scene, camera); drawOverlay();
    telT -= dt; if (telT <= 0) { telT = .1;
      Object.assign(tel, { v, w, vbat: st.vbat, soc: st.soc, ibat: st.ibat, iL: st.iL, iR: st.iR, dutyL: st.dutyL, dutyR: st.dutyR, dist: st.dist, sonar: sensorOK(an), mode: st.mode, replay: !!st.replay,
        err: st.err, rms: st.errN ? Math.sqrt(st.errAcc / st.errN) : 0, est: st.est, x: st.x, z: st.z, yaw: st.yaw, recT: st.recT, seen: st.seen, warnings: an.warnings,
        okA: driveOK(an, 'A'), okB: driveOK(an, 'B'), lights: st.lights, horn: st.horn, load: st.load, mass: Sim.robotMass() + st.load, sf: st.sf,
        state: opState(), halt: st.halt, gnss: st.gnss, gnssOK: gnssOK(), rpiOK: rpiOK(), loraOK: loraOK(), linkCut: st.linkCut, grade: st.grade, soil: st.soil, ms: st.ms, cells: cells() });
      UGV.emit('telemetry', tel); }
  }
  requestAnimationFrame(loop);
}
function drawOverlay() {
  if (!overlay) return;
  if (view !== 'robotcam') { if (overlay.childElementCount) overlay.innerHTML = ''; return; }
  const r = canvas.getBoundingClientRect(); let html = '';
  if (UGV.isOn('aruco')) markers.forEach(mk => { const p = new T.Vector3(mk.x, .3, mk.z).project(camera); const d = Math.hypot(mk.x - st.x, mk.z - st.z);
    if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && d < 300) { const s = Math.max(18, 1800 / d);
      html += `<div class="det" style="left:${(p.x + 1) / 2 * r.width - s / 2}px;top:${(1 - p.y) / 2 * r.height - s / 2}px;width:${s}px;height:${s}px"><span>ID ${mk.id} · ${Math.round(d)} cm</span></div>`; } });
  overlay.innerHTML = html + '<div class="rec">● CÁMARA · 640×480</div>';
}
})();
