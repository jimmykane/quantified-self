import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { GARMIN_API_TOKENS_COLLECTION_NAME, GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME, SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME, WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../wahoo/constants';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { MAX_RETRY_COUNT } from '../shared/queue-config';

const SOURCES = [
  { service: ServiceNames.GarminAPI, provider: 'garmin', queue: GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, root: GARMIN_API_TOKENS_COLLECTION_NAME, identity: 'userID' },
  { service: ServiceNames.SuuntoApp, provider: 'suunto', queue: SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, root: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME, identity: 'userName' },
  { service: ServiceNames.COROSAPI, provider: 'coros', queue: COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, root: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, identity: 'openId' },
  { service: ServiceNames.WahooAPI, provider: 'wahoo', queue: WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME, root: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME, identity: 'wahooUserID' },
] as const;
export const IMPORT_PROBE_LIMIT = 20;
const PROBE_TIMEOUT_MS = 5_000;
const QUEUE_FIELDS = ['processed', 'retryCount', 'dateCreated', 'dispatchedToCloudTask', 'firebaseUserID', 'userID', 'userName', 'openId', 'wahooUserID', 'resultStatus', 'processingLeaseExpiresAt'];
export type ImportAttemptOutcome = 'acknowledged' | 'already_processed' | 'already_dead_lettered' | 'cleanup_removed' | 'stale' | 'deferred' | 'token_refresh_deferred' | 'dead_lettered' | 'retry' | 'failed';

function emit(provider: string, event: string, fields: Record<string, number | boolean | string> = {}): void {
  // Telemetry is non-authorizing and must never turn a committed import into a retry.
  try { logger.info('[ActivityImport]', { telemetryVersion: 1, provider, event, ...fields }); } catch { /* best effort */ }
}

export function recordImportAttempt(service: unknown, outcome: ImportAttemptOutcome, durationMs: number): void {
  const source = SOURCES.find(item => item.service === service);
  if (source) emit(source.provider, 'worker_attempt', { outcome, durationMs: Math.max(0, Math.floor(durationMs)) });
}

/** Call only AFTER a committed transition, never inside a retried transaction callback. */
export function recordImportCommit(collection: unknown, outcome: 'imported' | 'skipped' | 'dead_lettered'): void {
  const source = SOURCES.find(item => item.queue === collection);
  if (source) emit(source.provider, 'committed', { outcome });
}

export function recordImportCompletion(collection: unknown, additionalData?: Record<string, unknown>): void {
  if (additionalData?.resultStatus !== undefined && additionalData.resultStatus !== 'success' && additionalData.resultStatus !== 'skipped') return;
  recordImportCommit(collection, additionalData?.resultStatus === 'skipped' ? 'skipped' : 'imported');
}

export function recordImportDispatch(service: unknown, outcome: 'completed' | 'failed'): void {
  const source = SOURCES.find(item => item.service === service);
  if (source) emit(source.provider, 'dispatch_run', { outcome });
}

export function recordImportQueueUnavailable(service: unknown): void {
  const source = SOURCES.find(item => item.service === service);
  if (source) emit(source.provider, 'queue_sample_unavailable');
}

/** Bounded read-only lower-bound sample, piggybacking on the existing 30-minute dispatcher. */
export async function observeImportQueue(db: FirebaseFirestore.Firestore, service: ServiceNames, now = Date.now()): Promise<void> {
  const source = SOURCES.find(item => item.service === service);
  if (!source) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const sample = async () => {
    const candidates = await db.collection(source.queue).where('processed', '==', false)
      .where('dispatchedToCloudTask', '==', null).where('retryCount', '<', MAX_RETRY_COUNT)
      .select(...QUEUE_FIELDS).limit(IMPORT_PROBE_LIMIT + 1).get();
    if (stopped) return;
    let dueSample = 0; let excludedSample = 0; let unknownSample = 0; let ageLowerBoundMs = 0;
    for (const doc of candidates.docs.slice(0, IMPORT_PROBE_LIMIT)) {
      if (stopped) return;
      const data = doc.data();
      const uid = data.firebaseUserID;
      const identity = data[source.identity];
      if (typeof uid !== 'string' || !uid.trim() || uid.includes('/')
          || typeof identity !== 'string' || !identity.trim()
          || !Number.isSafeInteger(data.dateCreated) || data.dateCreated < 0
          || !Number.isSafeInteger(data.retryCount) || data.retryCount < 0) { unknownSample++; continue; }
      // One read snapshot prevents a replacement revision/disconnect/deletion race
      // from lending an old age to a newly eligible record. No provider/token I/O.
      const state = await db.runTransaction(async tx => {
        const user = db.collection('users').doc(uid);
        const root = db.collection(source.root).doc(uid);
        const [current, owner, tombstone, meta, connection] = await tx.getAll(
          doc.ref, user, db.collection('userDeletionTombstones').doc(uid), user.collection('meta').doc(service), root,
          { fieldMask: [...QUEUE_FIELDS, 'expireAt', 'providerUserId', 'connectionState', 'disconnectState', 'disconnectOperationGeneration'] },
        );
        if (!current.exists || !current.updateTime?.isEqual(doc.updateTime!)) return 'excluded';
        if (!owner.exists || isUserDeletionTombstoneActive(tombstone.exists ? tombstone.data() : null, now)) return 'excluded';
        const row = current.data()!;
        if (row.processed !== false || row.dispatchedToCloudTask !== null || row.resultStatus === 'deferred'
            || row.resultStatus === 'manual_reconciliation_required' || Number(row.processingLeaseExpiresAt) > now) return 'excluded';
        if (['disconnect_pending', 'reconnect_required'].includes(meta.get('connectionState'))
            || connection.get('disconnectState') === 'disconnect_pending' || connection.get('disconnectOperationGeneration')) return 'excluded';
        if (!connection.exists) return 'excluded';
        if ((service === ServiceNames.COROSAPI || service === ServiceNames.WahooAPI)
            && meta.get('providerUserId') && meta.get('providerUserId') !== identity) return 'excluded';
        if (stopped) return 'excluded';
        const tokens = await tx.get(root.collection('tokens').where(source.identity, '==', identity).select('serviceName').limit(1));
        if (tokens.empty) return 'excluded';
        const updatedAt = current.updateTime?.toMillis();
        if (!Number.isSafeInteger(updatedAt) || updatedAt! < 0 || updatedAt! > now + PROBE_TIMEOUT_MS) return 'unknown';
        return Math.max(0, now - updatedAt!);
      }, { readOnly: true });
      if (stopped) return;
      if (state === 'excluded') excludedSample++;
      else if (state === 'unknown') unknownSample++;
      else { dueSample++; ageLowerBoundMs = Math.max(ageLowerBoundMs, state); }
    }
    if (stopped) return;
    emit(source.provider, 'queue_sample', {
      sampled: Math.min(candidates.size, IMPORT_PROBE_LIMIT), excludedSample, unknownSample,
      truncated: candidates.size > IMPORT_PROBE_LIMIT,
      // Unknown-only observations are not a zero backlog/age observation.
      ...(dueSample > 0 || unknownSample === 0 ? { dueSample, ageLowerBoundMs } : {}),
    });
  };
  try {
    await Promise.race([sample(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { stopped = true; reject(new Error('Probe deadline')); }, PROBE_TIMEOUT_MS);
    })]);
  } catch { recordImportQueueUnavailable(service); }
  finally { stopped = true; if (timer) clearTimeout(timer); }
}
