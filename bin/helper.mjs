import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { PhoneBenchError, runPhoneBench as defaultPhoneBench, validatePhoneBench } from './phone-bench.mjs';
import { listBenchTargets as defaultBenchTargets } from './bench-targets.mjs';
import { validateUsbBrowser } from '../src/usb-environment.js';

const CODE = /^[A-Za-z0-9_-]{43}$/;
const API_KEY = /^rmi_[A-Za-z0-9_-]{43}$/;
const PAIR_MS = 10 * 60_000;
const SESSION_MS = 30 * 24 * 60 * 60_000;
const MAX_TIMER_MS = 2_147_483_647;
const BODY_LIMIT = 2048;
const AUTH_ERROR = 'ROMinit API key was rejected or expired. Run "rominit auth".';
const TRANSIENT_ERROR = 'ROMinit is temporarily unavailable. Keep the CLI open and retry.';
const token = () => randomBytes(32).toString('base64url');
const USB_BODY_KEYS = { '/usb/plan': ['driveId', 'method', 'imageId'], '/usb/write': ['planId', 'confirm', 'allowUnverified', 'browser'] };
const USB_REQUIRED_KEYS = { '/usb/plan': ['driveId', 'method'], '/usb/write': ['planId', 'confirm'] };

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
      !Number.isFinite(expires) || expires <= now) {
    const error = Error('ROMinit returned an invalid account response.');
    error.code = 'ROMINIT_TRANSIENT';
    throw error;
  }
  return { user: { id: user.id, name: user.name }, expires, expiresAt: new Date(expires).toISOString() };
}

function codedError(code, message) { const error = Error(message); error.code = code; return error; }

async function remoteJson(origin, get, body, credential, controllers) {
  const controller = new AbortController();
  controllers?.add(controller);
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await get(`${origin}/api/helper`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      redirect: 'error', signal: controller.signal, body: JSON.stringify(body),
    });
    if (response.redirected || response.status >= 300 && response.status < 400) throw codedError('ROMINIT_TRANSIENT', TRANSIENT_ERROR);
    const contentType = response.headers?.get?.('content-type') ?? '';
    let payload;
    try { payload = await response.json(); }
    catch { throw codedError('ROMINIT_TRANSIENT', TRANSIENT_ERROR); }
    if (!response.ok) {
      const validAuthRejection = /application\/json/i.test(contentType) && payload?.error === 'valid API token required' &&
        [401, 403].includes(response.status) && (body.action === 'identity' || (body.action === 'redeem' && credential));
      if (validAuthRejection) throw codedError('ROMINIT_AUTH_REJECTED', AUTH_ERROR);
      if (response.status >= 500 || response.status === 429 || !/application\/json/i.test(contentType))
        throw codedError('ROMINIT_TRANSIENT', TRANSIENT_ERROR);
      throw codedError('ROMINIT_REMOTE_REJECTED', 'ROMinit rejected the request.');
    }
    if (!/application\/json/i.test(contentType)) throw codedError('ROMINIT_TRANSIENT', TRANSIENT_ERROR);
    return payload;
  } catch (error) {
    if (error?.code?.startsWith?.('ROMINIT_')) throw error;
    throw codedError('ROMINIT_TRANSIENT', TRANSIENT_ERROR);
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
  } catch (error) {
    if (error?.code === 'ROMINIT_AUTH_REJECTED') {
      error.message = AUTH_ERROR;
      throw error;
    }
    if (error?.code === 'ROMINIT_TRANSIENT') throw error;
    throw codedError('ROMINIT_TRANSIENT', TRANSIENT_ERROR);
  }
}

