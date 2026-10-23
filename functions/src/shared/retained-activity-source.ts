import * as admin from 'firebase-admin';
import { gunzipSync } from 'node:zlib';
import type { EventInterface } from '@sports-alliance/sports-lib';
import { createParsingOptions } from '../../../shared/parsing-options';
import { parseActivityFilePayload } from './activity-file-parser';
import { ActivityIdentityConflictError } from './activity-identity-conflict';

interface RetainedSource { path: string; bucket?: string; generation?: string }
const MAX_FILES = 4, MAX_RAW_BYTES = 30 * 1024 * 1024, MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

export function retainedSourceReferences(event: Record<string, any>): RetainedSource[] {
  const files = Array.isArray(event.originalFiles) && event.originalFiles.length ? event.originalFiles
    : event.originalFile ? [event.originalFile] : [];
  return files.map((source: RetainedSource) => ({ path: source?.path, ...(source?.bucket ? { bucket: source.bucket } : {}),
    ...(source?.generation ? { generation: source.generation } : {}) }));
}

export function retainedSourceRevision(event: Record<string, any>): string {
  return JSON.stringify(retainedSourceReferences(event));
}

async function readSource(source: RetainedSource, maximumBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = admin.storage().bucket(source.bucket).file(source.path,
      source.generation ? { generation: source.generation } : undefined).createReadStream();
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (value: Buffer) => {
      size += value.length;
      if (size > maximumBytes) { stream.destroy(new ActivityIdentityConflictError()); return; }
      chunks.push(value);
    });
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks, size)));
  });
}

/** Rare legacy bootstrap only. Never call a provider or read originals inside a Firestore transaction. */
export async function loadRetainedActivitySources(uid: string, eventId: string, event: Record<string, any>, dependencies: {
  loadSource?: (source: RetainedSource, maximumBytes: number) => Promise<Buffer>;
  parseSource?: typeof parseActivityFilePayload;
} = {}): Promise<ReturnType<EventInterface['getActivities']>> {
  const sources = retainedSourceReferences(event);
  if (!sources.length || sources.length > MAX_FILES) throw new ActivityIdentityConflictError();
  const defaultBucket = admin.storage().bucket().name;
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  const approved = new Set([defaultBucket, ...(project ? [project, `${project}.appspot.com`] : [])]);
  const activities: ReturnType<EventInterface['getActivities']> = [];
  let rawBytes = 0, unpackedBytes = 0;
  const started = Date.now();
  for (const source of sources) {
    const prefix = `users/${uid}/events/${eventId}/`;
    if (typeof source.path !== 'string' || !source.path.startsWith(prefix) || source.path.length > 1024
      || source.path.slice(prefix.length).split('/').some(part => !part || part === '.' || part === '..'
        || part.includes('\\') || /%(?:2e|2f|5c)/i.test(part)
        || [...part].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
      || (source.bucket && !approved.has(source.bucket))
      || (source.generation && !/^\d{1,40}$/.test(source.generation)) || Date.now() - started > 20000)
      throw new ActivityIdentityConflictError();
    let payload: Buffer;
    try { payload = await (dependencies.loadSource ?? readSource)(source, MAX_RAW_BYTES - rawBytes); }
    catch (error) {
      if (`${(error as { code?: unknown })?.code}` === '404') throw new ActivityIdentityConflictError();
      throw error; // Storage/auth/transport outages remain retryable.
    }
    rawBytes += payload.length;
    if (rawBytes > MAX_RAW_BYTES) throw new ActivityIdentityConflictError();
    try {
      const unpacked = payload[0] === 0x1f && payload[1] === 0x8b
        ? gunzipSync(payload, { maxOutputLength: MAX_UNPACKED_BYTES - unpackedBytes }) : payload;
      unpackedBytes += unpacked.length;
      if (unpackedBytes > MAX_UNPACKED_BYTES) throw new ActivityIdentityConflictError();
      const parsed = await (dependencies.parseSource ?? parseActivityFilePayload)(unpacked, source.path, createParsingOptions());
      activities.push(...parsed.getActivities());
      if (activities.length > 100 || Date.now() - started > 20000) throw new ActivityIdentityConflictError();
    } catch { throw new ActivityIdentityConflictError(); }
  }
  return activities;
}
