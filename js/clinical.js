// Panel «Clínicos»: fichas clínicas (una por documento/tema) para el médico tratante.
// Esquema (case.clinical = { documents: [...] }); cada ficha/documento:
//   { id, type: 'resumen'|'informe'|'laboratorio'|'impresion'|'revision'|'imagen'|'nota', title, date: 'AAAA-MM-DD', time?, date_text,
//     source: 'reporte'|'interpretacion_ia'|'transcrito_de_fotos', verify?, status: { level: 'ok'|'warn'|'info', text },
//     alerts?: [{ level, text }], summary?, bullets?[], points?[],
//     key_values: [{ name, value, unit?, flag: 'normal'|'low'|'high'|'border'|'info'|'warn', flag_text?, highlight?, organ?, why? }],
//     markdown: 'documento completo en Markdown', filename: 'nombre.md' }
// Para agregar más estudios de un paciente basta añadir objetos a documents. Todo viaja dentro del payload cifrado del caso.
import * as THREE from 'three';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = { resumen: ['📋', 'Resumen'], informe: ['🩻', 'Informe de imagen'], laboratorio: ['🧪', 'Laboratorio'], impresion: ['🩺', 'Impresión clínica'], revision: ['☑', 'Revisión'], imagen: ['🖼', 'Imagen'], nota: ['📝', 'Nota'] };
const SRCB = { interpretacion_ia: ['ia', 'INTERPRETACIÓN IA'], reporte: ['reporte', 'REPORTE'], transcrito_de_fotos: ['tr', 'TRANSCRITO DE FOTOS'] };
const srcBadge = d => { const [k, l] = SRCB[d.source] || ['tr', String(d.source || '').toUpperCase()]; return `<span class="badge ${k}">${l}</span>`; };
const GLYPH = { normal: '✓', low: '↓', high: '↑', border: '●', info: 'ℹ', warn: '⚠' };

