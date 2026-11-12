// Ganchos para los modelos de IA médica (propuesta de urologo).
// Registro por modalidad, detección local (sin subir el archivo) y adaptadores
// enchufables. Nunca llama APIs externas con datos de salud.

const adapters = new Map();
let clinicalSchema = null;

/** Catálogo (metadatos). Los GPU-only no se registran como ejecutables. */
export const MODEL_CATALOG = [
  { id: 'totalsegmentator', modality: 'CT', task: 'segmentación de órganos (precomputo)', license: 'Apache-2.0', runtime: 'precompute', available: 'precompute', notes: 'No corre en el navegador ni en 8 GB de RAM para una TC abdominal 1 mm. Reutilizar máscaras ya generadas.' },
  { id: 'postprocess-hu', modality: 'CT', task: 'postproceso UH/geometría sobre máscaras (cálculos, calcio aórtico, UH vertebral)', license: 'Apache-2.0 (código de la App)', runtime: 'cpu+browser', available: true, notes: 'Heurístico; siempre como propuesta. No es un score de Agatston.' },
  { id: 'torchxrayvision-densenet121', modality: 'XR', task: 'radiografía de tórax, 18 etiquetas', license: 'Apache-2.0', runtime: 'onnx-web|cpu', available: 'if-onnx', notes: 'DenseNet121 res224-all. No hay ONNX oficial; hay que exportarlo. Hook listo.' },
  { id: 'tesseract-pdf-labs', modality: 'LAB', task: 'OCR de fotos/PDF de laboratorio + parser en español', license: 'Apache-2.0 (Tesseract.js, PDF.js) + reglas propias', runtime: 'browser', available: 'stub', notes: 'El parser de rangos sí corre; OCR se enchufa con Tesseract.js + PDF.js.' },
  { id: 'bio-clinicalbert', modality: 'NOTE', task: 'embeddings o clasificación ligera de notas; no genera diagnóstico', license: 'MIT (Bio_ClinicalBERT) / Apache-2.0 (transformers.js)', runtime: 'transformers.js', available: 'stub', notes: 'No emitir diagnósticos ni reportes.' },
  { id: 'ecg-fm', modality: 'ECG', task: 'ECG 12 derivaciones (p. ej. FA)', license: 'MIT', runtime: 'onnx|cpu', available: 'stub', notes: 'Hasta que haya un ECG del caso y un ONNX exportado.' },
  { id: 'rules-engine', modality: 'RULES', task: 'alertas de urgencia y consistencia clínica', license: 'Apache-2.0 (código de la App)', runtime: 'browser', available: true },
  { id: 'onnx-runtime-web', modality: 'PLATFORM', task: 'plataforma ONNX Runtime Web + transformers.js', license: 'Apache-2.0', runtime: 'browser', available: true, notes: 'No es un modelo clínico.' },
  // Futuro (GPU): no se registran como ejecutables
  { id: 'medgemma', modality: 'CT', task: 'VLM médico', runtime: 'gpu', available: false, future: true },
  { id: 'merlin', modality: 'CT', task: 'fundación 3D abdominal', runtime: 'gpu', available: false, future: true },
  { id: 'medsam2', modality: 'CT', task: 'segmentación interactiva', runtime: 'gpu', available: false, future: true },
  { id: 'ct-fm', modality: 'CT', task: 'modelo fundacional 3D (AIM-Harvard)', runtime: 'gpu', available: false, future: true },
];

const ascii = s => new TextDecoder('latin1').decode(s);

function dicomModality(head) {
  // Si el buffer trae más que el preámbulo, intentar leer (0008,0060) de forma tosca es frágil;
  // la modalidad fina la afina el adaptador/pipeline (pydicom). Aquí solo detectamos que es DICOM.
  if (head.length >= 132 && ascii(head.slice(128, 132)) === 'DICM') return true;
  return false;
}

