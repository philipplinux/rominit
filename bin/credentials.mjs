import { AsyncEntry } from '@napi-rs/keyring';

const KEY = /^rmi_[A-Za-z0-9_-]{43}$/;
const storeError = () => Error('Cannot access the OS credential store. Unlock or configure Keychain, Credential Manager, or Secret Service, then retry.');

function entry(site, Entry) {
  const url = new URL(site);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    throw Error('Credentials require an HTTPS site or HTTP loopback development site.');
  // The kernel-keyring fallback is volatile; require a persistent Secret Service store on Linux.
  return new Entry('rominit-cli', url.origin, { linux: { store: 'secret-service' } });
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
