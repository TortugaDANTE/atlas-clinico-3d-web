// Panel «Clínicos»: documentos clínicos del paciente (laboratorio, impresiones, y los que se agreguen después).
// Esquema (case.clinical = { documents: [ ... ] }), cada documento:
//   { id, type: 'laboratorio'|'impresion'|'informe'|'nota'|..., title, date: 'AAAA-MM-DD', date_text, source: 'reporte'|'interpretacion_ia'|'transcrito_de_fotos',
//     source_label?, verify?, meta?: [[k, v]], alerts?: [{level, text}],
//     sections?: [{ id, title, items: [{ name, value, unit, ref, flag: 'normal'|'low'|'high'|'border', flag_text?, highlight?, organ?, why? }]}],
//     summary?, bullets?[] }
// Para agregar otro estudio basta añadir un objeto a documents (el panel lo lista por fecha). Todo viaja dentro del payload cifrado del caso.
import * as THREE from 'three';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = { laboratorio: ['🧪', 'Laboratorio'], impresion: ['🩺', 'Impresión clínica'], informe: ['📄', 'Informe'], imagen: ['🖼', 'Imagen'], nota: ['📝', 'Nota'] };
const SRCB = { interpretacion_ia: ['ia', 'INTERPRETACIÓN IA'], reporte: ['reporte', 'REPORTE'], transcrito_de_fotos: ['tr', 'TRANSCRITO DE FOTOS'] };
const srcBadge = d => { const [k, l] = SRCB[d.source] || ['tr', (d.source_label || d.source || '').toUpperCase()]; return `<span class="badge ${k}">${esc(d.source_label || l)}</span>`; };
const FLAG = { normal: '', low: 'bajo', high: 'alto', border: 'límite' };

