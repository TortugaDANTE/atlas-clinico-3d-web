// Cortes 2D (axial/coronal/sagital): se calculan intersectando las mallas con el plano y rellenando (par-impar).
// Con datos reales, esta misma pantalla puede alimentarse de la serie DICOM (ver README, "slices").
import * as THREE from 'three';
import { SRC } from './cards.js';

const SC = 1.25; // px por mm
const AX = {
  axial:    { axis: 1, name: 'Axial',    u: [-215, 215], v: [-130, 130], label: ['D', 'I', 'A', 'P'], range: [-265, 255], init: 15 },
  coronal:  { axis: 2, name: 'Coronal',  u: [-215, 215], v: [-275, 290], label: ['D', 'I', 'Sup', 'Inf'], range: [-100, 100], init: -45 },
  sagital:  { axis: 0, name: 'Sagital',  u: [-135, 135], v: [-275, 290], label: ['A', 'P', 'Sup', 'Inf'], range: [-165, 165], init: -70 },
};
export { AX };

function project(plane, P) { // P: [x,y,z] -> imagen (mm)
  if (plane === 'axial') return [P[0], -P[2]];
  if (plane === 'coronal') return [P[0], -P[1]];
  return [-P[2], -P[1]];
}

export class SliceView {
  constructor(canvas, viewer) {
    this.canvas = canvas; this.viewer = viewer; this.plane = 'axial';
    this.pos = { axial: AX.axial.init, coronal: AX.coronal.init, sagital: AX.sagital.init };
    this.cache = new Map();
    this.ctx = canvas.getContext('2d');
  }
  _tris(o) {
    let c = this.cache.get(o.id); if (c) return c;
    const g = o.real.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count, arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = pos.getY(i); arr[i * 3 + 2] = pos.getZ(i); }
    c = { arr, idx: idx ? idx.array : null, n }; this.cache.set(o.id, c); return c;
  }
  render() {
    const A = AX[this.plane], val = this.pos[this.plane];
    const W = Math.round((A.u[1] - A.u[0]) * SC), H = Math.round((A.v[1] - A.v[0]) * SC);
    const cv = this.canvas; cv.width = W; cv.height = H;
    const gray = new Float32Array(W * H).fill(0.02);
    const items = [];
    for (const o of this.viewer.organs.values()) items.push({ o, gray: o.def.slice?.gray ?? 0.5, order: o.def.slice?.order ?? 50, g: this._tris(o), m: null });
    for (const f of this.viewer.findings) {
      if (f.data.lesion?.kind === 'lipoma' || true) {
        const lg = f.lesionReal.geometry; const key = 'F' + f.id;
        if (!this.cache.has(key)) {
          const p = lg.attributes.position, arr = new Float32Array(p.count * 3);
          for (let i = 0; i < p.count; i++) { arr[i * 3] = p.getX(i) + f.pos.x; arr[i * 3 + 1] = p.getY(i) + f.pos.y; arr[i * 3 + 2] = p.getZ(i) + f.pos.z; }
          this.cache.set(key, { arr, idx: lg.index ? lg.index.array : null, n: lg.index ? lg.index.count : p.count });
        }
        const lip = f.data.lesion?.kind === 'lipoma';
        items.push({ gray: lip ? 0.20 : 1.0, order: lip ? 5 : 90, g: this.cache.get(key) });
      }
    }
    items.sort((a, b) => a.order - b.order);
    const rows = Array.from({ length: H }, () => []);
    for (const it of items) {
      for (const r of rows) r.length = 0;
      this._slice(it.g, A, val, W, H, rows);
      for (let y = 0; y < H; y++) {
        const xs = rows[y]; if (xs.length < 2) continue; xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
          for (let x = x0; x <= x1; x++) gray[y * W + x] = it.gray;
        }
      }
    }
    // aspecto TC: suavizado leve + ruido + ventana
    const img = this.ctx.createImageData(W, H), d = img.data;
    let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += gray[yy * W + xx]; c++; } }
      let v = s / c; const noise = (rnd() - 0.5) * (v > 0.05 ? 0.09 : 0.02);
      v = Math.min(1, Math.max(0, v + noise));
      const b = Math.round(v * 255), i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = b; d[i + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
    // anotaciones
    const ctx = this.ctx; ctx.font = '600 15px Inter,system-ui,sans-serif'; ctx.fillStyle = 'rgba(190,205,220,0.85)';
    ctx.textAlign = 'left'; ctx.fillText(A.label[0] === 'D' ? 'D' : A.label[0], 8, H / 2 + 5);
    ctx.textAlign = 'right'; ctx.fillText(A.label[1], W - 8, H / 2 + 5);
    ctx.textAlign = 'center'; ctx.fillText(A.label[2], W / 2, 20); ctx.fillText(A.label[3], W / 2, H - 9);
    this.marks = [];
    for (const f of this.viewer.findings) {
      const dist = Math.abs(f.pos.getComponent(A.axis) - val);
      if (dist > 6.5) continue;
      const [pu, pv] = project(this.plane, [f.pos.x, f.pos.y, f.pos.z]);
      const px = (pu - A.u[0]) * SC, py = (pv - A.v[0]) * SC, rgb = SRC[f.srcKey].rgb;
      ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 13, 0, 7); ctx.stroke();
      ctx.fillStyle = `rgb(${rgb})`; ctx.textAlign = 'left'; ctx.font = '700 14px Inter,system-ui,sans-serif'; ctx.fillText(f.id, px + 17, py - 9);
    }
    // escala 50 mm
    ctx.strokeStyle = 'rgba(220,230,240,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, H - 26); ctx.lineTo(14 + 50 * SC, H - 26); ctx.stroke();
    ctx.textAlign = 'left'; ctx.font = '600 12px Inter,system-ui,sans-serif'; ctx.fillText('50 mm', 14, H - 32);
    return { val, A };
  }
  _slice(g, A, val, W, H, rows) {
    const { arr, idx, n } = g, ax = A.axis; const plane = this.plane;
    const v = [0, 0, 0], pts = [[0, 0, 0], [0, 0, 0]];
    const cu = A.u[0], cvv = A.v[0];
    const tri = idx ? (i) => [idx[i], idx[i + 1], idx[i + 2]] : (i) => [i, i + 1, i + 2];
    for (let i = 0; i < n; i += 3) {
      const [a, b, c] = tri(i);
      const da = arr[a * 3 + ax] - val, db = arr[b * 3 + ax] - val, dc = arr[c * 3 + ax] - val;
      if ((da > 0 && db > 0 && dc > 0) || (da <= 0 && db <= 0 && dc <= 0)) continue;
      const ids = [a, b, c], ds = [da, db, dc]; let k = 0;
      for (let e = 0; e < 3 && k < 2; e++) {
        const i0 = ids[e], i1 = ids[(e + 1) % 3], d0 = ds[e], d1 = ds[(e + 1) % 3];
        if ((d0 > 0) !== (d1 > 0)) {
          const t = d0 / (d0 - d1);
          pts[k][0] = arr[i0 * 3] + (arr[i1 * 3] - arr[i0 * 3]) * t; pts[k][1] = arr[i0 * 3 + 1] + (arr[i1 * 3 + 1] - arr[i0 * 3 + 1]) * t; pts[k][2] = arr[i0 * 3 + 2] + (arr[i1 * 3 + 2] - arr[i0 * 3 + 2]) * t; k++;
        }
      }
      if (k < 2) continue;
      const p0 = project(plane, pts[0]), p1 = project(plane, pts[1]);
      let x0 = (p0[0] - cu) * SC, y0 = (p0[1] - cvv) * SC, x1 = (p1[0] - cu) * SC, y1 = (p1[1] - cvv) * SC;
      if (y0 === y1) continue;
      if (y0 > y1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
      const r0 = Math.max(0, Math.ceil(y0 - 0.5)), r1 = Math.min(H - 1, Math.ceil(y1 - 0.5) - 1);
      for (let r = r0; r <= r1; r++) { const t = (r + 0.5 - y0) / (y1 - y0); rows[r].push(x0 + (x1 - x0) * t); }
    }
  }
}
