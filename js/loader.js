// Carga de geometrías del caso: GLB (nodo por órgano) o STL, todas en mm. Aplica transformación opcional del caso.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const glbCache = new Map();
// fetchBuf(file) -> ArrayBuffer. Por defecto descarga por red; el caso protegido lo sustituye por una función que descifra.
const netFetch = (base) => async (file) => { const r = await fetch(base + file); if (!r.ok) throw new Error(`No se pudo cargar ${file} (${r.status})`); return r.arrayBuffer(); };
async function loadGLB(file, fetchBuf) {
  if (!glbCache.has(file)) glbCache.set(file, fetchBuf(file).then(buf => new GLTFLoader().parseAsync(buf, '')));
  return glbCache.get(file);
}
function collect(root) {
  root.updateWorldMatrix(true, true);
  const out = [];
  root.traverse(o => {
    if (o.isMesh) {
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      out.push(g);
    }
  });
  return out;
}
function normalize(geos) {
  const arr = geos.map(g => {
    const q = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
    return q;
  });
  const hasUV = arr.every(g => g.attributes.uv);
  if (!hasUV) arr.forEach(g => g.deleteAttribute('uv'));
  const m = arr.length === 1 ? arr[0] : mergeGeometries(arr);
  if (!m.attributes.normal) {   // sin normales (p. ej. STL): soldar vértices y suavizar
    for (const k of Object.keys(m.attributes)) if (k !== 'position') m.deleteAttribute(k);
    const w = mergeVertices(m, 1e-3); w.computeVertexNormals(); return w;
  }
  return m;
}
export function ensureUV(g) {
  if (g.attributes.uv) return g;
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i) * 0.5) / 90; uv[i * 2 + 1] = (p.getY(i) + p.getZ(i) * 0.5) / 90; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}

export async function loadCaseGeometries(caseData, base = '', fetchBuf = null) {
  fetchBuf = fetchBuf || netFetch(base);
  const res = {};
  const tf = caseData.model?.transform_matrix ? new THREE.Matrix4().fromArray(caseData.model.transform_matrix) : null; // column-major, opcional
  const unitScale = caseData.model?.units === 'm' ? 1000 : 1; // el visor trabaja en mm
  for (const o of caseData.model.organs) {
    const spec = typeof o.mesh === 'string' ? { file: o.mesh } : o.mesh;
    let geos;
    if (/\.stl$/i.test(spec.file)) {
      const g = new STLLoader().parse(await fetchBuf(spec.file)); geos = [g];
    } else {
      const gltf = await loadGLB(spec.file, fetchBuf);
      let node = gltf.scene;
      if (spec.node) { node = gltf.scene.getObjectByName(spec.node); if (!node) throw new Error(`Nodo "${spec.node}" no existe en ${spec.file}`); }
      geos = collect(node);
    }
    const g = normalize(geos);
    if (unitScale !== 1) g.scale(unitScale, unitScale, unitScale);
    if (tf) g.applyMatrix4(tf);
    g.computeBoundingBox();
    res[o.id] = ensureUV(g);
  }
  return res;
}