function itemRow(it) {
  const f = it.flag || 'normal', ft = it.flag_text || FLAG[f];
  return `<tr class="${f !== 'normal' ? 'fl-' + f : ''} ${it.highlight ? 'hl' : ''}"><td>${esc(it.name)}${it.organ ? ' <span class="kid" title="Relacionado con los riñones">riñón</span>' : ''}</td><td><b>${esc(it.value)}</b> <small>${esc(it.unit || '')}</small></td><td class="rf">${esc(it.ref || '')}${ft ? `<div class="flg">${esc(ft)}</div>` : ''}</td></tr>`;
}
function docBody(d) {
  let h = '';
  if (d.verify) h += `<div class="note warn">⚠ ${esc(d.verify)}</div>`;
  for (const a of d.alerts || []) h += `<div class="note warn">⚠ ${esc(a.text)}</div>`;
  if (d.meta?.length) h += `<div class="kv">${d.meta.map(([k, v]) => `<span>${esc(k)}</span><div>${esc(v)}</div>`).join('')}</div>`;
  const hl = (d.sections || []).flatMap(s => s.items.filter(i => i.highlight));
  if (hl.length) h += `<h3 class="sec">Junto a los riñones</h3><div class="hlgrid">${hl.map(i => `<button class="hlcard fl-${i.flag || 'normal'}" data-kid="1"><b>${esc(i.name)}</b><span>${esc(i.value)} <small>${esc(i.unit || '')}</small></span><em>${esc(i.flag_text || '')}</em><i>${esc(i.why || '')}</i></button>`).join('')}</div><button class="btn sm" data-kid="1">Ver en los riñones (3D)</button>`;
  for (const s of d.sections || []) h += `<h3 class="sec">${esc(s.title)}</h3><table class="lab"><tbody>${s.items.map(itemRow).join('')}</tbody></table>`;
  if (d.summary) h += `<div class="note">${esc(d.summary)}</div>`;
  if (d.bullets?.length) h += `<ul class="rv">${d.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;
  return h;
}
export function renderClinical(el, caseData) {
  const cl = caseData.clinical, docs = [...(cl?.documents || [])].sort((a, b) => String(b.date + (b.time || '')).localeCompare(String(a.date + (a.time || ''))));
  let h = `<h3 class="sec">Estudios clínicos <em class="cnt">${docs.length}</em></h3>`;
  docs.forEach((d, i) => {
    const [ic, tl] = TYPES[d.type] || ['📄', d.type];
    h += `<details class="doc" ${i < 2 ? 'open' : ''}><summary><span class="ic">${ic}</span><span class="tt"><b>${esc(d.title)}</b><small>${esc(tl)} · ${esc(d.date_text || d.date)}</small></span>${srcBadge(d)}</summary>${docBody(d)}</details>`;
  });
  const pts = (caseData.review_points || []).filter(p => p.scope === 'clinical');
  if (pts.length) h += `<h3 class="sec">Puntos a revisar por el médico tratante</h3><ul class="rv">${pts.map(p => `<li>${esc(p.text)} <span class="badge ia">INTERPRETACIÓN IA</span></li>`).join('')}</ul>`;
  h += `<div class="note">Valores y textos de apoyo para el médico tratante; no sustituyen el criterio clínico ni el reporte original.</div>`;
  el.innerHTML = h;
}

// ---- Etiquetas 3D junto a cada riñón (solo mientras el panel Clínicos está abierto) ----
function chipSprite(title, rows) {
  const W = 560, rowH = 46, H = 56 + rows.length * rowH + 12, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), FONT = '"Inter","Segoe UI",system-ui,sans-serif';
  g.fillStyle = 'rgba(12,20,30,.93)'; g.strokeStyle = '#ffd58a'; g.lineWidth = 3; g.beginPath(); g.roundRect(3, 3, W - 6, H - 6, 18); g.fill(); g.stroke();
  g.fillStyle = '#ffd58a'; g.font = `700 24px ${FONT}`; g.fillText(title, 20, 38);
  rows.forEach((r, i) => {
    const y = 56 + i * rowH + 30; g.fillStyle = r.warn ? '#ffb547' : '#40d6aa'; g.beginPath(); g.arc(28, y - 9, 7, 0, 7); g.fill();
    g.fillStyle = '#e8eef5'; g.font = `600 25px ${FONT}`; g.fillText(r.t, 46, y); g.textAlign = 'right'; g.fillStyle = r.warn ? '#ffb547' : '#9fe8cf'; g.font = `700 25px ${FONT}`; g.fillText(r.v, W - 20, y); g.textAlign = 'left';
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sp.renderOrder = 40; const wmm = 128; sp.scale.set(wmm, wmm * H / W, 1); return sp;
}
export function createLabChips(viewer, caseData) {
  const items = (caseData.clinical?.documents || []).flatMap(d => (d.sections || []).flatMap(s => s.items.filter(i => i.highlight)));
  const grp = new THREE.Group(); grp.visible = false; grp.renderOrder = 40;
  if (items.length) for (const [id, label, side] of [['rinon_derecho', 'derecho', -1], ['rinon_izquierdo', 'izquierdo', 1]]) {
    const o = viewer.organs.get(id); if (!o) continue;
    const c = viewer.worldCenterOf(o), sp = chipSprite(`Laboratorio · riñón ${label}`, items.map(i => ({ t: i.name === 'Sangre (hemoglobina)' ? 'Sangre en orina' : i.name === 'pH' ? 'pH urinario' : i.name, v: i.name === 'Sangre (hemoglobina)' ? 'negativo' : `${i.value}${i.unit ? ' ' + i.unit : ''}`, warn: i.flag === 'border' || i.flag === 'high' || i.flag === 'low' })));
    const p = new THREE.Vector3(c.x - side * 6, c.y - 58 - sp.scale.y / 2, c.z + 40); sp.position.copy(p);
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([c.clone(), p.clone().add(new THREE.Vector3(0, sp.scale.y / 2 - 2, 0))]), new THREE.LineBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.8, depthTest: false }));
    ln.renderOrder = 39; grp.add(ln, sp);
  }
  viewer.model.add(grp); return grp;
}
