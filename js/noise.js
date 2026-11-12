// Ruido determinista (valor) 3D y 2D periódico (para texturas repetibles)
export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const sm = t => t * t * (3 - 2 * t);
export function vnoise(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  const l = (a, b, c) => hash3(xi + a, yi + b, zi + c, seed);
  const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * u;
  const x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * u;
  const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * u;
  const x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}
export function fbm(x, y, z, oct = 4, seed = 0) {
  let a = 0.5, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f, seed + i); t += a; f *= 2; a *= 0.5; }
  return s / t;
}
// 2D periódico con período P (enteros)
function pn2(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = sm(x - xi), v = sm(y - yi);
  const m = (a) => ((a % P) + P) % P;
  const l = (a, b) => hash3(m(xi + a), m(yi + b), 7, seed);
  const a = l(0, 0) + (l(1, 0) - l(0, 0)) * u;
  const b = l(0, 1) + (l(1, 1) - l(0, 1)) * u;
  return a + (b - a) * v;
}
export function fbm2p(x, y, P, oct = 4, seed = 0) {
  let a = 0.5, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * pn2(x * f, y * f, P * f, seed + i * 3); t += a; f *= 2; a *= 0.5; }
  return s / t;
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
