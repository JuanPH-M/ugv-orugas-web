/* Finca colombiana en 3D: lotes de café, plátano, maíz y huerta, caminos de tierra, almacén de la cosecha,
   puesto del robot, casa, árboles, colinas y patio de pruebas. Los puntos y caminos salen de raspberry/finca.json,
   el mismo mapa que usa la Raspberry Pi. Unidades: cm; x = este, z = sur (z = −y del mapa). */
(function () {
'use strict';
const T = THREE, DEG = Math.PI / 180;
const FINCA = UGV.FINCA = JSON.parse(UGV.PI_FILES.find(f => f.name === 'finca.json').text);
const MAPA = UGV.MAPA = UGV.Auto.Mapa(FINCA);
const P = id => ({ x: FINCA.puntos[id].x, z: -FINCA.puntos[id].y });

/* ---------- Distribución ---------- */
const L = UGV.LAYOUT = {
  AREA: { x0: -880, x1: 900, z0: -560, z1: 1150 },                     // cerca de la finca
  LOTS: FINCA.lotes.map(l => ({ name: l.nombre, cultivo: l.cultivo, x0: l.x0, x1: l.x1, z0: -l.y1, z1: -l.y0 })),
  PATHS: FINCA.caminos.map(([a, b]) => ({ a: P(a), b: P(b) })),
  PATH_HALF: 80,                                                         // caminos de 1,6 m
  ALMACEN: { x0: 440, x1: 740, z0: 200, z1: 480, puerta: [285, 375] },  // puerta en la pared oeste
  SHED: { x0: -530, x1: -370, z0: 340, z1: 500 },                       // puesto del robot, abierto hacia el norte
  CASA: { x0: -1200, x1: -960, z0: -40, z1: 200 },
  ZONES: [
    { id: 'firme', name: 'Superficie firme', x0: -720, x1: -460, z0: 680, z1: 1080 },
    { id: 'tierra', name: 'Tierra', x0: -440, x1: -180, z0: 680, z1: 1080 },
    { id: 'arena', name: 'Arena', x0: -160, x1: 100, z0: 680, z1: 1080 }
  ],
  RAMP: { x0: 160, x1: 360, zBase: 1060, len: 240, zEnd: 700, deg: 8 },
  PATIO: { x0: -760, x1: 400, z0: 640, z1: 1120 },
  BENCH: { x: -810, z: 900, y: 82 },
  HILLS: [ // colinas alrededor de la finca y una lomita dentro, lejos de los caminos
    { x: -2300, z: -700, r: 1300, h: 520 }, { x: 2300, z: -200, r: 1250, h: 430 }, { x: 0, z: -2500, r: 1700, h: 760 }, { x: 1700, z: -1700, r: 900, h: 380 },
    { x: -2100, z: 2000, r: 1200, h: 400 }, { x: 2200, z: 1900, r: 1250, h: 460 }, { x: -1900, z: 900, r: 700, h: 220 }, { x: -720, z: 200, r: 150, h: 55 }],
  TREES: [
    { x: -760, z: -820, r: 150, h: 560, k: 'sombra' }, { x: -300, z: -900, r: 170, h: 600, k: 'sombra' }, { x: 260, z: -860, r: 150, h: 540, k: 'sombra' },
    { x: 760, z: -820, r: 160, h: 580, k: 'sombra' }, { x: -300, z: -250, r: 120, h: 520, k: 'guamo' }, { x: -180, z: -110, r: 110, h: 480, k: 'guamo' },
    { x: -760, z: 120, r: 90, h: 820, k: 'guadua' }, { x: -790, z: 560, r: 90, h: 760, k: 'guadua' }, { x: 840, z: 120, r: 130, h: 540, k: 'sombra' },
    { x: 840, z: 560, r: 120, h: 500, k: 'sombra' }, { x: 560, z: 600, r: 120, h: 520, k: 'sombra' }, { x: -1000, z: 380, r: 160, h: 600, k: 'sombra' },
    { x: -1080, z: -320, r: 140, h: 700, k: 'palma' }, { x: 1050, z: 900, r: 150, h: 560, k: 'sombra' }, { x: 1080, z: -650, r: 130, h: 680, k: 'palma' }
  ]
};
L.TANR = Math.tan(L.RAMP.deg * DEG);

/* Marcas de cada lugar de prueba: la finca empieza en el puesto del robot; en el patio, A→B 200 cm al norte y B→C 150 cm al este */
L.marksFor = id => {
  if (id === 'finca') { const p = P(FINCA.inicio); return { A: [p.x, p.z], B: [p.x, p.z], C: [p.x, p.z], yaw: (FINCA.rumbo_inicial ?? 90) * DEG, finca: true }; }
  if (id === 'rampa') { const x = (L.RAMP.x0 + L.RAMP.x1) / 2; return { A: [x, 1110], B: [x, 760], C: [x, 760], yaw: Math.PI / 2 }; }
  const z = L.ZONES.find(q => q.id === id), x = z.x0 + 60; return { A: [x, 1050], B: [x, 850], C: [x + 150, 850], yaw: Math.PI / 2 };
};
const bump = (d, r, h) => d < r ? h * (1 + Math.cos(Math.PI * d / r)) / 2 : 0;
L.H = (x, z) => {
  let h = 0; const R = L.RAMP;
  if (x >= R.x0 - 1 && x <= R.x1 + 1 && z <= R.zBase && z >= R.zEnd - 60) { // solo la rampa del patio (con su bajada al final)
    const d = Math.min(R.len, R.zBase - z), b = 20; h = d < b ? L.TANR * d * d / (2 * b) : L.TANR * (d - b / 2);
    if (z < R.zEnd) h *= (z - (R.zEnd - 60)) / 60; }
  for (const c of L.HILLS) h += bump(Math.hypot(x - c.x, z - c.z), c.r, c.h);
  return h;
};
const inRect = (x, z, r, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
L.inRect = inRect;
const segDist = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(a.x + t * dx - x, a.z + t * dz - z); };
L.pathDist = (x, z) => Math.min(...L.PATHS.map(s => segDist(x, z, s.a, s.b)));
L.lotAt = (x, z, m = 0) => L.LOTS.find(l => inRect(x, z, l, m)) || null;
L.soilAt = (x, z) => {
  const R = L.RAMP; if (z < R.zBase + 20 && z > R.zEnd - 5 && x >= R.x0 && x <= R.x1) return 'tierra';
  for (const q of L.ZONES) if (inRect(x, z, q)) return q.id;
  if (inRect(x, z, L.PATIO) || inRect(x, z, L.SHED) || inRect(x, z, { x0: 300, x1: 440, z0: 270, z1: 390 })) return 'firme';
  if (L.pathDist(x, z) <= L.PATH_HALF) return 'camino';
  return 'pasto';
};
/* Obstáculos fijos (rectángulos): paredes del almacén con su puerta, paredes del puesto, casa */
const A = L.ALMACEN, Sh = L.SHED, wt = 10;
L.WALLS = [
  { x0: A.x0, x1: A.x1, z0: A.z0, z1: A.z0 + wt }, { x0: A.x0, x1: A.x1, z0: A.z1 - wt, z1: A.z1 }, { x0: A.x1 - wt, x1: A.x1, z0: A.z0, z1: A.z1 },
  { x0: A.x0, x1: A.x0 + wt, z0: A.z0, z1: A.puerta[0] }, { x0: A.x0, x1: A.x0 + wt, z0: A.puerta[1], z1: A.z1 },
  { x0: Sh.x0, x1: Sh.x1, z0: Sh.z1 - 8, z1: Sh.z1 }, { x0: Sh.x0, x1: Sh.x0 + 8, z0: Sh.z0, z1: Sh.z1 }, { x0: Sh.x1 - 8, x1: Sh.x1, z0: Sh.z0, z1: Sh.z1 },
  L.CASA
];

/* ---------- Construcción de la escena ---------- */
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const std = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(c).convertSRGBToLinear(), roughness: .85 }, o)); // colores en sRGB como se ven
const box = (w, h, d, m, x, y, z, parent) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b; };
const GROUND = { cx: 0, cz: 0, size: 7000 };

