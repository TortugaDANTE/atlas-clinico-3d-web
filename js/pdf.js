// Exportar PDF en el navegador (jsPDF vendorizado, carga bajo demanda). Nada sale del navegador: el PDF se arma en memoria y se descarga localmente.
// Diseño clínico en blanco: portada con índice, una ficha por página (con continuaciones), encabezado con paciente/caso/fecha y pie con aviso en cada página.
import { FONT_REG, FONT_BOLD } from './pdf-fonts.js';

let jspdfP = null;
function loadJsPDF() {
  if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
  return jspdfP ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    s.onload = () => res(globalThis.jspdf.jsPDF); s.onerror = () => { jspdfP = null; rej(new Error('No se pudo cargar el generador de PDF.')); }; document.head.appendChild(s);
  });
}
const COL = { ok: [38, 150, 112], warn: [196, 122, 10], crit: [200, 40, 40], info: [48, 108, 178], normal: [38, 150, 112], low: [48, 108, 178], high: [196, 122, 10], border: [196, 122, 10] };
const SRCL = { interpretacion_ia: 'INTERPRETACIÓN IA', reporte: 'REPORTE', transcrito_de_fotos: 'TRANSCRITO DE FOTOS' };
const GL = { normal: '✓', low: '↓', high: '↑', border: '•', info: 'i', warn: '!' };
// DejaVu (subconjunto) no incluye emojis: se quitan o sustituyen
const clean = s => String(s ?? '').replace(/[⚠️]/gu, '').replace(/\uFE0F/g, '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, c => c === '✓' ? '✓' : '').replace(/ℹ/g, 'i');

// Markdown -> bloques [{k:'h',n,runs}|{k:'p',runs}|{k:'li',n,runs,ord}|{k:'q',runs}|{k:'hr'}|{k:'t',rows}]
function runsOf(t) {
  const out = []; const re = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g; let last = 0, m; t = clean(t);
  while ((m = re.exec(t))) { if (m.index > last) out.push({ t: t.slice(last, m.index) }); out.push({ t: m[1] ?? m[2] ?? m[3], b: m[1] != null }); last = re.lastIndex; }
  if (last < t.length) out.push({ t: t.slice(last) }); return out;
}
function mdBlocks(md) {
  const L = String(md).replace(/\r/g, '').split('\n'), B = []; let i = 0;
  while (i < L.length) {
    const l = L[i]; if (!l.trim()) { i++; continue; } let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { B.push({ k: 'h', n: m[1].length, runs: runsOf(m[2]) }); i++; continue; }
    if (/^---+$/.test(l.trim())) { B.push({ k: 'hr' }); i++; continue; }
    if (l.startsWith('>')) { const b = []; while (i < L.length && L[i].startsWith('>')) b.push(L[i++].replace(/^>\s?/, '')); B.push({ k: 'q', runs: runsOf(b.join(' ')) }); continue; }
    if (l.trim().startsWith('|')) {
      const rows = []; while (i < L.length && L[i].trim().startsWith('|')) rows.push(L[i++].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      B.push({ k: 't', rows: rows.filter((r, k) => !(k === 1 && r.every(c => /^:?-+:?$/.test(c)))).map(r => r.map(runsOf)) }); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      let n = 0; while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) { const ord = /^\s*\d+\./.test(L[i]); n++; B.push({ k: 'li', ord, n, runs: runsOf(L[i++].replace(/^\s*([-*]|\d+\.)\s+/, '')) }); } continue;
    }
    if (l.startsWith('```')) { i++; const c = []; while (i < L.length && !L[i].startsWith('```')) c.push(L[i++]); i++; B.push({ k: 'p', runs: runsOf(c.join(' ')) }); continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#{1,4}\s|>|\||\s*([-*]|\d+\.)\s|---|```)/.test(L[i])) p.push(L[i++]); B.push({ k: 'p', runs: runsOf(p.join(' ')) });
  }
  return B;
}
const pngSize = u8 => { const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); return [dv.getUint32(16), dv.getUint32(20)]; };

export async function buildPdf(caseData, fetchBuf, { ids = null, markdown = true, now = new Date() } = {}) {
  const JsPDF = await loadJsPDF();
  const c = caseData.case || {}, assets = caseData.assets || {};
  const docs = (caseData.clinical?.documents || []).filter(d => !ids || ids.includes(d.id));
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.addFileToVFS('DejaVuSans.ttf', FONT_REG); pdf.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', FONT_BOLD); pdf.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  pdf.setProperties({ title: 'Fichas clínicas · Atlas Clínico 3D', subject: 'Interpretación IA, no es reporte oficial', creator: 'Atlas Clínico 3D (generado en el navegador)' });
  const PW = 210, PH = 297, M = 15, W = PW - 2 * M, TOP = 30, BOT = PH - 22;
  let y = TOP;
  const font = (b, size) => { pdf.setFont('DejaVu', b ? 'bold' : 'normal'); pdf.setFontSize(size); };
  const tw = (t, b, size) => { font(b, size); return pdf.getTextWidth(t); };
  const newPage = () => { pdf.addPage(); y = TOP; };
  const ensure = h => { if (y + h > BOT) newPage(); };
  // Texto con tramos en negrita, ajuste de línea. Devuelve líneas [[{t,b}]]
  function layout(runs, width, size, baseBold = false) {
    const lines = []; let cur = [], cw = 0;
    for (const r of runs) for (const w of String(r.t).split(/(\s+)/)) {
      if (!w) continue; const b = baseBold || r.b, ww = tw(w, b, size);
      if (/^\s+$/.test(w)) { if (cur.length) { cur.push({ t: ' ', b }); cw += ww; } continue; }
      if (cw + ww > width && cur.length) { while (cur.length && cur[cur.length - 1].t === ' ') cur.pop(); lines.push(cur); cur = []; cw = 0; }
      cur.push({ t: w, b }); cw += ww;
    }
    while (cur.length && cur[cur.length - 1].t === ' ') cur.pop(); if (cur.length) lines.push(cur); return lines;
  }
  function drawLines(lines, x, size, lh, color = [30, 36, 44]) {
    pdf.setTextColor(...color);
    for (const ln of lines) { let cx = x; for (const s of ln) { font(s.b, size); pdf.text(s.t, cx, y); cx += pdf.getTextWidth(s.t); } y += lh; }
  }
  // Párrafo que puede partirse entre páginas
  function para(runs, { x = M, width = W, size = 9.5, lh = 4.7, bold = false, color, gap = 1.8 } = {}) {
    const lines = layout(runs, width, size, bold);
    for (const ln of lines) { ensure(lh); drawLines([ln], x, size, lh, color); }
    y += gap;
  }
  const T = t => [{ t: clean(t) }];

  // ---------- Portada ----------
  pdf.setTextColor(20, 30, 40); font(true, 20); pdf.text('Fichas clínicas', M, y + 4); y += 12;
  font(false, 10.5); pdf.setTextColor(70, 80, 92);
  const meta = [['Paciente', c.patient], ['Caso', [c.title, c.id].filter(Boolean).join(' · ')], ['Estudio', c.study], ['Fecha del estudio', c.date], ['Institución', c.institution], ['Generado', now.toLocaleString('es-MX') + ' (en el navegador)']].filter(r => r[1]);
  for (const [k, v] of meta) { font(true, 9.5); pdf.setTextColor(90, 100, 112); pdf.text(k, M, y); const ls = layout(T(v), W - 40, 10), y0 = y; drawLines(ls, M + 40, 10, 5, [25, 32, 42]); y = Math.max(y, y0 + 5) + 1; }
  y += 3; pdf.setDrawColor(190, 198, 206); pdf.line(M, y, PW - M, y); y += 7;
  font(true, 12); pdf.setTextColor(25, 32, 42); pdf.text(`Contenido (${docs.length} fichas)`, M, y); y += 7;
  const idxPos = []; // se completa con el número de página después
  for (const d of docs) {
    ensure(7); const lv = d.status?.level || 'info'; pdf.setFillColor(...(COL[lv] || COL.info)); pdf.circle(M + 1.5, y - 1.2, 1.3, 'F');
    font(true, 10); pdf.setTextColor(25, 32, 42); pdf.text(clean(d.title), M + 6, y);
    font(false, 8.5); pdf.setTextColor(100, 110, 120); pdf.text(clean(d.status?.text || ''), M + 6, y + 4.1);
    idxPos.push({ id: d.id, y }); y += 9.5;
  }
  y += 2; para(T(c.disclaimer || 'Interpretación IA, no es reporte oficial.'), { size: 8.5, color: [110, 60, 20] });
  const startPages = {};

  // ---------- Fichas ----------
  for (const d of docs) {
    newPage(); startPages[d.id] = pdf.getNumberOfPages();
    const lv = d.status?.level || 'info', accent = COL[lv] || COL.info;
    pdf.setFillColor(...accent); pdf.rect(M, y - 4.5, 1.6, 12.5, 'F');
    font(true, 15); pdf.setTextColor(20, 30, 40); const tl = layout(T(d.title), W - 6, 15, true); const ty = y; drawLines(tl, M + 5, 15, 6.5); 
    font(false, 8.5); pdf.setTextColor(100, 110, 120); pdf.text(clean(`${d.date_text || d.date || ''}  ·  ${SRCL[d.source] || String(d.source || '').toUpperCase()}`), M + 5, y - 0.5); y += 4;
    if (d.status) { font(true, 9.5); pdf.setTextColor(...accent); pdf.text(clean(d.status.text), M + 5, y); y += 3; }
    y += 5;
    const note = (txt, col = [196, 122, 10], bg = [255, 246, 228]) => {
      const ls = layout(T(txt), W - 10, 9); const h = ls.length * 4.5 + 4; ensure(h + 2);
      pdf.setFillColor(...bg); pdf.rect(M, y - 3.6, W, h, 'F'); pdf.setFillColor(...col); pdf.rect(M, y - 3.6, 1.4, h, 'F');
      const y0 = y; y += 0.3; drawLines(ls, M + 4, 9, 4.5, [60, 45, 20]); y = y0 + h + 0.2;
    };
    if (d.verify) note(d.verify);
    for (const a of d.alerts || []) note(a.text, a.level === 'crit' ? COL.crit : COL.warn, a.level === 'crit' ? [253, 238, 238] : [255, 246, 228]);
    // valores clave en cuadrícula de 3
    const kv = d.key_values || [];
    if (kv.length) {
      const cw = (W - 6) / 3;
      for (let i = 0; i < kv.length; i += 3) {
        const row = kv.slice(i, i + 3).map(k => ({ k, nl: layout(T(k.name), cw - 5, 7.5), vl: layout(T(`${k.value}${k.unit ? ' ' + k.unit : ''}`), cw - 5, 10.5, true), fl: k.flag_text ? layout(T(k.flag_text), cw - 5, 7.5) : [] }));
        const h = Math.max(...row.map(r => r.nl.length * 3.4 + r.vl.length * 4.8 + r.fl.length * 3.4 + 3));
        ensure(h + 2);
        row.forEach((r, j) => {
          const x = M + j * (cw + 3), col = COL[r.k.flag || 'normal'] || COL.info;
          pdf.setFillColor(r.k.highlight ? 255 : 247, r.k.highlight ? 249 : 249, r.k.highlight ? 236 : 250); pdf.setDrawColor(215, 222, 230); pdf.rect(x, y - 3.4, cw, h, 'FD'); pdf.setFillColor(...col); pdf.rect(x, y - 3.4, 1.1, h, 'F');
          const y0 = y; y += 0.2; drawLines(r.nl, x + 3, 7.5, 3.4, [105, 115, 126]); drawLines(r.vl, x + 3, 10.5, 4.8, [20, 28, 38]); drawLines(r.fl, x + 3, 7.5, 3.4, col); y = y0;
        });
        y += h + 1.6;
      }
      y += 1;
    }
    if (d.summary) para(T(d.summary), { size: 10, lh: 5, gap: 3, color: [35, 42, 52] });
    // gráfica de barras
    if (d.chart) {
      const ch = d.chart, mx = ch.max || Math.max(...ch.items.map(i => i.value)) * 1.1, bw = W - 30 - 14, rowH = 5.6, h = 9 + ch.items.length * rowH + (ch.threshold_label ? 5 : 0);
      ensure(h); font(true, 9.5); pdf.setTextColor(25, 32, 42); pdf.text(clean(`${ch.title} (${ch.unit || ''})`), M, y); y += 5;
      for (const it of ch.items) {
        font(true, 8.5); pdf.setTextColor(60, 70, 80); pdf.text(clean(it.label), M, y + 1);
        pdf.setFillColor(232, 237, 242); pdf.rect(M + 14, y - 2.8, bw, 4.2, 'F'); pdf.setFillColor(47, 170, 130); pdf.rect(M + 14, y - 2.8, bw * it.value / mx, 4.2, 'F');
        if (ch.threshold != null) { pdf.setDrawColor(230, 150, 20); pdf.setLineWidth(0.5); const tx = M + 14 + bw * ch.threshold / mx; pdf.line(tx, y - 3.4, tx, y + 1.8); pdf.setLineWidth(0.2); }
        font(true, 8.5); pdf.setTextColor(25, 32, 42); pdf.text(String(it.value), M + 14 + bw + 3, y + 1); y += rowH;
      }
      if (ch.threshold_label) { font(false, 7.5); pdf.setTextColor(150, 100, 20); pdf.text(clean('| ' + ch.threshold_label), M + 14, y + 0.5); y += 4; }
      y += 3;
    }
    // imágenes
    for (const im of d.images || []) {
      try {
        const buf = new Uint8Array(await fetchBuf(im.file)); const [iw, ih] = pngSize(buf);
        let w = W, h = w * ih / iw; const maxH = BOT - TOP - 14; if (h > maxH) { h = maxH; w = h * iw / ih; }
        ensure(h + 9); pdf.addImage(buf, 'PNG', M, y - 2, w, h, undefined, 'FAST'); y += h + 2.5;
        font(false, 7.5); pdf.setTextColor(110, 118, 128); const cl = layout(T(im.caption), W, 7.5); drawLines(cl, M, 7.5, 3.4); y += 3;
      } catch (e) { para(T('[No se pudo incluir la imagen: ' + im.file + ']'), { size: 8, color: [160, 60, 60] }); }
    }
    // documento completo
    if (markdown && d.markdown) {
      ensure(14); pdf.setDrawColor(200, 207, 214); pdf.line(M, y, PW - M, y); y += 5.5; font(true, 8); pdf.setTextColor(120, 128, 138); pdf.text('DOCUMENTO COMPLETO', M, y); y += 5;
      for (const b of mdBlocks(d.markdown)) {
        if (b.k === 'h') { y += 1.5; ensure(10); para(b.runs, { size: [0, 12, 11, 10, 10][b.n] || 10, lh: 5.4, bold: true, gap: 1.2, color: [20, 30, 40] }); }
        else if (b.k === 'p') para(b.runs, {});
        else if (b.k === 'li') { ensure(5); font(false, 9.5); pdf.setTextColor(30, 36, 44); pdf.text(b.ord ? b.n + '.' : '•', M + 2, y); para(b.runs, { x: M + 8, width: W - 8, gap: 0.6 }); }
        else if (b.k === 'q') { const y0 = y; para(b.runs, { x: M + 5, width: W - 8, color: [90, 70, 30] }); pdf.setFillColor(230, 170, 60); pdf.rect(M + 1, y0 - 3.4, 1, Math.max(4, y - y0 - 1), 'F'); }
        else if (b.k === 'hr') { ensure(4); pdf.setDrawColor(210, 215, 220); pdf.line(M, y, PW - M, y); y += 4; }
        else if (b.k === 't') {
          const n = Math.max(...b.rows.map(r => r.length)), cw = W / n;
          b.rows.forEach((r, ri) => {
            const cl = r.map(cell => layout(cell, cw - 3, 8.5, ri === 0)), h = Math.max(...cl.map(l => l.length)) * 4 + 2; ensure(h);
            if (ri === 0) { pdf.setFillColor(238, 242, 246); pdf.rect(M, y - 3.6, W, h, 'F'); }
            pdf.setDrawColor(215, 221, 228); pdf.rect(M, y - 3.6, W, h);
            const y0 = y; cl.forEach((l, j) => { y = y0; drawLines(l, M + j * cw + 1.5, 8.5, 4, [30, 36, 44]); }); y = y0 + h;
          }); y += 2;
        }
      }
    }
  }
  // ---------- Encabezado y pie en todas las páginas + enlaces del índice ----------
  const N = pdf.getNumberOfPages();
  for (let p = 1; p <= N; p++) {
    pdf.setPage(p);
    font(true, 8.5); pdf.setTextColor(20, 30, 40); pdf.text('Atlas Clínico 3D · Fichas clínicas', M, 12);
    font(false, 8); pdf.setTextColor(95, 105, 116);
    pdf.text(clean(String(c.patient || '')), PW - M, 11, { align: 'right' });
    pdf.text(clean([c.title, c.id].filter(Boolean).join(' · ') + (c.date ? '  ·  Estudio ' + c.date : '')), PW - M, 15.2, { align: 'right', maxWidth: 125 });
    pdf.setDrawColor(150, 160, 172); pdf.setLineWidth(0.3); pdf.line(M, 18, PW - M, 18); pdf.setLineWidth(0.2);
    pdf.line(M, PH - 17, PW - M, PH - 17);
    font(true, 8); pdf.setTextColor(150, 70, 10); pdf.text('Interpretación IA, no es reporte oficial.', M, PH - 12.5);
    font(false, 7.5); pdf.setTextColor(110, 118, 128); pdf.text('Apoyo para el médico tratante; no sustituye el criterio clínico.', M, PH - 8.5);
    pdf.text(`Página ${p} de ${N}`, PW - M, PH - 12.5, { align: 'right' });
  }
  pdf.setPage(1); font(false, 8.5);
  for (const ip of idxPos) { pdf.setTextColor(120, 128, 138); pdf.text(`p. ${startPages[ip.id]}`, PW - M, ip.y, { align: 'right' }); pdf.link(M, ip.y - 4, W, 8, { pageNumber: startPages[ip.id] }); }
  return pdf;
}
export async function exportPdf(caseData, fetchBuf, opts = {}) {
  const pdf = await buildPdf(caseData, fetchBuf, opts);
  const name = opts.filename || `fichas-clinicas-${new Date().toISOString().slice(0, 10)}.pdf`;
  pdf.save(name); return { pages: pdf.getNumberOfPages(), name };
}
