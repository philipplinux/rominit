import assert from 'node:assert/strict';
import test from 'node:test';
import { credentialFingerprint, deleteBrowserSession, deleteCredential, loadBrowserSession, loadCredential, saveBrowserSession, saveCredential } from '../bin/credentials.mjs';

const values = new Map();
class Entry {
  constructor(service, account, options) { assert.ok(['rominit-cli', 'rominit-cli-browser-session'].includes(service)); assert.equal(options.linux.store, 'secret-service'); this.account = `${service}:${account}`; }
  async getPassword() { return values.get(this.account) ?? null; }
  async setPassword(value) { values.set(this.account, value); }
  async deleteCredential() { values.delete(this.account); }
}

test('CLI credentials stay in the persistent OS store, separately per website origin', async () => {
  const site = 'https://rominit.test', key = `rmi_${'t'.repeat(43)}`;
  assert.equal(await loadCredential(site, Entry), null);
  await saveCredential(site, key, Entry);
  assert.equal(await loadCredential(site + '/?view=helper', Entry), key);
  assert.equal(await loadCredential('https://other.test', Entry), null);
  await deleteCredential(site, Entry);
  assert.equal(await loadCredential(site, Entry), null);
});

test('browser session stays in a separate keyring entry and is bound to the exact API credential and site origin', async () => {
  const site = 'https://rominit.test', key = `rmi_${'t'.repeat(43)}`, replacement = `rmi_${'u'.repeat(43)}`;
  const session = { version: 1, token: 's'.repeat(43), port: 18787, user: { id: 23, name: 'Philipp' },
    expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60_000).toISOString(), credentialFingerprint: credentialFingerprint(key) };
  await saveCredential(site, key, Entry);
  await saveBrowserSession(site, key, session, Entry);
  assert.equal(await loadCredential(site, Entry), key);
  assert.deepEqual(await loadBrowserSession(site, key, Entry), session);
  assert.equal(await loadBrowserSession('https://other.test', key, Entry), null);
  assert.equal(await loadBrowserSession(site, replacement, Entry), null);
  assert.equal(await loadBrowserSession(site, key, Entry), null, 'credential mismatch removed the stale browser bearer');
  await saveBrowserSession(site, key, session, Entry);
  await deleteBrowserSession(site, Entry);
  assert.equal(await loadBrowserSession(site, key, Entry), null);
});

test('expired or malformed browser sessions are deleted instead of restored', async () => {
  const site = 'https://rominit.test', key = `rmi_${'t'.repeat(43)}`;
  const expired = { version: 1, token: 's'.repeat(43), port: 18787, user: { id: 23, name: 'Philipp' },
    expiresAt: new Date(0).toISOString(), credentialFingerprint: credentialFingerprint(key) };
  await saveCredential(site, key, Entry);
  values.set(`rominit-cli-browser-session:${site}`, JSON.stringify(expired));
  assert.equal(await loadBrowserSession(site, key, Entry), null);
  values.set(`rominit-cli-browser-session:${site}`, '{');
  assert.equal(await loadBrowserSession(site, key, Entry), null);
  assert.equal(values.has(`rominit-cli-browser-session:${site}`), false);
  await deleteCredential(site, Entry);
});

test('locked/unavailable credential storage fails closed and does not expose the secret', async () => {
  const key = `rmi_${'t'.repeat(43)}`;
  class Locked { constructor() { throw Error(`private backend detail: ${key}`); } }
  for (const task of [loadCredential('https://rominit.test', Locked), saveCredential('https://rominit.test', key, Locked), deleteCredential('https://rominit.test', Locked)])
    await assert.rejects(task, error => /OS credential store/.test(error.message) && !error.message.includes(key));
  await assert.rejects(saveCredential('https://rominit.test', 'bad', Entry), /Invalid ROMinit API key/);
  await assert.rejects(saveCredential('http://public.test', key, Entry), /OS credential store/);
  assert.equal(values.size, 0);
});