function groundTex() {
  const N = 2048, S = GROUND.size, k = N / S, X = x => (x - GROUND.cx + S / 2) * k, Z = z => (z - GROUND.cz + S / 2) * k;
  return UGV.tex(N, N, g => {
    g.fillStyle = '#6f8f3e'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 60000; i++) { const s = rnd(); g.fillStyle = s < .5 ? `rgba(48,86,26,${rnd() * .3})` : `rgba(170,180,90,${rnd() * .18})`; g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 3, 1 + rnd() * 3); }
    const a = L.AREA; g.fillStyle = 'rgba(120,150,70,.25)'; g.fillRect(X(a.x0), Z(a.z0), (a.x1 - a.x0) * k, (a.z1 - a.z0) * k);
    // lotes: tierra labrada con surcos
    L.LOTS.forEach(l => { g.fillStyle = '#6e4f33'; g.fillRect(X(l.x0 - 15), Z(l.z0 - 15), (l.x1 - l.x0 + 30) * k, (l.z1 - l.z0 + 30) * k);
      g.strokeStyle = 'rgba(40,26,14,.45)'; g.lineWidth = 2; for (let z = l.z0; z <= l.z1; z += 22) { g.beginPath(); g.moveTo(X(l.x0 - 10), Z(z)); g.lineTo(X(l.x1 + 10), Z(z)); g.stroke(); }
      for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(30,20,10,${rnd() * .25})`; g.fillRect(X(l.x0) + rnd() * (l.x1 - l.x0) * k, Z(l.z0) + rnd() * (l.z1 - l.z0) * k, 2, 2); } });
    // caminos de tierra con huellas
    g.lineCap = 'round'; g.lineJoin = 'round';
    const path = (w, col) => { g.strokeStyle = col; g.lineWidth = w * k; L.PATHS.forEach(s => { g.beginPath(); g.moveTo(X(s.a.x), Z(s.a.z)); g.lineTo(X(s.b.x), Z(s.b.z)); g.stroke(); }); };
    path(2 * L.PATH_HALF + 16, '#8f7a52'); path(2 * L.PATH_HALF, '#b59d76');
    g.lineCap = 'butt'; g.strokeStyle = 'rgba(120,96,60,.45)'; g.lineWidth = 3;
    L.PATHS.forEach(s => { const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, n = Math.hypot(dx, dz), ox = -dz / n * 22, oz = dx / n * 22;
      [-1, 1].forEach(sg => { g.beginPath(); g.moveTo(X(s.a.x + sg * ox), Z(s.a.z + sg * oz)); g.lineTo(X(s.b.x + sg * ox), Z(s.b.z + sg * oz)); g.stroke(); }); });
    for (let i = 0; i < 5000; i++) { const s = L.PATHS[i % L.PATHS.length], t = rnd(), x = s.a.x + (s.b.x - s.a.x) * t + (rnd() - .5) * 100, z = s.a.z + (s.b.z - s.a.z) * t + (rnd() - .5) * 100;
      if (L.pathDist(x, z) < L.PATH_HALF) { g.fillStyle = `rgba(90,70,45,${rnd() * .25})`; g.fillRect(X(x), Z(z), 2, 2); } }
    // patio de pruebas, piso del puesto y frente del almacén
    const slab = (q, c) => { g.fillStyle = c; g.fillRect(X(q.x0), Z(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k); };
    slab(L.PATIO, '#a7a39a'); slab(L.SHED, '#9e9a91'); slab({ x0: 300, x1: 440, z0: 270, z1: 390 }, '#9e9a91');
    slab(L.ZONES[0], '#b8b5ad'); slab(L.ZONES[1], '#7a5a3a'); slab(L.ZONES[2], '#d8c08a');
    slab({ x0: L.RAMP.x0, x1: L.RAMP.x1, z0: L.RAMP.zEnd, z1: L.RAMP.zBase }, '#6f5134');
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; L.ZONES.forEach(q => g.strokeRect(X(q.x0), Z(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k));
    ['firme', 'tierra', 'arena', 'rampa'].forEach(id => { const m = L.marksFor(id);
      g.fillStyle = '#f2c230'; g.fillRect(X(m.A[0] - 25), Z(m.A[1]) - 2, 50 * k, 4);
      [['A', m.A], ['B', m.B]].concat(id === 'rampa' ? [] : [['C', m.C]]).forEach(([s, p]) => { g.strokeStyle = '#f2c230'; g.lineWidth = 3; g.beginPath();
        g.moveTo(X(p[0] - 9), Z(p[1] - 9)); g.lineTo(X(p[0] + 9), Z(p[1] + 9)); g.moveTo(X(p[0] + 9), Z(p[1] - 9)); g.lineTo(X(p[0] - 9), Z(p[1] + 9)); g.stroke();
        g.fillStyle = '#1b1d1f'; g.font = `700 ${Math.round(26 * k * 1.4)}px sans-serif`; g.fillText(s, X(p[0] + 12), Z(p[1] - 8)); }); });
  }, { anisotropy: 8 });
}
function signTex(txt, sub, bg = '#1e5b3a') {
  return UGV.tex(512, 192, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2efe2'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#f2efe2'; g.textAlign = 'center'; g.font = '700 62px "Saira Condensed", sans-serif'; g.fillText(txt, w / 2, 90); g.font = '500 30px "IBM Plex Sans", sans-serif'; g.fillText(sub, w / 2, 146); });
}
function zincTex() { return UGV.tex(256, 256, (g, w, h) => { for (let x = 0; x < w; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#9aa3a8'); gr.addColorStop(.5, '#d5dadd'); gr.addColorStop(1, '#8a9398'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(140,90,50,${Math.random() * .25})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }); }
function tejaTex() { return UGV.tex(256, 256, (g, w, h) => { g.fillStyle = '#a5472c'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 18) for (let x = (y / 18 % 2) * 12; x < w; x += 24) { g.fillStyle = `rgba(${120 + Math.random() * 40},${50 + Math.random() * 20},30,.6)`; g.beginPath(); g.ellipse(x, y + 9, 11, 9, 0, 0, Math.PI); g.fill(); } }); }
function sackTex() {
  return UGV.tex(256, 256, (g, w, h) => { g.fillStyle = '#b89a66'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = 'rgba(110,85,45,.25)'; g.fillRect(0, y, w, 1.5); } for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(110,85,45,.2)'; g.fillRect(x, 0, 1.5, h); }
    g.fillStyle = 'rgba(60,90,40,.7)'; g.font = '600 34px sans-serif'; g.textAlign = 'center'; g.fillText('CAFÉ', w / 2, h / 2 + 12); });
}
function flagTex(id, col) { return UGV.tex(128, 80, c => { c.fillStyle = col; c.fillRect(0, 0, 128, 80); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = `700 ${id.length > 2 ? 26 : 46}px "Saira Condensed", sans-serif`; c.fillText(id.length > 2 ? (id === 'ALMACEN' ? 'ALMACÉN' : id) : id, 64, id.length > 2 ? 50 : 58); }); }

function instanced(geo, mat, list, place) {
  const m = new T.InstancedMesh(geo, mat, list.length), d = new T.Object3D();
  list.forEach((it, i) => { d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); place(d, it); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
  m.castShadow = true; m.receiveShadow = true; return m;
}
function grid(l, sx, sz, jitter = .25) { const out = []; for (let z = l.z0 + sz / 2; z < l.z1; z += sz) for (let x = l.x0 + sx / 2; x < l.x1; x += sx) out.push([x + (rnd() - .5) * sx * jitter, z + (rnd() - .5) * sz * jitter * .4]); return out; }

function buildCrops(scene, H) {
  const leaf = std(0x2f6b2a), leaf2 = std(0x3f8a36), trunk = std(0x5a4330, { roughness: .9 });
  for (const l of L.LOTS) {
    if (l.cultivo === 'cafe') { // matas de café con granos rojos
      const pl = grid(l, 45, 55);
      scene.add(instanced(new T.CylinderGeometry(1.6, 2.2, 1, 6), trunk, pl, (d, [x, z]) => { d.position.set(x, H(x, z) + 25, z); d.scale.set(1, 50, 1); }));
      scene.add(instanced(new T.IcosahedronGeometry(1, 1), leaf, pl, (d, [x, z]) => { const k = .8 + rnd() * .35; d.position.set(x, H(x, z) + 58 * k, z); d.scale.set(24 * k, 40 * k, 22 * k); d.rotation.y = rnd() * 6; }));
      scene.add(instanced(new T.IcosahedronGeometry(1, 1), leaf2, pl, (d, [x, z]) => { const k = .8 + rnd() * .35; d.position.set(x + 2, H(x, z) + 88 * k, z - 2); d.scale.set(15 * k, 20 * k, 14 * k); }));
      const cher = []; pl.forEach(([x, z]) => { for (let k = 0; k < 6; k++) cher.push([x, z, rnd() * 6.28, rnd()]); });
      scene.add(instanced(new T.SphereGeometry(1.6, 6, 4), std(0xb3261e, { roughness: .4 }), cher, (d, [x, z, a, h]) => { d.position.set(x + Math.cos(a) * 21, H(x, z) + 40 + h * 45, z + Math.sin(a) * 19); }));
    }
    if (l.cultivo === 'platano') { // matas de plátano: pseudotallo y hojas grandes arqueadas
      const pl = grid(l, 70, 75, .3), hs = pl.map(() => 150 + rnd() * 60);
      scene.add(instanced(new T.CylinderGeometry(5, 8, 1, 10), std(0x6b7d3a), pl, (d, [x, z], i) => { d.position.set(x, H(x, z) + hs[i] / 2, z); d.scale.set(1, hs[i], 1); }));
      const lv = []; pl.forEach(([x, z], i) => { for (let k = 0; k < 6; k++) lv.push([x, z, hs[i], k * 60 * DEG + rnd() * .4]); });
      const lg = new T.PlaneGeometry(95, 30, 4, 1); lg.translate(47, 0, 0); const pos = lg.attributes.position; for (let i = 0; i < pos.count; i++) { const t = pos.getX(i) / 95; pos.setZ(i, -t * t * 40); } lg.computeVertexNormals();
      scene.add(instanced(lg, std(0x4f9a35, { side: T.DoubleSide }), lv, (d, [x, z, h, a]) => { d.position.set(x, H(x, z) + h - 5, z); d.rotation.order = 'YXZ'; d.rotation.set(.35, a, 0); }));
      const bunch = pl.filter(() => rnd() < .35);
      scene.add(instanced(new T.CylinderGeometry(7, 4, 30, 8), std(0x9ab83a), bunch, (d, [x, z]) => { d.position.set(x + 9, H(x, z) + 120, z); d.rotation.z = .2; }));
    }
    if (l.cultivo === 'maiz') { // maizal: cañas altas, hojas finas, espigas y mazorcas
      const pl = grid(l, 28, 45, .3), hs = pl.map(() => 160 + rnd() * 45);
      scene.add(instanced(new T.CylinderGeometry(1.4, 1.9, 1, 6), std(0x7d9a3a), pl, (d, [x, z], i) => { d.position.set(x, H(x, z) + hs[i] / 2, z); d.scale.set(1, hs[i], 1); }));
      const lv = []; pl.forEach(([x, z], i) => { for (let k = 0; k < 5; k++) lv.push([x, z, hs[i] * (.3 + k * .13), rnd() * 6.28]); });
      const lg = new T.PlaneGeometry(55, 6, 3, 1); lg.translate(27, 0, 0); const ps = lg.attributes.position; for (let i = 0; i < ps.count; i++) { const t = ps.getX(i) / 55; ps.setZ(i, -t * t * 22); } lg.computeVertexNormals();
      scene.add(instanced(lg, std(0x6f9a32, { side: T.DoubleSide }), lv, (d, [x, z, h, a]) => { d.position.set(x, H(x, z) + h, z); d.rotation.order = 'YXZ'; d.rotation.set(-.9, a, 0); }));
      scene.add(instanced(new T.ConeGeometry(4, 22, 6), std(0xd8c27a), pl, (d, [x, z], i) => { d.position.set(x, H(x, z) + hs[i] + 9, z); }));
      scene.add(instanced(new T.CylinderGeometry(2.6, 2, 16, 8), std(0xe0c25a), pl, (d, [x, z], i) => { d.position.set(x + 3, H(x, z) + hs[i] * .55, z); d.rotation.z = .4; }));
    }
    if (l.cultivo === 'huerta') { // yuca al oeste y fríjol con tutores al este
      const mid = (l.x0 + l.x1) / 2, yuca = grid({ x0: l.x0, x1: mid - 20, z0: l.z0, z1: l.z1 }, 60, 60), frijol = grid({ x0: mid + 20, x1: l.x1, z0: l.z0, z1: l.z1 }, 30, 45, .2);
      scene.add(instanced(new T.CylinderGeometry(1.5, 2.5, 1, 6), std(0x7a5a3c), yuca, (d, [x, z]) => { d.position.set(x, H(x, z) + 55, z); d.scale.set(1, 110, 1); }));
      scene.add(instanced(new T.IcosahedronGeometry(1, 0), std(0x4b8c3a), yuca, (d, [x, z]) => { d.position.set(x, H(x, z) + 118, z); d.scale.set(32, 16, 32); d.rotation.y = rnd() * 6; }));
      scene.add(instanced(new T.IcosahedronGeometry(1, 1), std(0x5a9c3c), frijol, (d, [x, z]) => { d.position.set(x, H(x, z) + 18, z); d.scale.set(13, 16, 12); }));
      scene.add(instanced(new T.CylinderGeometry(.8, .8, 75, 5), std(0x9a7b55), frijol, (d, [x, z]) => { d.position.set(x + 6, H(x, z) + 37, z); }));
    }
  }
}

function buildTrees(scene, H) {
  const bark = std(0x5b4632, { roughness: .95 }), crown = [std(0x3d6b2c), std(0x4f7d35), std(0x2f5d28)], guadua = std(0x8a9a3e, { roughness: .6 }), palm = std(0x6a5a44);
  L.TREES.forEach(t => { const y = H(t.x, t.z), g = new T.Group(); g.position.set(t.x, y, t.z); scene.add(g);
    if (t.k === 'guadua') { for (let i = 0; i < 9; i++) { const a = rnd() * 6.28, r = rnd() * 30, c = new T.Mesh(new T.CylinderGeometry(4, 5, t.h, 8), guadua); c.position.set(Math.cos(a) * r, t.h / 2, Math.sin(a) * r); c.rotation.set((rnd() - .5) * .25, 0, (rnd() - .5) * .25); c.castShadow = true; g.add(c);
      const f = new T.Mesh(new T.IcosahedronGeometry(60, 0), crown[1]); f.position.set(c.position.x * 2, t.h * .9, c.position.z * 2); f.scale.y = .5; f.castShadow = true; g.add(f); } return; }
    if (t.k === 'palma') { const c = new T.Mesh(new T.CylinderGeometry(9, 13, t.h, 10), palm); c.position.y = t.h / 2; c.castShadow = true; g.add(c);
      for (let i = 0; i < 8; i++) { const fr = new T.Mesh(new T.PlaneGeometry(180, 34), std(0x4a7d2c, { side: T.DoubleSide })); fr.geometry.translate(90, 0, 0); fr.position.y = t.h; fr.rotation.order = 'YXZ'; fr.rotation.set(-1.2, i * 45 * DEG, .35); fr.castShadow = true; g.add(fr); } return; }
    const tr = new T.Mesh(new T.CylinderGeometry(13, 20, t.h * .6, 10), bark); tr.position.y = t.h * .3; tr.castShadow = true; g.add(tr);
    for (let k = 0; k < 6; k++) { const c = new T.Mesh(new T.IcosahedronGeometry(t.r * (.45 + rnd() * .25), 1), crown[k % 3]); c.position.set((rnd() - .5) * t.r, t.h * .62 + rnd() * t.h * .3, (rnd() - .5) * t.r); c.scale.y = .62; c.castShadow = true; g.add(c); } });
  // árboles en las colinas
  for (let i = 0; i < 90; i++) { const c = L.HILLS[i % (L.HILLS.length - 1)], a = rnd() * 6.28, r = rnd() * c.r * .8, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (inRect(x, z, L.AREA, 150)) continue; const y = H(x, z), s = .6 + rnd() * .6;
    const tr = new T.Mesh(new T.CylinderGeometry(10 * s, 15 * s, 300 * s, 8), bark); tr.position.set(x, y + 150 * s, z); scene.add(tr);
    const cr = new T.Mesh(new T.IcosahedronGeometry(110 * s, 1), crown[i % 3]); cr.position.set(x, y + 330 * s, z); cr.scale.y = .7; cr.castShadow = true; scene.add(cr); }
}

function buildBuildings(scene, H) {
  const wall = std(0xece6d6, { roughness: .9 }), wood = std(0x8a5a32), zinc = std(0xffffff, { map: zincTex(), roughness: .5, metalness: .5 }), conc = std(0x9e9a91);
  // almacén de la cosecha: muros de bloque, techo de zinc a dos aguas, puerta al oeste
  const A = L.ALMACEN, cx = (A.x0 + A.x1) / 2, cz = (A.z0 + A.z1) / 2, hw = 230, g = new T.Group(); scene.add(g);
  L.WALLS.slice(0, 5).forEach(w => box(w.x1 - w.x0, hw, w.z1 - w.z0, wall, (w.x0 + w.x1) / 2, hw / 2, (w.z0 + w.z1) / 2, g));
  box(10, 40, A.puerta[1] - A.puerta[0], wall, A.x0 + 5, hw - 20, (A.puerta[0] + A.puerta[1]) / 2, g);
  box(A.x1 - A.x0 - 20, 2, A.z1 - A.z0 - 20, conc, cx, 1, cz, g);
  const roofW = (A.z1 - A.z0) / 2 + 40, ang = .32;
  [-1, 1].forEach(s => { const r = box(A.x1 - A.x0 + 60, 3, roofW / Math.cos(ang), zinc, cx, hw + Math.tan(ang) * roofW / 2 + 4, cz + s * roofW / 2, g); r.rotation.x = s * ang; });
  const sign = new T.Mesh(new T.PlaneGeometry(170, 64), std(0xffffff, { map: signTex('ALMACÉN', 'recibo de la cosecha', '#7a2e1e'), roughness: .7 })); sign.position.set(A.x0 - 1, hw - 50, A.puerta[0] - 70); sign.rotation.y = -Math.PI / 2; g.add(sign);
  // cosecha guardada: bultos de café, racimos y canastas
  const sackM = std(0xffffff, { map: sackTex(), roughness: .95 });
  for (let i = 0; i < 14; i++) { const s = new T.Mesh(new T.CapsuleGeometry ? new T.CapsuleGeometry(16, 34, 6, 12) : new T.CylinderGeometry(16, 16, 64, 12), sackM); s.rotation.z = Math.PI / 2; s.scale.set(1, 1, 1.3);
    s.position.set(A.x1 - 50 - (i % 4) * 46, 18 + Math.floor(i / 8) * 32, A.z0 + 50 + Math.floor((i % 8) / 4) * 50); s.castShadow = true; g.add(s); }
  for (let i = 0; i < 6; i++) { box(50, 30, 40, wood, A.x0 + 70 + (i % 3) * 60, 15, A.z1 - 50 - Math.floor(i / 3) * 50, g);
    const b = new T.Mesh(new T.CylinderGeometry(12, 7, 34, 8), std(0x9ab83a)); b.position.set(A.x0 + 70 + (i % 3) * 60, 42, A.z1 - 50 - Math.floor(i / 3) * 50); b.castShadow = true; g.add(b); }
  box(80, 6, 80, std(0x8f969c, { metalness: .6, roughness: .4 }), A.x0 + 80, 3, cz - 20, g); // báscula
  // puesto del robot: piso de concreto, techo inclinado, cargador y letrero
  const Sh = L.SHED, sg = new T.Group(); scene.add(sg); const scx = (Sh.x0 + Sh.x1) / 2, scz = (Sh.z0 + Sh.z1) / 2;
  L.WALLS.slice(5, 8).forEach(w => box(w.x1 - w.x0, 120, w.z1 - w.z0, wood, (w.x0 + w.x1) / 2, 60, (w.z0 + w.z1) / 2, sg));
  const roof = box(Sh.x1 - Sh.x0 + 40, 3, Sh.z1 - Sh.z0 + 40, zinc, scx, 132, scz, sg); roof.rotation.x = -.12;
  box(Sh.x1 - Sh.x0 - 16, 3, Sh.z1 - Sh.z0 - 8, conc, scx, 1.5, scz, sg);
  box(26, 34, 12, std(0x2a2f33), scx, 40, Sh.z1 - 16, sg); box(4, 4, 1, std(0x1f9a6c, { emissive: 0x1f9a6c, emissiveIntensity: 1.5 }), scx + 8, 50, Sh.z1 - 23, sg); // cargador
  const ps = new T.Mesh(new T.PlaneGeometry(120, 45), std(0xffffff, { map: signTex('PUESTO', 'robot de orugas'), roughness: .7 })); ps.position.set(scx, 108, Sh.z1 - 9); ps.rotation.y = Math.PI; sg.add(ps);
  // casa de la finca: muros blancos, zócalo y puertas de colores, techo de teja, corredor
  const C = L.CASA, hcx = (C.x0 + C.x1) / 2, hcz = (C.z0 + C.z1) / 2, cg = new T.Group(); scene.add(cg); const hy = H(hcx, hcz);
  cg.position.y = hy; box(C.x1 - C.x0, 260, C.z1 - C.z0, wall, hcx, 130, hcz, cg);
  box(C.x1 - C.x0 + 2, 50, C.z1 - C.z0 + 2, std(0x2f7d6b), hcx, 25, hcz, cg);
  [[-50, 0x1f6fb5], [50, 0xd9472f]].forEach(([dz, c]) => box(4, 170, 70, std(c), C.x1 + 1, 85, hcz + dz, cg));
  const teja = std(0xffffff, { map: tejaTex(), roughness: .8 }); [-1, 1].forEach(s => { const r = box(C.x1 - C.x0 + 120, 6, (C.z1 - C.z0) / 2 + 80, teja, hcx + 40, 300, hcz + s * ((C.z1 - C.z0) / 4 + 30), cg); r.rotation.x = s * .38; });
  [-90, 0, 90].forEach(dz => box(10, 260, 10, wood, C.x1 + 100, 130, hcz + dz, cg));
  // cerca de alambre alrededor de la finca
  const a = L.AREA, posts = []; for (let x = a.x0; x <= a.x1; x += 150) posts.push([x, a.z0], [x, a.z1]); for (let z = a.z0 + 150; z < a.z1; z += 150) posts.push([a.x0, z], [a.x1, z]);
  scene.add(instanced(new T.CylinderGeometry(4, 5, 120, 6), wood, posts, (d, [x, z]) => d.position.set(x, H(x, z) + 60, z)));
  const wire = new T.LineBasicMaterial({ color: 0x55585a }); [70, 105].forEach(h => { const pts = [[a.x0, a.z0], [a.x1, a.z0], [a.x1, a.z1], [a.x0, a.z1], [a.x0, a.z0]].map(([x, z]) => new T.Vector3(x, H(x, z) + h, z)); scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), wire)); });
  // letreros de los lotes
  L.LOTS.forEach(l => { const x = l.x0 + 60, z = l.z1 - 4, s = new T.Mesh(new T.PlaneGeometry(110, 40), std(0xffffff, { map: signTex(l.name.split(' ')[0].toUpperCase(), l.name.includes('(') ? l.name.split('(')[1].replace(')', '') : 'lote de la finca'), roughness: .7 }));
    s.position.set(x, 75, z + 1); s.rotation.y = 0; scene.add(s); box(4, 60, 4, wood, x, 30, z, scene); });
  // banderas en los puntos del mapa (los cruces llevan solo una estaca)
  Object.entries(FINCA.puntos).forEach(([id, p]) => { const x = p.x, z = -p.y, y = H(x, z);
    if (p.tipo === 'cruce') { box(3, 30, 3, wood, x + 55, y + 15, z + 55, scene); return; }
    const col = p.tipo === 'puesto' ? '#1f9a6c' : p.tipo === 'almacen' ? '#c8261d' : '#e39b12';
    box(2.6, 90, 2.6, std(0xf2efe2), x + 48, y + 45, z + 48, scene);
    const f = new T.Mesh(new T.PlaneGeometry(34, 21), std(0xffffff, { map: flagTex(id, col), side: T.DoubleSide })); f.position.set(x + 66, y + 78, z + 48); scene.add(f);
    const ring = new T.Mesh(new T.RingGeometry(20, 24, 32), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: .75, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + .6, z); scene.add(ring); });
  // patio de pruebas: letreros, costados de la rampa y mesa del banco
  [['FIRME', 'superficie de prueba', L.ZONES[0]], ['TIERRA', 'nivelada y compactada', L.ZONES[1]], ['ARENA', 'seca y suelta', L.ZONES[2]]].forEach(([a1, b1, q]) => {
    const m = new T.Mesh(new T.PlaneGeometry(110, 40), std(0xffffff, { map: signTex(a1, b1), roughness: .7 })); m.position.set((q.x0 + q.x1) / 2, 60, q.z1 + 25); m.rotation.y = Math.PI; scene.add(m); });
  const R = L.RAMP, earth = std(0x6b4d31, { roughness: 1, side: T.DoubleSide });
  [R.x0, R.x1].forEach(x => { const s = new T.Shape(); s.moveTo(0, 0); s.lineTo(R.len, R.len * L.TANR); s.lineTo(R.zBase - R.zEnd, R.len * L.TANR); s.lineTo(R.zBase - R.zEnd, 0); s.lineTo(0, 0);
    const m = new T.Mesh(new T.ShapeGeometry(s), earth); m.rotation.y = Math.PI / 2; m.position.set(x, 0, R.zBase); m.receiveShadow = true; scene.add(m); });
  const rs = new T.Mesh(new T.PlaneGeometry(110, 40), std(0xffffff, { map: signTex('RAMPA', `tierra · ${R.deg}° (ejemplo)`), roughness: .7 })); rs.position.set(R.x1 + 30, 60, R.zBase - 40); rs.rotation.y = -Math.PI / 2; scene.add(rs);
  const B = L.BENCH, bench = new T.Group(); bench.position.set(B.x, 0, B.z); scene.add(bench);
  box(70, 4, 50, wood, 0, 75, 0, bench); [[-31, -21], [31, -21], [-31, 21], [31, 21]].forEach(([x, z]) => box(4, 73, 4, std(0x8f969c, { metalness: .6 }), x, 36.5, z, bench)); box(10, 5, 8, std(0x2b2b2b), 0, 79.5, 0, bench);
}

UGV.Finca3D = {
  GROUND,
  build(scene) {
    seed = 12345;
    const geo = new T.PlaneGeometry(GROUND.size, GROUND.size, 280, 280); geo.rotateX(-Math.PI / 2); geo.translate(GROUND.cx, 0, GROUND.cz);
    const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, L.H(pos.getX(i), pos.getZ(i))); geo.computeVertexNormals();
    const ground = new T.Mesh(geo, new T.MeshStandardMaterial({ map: groundTex(), roughness: .95, metalness: 0, envMapIntensity: .15 })); ground.receiveShadow = true; scene.add(ground);
    const out = new T.Mesh(new T.PlaneGeometry(30000, 30000), std(0x6f8c40, { roughness: 1 })); out.rotation.x = -Math.PI / 2; out.position.y = -2; scene.add(out);
    buildCrops(scene, L.H); buildTrees(scene, L.H); buildBuildings(scene, L.H);
    return ground;
  }
};
})();
