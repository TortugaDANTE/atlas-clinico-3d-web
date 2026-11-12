import * as THREE from 'three';
import { Viewer } from './viewer.js';
import { SliceView, AX } from './slice.js';
import { VolumeSliceView } from './volslice.js';
import { unlock, restore } from './unlock.js';
import { ARController } from './ar.js';
import { renderClinical, createLabChips, createSpineLabels } from './clinical.js';
import { SRC, sizeText, huText } from './cards.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const REAL = params.get('caso') === 'protegido';
const SYS = { hallazgos: 'Calcificaciones', cuerpo: 'Cuerpo', oseo: 'Óseo', urinario: 'Renal / urinario', vascular: 'Vascular (aorta, cava, venas)', digestivo: 'Órganos abdominales', muscular: 'Músculo y pared' };
const SYS_ORDER = ['oseo', 'urinario', 'hallazgos', 'vascular', 'digestivo', 'muscular', 'cuerpo'];

const viewer = new Viewer($('#stage'));
window.viewer = viewer; // útil para depuración y capturas
let ar = null, slice = null, slicePlaneMesh = null, caseData = null, vaultFetch = null;
const errors = [];
window.addEventListener('error', e => errors.push(e.message));
window.__errors = errors;

function toast(msg, ms = 5200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const badge = f => `<span class="badge ${f.srcKey}">${SRC[f.srcKey].label}</span>`;

// ---------- Capas ----------
function renderLayers() {
  const el = $('#tab-layers');
  const g = (id, label, on) => `<label><input type="checkbox" class="sw" data-g="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  let h = `<div class="glob">${g('markers', 'Marcadores de hallazgos', viewer.markersOn)}${g('labels', 'Etiquetas de anomalías (infografías)', viewer.labelsOn)}${g('lesions', 'Lesiones / calcificaciones en 3D', viewer.lesionsOn)}${g('see', 'Ver interior del órgano aislado', viewer.seeThrough)}</div>`;
  for (const sys of SYS_ORDER) {
    const list = [...viewer.organs.values()].filter(o => o.system === sys && !o.follows && !o.def.hidden_in_list && !o.slice_only);
    if (!list.length) continue;
    const allOn = list.every(o => o.visible);
    h += `<div class="grp"><span>${SYS[sys]}</span><input type="checkbox" class="sw" data-sys="${sys}" ${allOn ? 'checked' : ''} title="Mostrar/ocultar sistema"></div>`;
    for (const o of list) {
      const holo = viewer.isHolo(o), iso = viewer.isolated === o.id;
      h += `<div class="lrow ${iso ? 'iso' : ''}"><input type="checkbox" class="sw" data-org="${o.id}" ${o.visible ? 'checked' : ''}><span class="nm" data-name="${o.id}">${esc(o.label)}</span>
        <button class="mini ${holo ? 'on' : ''}" data-holo="${o.id}" title="Holográfico para este órgano">◈</button>
        ${o.shell ? '<span style="width:26px"></span>' : `<button class="mini ${iso ? 'on' : ''}" data-iso="${o.id}" title="Aislar órgano">⌖</button>`}</div>`;
    }
  }
  el.innerHTML = h;
}
$('#tab-layers').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.holo) { const o = viewer.organs.get(t.dataset.holo); const nv = !viewer.isHolo(o), glob = viewer.mode === 'holo'; viewer.setOrganHolo(o.id, nv === glob ? null : nv); }
  else if (t.dataset.iso) viewer.isolate(viewer.isolated === t.dataset.iso ? null : t.dataset.iso);
  else if (t.dataset.name) { const o = viewer.organs.get(t.dataset.name); if (!o.shell) { viewer.isolate(viewer.isolated === o.id ? null : o.id); viewer.flyToOrgan(o.id); } }
});
$('#tab-layers').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.g === 'markers') viewer.setMarkers(t.checked);
  else if (t.dataset.g === 'labels') viewer.setLabels(t.checked);
  else if (t.dataset.g === 'lesions') viewer.setLesions(t.checked);
  else if (t.dataset.g === 'see') viewer.setSeeThrough(t.checked);
  else if (t.dataset.sys) viewer.setSystemVisible(t.dataset.sys, t.checked);
  else if (t.dataset.org) viewer.setOrganVisible(t.dataset.org, t.checked);
});

// ---------- Hallazgos / Caso ----------
function renderFindings() {
  const el = $('#tab-findings'); let h = '';
  for (const f of viewer.findings) {
    const sel = viewer.selected === f.id;
    h += `<div class="fcard ${sel ? 'sel' : ''}" data-f="${f.id}"><h4>${f.id} · ${esc(f.title)}</h4><div class="loc">${esc(f.location)}</div>
      <div class="m">${sizeText(f.size_mm, f.size_text)}<i>·</i>${huText(f)}</div>${badge(f)}${f.priority ? ' <span class="badge prio">PRIORIDAD</span>' : ''}
      ${sel ? `<div class="nt">${esc(f.note)}</div><div class="act"><button class="btn sm" data-fiso="${f.id}">Aislar órgano</button><button class="btn sm" data-fslice="${f.id}">Ver corte</button></div>` : ''}</div>`;
  }
  h += '<h3 class="sec">Órganos sin hallazgos</h3>';
  for (const n of caseData.organ_notes || []) { const o = viewer.organs.get(n.organ); h += `<div class="note ok"><b>${esc(n.label || o?.label || n.organ)}</b> — ${esc(n.text)}</div>`; }
  h += '<h3 class="sec">Puntos a revisar por el médico tratante</h3><ul class="rv">';
  for (const p of (caseData.review_points || []).filter(p => p.scope !== 'clinical')) h += `<li>${esc(p.text)} ${badge({ srcKey: /ia/i.test(p.source) ? 'ia' : 'reporte' })}</li>`;
  h += '</ul>';
  if (caseData.limitations?.length) { h += '<h3 class="sec">Limitaciones</h3><ul class="rv">' + caseData.limitations.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>'; }
  el.innerHTML = h; $('#fCount').textContent = viewer.findings.length;
}
$('#tab-findings').addEventListener('click', e => {
  const b = e.target.closest('[data-fiso]'); if (b) { const f = viewer.findings.find(x => x.id === b.dataset.fiso); viewer.isolate(f.host.id); viewer.flyToOrgan(f.host.id); return; }
  const s = e.target.closest('[data-fslice]'); if (s) { openSliceFor(s.dataset.fslice); return; }
  const c = e.target.closest('[data-f]'); if (c) focusFinding(c.dataset.f);
});
function focusFinding(id) { viewer.select(id); viewer.flyToFinding(id); syncSlice(id, false); }
function renderCase() {
  const c = caseData.case;
  $('#tab-case').innerHTML = `<div class="kv"><span>Caso</span><b>${esc(c.title)} · ${esc(c.id)}</b><span>Paciente</span><div>${esc(c.patient)}</div><span>Estudio</span><div>${esc(c.study)}</div><span>Equipo</span><div>${esc(c.equipment)}</div><span>Institución</span><div>${esc(c.institution)}</div><span>Fecha</span><div>${esc(c.date)}</div>${c.series ? `<span>Series</span><div>${esc(c.series)}</div>` : ''}</div>${(caseData.metrics || []).length ? '<h3 class="sec">Mediciones</h3>' + caseData.metrics.map(m => `<div class="note"><b>${esc(m.label)}:</b> ${esc(m.value)}<br><span class="fine">${esc(m.note || '')}</span></div>`).join('') : ''}
  <h3 class="sec">Resumen general</h3><div class="note">${esc(c.general_summary)}</div>
  <h3 class="sec">Origen de cada dato</h3><div class="note"><span class="badge reporte">REPORTE</span> viene de un informe radiológico firmado.<br><span class="badge ia">INTERPRETACIÓN IA</span> es una lectura automática de las imágenes, aún sin validación médica.</div>
  <h3 class="sec">Aviso</h3><div class="note">${esc(c.disclaimer)}</div>`;
}

// ---------- Corte 2D ----------
function syncSlice(fid, open) {
  const f = viewer.findings.find(x => x.id === fid); if (!f) return;
  const w = f.pos; // en reposo (sin explosión)
  slice.pos.axial = w.y; slice.pos.coronal = w.z; slice.pos.sagital = w.x; updateSlice(); if (open) { document.body.classList.add('show-slice'); }
}
function openSliceFor(fid) { syncSlice(fid, true); if (viewer.narrow) setSheet('slice'); }
function updateSlice() {
  const r = slice.render(), A = (slice.AX || AX)[slice.plane], inp = $('#sliceRange');
  inp.min = A.range[0]; inp.max = A.range[1]; inp.value = slice.pos[slice.plane];
  $('#sliceVal').textContent = `${A.name}: ${slice.pos[slice.plane].toFixed(0)} mm`;
  updatePlane3D();
}
function updatePlane3D() {
  if (!slicePlaneMesh) {
    slicePlaneMesh = new THREE.Group();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3fdcff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x3fdcff, transparent: true, opacity: 0.9 }));
    slicePlaneMesh.add(q, l); slicePlaneMesh.renderOrder = 15; viewer.model.add(slicePlaneMesh);
  }
  slicePlaneMesh.visible = $('#slicePlane').checked;
  const v = slice.pos[slice.plane], p = slice.plane, c = slice.center || [0, -7, 0];
  const [pw, ph] = slice.planeSize ? slice.planeSize(p) : (p === 'axial' ? [430, 260] : p === 'coronal' ? [430, 565] : [270, 565]);
  slicePlaneMesh.rotation.set(0, 0, 0);
  // c = [x, y, z] del centro del volumen (app)
  if (p === 'axial') { slicePlaneMesh.rotation.x = -Math.PI / 2; slicePlaneMesh.position.set(c[0], v, c[2]); }
  else if (p === 'coronal') { slicePlaneMesh.position.set(c[0], c[1], v); }
  else { slicePlaneMesh.rotation.y = Math.PI / 2; slicePlaneMesh.position.set(v, c[1], c[2]); }
  slicePlaneMesh.scale.set(pw, ph, 1);
}
$('#sliceTabs').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; $$('#sliceTabs button').forEach(x => x.classList.toggle('on', x === b)); slice.plane = b.dataset.p; updateSlice(); });
let sliceTimer; $('#sliceRange').addEventListener('input', e => { slice.pos[slice.plane] = +e.target.value; clearTimeout(sliceTimer); sliceTimer = setTimeout(updateSlice, 16); });
$('#slicePlane').addEventListener('change', updatePlane3D);

// ---------- Barra de herramientas ----------
function setMode(m) { viewer.setMode(m); document.body.classList.toggle('mode-holo', m === 'holo'); document.body.classList.toggle('mode-real', m === 'real'); $$('#modeSeg button,#arModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); }
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
$('#arModeSeg').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
$('#explode').addEventListener('input', e => { viewer.setExplode(e.target.value / 100); $('#arExplode').value = e.target.value; });
$('#arExplode').addEventListener('input', e => { viewer.setExplode(e.target.value / 100); $('#explode').value = e.target.value; });
$('#btnReset').addEventListener('click', () => viewer.resetView());
$('#btnShowAll').addEventListener('click', () => { viewer.showAll(); viewer.select(null); $('#explode').value = 0; viewer.setExplode(0); });
$('#arLabels').addEventListener('click', () => viewer.setLabels(!viewer.labelsOn));
viewer.addEventListener('state', () => {
  $('#btnShowAll').hidden = !viewer.isolated;
  renderLayers(); if (caseData) renderFindings();
});
viewer.addEventListener('select', () => { if (viewer.selected) syncSlice(viewer.selected, false); });
viewer.addEventListener('hover', e => {
  const t = $('#tip'), d = e.detail;
  if (d.organ || d.finding) { t.hidden = false; t.style.left = d.x + 'px'; t.style.top = d.y + 'px'; t.textContent = d.finding ? 'Hallazgo ' + d.finding : d.organ.label; } else t.hidden = true;
});

// ---------- Hojas móviles ----------
function setSheet(name) {
  const cur = ['layers', 'findings', 'slice', 'case', 'clinic'].find(n => document.body.classList.contains('sheet-' + n));
  ['layers', 'findings', 'slice', 'case', 'clinic'].forEach(n => document.body.classList.remove('sheet-' + n));
  if (name && name !== cur) { document.body.classList.add('sheet-' + name); if (name !== 'slice') setTab(name); }
  $$('#mnav button').forEach(b => b.classList.toggle('on', document.body.classList.contains('sheet-' + b.dataset.sheet)));
}
function setTab(name) { $$('#leftTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name)); $$('.tabbody').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name)); syncClinicMode(); }
// Modo «Clínicos»: etiquetas de laboratorio junto a los riñones; se apagan las infografías de hallazgos para no encimar y se restauran al salir
let labChips = null, spineGrp = null, clinicOn = false, labelsBefore = true;
function syncClinicMode() {
  const on = !!labChips && $('#tab-clinic').classList.contains('on') && (innerWidth > 760 || document.body.classList.contains('sheet-clinic'));
  if (on === clinicOn) return; clinicOn = on; labChips.visible = on; if (!on && spineGrp) spineGrp.visible = false;
  if (on) { labelsBefore = viewer.labelsOn; viewer.setLabels(false); } else viewer.setLabels(labelsBefore);
}
function showKidneys() {
  viewer.setSystemVisible('oseo', false); viewer.isolate(null);
  const a = viewer.organs.get('rinon_derecho'), b = viewer.organs.get('rinon_izquierdo');
  if (a && b) viewer.flyTo(viewer.worldCenterOf(a).add(viewer.worldCenterOf(b)).multiplyScalar(0.5), viewer.fitRegion(330), 900, new THREE.Vector3(0, 0.1, 1));
}
$('#btnClinic').addEventListener('click', () => { if (viewer.narrow) setSheet('clinic'); else { setTab('clinic'); } });
$('#tab-clinic').addEventListener('click', e => {
  if (e.target.closest('[data-kid]')) showKidneys();
  const fl = e.target.closest('[data-fly]'); if (fl) { const id = fl.dataset.fly; labelsBefore = true; viewer.setLabels(true); viewer.select(id); viewer.flyToFinding(id); if (viewer.narrow) setSheet(null); return; }
  const ov = e.target.closest('[data-overlay]'); if (ov && spineGrp) {
    spineGrp.visible = !spineGrp.visible; ov.textContent = spineGrp.visible ? 'Ocultar niveles' : 'Ver niveles en 3D';
    if (spineGrp.visible) { viewer.select(null); labelsBefore = false; viewer.setLabels(false); viewer.setOrganVisible('huesos', true); const c = spineGrp.userData.center; if (c) viewer.flyTo(c, viewer.fitRegion(380), 900, new THREE.Vector3(0.55, 0.05, 1)); }
  }
});
$('#leftTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('#mnav').addEventListener('click', e => { const b = e.target.closest('[data-sheet]'); if (b) setSheet(b.dataset.sheet); });

// ---------- Recorrido guiado ----------
const CFG = REAL ? { off: ['oseo'], organ: 'rinon_derecho', fid: 'H2' } : { off: ['oseo', 'digestivo', 'muscular', 'cuerpo'], organ: 'rinon_derecho', fid: 'H2' };
const DEMO = [
  { n: 'TOQUE 1 DE 3', t: 'Cuerpo completo', p: REAL ? 'Estudio real: microlitiasis renal bilateral y dos calcificaciones fuera de la vía urinaria. Los marcadores señalan cada hallazgo con todo el modelo visible.' : 'Caso de ejemplo con cálculos renales bilaterales, una calcificación extrarrenal y un lipoma. Los marcadores señalan cada hallazgo aun con todos los sistemas encendidos.', btn: 'Apagar sistemas →',
    on() { viewer.showAll(); viewer.select(null); setMode('real'); $('#explode').value = 0; viewer.setExplode(0); viewer.resetView(); } },
  { n: 'TOQUE 2 DE 3', t: 'Apagar sistemas', p: REAL ? 'Esqueleto apagado: quedan los riñones y las calcificaciones. Cada sistema se enciende o apaga desde el panel Capas.' : 'Óseo, órganos abdominales y músculo apagados: quedan la vía urinaria y los vasos. Cada sistema se enciende o apaga desde el panel Capas.', btn: 'Llegar a la anomalía →',
    on() { for (const s of CFG.off) viewer.setSystemVisible(s, false); viewer.flyTo(new THREE.Vector3(0, REAL ? 90 : -30, -20), 620, 900); } },
  { n: 'TOQUE 3 DE 3', t: 'Llegar a la anomalía', p: 'Riñón derecho aislado y en vista explotada. Las infografías muestran órgano, ubicación, tamaño en mm, UH y la fuente (reporte o interpretación IA). Toca una tarjeta para ampliarla.', btn: 'Terminar',
    on() { viewer.isolate(CFG.organ); $('#explode').value = 30; viewer.setExplode(0.3); viewer.select(CFG.fid); setTimeout(() => { viewer.flyToFinding(CFG.fid); syncSlice(CFG.fid, false); }, 700); } },
];
let demoI = -1;
function demoShow(i) {
  demoI = i; const c = $('#coach'); if (i < 0 || i >= DEMO.length) { c.hidden = true; return; }
  const s = DEMO[i]; $('#coachN').textContent = s.n; $('#coachT').textContent = s.t; $('#coachP').textContent = s.p; $('#coachNext').textContent = s.btn; c.hidden = false; s.on();
}
function demoStart() { $('#hero').classList.add('gone'); demoShow(0); }
$('#coachNext').addEventListener('click', () => { if (demoI >= DEMO.length - 1) demoShow(-1); else demoShow(demoI + 1); });
$('#coachExit').addEventListener('click', () => demoShow(-1));
$('#heroStart').addEventListener('click', demoStart); $('#btnDemo').addEventListener('click', demoStart);
$('#heroClose').addEventListener('click', () => $('#hero').classList.add('gone'));

// ---------- Presentación / Acerca de ----------
const open = id => { $(id).hidden = false; }; const closeOv = e => { if (e.target.matches('[data-close]') || e.target.classList.contains('overlay')) e.currentTarget.hidden = true; };
$('#btnPitch').addEventListener('click', () => open('#pitch')); $('#btnAbout').addEventListener('click', () => open('#about'));
$('#btnLock').textContent = REAL ? '◐ Ejemplo' : '🔒 Caso real'; $('#btnLock').addEventListener('click', () => { location.search = REAL ? '' : '?caso=protegido'; });
$('#pitch').addEventListener('click', closeOv); $('#about').addEventListener('click', closeOv);
window.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay').forEach(o => o.hidden = true); });
function renderAbout() {
  const cr = caseData.credits || {};
  const ex = caseData.example !== false;
  $('#aboutBody').innerHTML = `<p>Visor anatómico 3D con realidad aumentada para apoyo a la decisión médica. ${ex ? '<b>Esta versión es una demostración con datos de ejemplo</b>: el modelo y los hallazgos son ficticios.' : '<b>Estudio real, confidencial.</b> Los hallazgos son interpretación por IA, sin reporte radiológico oficial.'}</p>
  <h2>Origen de los datos</h2><ul><li>${esc(cr.model)}</li>${ex ? `<li>El caso («${esc(caseData.case.title)}») es sintético; ninguna imagen ni medida proviene de un paciente real.</li><li>Los cortes 2D se calculan a partir de ese mismo modelo.</li>` : '<li>Los datos viajan cifrados (AES-256-GCM, clave PBKDF2-SHA256) y se descifran solo en este navegador.</li>'}</ul>
  <h2>Cómo cargaría un caso real</h2><p>Un archivo <code>case.json</code> (hallazgos con posición en mm, tamaño, UH, órgano, fuente) más mallas GLB/STL en la misma escala en mm. Los datos se procesan en el navegador, sin subirse a ningún servidor.</p>
  <h2>Tecnología y licencias</h2><ul>${(cr.libs || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
  <h2>AR sin marcadores</h2><p>Android (Chrome + ARCore): WebXR con detección de superficies; toca para colocar, arrastra para girar, pellizca para escalar. iPhone/iPad: vista AR del sistema (Quick Look) sobre cualquier superficie. En escritorio: modo orbital 3D.</p>
  <h2>Aviso</h2><p>${esc(caseData.case.disclaimer)}</p><p><button class="btn ghost" id="btnLockSession">🔒 Bloquear y salir</button></p>`;
  $('#btnLockSession').onclick = () => { vault?.lock(); location.href = location.pathname; };
}

// ---------- AR ----------
let xrOK = false, mvEl = null, vault = null;
// Caso real: el GLB para Quick Look / Scene Viewer se genera EN EL NAVEGADOR con los datos ya descifrados (nunca se sube).
async function makeARGlb() {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const g = new THREE.Group();
  for (const o of viewer.organs.values()) {
    if (o.shell || o.slice_only) continue;
    const m = new THREE.Mesh(o.real.geometry, new THREE.MeshStandardMaterial({ color: o.def.color || 0xcccccc, roughness: 0.55 })); m.name = o.id; g.add(m);
  }
  g.scale.setScalar(0.001);
  const buf = await new GLTFExporter().parseAsync(g, { binary: true });
  return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
}
async function ensureMV() {
  if (mvEl) return mvEl;
  await import('../vendor/model-viewer.min.js');
  mvEl = document.createElement('model-viewer');
  Object.assign(mvEl.style, { position: 'fixed', width: '2px', height: '2px', opacity: 0, pointerEvents: 'none', left: 0, top: 0 });
  mvEl.setAttribute('src', REAL ? await makeARGlb() : URL.createObjectURL(new Blob([await vault.get('ga.bin')], { type: 'model/gltf-binary' }))); mvEl.setAttribute('ar', ''); mvEl.setAttribute('ar-modes', 'scene-viewer quick-look');
  mvEl.setAttribute('ar-placement', 'floor'); mvEl.setAttribute('ar-scale', 'auto'); mvEl.setAttribute('alt', 'Modelo anatómico genérico de ejemplo');
  mvEl.setAttribute('shadow-intensity', '0'); document.body.appendChild(mvEl);
  await customElements.whenDefined('model-viewer'); return mvEl;
}
async function initAR() {
  xrOK = await ARController.supported();
  ar = new ARController(viewer, $('#ar-hud')); window.ar = ar;
  $('#ar-hud').querySelectorAll('.ar-ui').forEach(u => u.addEventListener('beforexrselect', e => e.preventDefault()));
  $('#arExit').addEventListener('click', () => ar.stop()); $('#arRe').addEventListener('click', () => ar.reposition());
  if (!xrOK && /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)) ensureMV().catch(() => { });
  $('#btnAR').title = xrOK ? 'AR sin marcadores (WebXR): toca una superficie para colocar' : 'AR con visor del sistema (Quick Look / Scene Viewer) o modo orbital en escritorio';
}
$('#btnAR').addEventListener('click', async () => {
  try {
    if (xrOK) { await ar.start(); return; }
    const mv = await ensureMV();
    if (mv.canActivateAR) { mv.activateAR(); return; }
    toast('La realidad aumentada requiere un teléfono compatible: Android con Chrome y ARCore (WebXR) o iPhone/iPad (Quick Look). En este equipo puedes explorar el modelo en 3D (arrastra, rueda para zoom).');
  } catch (e) { console.error(e); toast('No se pudo iniciar la AR: ' + e.message); }
});

// ---------- Márgenes del visor según paneles abiertos ----------
function updateInsets() {
  const w = innerWidth, h = innerHeight; let l = 0, r = 0, t = 0, b = 0;
  if (w > 760) { l = 340; r = (w > 1180 || document.body.classList.contains('show-slice')) ? 330 : 0; t = 50; b = 80; }
  else { t = 50; const sheet = ['layers', 'findings', 'slice', 'case', 'clinic'].some(n => document.body.classList.contains('sheet-' + n)); b = sheet ? Math.min(h * 0.40, 380) + 200 : 200; }
  viewer.setInsets(l, r, t, b);
}
new MutationObserver(() => { updateInsets(); syncClinicMode(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
addEventListener('resize', updateInsets); updateInsets();

// ---------- Arranque ----------
// Pantalla de contraseña reutilizable: action(valor, onProgress) debe lanzar Error si la clave es incorrecta
function gate(action, o = {}) {
  document.body.classList.add('gated'); const g = $('#gate'), inp = $('#gatePw'), msg = $('#gateMsg'), btn = $('#gateGo');
  $('#gateTitle').textContent = o.title || 'Acceso privado';
  if (o.text) $('#gateText').textContent = o.text;
  inp.placeholder = o.placeholder || 'Contraseña'; inp.setAttribute('aria-label', inp.placeholder); inp.autocomplete = 'off';
  $('#gateBack').hidden = !o.back; btn.textContent = o.button || 'Entrar'; btn.disabled = false; msg.textContent = ''; inp.value = '';
  $('#gateShow').checked = false; inp.type = 'password'; $('#gateShow').onchange = e => { inp.type = e.target.checked ? 'text' : 'password'; };
  g.hidden = false; inp.focus();
  return new Promise(res => {
    const go = async () => {
      if (!inp.value) return; btn.disabled = true; msg.textContent = 'Derivando clave…'; msg.className = 'gate-msg';
      await new Promise(r => setTimeout(r, 30));
      try { const v = await action(inp.value, t => msg.textContent = t); inp.value = ''; g.hidden = true; document.body.classList.remove('gated'); res(v); }
      catch (e) { msg.textContent = e.message; msg.className = 'gate-msg err'; btn.disabled = false; inp.select(); }
    };
    btn.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}
(async () => {
  try {
    // Todo el sitio (demo incluida) está cifrado: primero la contraseña (o la clave de esta pestaña), luego el caso pedido
    vault = await restore('vault/') || await gate((pw, t) => unlock('vault/', pw, t));
    document.body.classList.remove('gated'); $('#gate').hidden = true;
    if (REAL && vault.isCaseProtected('c.bin') && !await vault.hasCaseKey('c.bin'))
      await gate(pw => vault.unlockCase('c.bin', pw), { title: 'Caso protegido', text: 'Este caso tiene una segunda llave. Escribe el primer nombre y el primer apellido del paciente (sin importar mayúsculas ni acentos). Se descifra solo en tu navegador.', placeholder: 'Primer nombre y primer apellido', auto: 'off', button: 'Abrir caso', back: true });
    const opened = await vault.openCase(REAL ? 'c.bin' : 'd.bin'); caseData = opened.caseData; const fb = opened.fetchBuf;
    await viewer.loadCase(caseData, '', fb); updateInsets(); viewer.initView();
    if (caseData.volume) {
      const buf = await fb(caseData.volume.file); slice = new VolumeSliceView($('#sliceCanvas'), viewer, new Uint8Array(buf), caseData.volume);
      document.querySelector('#right .tag').textContent = 'estudio real';
      document.querySelector('#right .fine').textContent = 'Cortes originales del estudio (submuestreados 2×), sincronizados con el modelo 3D.';
    } else slice = new SliceView($('#sliceCanvas'), viewer);
    window.slice = slice;
    $('#caseChipText').textContent = `${caseData.case.title} · ${caseData.case.subtitle}`;
    $('.hero-k').textContent = REAL ? 'CASO REAL · CONFIDENCIAL' : 'CASO CLÍNICO DE EJEMPLO';
    $('.hero-t').textContent = caseData.case.subtitle;
    if (REAL) { $('#disclaimer').textContent = caseData.case.disclaimer; $('.dot').style.background = '#ff6b6b'; document.title = 'Atlas Clínico 3D'; }
    renderLayers(); renderFindings(); renderCase(); renderAbout();
    if (caseData.clinical?.documents?.length) { renderClinical($('#tab-clinic'), caseData, opened.fetchBuf); labChips = createLabChips(viewer, caseData); spineGrp = createSpineLabels(viewer, caseData); $$('#tabClinic,#mnClinic,#btnClinic').forEach(b => b.hidden = false); }
    syncSlice(viewer.findings[0].id, false);
    await initAR();
    document.body.classList.add('ready'); window.__ready = true;
    if (params.has('nohero')) $('#hero').classList.add('gone');
  } catch (e) { console.error(e); errors.push(String(e)); toast('Error al cargar: ' + e.message, 15000); }
})();