export async function startHelper({ site = process.env.ROMINIT_URL ?? 'https://rominit.pages.dev', fetch: get = globalThis.fetch,
  now = Date.now, onPair = () => {}, onCredentialError = () => {}, onStorageError = () => {}, credential: saved = null,
  identity: knownIdentity = null, saveCredential, saveSession, deleteSession, browserSession = null, port = 0,
  runBench = defaultPhoneBench, benchTargets = defaultBenchTargets, usbMedia = null } = {}) {
  const origin = siteOrigin(site);
  if (typeof get !== 'function') throw Error('A fetch implementation is required.');
  if (typeof benchTargets !== 'function') throw Error('A benchmark target backend is required.');
  if (saved !== null && (typeof saved !== 'string' || !API_KEY.test(saved))) throw Error(AUTH_ERROR);
  if (usbMedia !== null && ['listDrives', 'plan', 'execute', 'status'].some(name => typeof usbMedia?.[name] !== 'function'))
    throw Error('A complete USB media backend is required.');
  let credential = saved;
  let identity = credential ? (knownIdentity ? normalizeIdentity(knownIdentity, now()) : await identifyCredential(origin, credential, get, now)) : null;
  const newPairing = () => {
    const verifier = token(), state = token();
    return { verifier, state, challenge: createHash('sha256').update(verifier).digest('hex'), expires: now() + PAIR_MS };
  };
  const pairings = new Map();
  const initialPairing = newPairing();
  pairings.set(initialPairing.state, initialPairing);
  let redeeming = false, benching = false, benchController = null, session = null, closing = false, expiryTimer, errorReported = false;
  const fingerprint = value => createHash('sha256').update(value).digest('hex');
  const usableBrowserSession = value => credential && identity && value && typeof value === 'object' && value.version === 1 &&
    typeof value.token === 'string' && CODE.test(value.token) && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535 &&
    value.port === port && value.user?.id === identity.user.id && value.user?.name === identity.user.name &&
    value.credentialFingerprint === fingerprint(credential) && Date.parse(value.expiresAt) > now();
  if (browserSession && usableBrowserSession(browserSession)) {
    session = { token: browserSession.token, user: identity.user, expires: Math.min(Date.parse(browserSession.expiresAt), identity.expires) };
  } else if (browserSession && deleteSession) {
    await deleteSession().catch(() => {});
  }
  let finishClosed;
  const closed = new Promise(resolve => { finishClosed = resolve; });
  const controllers = new Set();
  let actualPort = 0;
  const clearSession = () => { session = null; clearTimeout(expiryTimer); expiryTimer = undefined; };
  const persistSession = async current => {
    if (!saveSession || !credential || !actualPort) return;
    await saveSession({ version: 1, token: current.token, port: actualPort, user: current.user,
      expiresAt: new Date(current.expires).toISOString(), credentialFingerprint: fingerprint(credential) }, credential);
  };
  const armExpiry = current => {
    clearTimeout(expiryTimer);
    const delay = Math.max(1, Math.min(MAX_TIMER_MS, current.expires - now()));
    expiryTimer = setTimeout(() => {
      if (session !== current) return;
      if (now() >= current.expires) { clearSession(); return; }
      armExpiry(current);
    }, delay);
    expiryTimer.unref();
  };
  const routes = { '/discover': ['GET', []], '/pair': ['POST', ['content-type']], '/status': ['GET', ['authorization']],
    '/bench': ['POST', ['authorization', 'content-type']], '/disconnect': ['POST', ['authorization']],
    '/bench/targets': ['GET', ['authorization']],
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

    if (path === '/discover') {
      if (!credential || !identity) return reject(409, cors, 'No saved CLI account is available. Run rominit auth first.');
      for (const [key, value] of pairings) if (now() >= value.expires) pairings.delete(key);
      const pending = newPairing();
      pairings.set(pending.state, pending);
      while (pairings.size > 10) pairings.delete(pairings.keys().next().value);
      return reply(200, { state: pending.state, challenge: pending.challenge, expiresAt: new Date(pending.expires).toISOString() });
    }

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
    const authorized = () => {
      if (session && now() >= session.expires) clearSession();
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      return session && match && equalSecret(match[1], session.token) ? session : null;
    };
    const authFailure = async current => {
      if (current && session !== current) return reject(401);
      clearSession();
      try { await deleteSession?.(); } catch { /* The next serve still verifies the API key before restoring a saved session. */ }
      if (!errorReported) { errorReported = true; try { onCredentialError(); } catch { /* Output must not affect authentication. */ } }
      return reject(401, cors, AUTH_ERROR);
    };
    const identityFailure = (current, error) => {
      error = error?.original ?? error;
      if (error?.code === 'ROMINIT_AUTH_REJECTED') return authFailure(current);
      if (error?.code === 'ROMINIT_SESSION_EXPIRED') {
        if (session === current) clearSession();
        if (deleteSession) void deleteSession().catch(() => {});
        return reject(401, cors, 'Local helper session expired. Reconnect from ROMinit.');
      }
      if (error?.code === 'ROMINIT_TRANSIENT') return reject(503, cors, TRANSIENT_ERROR);
      return reject(502, cors, 'Could not verify the ROMinit account. Retry the request.');
    };
    const sessionActive = (current, localToken) => session === current && current.token === localToken && now() < current.expires;
    const currentIdentity = async () => {
      const value = normalizeIdentity(await remoteJson(origin, get, { action: 'identity' }, credential, controllers), now());
      if (!identity || value.user.id !== identity.user.id) throw codedError('ROMINIT_AUTH_REJECTED', AUTH_ERROR);
      identity = value;
      errorReported = false;
      return value;
    };
    const refreshSession = async current => {
      const value = await currentIdentity();
      if (!sessionActive(current, current.token)) throw codedError('ROMINIT_SESSION_EXPIRED', 'Local helper session expired.');
      if (value.user.id !== current.user.id) throw codedError('ROMINIT_AUTH_REJECTED', AUTH_ERROR);
      current.user = value.user;
      const expires = Math.min(current.expires, value.expires);
      if (now() >= expires) throw codedError('ROMINIT_SESSION_EXPIRED', 'Local helper session expired.');
      if (expires !== current.expires) {
        current.expires = expires;
        await persistSession(current);
        armExpiry(current);
      }
      return value;
    };

    if (path === '/status') {
      const current = authorized();
      if (!current) return reject(401);
      void (async () => {
        try {
          await refreshSession(current);
          return reply(200, { user: current.user, expiresAt: new Date(current.expires).toISOString(), capabilities: ['bench', 'bench-targets', 'bench-sound', ...(usbMedia ? ['usb-media', 'usb-images', 'usb-unverified', 'usb-environment', ...(usbMedia.directSupported ? ['usb-direct'] : [])] : [])] });
        } catch (error) { return identityFailure(current, error); }
      })();
      return;
    }
    if (path.startsWith('/usb/')) {
      const current = authorized();
      if (!current) return reject(401);
      const localToken = current.token;
      void (async () => {
        try { await refreshSession(current); }
        catch (error) { return identityFailure(current, error); }
        if (!sessionActive(current, localToken)) return reject(401);

        let value;
        if (req.method === 'POST') {
          try { value = await body(); } catch (status) { return reject(status); }
          const keys = USB_BODY_KEYS[path];
          const required = USB_REQUIRED_KEYS[path];
          if (!keys || !required || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key)) ||
              Object.entries(value).some(([key, item]) => key === 'allowUnverified' && path === '/usb/write'
                ? typeof item !== 'boolean'
                : key === 'browser' && path === '/usb/write'
                  ? !validateUsbBrowser(item)
                  : typeof item !== 'string' || !item.trim() || item.length > BODY_LIMIT))
            return reject(400);
          if (!sessionActive(current, localToken)) return reject(401);
        }

        try {
          const result = path === '/usb/drives' ? await usbMedia.listDrives()
            : path === '/usb/plan' ? await usbMedia.plan({ driveId: value.driveId, method: value.method, ...(Object.hasOwn(value, 'imageId') ? { imageId: value.imageId } : {}) })
              : path === '/usb/write' ? await usbMedia.execute({ planId: value.planId, confirm: value.confirm,
                ...(Object.hasOwn(value, 'allowUnverified') ? { allowUnverified: value.allowUnverified } : {}),
                ...(Object.hasOwn(value, 'browser') ? { browser: validateUsbBrowser(value.browser) } : {}) })
                : await usbMedia.status();
          return reply(path === '/usb/write' ? 202 : 200, result);
        } catch (error) {
          const status = [400, 409, 502, 503].includes(error?.status) ? error.status : 500;
          const message = error?.code === 'USB_UNVERIFIED' ? 'The selected Alpine ISO does not match the publisher size or SHA-256. Explicitly allow the checksum mismatch to continue.'
            : status === 400 ? 'USB request or confirmation is invalid.'
            : status === 409 ? 'USB plan is stale, another USB operation is in progress, or the existing Ventoy installation could not be verified.'
              : status === 502 ? 'Could not download and verify the selected Alpine ISO.'
              : status === 503 ? (/Ventoy directory is not configured/.test(error?.message) ? 'Ventoy is not set up for this CLI. Restart it with ROMINIT_VENTOY_DIR=/absolute/path/to/ventoy rominit serve, or use Direct write.' : 'USB media support is unavailable.') : 'USB operation failed.';
          return reject(status, cors, message);
        }
      })();
      return;
    }

    if (path === '/bench/targets') {
      const current = authorized();
      if (!current) return reject(401);
      const localToken = current.token;
      void (async () => {
        try { await refreshSession(current); }
        catch (error) { return identityFailure(current, error); }
        if (!sessionActive(current, localToken)) return reject(401);
        try {
          const result = await benchTargets();
          if (!sessionActive(current, localToken)) return reject(401);
          return reply(200, result);
        } catch {
          return reject(502, cors, 'Could not read USB-network benchmark targets.');
        }
      })();
      return;
    }

    if (path === '/bench') {
      const current = authorized();
      if (!current) return reject(401);
      if (benching) return reject(409);
      void (async () => {
        let value;
        try { value = await body(); } catch (status) { return reject(status); }
        let input;
        try { input = validatePhoneBench(value); } catch (error) { return reject(400, cors, error.message); }
        if (benching) return reject(409);
        benching = true;
        const controller = new AbortController();
        benchController = controller;
        const cancelOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancelOnDisconnect);
        const revalidate = async () => {
          try { return await refreshSession(current); }
          catch (error) {
            const wrapped = codedError('ROMINIT_AUTH_FAILURE', AUTH_ERROR);
            wrapped.original = error;
            throw wrapped;
          }
        };
        try {
          try { await refreshSession(current); } catch (error) { return identityFailure(current, error); }
          const result = await runBench({ ...input, origin, fetch: get, signal: controller.signal, authorize: revalidate });
          return reply(200, result);
        } catch (error) {
          if (error?.code === 'ROMINIT_AUTH_FAILURE') return identityFailure(current, error.original);
          if (error?.code === 'ROMINIT_TRANSIENT') return identityFailure(current, error);
          const message = error instanceof PhoneBenchError ? error.message : 'Benchmark failed.';
          return reject(502, cors, message);
        } finally {
          res.off('close', cancelOnDisconnect);
          benching = false;
          if (benchController === controller) benchController = null;
        }
      })();
      return;
    }
    if (path === '/disconnect') {
      if (!authorized()) return reject(401);
      if ((req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding']) return reject(400);
      void (async () => {
        try { await deleteSession?.(); }
        catch { return reject(500, cors, 'Could not remove the saved browser session from the OS credential store.'); }
        clearSession();
        res.once('finish', close);
        return reply(200, { ok: true });
      })();
      return;
    }

    void (async () => {
      let value;
      try { value = await body(); } catch (status) { return reject(status); }
      if (Object.keys(value).length !== 2 || typeof value.state !== 'string' || !CODE.test(value.state) ||
          typeof value.code !== 'string' || !CODE.test(value.code)) return reject(400);
      if (session && now() >= session.expires) clearSession();
      if (redeeming) return reject(409);
      const pending = pairings.get(value.state);
      if (!pending) return reject(403);
      if (now() >= pending.expires) { pairings.delete(value.state); return reject(410); }
      if (!equalSecret(value.state, pending.state)) return reject(403);
      pairings.delete(value.state);
      redeeming = true;
      try {
        let current = identity;
        if (credential) {
          try { current = await currentIdentity(); }
          catch (error) { return identityFailure(session, error); }
        }
        let payload;
        try { payload = await remoteJson(origin, get, { action: 'redeem', code: value.code, verifier: pending.verifier }, credential, controllers); }
        catch (error) {
          if (error?.code === 'ROMINIT_AUTH_REJECTED') return authFailure(session);
          if (error?.code === 'ROMINIT_TRANSIENT') return reject(503, cors, TRANSIENT_ERROR);
          return reject(502, cors, 'Pairing code was rejected or expired. Create a new connection in ROMinit.');
        }
        const approved = normalizeIdentity(payload, now());
        if (credential) {
          if (!current || payload.credential !== undefined || approved.user.id !== current.user.id)
            return authFailure(session);
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
        }
        if (session && now() < session.expires) {
          return reply(200, { token: session.token, user: session.user, expiresAt: new Date(session.expires).toISOString() });
        }
        const expires = Math.min(now() + SESSION_MS, identity.expires);
        session = { token: token(), user: identity.user, expires };
        try { await persistSession(session); }
        catch {
          clearSession();
          try { onStorageError(); } catch { /* Output must not affect credential storage. */ }
          return reject(500, cors, 'Could not save the browser session in the OS credential store. Unlock it, then reconnect from ROMinit.');
        }
        armExpiry(session);
        errorReported = false;
        try { onPair(session.user); } catch { /* Pairing must not depend on terminal output. */ }
        return reply(200, { token: session.token, user: session.user, expiresAt: new Date(expires).toISOString() });
      } catch (error) {
        if (error?.code === 'ROMINIT_TRANSIENT') return reject(503, cors, TRANSIENT_ERROR);
        return reject(502, cors, 'Pairing code was rejected or expired. Create a new connection in ROMinit.');
      } finally { redeeming = false; }
    })();
  });
  server.on('close', finishClosed);

  function close() {
    if (!closing) {
      closing = true;
      clearTimeout(expiryTimer);
      benchController?.abort();
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
    server.listen(port, '127.0.0.1', resolve);
  });
  actualPort = server.address().port;
  expectedHost = `127.0.0.1:${actualPort}`;
  if (session) armExpiry(session);
  const params = new URLSearchParams({ view: 'cli', port: String(actualPort), state: initialPairing.state, challenge: initialPairing.challenge });
  return { server, host: '127.0.0.1', port: actualPort, pairingUrl: `${origin}/?${params}`, close, closed, user: identity?.user ?? null };
}
