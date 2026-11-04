import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicSnapshotFetch, FIRESTORE_DOCUMENTS_URL } from './public-snapshot-firestore.mjs';

test('authenticates every snapshot request with refreshable ADC and preserves query bodies', async () => {
  const calls = [];
  let refreshes = 0;
  const request = await createPublicSnapshotFetch({
    auth: { getClient: async () => ({ getRequestHeaders: async () => ({ Authorization: `Bearer synthetic-${++refreshes}` }) }) },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
  });
  await request(`${FIRESTORE_DOCUMENTS_URL}/products?pageSize=100`);
  await request(`${FIRESTORE_DOCUMENTS_URL}:runQuery`, {
    method: 'POST', body: '{"structuredQuery":{}}',
    headers: { 'Content-Type': 'application/json', Authorization: 'must-not-override' },
  });
  assert.equal(calls[0].options.headers.get('authorization'), 'Bearer synthetic-1');
  assert.equal(calls[1].options.headers.get('authorization'), 'Bearer synthetic-2');
  assert.equal(calls[1].options.headers.get('content-type'), 'application/json');
  assert.equal(calls[1].options.body, '{"structuredQuery":{}}');
  assert.equal(calls[1].options.redirect, 'error');
  assert.ok(calls[1].options.signal instanceof AbortSignal);
});

test('never sends credentials to another host, project or private document path', async () => {
  let calls = 0;
  const request = await createPublicSnapshotFetch({
    auth: { getClient: async () => ({ getRequestHeaders: async () => { calls++; return {}; } }) },
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  for (const url of ['https://example.com/', `${FIRESTORE_DOCUMENTS_URL}/users`, FIRESTORE_DOCUMENTS_URL.replace('quantified-self-io', 'other-project') + '/products']) {
    await assert.rejects(() => request(url), /outside the allowed/);
  }
  assert.equal(calls, 0);
  await assert.rejects(() => request(`${FIRESTORE_DOCUMENTS_URL}/products`, { method: 'DELETE' }), /outside the allowed/);
  await assert.rejects(() => request(`${FIRESTORE_DOCUMENTS_URL}:runQuery`), /outside the allowed/);
});

test('fails closed without logging credential-provider or HTTP exception details', async () => {
  await assert.rejects(() => createPublicSnapshotFetch({ auth: { getClient: async () => { throw new Error('synthetic-private-detail'); } } }), {
    message: 'Public snapshots require Application Default Credentials with Firestore read access.',
  });
  const request = await createPublicSnapshotFetch({
    auth: { getClient: async () => ({ getRequestHeaders: async () => { throw new Error('synthetic-private-detail'); } }) },
  });
  await assert.rejects(() => request(`${FIRESTORE_DOCUMENTS_URL}/products`), {
    message: 'Could not authenticate public snapshots with Application Default Credentials.',
  });
  const missingHeader = await createPublicSnapshotFetch({ auth: { getClient: async () => ({ getRequestHeaders: async () => ({}) }) } });
  await assert.rejects(() => missingHeader(`${FIRESTORE_DOCUMENTS_URL}/products`), /Could not authenticate/);
});
