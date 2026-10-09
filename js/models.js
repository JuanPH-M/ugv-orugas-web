/* Modelos 3D de las piezas. Unidades: cm. Cada pieza tiene su origen en el centro de su base. */
(function () {
'use strict';
const T = THREE;

/* ---------- Medidas del chasis ---------- */
const G = UGV.GEOM = {
  TRACK_Z: 6.25, TRACK_W: 4.4, TX: 6.0, YC: 3.17, BR: 2.75, WR: 2.64, PLATE_Y: 5.5,
  PLATE_L: 13.4, PLATE_W: 7.8, MOTOR_Z: 1.75
};
G.WB = 2 * G.TRACK_Z;
G.LSTR = 2 * G.TX;
G.LTOT = 2 * G.LSTR + 2 * Math.PI * G.BR;

/* ---------- Texturas dibujadas ---------- */
function tex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new T.CanvasTexture(c);
  t.encoding = T.sRGBEncoding; t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  return t;
}
UGV.tex = tex;
const FONT = '"IBM Plex Mono", "Consolas", monospace';
function silk(g, txt, x, y, size, color = '#f4f4ef', align = 'center', rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = color;
  g.font = `600 ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(txt, 0, 0); g.restore();
}

/* ---------- Materiales ---------- */
const std = (color, o = {}) => new T.MeshStandardMaterial(Object.assign({ color, roughness: .55, metalness: 0 }, o));
const M = UGV.MAT = {
  alu: std(0x1e2124, { roughness: .62, metalness: .55 }),
  plasticDark: std(0x0d0e0f, { roughness: .82, envMapIntensity: .3 }),
  plasticGray: std(0x6c7177, { roughness: .7 }),
  track: std(0x0b0c0d, { roughness: .62, envMapIntensity: .35 }),
  wheel: std(0x464b52, { roughness: .62, envMapIntensity: .35 }),
  wheelDark: std(0x2f3237, { roughness: .6 }),
  wheelLight: std(0x5a5f66, { roughness: .6, envMapIntensity: .35 }),
  plasticLight: std(0x8f949a, { roughness: .6 }),
  steel: std(0xc7cbd0, { roughness: .28, metalness: .95 }),
  steelDark: std(0x8d9298, { roughness: .35, metalness: .9 }),
  brass: std(0xc9a24a, { roughness: .3, metalness: 1 }),
  gold: std(0xd8b04a, { roughness: .25, metalness: 1 }),
  copper: std(0xb86a3c, { roughness: .35, metalness: .9 }),
  black: std(0x0e0f10, { roughness: .5 }),
  blackGloss: std(0x0b0b0c, { roughness: .22 }),
  blueTerm: std(0x1c62c9, { roughness: .45 }),
  white: std(0xeeeeea, { roughness: .6 }),
  red: std(0xb52018, { roughness: .5 }),
  rubberRed: std(0xc0261d, { roughness: .6 }),
  wireBlack: std(0x161616, { roughness: .6 }),
  cardboard: std(0xf1efe8, { roughness: .95 }),
  glass: new T.MeshPhysicalMaterial({ color: 0x223040, roughness: .05, metalness: 0, clearcoat: 1 }),
  ledOff: new T.MeshPhysicalMaterial({ color: 0xf6f3e6, roughness: .15, transmission: .25, thickness: .3, emissive: 0x000000 })
};

/* ---------- Ayudas de geometría ---------- */
function mesh(geo, mat, p, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; if (p) p.add(m); return m;
}
const bx = (w, h, d, mat, p, x, y, z) => mesh(new T.BoxGeometry(w, h, d), mat, p, x, y, z);
function cy(r, h, mat, p, x, y, z, axis = 'y', seg = 24, r2) {
  const m = mesh(new T.CylinderGeometry(r, r2 === undefined ? r : r2, h, seg), mat, p, x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2; if (axis === 'z') m.rotation.x = Math.PI / 2; return m;
}
function rbox(w, h, d, r, mat, p, x, y, z) { // caja con cantos redondeados
  const s = new T.Shape(); const hw = w / 2 - r, hd = d / 2 - r;
  s.moveTo(-hw, -d / 2); s.lineTo(hw, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -hd); s.lineTo(w / 2, hd);
  s.quadraticCurveTo(w / 2, d / 2, hw, d / 2); s.lineTo(-hw, d / 2); s.quadraticCurveTo(-w / 2, d / 2, -w / 2, hd);
  s.lineTo(-w / 2, -hd); s.quadraticCurveTo(-w / 2, -d / 2, -hw, -d / 2);
  const g = new T.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); const m = mesh(g, mat, p, x, y, z); return m;
}
/* PCB con textura de serigrafía en la cara superior */
function pcb(w, d, t, base, topTex, p, y = 0) {
  const side = std(base, { roughness: .6 });
  const top = std(0xffffff, { map: topTex, roughness: .55 });
  const m = mesh(new T.BoxGeometry(w, t, d), [side, side, top, side, side, side], p, 0, y + t / 2, 0);
  return m;
}
function screwHead(p, x, y, z, r = .22, axis = 'y') {
  const g = new T.Group(); g.position.set(x, y, z); p.add(g);
  cy(r, .12, M.steel, g, 0, 0, 0, 'y', 18); bx(r * 1.7, .05, r * .3, M.steelDark, g, 0, .07, 0);
  if (axis === 'x') g.rotation.z = -Math.PI / 2; if (axis === 'z') g.rotation.x = Math.PI / 2; if (axis === '-z') g.rotation.x = -Math.PI / 2;
  return g;
}
function headerRow(p, n, x0, z, y, pitch = .254, dir = 'x', h = .85) {
  const base = dir === 'x' ? bx(n * pitch, .25, pitch, M.black, p, x0 + (n - 1) * pitch / 2, y + .125, z)
    : bx(pitch, .25, n * pitch, M.black, p, x0, y + .125, z + (n - 1) * pitch / 2);
  const pins = new T.InstancedMesh(new T.BoxGeometry(.064, h, .064), M.gold, n);
  const d = new T.Object3D();
  for (let i = 0; i < n; i++) { d.position.set(dir === 'x' ? x0 + i * pitch : x0, y + h / 2 - .05, dir === 'x' ? z : z + i * pitch); d.updateMatrix(); pins.setMatrixAt(i, d.matrix); }
  p.add(pins); return base;
}
function terminal(p, n, x, y, z, rotY = 0) { // bornera azul de tornillo, paso 5 mm
  const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = rotY; p.add(g);
  bx(.8, .85, n * .5, M.blueTerm, g, 0, .425, 0);
  for (let i = 0; i < n; i++) {
    const zz = (i - (n - 1) / 2) * .5;
    cy(.17, .06, M.steel, g, -.05, .87, zz, 'y', 16); bx(.3, .03, .05, M.steelDark, g, -.05, .9, zz);
    bx(.06, .3, .3, M.black, g, .41, .35, zz);
  }
  return g;
}
function elco(p, x, y, z, r = .4, h = 1.0, label = '220µF 35V') { // capacitor electrolítico
  const sleeve = tex(256, 64, (g, w, hh) => { g.fillStyle = '#16181b'; g.fillRect(0, 0, w, hh); g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, 34, hh);
    silk(g, label, 150, 32, 22, '#d9dbe0'); });
  cy(r, h, std(0xffffff, { map: sleeve, roughness: .35 }), p, x, y + h / 2, z, 'y', 28);
  const top = tex(64, 64, (g) => { g.fillStyle = '#b9bdc2'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#6d7277'; g.lineWidth = 4; g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 58); g.moveTo(6, 32); g.lineTo(58, 32); g.stroke(); });
  const cap = cy(r * .96, .02, std(0xffffff, { map: top, metalness: .6, roughness: .3 }), p, x, y + h + .01, z, 'y', 28);
  return cap;
}
function smd(p, x, y, z, w = .2, d = .1, col = 0x2b2b2b) { return bx(w, .06, d, std(col, { roughness: .5 }), p, x, y + .03, z); }
function chip(p, w, d, h, x, y, z, label, col = '#141516', size = 18) {
  const t = tex(128, 128, (g) => { g.fillStyle = col; g.fillRect(0, 0, 128, 128); if (label) label.split('\n').forEach((l, i, a) => silk(g, l, 64, 64 + (i - (a.length - 1) / 2) * size * 1.2, size, '#8e9399')); });
  const s = std(0x141516, { roughness: .45 });
  return mesh(new T.BoxGeometry(w, h, d), [s, s, std(0xffffff, { map: t, roughness: .45 }), s, s, s], p, x, y + h / 2, z);
}

/* ===================== ORUGAS Y CHASIS ===================== */
function trackPt(s) {
  const { TX, YC, BR, LSTR, LTOT } = G;
  s = ((s % LTOT) + LTOT) % LTOT;
  if (s < LSTR) return [TX - s, YC - BR, Math.PI];
  s -= LSTR; const half = Math.PI * BR;
  if (s < half) { const a = -Math.PI / 2 - s / BR; return [-TX + BR * Math.cos(a), YC + BR * Math.sin(a), a - Math.PI / 2]; }
  s -= half;
  if (s < LSTR) return [-TX + s, YC + BR, 0];
  s -= LSTR; const a = Math.PI / 2 - s / BR; return [TX + BR * Math.cos(a), YC + BR * Math.sin(a), a - Math.PI / 2];
}
UGV.trackPt = trackPt;

/* Une varias geometrías en una sola (para instanciar un eslabón completo) */
function mergeGeos(list) {
  let pos = [], nor = [];
  list.forEach(g => { const n = g.index ? g.toNonIndexed() : g; pos.push(n.attributes.position.array); nor.push(n.attributes.normal.array); });
  const cat = arrs => { const L = arrs.reduce((s, a) => s + a.length, 0), out = new Float32Array(L); let o = 0; arrs.forEach(a => { out.set(a, o); o += a.length; }); return out; };
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(cat(pos), 3)); g.setAttribute('normal', new T.BufferAttribute(cat(nor), 3)); return g;
}
function linkGeometry() {
  const W = G.TRACK_W, parts = [];
  const add = (geo, x, y, z, ry = 0) => { geo.rotateY(ry); geo.translate(x, y, z); parts.push(geo); };
  // placa base del eslabón con bisel
  const base = new T.Shape(); base.moveTo(-.44, -.11); base.lineTo(.44, -.11); base.lineTo(.47, .02); base.lineTo(.42, .11); base.lineTo(-.42, .11); base.lineTo(-.47, .02); base.closePath();
  const bg = new T.ExtrudeGeometry(base, { depth: W - .2, bevelEnabled: true, bevelThickness: .05, bevelSize: .04, bevelSegments: 1 }); bg.translate(0, 0, -(W - .2) / 2); parts.push(bg);
  // tacos en V (tres secciones) como los de la foto
  const cleat = () => { const c = new T.Shape(); c.moveTo(-.16, 0); c.lineTo(.16, 0); c.lineTo(.09, .31); c.lineTo(-.09, .31); c.closePath(); return new T.ExtrudeGeometry(c, { depth: 1.0, bevelEnabled: false }); };
  [[-1.35, .32], [0, -.32], [1.35, .32]].forEach(([z, r]) => { const g = cleat(); g.translate(0, 0, -.5); add(g, 0, .11, z, r); });
  // salientes laterales (las "puntas" que se ven de lado)
  [-1, 1].forEach(sd => add(new T.BoxGeometry(.28, .26, .3), 0, .1, sd * (W / 2 + .05)));
  // diente guía interior (engrana con la rueda dentada)
  add(new T.BoxGeometry(.34, .34, .7), 0, -.27, 0);
  return mergeGeos(parts);
}
function sprocketGeometry() {
  const s = new T.Shape(), n = 22, ro = G.WR + .42, ri = G.WR - .02;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + .28) / n * Math.PI * 2, a2 = (i + .5) / n * Math.PI * 2, a3 = (i + .72) / n * Math.PI * 2;
    const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    if (i === 0) s.moveTo(...P(ri, a0)); else s.lineTo(...P(ri, a0));
    s.lineTo(...P(ri, a1)); s.lineTo(...P(ro, a2 - .04)); s.lineTo(...P(ro, a2 + .04)); s.lineTo(...P(ri, a3));
  }
  s.closePath();
  for (let i = 0; i < 12; i++) { // ventanas de los rayos
    const a = i / 12 * Math.PI * 2, h = new T.Path(), r1 = 1.05, r2 = 2.05, da = .17;
    h.moveTo(r1 * Math.cos(a - da * .7), r1 * Math.sin(a - da * .7)); h.lineTo(r2 * Math.cos(a - da), r2 * Math.sin(a - da));
    h.absarc(0, 0, r2, a - da, a + da, false); h.lineTo(r1 * Math.cos(a + da * .7), r1 * Math.sin(a + da * .7));
    h.absarc(0, 0, r1, a + da * .7, a - da * .7, true); s.holes.push(h);
  }
  const hole = new T.Path(); hole.absarc(0, 0, .45, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new T.ExtrudeGeometry(s, { depth: 1.1, bevelEnabled: true, bevelThickness: .06, bevelSize: .05, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -.55); return g;
}
function idlerGeometry() {
  const R = G.WR, pts = [[.5, -.8], [R - .25, -.8], [R, -.72], [R, .72], [R - .25, .8], [1.25, .8], [1.25, .55], [1.05, .55], [1.05, .65], [.5, .65]]
    .map(([x, y]) => new T.Vector2(x, y));
  const g = new T.LatheGeometry(pts, 48); g.rotateX(Math.PI / 2); return g;
}
function plateGeometry() {
  const L = G.PLATE_L, W = G.PLATE_W, s = new T.Shape();
  s.moveTo(-L / 2, -W / 2); s.lineTo(L / 2, -W / 2); s.lineTo(L / 2, W / 2); s.lineTo(-L / 2, W / 2); s.closePath();
  const slot = (x, z, l, w, vert) => { const h = new T.Path(), r = w / 2;
    if (!vert) { h.absarc(x - l / 2 + r, z, r, Math.PI / 2, Math.PI * 1.5, false); h.absarc(x + l / 2 - r, z, r, -Math.PI / 2, Math.PI / 2, false); }
    else { h.absarc(x, z - l / 2 + r, r, Math.PI, 0, false); h.absarc(x, z + l / 2 - r, r, 0, Math.PI, false); }
    h.closePath(); s.holes.push(h); };
  const hole = (x, z, r) => { const h = new T.Path(); h.absarc(x, z, r, 0, Math.PI * 2, true); s.holes.push(h); };
  slot(-4.6, -2.9, 3.4, .5); slot(-4.6, 2.9, 3.4, .5); slot(4.6, -2.9, 3.4, .5); slot(4.6, 2.9, 3.4, .5);
  slot(-.2, -3.3, 2.0, .45, true); slot(-.2, 3.3, 2.0, .45, true);
  [[-2.4, 0], [2.4, 0], [0, -1.6], [0, 1.6], [-1.2, 0], [1.2, 0], [3.6, -1.2], [3.6, 1.2], [-3.6, -1.2], [-3.6, 1.2]].forEach(([x, z]) => hole(x, z, .2));
  hole(0, 0, .55);
  const g = new T.ExtrudeGeometry(s, { depth: .2, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2); g.translate(0, .2, 0); return g;
}

UGV.buildChassis = function () {
  const root = new T.Group();
  const plate = mesh(plateGeometry(), M.alu, root, 0, G.PLATE_Y - .2, 0);
  [-1, 1].forEach(s => { // pestañas dobladas
    bx(G.PLATE_L, 2.4, .2, M.alu, root, 0, G.PLATE_Y - 1.3, s * (G.PLATE_W / 2 - .1));
  });
  // soportes de los motores y de las ruedas locas
  [[G.TX, -1], [-G.TX, 1]].forEach(([x, s]) => { bx(3.8, 3.4, .22, M.alu, root, x, G.YC + .85, s * 3.98); });
  [[-G.TX, -1], [G.TX, 1]].forEach(([x, s]) => { bx(1.8, 3.2, .22, M.alu, root, x, G.YC + .9, s * 3.98); screwHead(root, x, G.YC, s * 4.12, .25, s < 0 ? '-z' : 'z'); cy(.28, .5, M.steel, root, x, G.YC, s * 4.0, 'z', 6); });

  const link = linkGeometry(), spr = sprocketGeometry(), idl = idlerGeometry();
  const tracks = {};
  [-1, 1].forEach(side => {
    const zc = side * G.TRACK_Z, N = 40;
    const inst = new T.InstancedMesh(link, M.track, N); inst.castShadow = true; inst.receiveShadow = true; root.add(inst);
    const sprX = side < 0 ? G.TX : -G.TX, idlX = -sprX;
    const sg = new T.Group(); sg.position.set(sprX, G.YC, zc); root.add(sg);
    mesh(spr, M.wheel, sg); cy(.95, 1.5, M.wheel, sg, 0, 0, 0, 'z', 24); cy(.62, 1.6, M.wheelDark, sg, 0, 0, 0, 'z', 20);
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; cy(.06, 1.2, M.wheelDark, sg, Math.cos(a) * 2.25, Math.sin(a) * 2.25, 0, 'z', 6); }
    cy(.3, 1.9, M.steel, sg, 0, 0, -side * .2, 'z', 12);
    const ig = new T.Group(); ig.position.set(idlX, G.YC, zc); root.add(ig);
    mesh(idl, M.wheelLight, ig); cy(1.05, 1.62, M.wheel, ig, 0, 0, 0, 'z', 28);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cy(.11, .3, M.plasticGray, ig, Math.cos(a) * .8, Math.sin(a) * .8, side * .68, 'z', 10); }
    cy(.22, .4, M.steel, ig, 0, 0, side * .7, 'z', 6);
    tracks[side] = { inst, spr: sg, idl: ig, zc, N, off: 0 };
  });
  const d = new T.Object3D();
  function updateTrack(t) {
    for (let i = 0; i < t.N; i++) {
      const [x, y, ang] = trackPt(i * G.LTOT / t.N + t.off);
      d.position.set(x, y, t.zc); d.rotation.set(0, 0, ang); d.updateMatrix(); t.inst.setMatrixAt(i, d.matrix);
    }
    t.inst.instanceMatrix.needsUpdate = true;
    t.spr.rotation.z = -t.off / G.WR; t.idl.rotation.z = -t.off / G.WR;
  }
  updateTrack(tracks[-1]); updateTrack(tracks[1]);
  return { group: root, tracks, updateTrack };
};

/* ===================== PIEZAS ===================== */
const B = {}; // constructores: cada uno devuelve {g, pins:{id:Vector3}}
const V = (x, y, z) => new T.Vector3(x, y, z);

function motorModel(label) {
  const g = new T.Group(), pins = {};
  // eje del motor a lo largo de +z: caja reductora (z<0) hacia la rueda, motor (z>0)
  const lab = tex(512, 128, (c, w, h) => { c.fillStyle = '#cfd3d7'; c.fillRect(0, 0, w, h); c.fillStyle = '#f4f4f0'; c.fillRect(150, 18, 260, 92);
    silk(c, label, 280, 46, 26, '#1c1f22'); silk(c, 'DC 12V  33GB520', 280, 84, 22, '#1c1f22'); });
  cy(1.62, 3.4, std(0xffffff, { map: lab, roughness: .32, metalness: .7 }), g, 0, 0, 1.7, 'z', 40);
  cy(1.5, .35, M.plasticDark, g, 0, 0, 3.55, 'z', 32);
  bx(.32, .5, .06, M.gold, g, .6, .65, 3.75); bx(.32, .5, .06, M.gold, g, -.6, .65, 3.75);
  cy(1.68, 2.3, M.steel, g, 0, 0, -1.15, 'z', 40);
  [-.3, -1.2, -2.0].forEach(z => { const r = mesh(new T.TorusGeometry(1.68, .04, 6, 40), M.steelDark, g, 0, 0, z); });
  screwHead(g, .9, .9, -2.32, .14, '-z'); screwHead(g, -.9, -.9, -2.32, .14, '-z');
  cy(.3, 1.6, M.steel, g, 0, 0, -3.0, 'z', 16);
  pins['M+'] = V(.6, .9, 3.8); pins['M-'] = V(-.6, .9, 3.8);
  return { g, pins };
}
B.motorA = () => motorModel('MOTOR A');
B.motorB = () => { const r = motorModel('MOTOR B'); r.g.rotation.y = Math.PI; return wrapRot(r); };
function wrapRot(r) { const w = new T.Group(); w.add(r.g); r.g.updateMatrix(); const pins = {}; for (const k in r.pins) pins[k] = r.pins[k].clone().applyMatrix4(r.g.matrix); return { g: w, pins }; }

B.battery = () => {
  const g = new T.Group(), pins = {};
  // portapilas abierto 2×18650: 7,8 × 4,1 × 2,0 cm, celdas a lo largo de z
  const L = 7.8, W = 4.1, H = 1.9;
  bx(W, .18, L, M.plasticDark, g, 0, .09, 0);
  bx(.18, H, L, M.plasticDark, g, -W / 2 + .09, H / 2, 0); bx(.18, H, L, M.plasticDark, g, W / 2 - .09, H / 2, 0);
  bx(W, H, .22, M.plasticDark, g, 0, H / 2, -L / 2 + .11); bx(W, H, .22, M.plasticDark, g, 0, H / 2, L / 2 - .11);
  bx(.12, 1.1, L - .4, M.plasticDark, g, 0, .6, 0);
  const wrap = tex(512, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8f949a'); gr.addColorStop(.5, '#a3a8ad'); gr.addColorStop(1, '#878c92'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    silk(c, 'LGABB41865', 250, 52, 30, '#2b2e31'); silk(c, 'L20B03S0A3  3.7V', 250, 88, 18, '#3b3e42'); });
  const cellMat = std(0xffffff, { map: wrap, roughness: .45 });
  [-.97, .97].forEach((x, i) => {
    const c = cy(.9, 6.5, cellMat, g, x, 1.02, 0, 'z', 36);
    c.rotation.y = i ? Math.PI : 0;
    const zp = i ? -3.27 : 3.27; // polo positivo alternado (serie)
    cy(.35, .12, M.steel, g, x, 1.02, zp + Math.sign(zp) * .05, 'z', 18);
    cy(.88, .03, M.white, g, x, 1.02, zp - Math.sign(zp) * .02, 'z', 36);
    // resorte en el polo negativo
    const zs = -zp; const pts = []; for (let k = 0; k <= 60; k++) { const a = k / 60 * Math.PI * 8; pts.push(V(x + .32 * Math.cos(a), 1.02 + .32 * Math.sin(a), zs + Math.sign(zs) * (-.05 + k / 60 * -.25) * -1)); }
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 120, .03, 6), M.steel, g);
    bx(.7, .7, .04, M.steel, g, x, 1.02, zp + Math.sign(zp) * .2);
  });
  // cables de salida
  const lead = (col, x, z2) => { const c = new T.CatmullRomCurve3([V(x, 1.6, L / 2 - .1), V(x, 1.9, L / 2 + .6), V(x * 1.4, 1.6, z2)]); mesh(new T.TubeGeometry(c, 20, .06, 8), col, g); };
  lead(M.rubberRed, -1.3, L / 2 + 1.4); lead(M.wireBlack, 1.3, L / 2 + 1.4);
  pins['BAT+'] = V(-1.8, 1.6, L / 2 + 1.4); pins['BAT-'] = V(1.8, 1.6, L / 2 + 1.4);
  return { g, pins };
};

B.l298n = () => {
  const g = new T.Group(), pins = {};
  const S = 4.3;
  const top = tex(512, 512, (c, w, h) => { c.fillStyle = '#c7261c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8574b'; c.lineWidth = 3; for (let i = 0; i < 14; i++) { c.beginPath(); c.moveTo(60 + i * 26, 470); c.lineTo(60 + i * 26, 330 - (i % 3) * 30); c.stroke(); }
    c.fillStyle = '#f4f4ef'; [[30, 30], [482, 30], [30, 482], [482, 482]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 22, 0, 7); c.fill(); c.fillStyle = '#c7261c'; c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill(); c.fillStyle = '#f4f4ef'; });
    silk(c, 'OUT1', 70, 120, 22); silk(c, 'OUT2', 70, 210, 22); silk(c, 'OUT3', 442, 120, 22); silk(c, 'OUT4', 442, 210, 22);
    silk(c, '+12V GND +5V', 160, 440, 22); silk(c, 'ENA IN1 IN2 IN3 IN4 ENB', 360, 488, 18);
    silk(c, 'L298N', 300, 300, 26); silk(c, '5V-EN', 140, 360, 16); silk(c, 'POWER', 240, 390, 16); });
  pcb(S, S, .16, 0xb72218, top, g, .3);
  [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]].forEach(([x, z]) => cy(.18, .3, M.brass, g, x, .15, z, 'y', 6));
  const yb = .46;
  // disipador vertical con aletas
  const hs = new T.Group(); hs.position.set(.2, yb, -.4); g.add(hs);
  bx(2.6, 2.4, .22, M.black, hs, 0, 1.2, -.6);
  for (let i = 0; i < 6; i++) bx(.12, 2.4, .9, M.black, hs, -1.2 + i * .48, 1.2, -1.15);
  bx(2.6, .25, 1.6, M.black, hs, 0, 2.3, -1.0);
  // chip Multiwatt delante del disipador
  chip(hs, 2.0, .45, 1.0, 0, .55, -.27, 'L298N\nST', '#121314', 16);
  screwHead(hs, 0, 1.75, -.06, .18, 'z');
  for (let i = 0; i < 15; i++) { const x = -.95 + i * .135; bx(.04, .6, .04, M.steel, hs, x, .3, -.15 + (i % 2) * .18); }
  elco(g, -.9, yb, .5); elco(g, .55, yb, 1.15);
  terminal(g, 2, -1.7, yb, -1.1); terminal(g, 2, 1.7, yb, -1.1, Math.PI);
  terminal(g, 3, -1.15, yb, 1.75, Math.PI / 2);
  headerRow(g, 6, .3, 1.95, yb);
  [0, 1, 2].forEach(i => bx(.26, .4, .5, M.black, g, .43 + i * .508 * 1.0 + (i === 2 ? .25 : 0), yb + .55, 1.95)); // jumpers ENA/ENB
  chip(g, .65, .6, .25, -1.0, yb, 1.0, '78M05', '#141516', 22);
  for (let i = 0; i < 4; i++) smd(g, 1.55 - i * .32, yb, -1.95 + .05, .12, .24, 0x1b1b1b);
  smd(g, -.2, yb, 1.4, .16, .08, 0xff3b30);
  pins['OUT1'] = V(-2.05, yb + .9, -1.35); pins['OUT2'] = V(-2.05, yb + .9, -.85);
  pins['OUT3'] = V(2.05, yb + .9, -.85); pins['OUT4'] = V(2.05, yb + .9, -1.35);
  pins['12V'] = V(-1.65, yb + .9, 1.95); pins['GND'] = V(-1.15, yb + .9, 1.95); pins['5V'] = V(-.65, yb + .9, 1.95);
  ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'].forEach((p, i) => pins[p] = V(.3 + i * .254, yb + .85, 1.95));
  return { g, pins };
};

const ESP_L = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'];
const ESP_R = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3'];
B.esp32 = () => {
  const g = new T.Group(), pins = {};
  const L = 5.5, W = 2.8;
  const top = tex(1024, 512, (c, w, h) => { c.fillStyle = '#16191c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d4af37'; for (let i = 0; i < 15; i++) { const x = 140 + i * 47; [38, 474].forEach(y => { c.beginPath(); c.arc(x, y, 14, 0, 7); c.fill(); c.fillStyle = '#16191c'; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); c.fillStyle = '#d4af37'; }); }
    ESP_L.forEach((n, i) => silk(c, n, 140 + (14 - i) * 47, 84, 19, '#f1f1ec', 'center', -Math.PI / 2));
    ESP_R.forEach((n, i) => silk(c, n, 140 + (14 - i) * 47, 428, 19, '#f1f1ec', 'center', -Math.PI / 2));
    c.strokeStyle = '#d4af37'; c.lineWidth = 7; c.beginPath(); let x = 900, y = 120; c.moveTo(x, y); for (let k = 0; k < 6; k++) { y += 50; c.lineTo(x, y); x = k % 2 ? 900 : 980; c.lineTo(x, y); } c.stroke();
    silk(c, 'EN', 60, 150, 20); silk(c, 'BOOT', 60, 370, 20); });
  // la textura va con x a lo largo del largo: rotamos la PCB para que el largo quede en x
  pcb(L, W, .16, 0x16191c, top, g, 1.0);
  const y = 1.16;
  const mod = new T.Group(); mod.position.set(1.15, y, 0); g.add(mod);
  const can = tex(256, 256, (c) => { c.fillStyle = '#b9bdc2'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#9ea3a8'; c.lineWidth = 6; c.strokeRect(10, 10, 236, 236);
    silk(c, 'ESP-32', 128, 80, 34, '#7b8086'); silk(c, 'CE', 128, 130, 30, '#7b8086'); silk(c, 'FCC ID:2AC7Z', 128, 180, 20, '#7b8086'); });
  bx(2.55, .1, 1.8, M.black, mod, .25, .05, 0);
  const shield = std(0xffffff, { map: can, roughness: .32, metalness: .85 }), sm = std(0xb9bdc2, { roughness: .32, metalness: .85 });
  mesh(new T.BoxGeometry(1.75, .3, 1.75), [sm, sm, shield, sm, sm, sm], mod, -.15, .25, 0);
  // USB micro, botones, chips
  bx(.75, .3, .8, M.steel, g, -2.45, y + .15, 0);
  [[-2.3, -.95], [-2.3, .95]].forEach(([x, z]) => { bx(.42, .18, .35, M.steel, g, x, y + .09, z); cy(.1, .1, M.black, g, x, y + .23, z, 'y', 12); });
  chip(g, .5, .5, .1, -1.2, y, .45, 'CP2102', '#151617', 16); chip(g, .65, .35, .16, -1.2, y, -.6, '1117', '#151617', 22);
  for (let i = 0; i < 6; i++) smd(g, -.35 + i * .2, y, .95, .12, .07, 0x3b2a1a);
  for (let i = 0; i < 15; i++) {
    const x = 1.556 - i * .254;
    [-1.25, 1.25].forEach(z => { bx(.07, 1.0, .07, M.gold, g, x, .5, z); bx(.24, .25, .24, M.black, g, x, .88, z); });
    pins[ESP_L[i]] = V(x, .1, -1.25); pins[ESP_R[i]] = V(x, .1, 1.25);
  }
  return { g, pins };
};

B.rpi = () => {
  const g = new T.Group(), pins = {};
  const L = 8.56, W = 5.65, y = 3.3;
  const top = tex(1024, 676, (c, w, h) => { c.fillStyle = '#1f7a3f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(160,220,170,.25)'; c.lineWidth = 2; for (let i = 0; i < 40; i++) { c.beginPath(); c.moveTo(Math.random() * w, Math.random() * h); c.lineTo(Math.random() * w, Math.random() * h); c.stroke(); }
    c.fillStyle = '#d4b24a'; [[40, 40], [620, 40], [40, 636], [620, 636]].forEach(([x, yy]) => { c.beginPath(); c.arc(x, yy, 30, 0, 7); c.fill(); c.fillStyle = '#1f7a3f'; c.beginPath(); c.arc(x, yy, 17, 0, 7); c.fill(); c.fillStyle = '#d4b24a'; });
    silk(c, 'Raspberry Pi 3 Model B V1.2', 360, 600, 30); silk(c, '© Raspberry Pi 2015', 360, 640, 22);
    silk(c, 'HDMI', 300, 520, 22); silk(c, 'CAMERA', 600, 470, 18); silk(c, 'DISPLAY', 70, 330, 18, '#f4f4ef', 'center', -Math.PI / 2); silk(c, 'ETHERNET', 920, 600, 18); });
  pcb(L, W, .16, 0x1c6f39, top, g, y);
  const yt = y + .16;
  [[-3.7, -2.4], [2.1, -2.4], [-3.7, 2.4], [2.1, 2.4]].forEach(([x, z]) => cy(.2, y, M.brass, g, x, y / 2, z, 'y', 6));
  chip(g, 1.4, 1.4, .12, -.7, yt, -.2, 'BCM2837\nRIFG16', '#c6c9cc', 15).material[2].metalness = .5;
  chip(g, .9, .9, .1, 2.1, yt, -.2, 'LAN9514', '#16181a', 16);
  // GPIO 2×20
  const n = 20, gp = new T.InstancedMesh(new T.BoxGeometry(.064, .85, .064), M.gold, n * 2), d = new T.Object3D();
  bx(n * .254, .25, .5, M.black, g, -.4, yt + .125, -2.45);
  for (let i = 0; i < n * 2; i++) { d.position.set(-.4 - (n - 1) * .127 + (i % n) * .254, yt + .42, -2.45 + (i < n ? -.127 : .127)); d.updateMatrix(); gp.setMatrixAt(i, d.matrix); }
  g.add(gp);
  // USB dobles y Ethernet en el extremo +x
  const usb = (z) => { const u = new T.Group(); u.position.set(3.5, yt, z); g.add(u); bx(1.75, 1.55, 1.32, M.steel, u, 0, .78, 0); [.42, 1.12].forEach(h => bx(1.0, .2, 1.0, M.black, u, .4, h, 0)); };
  usb(-1.65); usb(.35);
  const eth = new T.Group(); eth.position.set(3.45, yt, 2.05); g.add(eth); bx(2.1, 1.35, 1.6, M.steel, eth, 0, .68, 0); bx(.1, .8, 1.1, M.black, eth, 1.06, .62, 0);
  bx(1.5, .62, 1.12, M.steel, g, -1.0, yt + .31, 2.4); // HDMI
  cy(.3, .6, M.black, g, .8, yt + .3, 2.55, 'z', 16); bx(.6, .6, .7, M.black, g, .8, yt + .3, 2.2); // audio
  bx(.8, .3, .55, M.steel, g, -3.0, yt + .15, 2.5); // micro USB
  bx(.4, .55, 2.2, M.white, g, 1.55, yt + .28, .9); bx(.12, .2, 2.0, M.black, g, 1.55, yt + .58, .9); // CSI
  bx(2.2, .55, .4, M.white, g, -3.8, yt + .28, .2); // DSI
  pins['5V'] = V(-.4 + (n - 1) * .127, yt + .9, -2.6); pins.GND = V(-.4 + (n - 3) * .127, yt + .9, -2.6); pins.CSI = V(1.55, yt + .7, .9);
  return { g, pins };
};

B.box = () => {
  const g = new T.Group();
  const t = tex(512, 512, (c, w, h) => { c.fillStyle = '#dedbd2'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(120,110,90,${Math.random() * .05})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 30); c.lineTo(w, 30); c.stroke(); });
  const m = std(0xffffff, { map: t, roughness: .95 });
  const b = rbox(9.4, 6.6, 8.2, .12, m, g, 0, 0, 0); b.userData.isBox = true;
  bx(.02, 6.4, .02, std(0xcfcbc0), g, 2.2, 3.3, 4.11); // pliegue del cartón
  return { g, pins: {} };
};

B.switch = () => {
  const g = new T.Group(), pins = {};
  bx(1.3, 1.0, .9, M.black, g, 0, .5, 0); cy(.32, .35, M.steel, g, 0, 1.17, 0, 'y', 6);
  const lever = cy(.09, 1.0, M.steel, g, 0, 1.6, 0, 'y', 12); lever.rotation.z = .35;
  [[-.35], [0], [.35]].forEach(([x]) => bx(.12, .4, .05, M.steel, g, x, -.15, 0));
  pins.IN = V(-.35, -.2, 0); pins.OUT = V(.35, -.2, 0);
  return { g, pins };
};

B.buck = () => {
  const g = new T.Group(), pins = {};
  const top = tex(512, 256, (c, w, h) => { c.fillStyle = '#1d4fa8'; c.fillRect(0, 0, w, h); silk(c, 'IN+', 40, 40, 22); silk(c, 'IN-', 40, 216, 22); silk(c, 'OUT+', 466, 40, 22); silk(c, 'OUT-', 466, 216, 22); silk(c, 'LM2596', 260, 220, 22); });
  pcb(4.3, 2.1, .16, 0x1a4699, top, g, 0);
  const y = .16;
  cy(.75, .55, std(0x2a2a2a), g, -.5, y + .28, -.05, 'y', 28); cy(.55, .58, M.copper, g, -.5, y + .29, -.05, 'y', 28);
  elco(g, 1.2, y, -.5, .32, .8, '220µF 35V'); elco(g, -1.6, y, .4, .32, .8, '220µF 50V');
  chip(g, 1.0, .9, .35, .5, y, .55, 'LM2596\nS-5.0', '#141516', 16);
  const pot = bx(.95, .9, .5, M.blueTerm, g, 1.4, y + .45, .65); cy(.14, .1, M.brass, g, 1.4, y + .95, .65, 'y', 12);
  pins['IN+'] = V(-2.0, y + .1, -.8); pins['IN-'] = V(-2.0, y + .1, .8); pins['OUT+'] = V(2.0, y + .1, -.8); pins['OUT-'] = V(2.0, y + .1, .8);
  return { g, pins };
};

B.cam = () => {
  const g = new T.Group(), pins = {};
  const top = tex(256, 256, (c) => { c.fillStyle = '#1f7a3f'; c.fillRect(0, 0, 256, 256); silk(c, 'Raspberry Pi', 128, 30, 18); silk(c, 'Camera V2.1', 128, 226, 18);
    c.fillStyle = '#d4b24a'; [[24, 24], [232, 24], [24, 140], [232, 140]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 10, 0, 7); c.fill(); }); });
  const board = new T.Group(); board.rotation.z = Math.PI / 2; board.position.set(0, 1.2, 0); g.add(board);
  pcb(2.5, 2.4, .1, 0x1c6f39, top, board, -.05);
  const lens = new T.Group(); lens.position.set(.35, 1.2, 0); g.add(lens);
  bx(.3, .85, .85, M.black, lens, .1, 0, 0); cy(.32, .35, M.black, lens, .4, 0, 0, 'x', 24); cy(.2, .05, M.glass, lens, .59, 0, 0, 'x', 24);
  const flex = std(0xd8d2c0, { roughness: .6 });
  bx(.04, 1.6, 1.6, flex, g, -.1, -.1, 0);
  pins.CSI = V(-.1, -.9, 0);
  return { g, pins };
};

B.imu = () => {
  const g = new T.Group(), pins = {};
  const top = tex(256, 192, (c) => { c.fillStyle = '#1d4fa8'; c.fillRect(0, 0, 256, 192); ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'].forEach((n, i) => silk(c, n, 16 + i * 31, 160, 13, '#f4f4ef', 'center', -Math.PI / 2)); silk(c, 'GY-521', 128, 50, 22); });
  pcb(2.1, 1.6, .12, 0x1a4699, top, g, 0);
  chip(g, .4, .4, .1, 0, .12, -.15, 'MPU\n6050', '#151617', 18);
  headerRow(g, 8, -.89, .62, .12, .254, 'x', .6);
  pins.VCC = V(-.89, .5, .62); pins.GND = V(-.64, .5, .62); pins.SCL = V(-.38, .5, .62); pins.SDA = V(-.13, .5, .62);
  return { g, pins };
};

B.sonar = () => {
  const g = new T.Group(), pins = {};
  const top = tex(512, 256, (c) => { c.fillStyle = '#1d4fa8'; c.fillRect(0, 0, 512, 256); silk(c, 'HC-SR04', 256, 40, 30); silk(c, 'T', 110, 228, 26); silk(c, 'R', 400, 228, 26); silk(c, 'Vcc Trig Echo Gnd', 256, 200, 20); });
  const board = new T.Group(); board.rotation.z = Math.PI / 2; board.position.set(0, 1.05, 0); g.add(board);
  pcb(2.1, 4.5, .14, 0x1a4699, top, board, -.07);
  const mesh_ = tex(128, 128, (c) => { c.fillStyle = '#9ea3a8'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#2a2d30'; for (let x = 4; x < 128; x += 9) for (let y = 4; y < 128; y += 9) { c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); } });
  [-1.3, 1.3].forEach(z => { cy(.8, 1.2, M.steel, g, .67, 1.05, z, 'x', 32); cy(.72, .02, std(0xffffff, { map: mesh_, metalness: .6, roughness: .5 }), g, 1.28, 1.05, z, 'x', 32); });
  cy(.18, .5, M.steel, g, .25, 1.0, 0, 'x', 12).scale.set(1, 1, 2);
  for (let i = 0; i < 4; i++) bx(.5, .07, .07, M.gold, g, -.3, .2, -.38 + i * .254);
  bx(.9, .18, 3.4, M.alu, g, -.45, .09, 0); // soporte en L
  pins.VCC = V(-.55, .2, -.38); pins.TRIG = V(-.55, .2, -.127); pins.ECHO = V(-.55, .2, .127); pins.GND = V(-.55, .2, .38);
  return { g, pins };
};

B.divider = () => {
  const g = new T.Group(), pins = {};
  bx(2.2, .12, 1.2, std(0xc9a46a, { roughness: .8 }), g, 0, .06, 0);
  const res = (z, bands) => { const t = tex(256, 32, (c) => { c.fillStyle = '#d9c39a'; c.fillRect(0, 0, 256, 32); bands.forEach((b, i) => { c.fillStyle = b; c.fillRect(70 + i * 34, 0, 18, 32); }); c.fillStyle = '#c9a24a'; c.fillRect(200, 0, 14, 32); });
    cy(.13, .7, std(0xffffff, { map: t, roughness: .6 }), g, 0, .35, z, 'x', 16); bx(1.5, .03, .03, M.steel, g, 0, .35, z); };
  res(-.25, ['#6b3b16', '#111', '#d22']); res(.25, ['#d22', '#111', '#d22']);
  pins.IN = V(-.9, .4, -.25); pins.OUT = V(.9, .4, -.25); pins.GND = V(.9, .4, .25);
  return { g, pins };
};

B.leds = () => {
  const g = new T.Group(), pins = {}; const leds = [];
  bx(.6, .2, 7.2, M.alu, g, 0, .1, 0);
  [-3.0, 3.0].forEach(z => {
    const m = UGV.MAT.ledOff.clone(); const l = new T.Group(); l.position.set(.25, .55, z); g.add(l);
    cy(.25, .5, m, l, 0, 0, 0, 'x', 20); const dome = mesh(new T.SphereGeometry(.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, l, .25, 0, 0); dome.rotation.z = -Math.PI / 2;
    cy(.29, .06, m, l, -.25, 0, 0, 'x', 20); leds.push(m);
  });
  g.userData.leds = leds;
  pins.A = V(-.2, .25, -2.4); pins.K = V(-.2, .25, -2.0);
  return { g, pins };
};

B.buzzer = () => {
  const g = new T.Group(), pins = {};
  cy(.6, .9, M.blackGloss, g, 0, .45, 0, 'y', 32); cy(.12, .03, std(0x333333), g, 0, .91, 0, 'y', 12);
  const st = tex(64, 64, (c) => { c.fillStyle = '#f2f2ee'; c.fillRect(0, 0, 64, 64); silk(c, 'REMOVE', 32, 26, 9, '#222'); silk(c, 'SEAL', 32, 40, 9, '#222'); });
  pins['+'] = V(-.2, .1, 0); pins['-'] = V(.2, .1, 0);
  return { g, pins };
};

B.enc = () => {
  const g = new T.Group(), pins = {};
  const one = (x, z, s) => { const e = new T.Group(); e.position.set(x, G.YC, z); g.add(e);
    cy(1.55, .12, std(0x1c6f39), e, 0, 0, 0, 'z', 32); cy(.75, .3, M.black, e, 0, 0, s * .2, 'z', 24);
    bx(1.2, .5, .5, M.white, e, 0, 1.15, s * .2); };
  const zA = -G.MOTOR_Z + 3.9, zB = -zA;
  one(G.TX, zA, 1); one(-G.TX, zB, -1);
  pins.A1 = V(G.TX - .3, G.YC + 1.4, zA); pins.B1 = V(G.TX, G.YC + 1.4, zA); pins.VCC = V(G.TX + .3, G.YC + 1.4, zA);
  pins.A2 = V(-G.TX - .3, G.YC + 1.4, zB); pins.B2 = V(-G.TX, G.YC + 1.4, zB); pins.GND = V(-G.TX + .3, G.YC + 1.4, zB);
  return { g, pins };
};

B.chassis = () => { const c = UGV.buildChassis(); return { g: c.group, pins: {}, chassis: c }; };

/* Posición de cada pieza en el robot (local: +x adelante, +z derecha, y arriba) */
UGV.PLACE = {
  chassis: { pos: [0, 0, 0] },
  motorA: { pos: [G.TX, G.YC, -G.MOTOR_Z], fixed: true },
  motorB: { pos: [-G.TX, G.YC, G.MOTOR_Z], fixed: true },
  battery: { pos: [-5.7, G.PLATE_Y + .95, 0], tilt: -.24 },
  l298n: { pos: [-.4, G.PLATE_Y, -.6] },
  esp32: { pos: [4.6, G.PLATE_Y, 2.1] },
  rpi: { pos: [2.6, G.PLATE_Y, 0] },
  box: { pos: [2.6, G.PLATE_Y, 0] },
  switch: { pos: [-6.9, G.PLATE_Y - 1.2, 2.8], rot: Math.PI / 2 },
  buck: { pos: [-.5, G.PLATE_Y, 2.7] },
  cam: { pos: [7.4, G.PLATE_Y + 4.0, 0] },
  imu: { pos: [.4, G.PLATE_Y + 6.6, 0] },
  sonar: { pos: [7.45, G.PLATE_Y + .05, 0] },
  divider: { pos: [5.3, G.PLATE_Y, -3.3] },
  leds: { pos: [6.95, G.PLATE_Y - 1.0, 0] },
  buzzer: { pos: [5.6, G.PLATE_Y, -2.0] },
  enc: { pos: [0, 0, 0], fixed: true }
};
/* motorB queda girado 180° para que su caja reductora apunte a la oruga derecha */
UGV.build = id => (B[id] ? B[id]() : null);
UGV.ESP_PINS = { L: ESP_L, R: ESP_R };
})();
