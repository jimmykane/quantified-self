import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicReleasePosts, main, sanitizeReleasePost } from './generate-public-releases-snapshot.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function releaseDocument(id = 'release-1', published = true) {
  return {
    name: `projects/quantified-self-io/databases/(default)/documents/changelogs/${id}`,
    fields: {
      title: { stringValue: 'Synthetic release' },
      description: { stringValue: 'A **published** improvement.' },
      date: { timestampValue: '2026-11-04T00:00:00.123456Z' },
      published: { booleanValue: published },
      type: { stringValue: 'minor' },
      version: { stringValue: '1.2.0' },
      internal_note: { stringValue: 'must not leave the generator' },
    },
  };
}
const response = rows => ({ ok: true, json: async () => rows });

test('allowlists public release fields, normalizes dates and rejects drafts and invalid posts', () => {
  const post = sanitizeReleasePost(releaseDocument());
  assert.deepEqual(Object.keys(post).sort(), ['date', 'description', 'id', 'published', 'title', 'type', 'version']);
  assert.equal(post.date, '2026-11-04T00:00:00.123Z');
  assert.throws(() => sanitizeReleasePost(releaseDocument('draft', false)), /unpublished or.*invalid/);
  const invalid = releaseDocument();
  invalid.fields.date.timestampValue = 'invalid';
  assert.throws(() => sanitizeReleasePost(invalid), /invalid public fields/);
  assert.throws(() => sanitizeReleasePost({ ...releaseDocument(), name: 'projects/other/documents/users/private' }), /invalid public fields/);
});

test('queries only published public fields and paginates ties with the original timestamp and document name', async () => {
  const calls = [];
  const documents = [releaseDocument('release-2'), releaseDocument('release-1')];
  const posts = await fetchPublicReleasePosts(async (url, options) => {
    calls.push({ url, ...options });
    return response(documents.length ? [{ document: documents.shift() }] : [{ readTime: '2026-11-04T12:00:00Z' }]);
  }, { pageSize: 1 });
  const queries = calls.map(call => JSON.parse(call.body).structuredQuery);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(queries[0].where.fieldFilter, { field: { fieldPath: 'published' }, op: 'EQUAL', value: { booleanValue: true } });
  assert.deepEqual(queries[0].from, [{ collectionId: 'changelogs' }]);
  assert.equal(queries[0].select.fields.some(field => field.fieldPath === 'internal_note'), false);
  assert.deepEqual(queries[1].startAt, {
    before: false,
    values: [{ timestampValue: '2026-11-04T00:00:00.123456Z' }, { referenceValue: releaseDocument('release-2').name }],
  });
  assert.deepEqual(posts.map(post => post.id), ['release-2', 'release-1']);
});

test('fails on HTTP errors, malformed responses and repeated pages instead of producing an empty snapshot', async () => {
  await assert.rejects(() => fetchPublicReleasePosts(async () => ({ ok: false, status: 403 })), /HTTP 403/);
  for (const rows of [{}, [{ error: { message: 'private diagnostic' } }], [{}], [{ document: releaseDocument('draft', false) }]]) {
    await assert.rejects(() => fetchPublicReleasePosts(async () => response(rows)), /invalid|unpublished/);
  }
  await assert.rejects(() => fetchPublicReleasePosts(async () => response([{ document: releaseDocument() }]), { pageSize: 1 }), /repeated a document/);
});

test('writes only successfully loaded public content and preserves an existing snapshot when reads fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qs-public-releases-'));
  const outputPath = join(directory, 'snapshot.json');
  try {
    await main({ outputPath, fetchImpl: async () => response([{ document: releaseDocument() }]) });
    const saved = await readFile(outputPath, 'utf8');
    assert.equal(saved.includes('internal_note'), false);
    assert.equal(JSON.parse(saved).posts.length, 1);
    await assert.rejects(() => main({ outputPath, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
    assert.equal(await readFile(outputPath, 'utf8'), saved);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
