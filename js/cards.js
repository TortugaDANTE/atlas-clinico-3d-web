import * as THREE from 'three';

export const SRC = {
  reporte: { label: 'REPORTE', rgb: [64, 214, 170], css: '#40d6aa' },
  ia: { label: 'INTERPRETACIÓN IA', rgb: [255, 181, 71], css: '#ffb547' },
};
export const normSource = s => (String(s || '').toLowerCase().includes('ia') ? 'ia' : 'reporte');
const fmt = (n, d = 0) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: d });
export function sizeText(sz, txt) {
  if (txt) return txt;
  if (sz == null) return '—';
  if (Array.isArray(sz)) return sz.map(x => fmt(x, 1)).join(' × ') + ' mm';
  return '≈ ' + fmt(sz, 1) + ' mm';
}
export function huText(f) {
  if (f.hu_text) return f.hu_text;
  if (f.hu_max != null) return fmt(f.hu_max) + ' UH máx.';
  if (f.hu_mean != null) return fmt(f.hu_mean) + ' UH';
  return '— UH';
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function ell(g, t, maxW) { if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
function wrap(g, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = ell(g, lines[maxLines - 1] + '…', maxW); }
  return lines;
}
const FONT = '"Inter","Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif';

export function drawPill(f, { holo = false } = {}) {
  const c = document.createElement('canvas'); c.width = 330; c.height = 84; const g = c.getContext('2d'), src = SRC[f.srcKey], accent = `rgb(${src.rgb})`;
  rr(g, 2, 2, 326, 80, 40); g.fillStyle = holo ? 'rgba(4,22,34,0.85)' : 'rgba(14,20,28,0.9)'; g.fill();
  g.lineWidth = 3; g.strokeStyle = accent; g.stroke();
  g.fillStyle = accent; g.beginPath(); g.arc(42, 42, 27, 0, 7); g.fill();
  g.fillStyle = '#05161a'; g.font = `800 25px ${FONT}`; g.textAlign = 'center'; g.fillText(f.id, 42, 51);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 29px ${FONT}`;
  const sz = Array.isArray(f.size_mm) ? Math.max(...f.size_mm) : f.size_mm;
  g.fillText(f.size_text ? f.size_text.replace('≈ ', '') : `${fmt(sz, 1)} mm`, 82, 38);
  g.fillStyle = '#b8c6d4'; g.font = `600 21px ${FONT}`; g.fillText((f.hu_text ? f.hu_text.replace(' máx.', '').replace('*', '') : (f.hu_max != null ? `${fmt(f.hu_max)} UH` : (f.hu_mean != null ? `${fmt(f.hu_mean)} UH` : ''))), 82, 63);
  return c;
}
export function drawCard(f, { expanded = false, holo = false, organLabel = '' } = {}) {
  const W = 600, pad = 26, src = SRC[f.srcKey];
  const c = document.createElement('canvas'); c.width = W;
  let g = c.getContext('2d');
  g.font = `400 24px ${FONT}`;
  const noteLines = expanded ? wrap(g, f.note, W - pad * 2 - 12, 4) : [];
  const H = expanded ? 170 + 36 + noteLines.length * 32 + 52 : 188;
  c.height = H; g = c.getContext('2d');
  const accent = `rgb(${src.rgb})`;
  rr(g, 2, 2, W - 4, H - 4, 22);
  g.fillStyle = holo ? 'rgba(4,22,34,0.82)' : 'rgba(14,20,28,0.88)'; g.fill();
  g.lineWidth = holo ? 3 : 2; g.strokeStyle = holo ? 'rgba(80,225,255,0.85)' : 'rgba(255,255,255,0.16)'; g.stroke();
  g.fillStyle = accent; rr(g, 2, 2, 12, H - 4, 6); g.fill();
  let y = 46; const x = pad + 8, mw = W - pad * 2 - 8;
  g.fillStyle = '#f2f6fa'; g.font = `700 29px ${FONT}`; g.fillText(ell(g, f.title, mw), x, y);
  y += 34; g.fillStyle = holo ? '#8fdcf0' : '#9fb0c2'; g.font = `500 22px ${FONT}`;
  g.fillText(ell(g, f.location || organLabel, mw), x, y);
  y += 20;
  if (expanded) {
    g.fillStyle = holo ? '#8fdcf0' : '#9fb0c2'; g.font = `500 20px ${FONT}`;
    g.fillText('ÓRGANO / REGIÓN: ' + (organLabel || '—').toUpperCase(), x, y + 14); y += 26;
  }
  // medidas
  y += 28; g.fillStyle = '#ffffff'; g.font = `700 34px ${FONT}`;
  const sz = sizeText(f.size_mm, f.size_text), hu = huText(f);
  g.fillText(sz, x, y);
  const w1 = g.measureText(sz).width;
  g.fillStyle = accent; g.fillText('·', x + w1 + 14, y);
  g.fillStyle = '#ffffff'; g.fillText(hu, x + w1 + 40, y);
  if (expanded) {
    g.fillStyle = '#d7e0ea'; g.font = `400 24px ${FONT}`; y += 18;
    for (const l of noteLines) { y += 32; g.fillText(l, x, y); }
  }
  // insignia
  g.font = `700 19px ${FONT}`;
  const bt = src.label, bw = g.measureText(bt).width + 30, bh = 32, bx = x, by = H - 18 - bh;
  rr(g, bx, by, bw, bh, 16); g.fillStyle = `rgba(${src.rgb},0.16)`; g.fill(); g.lineWidth = 2; g.strokeStyle = accent; g.stroke();
  g.fillStyle = accent; g.fillText(bt, bx + 15, by + 22);
  if (!expanded) { g.fillStyle = '#8091a3'; g.font = `500 18px ${FONT}`; g.textAlign = 'right'; g.fillText('toca para detalle', W - pad, H - 26); }
  return c;
}
export function cardTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; return t;
}
