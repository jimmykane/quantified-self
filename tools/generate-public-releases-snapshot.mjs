import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicSnapshotFetch, FIRESTORE_DOCUMENTS_URL } from './public-snapshot-firestore.mjs';

const PUBLIC_FIELDS = ['title', 'description', 'date', 'published', 'image', 'version', 'type'];
const RELEASE_TYPES = new Set(['major', 'minor', 'patch', 'announcement']);

export async function fetchPublicReleasePosts(fetchImpl, { pageSize = 100 } = {}) {
  fetchImpl ??= await createPublicSnapshotFetch();
  const posts = [];
  const seenNames = new Set();
  let cursor;
  while (true) {
    const response = await fetchImpl(`${FIRESTORE_DOCUMENTS_URL}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'changelogs' }],
        select: { fields: PUBLIC_FIELDS.map(fieldPath => ({ fieldPath })) },
        where: { fieldFilter: { field: { fieldPath: 'published' }, op: 'EQUAL', value: { booleanValue: true } } },
        orderBy: [
          { field: { fieldPath: 'date' }, direction: 'DESCENDING' },
          { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
        ],
        limit: pageSize,
        ...(cursor ? { startAt: cursor } : {}),
      } }),
    });
    if (!response.ok) throw new Error(`Public release notes request failed with HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.some(row => !row || row.error || (!row.document && typeof row.readTime !== 'string'))) {
      throw new Error('Public release notes response has an invalid shape.');
    }
    const documents = rows.filter(row => row.document).map(row => row.document);
    for (const document of documents) {
      if (seenNames.has(document.name)) throw new Error('Public release notes pagination repeated a document.');
      seenNames.add(document.name);
      posts.push(sanitizeReleasePost(document));
    }
    if (documents.length < pageSize) return posts;
    const last = documents.at(-1);
    cursor = { before: false, values: [last.fields.date, { referenceValue: last.name }] };
  }
}

export function sanitizeReleasePost(document) {
  const prefix = FIRESTORE_DOCUMENTS_URL.replace('https://firestore.googleapis.com/v1/', '') + '/changelogs/';
  const fields = document?.fields;
  const id = typeof document?.name === 'string' && document.name.startsWith(prefix)
    ? document.name.slice(prefix.length) : '';
  const title = fields?.title?.stringValue;
  const description = fields?.description?.stringValue;
  const date = fields?.date?.timestampValue ?? fields?.date?.stringValue;
  const type = fields?.type?.stringValue;
  if (!id || id.includes('/') || fields?.published?.booleanValue !== true
    || typeof title !== 'string' || !title.trim()
    || typeof description !== 'string' || !description.trim()
    || typeof date !== 'string' || Number.isNaN(Date.parse(date)) || !RELEASE_TYPES.has(type)) {
    throw new Error('Public release note is unpublished or has invalid public fields.');
  }
  return {
    id, title, description, date: new Date(date).toISOString(), published: true, type,
    ...(typeof fields.image?.stringValue === 'string' ? { image: fields.image.stringValue } : {}),
    ...(typeof fields.version?.stringValue === 'string' ? { version: fields.version.stringValue } : {}),
  };
}

export function buildPublicReleasesSnapshot(posts, generatedAt = new Date().toISOString()) {
  return { version: 1, generatedAt, posts };
}

export async function main({ fetchImpl, outputPath = 'tmp/public-releases-snapshot.json' } = {}) {
  const posts = await fetchPublicReleasePosts(fetchImpl);
  const snapshot = buildPublicReleasesSnapshot(posts);
  const absoluteOutputPath = resolve(process.cwd(), outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return snapshot;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(snapshot => {
    console.log(`Generated public release notes snapshot for ${snapshot.posts.length} published posts.`);
  }).catch(error => {
    console.error(`Could not generate public release notes snapshot: ${error.message}`);
    process.exitCode = 1;
  });
}
