// Modelo anatómico GENÉRICO y esquemático de abdomen, generado de forma procedural (sin datos de pacientes).
// Coordenadas en mm. Ejes: x = izquierda del paciente (+), y = craneal (+), z = anterior (+).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from './noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.max(0, Math.min(1, t));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function smoothNormals(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal, m = new Map();
  const key = i => `${Math.round(pos.getX(i) * 40)},${Math.round(pos.getY(i) * 40)},${Math.round(pos.getZ(i) * 40)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i); let e = m.get(k); if (!e) m.set(k, e = [0, 0, 0]);
    e[0] += nor.getX(i); e[1] += nor.getY(i); e[2] += nor.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const e = m.get(key(i)), l = Math.hypot(e[0], e[1], e[2]) || 1;
    nor.setXYZ(i, e[0] / l, e[1] / l, e[2] / l);
  }
  return geo;
}

function blob({ c = [0, 0, 0], r = [1, 1, 1], rot = [0, 0, 0], seg = [48, 36], deform = null, nAmp = 0.04, nFreq = 1.6, seed = 1 }) {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  const p = g.attributes.position, v = new THREE.Vector3(), d = new THREE.Vector3();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); d.copy(v);
    const s = 1 + nAmp * (fbm(d.x * nFreq + seed * 7.1, d.y * nFreq + seed * 3.3, d.z * nFreq + seed * 1.7, 3) - 0.5) * 2;
    v.multiplyScalar(s); v.x *= r[0]; v.y *= r[1]; v.z *= r[2];
    if (deform) deform(v, d);
    v.applyQuaternion(q); v.x += c[0]; v.y += c[1]; v.z += c[2];
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return smoothNormals(g);
}

// Tubo con radio variable, ruido y UV (u a lo largo, v alrededor)
function tube(points, radiusFn, { seg = 160, rad = 14, noise = 0, seed = 1, ellip = [1, 1], closed = false, uvScale = 60 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)), closed, 'centripetal');
  const L = curve.getLength();
  const fr = curve.computeFrenetFrames(seg, closed);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, P = curve.getPointAt(u), N = fr.normals[i], B = fr.binormals[i];
    let r = radiusFn(u, L);
    if (noise) r *= 1 + noise * (fbm(P.x * 0.04, P.y * 0.04, P.z * 0.04, 3, seed) - 0.5) * 2;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2, ca = Math.cos(a) * ellip[0], sa = Math.sin(a) * ellip[1];
      pos.push(P.x + (N.x * ca + B.x * sa) * r, P.y + (N.y * ca + B.y * sa) * r, P.z + (N.z * ca + B.z * sa) * r);
      uv.push(u * L / uvScale, j / rad);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return smoothNormals(g);
}
const cap = (u, r, e = 0.025) => r * Math.sqrt(Math.min(1, Math.max(0.0001, Math.min(u, 1 - u) / e)));

// Silueta del tronco: lofteo de supercírculos
function interp(keys, y) {
  if (y <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (y <= keys[i][0]) {
    const t = (y - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
    return lerp(keys[i - 1][1], keys[i][1], t * t * (3 - 2 * t));
  }
  return keys[keys.length - 1][1];
}
const KA = [[-270, 130], [-200, 178], [-120, 176], [-20, 162], [60, 162], [150, 170], [230, 172], [260, 150]];
const KB = [[-270, 100], [-200, 112], [-120, 115], [-20, 108], [60, 108], [150, 118], [230, 120], [260, 100]];
function torsoShell(off, y0, y1, seg = [72, 90], n = 2.5) {
  const [M, N] = seg, tap = 28, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, y = lerp(y0, y1, t);
    const e = Math.max(0, Math.max(y0 + tap - y, y - (y1 - tap)) / tap);
    const s = Math.sqrt(Math.max(0.0004, 1 - e * e));
    const a = (interp(KA, y) - off) * s, b = (interp(KB, y) - off * 0.95) * s;
    const yy = y + (e > 0 ? (y > 0 ? 1 : -1) * 0 : 0);
    for (let j = 0; j <= M; j++) {
      const th = (j / M) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), z = b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      pos.push(x, yy, z); uv.push(j / M * 3, t * 3);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); return smoothNormals(g);
}

function mergeClean(geos) {
  const arr = geos.map(g => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); return q; });
  return mergeVertices(smoothNormals(mergeGeometries(arr)), 1e-3);
}

function vertebra(y, k) {
  const s = lerp(0.88, 1.18, k), parts = [];
  let g = new THREE.CylinderGeometry(21 * s, 23 * s, 20, 26, 1); g.scale(1, 1, 0.82); g.translate(0, y, -56); parts.push(g);
  g = new THREE.TorusGeometry(13 * s, 4.2, 8, 18); g.scale(1.1, 1, 1); g.translate(0, y + 2, -80); parts.push(g);
  g = new THREE.BoxGeometry(7, 15 * s, 36 * s); g.rotateX(0.35); g.translate(0, y - 3, -96 - 4 * s); parts.push(g);
  for (const sx of [-1, 1]) {
    g = new THREE.CylinderGeometry(3.6, 4.2, 38 * s, 8); g.rotateZ(Math.PI / 2); g.translate(sx * 33 * s, y + 2, -80); parts.push(g);
  }
  // 'g' pueden diferir en atributos: normalizar
  return parts;
}

export function buildOrgans() {
  const O = {}; // id -> BufferGeometry

  // ---- Cuerpo y pared ----
  O.piel = torsoShell(0, -270, 260);
  O.pared_abdominal = torsoShell(18, -255, 240);
  O.grasa_visceral = torsoShell(32, -238, 218);

  // ---- Óseo ----
  {
    const parts = [];
    for (let i = 0; i < 15; i++) for (const p of vertebra(215 - i * 28.5, i / 14)) parts.push(p);
    O.columna = mergeClean([...parts, blob({ c: [0, -234, -58], r: [38, 40, 20], rot: [0.5, 0, 0], nAmp: 0.05, seed: 3, deform: (v, d) => { v.x *= 1 - 0.35 * sstep(-0.2, 1, -d.y); } }),
      blob({ c: [0, -272, -42], r: [9, 16, 8], rot: [0.5, 0, 0], seed: 4 })]);
  }
  {
    const ribs = [];
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) {
      const yi = 232 - i * 21, a = 108 + 24 * Math.sin(Math.PI * (i + 0.6) / 8.5), b = 66 + 10 * Math.sin(Math.PI * (i + 0.6) / 8.5), zc = 6;
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const ph = 0.1 + (k / 10) * 2.1;
        pts.push([s * (24 + a * Math.sin(ph)), yi - ph * 11, zc - b * Math.cos(ph)]);
      }
      if (i < 6) { const last = pts[pts.length - 1]; pts.push([s * (60 - i * 2), last[1] + 14 - i, 82 + i], [s * 22, last[1] + 34 - i * 2, 94]); }
      ribs.push(tube(pts, (u) => cap(u, lerp(5.2, 4, u)), { seg: 70, rad: 8, uvScale: 40 }));
    }
    O.costillas = mergeClean(ribs);
  }
  {
    const p = [];
    for (const s of [-1, 1]) {
      p.push(blob({ c: [s * 112, -125, -28], r: [9, 62, 54], rot: [0, s * 0.55, s * 0.22], seg: [28, 22], nAmp: 0.1, nFreq: 1.1, seed: 5 }));
      p.push(blob({ c: [s * 86, -246, 6], r: [24, 24, 24], seg: [22, 16], nAmp: 0.02, seed: 6 }));
      p.push(blob({ c: [s * 22, -252, 76], r: [14, 10, 10], rot: [0, 0, s * 0.3], seg: [14, 10], seed: 7 }));
      p.push(tube([[s * 70, -176, -20], [s * 60, -214, 30], [s * 30, -246, 70]], (u) => cap(u, 8), { seg: 24, rad: 8 }));
    }
    p.push(tube([[-72, -168, -30], [-62, -178, 20], [0, -184, 60], [62, -178, 20], [72, -168, -30]], () => 7, { seg: 36, rad: 8 }));
    O.pelvis = mergeClean(p);
  }

  // ---- Urinario ----
  const kidney = (s, cx, cy) => {
    const m = -s; // dirección medial (hacia línea media): derecho(-x) -> +x
    return blob({
      c: [cx, cy, -48], r: [28, 56, 23], rot: [0.08, 0, s * -0.2], seg: [56, 44], nAmp: 0.025, nFreq: 2.2, seed: s > 0 ? 11 : 12,
      deform: (v, d) => {
        const mm = Math.max(0, m * d.x);
        const notch = 0.55 * Math.exp(-(d.y * d.y) / 0.1 - (d.z * d.z) / 0.35) * mm;
        v.x -= m * notch * 28;
        v.z *= 1 - 0.12 * Math.abs(d.y);
      }
    });
  };
  O.rinon_derecho = kidney(-1, -70, 15);
  O.rinon_izquierdo = kidney(1, 72, 30);
  const collecting = (cx, cy, pelv, cal) => {
    const arr = [blob({ c: pelv, r: [9, 13, 8], seg: [18, 14], nAmp: 0.05, seed: 2 })];
    for (const c of cal) {
      arr.push(blob({ c, r: [6.5, 8, 6], seg: [14, 10], nAmp: 0.08, seed: 3 }));
      arr.push(tube([pelv, [(pelv[0] + c[0]) / 2, (pelv[1] + c[1]) / 2, pelv[2] - 1], c], (u) => 3.4, { seg: 10, rad: 8 }));
    }
    return arr;
  };
  O.colector_derecho = mergeClean(collecting(-70, 15, [-52, 12, -42], [[-60, 40, -46], [-70, 10, -48], [-62, -26, -47]]));
  O.colector_izquierdo = mergeClean(collecting(72, 30, [52, 28, -42], [[64, 56, -46], [76, 28, -48], [66, 2, -47]]));
  O.ureteres = mergeClean([
    tube([[-52, 4, -42], [-58, -30, -40], [-62, -70, -40], [-55, -110, -30], [-40, -150, -5], [-22, -190, 18], [-14, -212, 28]], (u) => cap(u, 2.6, 0.01), { seg: 90, rad: 8, noise: 0.15, seed: 2 }),
    tube([[52, 20, -42], [58, -20, -38], [62, -60, -36], [58, -110, -28], [42, -150, -5], [24, -190, 18], [14, -212, 28]], (u) => cap(u, 2.6, 0.01), { seg: 90, rad: 8, noise: 0.15, seed: 3 }),
  ]);
  O.vejiga = blob({ c: [0, -205, 32], r: [36, 30, 32], seg: [40, 30], nAmp: 0.03, seed: 8, deform: (v, d) => { v.y -= 6 * Math.max(0, -d.y); v.y += 6 * Math.max(0, d.y) * (1 - Math.abs(d.x)); } });

  // ---- Vascular ----
  {
    const aorta = tube([[14, 238, -40], [14, 150, -30], [14, 20, -24], [14, -110, -24], [13, -122, -24]], (u) => cap(u, lerp(10.5, 9, u), 0.01), { seg: 80, rad: 14, uvScale: 40 });
    const parts = [aorta];
    for (const s of [-1, 1]) parts.push(tube([[13, -118, -24], [s * 30, -146, -20], [s * 56, -184, -8], [s * 78, -250, 4]], (u) => cap(u, lerp(7.5, 5.2, u), 0.02), { seg: 40, rad: 10, uvScale: 40 }));
    parts.push(tube([[14, 8, -26], [-8, 4, -38], [-34, 10, -43], [-50, 14, -44]], (u) => cap(u, 3.4, 0.03), { seg: 30, rad: 8 }));
    parts.push(tube([[14, 24, -26], [30, 28, -36], [46, 32, -42]], (u) => cap(u, 3.4, 0.03), { seg: 24, rad: 8 }));
    O.aorta = mergeClean(parts);
    const cava = [tube([[-16, 240, -36], [-17, 150, -30], [-17, 20, -26], [-16, -110, -26], [-15, -122, -26]], (u) => cap(u, lerp(13, 11.5, u), 0.01), { seg: 80, rad: 14, ellip: [1.15, 0.85], uvScale: 40 })];
    for (const s of [-1, 1]) cava.push(tube([[-15, -118, -26], [s * 24, -148, -22], [s * 50, -186, -10], [s * 72, -250, 2]], (u) => cap(u, lerp(9, 6.5, u), 0.02), { seg: 40, rad: 10, uvScale: 40 }));
    cava.push(tube([[-17, 14, -28], [-30, 14, -36], [-50, 17, -44]], (u) => cap(u, 5.2, 0.03), { seg: 24, rad: 8 }));
    cava.push(tube([[-16, 30, -24], [2, 34, -16], [30, 34, -28], [46, 34, -41]], (u) => cap(u, 5.2, 0.03), { seg: 30, rad: 8 }));
    O.vena_cava = mergeClean(cava);
  }

  // ---- Órganos digestivos ----
  O.higado = blob({
    c: [-52, 82, 10], r: [82, 52, 56], rot: [0.15, 0, 0.12], seg: [60, 44], nAmp: 0.03, nFreq: 1.2, seed: 21,
    deform: (v, d) => {
      const l = Math.max(0, d.x);
      v.x += l * 58; v.y *= 1 - 0.55 * l; v.z *= 1 - 0.3 * l;
      v.y -= 14 * Math.max(0, -d.y) * Math.max(0, d.z);
      v.z -= 10 * Math.max(0, -d.z) * Math.max(0, -d.y);
    }
  });
  O.vesicula = blob({ c: [-54, 36, 40], r: [11, 27, 11], rot: [0, 0, 0.5], seg: [24, 18], nAmp: 0.04, seed: 22 });
  O.bazo = blob({ c: [118, 70, -35], r: [21, 52, 31], rot: [0, -0.3, -0.12], seg: [40, 30], nAmp: 0.05, seed: 23, deform: (v, d) => { v.x -= 6 * Math.max(0, -d.x) * (1 - d.y * d.y); } });
  O.estomago = blob({ c: [52, 98, 28], r: [46, 52, 32], rot: [0, 0, -0.35], seg: [44, 34], nAmp: 0.04, seed: 24, deform: (v, d) => { v.x += 20 * d.y * d.y - 14 * Math.max(0, -d.y); v.y += 10 * Math.max(0, d.x) * Math.max(0, -d.y); } });
  O.pancreas = tube([[-30, 20, -8], [-10, 26, 0], [20, 34, -6], [56, 46, -22], [94, 62, -32]], (u) => cap(u, lerp(15, 7.5, u), 0.04), { seg: 70, rad: 14, noise: 0.22, seed: 5, uvScale: 40 });
  O.colon = tube([
    [-105, -135, 25], [-112, -100, 20], [-116, -40, 10], [-114, 20, 5], [-118, 52, 0], [-96, 64, 24],
    [-60, 42, 60], [-20, -2, 72], [20, -12, 72], [60, 16, 62], [100, 50, 32], [122, 64, -10],
    [126, 20, -20], [122, -40, -15], [118, -100, -5], [100, -150, 10], [60, -176, 36], [20, -166, 16], [-10, -190, 2], [8, -214, -26], [2, -230, -34]
  ], (u, L) => {
    const base = u < 0.27 ? 22 : u < 0.62 ? 17 : u < 0.8 ? 14 : u < 0.93 ? 12 : 15;
    return cap(u, base * (1 + 0.1 * Math.sin(u * L / 17 * Math.PI * 2)), 0.015);
  }, { seg: 360, rad: 18, noise: 0.05, seed: 3 });
  {
    const pts = [];
    for (let i = 0; i <= 320; i++) {
      const t = i / 320;
      pts.push([-4 + 74 * Math.sin(Math.PI * 2 * 7.3 * t) * (0.82 + 0.18 * Math.sin(t * 9)), -72 + 54 * Math.sin(Math.PI * 2 * 3.1 * t + 1), 36 + 26 * Math.sin(Math.PI * 2 * 5.7 * t + 2)]);
    }
    const duod = [[-12, 54, 0], [-40, 36, -2], [-42, 6, -8], [-30, -12, -12], [0, -16, -16], [30, -10, -14], [40, -30, 0]];
    O.intestino_delgado = mergeClean([
      tube(pts, (u) => cap(u, 10 + 1.6 * Math.sin(u * 60), 0.01), { seg: 900, rad: 12, noise: 0.04, seed: 9 }),
      tube(duod, (u) => cap(u, 11, 0.02), { seg: 60, rad: 12 }),
    ]);
  }

  // ---- Músculo ----
  {
    const parts = [];
    for (const s of [-1, 1]) {
      parts.push(tube([[s * 24, 150, -46], [s * 30, 60, -40], [s * 40, -40, -28], [s * 62, -150, -2]], (u) => cap(u, lerp(18, 14, u) * (1 + 0.3 * Math.sin(u * Math.PI)), 0.03), { seg: 80, rad: 14, ellip: [1, 0.8], uvScale: 40 }));
      parts.push(blob({ c: [s * 40, 20, -86], r: [24, 235, 20], seg: [28, 36], nAmp: 0.04, seed: 31 }));
    }
    O.musculos = mergeClean(parts);
  }
  return O;
}

// Metadatos usados al exportar el GLB (nodos con id = id de órgano)
export const ORGAN_COLORS = {
  piel: 0xd9a98f, pared_abdominal: 0xa85a4e, grasa_visceral: 0xe9cf7a, columna: 0xe6dcc3, costillas: 0xe6dcc3, pelvis: 0xe6dcc3,
  rinon_derecho: 0x8a3b30, rinon_izquierdo: 0x8a3b30, colector_derecho: 0xe7d27a, colector_izquierdo: 0xe7d27a, ureteres: 0xe3c46a, vejiga: 0xd4948f,
  aorta: 0xb3261e, vena_cava: 0x3a4f9c, higado: 0x7a3226, vesicula: 0x4f7a3a, bazo: 0x5e2b3c, estomago: 0xc98a82, pancreas: 0xd2a46a,
  colon: 0xc78a72, intestino_delgado: 0xd99a8e, musculos: 0x8e2f2b,
};
export function buildGenericGroup({ includeShells = true, scale = 1 } = {}) {
  const geos = buildOrgans(), grp = new THREE.Group(); grp.name = 'abdomen_generico';
  for (const [id, g] of Object.entries(geos)) {
    if (!includeShells && (id === 'piel' || id === 'pared_abdominal' || id === 'grasa_visceral')) continue;
    const isShell = id === 'piel' || id === 'pared_abdominal' || id === 'grasa_visceral';
    const mat = new THREE.MeshStandardMaterial({ color: ORGAN_COLORS[id] || 0xcccccc, roughness: 0.55, metalness: 0, transparent: isShell, opacity: isShell ? 0.14 : 1, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, mat); m.name = id;
    const node = new THREE.Group(); node.name = id; node.add(m); grp.add(node);
  }
  grp.scale.setScalar(scale);
  return grp;
}
