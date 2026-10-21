import { createHash } from 'node:crypto';
import { AsyncEntry } from '@napi-rs/keyring';

const KEY = /^rmi_[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_SERVICE = 'rominit-cli-browser-session';
const storeError = () => Error('Cannot access the OS credential store. Unlock or configure Keychain, Credential Manager, or Secret Service, then retry.');

function originOf(site) {
  const url = new URL(site);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    throw Error('Credentials require an HTTPS site or HTTP loopback development site.');
  return url.origin;
}

function entry(site, Entry, service = 'rominit-cli') {
  // The kernel-keyring fallback is volatile; require a persistent Secret Service store on Linux.
  return new Entry(service, originOf(site), { linux: { store: 'secret-service' } });
}

export function credentialFingerprint(credential) {
  if (typeof credential !== 'string' || !KEY.test(credential)) throw Error('Invalid ROMinit API key.');
  return createHash('sha256').update(credential).digest('hex');
}

export async function loadCredential(site, Entry = AsyncEntry) {
  try {
    const value = await entry(site, Entry).getPassword();
    if (value !== null && !KEY.test(value)) throw Error();
    return value;
  } catch { throw storeError(); }
}

export async function saveCredential(site, credential, Entry = AsyncEntry) {
  if (typeof credential !== 'string' || !KEY.test(credential)) throw Error('Invalid ROMinit API key.');
  try { await entry(site, Entry).setPassword(credential); }
  catch { throw storeError(); }
}

export async function deleteCredential(site, Entry = AsyncEntry) {
  try { await entry(site, Entry).deleteCredential(); }
  catch { throw storeError(); }
}

function validSession(value, credential, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
      Object.keys(value).some(key => !['version', 'token', 'port', 'user', 'expiresAt', 'credentialFingerprint'].includes(key)) ||
      !TOKEN.test(value.token ?? '') || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      !value.user || !Number.isSafeInteger(value.user.id) || value.user.id <= 0 || typeof value.user.name !== 'string' ||
      !value.user.name.trim() || value.user.name.length > 256 || typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now ||
      typeof value.credentialFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.credentialFingerprint) ||
      value.credentialFingerprint !== credentialFingerprint(credential)) return false;
  return true;
}

/** Browser bearer remains local to the OS keyring and is scoped to this site's origin and exact API-key identity. */
export async function loadBrowserSession(site, credential, Entry = AsyncEntry, now = Date.now) {
  if (typeof credential !== 'string' || !KEY.test(credential)) return null;
  const item = entry(site, Entry, SESSION_SERVICE);
  let raw;
  try { raw = await item.getPassword(); }
  catch { throw storeError(); }
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { value = null; }
  if (!validSession(value, credential, now())) {
    try { await item.deleteCredential(); } catch { throw storeError(); }
    return null;
  }
  return value;
}

export async function saveBrowserSession(site, credential, session, Entry = AsyncEntry) {
  if (typeof credential !== 'string' || !KEY.test(credential) || !session || typeof session !== 'object' || !validSession(session, credential, Date.now()))
    throw Error('Invalid ROMinit browser session.');
  try { await entry(site, Entry, SESSION_SERVICE).setPassword(JSON.stringify(session)); }
  catch { throw storeError(); }
}

export async function deleteBrowserSession(site, Entry = AsyncEntry) {
  try { await entry(site, Entry, SESSION_SERVICE).deleteCredential(); }
  catch { throw storeError(); }
}
