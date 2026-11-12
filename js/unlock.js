// Descifrado en el navegador (WebCrypto). Dos contraseñas:
//  1) Contraseña del SITIO: PBKDF2-SHA256 -> AES-256-GCM. Cifra TODO (demo incluida).
//  2) Contraseña del CASO (primer nombre + primer apellido del paciente, normalizada): capa interior AES-256-GCM
//     que cifra además los archivos del caso real (necesita las dos claves).
// Formato de cada capa: iv(12) || ciphertext+tag(16); AAD = nombre del archivo + sufijo. Las contraseñas nunca salen del navegador.
// Tras desbloquear, las claves derivadas (no las contraseñas) quedan solo en sessionStorage de esta pestaña.
const enc = new TextEncoder(), dec = new TextDecoder();
const hex2u8 = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
const u82hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
// Contraseña del sitio: NFC + sin espacios al inicio/fin (los teclados móviles suelen agregar un espacio); distingue mayúsculas/minúsculas
export const normSite = s => s.normalize('NFC').trim();
const SK = 'atlas-clinico-k', CK = 'atlas-clinico-ck:';
// Contraseña de caso: mayúsculas, sin acentos/diacríticos, espacios colapsados y recortados
export const normCase = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

async function kdf(pw, saltHex, iterations) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hex2u8(saltHex), iterations }, km, 256));
}
const aesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
const aesDec = (key, buf, name, suffix) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12), additionalData: enc.encode(name + suffix) }, key, buf.slice(12));

async function makeVault(base, idx, siteKey, siteRawHex) {
  const cache = new Map(), caseKeys = new Map(); // entry -> CryptoKey
  const caseOf = name => Object.entries(idx.cases || {}).find(([, c]) => c.files.includes(name));
  const get = (name) => {
    if (!cache.has(name)) {
      const p = (async () => {
        const r = await fetch(`${base}${name}?v=${idx.ver || ''}`, { cache: 'no-cache' });  // ?v= evita archivos viejos en caché con un index.json nuevo if (!r.ok) throw new Error('Falta ' + name);
        let buf = new Uint8Array(await aesDec(siteKey, new Uint8Array(await r.arrayBuffer()), name, idx.aad_suffix));
        const c = caseOf(name);
        if (c) { const k = caseKeys.get(c[0]); if (!k) throw new Error('Caso bloqueado'); buf = new Uint8Array(await aesDec(k, buf, name, c[1].aad_suffix)); }
        return buf.buffer;
      })();
      p.catch(() => cache.delete(name)); cache.set(name, p);
    }
    return cache.get(name);
  };
  try { await get(idx.check); } catch (e) { throw new Error('Contraseña incorrecta. Revisa mayúsculas/minúsculas (puedes mostrar lo escrito con 👁) o recarga la página.'); }
  sessionStorage.setItem(SK, siteRawHex);
  const vault = {
    get,
    lock() { sessionStorage.removeItem(SK); for (const e of Object.keys(idx.cases || {})) sessionStorage.removeItem(CK + e); },
    isCaseProtected: entry => !!(idx.cases || {})[entry],
    async _setCaseKey(entry, raw, persist) {
      const c = idx.cases[entry]; caseKeys.set(entry, await aesKey(raw));
      try { await get(c.check); } catch (e) { caseKeys.delete(entry); throw new Error('Contraseña del caso incorrecta.'); }
      if (persist) sessionStorage.setItem(CK + entry, u82hex(raw));
    },
    async hasCaseKey(entry) { // ¿ya hay clave de caso válida en esta pestaña?
      if (caseKeys.has(entry)) return true; const s = sessionStorage.getItem(CK + entry); if (!s) return false;
      try { await vault._setCaseKey(entry, hex2u8(s), false); return true; } catch (e) { sessionStorage.removeItem(CK + entry); return false; }
    },
    async unlockCase(entry, casePw) {
      const c = idx.cases[entry]; await vault._setCaseKey(entry, await kdf(normCase(casePw), c.salt, c.iterations), true);
    },
    async openCase(entry) {
      const caseData = JSON.parse(dec.decode(await get(entry)));
      const assets = caseData.assets || {};
      // Resolver de archivos del caso: nombre lógico -> bytes descifrados (gunzip si corresponde)
      const fetchBuf = async (file) => {
        const buf = await get(assets[file] || file);
        if (/\.gz$/i.test(file)) { const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))); return ds.arrayBuffer(); }
        return buf;
      };
      return { caseData, fetchBuf };
    },
  };
  return vault;
}
async function getIndex(base) {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador necesita HTTPS (o localhost) para usar WebCrypto.');
  const idx = await (await fetch(`${base}index.json?t=${Date.now()}`, { cache: 'no-store' })).json();
  if (idx.v !== 2 || idx.kdf !== 'PBKDF2-SHA256' || idx.iterations < 600000) throw new Error('Formato de bóveda no soportado.');
  for (const c of Object.values(idx.cases || {})) if (c.iterations < 600000) throw new Error('Formato de bóveda no soportado.');
  return idx;
}
export async function unlock(base, password, onProgress = () => { }) {
  const idx = await getIndex(base);
  onProgress('Derivando clave…');
  const raw = await kdf(normSite(password), idx.salt, idx.iterations);
  return makeVault(base, idx, await aesKey(raw), u82hex(raw));
}
// Reabre la bóveda con la clave guardada en esta pestaña (null si no hay o ya no sirve)
export async function restore(base) {
  const raw = sessionStorage.getItem(SK); if (!raw) return null;
  try { const idx = await getIndex(base); return await makeVault(base, idx, await aesKey(hex2u8(raw)), raw); }
  catch (e) { sessionStorage.removeItem(SK); return null; }
}
