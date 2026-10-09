/* Catálogo de piezas: miniaturas 3D y ficha con visor interactivo */
(function () {
'use strict';
const T = THREE;
const Cat = UGV.Catalog = {};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let thumbR, thumbs = {}, grid, filter = 'all', modal, mv = null;

function studio(renderer) {
  const sc = new T.Scene();
  const pm = new T.PMREMGenerator(renderer); sc.environment = pm.fromScene(new T.RoomEnvironment(), .04).texture;
  const key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(30, 50, 25); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 }); sc.add(key);
  sc.add(new T.HemisphereLight(0xffffff, 0x666666, .3));
  const ground = new T.Mesh(new T.PlaneGeometry(200, 200), new T.ShadowMaterial({ opacity: .18 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
  return sc;
}
function modelFor(id) {
  if (id === 'chassis') { const c = UGV.buildChassis(); return c.group; }
  if (id === 'aruco') { const g = new T.Group(); const m = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshStandardMaterial({ map: UGV.tex(120, 120, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 120, 120); c.fillStyle = '#000'; c.fillRect(10, 10, 100, 100); c.fillStyle = '#fff'; [[0, 1], [1, 3], [2, 0], [2, 2], [3, 1], [3, 3], [1, 0]].forEach(([r, k]) => c.fillRect(30 + k * 15, 30 + r * 15, 15, 15)); }) }));
    m.rotation.x = -Math.PI / 2; m.position.y = .05; m.receiveShadow = true; g.add(m); return g; }
  const r = UGV.build(id); if (!r) return null;
  const g = new T.Group(); g.add(r.g);
  if (id === 'motorA' || id === 'motorB') { g.position.y = 0; r.g.position.y = 1.7; }
  if (id === 'enc') { r.g.position.set(0, -UGV.GEOM.YC + 1.6, 0); r.g.rotation.y = 0; }
  if (id === 'leds') r.g.position.y = .4;
  return g;
}
function frame(cam, obj, dist = 1.9) {
  const b = new T.Box3().setFromObject(obj), s = b.getSize(new T.Vector3()), c = b.getCenter(new T.Vector3());
  const R = Math.max(s.x, s.y, s.z) * .5 * dist + .5;
  cam.position.set(c.x + R * 1.25, c.y + R * .95, c.z + R * 1.35); cam.lookAt(c); cam.near = R / 50; cam.far = R * 40; cam.updateProjectionMatrix();
  return c;
}
function makeThumbs() {
  const cv = document.createElement('canvas'); cv.width = 360; cv.height = 270;
  thumbR = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  thumbR.outputEncoding = T.sRGBEncoding; thumbR.toneMapping = T.ACESFilmicToneMapping; thumbR.toneMappingExposure = .72; thumbR.shadowMap.enabled = true; thumbR.setSize(360, 270, false);
  const sc = studio(thumbR), cam = new T.PerspectiveCamera(32, 4 / 3, .1, 1000);
  UGV.PARTS.forEach(p => { const m = modelFor(p.id); if (!m) return; sc.add(m); m.traverse(o => { if (o.isMesh) { o.castShadow = true; [].concat(o.material).forEach(x => { if ('envMapIntensity' in x) x.envMapIntensity = .5; }); } });
    frame(cam, m); thumbR.render(sc, cam); thumbs[p.id] = cv.toDataURL('image/png'); sc.remove(m); });
  thumbR.dispose(); thumbR.forceContextLoss();
}

Cat.init = function (refs) {
  grid = refs.grid; modal = refs.modal;
  refs.filters.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; refs.filters.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); render(); }));
  UGV.on('parts', render);
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  render();
};
Cat.ensureThumbs = () => { if (!Object.keys(thumbs).length) { try { makeThumbs(); } catch (e) { console.warn(e); } render(); } };

function render() {
  if (!grid) return;
  const list = UGV.PARTS.filter(p => filter === 'all' || (filter === 'on' ? UGV.isOn(p.id) : filter === 'off' ? !UGV.isOn(p.id) : p.cat === filter));
  grid.innerHTML = list.map(p => `
    <article class="pcard ${UGV.isOn(p.id) ? 'is-on' : ''}" data-id="${p.id}" tabindex="0">
      <div class="thumb">${thumbs[p.id] ? `<img src="${thumbs[p.id]}" alt="${esc(p.name)}">` : '<div class="thumb-ph"></div>'}</div>
      <div class="pc-body">
        <div class="chips"><span class="chip c-${p.cat}">${UGV.CATS[p.cat]}</span><span class="chip ${UGV.isOn(p.id) ? 'st-on' : 'st-off'}">${UGV.isOn(p.id) ? 'Montada' : 'Falta'}</span></div>
        <h3>${esc(p.name)}</h3><p>${esc(p.short)}</p>
        <dl class="mini">${p.specs.slice(0, 2).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>
    </article>`).join('');
  grid.querySelectorAll('.pcard').forEach(c => { c.addEventListener('click', () => Cat.open(c.dataset.id)); c.addEventListener('keydown', e => { if (e.key === 'Enter') Cat.open(c.dataset.id); }); });
}

