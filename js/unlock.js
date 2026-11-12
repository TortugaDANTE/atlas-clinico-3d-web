// Descifrado en el navegador (WebCrypto). Dos contraseñas:
//  1) Contraseña del SITIO: PBKDF2-SHA256 -> AES-256-GCM. Cifra TODO (demo incluida).
//  2) Contraseña del CASO (primer nombre + primer apellido del paciente, normalizada): capa interior AES-256-GCM
//     que cifra además los archivos del caso real (necesita las dos claves).
// Formato de cada capa: iv(12) || ciphertext+tag(16); AAD = nombre del archivo + sufijo. Las contraseñas nunca salen del navegador.
// Tras desbloquear, las claves quedan SOLO en memoria (CryptoKey no extraíbles): nada en URL, localStorage ni sessionStorage. Recargar o cerrar sesión las borra.
const enc = new TextEncoder(), dec = new TextDecoder();
const hex2u8 = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
const u82hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
// Contraseña del sitio: NFC + sin espacios al inicio/fin (los teclados móviles suelen agregar un espacio); distingue mayúsculas/minúsculas
export const normSite = s => s.normalize('NFC').trim();
// Limpieza de versiones anteriores que guardaban la clave en sessionStorage
try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('atlas-clinico-')) sessionStorage.removeItem(k); } catch (e) { }
// Contraseña de caso: mayúsculas, sin acentos/diacríticos, espacios colapsados y recortados
export const normCase = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

async function kdf(pw, saltHex, iterations) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hex2u8(saltHex), iterations }, km, 256));
}
const aesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
// Llave local (HKDF de la clave del sitio o del caso) para cifrar el historial/respaldo; no extraíble
async function localKey(raw, label) {
  const k = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('atlas-clinico-local-v1:' + label) }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aesDec = (key, buf, name, suffix) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12), additionalData: enc.encode(name + suffix) }, key, buf.slice(12));

async function makeVault(base, idx, siteKey, siteRaw) {
  let cache = new Map(), caseKeys = new Map(), localKeys = new Map(), dead = false; // entry -> CryptoKey
  localKeys.set('', await localKey(siteRaw, 'site'));
  const caseOf = name => Object.entries(idx.cases || {}).find(([, c]) => c.files.includes(name));
  const get = (name) => {
    if (dead) return Promise.reject(new Error('Sesión cerrada'));
    if (!cache.has(name)) {
      const p = (async () => {
        const r = await fetch(`${base}${name}?v=${idx.ver || ''}`, { cache: 'no-cache' }); // ?v= evita archivos viejos en caché con un index.json nuevo
        if (!r.ok) throw new Error('Falta ' + name);
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
  const vault = {
    get,
    lock() { dead = true; cache = new Map(); caseKeys = new Map(); localKeys = new Map(); },  // suelta todas las claves y el contenido descifrado
    get locked() { return dead; },
    // Llave AES-GCM (cifrar/descifrar) para datos locales del caso: derivada de la clave del caso si está protegido, o de la del sitio
    localKey(entry) { return localKeys.get(idx.cases?.[entry] ? entry : '') || null; },
    isCaseProtected: entry => !!(idx.cases || {})[entry],
    async _setCaseKey(entry, raw) {
      const c = idx.cases[entry]; caseKeys.set(entry, await aesKey(raw));
      try { await get(c.check); } catch (e) { caseKeys.delete(entry); throw new Error('Contraseña del caso incorrecta.'); }
      localKeys.set(entry, await localKey(raw, 'case:' + entry));
    },
    async hasCaseKey(entry) { return caseKeys.has(entry); },  // ¿ya se abrió este caso en esta sesión?
    async unlockCase(entry, casePw) {
      const c = idx.cases[entry]; await vault._setCaseKey(entry, await kdf(normCase(casePw), c.salt, c.iterations));
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
  return makeVault(base, idx, await aesKey(raw), raw);
}
