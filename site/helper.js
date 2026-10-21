// Only the short-lived loopback bearer is kept in browser storage. The CLI API key
// stays in the OS credential store, and phone SSH credentials stay in page memory.
const KEY = 'rominit.helper';
const LOOPBACK = 'http://127.0.0.1:18787';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const challengePattern = /^[a-f0-9]{64}$/;
const pendingConnections = new Map();

/** @param {unknown} value */
export function validHelperSession(value) {
  const s = /** @type {any} */ (value);
  const port = typeof s?.url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(s.url)?.[1];
  return !!port && Number(port) <= 65535 &&
    typeof s.token === 'string' && tokenPattern.test(s.token) && Number.isSafeInteger(s.user?.id) && s.user.id > 0 && typeof s.user.name === 'string' &&
    typeof s.expiresAt === 'string' && Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.expiresAt) > Date.now();
}

function removeSavedSession() {
  try { localStorage.removeItem(KEY); } catch { /* storage may be disabled */ }
  try { sessionStorage.removeItem(KEY); } catch { /* old tab-scoped value */ }
}

/** Migrate the old tab-scoped bearer once; new pairings persist across tabs. */
export function helperSession() {
  try {
    const saved = localStorage.getItem(KEY);
    const legacy = saved === null ? sessionStorage.getItem(KEY) : null;
    const raw = saved ?? legacy;
    const value = JSON.parse(raw ?? 'null');
    if (validHelperSession(value)) {
      if (saved === null) localStorage.setItem(KEY, JSON.stringify(value));
      try { sessionStorage.removeItem(KEY); } catch { /* migration cleanup is best effort */ }
      return value;
    }
    removeSavedSession();
  } catch { /* storage unavailable or invalid */ }
  return null;
}

function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
    try { sessionStorage.removeItem(KEY); } catch { /* migration cleanup is best effort */ }
  } catch {
    throw Error('Allow local storage in this browser to remember the ROMinit CLI connection.');
  }
}

/** @typedef {'/status'|'/disconnect'|'/bench'|'/bench/targets'|'/usb/drives'|'/usb/plan'|'/usb/write'|'/usb/status'} HelperPath */
/** @type {Record<HelperPath, ['GET'|'POST', boolean]>} */
const routes = {
  '/status': ['GET', false], '/disconnect': ['POST', false], '/bench': ['POST', true], '/bench/targets': ['GET', false],
  '/usb/drives': ['GET', false], '/usb/plan': ['POST', true], '/usb/write': ['POST', true], '/usb/status': ['GET', false],
};

