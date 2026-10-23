/* Modo automático por la finca: la misma planificación que raspberry/ugv.py (clase Mapa y plan_auto),
   escrita en JavaScript para el simulador. tests/run.js comprueba que ambas den los mismos pasos. */
(function (root) {
'use strict';
const A = {};

A.distanciaSegmentoLote = (p, q, l) => {
  const { x0, x1, y0, y1 } = l, dentro = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (dentro(...p) || dentro(...q)) return 0;
  const esq = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < 4; i++) { const c = esq[i], d = esq[(i + 1) % 4]; if (o(p, q, c) * o(p, q, d) < 0 && o(c, d, p) * o(c, d, q) < 0) return 0; }
  const puntoRect = (x, y) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  const puntoSeg = c => { const dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((c[0] - p[0]) * dx + (c[1] - p[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] + t * dx - c[0], p[1] + t * dy - c[1]); };
  return Math.min(puntoRect(...p), puntoRect(...q), ...esq.map(puntoSeg));
};

A.Mapa = function (d) {
  const m = { datos: d, puntos: d.puntos, inicio: d.inicio, orden: (d.orden || []).slice(), rumboInicial: +(d.rumbo_inicial ?? 90),
    lotes: d.lotes || [], margen: +(d.margen_cm ?? 40), vecinos: {} };
  Object.keys(m.puntos).forEach(p => { m.vecinos[p] = []; });
  const xy = p => [m.puntos[p].x, m.puntos[p].y];
  d.caminos.forEach(([a, b]) => {
    if (!m.puntos[a] || !m.puntos[b]) throw new Error(`El camino ${a}-${b} usa un punto que no existe.`);
    m.vecinos[a].push(b); m.vecinos[b].push(a);
    m.lotes.forEach(l => { const dist = A.distanciaSegmentoLote(xy(a), xy(b), l); if (dist < m.margen) throw new Error(`El camino ${a}-${b} pasa a ${Math.round(dist)} cm del lote «${l.nombre}».`); });
  });
  m.xy = xy;
  m.distancia = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.hypot(bx - ax, by - ay); };
  m.rumbo = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.atan2(by - ay, bx - ax) * 180 / Math.PI; };
  m.ruta = (a, b) => { // Dijkstra, igual que en Python (en empate, el primer punto del mapa)
    const ids = Object.keys(m.puntos), dist = {}, previo = {}, hecho = new Set();
    ids.forEach(p => { dist[p] = Infinity; }); dist[a] = 0;
    for (;;) {
      let u = null; ids.forEach(p => { if (!hecho.has(p) && dist[p] < Infinity && (u === null || dist[p] < dist[u])) u = p; });
      if (u === null || u === b) break;
      hecho.add(u);
      m.vecinos[u].forEach(v => { const nd = dist[u] + m.distancia(u, v); if (nd < dist[v]) { dist[v] = nd; previo[v] = u; } });
    }
    if (dist[b] === Infinity) throw new Error(`No hay camino de ${a} a ${b}.`);
    const nodos = [b]; while (nodos[nodos.length - 1] !== a) nodos.push(previo[nodos[nodos.length - 1]]);
    return nodos.reverse();
  };
  return m;
};

const r2 = x => Math.round(x * 100) / 100, r1 = x => Math.round(x * 10) / 10;
A.plan = (mapa, desde, rumbo, destinos, cfg, esperarOrden) => {
  if (!cfg.cm_s || !cfg.grados_s) throw new Error('Primero calibra el avance (cm/s) y el giro (°/s).');
  const vel = cfg.vel_auto, pasos = [], nodos = [desde]; let cur = desde;
  const MOV = ['avanzar', 'retroceder', 'izquierda', 'derecha'];
  const mover = (tipo, duracion, fin, hacia) => { // entre dos movimientos distintos el robot frena un momento
    const ult = pasos[pasos.length - 1];
    if (ult && MOV.includes(ult.tipo) && ult.tipo !== tipo) pasos.push({ tipo: 'pausa', velocidad: 0, duracion: +cfg.pausa_giro_s });
    const paso = { tipo, velocidad: vel, duracion, fin }; if (hacia) paso.hacia = hacia; pasos.push(paso);
  };
  destinos.forEach(dest => {
    const camino = mapa.ruta(cur, dest);
    for (let i = 0; i + 1 < camino.length; i++) {
      const u = camino[i], v = camino[i + 1], obj = mapa.rumbo(u, v);
      const giro = ((obj - rumbo + 180) % 360 + 360) % 360 - 180, tramo = r2(mapa.distancia(u, v) / cfg.cm_s);
      if (Math.abs(giro) > 135) mover('retroceder', tramo, { pos: v, rumbo: r1(rumbo) }, v); // vuelve por donde vino: retrocede en línea recta
      else {
        if (Math.abs(giro) >= 1) { mover(giro > 0 ? 'izquierda' : 'derecha', r2(Math.abs(giro) / cfg.grados_s), { pos: u, rumbo: r1(obj) }); rumbo = obj; }
        mover('avanzar', tramo, { pos: v, rumbo: r1(rumbo) }, v);
      }
      nodos.push(v);
    }
    pasos.push({ llega: dest, esperar: esperarOrden ? 'orden' : +cfg.espera_s });
    cur = dest;
  });
  return { pasos, nodos };
};

if (typeof module !== 'undefined' && module.exports) module.exports = A;
else { root.UGV = root.UGV || {}; root.UGV.Auto = A; }
})(typeof window !== 'undefined' ? window : this);
