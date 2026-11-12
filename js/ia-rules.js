// Motor de reglas clínicas en el cliente (propuesta de urologo, sección 7).
// Todas producen una alerta o una acción sugerida con review.status = 'propuesta'.
// No bloquean el visor. Textos de urgencia: usar tal cual.
import { TEXTS } from './review.js';

const emptyRev = () => ({ status: 'propuesta', reviewer: null, fecha: null, nota: null });

function hasType(findings, ...types) {
  return findings.some(f => types.includes(f.type) && f.review?.status !== 'descartada');
}
function lab(clinical, idOrName) {
  const list = clinical?.laboratorios || [];
  const q = String(idOrName).toLowerCase();
  return list.find(l => String(l.id).toLowerCase() === q || String(l.nombre).toLowerCase().includes(q));
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function textHas(clinical, ...re) {
  const bags = [];
  for (const a of clinical?.antecedentes || []) bags.push(a.text || '');
  for (const n of clinical?.notas || []) bags.push(n.text || n);
  if (clinical?.nota) bags.push(clinical.nota);
  const t = bags.join('\n').toLowerCase();
  return re.some(r => r.test(t));
}

/**
 * Evalúa el caso y devuelve alertas + acciones sugeridas a nivel de caso.
 * No muta los hallazgos (las acciones por hallazgo ya vienen en el JSON).
 */
export function evaluateRules(caseData = {}) {
  const findings = caseData.findings || [];
  const active = findings.filter(f => f.review?.status !== 'descartada');
  const clinical = caseData.clinical || {};
  const alerts = [];
  const actions = [];

  const litiasis = hasType(active, 'litiasis_renal', 'litiasis_ureteral', 'litiasis');
  const hidroText = f => { const t = f.note || f.title || ''; return /hidronefrosis|dilataci[oó]n de la v[ií]a/i.test(t) && !/sin hidronefrosis|no hay hidronefrosis|sin dilataci/i.test(t); };
  const hidro = hasType(active, 'hidronefrosis') || active.some(hidroText);
  const litoUreter = hasType(active, 'litiasis_ureteral') || active.some(f => /ur[eé]ter/i.test(f.location || '') && /lito|c[aá]lculo|litiasis/i.test(f.title || f.type || ''));
  const fiebre = textHas(clinical, /fiebre|febril|sepsis/) || clinical.flags?.fiebre;
  const anuria = textHas(clinical, /anuria|retenci[oó]n urinaria|deja de orinar|no orina/) || clinical.flags?.anuria;
  const vomito = textHas(clinical, /v[oó]mito incoercible|v[oó]mito que no para|v[oó]mitos incoercibles/) || clinical.flags?.vomito_incoercible;

  // 1, 2, 3 — urgencias (banner, no se oculta sola)
  if (fiebre && (litoUreter || hidro || (litiasis && textHas(clinical, /flanco|costado|fosa lumbar/)))) {
    alerts.push({ id: 'urg-urosepsis', level: 'urgente', rule: 1, sticky: true, text: TEXTS.urgencia });
  }
  if (anuria) {
    alerts.push({ id: 'urg-anuria', level: 'urgente', rule: 2, sticky: true, text: TEXTS.urgencia });
  }
  if (vomito && textHas(clinical, /lumbar|flanco|abdominal|costado/)) {
    alerts.push({ id: 'urg-vomito', level: 'urgente', rule: 3, sticky: true, text: TEXTS.urgencia });
  }

  const cr = lab(clinical, 'lab-cr') || lab(clinical, 'creatinina');
  const crN = num(cr?.valor);
  const renalOk = cr && (cr.flag === 'normal' || (crN != null && crN <= (cr.rango?.max ?? 1.2)));
  const obstructiva = hidro || litoUreter;

  // 4 — litiasis no obstructiva + función renal conservada
  if (litiasis && !obstructiva && renalOk) {
    actions.push({
      id: 'rule-4-seguimiento', kind: 'cuidado', rule: 4, review: emptyRev(),
      text: 'Litiasis no obstructiva con función renal conservada: no es urgencia. Sugerir seguimiento, hidratación y estudio metabólico (el médico confirma).',
    });
  }

  // 5 — pH urinario ≤5 + litiasis
  const ph = lab(clinical, 'lab-ego-ph') || lab(clinical, 'pH urinario') || lab(clinical, 'ph');
  const phN = num(ph?.valor);
  if (litiasis && phN != null && phN <= 5) {
    actions.push({
      id: 'rule-5-ph', kind: 'lab', rule: 5, review: emptyRev(),
      text: 'pH urinario ≤5 + litiasis: sugerir correlación metabólica (citrato, ácido úrico); no indicar fármacos automáticos.',
    });
  }

  // 6 — calcio sérico no medido + múltiples calcificaciones
  const ca = lab(clinical, 'lab-ca') || lab(clinical, 'calcio');
  const calcs = active.filter(f => /calcific/i.test(f.type || '') || /calcific/i.test(f.title || ''));
  const caMissing = !ca || ca.valor == null || ca.valor === '' || ca.flag === 'warn';
  if (caMissing && calcs.length >= 2) {
    actions.push({
      id: 'rule-6-calcio', kind: 'lab', rule: 6, review: emptyRev(),
      text: 'Calcio sérico no medido y hay varias calcificaciones: sugerir calcio, fósforo, PTH, vitamina D y orina de 24 h.',
    });
  }

  // 7 — calcificación cardiaca en TC no sincronizada
  const cardio = active.find(f => f.type === 'calcificacion_cardiaca' || /card[ií]ac/i.test(f.title || ''));
  if (cardio) {
    alerts.push({ id: 'prio-cardio', level: 'prioridad', rule: 7, sticky: true, text: TEXTS.prioridadAmbulatoria, finding: cardio.id });
    // Las acciones concretas (cardiología, lípidos, score) viven en suggested_actions del hallazgo si vienen en el caso.
  }

  // 8 — vesícula sin litos calcificados en TC simple
  const ves = active.find(f => f.type === 'vesicula' || f.organ === 'vesicula');
  if (ves && /sin litos|no se identifican litos|sin litos calcificados/i.test((ves.note || '') + (ves.title || ''))) {
    actions.push({
      id: 'rule-8-us-vesicula', kind: 'estudio', rule: 8, review: emptyRev(),
      text: 'Vesícula sin litos calcificados en TC simple: no afirmar «sin litos»; sugerir ultrasonido si hay síntomas.',
    });
  }

  // 9 — corrección documentada (p. ej. punta de costilla): solo recordar que debe permanecer descartada
  const discardedRib = findings.filter(f => f.review?.status === 'descartada' && /costilla|rib tip/i.test((f.review?.nota || '') + (f.note || '') + (f.title || '')));
  for (const f of discardedRib) {
    alerts.push({
      id: 'rule-9-' + f.id, level: 'info', rule: 9, sticky: false,
      text: `Corrección documentada (${f.id}): permanece descartada en el expediente para no reintroducirla.`,
      finding: f.id,
    });
  }

  return { alerts, actions };
}

export function renderAlerts(evalResult, esc) {
  const E = esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const { alerts = [], actions = [] } = evalResult || {};
  let h = '';
  for (const a of alerts) {
    const cls = a.level === 'urgente' ? 'urgente' : (a.level === 'prioridad' ? 'prioridad' : 'info');
    h += `<div class="ia-alert ${cls}" data-sticky="${a.sticky ? '1' : '0'}" data-rule="${a.rule}" role="alert">${E(a.text)}</div>`;
  }
  return h;
}

export function renderRuleActions(evalResult, esc) {
  const E = esc || (s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const actions = evalResult?.actions || [];
  if (!actions.length) return '';
  let h = `<h3 class="sec">Acciones sugeridas por reglas clínicas</h3><p class="fine">${E(TEXTS.acciones)}</p>`;
  for (const a of actions) {
    h += `<div class="ia-act" data-rule-action="${E(a.id)}"><span class="ia-akind">${E(a.kind || '')}</span> ${E(a.text)}</div>`;
  }
  return h;
}
