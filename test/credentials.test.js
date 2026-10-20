import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteCredential, loadCredential, saveCredential } from '../bin/credentials.mjs';

const values = new Map();
class Entry {
  constructor(service, account, options) { assert.equal(service, 'rominit-cli'); assert.equal(options.linux.store, 'secret-service'); this.account = account; }
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

test('locked/unavailable credential storage fails closed and does not expose the secret', async () => {
  const key = `rmi_${'t'.repeat(43)}`;
  class Locked { constructor() { throw Error(`private backend detail: ${key}`); } }
  for (const task of [loadCredential('https://rominit.test', Locked), saveCredential('https://rominit.test', key, Locked), deleteCredential('https://rominit.test', Locked)])
    await assert.rejects(task, error => /OS credential store/.test(error.message) && !error.message.includes(key));
  await assert.rejects(saveCredential('https://rominit.test', 'bad', Entry), /Invalid ROMinit API key/);
  await assert.rejects(saveCredential('http://public.test', key, Entry), /OS credential store/);
  assert.equal(values.size, 0);
});