/** @param {any} session @param {HelperPath} path @param {object} [payload] */
async function requestSession(session, path, payload) {
  if (!validHelperSession(session)) throw Error('The helper connection expired. Start the CLI and reconnect.');
  const route = routes[path];
  const headers = { authorization: `Bearer ${session.token}` };
  if (payload) headers['content-type'] = 'application/json';
  const response = await fetch(`${session.url}${path}`, { method: route[0],
    credentials: 'omit', redirect: 'error', headers, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(path === '/bench' ? 240_000 : path === '/usb/plan' ? 960_000 : 10_000) }).catch(() => { throw Error('Could not reach your local ROMinit CLI. It may have restarted, or browser local-network access may be blocked.'); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error ?? 'The helper rejected the request.');
  return result;
}

async function currentUserId() {
  const response = await fetch('./api/me', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response) throw Error('Could not check your ROMinit account. Check your connection and retry.');
  if (response.status === 401) throw Error('Sign in to ROMinit to connect the local CLI.');
  if (!response.ok) throw Error('ROMinit account check is temporarily unavailable. Retry the CLI action in a moment.');
  const body = await response.json().catch(() => null);
  const id = body?.user?.id;
  if (!Number.isSafeInteger(id) || id <= 0)
    throw Error('Sign in to ROMinit to connect the local CLI.');
  return id;
}

async function approveAndPair(url, state, challenge, userId, action) {
  const approval = await fetch('./api/helper', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, challenge }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const grant = await approval?.json().catch(() => ({}));
  if (!approval?.ok || !tokenPattern.test(grant?.code))
    throw Error(grant?.error ?? 'Could not approve this CLI connection. Check your ROMinit sign-in and try again.');
  const response = await fetch(`${url}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' },
    credentials: 'omit', redirect: 'error', body: JSON.stringify({ state, code: grant.code }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const body = await response?.json().catch(() => ({}));
  const session = { url, token: body?.token, user: body?.user, expiresAt: body?.expiresAt };
  if (!response?.ok || !validHelperSession(session))
    throw Error(body?.error ?? 'Could not authenticate the running CLI for this account. Check that its saved ROMinit login matches this website account.');
  if (session.user.id !== userId) throw Error('The CLI is connected to a different ROMinit account.');
  return session;
}

async function discoverAndPair(userId) {
  let response;
  try {
    response = await fetch(`${LOOPBACK}/discover`, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5_000) });
  } catch {
    throw Error('Could not find a running ROMinit CLI at 127.0.0.1:18787. Start `rominit serve` and allow local-network access when asked.');
  }
  const discovery = await response.json().catch(() => ({}));
  const expiresAt = typeof discovery?.expiresAt === 'string' ? Date.parse(discovery.expiresAt) : NaN;
  if (!response.ok || !tokenPattern.test(discovery?.state) || !challengePattern.test(discovery?.challenge) || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw Error('The running ROMinit CLI returned an invalid or expired discovery challenge. Restart `rominit serve` and try again.');
  const session = await approveAndPair(LOOPBACK, discovery.state, discovery.challenge, userId, 'approve-existing');
  saveSession(session);
  return session;
}

async function connectHelper(userId, preferred) {
  const saved = helperSession();
  const candidate = [saved, preferred].find(value => validHelperSession(value) && value.user.id === userId);
  if (candidate) {
    try {
      const status = await requestSession(candidate, '/status');
      if (status.user?.id !== userId) throw Error('The running CLI is connected to a different ROMinit account.');
      const refreshed = { ...candidate, user: status.user, expiresAt: status.expiresAt ?? candidate.expiresAt };
      if (!validHelperSession(refreshed)) throw Error('The CLI connection has expired.');
      saveSession(refreshed);
      return refreshed;
    } catch (error) {
      if (/different ROMinit account/.test(error instanceof Error ? error.message : String(error))) throw error;
      // The saved port may be stale after a CLI restart; probe fixed-port discovery below.
    }
  }
  return discoverAndPair(userId);
}

/** Probe or pair the already-authenticated CLI on an explicit user action. */
export async function ensureHelper(userId, preferred = null) {
  const id = Number.isSafeInteger(userId) && userId > 0 ? userId : await currentUserId();
  const pending = pendingConnections.get(id);
  if (pending) return pending;
  const operation = connectHelper(id, preferred).finally(() => pendingConnections.delete(id));
  pendingConnections.set(id, operation);
  return operation;
}

/** @param {any} session @param {HelperPath} path @param {object} [payload] */
export async function helperRequest(session, path, payload) {
  const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
  if (!route || (route[1] ? !payload || typeof payload !== 'object' || Array.isArray(payload) : payload !== undefined))
    throw Error('Invalid helper request.');
  if (path === '/disconnect') return requestSession(session, path, payload);
  const active = await ensureHelper(session?.user?.id, session);
  return requestSession(active, path, payload);
}

export async function disconnectHelper() {
  const session = helperSession();
  removeSavedSession();
  if (session) await requestSession(session, '/disconnect');
}

/** @param {URLSearchParams} params @param {number} userId */
export async function pairHelper(params, userId) {
  const port = params.get('port') ?? '', state = params.get('state') ?? '', challenge = params.get('challenge') ?? '';
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || !tokenPattern.test(state) || !challengePattern.test(challenge))
    throw Error('Invalid pairing link. Use the link printed by rominit serve.');
  const previous = helperSession();
  const session = await approveAndPair(`http://127.0.0.1:${port}`, state, challenge, userId, 'approve');
  if (previous && (previous.url !== session.url || previous.token !== session.token))
    await requestSession(previous, '/disconnect').catch(() => {});
  saveSession(session);
  return session;
}