// ---- Markdown mínimo y seguro (escapa todo antes de dar formato) ----
function inline(t) { return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>'); }
export function mdToHtml(md) {
  const L = String(md).replace(/\r/g, '').split('\n'); let h = '', i = 0;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { h += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; i++; continue; }
    if (/^---+$/.test(l.trim())) { h += '<hr>'; i++; continue; }
    if (l.startsWith('>')) { let b = []; while (i < L.length && L[i].startsWith('>')) b.push(L[i++].replace(/^>\s?/, '')); h += `<blockquote>${inline(b.join(' '))}</blockquote>`; continue; }
    if (l.trim().startsWith('|')) {
      const rows = []; while (i < L.length && L[i].trim().startsWith('|')) rows.push(L[i++].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const body = rows.filter((r, k) => !(k === 1 && r.every(c => /^:?-+:?$/.test(c))));
      h += '<div class="tw"><table>' + body.map((r, k) => `<tr>${r.map(c => k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</table></div>'; continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ord = /^\s*\d+\./.test(l), items = []; while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) items.push(L[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      h += `<${ord ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`; continue;
    }
    const p = []; while (i < L.length && L[i].trim() && !/^(#{1,4}\s|>|\||\s*([-*]|\d+\.)\s|---)/.test(L[i])) p.push(L[i++]); h += `<p>${inline(p.join(' '))}</p>`;
  }
  return h;
}

const kvHtml = k => `<div class="kvi fl-${k.flag || 'normal'} ${k.highlight ? 'hl' : ''}"><small>${esc(k.name)}${k.organ ? ' <span class="kid">riñón</span>' : ''}</small><b><i class="gl">${GLYPH[k.flag || 'normal'] || ''}</i>${esc(k.value)}${k.unit ? ` <u>${esc(k.unit)}</u>` : ''}</b>${k.flag_text ? `<em>${esc(k.flag_text)}</em>` : ''}</div>`;
function fichaHtml(d, { full = false } = {}) {
  const [ic, tl] = TYPES[d.type] || ['📄', d.type], lv = d.status?.level || 'info';
  let h = `<article class="ficha st-${lv}" data-doc="${esc(d.id)}"><header><span class="ic">${ic}</span><div class="tt"><b>${esc(d.title)}</b><small>${esc(tl)} · ${esc(d.date_text || d.date)}</small></div>${srcBadge(d)}</header>`;
  if (d.status) h += `<div class="stat st-${lv}"><i></i>${esc(d.status.text)}</div>`;
  if (d.verify) h += `<div class="note warn">⚠ ${esc(d.verify)}</div>`;
  for (const a of d.alerts || []) h += `<div class="note warn">⚠ ${esc(a.text)}</div>`;
  if (d.key_values?.length) h += `<div class="kvg">${d.key_values.map(kvHtml).join('')}</div>`;
  if (d.summary) h += `<p class="sum">${esc(d.summary)}</p>`;
  if (d.markdown) h += full ? `<div class="md">${mdToHtml(d.markdown)}</div>`
    : `<details class="full"><summary>Ver documento completo</summary><div class="md">${mdToHtml(d.markdown)}</div></details><div class="acts"><button class="btn sm" data-dl="${esc(d.id)}">⬇ Descargar .md</button></div>`;
  return h + '</article>';
}
export function renderClinical(el, caseData) {
  const docs = caseData.clinical?.documents || [];
  const hl = []; for (const d of docs) for (const k of d.key_values || []) if (k.highlight && !hl.some(x => x.name === k.name)) hl.push(k);
  let h = `<div class="ctools"><button class="btn sm" data-print="1">🖨 Imprimir / PDF</button><button class="btn sm" data-dlall="1">⬇ Todo (.md)</button></div>`;
  if (hl.length) h += `<h3 class="sec">Junto a los riñones</h3><div class="hlrow">${hl.map(kvHtml).join('')}</div><button class="btn sm" data-kid="1">Ver en los riñones (3D)</button>`;
  h += `<h3 class="sec">Fichas clínicas <em class="cnt">${docs.length}</em></h3>` + docs.map(d => fichaHtml(d)).join('');
  h += `<div class="note">Apoyo para el médico tratante; no sustituye el criterio clínico ni el reporte original.</div>`;
  el.innerHTML = h;
  el.onclick = e => {
    const dl = e.target.closest('[data-dl]'); if (dl) { const d = docs.find(x => x.id === dl.dataset.dl); if (d) download(d.filename || d.id + '.md', d.markdown); return; }
    if (e.target.closest('[data-dlall]')) download('fichas-clinicas.md', docs.map(d => d.markdown).join('\n\n---\n\n'));
    if (e.target.closest('[data-print]')) printAll(caseData);
  };
}
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
// Vista imprimible (todas las fichas completas); el navegador permite «Guardar como PDF»
export function printAll(caseData) {
  let ps = document.getElementById('printSheet'); if (!ps) { ps = document.createElement('div'); ps.id = 'printSheet'; document.body.appendChild(ps); }
  const c = caseData.case, docs = caseData.clinical?.documents || [];
  ps.innerHTML = `<h1>Atlas Clínico 3D · Fichas clínicas</h1><p class="pmeta"><b>${esc(c.patient)}</b><br>${esc(c.study)} · ${esc(c.date)} · ${esc(c.institution)}</p>` + docs.map(d => fichaHtml(d, { full: true })).join('') +
    `<p class="pfoot">${esc(c.disclaimer)} Documento generado en el navegador el ${new Date().toLocaleString('es-MX')}.</p>`;
  const done = () => { removeEventListener('afterprint', done); ps.innerHTML = ''; }; addEventListener('afterprint', done);
  setTimeout(() => window.print(), 100);
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
  const items = []; for (const d of caseData.clinical?.documents || []) for (const k of d.key_values || []) if (k.highlight && !items.some(x => x.name === k.name)) items.push(k);
  const grp = new THREE.Group(); grp.visible = false; grp.renderOrder = 40;
  if (items.length) for (const [id, label, side] of [['rinon_derecho', 'derecho', -1], ['rinon_izquierdo', 'izquierdo', 1]]) {
    const o = viewer.organs.get(id); if (!o) continue;
    const c = viewer.worldCenterOf(o), sp = chipSprite(`Laboratorio · riñón ${label}`, items.map(i => ({ t: i.name, v: `${String(i.value).toLowerCase() === 'negativo' ? 'negativo' : i.value}${i.unit ? ' ' + i.unit : ''}`, warn: ['border', 'high', 'low'].includes(i.flag) })));
    const p = new THREE.Vector3(c.x - side * 6, c.y - 58 - sp.scale.y / 2, c.z + 40); sp.position.copy(p);
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([c.clone(), p.clone().add(new THREE.Vector3(0, sp.scale.y / 2 - 2, 0))]), new THREE.LineBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.8, depthTest: false }));
    ln.renderOrder = 39; grp.add(ln, sp);
  }
  viewer.model.add(grp); return grp;
}
