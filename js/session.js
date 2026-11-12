// Sesión sencilla: cierre por inactividad (con aviso de 1 min), por pestaña oculta mucho tiempo y por límite absoluto.
// Se puede ajustar aquí o, solo para pruebas locales, con window.__ATLAS_SESSION = {...} antes de cargar la app.
export const SESSION = { IDLE_MS: 15 * 60e3, WARN_MS: 60e3, HIDDEN_MS: 5 * 60e3, MAX_MS: 2 * 3600e3, ...(globalThis.__ATLAS_SESSION || {}) };
let timer = null, last = 0, started = 0, hiddenAt = 0, onExpire = null, warnEl = null, handlers = [];
const ACT = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'];
function bump() { const n = Date.now(); if (n - last > 400) last = n; }
function warn(msg, canExtend) {
  if (!warnEl) { warnEl = document.createElement('div'); warnEl.className = 'sess-warn'; warnEl.setAttribute('role', 'alert'); document.body.appendChild(warnEl); }
  warnEl.innerHTML = `<span></span>${canExtend ? '<button class="btn sm primary">Seguir conectado</button>' : ''}`; warnEl.firstChild.textContent = msg;
  const b = warnEl.querySelector('button'); if (b) b.onclick = () => { last = Date.now(); hideWarn(); };
}
const hideWarn = () => { warnEl?.remove(); warnEl = null; };
function tick() {
  const n = Date.now(), idle = n - last, life = n - started, S = SESSION;
  if (life >= S.MAX_MS) return expire('límite de sesión alcanzado');
  if (document.hidden && hiddenAt && n - hiddenAt >= S.HIDDEN_MS) return expire('pestaña en segundo plano');
  if (idle >= S.IDLE_MS) return expire('inactividad');
  const left = Math.min(S.IDLE_MS - idle, S.MAX_MS - life), lifeLeft = S.MAX_MS - life;
  if (left <= S.WARN_MS) warn(lifeLeft <= S.WARN_MS && lifeLeft <= S.IDLE_MS - idle ? `La sesión alcanzó su límite: se cerrará en ${Math.ceil(lifeLeft / 1000)} s.` : `Sesión por inactividad: se cerrará en ${Math.ceil(left / 1000)} s.`, lifeLeft > S.WARN_MS);
  else hideWarn();
}
function vis() { if (document.hidden) hiddenAt = Date.now(); else { if (hiddenAt && Date.now() - hiddenAt >= SESSION.HIDDEN_MS) expire('pestaña en segundo plano'); hiddenAt = 0; } }
function expire(why) { stopSession(); onExpire?.(why); }
export function startSession(cb) {
  stopSession(); onExpire = cb; last = started = Date.now(); hiddenAt = 0;
  for (const e of ACT) { addEventListener(e, bump, { passive: true, capture: true }); handlers.push(e); }
  document.addEventListener('visibilitychange', vis); timer = setInterval(tick, 1000);
}
export function stopSession() {
  clearInterval(timer); timer = null; for (const e of handlers) removeEventListener(e, bump, { capture: true }); handlers = [];
  document.removeEventListener('visibilitychange', vis); hideWarn();
}
