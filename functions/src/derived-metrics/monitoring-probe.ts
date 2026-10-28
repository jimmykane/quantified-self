import {
    DERIVED_METRICS_COLLECTION_ID, DERIVED_METRICS_COORDINATOR_DOC_ID, DERIVED_METRICS_ENTRY_TYPES,
    normalizeDerivedMetricKindsStrict,
} from '../../../shared/derived-metric-kinds';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { CLOUD_TASK_RETRY_CONFIG } from '../shared/queue-config';
import { isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';
import {
    DERIVED_MONITORING_STATES, recordDerivedMetricsSample, recordDerivedMetricsUnavailable,
    type DerivedMetricsSample,
} from './monitoring';

export const DERIVED_METRICS_PROBE_LIMIT = 20;
export const DERIVED_METRICS_PROBE_TIMEOUT_MS = 5_000;
export const DERIVED_METRICS_PROBE_FIELDS = [
    'entryType', 'status', 'generation', 'dirtyMetricKinds', 'processingMetricKinds',
    'requestedAtMs', 'startedAtMs', 'updatedAtMs', 'buildNotBeforeMs',
];
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Pending-generation timing only: never recording date, snapshot age, or athlete inactivity. */
export function derivedMetricsPendingAge(data: FirebaseFirestore.DocumentData, now: number): number | 'excluded' | 'unknown' {
    if (!DERIVED_MONITORING_STATES.includes(data.status)) return 'excluded';
    if (data.entryType !== DERIVED_METRICS_ENTRY_TYPES.Coordinator || !timestamp(data.generation)
        || !timestamp(data.updatedAtMs) || data.updatedAtMs > now + DERIVED_METRICS_PROBE_TIMEOUT_MS) return 'unknown';
    const field = data.status === 'processing' ? 'processingMetricKinds' : 'dirtyMetricKinds';
    const kinds = data[field];
    // The canonical normalizer retains historical coercion semantics. Persisted
    // probe metadata must be literal strings: one malformed row must not throw
    // while coercing an object and suppress every other owner's observation.
    if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => typeof kind !== 'string')
        || normalizeDerivedMetricKindsStrict(kinds).length !== kinds.length) return 'unknown';
    let since = data.status === 'processing' ? data.startedAtMs : data.requestedAtMs;
    if (!timestamp(since) || since > now + DERIVED_METRICS_PROBE_TIMEOUT_MS) return 'unknown';
    if (data.status !== 'processing' && data.buildNotBeforeMs != null) {
        if (!timestamp(data.buildNotBeforeMs)) return 'unknown';
        if (data.buildNotBeforeMs > now) return 'excluded';
        // Intentional batching is scheduled work, not eligible waiting time.
        // Legacy records without a deadline retain their requested-at anchor.
        since = Math.max(since, data.buildNotBeforeMs);
    }
    // Native task retries can intentionally wait up to four hours. A retained failure
    // is not a stalled calculation while that conservative retry window remains open.
    if (data.status === 'failed' && now - data.updatedAtMs < CLOUD_TASK_RETRY_CONFIG.maxBackoffSeconds * 1_000) return 'excluded';
    return Math.max(0, now - since);
}

/** One bounded coordinator-only query and at most 20 masked, read-only ownership rechecks. */
export async function observeDerivedMetricsQueue(db: FirebaseFirestore.Firestore, now = Date.now()): Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sample = async () => {
        if (!timestamp(now)) throw new Error('Invalid observation clock');
        const candidates = await db.collectionGroup(DERIVED_METRICS_COLLECTION_ID)
            .where('entryType', '==', DERIVED_METRICS_ENTRY_TYPES.Coordinator)
            .where('status', 'in', [...DERIVED_MONITORING_STATES]).orderBy('updatedAtMs')
            // Existing coordinators have generation; snapshots must not. This
            // ordered suffix keeps their composite index entries coordinator-only.
            // It breaks timestamp ties, never replaces oldest-update ordering.
            .orderBy('generation')
            .select(...DERIVED_METRICS_PROBE_FIELDS).limit(DERIVED_METRICS_PROBE_LIMIT + 1).get();
        if (stopped) return;
        const groups: DerivedMetricsSample[] = DERIVED_MONITORING_STATES.map(state => ({ state, pendingSample: 0,
            ageLowerBoundMs: 0, unknownSample: 0, excludedSample: 0, truncated: candidates.size > DERIVED_METRICS_PROBE_LIMIT }));
        for (const doc of candidates.docs.slice(0, DERIVED_METRICS_PROBE_LIMIT)) {
            if (stopped) return;
            const group = groups.find(group => group.state === doc.get('status'));
            const path = doc.ref.path.split('/');
            if (!group || path.length !== 4 || path[0] !== 'users' || path[2] !== DERIVED_METRICS_COLLECTION_ID
                || path[3] !== DERIVED_METRICS_COORDINATOR_DOC_ID) {
                groups.forEach(group => group.unknownSample++); continue;
            }
            const uid = path[1];
            if (!isDerivedMetricsUidAllowed(uid)) { group.excludedSample++; continue; }
            const result = await db.runTransaction(async tx => {
                const [current, owner, tombstone] = await tx.getAll(doc.ref, db.doc(`users/${uid}`),
                    db.doc(`userDeletionTombstones/${uid}`), { fieldMask: [...DERIVED_METRICS_PROBE_FIELDS, 'expireAt'] });
                if (stopped || !current.exists || !owner.exists || isUserDeletionTombstoneActive(tombstone.data(), now)) return 'excluded';
                if (!current.updateTime || !doc.updateTime || !current.updateTime.isEqual(doc.updateTime)) return 'excluded';
                return derivedMetricsPendingAge(current.data()!, now);
            }, { readOnly: true });
            if (stopped) return;
            if (result === 'excluded') group.excludedSample++;
            else if (result === 'unknown') group.unknownSample++;
            else { group.pendingSample++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs, result); }
        }
        if (!stopped) groups.forEach(recordDerivedMetricsSample);
    };
    try {
        await Promise.race([sample(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, DERIVED_METRICS_PROBE_TIMEOUT_MS);
        })]);
    } catch { recordDerivedMetricsUnavailable(); }
    finally { stopped = true; if (timer) clearTimeout(timer); }
}
