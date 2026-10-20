import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const CODE = /^[A-Za-z0-9_-]{43}$/;
const API_KEY = /^rmi_[A-Za-z0-9_-]{43}$/;
const PAIR_MS = 10 * 60_000;
const SESSION_MS = 60 * 60_000;
const BODY_LIMIT = 2048;
const AUTH_ERROR = 'ROMinit API key was rejected or expired. Run "rominit auth".';
const token = () => randomBytes(32).toString('base64url');
const USB_BODY_KEYS = { '/usb/plan': ['driveId', 'method'], '/usb/write': ['planId', 'confirm'] };

export function siteOrigin(site) {
  if (typeof site !== 'string' || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+\/?$/.test(site))
    throw Error('ROMINIT_URL must be a bare HTTPS origin (or loopback HTTP for development).');
  const url = new URL(site);
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (!url.origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)))
    throw Error('ROMINIT_URL must be a bare HTTPS origin (or loopback HTTP for development).');
  return url.origin;
}

function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function normalizeIdentity(value, now) {
  const user = value?.user;
  const expires = typeof value?.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.name !== 'string' || !user.name.trim() || user.name.length > 256 ||
      !Number.isFinite(expires) || expires <= now)
    throw Error(AUTH_ERROR);
  return { user: { id: user.id, name: user.name }, expires, expiresAt: new Date(expires).toISOString() };
}

async function remoteJson(origin, get, body, credential, controllers) {
  const controller = new AbortController();
  controllers?.add(controller);
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await get(`${origin}/api/helper`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      redirect: 'error', signal: controller.signal, body: JSON.stringify(body),
    });
    if (!response.ok || response.redirected || response.status >= 300 && response.status < 400) throw Error();
    return await response.json();
  } catch {
    throw Error('ROMinit API request failed.');
  } finally {
    clearTimeout(timeout);
    controllers?.delete(controller);
  }
}

export async function identifyCredential(site, credential, get = globalThis.fetch, now = Date.now) {
  const origin = siteOrigin(site);
  if (typeof credential !== 'string' || !API_KEY.test(credential) || typeof get !== 'function') throw Error(AUTH_ERROR);
  try {
    return normalizeIdentity(await remoteJson(origin, get, { action: 'identity' }, credential), now());
  } catch {
    throw Error(AUTH_ERROR);
  }
}