export const ModalityRegistry = {
  register(modality, adapter) {
    if (!modality) throw new Error('Hace falta la modalidad.');
    const id = String(adapter?.id || modality).toUpperCase();
    const key = adapter?.id ? String(adapter.id) : String(modality).toUpperCase();
    adapters.set(key, { modality: String(modality).toUpperCase(), ...adapter });
  },
  get(modalityOrId) {
    const k = String(modalityOrId || '');
    return adapters.get(k) || adapters.get(k.toUpperCase()) || null;
  },
  list() { return [...adapters.values()]; },
  clear() { adapters.clear(); },
  byModality(modality) {
    const m = String(modality || '').toUpperCase();
    return [...adapters.values()].filter(a => String(a.modality).toUpperCase() === m || (a.modalities || []).map(x => String(x).toUpperCase()).includes(m));
  },

  /** Detección en el cliente (magic bytes / nombre / MIME). Sin subir el archivo. */
  async detect(fileLike) {
    const name = fileLike?.name || fileLike?.filename || fileLike?.path || '';
    const type = fileLike?.type || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    let head = new Uint8Array(0);
    if (fileLike?.arrayBuffer) {
      const buf = await fileLike.arrayBuffer();
      head = new Uint8Array(buf.slice(0, 348));
    } else if (fileLike?.bytes) {
      head = fileLike.bytes.slice(0, 348);
    } else if (fileLike?.slice && fileLike.size != null) {
      try {
        const buf = await fileLike.slice(0, 348).arrayBuffer();
        head = new Uint8Array(buf);
      } catch (e) { /* ignore */ }
    }
    if (dicomModality(head) || ext === 'dcm' || ext === 'dicom') {
      return { modality: 'CT', kind: 'dicom', confidence: dicomModality(head) ? 'header' : 'extension', note: 'La modalidad DICOM fina (CT/MR/CR/DX/US) la afina el pipeline con las etiquetas.' };
    }
    // NIfTI: extensión o magic en offset 0 o 344
    const niftiMagic = h => {
      const at = o => ascii(h.slice(o, o + 4));
      return at(0).startsWith('n+1') || at(0).startsWith('ni1') || at(344).startsWith('n+1') || at(344).startsWith('ni1');
    };
    if (ext === 'nii' || name.toLowerCase().endsWith('.nii.gz') || (head.length && niftiMagic(head))) {
      return { modality: 'CT', kind: 'nifti', confidence: 'header', note: 'Volumen NIfTI (TC o RM); el adaptador confirma la modalidad.' };
    }
    if (ext === 'pdf' || type === 'application/pdf' || (head.length >= 5 && ascii(head.slice(0, 5)) === '%PDF-')) {
      return { modality: 'LAB', kind: 'pdf', confidence: 'type', note: 'PDF: rasterizar con PDF.js y pasar por el parser/OCR de laboratorios.' };
    }
    if (['csv', 'tsv', 'hl7', 'json'].includes(ext) || type === 'application/json' || type === 'text/csv') {
      return { modality: 'LAB', kind: 'labs', confidence: 'extension' };
    }
    if (['hea', 'dat', 'ecg', 'edf', 'xml', 'wfdb'].includes(ext)) {
      return { modality: 'ECG', kind: 'ecg', confidence: 'extension' };
    }
    if (ext === 'txt' || type === 'text/plain') return { modality: 'NOTE', kind: 'text', confidence: 'type' };
    if (/^image\//.test(type) || ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'].includes(ext)) {
      // Una foto puede ser radiografía, laboratorio o recorte de TC. Por defecto PHOTO; el usuario/adaptador precisa.
      const guess = /x-?ray|cxr|chest|torax|tórax/i.test(name) ? 'XR' : 'PHOTO';
      return { modality: guess, kind: 'image', confidence: 'type' };
    }
    return { modality: 'NOTE', kind: 'unknown', confidence: 'fallback' };
  },
};

export const ClinicalSchemaHooks = {
  setSchema(schema) { clinicalSchema = schema; },
  getSchema() { return clinicalSchema; },
  validate(resource) {
    if (!clinicalSchema) return { ok: true, pending: true, resource };
    if (typeof clinicalSchema.validate === 'function') return clinicalSchema.validate(resource);
    return { ok: true, resource };
  },
};

export function enqueueJob({ patientId, resourceId, detection, adapterId }) {
  const adapter = adapterId ? ModalityRegistry.get(adapterId) : (ModalityRegistry.byModality(detection?.modality)[0] || ModalityRegistry.get(detection?.modality));
  return {
    patient_id: patientId,
    resource_id: resourceId,
    modality: detection?.modality || 'NOTE',
    adapter: adapter?.id || adapterId || null,
    status: 'queued',
  };
}

/** Registra adaptadores locales (stubs o implementados). Llamar una vez al arranque. */
export function registerBuiltinAdapters() {
  const stub = (id, modality, runMessage) => ({
    id, modality, available: false, stub: true,
    async run() { return { ok: false, stub: true, message: runMessage, findings: [] }; },
  });
  if (!ModalityRegistry.get('rules-engine')) {
    ModalityRegistry.register('RULES', {
      id: 'rules-engine', modality: 'RULES', available: true,
      async run() { return { ok: true, message: 'Motor de reglas: ver js/ia-rules.js', findings: [] }; },
    });
  }
  if (!ModalityRegistry.get('postprocess-hu')) {
    ModalityRegistry.register('CT', {
      id: 'postprocess-hu', modality: 'CT', available: true,
      async run() { return { ok: true, message: 'Postproceso UH: ver tools/ia/postprocess_hu.py (también hook de cliente).', findings: [] }; },
    });
  }
  if (!ModalityRegistry.get('totalsegmentator')) {
    ModalityRegistry.register('CT', {
      id: 'totalsegmentator', modality: 'CT', available: false, precompute: true,
      async run() { return { ok: false, stub: true, message: 'TotalSegmentator solo en precomputo; usar tools/ia/totalseg.py sobre máscaras ya generadas.', findings: [] }; },
    });
  }
  if (!ModalityRegistry.get('torchxrayvision-densenet121')) {
    ModalityRegistry.register('XR', stub('torchxrayvision-densenet121', 'XR', 'Falta el ONNX de DenseNet121 en el cliente. El pipeline local puede exportarlo y correrlo si hay pesos.'));
  }
  if (!ModalityRegistry.get('tesseract-pdf-labs')) {
    ModalityRegistry.register('LAB', stub('tesseract-pdf-labs', 'LAB', 'OCR (Tesseract.js + PDF.js) pendiente de enchufar; el parser y el motor de rangos ya existen en tools/ia/labs.py.'));
  }
  if (!ModalityRegistry.get('bio-clinicalbert')) {
    ModalityRegistry.register('NOTE', stub('bio-clinicalbert', 'NOTE', 'Bio_ClinicalBERT vía transformers.js: gancho listo, sin inferencia en este prototipo. No emite diagnósticos.'));
  }
  if (!ModalityRegistry.get('ecg-fm')) {
    ModalityRegistry.register('ECG', stub('ecg-fm', 'ECG', 'ECG-FM: gancho listo; falta un ECG del caso y la exportación a ONNX.'));
  }
}
