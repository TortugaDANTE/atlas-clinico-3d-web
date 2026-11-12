// Historial de versiones de hallazgos/notas (editables) y respaldo cifrado.
//  - IndexedDB del navegador, cada registro cifrado con una llave local (HKDF de la clave de la sesión; AES-256-GCM).
//  - Respaldo: archivo .json cifrado con esa misma llave (se puede importar en otro navegador con las mismas contraseñas).
//  - Nada se escribe en el sitio público ni sale del navegador.
const enc = new TextEncoder(), dec = new TextDecoder();
const DB = 'atlas-clinico-historial', ST = 'v';
const b64 = u => btoa(String.fromCharCode(...u)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id', autoIncrement: true }).createIndex('scope', 'scope'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function seal(key, obj, aad) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)))); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return o; }
async function open(key, u8, aad) { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12), additionalData: enc.encode(aad) }, key, u8.slice(12)))); }

// scope = entrada del caso ('c.bin' / 'd.bin'); key = vault.localKey(scope)
export async function openStore(scope, key) {
  let db = null, mem = []; try { db = await idb(); } catch (e) { db = null; }
  const aad = scope + '|hist1';
  const api = {
    persistent: !!db,
    async list() {
      let rows; if (db) rows = await req(db.transaction(ST).objectStore(ST).index('scope').getAll(scope)); else rows = mem;
      const out = []; for (const r of rows) { try { out.push({ ...(await open(key, r.blob, aad)), _id: r.id }); } catch (e) { /* registro de otra clave: se ignora */ } }
      return out.sort((a, b) => a.ts - b.ts || a.uid.localeCompare(b.uid));
    },
    async add(rec) { // rec: {fid, kind, before, after, label?}
      const full = { ts: Date.now(), ...rec }; full.uid ||= `${full.ts}|${full.fid}|${full.kind}|${Math.random().toString(36).slice(2, 8)}`;
      const blob = await seal(key, full, aad);
      if (db) await req(db.transaction(ST, 'readwrite').objectStore(ST).add({ scope, ts: full.ts, blob })); else mem.push({ id: mem.length + 1, scope, ts: full.ts, blob });
      return full;
    },
    async clear() {
      if (!db) { mem = []; return; }
      const tx = db.transaction(ST, 'readwrite'), st = tx.objectStore(ST); const keys = await req(st.index('scope').getAllKeys(scope)); for (const k of keys) st.delete(k); await new Promise(r => tx.oncomplete = r);
    },
    // Respaldo cifrado (archivo): { app, kind, v, scope, created, data: base64(iv||ct) }
    async exportBackup() {
      const records = (await api.list()).map(({ _id, ...r }) => r);
      const data = b64(await seal(key, { records }, scope + '|backup1'));
      return JSON.stringify({ app: 'atlas-clinico-3d', kind: 'respaldo-cifrado', v: 1, scope, created: new Date().toISOString(), count: records.length, data });
    },
    async importBackup(text) {
      let j; try { j = JSON.parse(text); } catch (e) { throw new Error('El archivo no es un respaldo válido.'); }
      if (j.app !== 'atlas-clinico-3d' || j.kind !== 'respaldo-cifrado' || !j.data) throw new Error('El archivo no es un respaldo de Atlas Clínico 3D.');
      if (j.scope !== scope) throw new Error('Este respaldo pertenece a otro caso (' + (j.scope === 'c.bin' ? 'caso real' : 'ejemplo') + ').');
      let payload; try { payload = await open(key, unb64(j.data), scope + '|backup1'); } catch (e) { throw new Error('No se pudo descifrar: el respaldo es de otras contraseñas o está dañado.'); }
      const have = new Set((await api.list()).map(r => r.uid)); let n = 0;
      for (const r of payload.records) if (!have.has(r.uid)) { const blob = await seal(key, r, aad); if (db) await req(db.transaction(ST, 'readwrite').objectStore(ST).add({ scope, ts: r.ts, blob })); else mem.push({ id: mem.length + 1, scope, ts: r.ts, blob }); n++; }
      return { added: n, total: payload.records.length };
    },
    close() { db?.close(); db = null; },
  };
  return api;
}