export async function startHelper({ site = process.env.ROMINIT_URL ?? 'https://rominit.pages.dev', fetch: get = globalThis.fetch,
  now = Date.now, onPair = () => {}, onCredentialError = () => {}, onStorageError = () => {}, credential: saved = null,
  identity: knownIdentity = null, saveCredential, usbMedia = null } = {}) {
  const origin = siteOrigin(site);
  if (typeof get !== 'function') throw Error('A fetch implementation is required.');
  if (saved !== null && (typeof saved !== 'string' || !API_KEY.test(saved))) throw Error(AUTH_ERROR);
  if (usbMedia !== null && ['listDrives', 'plan', 'execute', 'status'].some(name => typeof usbMedia?.[name] !== 'function'))
    throw Error('A complete USB media backend is required.');
  let credential = saved;
  let identity = credential ? (knownIdentity ? normalizeIdentity(knownIdentity, now()) : await identifyCredential(origin, credential, get, now)) : null;
  let pairExpires = identity?.expires ?? now() + PAIR_MS;
  const verifier = token(), state = token();
  const challenge = createHash('sha256').update(verifier).digest('hex');
  let redeeming = false, session = null, closing = false, expiryTimer, errorReported = false;
  let finishClosed;
  const closed = new Promise(resolve => { finishClosed = resolve; });
  const controllers = new Set();
  const routes = { '/pair': ['POST', ['content-type']], '/status': ['GET', ['authorization']], '/disconnect': ['POST', ['authorization']],
    ...(usbMedia ? {
      '/usb/drives': ['GET', ['authorization']], '/usb/plan': ['POST', ['authorization', 'content-type']],
      '/usb/write': ['POST', ['authorization', 'content-type']], '/usb/status': ['GET', ['authorization']],
    } : {}) };
  let expectedHost;

  const server = createServer((req, res) => {
    const cors = req.headers.host === expectedHost && req.headers.origin === origin;
    const reply = (status, body, allowOrigin = cors) => {
      if (res.destroyed || res.writableEnded) return;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (allowOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        if (!res.hasHeader('Vary')) res.setHeader('Vary', 'Origin');
      }
      if (body !== undefined) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(status);
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const reject = (status = 400, allowOrigin = cors, message = 'Request rejected.') => {
      if (res.destroyed || res.writableEnded) return;
      if (status === 413 && !req.complete) {
        const discardTimeout = setTimeout(() => req.destroy(), 10_000);
        discardTimeout.unref();
        req.once('end', () => clearTimeout(discardTimeout));
      }
      req.resume();
      reply(status, { error: message }, allowOrigin);
    };
    const path = req.url;
    if (!cors) return reject(403, false);

    if (req.method === 'OPTIONS') {
      const route = routes[path];
      const method = req.headers['access-control-request-method'];
      const requested = (req.headers['access-control-request-headers'] ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
      const privateNetwork = req.headers['access-control-request-private-network'];
      if (!route || method !== route[0] || requested.some(h => !route[1].includes(h)) || (privateNetwork !== undefined && privateNetwork !== 'true'))
        return reject(403);
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
      res.setHeader('Access-Control-Allow-Methods', route[0]);
      res.setHeader('Access-Control-Allow-Headers', route[1].join(', '));
      res.setHeader('Access-Control-Max-Age', '300');
      if (privateNetwork === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      return reply(204, undefined);
    }

    const route = routes[path];
    if (!route) return reject(404);
    if (req.method !== route[0]) { res.setHeader('Allow', route[0]); return reject(405); }

    const body = () => new Promise((resolve, rejectBody) => {
      const type = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (type !== 'application/json') { rejectBody(415); return; }
      if (Number(req.headers['content-length'] ?? 0) > BODY_LIMIT) { rejectBody(413); return; }
      const chunks = [];
      let size = 0, tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > BODY_LIMIT) { tooLarge = true; chunks.length = 0; rejectBody(413); }
        else chunks.push(chunk);
      });
      req.on('end', () => {
        if (tooLarge) return;
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { rejectBody(400); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) { rejectBody(400); return; }
        resolve(value);
      });
      req.on('error', () => rejectBody(400));
    });
    const clearSession = () => { session = null; clearTimeout(expiryTimer); expiryTimer = undefined; };
    const authorized = () => {
      if (session && now() >= session.expires) clearSession();
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      return session && match && equalSecret(match[1], session.token) ? session : null;
    };
    const authFailure = (expectedSession = null, expectedToken = null) => {
      if (expectedSession && (session !== expectedSession || expectedSession.token !== expectedToken)) return reject(401);
      clearSession();
      if (!errorReported) { errorReported = true; try { onCredentialError(); } catch { /* Output must not affect authentication. */ } }
      return reject(401, cors, AUTH_ERROR);
    };
    const sessionActive = (current, localToken) => session === current && current.token === localToken && now() < current.expires;
    const currentIdentity = async () => {
      const value = normalizeIdentity(await remoteJson(origin, get, { action: 'identity' }, credential, controllers), now());
      if (!identity || value.user.id !== identity.user.id) throw Error(AUTH_ERROR);
      identity = value;
      pairExpires = value.expires;
      errorReported = false;
      return value;
    };

    if (path === '/status') {
      const current = authorized();
      if (!current) return reject(401);
      const localToken = current.token;
      void (async () => {
        try {
          const value = await currentIdentity();
          if (value.user.id !== current.user.id) throw Error(AUTH_ERROR);
          if (!sessionActive(current, localToken)) return reject(401);
          current.user = value.user;
          current.expires = Math.min(current.expires, value.expires);
          if (now() >= current.expires) throw Error(AUTH_ERROR);
          return reply(200, { user: current.user, expiresAt: new Date(current.expires).toISOString(), capabilities: usbMedia ? ['usb-media'] : [] });
        } catch { return authFailure(current, localToken); }
      })();
      return;
    }
    if (path === '/disconnect') {
      if (!authorized()) return reject(401);
      if ((req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding']) return reject(400);
      clearSession();
      res.once('finish', close);
      return reply(200, { ok: true });
    }

    if (path.startsWith('/usb/')) {
      const current = authorized();
      if (!current) return reject(401);
      const localToken = current.token;
      void (async () => {
        try { await currentIdentity(); }
        catch { return authFailure(current, localToken); }
        if (!sessionActive(current, localToken)) return reject(401);

        let value;
        if (req.method === 'POST') {
          try { value = await body(); } catch (status) { return reject(status); }
          const keys = USB_BODY_KEYS[path];
          if (!keys || Object.keys(value).length !== keys.length || keys.some(key =>
            !Object.hasOwn(value, key) || typeof value[key] !== 'string' || !value[key].trim() || value[key].length > BODY_LIMIT))
            return reject(400);
          if (!sessionActive(current, localToken)) return reject(401);
        }

        try {
          const result = path === '/usb/drives' ? await usbMedia.listDrives()
            : path === '/usb/plan' ? await usbMedia.plan({ driveId: value.driveId, method: value.method })
              : path === '/usb/write' ? await usbMedia.execute({ planId: value.planId, confirm: value.confirm })
                : await usbMedia.status();
          return reply(path === '/usb/write' ? 202 : 200, result);
        } catch (error) {
          const status = [400, 409, 503].includes(error?.status) ? error.status : 500;
          const message = status === 400 ? 'USB request or confirmation is invalid.'
            : status === 409 ? 'USB plan is stale or another USB operation is in progress.'
              : status === 503 ? 'USB media support is unavailable.' : 'USB operation failed.';
          return reject(status, cors, message);
        }
      })();
      return;
    }

    void (async () => {
      let value;
      try { value = await body(); } catch (status) { return reject(status); }
      if (Object.keys(value).length !== 2 || typeof value.state !== 'string' || !CODE.test(value.state) ||
          typeof value.code !== 'string' || !CODE.test(value.code)) return reject(400);
      if (session && now() < session.expires) return reject(409);
      if (redeeming) return reject(409);
      if (!credential && now() >= pairExpires) return reject(410);
      if (!equalSecret(value.state, state)) return reject(403);
      redeeming = true;
      try {
        let current = identity;
        if (credential) {
          try { current = await currentIdentity(); }
          catch { return authFailure(); }
        }
        if (now() >= pairExpires) return reject(410);
        const payload = await remoteJson(origin, get, { action: 'redeem', code: value.code, verifier }, credential, controllers);
        const approved = normalizeIdentity(payload, now());
        if (credential) {
          if (!current || payload.credential !== undefined || approved.user.id !== current.user.id) throw Error();
          const expires = Math.min(approved.expires, current.expires);
          identity = { ...approved, expires, expiresAt: new Date(expires).toISOString() };
        } else {
          if (typeof payload.credential !== 'string' || !API_KEY.test(payload.credential) || typeof saveCredential !== 'function')
            throw Error();
          try { await saveCredential(payload.credential); }
          catch {
            try { onStorageError(); } catch { /* Output must not affect credential storage. */ }
            return reject(500, cors, 'Could not save the ROMinit API key in the OS credential store. Run rominit auth again after unlocking it.');
          }
          credential = payload.credential;
          identity = approved;
          pairExpires = approved.expires;
        }
        const expires = Math.min(now() + SESSION_MS, identity.expires);
        session = { token: token(), user: identity.user, expires };
        const localToken = session.token;
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => { if (session?.token === localToken) session = null; }, expires - now());
        expiryTimer.unref();
        errorReported = false;
        try { onPair(session.user); } catch { /* Pairing must not depend on terminal output. */ }
        return reply(200, { token: session.token, user: session.user, expiresAt: new Date(expires).toISOString() });
      } catch {
        return reject(502, cors, 'Pairing code was rejected or expired. Create a new connection in ROMinit.');
      } finally { redeeming = false; }
    })();
  });
  server.on('close', finishClosed);

  function close() {
    if (!closing) {
      closing = true;
      clearTimeout(expiryTimer);
      for (const controller of controllers) controller.abort();
      if (server.listening) {
        server.close();
        server.closeAllConnections?.();
      } else finishClosed();
    }
    return closed;
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  expectedHost = `127.0.0.1:${port}`;
  const params = new URLSearchParams({ view: 'helper', port: String(port), state, challenge });
  return { server, host: '127.0.0.1', port, pairingUrl: `${origin}/?${params}`, close, closed, user: identity?.user ?? null };
}
