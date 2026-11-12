// Edición local de hallazgos y notas con historial de versiones y respaldo cifrado.
// Los cambios NO se escriben en el sitio público: viven cifrados en este navegador (IndexedDB) y en archivos de respaldo que tú descargas.
import { openStore } from './store.js';

export const FIELDS = [
  ['title', 'Título', 'input'], ['location', 'Ubicación', 'input'], ['size_text', 'Tamaño (texto, p. ej. ≈ 4 × 3 mm)', 'input'],
  ['hu_text', 'Densidad (texto, p. ej. ≈ 370 UH)', 'input'], ['note', 'Descripción', 'textarea'], ['user_note', 'Nota del médico (opcional)', 'textarea'],
];
const LABEL = Object.fromEntries(FIELDS.map(f => [f[0], f[1].replace(/ \(.*/, '')]));
const KIND = { edicion: 'Edición', restauracion: 'Restauración', importado: 'Importado', revision: 'Revisión médica' };
const CASE_ID = '__case';
const same = (a, b) => FIELDS.every(([k]) => (a[k] ?? '') === (b[k] ?? ''));
const fmt = ts => new Date(ts).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

export class Editor {
  constructor({ viewer, esc, modal, toast, onChange }) { Object.assign(this, { viewer, esc, modal, toast, onChange }); this.store = null; this.orig = new Map(); this.cur = new Map(); this.records = []; this.entry = ''; }
  async attach(entry, key) {
    this.detach(); this.entry = entry; this.store = await openStore(entry, key);
    this.orig.set(CASE_ID, { user_note: '' });
    for (const f of this.viewer.findings) {
      const o = Object.fromEntries(FIELDS.map(([k]) => [k, f[k] ?? '']));
      if (f.review || f.data?.review) o.review = JSON.parse(JSON.stringify(f.review || f.data.review));
      this.orig.set(f.id, o);
    }
    await this.reload();
  }
  detach() { this.store?.close(); this.store = null; this.orig = new Map(); this.cur = new Map(); this.records = []; }
  async reload() { // estado vigente = original + todas las versiones, en orden (edición y revisión se mezclan)
    this.records = await this.store.list();
    this.cur = new Map(); for (const [fid, o] of this.orig) this.cur.set(fid, { ...o });
    for (const r of this.records) { const prev = this.cur.get(r.fid) || {}; this.cur.set(r.fid, { ...prev, ...(r.after || {}) }); }
    for (const [fid, s] of this.cur) this.apply(fid, s); this.onChange();
  }
  apply(fid, s) { if (fid !== CASE_ID) this.viewer.updateFinding(fid, { ...s }); }
  snap(fid) { return this.cur.get(fid) || {}; }
  isEdited(fid) { const o = this.orig.get(fid), c = this.cur.get(fid); return !!o && !!c && !same(o, c); }
  userNote(fid) { return this.cur.get(fid)?.user_note || ''; }
  async commit(fid, kind, after) {
    const before = { ...this.snap(fid) }; after = Object.fromEntries(FIELDS.map(([k]) => [k, (after[k] ?? '').trim?.() ?? after[k]]));
    if (same(before, after) && !this._forceReview) { this.toast('Sin cambios.'); return false; }
    await this.store.add({ fid, kind, before, after }); await this.reload();
    if (this.afterCommit) await this.afterCommit(fid, kind, { before, after });
    return true;
  }
  // ---- Ventanas ----
  edit(fid) {
    const E = this.esc, isCase = fid === CASE_ID, s = this.snap(fid), fields = isCase ? FIELDS.filter(f => f[0] === 'user_note') : FIELDS;
    const body = this.modal.open(`<h1>${isCase ? 'Notas del caso' : 'Editar hallazgo ' + E(fid)}</h1><p class="fine">Se guarda cifrado en este navegador, con historial de versiones. No se publica ni se envía a ningún servidor.</p>
      <form class="form" id="efrm" onsubmit="return false">${fields.map(([k, l, t]) => `<label>${E(l)}${t === 'textarea' ? `<textarea name="${k}">${E(s[k] ?? '')}</textarea>` : `<input name="${k}" value="${E(s[k] ?? '')}">`}</label>`).join('')}</form>
      <div class="ov-actions"><button class="btn ghost" data-act="cancel">Cancelar</button><button class="btn primary" data-act="save">Guardar versión</button></div>`);
    body.onclick = async e => {
      const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return; if (a === 'cancel') return this.modal.close();
      const after = { ...s }; for (const el of body.querySelectorAll('#efrm [name]')) after[el.name] = el.value;
      if (await this.commit(fid, 'edicion', after)) { this.modal.close(); this.toast('Versión guardada (cifrada en este navegador).'); }
    };
  }
  history(fid) {
    const E = this.esc, isCase = fid === CASE_ID, rs = this.records.filter(r => r.fid === fid).reverse(), o = this.orig.get(fid);
    const revLine = r => r && r.status ? `${r.status}${r.nota ? ' · ' + r.nota : ''}` : '';
    const diff = (b, a) => {
      const rows = FIELDS.filter(([k]) => (b[k] ?? '') !== (a[k] ?? '')).map(([k]) => `<div class="df"><b>${E(LABEL[k])}:</b> <s>${E(b[k] || '(vacío)')}</s> → <ins>${E(a[k] || '(vacío)')}</ins></div>`);
      const br = revLine(b.review), ar = revLine(a.review);
      if (br !== ar) rows.push(`<div class="df"><b>Revisión:</b> <s>${E(br || '(vacío)')}</s> → <ins>${E(ar || '(vacío)')}</ins></div>`);
      return rows.join('');
    };
    const body = this.modal.open(`<h1>Historial · ${isCase ? 'Notas del caso' : 'Hallazgo ' + E(fid)}</h1><div class="hist">${rs.map((r, i) => `<div class="hent ${i === 0 ? 'cur' : ''}"><div class="hh"><span>${fmt(r.ts)} · ${KIND[r.kind] || E(r.kind)}${i === 0 ? ' · vigente' : ''}</span>${i === 0 ? '' : `<button class="btn sm" data-restore="${r._id}">Restaurar esta versión</button>`}</div>${diff(r.before, r.after)}</div>`).join('') || '<p class="fine">Aún no hay ediciones.</p>'}
      <div class="hent ${rs.length ? '' : 'cur'}"><div class="hh"><span>Original del estudio${rs.length ? '' : ' · vigente'}</span>${rs.length ? '<button class="btn sm" data-restore="orig">Restaurar original</button>' : ''}</div>${FIELDS.filter(([k]) => o[k]).map(([k]) => `<div class="df"><b>${E(LABEL[k])}:</b> ${E(o[k])}</div>`).join('')}</div></div>
      <div class="ov-actions"><button class="btn primary" data-close>Cerrar</button></div>`);
    body.onclick = async e => {
      const b = e.target.closest('[data-restore]'); if (!b) return; const id = b.dataset.restore;
      const after = id === 'orig' ? { ...o } : { ...this.records.find(r => String(r._id) === id).after };
      if (await this.commit(fid, 'restauracion', after)) { this.toast('Versión restaurada.'); this.history(fid); }
    };
  }
  async exportBackup() {
    const txt = await this.store.exportBackup(), d = new Date(), p = n => String(n).padStart(2, '0');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
    a.download = `respaldo-${this.entry === 'c.bin' ? 'caso-real' : 'ejemplo'}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.atlas.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    this.toast('Respaldo cifrado descargado. Solo se abre con las mismas contraseñas.');
  }
  async importBackup(file) {
    try { const r = await this.store.importBackup(await file.text()); await this.reload(); this.toast(r.added ? `Respaldo importado: ${r.added} versiones nuevas.` : 'El respaldo no trae versiones nuevas.'); }
    catch (e) { this.toast(e.message, 8000); }
  }
  async clearAll() { if (!confirm('¿Borrar TODO el historial local de este caso en este navegador? Los hallazgos vuelven a su texto original.')) return; await this.store.clear(); await this.reload(); this.toast('Historial local borrado.'); }
}
