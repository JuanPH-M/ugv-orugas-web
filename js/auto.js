/* Modo autónomo: la misma planificación que raspberry/robot/navegacion.py y robot/mapa.py, escrita en JavaScript
   para el simulador. tests/run.js comprueba que ambas den los mismos pasos.
   Unidades: cm; x hacia el este, y hacia el norte; rumbo en grados (0 = este, 90 = norte, positivo = antihorario). */
(function (root) {
'use strict';
const A = {};
const MOV = A.MOVIMIENTOS = ['avanzar', 'retroceder', 'izquierda', 'derecha'];
const UNI = A.UNIDADES = { cm: 1, m: 100, km: 100000 };
const MAX_PLAN_S = 8 * 3600, MAX_DIST_CM = 1e6, MAX_COORD_CM = 1e6;
// redondeo como Python (al par más cercano en el empate exacto no importa aquí: se compara con tolerancia)
const r2 = x => Math.round(x * 100) / 100, r1 = x => Math.round(x * 10) / 10;
A.normalizar = a => (((a + 180) % 360) + 360) % 360 - 180;
A.tiempoEfectivo = cfg => +cfg.prueba_calibracion_s;   // las pruebas y los pasos del modo autónomo van sin rampa
A.calibrado = cfg => !!(cfg.cm_s && cfg.grados_s);
const durDist = (cm, cfg) => r2(Math.abs(cm) / cfg.cm_s);
const durGiro = (g, cfg) => r2(Math.abs(g) / cfg.grados_s);

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
  m.zonaCercana = (p, q) => { for (const l of m.lotes) { const dist = A.distanciaSegmentoLote(p, q, l); if (dist < m.margen) return [l, dist]; } return [null, null]; };
  d.caminos.forEach(([a, b]) => {
    if (!m.puntos[a] || !m.puntos[b]) throw new Error(`El camino ${a}-${b} usa un punto que no existe.`);
    m.vecinos[a].push(b); m.vecinos[b].push(a);
    const [l, dist] = m.zonaCercana(xy(a), xy(b));
    if (l) throw new Error(`El camino ${a}-${b} pasa a ${Math.round(dist)} cm del lote «${l.nombre}»: el robot pisaría el cultivo.`);
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

/* Acumula pasos y lleva la pose prevista (igual que la clase _Plan de navegacion.py) */
function Plan(cfg, x = null, y = null, rumbo = null, nombre = null) {
  if (!A.calibrado(cfg)) throw new Error('Primero calibra el avance (cm/s) y el giro (°/s).');
  const pl = { cfg, pasos: [], nodos: [nombre || 'inicio'], x, y, rumbo, nombre };
  pl.conocida = () => pl.x !== null && pl.rumbo !== null;
  pl.fin = n => (pl.conocida() ? { pos: n ?? null, x: r1(pl.x), y: r1(pl.y), rumbo: r1(pl.rumbo) } : { pos: n ?? null, x: null, y: null, rumbo: null });
  pl.mover = (tipo, duracion, fin, extra) => {
    const ult = pl.pasos[pl.pasos.length - 1];
    if (ult && MOV.includes(ult.tipo) && ult.tipo !== tipo) pl.pasos.push({ tipo: 'pausa', velocidad: 0, duracion: +cfg.pausa_giro_s });
    const paso = { tipo, velocidad: cfg.vel_auto, duracion, fin };
    Object.entries(extra || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) paso[k] = v; });
    pl.pasos.push(paso);
  };
  pl.girar = g => {
    if (Math.abs(g) < 1) return;
    const obj = pl.rumbo !== null ? A.normalizar(pl.rumbo + g) : null; pl.rumbo = obj;
    pl.mover(g > 0 ? 'izquierda' : 'derecha', durGiro(g, cfg), pl.fin(pl.nombre), { giro: r1(g), rumbo_obj: obj === null ? null : r1(obj) });
  };
  pl.recta = (cm, nombre = null, hacia = null) => {
    if (Math.abs(cm) < 1) return;
    const rumbo = pl.rumbo;
    if (pl.conocida()) { const s = cm > 0 ? 1 : -1; pl.x += s * Math.abs(cm) * Math.cos(rumbo * Math.PI / 180); pl.y += s * Math.abs(cm) * Math.sin(rumbo * Math.PI / 180); }
    pl.nombre = nombre;
    pl.mover(cm > 0 ? 'avanzar' : 'retroceder', durDist(cm, cfg), pl.fin(nombre), { hacia: hacia || nombre, rumbo_rec: rumbo === null ? null : r1(rumbo) });
  };
  pl.irA = (x, y, nombre = null) => {
    const dx = x - pl.x, dy = y - pl.y, d = Math.hypot(dx, dy);
    if (d < 1) { pl.nombre = nombre || pl.nombre; return; }
    const obj = Math.atan2(dy, dx) * 180 / Math.PI, g = A.normalizar(obj - pl.rumbo);
    if (Math.abs(g) > 135 && cfg.retroceder_si_vuelve !== false) pl.recta(-d, nombre);
    else { pl.girar(g); pl.rumbo = obj; pl.recta(d, nombre); }
    pl.x = x; pl.y = y;
  };
  pl.llegada = (n, esperarOrden) => pl.pasos.push({ llega: n, esperar: esperarOrden ? 'orden' : +cfg.espera_s, x: pl.x === null ? null : r1(pl.x), y: pl.y === null ? null : r1(pl.y) });
  pl.terminar = () => {
    const total = pl.pasos.reduce((s, p) => s + (p.duracion || 0) + (typeof p.esperar === 'number' ? p.esperar : 0), 0);
    if (total > MAX_PLAN_S) throw new Error(`La ruta duraría ${(total / 3600).toFixed(1)} h: el máximo es 8 h.`);
    if (!pl.pasos.length) throw new Error('La ruta no tiene ningún movimiento.');
    return { pasos: pl.pasos, nodos: pl.nodos };
  };
  return pl;
}

/* Puntos del mapa, por los caminos (plan_puntos) */
A.planPuntos = (mapa, desde, rumbo, destinos, cfg, esperarOrden) => {
  const [x, y] = mapa.xy(desde), pl = Plan(cfg, x, y, rumbo, desde);
  pl.nodos = [desde]; let cur = desde;
  destinos.forEach(dest => {
    const camino = mapa.ruta(cur, dest);
    for (let i = 0; i + 1 < camino.length; i++) { pl.nombre = camino[i]; pl.irA(...mapa.xy(camino[i + 1]), camino[i + 1]); pl.nodos.push(camino[i + 1]); }
    pl.llegada(dest, esperarOrden); cur = dest;
  });
  return pl.terminar();
};
A.plan = A.planPuntos;   // nombre anterior

/* Coordenadas en metros (plan_coordenadas) */
A.validarCoordenadas = puntos => {
  if (!Array.isArray(puntos) || puntos.length < 1 || puntos.length > 200) throw new Error('La ruta debe tener entre 1 y 200 puntos.');
  return puntos.map((p, i) => {
    const x = +p.x_m, y = +p.y_m;
    if (p.x_m === '' || p.y_m === '' || p.x_m == null || p.y_m == null || !isFinite(x) || !isFinite(y)) throw new Error(`Punto ${i + 1}: faltan las coordenadas X e Y en metros o no son números.`);
    if (Math.abs(x) * 100 > MAX_COORD_CM || Math.abs(y) * 100 > MAX_COORD_CM) throw new Error(`Punto ${i + 1}: las coordenadas deben estar entre −10 y 10 km.`);
    return { x_m: Math.round(x * 1000) / 1000, y_m: Math.round(y * 1000) / 1000, nombre: String(p.nombre || `P${i + 1}`).slice(0, 20) };
  });
};
A.planCoordenadas = (pose, puntos, cfg, esperarOrden, mapa) => {
  puntos = A.validarCoordenadas(puntos);
  if (!pose) throw new Error('Para una ruta por coordenadas hay que saber dónde está el robot: indícalo primero.');
  const pl = Plan(cfg, pose.x, pose.y, pose.rumbo, pose.nombre || null);
  let previo = [pose.x, pose.y], nPrevio = pose.nombre || 'inicio';
  puntos.forEach(p => {
    const dest = [p.x_m * 100, p.y_m * 100];
    if (mapa) { const [l, dist] = mapa.zonaCercana(previo, dest); if (l) throw new Error(`El tramo ${nPrevio} → ${p.nombre} pasa a ${Math.round(dist)} cm de «${l.nombre}» (mínimo ${mapa.margen} cm): cambia los puntos para no pisar el cultivo.`); }
    pl.irA(...dest, p.nombre); pl.nodos.push(p.nombre); pl.llegada(p.nombre, esperarOrden);
    previo = dest; nPrevio = p.nombre;
  });
  return pl.terminar();
};

/* Instrucciones en metros y grados (plan_instrucciones) */
A.ACCIONES = ['avanzar', 'retroceder', 'izquierda', 'derecha', 'esperar'];
A.validarInstrucciones = instr => {
  if (!Array.isArray(instr) || instr.length < 1 || instr.length > 200) throw new Error('La ruta debe tener entre 1 y 200 instrucciones.');
  return instr.map((it, i) => {
    if (!it || !A.ACCIONES.includes(it.accion)) throw new Error(`Instrucción ${i + 1}: la acción debe ser avanzar, retroceder, izquierda, derecha o esperar.`);
    const v = +it.valor;
    if (!isFinite(v) || v <= 0) throw new Error(`Instrucción ${i + 1}: el valor debe ser mayor que 0.`);
    if (it.accion === 'avanzar' || it.accion === 'retroceder') {
      const u = it.unidad || 'm'; if (!UNI[u]) throw new Error(`Instrucción ${i + 1}: la unidad debe ser cm, m o km.`);
      if (v * UNI[u] > MAX_DIST_CM) throw new Error(`Instrucción ${i + 1}: el máximo por instrucción es 10 km.`);
      return { accion: it.accion, valor: v, unidad: u };
    }
    if (it.accion === 'esperar') { if (v > 3600) throw new Error(`Instrucción ${i + 1}: la espera va hasta 3600 s.`); return { accion: 'esperar', valor: v, unidad: 's' }; }
    if (v > 360) throw new Error(`Instrucción ${i + 1}: el giro va de 1 a 360 grados.`);
    return { accion: it.accion, valor: v, unidad: 'grados' };
  });
};
A.planInstrucciones = (pose, instr, cfg, mapa) => {
  instr = A.validarInstrucciones(instr);
  const pl = pose ? Plan(cfg, pose.x, pose.y, pose.rumbo, pose.nombre || null) : Plan(cfg);
  instr.forEach((it, k) => {
    const i = k + 1, a = it.accion;
    if (a === 'avanzar' || a === 'retroceder') {
      const cm = it.valor * UNI[it.unidad], antes = [pl.x, pl.y];
      pl.recta(a === 'avanzar' ? cm : -cm, `I${i}`, `instrucción ${i}`);
      if (mapa && pl.conocida()) { const [l, dist] = mapa.zonaCercana(antes, [pl.x, pl.y]); if (l) throw new Error(`La instrucción ${i} pasa a ${Math.round(dist)} cm de «${l.nombre}»: el robot pisaría el cultivo.`); }
    } else if (a === 'izquierda' || a === 'derecha') pl.girar(a === 'izquierda' ? it.valor : -it.valor);
    else pl.pasos.push({ tipo: 'pausa', velocidad: 0, duracion: it.valor });
  });
  pl.llegada('fin', false);
  return pl.terminar();
};
/* Texto como «avanzar 2 m; derecha 90; esperar 3» → instrucciones */
A.leerInstrucciones = txt => String(txt || '').split(/[;\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean).map((s, i) => {
  const m = s.match(/^(avanzar|retroceder|izquierda|derecha|esperar)\s+([\d.,]+)\s*(cm|m|km|°|grados|s)?$/);
  if (!m) throw new Error(`No entiendo «${s}» (instrucción ${i + 1}). Ejemplo: avanzar 2 m; derecha 90; esperar 3`);
  const it = { accion: m[1], valor: +m[2].replace(',', '.') }; if (m[1] === 'avanzar' || m[1] === 'retroceder') it.unidad = m[3] && UNI[m[3]] ? m[3] : 'm';
  return it;
});

/* Pose estimada a mitad de un paso (pose_en_paso) */
A.poseEnPaso = (p0, paso, f) => {
  const fin = paso.fin || {}; if (!p0 || fin.rumbo == null) return null;
  f = Math.max(0, Math.min(1, f));
  if (paso.tipo === 'izquierda' || paso.tipo === 'derecha') return { x: p0.x, y: p0.y, rumbo: A.normalizar(p0.rumbo + A.normalizar(fin.rumbo - p0.rumbo) * f) };
  if (fin.x == null) return null;
  return { x: p0.x + (fin.x - p0.x) * f, y: p0.y + (fin.y - p0.y) * f, rumbo: p0.rumbo };
};

/* Rampa de aceleración de Motores (motores.py), solo en el modo manual: frenar es inmediato, acelerar como máximo «maximo» por paso */
A.rampa = (actual, objetivo, maximo) => {
  if (objetivo === 0) return 0;
  if (actual !== 0 && (objetivo > 0) !== (actual > 0)) actual = 0;
  if (Math.abs(objetivo) <= Math.abs(actual)) return objetivo;
  const paso = Math.min(Math.abs(objetivo) - Math.abs(actual), maximo);
  return objetivo > 0 ? actual + paso : actual - paso;
};

if (typeof module !== 'undefined' && module.exports) module.exports = A;
else { root.UGV = root.UGV || {}; root.UGV.Auto = A; }
})(typeof window !== 'undefined' ? window : this);
