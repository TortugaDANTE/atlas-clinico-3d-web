// Revisión humana de hallazgos de IA. Extiende case@1; no reemplaza source ni el historial de js/store.js.
// Estados (urologo, revisión-clinica-1): propuesta | pendiente | confirmada | descartada | modificada
// Un informe queda 'preliminar' mientras haya propuestas o pendientes; si no, 'revisado'.
// Textos de interfaz: propuesta clínica, usar tal cual.

export const REVIEW_STATUS = ['propuesta', 'pendiente', 'confirmada', 'descartada', 'modificada'];
export const OPEN_STATUS = ['propuesta', 'pendiente']; // siguen siendo preliminares
export const KIND_REVISION = 'revision';
export const SCHEMA_EXTENSION = 'revision-clinica-1';

// Textos de interfaz (español), según la propuesta clínica.
export const TEXTS = {
  disclaimer: 'Esta herramienta muestra una vista 3D y un expediente de apoyo. Los hallazgos marcados como *Propuesta de IA* no son un diagnóstico ni un reporte oficial de radiología. El médico tratante debe confirmar, modificar o descartar cada propuesta. No es un dispositivo médico (no tiene registro FDA ni COFEPRIS).',
  etiquetaIA: 'Propuesta de IA — pendiente de su confirmación.',
  confianza: level => `Confianza de la IA: ${level}. Esto no es un diagnóstico.`,
  confirmar: 'Confirmar',
  descartar: 'Descartar',
  modificar: 'Modificar',
  pendiente: 'Dejar pendiente',
  alConfirmar: 'Confirmó este hallazgo. Quedará en el expediente como revisado por usted.',
  alDescartar: 'Indique por qué se descarta (obligatorio).',
  alModificar: 'Se guardará su versión. La propuesta original queda en el historial.',
  acciones: 'Estudio o interconsulta sugeridos por la IA. Puede confirmarlos o descartarlos por separado.',
  urgencia: 'Si hay fiebre con dolor en el costado, vómito que no para, dolor que no cede, o si el paciente deja de orinar, acudir a urgencias. Una litiasis con fiebre o con dilatación de la vía urinaria es una urgencia.',
  prioridadAmbulatoria: 'Prioridad para valoración ambulatoria (no es un código de urgencia por sí sola).',
  pieLabsOCR: 'Valores leídos de una foto o PDF. Confirme que coinciden con el documento original.',
};

export const BADGE = {
  propuesta: { cls: 'preliminar', label: 'PRELIMINAR' },
  pendiente: { cls: 'pendiente', label: 'PENDIENTE' },
  confirmada: { cls: 'confirmada', label: 'CONFIRMADA' },
  descartada: { cls: 'descartada', label: 'DESCARTADA' },
  modificada: { cls: 'modificada', label: 'MODIFICADA' },
};