Cat.open = function (id) {
  const p = UGV.part(id); if (!p) return;
  const an = UGV.analyze(UGV.Sim.st.vbat);
  const conns = p.pins.map(pin => { const key = p.id + '.' + pin.id; const to = an.wires.filter(w => w.a === key || w.b === key).map(w => { const o = (w.a === key ? w.b : w.a).split('.'); return `${UGV.part(o[0]).name.split(' · ')[0]} · ${o[1]}`; });
    return `<tr><td class="mono">${esc(pin.id)}</td><td>${to.length ? esc(to.join(', ')) : `<span class="muted">${UGV.isOn(p.id) ? 'libre' : '—'}</span>`}</td><td class="muted">${esc(UGV.PIN_FUNC[key] || '')}</td></tr>`; }).join('');
  const warn = an.warnings.filter(w => w.parts.includes(id));
  modal.querySelector('.m-body').innerHTML = `
    <div class="m-view"><canvas id="mCanvas"></canvas><p class="m-hint">Arrastra para girar · rueda para acercar</p></div>
    <div class="m-info">
      <div class="chips"><span class="chip c-${p.cat}">${UGV.CATS[p.cat]}</span><span class="chip ${UGV.isOn(id) ? 'st-on' : 'st-off'}">${UGV.isOn(id) ? 'Montada' : 'Falta'}</span>${p.need ? '<span class="chip need">Recomendada</span>' : ''}</div>
      <h2 id="mTitle">${esc(p.name)}</h2>
      <p>${esc(p.desc)}</p>
      <h4>Especificaciones</h4>
      <dl class="kv">${p.specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}<dt>Masa</dt><dd>${p.mass ? p.mass + ' g' : '–'}</dd></dl>
      ${p.pins.length ? `<h4>Pines y conexiones</h4><div class="tbl-wrap"><table><thead><tr><th>Pin</th><th>Conectado a</th><th>Función</th></tr></thead><tbody>${conns}</tbody></table></div>` : ''}
      ${warn.map(w => `<p class="warn lvl-${w.lvl}">${esc(w.text)}</p>`).join('')}
      <div class="row m-actions">
        ${p.core ? '' : `<button class="btn ${UGV.isOn(id) ? '' : 'go'}" id="mToggle">${UGV.isOn(id) ? 'Quitar del robot' : 'Agregar al robot'}</button>`}
        ${!p.noModel && UGV.isOn(id) ? '<button class="btn" id="mLocate">Ubicar en el simulador</button>' : ''}
        ${p.sch && UGV.isOn(id) ? '<button class="btn" id="mCirc">Ver en el circuito</button>' : ''}
      </div>
    </div>`;
  modal.hidden = false; document.body.classList.add('modal-open');
  const tg = modal.querySelector('#mToggle'); if (tg) tg.onclick = () => { UGV.setOn(id, !UGV.isOn(id)); Cat.open(id); };
  const lc = modal.querySelector('#mLocate'); if (lc) lc.onclick = () => { close(); UGV.goTab('sim'); setTimeout(() => UGV.Sim.focus(id), 60); };
  const ci = modal.querySelector('#mCirc'); if (ci) ci.onclick = () => { close(); UGV.goTab('circ'); setTimeout(() => UGV.Circuit.select(id), 60); };
  startViewer(id);
  modal.querySelector('[data-close]').focus();
};
UGV.openPart = Cat.open;

function startViewer(id) {
  stopViewer();
  const cv = modal.querySelector('#mCanvas'); const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = .72; r.shadowMap.enabled = true;
  const sc = studio(r), cam = new T.PerspectiveCamera(32, 1, .1, 1000), m = modelFor(id);
  if (m) { sc.add(m); m.traverse(o => { if (o.isMesh) { o.castShadow = true; [].concat(o.material).forEach(x => { if ('envMapIntensity' in x && x.envMapIntensity === 1) x.envMapIntensity = .6; }); } }); }
  const ctr = m ? frame(cam, m, 1.7) : new T.Vector3();
  const oc = new T.OrbitControls(cam, cv); oc.target.copy(ctr); oc.enableDamping = true; oc.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; oc.autoRotateSpeed = 1.2;
  cv.addEventListener('pointerdown', () => oc.autoRotate = false, { once: true });
  const size = () => { const b = cv.parentElement.getBoundingClientRect(); r.setSize(b.width, b.height, false); cam.aspect = b.width / Math.max(1, b.height); cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(cv.parentElement); size();
  mv = { r, ro, run: true };
  const tick = () => { if (!mv || !mv.run) return; oc.update(); r.render(sc, cam); requestAnimationFrame(tick); }; tick();
}
function stopViewer() { if (mv) { mv.run = false; mv.ro.disconnect(); mv.r.dispose(); mv.r.forceContextLoss(); mv = null; } }
function close() { stopViewer(); modal.hidden = true; document.body.classList.remove('modal-open'); }
})();
