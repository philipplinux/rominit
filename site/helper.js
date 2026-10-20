// A tab-scoped connection to the CLI; account cookies and OAuth credentials stay on the website.
const KEY = 'rominit.helper';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** @param {unknown} value */
export function validHelperSession(value) {
  const s = /** @type {any} */ (value);
  const port = typeof s?.url === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(s.url)?.[1];
  return !!port && Number(port) <= 65535 &&
    typeof s.token === 'string' && tokenPattern.test(s.token) && Number.isSafeInteger(s.user?.id) && s.user.id > 0 && typeof s.user.name === 'string' &&
    typeof s.expiresAt === 'string' && Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.expiresAt) > Date.now();
}

export function helperSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (validHelperSession(value)) return value;
    sessionStorage.removeItem(KEY);
  } catch { /* storage unavailable or invalid */ }
  return null;
}

/** @param {any} session @param {'/status'|'/disconnect'|'/usb/drives'|'/usb/plan'|'/usb/write'|'/usb/status'} path @param {Record<string, any>} [payload] */
export async function helperRequest(session, path, payload) {
  if (!validHelperSession(session)) throw Error('The helper connection expired. Start the CLI and pair again.');
  if (!['/status', '/disconnect', '/usb/drives', '/usb/plan', '/usb/write', '/usb/status'].includes(path))
    throw Error('Unsupported helper request.');
  const hasPayload = payload !== undefined;
  if ((path === '/usb/plan' || path === '/usb/write') !== hasPayload || (hasPayload && (!payload || typeof payload !== 'object' || Array.isArray(payload))))
    throw Error('Invalid helper request.');
  const method = path === '/disconnect' || path === '/usb/plan' || path === '/usb/write' ? 'POST' : 'GET';
  const headers = { authorization: `Bearer ${session.token}`, ...(hasPayload ? { 'content-type': 'application/json' } : {}) };
  const response = await fetch(`${session.url}${path}`, { method, credentials: 'omit', redirect: 'error', headers,
    ...(hasPayload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error ?? 'The helper rejected the request. Pair again.');
  return body;
}

export async function disconnectHelper() {
  const session = helperSession();
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  if (session) await helperRequest(session, '/disconnect');
}

/** @param {URLSearchParams} params @param {number} userId */
export async function pairHelper(params, userId) {
  const port = params.get('port') ?? '', state = params.get('state') ?? '', challenge = params.get('challenge') ?? '';
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || !tokenPattern.test(state) || !/^[a-f0-9]{64}$/.test(challenge))
    throw Error('Invalid pairing link. Use the link printed by rominit serve.');
  const previous = helperSession();
  const approval = await fetch('./api/helper', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', challenge }), signal: AbortSignal.timeout(10_000) });
  const grant = await approval.json().catch(() => ({}));
  if (!approval.ok || !tokenPattern.test(grant.code)) throw Error(grant.error ?? 'Could not approve the helper. Sign in and try again.');
  const url = `http://127.0.0.1:${port}`;
  const response = await fetch(`${url}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' },
    credentials: 'omit', redirect: 'error', body: JSON.stringify({ state, code: grant.code }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({}));
  const session = { url, token: body.token, user: body.user, expiresAt: body.expiresAt };
  if (!response.ok || !validHelperSession(session))
    throw Error('Could not authenticate the helper for this account. Restart the CLI and pair again.');
  if (session.user.id !== userId) {
    await helperRequest(session, '/disconnect').catch(() => {});
    throw Error('The signed-in account changed. Restart the CLI and pair again.');
  }
  if (previous && (previous.url !== session.url || previous.token !== session.token))
    await helperRequest(previous, '/disconnect').catch(() => {});
  // Keep the credential in this tab only, never in a URL or persistent local storage.
  try { sessionStorage.setItem(KEY, JSON.stringify(session)); }
  catch { await helperRequest(session, '/disconnect').catch(() => {}); throw Error('Allow session storage in this tab to connect the helper.'); }
  return session;
}