export function nowMexicoCity(date = new Date()) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
  const asUTC = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asMX = new Date(date.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const diffMin = Math.round((asMX - asUTC) / 60000);
  const sign = diffMin >= 0 ? '+' : '-';
  const abs = Math.abs(diffMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
}

function emptyReview() {
  return { status: 'propuesta', reviewer: null, fecha: null, nota: null };
}

export function defaultReviewStatus(finding) {
  if (finding?.review?.status && REVIEW_STATUS.includes(finding.review.status)) return finding.review.status;
  return finding?.source === 'interpretacion_ia' ? 'propuesta' : null;
}

export function normalizeReview(review, { source } = {}) {
  const prev = review || {};
  const status = REVIEW_STATUS.includes(prev.status) ? prev.status : (source === 'interpretacion_ia' ? 'propuesta' : null);
  if (!status && !review) return undefined;
  if (!status) return { ...prev };
  return { status, reviewer: prev.reviewer ?? null, fecha: prev.fecha ?? null, nota: prev.nota ?? null };
}

export function normalizeFindingReview(finding) {
  const review = normalizeReview(finding?.review, { source: finding?.source });
  const actions = (finding?.suggested_actions || []).map(a => ({
    ...a,
    review: normalizeReview(a.review, { source: finding?.source }) || emptyReview(),
  }));
  const out = review ? { ...finding, review } : { ...finding };
  if (finding?.suggested_actions) out.suggested_actions = actions;
  return out;
}

export function normalizeCaseReviews(caseData) {
  const findings = (caseData.findings || []).map(normalizeFindingReview);
  const review_points = (caseData.review_points || []).map(p => {
    const review = normalizeReview(p.review, { source: p.source });
    return review ? { ...p, review } : { ...p };
  });
  const organ_notes = (caseData.organ_notes || []).map(n => {
    const review = normalizeReview(n.review, { source: n.source || 'interpretacion_ia' });
    return review ? { ...n, review } : { ...n };
  });
  const clinical = caseData.clinical ? { ...caseData.clinical } : undefined;
  if (clinical) {
    for (const key of ['antecedentes', 'alergias', 'medicacion', 'laboratorios']) {
      if (!clinical[key]) continue;
      clinical[key] = clinical[key].map(item => {
        const review = normalizeReview(item.review, { source: 'interpretacion_ia' });
        return review ? { ...item, review } : { ...item };
      });
    }
  }
  const out = { ...caseData, findings, review_points, organ_notes };
  if (clinical) out.clinical = clinical;
  if (!out.schema_extension) out.schema_extension = SCHEMA_EXTENSION;
  return out;
}

export function appendAudit(finding, { actor, de, a, nota, fecha }) {
  const audit = [...(finding.audit || []), {
    fecha: fecha || nowMexicoCity(),
    actor: actor || null,
    de: de ?? null,
    a: a ?? null,
    nota: nota == null || nota === '' ? null : String(nota),
  }];
  return { ...finding, audit };
}

export function applyReview(finding, { status, reviewer, fecha, nota }) {
  if (!REVIEW_STATUS.includes(status)) throw new Error('Estado de revisión no válido: ' + status);
  if (status === 'descartada' && !(nota && String(nota).trim())) {
    throw new Error(TEXTS.alDescartar);
  }
  const before = normalizeFindingReview(finding);
  const fechaISO = fecha || nowMexicoCity();
  const next = normalizeFindingReview({
    ...before,
    review: {
      status,
      reviewer: reviewer ?? before.review?.reviewer ?? null,
      fecha: fechaISO,
      nota: nota == null || nota === '' ? null : String(nota),
    },
  });
  return appendAudit(next, {
    actor: next.review.reviewer,
    de: before.review?.status ?? null,
    a: status,
    nota: next.review.nota,
    fecha: fechaISO,
  });
}

export function applyActionReview(finding, actionId, decision) {
  const before = normalizeFindingReview(finding);
  const actions = (before.suggested_actions || []).map(a => {
    if (a.id !== actionId) return a;
    if (!REVIEW_STATUS.includes(decision.status)) throw new Error('Estado de revisión no válido: ' + decision.status);
    if (decision.status === 'descartada' && !(decision.nota && String(decision.nota).trim())) {
      throw new Error(TEXTS.alDescartar);
    }
    return {
      ...a,
      review: {
        status: decision.status,
        reviewer: decision.reviewer ?? null,
        fecha: decision.fecha || nowMexicoCity(),
        nota: decision.nota == null || decision.nota === '' ? null : String(decision.nota),
      },
    };
  });
  if (!(before.suggested_actions || []).some(a => a.id === actionId)) throw new Error('No está la acción ' + actionId);
  return { ...before, suggested_actions: actions };
}

export function isActiveFinding(finding) {
  const f = normalizeFindingReview(finding);
  return f.review?.status !== 'descartada';
}

export function reviewCounts(findings = []) {
  const c = { propuesta: 0, pendiente: 0, confirmada: 0, descartada: 0, modificada: 0, sin_revision: 0 };
  for (const raw of findings) {
    const s = defaultReviewStatus(raw);
    if (s) c[s]++; else c.sin_revision++;
  }
  return c;
}

/** Estado del informe de IA ligado a este caso (o a un subconjunto de hallazgos). */
export function reportStatus(findings = []) {
  const ia = findings.filter(f => f.source === 'interpretacion_ia' || f.review);
  if (!ia.length) return 'revisado';
  return ia.some(f => OPEN_STATUS.includes(defaultReviewStatus(f))) ? 'preliminar' : 'revisado';
}

/**
 * Aplica la decisión y, si hay un Editor (js/edit.js) con store, deja constancia
 * en el historial cifrado (kind: 'revision') sin sustituir las ediciones de texto.
 * Recorre todos los registros al recargar (el Editor ya debe plegar el historial).
 */
export async function commitReview(editor, fid, decision, { actionId } = {}) {
  const list = editor.viewer?.findings || [];
  const finding = list.find(f => f.id === fid);
  if (!finding) throw new Error('No está el hallazgo ' + fid);
  const before = normalizeFindingReview({
    ...finding,
    review: finding.review || finding.data?.review,
    suggested_actions: finding.suggested_actions || finding.data?.suggested_actions,
    audit: finding.audit || finding.data?.audit,
    source: finding.source || finding.data?.source,
  });
  const afterF = actionId ? applyActionReview(before, actionId, decision) : applyReview(before, decision);
  const patch = actionId
    ? { suggested_actions: afterF.suggested_actions }
    : { review: afterF.review, audit: afterF.audit };
  if (editor.viewer?.updateFinding) editor.viewer.updateFinding(fid, patch);
  else Object.assign(finding, patch);
  if (finding.data) Object.assign(finding.data, patch);
  if (editor.store?.add) {
    const rec = {
      fid,
      kind: KIND_REVISION,
      before: actionId
        ? { actionId, review: (before.suggested_actions || []).find(a => a.id === actionId)?.review || null }
        : { review: before.review || null },
      after: actionId
        ? { actionId, review: (afterF.suggested_actions || []).find(a => a.id === actionId)?.review }
        : { review: afterF.review, audit: afterF.audit },
      label: actionId ? `acción ${actionId}: ${decision.status}` : afterF.review.status,
    };
    await editor.store.add(rec);
  }
  if (typeof editor.reload === 'function') await editor.reload();
  else editor.onChange?.();
  return afterF;
}

export function reviewBadgeHtml(status) {
  if (!status || !BADGE[status]) return '';
  const b = BADGE[status];
  return `<span class="badge rev ${b.cls}" data-review="${status}">${b.label}</span>`;
}

export function confidenceHtml(finding, esc = s => String(s ?? '')) {
  const level = finding.confidence?.level || finding.data?.confidence?.level;
  if (!level) return '';
  return `<div class="ia-conf">${esc(TEXTS.confianza(level))}</div>`;
}

function statusOf(finding) {
  return defaultReviewStatus({
    ...finding,
    source: finding.source || finding.data?.source,
    review: finding.review || finding.data?.review,
  });
}

export function findingReviewHtml(finding, { selected = false, esc }) {
  const E = esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const src = finding.source || finding.data?.source;
  const st = statusOf(finding);
  const review = finding.review || finding.data?.review || {};
  let h = reviewBadgeHtml(st);
  if (src === 'interpretacion_ia' && OPEN_STATUS.includes(st)) {
    h += `<div class="ia-tag">${E(TEXTS.etiquetaIA)}</div>`;
    h += confidenceHtml(finding, E);
  } else if (src === 'interpretacion_ia' && st && finding.confidence?.level) {
    h += confidenceHtml(finding, E);
  }
  if (review.nota) h += `<div class="ia-rnote"><b>Nota de revisión:</b> ${E(review.nota)}</div>`;
  if (!selected) return h;
  if (st && src === 'interpretacion_ia') {
    h += `<div class="ia-acts" data-ia-acts="${E(finding.id)}">`;
    if (st !== 'confirmada') h += `<button class="btn sm ok" data-rev="confirmada" data-fid="${E(finding.id)}">${E(TEXTS.confirmar)}</button>`;
    if (st !== 'descartada') h += `<button class="btn sm danger" data-rev="descartada" data-fid="${E(finding.id)}">${E(TEXTS.descartar)}</button>`;
    if (st !== 'modificada') h += `<button class="btn sm" data-rev="modificada" data-fid="${E(finding.id)}">${E(TEXTS.modificar)}</button>`;
    if (st !== 'pendiente') h += `<button class="btn sm ghost" data-rev="pendiente" data-fid="${E(finding.id)}">${E(TEXTS.pendiente)}</button>`;
    h += `</div>`;
  }
  const actions = finding.suggested_actions || finding.data?.suggested_actions || [];
  if (actions.length) {
    h += `<div class="ia-sug"><p class="fine">${E(TEXTS.acciones)}</p>`;
    for (const a of actions) {
      const ast = a.review?.status || 'propuesta';
      h += `<div class="ia-act" data-aid="${E(a.id)}"><span class="ia-akind">${E(a.kind || '')}</span> ${E(a.text)} ${reviewBadgeHtml(ast)}`;
      if (OPEN_STATUS.includes(ast)) {
        h += `<div class="ia-acts"><button class="btn sm ok" data-rev="confirmada" data-fid="${E(finding.id)}" data-aid="${E(a.id)}">${E(TEXTS.confirmar)}</button>`;
        h += `<button class="btn sm danger" data-rev="descartada" data-fid="${E(finding.id)}" data-aid="${E(a.id)}">${E(TEXTS.descartar)}</button></div>`;
      } else if (a.review?.nota) {
        h += `<div class="ia-rnote">${E(a.review.nota)}</div>`;
      }
      h += `</div>`;
    }
    h += `</div>`;
  }
  return h;
}

export function countsHtml(findings, esc) {
  const E = esc || (s => String(s ?? ''));
  const c = reviewCounts(findings);
  const inf = reportStatus(findings);
  const parts = [];
  if (c.propuesta) parts.push(`${c.propuesta} propuesta${c.propuesta === 1 ? '' : 's'}`);
  if (c.pendiente) parts.push(`${c.pendiente} pendiente${c.pendiente === 1 ? '' : 's'}`);
  if (c.confirmada) parts.push(`${c.confirmada} confirmada${c.confirmada === 1 ? '' : 's'}`);
  if (c.modificada) parts.push(`${c.modificada} modificada${c.modificada === 1 ? '' : 's'}`);
  if (c.descartada) parts.push(`${c.descartada} descartada${c.descartada === 1 ? '' : 's'}`);
  if (c.sin_revision) parts.push(`${c.sin_revision} de reporte`);
  const infLabel = inf === 'preliminar' ? 'Informe preliminar' : 'Informe revisado';
  return `<div class="ia-counts"><span class="badge rev ${inf === 'preliminar' ? 'preliminar' : 'confirmada'}">${E(infLabel)}</span> ${E(parts.join(' · ') || 'Sin hallazgos')}</div>`;
}

async function askNote(modal, { title, hint, required = false, esc }) {
  const E = esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  return new Promise(resolve => {
    const body = modal.open(`<h1>${E(title)}</h1><p class="fine">${E(hint)}</p>
      <form class="form" id="rnote" onsubmit="return false"><label>Nota${required ? ' (obligatoria)' : ''}<textarea name="nota" id="rnoteVal"></textarea></label></form>
      <div class="ov-actions"><button class="btn ghost" data-act="cancel">Cancelar</button><button class="btn primary" data-act="ok">Guardar</button></div>`);
    const finish = v => { modal.close(); resolve(v); };
    body.onclick = e => {
      const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
      if (a === 'cancel') return finish(null);
      const nota = body.querySelector('#rnoteVal')?.value || '';
      if (required && !nota.trim()) {
        const t = body.querySelector('.fine'); if (t) { t.classList.add('err'); t.textContent = TEXTS.alDescartar; }
        return;
      }
      finish(nota);
    };
  });
}

/**
 * Enlaza clics de Confirmar / Descartar / Modificar / Dejar pendiente en un contenedor.
 * `onModify(fid)` se llama cuando el médico elige Modificar (el visor abre el editor).
 */
export function bindReviewClicks(root, { editor, modal, toast, esc, onModify, reviewer = 'médico tratante' }) {
  if (!root || root.__iaReviewBound) return;
  root.__iaReviewBound = true;
  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-rev][data-fid]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const status = btn.dataset.rev, fid = btn.dataset.fid, actionId = btn.dataset.aid || null;
    let nota = null;
    try {
      if (status === 'descartada') {
        nota = await askNote(modal, { title: 'Descartar ' + (actionId ? 'acción' : 'hallazgo ') + (actionId || fid), hint: TEXTS.alDescartar, required: true, esc });
        if (nota == null) return;
      } else if (status === 'modificada' && !actionId) {
        toast?.(TEXTS.alModificar, 6000);
        onModify?.(fid);
        return;
      } else if (status === 'pendiente') {
        nota = await askNote(modal, { title: 'Dejar pendiente ' + fid, hint: 'Comentario opcional para retomar después.', required: false, esc });
        if (nota == null) return;
      }
      await commitReview(editor, fid, { status, reviewer, nota }, { actionId });
      if (status === 'confirmada' && !actionId) toast?.(TEXTS.alConfirmar, 5000);
      else if (status === 'confirmada') toast?.('Confirmó la acción sugerida.', 4000);
      else if (status === 'descartada') toast?.('Se descartó y quedó en el expediente, con su nota.', 5000);
      else if (status === 'pendiente') toast?.('Quedó pendiente de su revisión.', 4000);
    } catch (err) {
      toast?.(err.message, 7000);
    }
  });
}

