// One-use grant for the local CLI; the site stores the code hash and verifier challenge, never the code or verifier.
import { randomToken, sha256hex, tokenUser, userOf } from '../_lib/auth.js';
import { json } from '../_lib/api.js';

const MAX_BODY = 2048, MAX_ACTIVE = 10;
const base64url32 = /^[A-Za-z0-9_-]{43}$/;
const challengeHash = /^[0-9a-f]{64}$/;

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return null;
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
}

const sameOrigin = request => request.headers.get('origin') === new URL(request.url).origin;
const isoUtc = value => new Date(`${value.replace(' ', 'T')}Z`).toISOString();

async function activeToken(env, id) {
  return env.DB.prepare("SELECT expires FROM api_tokens WHERE id = ?1 AND revoked IS NULL AND expires > datetime('now')").bind(id).first();
}

async function activeGrant(env, codeHash) {
  return env.DB.prepare("SELECT g.user_id, g.challenge, u.id, u.name FROM helper_grants g JOIN users u ON u.id = g.user_id WHERE g.code_hash = ?1 AND g.expires > datetime('now')")
    .bind(codeHash).first();
}

/** @param {{request:Request, env:any}} context */
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid JSON request' }, 400);

  if (body.action === 'identity') {
    const token = await tokenUser(env, request);
    if (!token) return json({ error: 'valid API token required' }, 401);
    const row = await activeToken(env, token.token_id);
    return row ? json({ user: { id: token.id, name: token.name }, expiresAt: isoUtc(row.expires) }) : json({ error: 'valid API token required' }, 401);
  }

  if (body.action === 'approve' || body.action === 'approve-existing') {
    if (!sameOrigin(request)) return json({ error: 'same-origin request required' }, 403);
    const user = await userOf(env, request);
    if (!user) return json({ error: 'sign in first' }, 401);
    if (typeof body.challenge !== 'string' || !challengeHash.test(body.challenge)) return json({ error: 'invalid challenge' }, 400);
    await env.DB.prepare("DELETE FROM helper_grants WHERE expires <= datetime('now')").run();
    const code = randomToken();
    const { meta } = await env.DB.prepare(`INSERT INTO helper_grants (code_hash, user_id, challenge, expires)
      SELECT ?1, ?2, ?3, datetime('now', '+60 seconds')
      WHERE (SELECT COUNT(*) FROM helper_grants WHERE user_id = ?2 AND expires > datetime('now')) < ?4`)
      .bind(await sha256hex(code), user.id, body.action === 'approve-existing' ? `existing:${body.challenge}` : body.challenge, MAX_ACTIVE).run();
    if (!meta.changes) return json({ error: 'too many active helper grants' }, 409);
    return json({ code, expiresIn: 60 });
  }

  if (body.action === 'redeem') {
    if (request.headers.has('origin') && !sameOrigin(request)) return json({ error: 'same-origin request required' }, 403);
    if (typeof body.code !== 'string' || !base64url32.test(body.code) || typeof body.verifier !== 'string' || !base64url32.test(body.verifier))
      return json({ error: 'invalid code or verifier' }, 400);
    const hasAuthorization = request.headers.has('authorization');
    const token = hasAuthorization ? await tokenUser(env, request) : null;
    if (hasAuthorization && !token) return json({ error: 'valid API token required' }, 401);
    if (!token && request.headers.has('origin')) return json({ error: 'credential redemption requires a direct CLI request' }, 403);
    const codeHash = await sha256hex(body.code), challenge = await sha256hex(body.verifier);
    const grant = await activeGrant(env, codeHash);
    if (!grant) {
      await env.DB.prepare("DELETE FROM helper_grants WHERE code_hash = ?1 AND expires <= datetime('now')").bind(codeHash).run();
      return json({ error: 'grant expired or already used' }, 410);
    }
    const existingOnly = grant.challenge.startsWith('existing:');
    const storedChallenge = existingOnly ? `existing:${challenge}` : challenge;
    if (grant.challenge !== storedChallenge) return json({ error: 'verifier does not match' }, 403);
    if (existingOnly && !token) return json({ error: 'existing CLI credential required' }, 401);
    if (token) {
      if (token.id !== grant.user_id) return json({ error: 'grant belongs to a different user' }, 403);
      const expiry = await activeToken(env, token.token_id);
      if (!expiry) return json({ error: 'valid API token required' }, 401);
      const { meta } = await env.DB.prepare(`DELETE FROM helper_grants
        WHERE code_hash = ?1 AND challenge = ?2 AND user_id = ?3 AND expires > datetime('now')
        AND EXISTS (SELECT 1 FROM api_tokens WHERE id = ?4 AND user_id = ?3 AND revoked IS NULL AND expires > datetime('now'))`)
        .bind(codeHash, storedChallenge, token.id, token.token_id).run();
      if (!meta.changes) {
        if (!await activeToken(env, token.token_id)) return json({ error: 'valid API token required' }, 401);
        return json({ error: 'grant expired or already used' }, 410);
      }
      return json({ user: { id: grant.id, name: grant.name }, expiresAt: isoUtc(expiry.expires) });
    }

    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1 AND revoked IS NULL AND expires > datetime('now')").bind(grant.user_id).first();
    if (active?.n >= MAX_ACTIVE) return json({ error: 'at most 10 active API tokens; revoke one first' }, 409);
    const credential = `rmi_${randomToken()}`, credentialHash = await sha256hex(credential);
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO api_tokens (user_id, name, hash, expires)
        SELECT ?1, 'ROMinit CLI', ?2, datetime('now', '+365 days')
        WHERE EXISTS (SELECT 1 FROM helper_grants WHERE code_hash = ?3 AND challenge = ?4 AND user_id = ?1 AND expires > datetime('now'))
        AND (SELECT COUNT(*) FROM api_tokens WHERE user_id = ?1 AND revoked IS NULL AND expires > datetime('now')) < ?5`)
        .bind(grant.user_id, credentialHash, codeHash, challenge, MAX_ACTIVE),
      env.DB.prepare("DELETE FROM helper_grants WHERE code_hash = ?1 AND challenge = ?2 AND user_id = ?3 AND changes() = 1")
        .bind(codeHash, challenge, grant.user_id),
    ]);
    if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) {
      const current = await activeGrant(env, codeHash);
      if (current && current.challenge === challenge) {
        const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1 AND revoked IS NULL AND expires > datetime('now')").bind(grant.user_id).first();
        if (count?.n >= MAX_ACTIVE) return json({ error: 'at most 10 active API tokens; revoke one first' }, 409);
      }
      return json({ error: 'grant expired or already used' }, 410);
    }
    const expiry = await env.DB.prepare('SELECT expires FROM api_tokens WHERE hash = ?1').bind(credentialHash).first();
    return json({ user: { id: grant.id, name: grant.name }, credential, expiresAt: isoUtc(expiry.expires) });
  }

  return json({ error: 'action must be identity, approve, approve-existing or redeem' }, 400);
}
