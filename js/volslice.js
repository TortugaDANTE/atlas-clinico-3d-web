// Panel 2D con cortes REALES (axial/coronal/sagital) a partir del volumen submuestreado (uint8 con ventana de HU) del caso.
// Convención radiológica: axial visto desde los pies (D del paciente a la izquierda), coronal de frente, sagital con anterior a la izquierda.
import { SRC } from './cards.js';

const PPM = 1.25; // px por mm en pantalla
export class VolumeSliceView {
  constructor(canvas, viewer, vol, meta) {
    this.canvas = canvas; this.viewer = viewer; this.vol = vol; this.m = meta; this.ctx = canvas.getContext('2d');
    const [nx, ny, nz] = meta.dims, [sx, sy, sz] = meta.spacing_mm, [ox, oy, oz] = meta.origin_mm;
    this.ox = ox; this.oy = oy; this.oz = oz; this.nx = nx; this.ny = ny; this.nz = nz; this.sx = sx; this.sy = sy; this.sz = sz;
    this.AX = {
      axial: { name: 'Axial', range: [oy, oy + (nz - 1) * sz], axis: 1, label: ['D', 'I', 'A', 'P'] },
      coronal: { name: 'Coronal', range: [oz - (ny - 1) * sy, oz], axis: 2, label: ['D', 'I', 'Sup', 'Inf'] },
      sagital: { name: 'Sagital', range: [ox, ox + (nx - 1) * sx], axis: 0, label: ['A', 'P', 'Sup', 'Inf'] },
    };
    this.plane = 'axial'; this.pos = { axial: 0, coronal: 0, sagital: 0 };
    this.center = [ox + (nx - 1) * sx / 2, oy + (nz - 1) * sz / 2, oz - (ny - 1) * sy / 2];
    this.pos.axial = this.center[1]; this.pos.coronal = this.center[2]; this.pos.sagital = this.center[0];
  }
  planeSize(p) { const w = this.nx * this.sx, h = this.ny * this.sy, d = this.nz * this.sz; return p === 'axial' ? [w, h] : p === 'coronal' ? [w, d] : [h, d]; }
  g(i, j, k) { // muestreo bilineal en (i,j) y lineal en k
    const { nx, ny, nz, vol } = this; if (i < 0 || j < 0 || k < 0 || i > nx - 1 || j > ny - 1 || k > nz - 1) return 0;
    const i0 = i | 0, j0 = j | 0, k0 = k | 0, i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(ny - 1, j0 + 1), k1 = Math.min(nz - 1, k0 + 1);
    const fi = i - i0, fj = j - j0, fk = k - k0, at = (a, b, c) => vol[(c * ny + b) * nx + a];
    const l = (c) => (at(i0, j0, c) * (1 - fi) + at(i1, j0, c) * fi) * (1 - fj) + (at(i0, j1, c) * (1 - fi) + at(i1, j1, c) * fi) * fj;
    return l(k0) * (1 - fk) + l(k1) * fk;
  }
  render() {
    const { nx, ny, nz, sx, sy, sz, ox, oy, oz } = this, plane = this.plane, val = this.pos[plane];
    const [Wmm, Hmm] = this.planeSize(plane), W = Math.round(Wmm * PPM), H = Math.round(Hmm * PPM);
    const cv = this.canvas; cv.width = W; cv.height = H;
    const img = this.ctx.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let i, j, k;
      if (plane === 'axial') { i = x / PPM / sx; j = y / PPM / sy; k = (val - oy) / sz; }
      else if (plane === 'coronal') { i = x / PPM / sx; j = (oz - val) / sy; k = (nz - 1) - y / PPM / sz; }
      else { i = (val - ox) / sx; j = x / PPM / sy; k = (nz - 1) - y / PPM / sz; }
      const b = this.g(i, j, k) | 0, o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = b; d[o + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
    const ctx = this.ctx, A = this.AX[plane];
    ctx.font = '600 15px Inter,system-ui,sans-serif'; ctx.fillStyle = 'rgba(190,205,220,0.9)';
    ctx.textAlign = 'left'; ctx.fillText(A.label[0], 8, H / 2 + 5); ctx.textAlign = 'right'; ctx.fillText(A.label[1], W - 8, H / 2 + 5);
    ctx.textAlign = 'center'; ctx.fillText(A.label[2], W / 2, 20); ctx.fillText(A.label[3], W / 2, H - 9);
    for (const f of this.viewer.findings) {
      const p = [f.pos.x, f.pos.y, f.pos.z]; if (Math.abs(p[A.axis] - val) > 6.5) continue;
      let px, py;
      if (plane === 'axial') { px = (p[0] - ox) * PPM; py = (oz - p[2]) * PPM; }
      else if (plane === 'coronal') { px = (p[0] - ox) * PPM; py = ((nz - 1) * sz - (p[1] - oy)) * PPM; }
      else { px = (oz - p[2]) * PPM; py = ((nz - 1) * sz - (p[1] - oy)) * PPM; }
      const rgb = SRC[f.srcKey].rgb; ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 13, 0, 7); ctx.stroke();
      ctx.fillStyle = `rgb(${rgb})`; ctx.textAlign = 'left'; ctx.font = '700 14px Inter,system-ui,sans-serif'; ctx.fillText(f.id, px + 17, py - 9);
    }
    ctx.strokeStyle = 'rgba(220,230,240,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, H - 26); ctx.lineTo(14 + 50 * PPM, H - 26); ctx.stroke();
    ctx.textAlign = 'left'; ctx.font = '600 12px Inter,system-ui,sans-serif'; ctx.fillStyle = 'rgba(220,230,240,0.9)'; ctx.fillText('50 mm', 14, H - 32);
    return { val, A };
  }
}