/** Tras una edición de texto, marca el hallazgo como modificado y deja el original en el historial. */
export async function markModified(editor, fid, { reviewer = 'médico tratante', original } = {}) {
  const finding = (editor.viewer?.findings || []).find(f => f.id === fid);
  if (!finding) return;
  const st = statusOf(finding);
  if (st === 'descartada') return;
  const nota = original
    ? `Versión del médico. Propuesta original: ${original}`
    : 'El médico aceptó la propuesta con cambios. El original quedó en el historial.';
  return commitReview(editor, fid, { status: 'modificada', reviewer, nota });
}

export function applyReviewVisuals(viewer) {
  if (!viewer?.findings) return;
  for (const f of viewer.findings) {
    const active = isActiveFinding(f);
    if (f.g) f.g.visible = active && (viewer.markersOn !== false);
    if (f.card) { f.card.visible = active && (viewer.labelsOn !== false); f.card.material && (f.card.material.opacity = active ? 1 : 0.25); }
    if (f.glow) f.glow.visible = active && (viewer.markersOn !== false);
    if (f.ring) f.ring.visible = active && (viewer.markersOn !== false);
    if (f.lesion || f.lesionHolo) {
      const op = active ? 1 : 0.2;
      if (f.lesion) f.lesion.visible = active && (viewer.lesionsOn !== false);
      if (f.lesionHolo) f.lesionHolo.visible = active && (viewer.lesionsOn !== false);
    }
  }
}
