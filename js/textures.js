// Texturas procedurales (canvas) para el modo Realista: color + relieve, repetibles.
import * as THREE from 'three';
import { fbm2p } from './noise.js';

const hex = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const KINDS = {
  liver:    { a: 0x6e2a21, b: 0x8f4234, scale: 5, fine: 0.5, veins: 0.0 },
  kidney:   { a: 0x7d3128, b: 0x9a4a3b, scale: 7, fine: 0.8, veins: 0.0 },
  spleen:   { a: 0x4f2536, b: 0x6d3347, scale: 5, fine: 0.4, veins: 0.0 },
  stomach:  { a: 0xc07f78, b: 0xd9a39a, scale: 6, fine: 0.4, rugae: 1 },
  pancreas: { a: 0xc9a066, b: 0xe3c28c, scale: 14, fine: 1.0, lobules: 1 },
  intestine:{ a: 0xd08e84, b: 0xe5b3a8, scale: 8, fine: 0.4, veins: 1 },
  colon:    { a: 0xbb7f69, b: 0xd9a58f, scale: 6, fine: 0.4, veins: 0 },
  bladder:  { a: 0xc98482, b: 0xe2a8a3, scale: 5, fine: 0.3, veins: 1 },
  gall:     { a: 0x3f6a2e, b: 0x5f8f43, scale: 4, fine: 0.2 },
  bone:     { a: 0xd9cfb4, b: 0xf0e8d2, scale: 9, fine: 1.0, pores: 1 },
  muscle:   { a: 0x7c2622, b: 0xa13a33, scale: 4, fine: 0.5, fibers: 1 },
  artery:   { a: 0xa0201a, b: 0xc13a30, scale: 6, fine: 0.2 },
  vein:     { a: 0x2f3f8a, b: 0x4a62b8, scale: 6, fine: 0.2 },
  collecting:{ a: 0xd8c168, b: 0xefdc8f, scale: 4, fine: 0.2 },
  skin:     { a: 0xcf9c82, b: 0xe5bca3, scale: 6, fine: 0.5 },
  wall:     { a: 0x9a4a40, b: 0xb86a5c, scale: 4, fine: 0.5, fibers: 1 },
  fat:      { a: 0xe9cf7a, b: 0xf6e29a, scale: 6, fine: 0.4 },
  calc:     { a: 0xeee9dc, b: 0xffffff, scale: 8, fine: 0.5 },
};

const cache = {};
export function makeTextures(kind, size = 256) {
  if (cache[kind]) return cache[kind];
  const k = KINDS[kind] || KINDS.liver;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const b = document.createElement('canvas'); b.width = b.height = size;
  const cx = c.getContext('2d'), bx = b.getContext('2d');
  const ci = cx.createImageData(size, size), bi = bx.createImageData(size, size);
  const A = hex(k.a), B = hex(k.b);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let n = fbm2p(u * k.scale, v * k.scale, k.scale, 4, 1);
    let d = fbm2p(u * k.scale * 6, v * k.scale * 6, k.scale * 6, 3, 9) - 0.5; // grano fino
    let h = n + d * 0.35 * k.fine;
    if (k.fibers) { const f = Math.sin((u * 64 + n * 6) * Math.PI * 2); h += f * 0.12; }
    if (k.rugae) { const f = Math.sin((v * 12 + n * 3) * Math.PI * 2); h += f * 0.16; }
    if (k.lobules) { const f = fbm2p(u * 22, v * 22, 22, 2, 5); h += (f - 0.5) * 0.5; }
    if (k.pores) { const f = fbm2p(u * 40, v * 40, 40, 2, 4); if (f > 0.62) h -= (f - 0.62) * 2.4; }
    let col = mix(A, B, Math.min(1, Math.max(0, h * 1.15 - 0.1)));
    if (k.veins) {
      const w1 = Math.abs(fbm2p(u * 7, v * 7, 7, 3, 21) - 0.5);
      if (w1 < 0.018) col = mix(col, [150, 60, 70], 0.6 * (1 - w1 / 0.018));
    }
    const i = (y * size + x) * 4;
    ci.data[i] = col[0]; ci.data[i + 1] = col[1]; ci.data[i + 2] = col[2]; ci.data[i + 3] = 255;
    const g = Math.max(0, Math.min(255, h * 255));
    bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = g; bi.data[i + 3] = 255;
  }
  cx.putImageData(ci, 0, 0); bx.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(b);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  map.colorSpace = THREE.SRGBColorSpace;
  return (cache[kind] = { map, bump, base: A });
}
export function glowTexture(rgb = [255, 255, 255]) {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.18, `rgba(${rgb},0.55)`); gr.addColorStop(0.45, `rgba(${rgb},0.12)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function ringTexture(rgb = [255, 255, 255]) {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'); g.strokeStyle = `rgb(${rgb})`; g.lineWidth = 5;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.globalAlpha = 0.6; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 20, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
