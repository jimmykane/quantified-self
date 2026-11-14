import { getActivityDeliveryRoute, type ActivityDeliveryRouteId } from '../../../shared/activity-sync-routes';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { activityDeliveryFields, recordActivityDeliveryReviewSample } from './monitoring';

const LIMIT = 20;
const DAY_MS = 86_400_000;
const ROOTS: Record<string, string> = { suunto: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
    coros: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, wahoo: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME };
const FIELDS = ['userID', 'routeId', 'sourceServiceName', 'destinationServiceName', 'deliveryMode', 'manual',
    'resultStatus', 'manualReconciliationRequiredAt', 'dateCreated', 'processed', 'failedAt', 'originalCollection',
    'skippedReason', 'deferredReason', 'processingLeaseExpiresAt'];
export type ActivityDeliveryReviewKind = 'manual_reconciliation' | 'dead_letter';

/** Observe retained unresolved outcomes independently of the pending-work sample. Never admits or replays work. */
export async function observeActivityDeliveryReview(db: FirebaseFirestore.Firestore, now = Date.now()): Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const destinations = ['suunto', 'coros', 'wahoo'];
    const kinds: ActivityDeliveryReviewKind[] = ['manual_reconciliation', 'dead_letter'];
    const completed = new Set<ActivityDeliveryReviewKind>();
    const observe = async (kind: ActivityDeliveryReviewKind) => {
        const query = kind === 'manual_reconciliation'
            ? db.collection('activitySyncQueue').where('resultStatus', '==', 'manual_reconciliation_required').orderBy('dateCreated', 'asc')
            : db.collection('failed_jobs').where('originalCollection', '==', 'activitySyncQueue').orderBy('failedAt', 'asc');
        const sample = await query.select(...FIELDS).limit(LIMIT + 1).get();
        if (stopped) return;
        const groups = destinations.map(destination => ({ destination, sampled: 0, overdueSample: 0, excludedSample: 0, unknownSample: 0, ageLowerBoundMs: 0 }));
        for (const doc of sample.docs.slice(0, LIMIT)) {
            if (stopped) return;
            const row = doc.data(), labels = activityDeliveryFields(row);
            const group = groups.find(group => group.destination === labels.destination);
            if (!group || labels.mode === 'unknown') { groups.forEach(g => g.unknownSample++); continue; }
            group.sampled++;
            if (typeof row.userID !== 'string' || !row.userID || row.userID.includes('/')) { group.unknownSample++; continue; }
            const route = getActivityDeliveryRoute(row.routeId as ActivityDeliveryRouteId)!;
            const tokenRoot = db.doc(`${ROOTS[group.destination]}/${row.userID}`);
            const age = await db.runTransaction(async tx => {
                const refs = [doc.ref, db.doc(`users/${row.userID}`), db.doc(`userDeletionTombstones/${row.userID}`),
                    tokenRoot, db.doc(`users/${row.userID}/meta/${route.destinationServiceName}`)];
                if (kind === 'dead_letter') refs.push(db.doc(`activitySyncQueue/${doc.id}`));
                const [current, owner, tombstone, root, meta, live] = await tx.getAll(...refs, {
                    fieldMask: [...FIELDS, 'expireAt', 'connectionState', 'disconnectState', 'disconnectOperationGeneration', 'routeRestorePending'],
                });
                if (stopped || !current.exists || !current.updateTime?.isEqual(doc.updateTime!) || !owner.exists
                    || isUserDeletionTombstoneActive(tombstone.exists ? tombstone.data() : null, now) || live?.exists) return 'excluded';
                if (!root.exists || root.get('disconnectState') === 'disconnect_pending' || root.get('disconnectOperationGeneration')
                    || ['disconnect_pending', 'reconnect_required', 'disconnected'].includes(meta.get('connectionState'))
                    || meta.get('routeRestorePending')) return 'excluded';
                const data = current.data()!;
                if (kind === 'manual_reconciliation' && data.processed === false) return 'excluded';
                if (kind === 'manual_reconciliation' && data.processed !== true) return 'unknown';
                if (data.skippedReason || data.deferredReason || Number(data.processingLeaseExpiresAt) > now) return 'excluded';
                if (stopped) return 'excluded';
                const tokens = await tx.get(tokenRoot.collection('tokens').select('serviceName').limit(1));
                if (tokens.empty) return 'excluded';
                const at = kind === 'dead_letter' ? data.failedAt : data.manualReconciliationRequiredAt;
                if (!Number.isSafeInteger(at) || at < 0 || at > now) return 'unknown';
                return now - Math.max(at, current.updateTime!.toMillis());
            }, { readOnly: true });
            if (stopped) return;
            if (age === 'unknown') group.unknownSample++;
            else if (age === 'excluded') group.excludedSample++;
            else if (age >= DAY_MS) { group.overdueSample++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs, age); }
        }
        if (stopped) return;
        const truncated = sample.size > LIMIT;
        groups.forEach(({ destination, overdueSample, ageLowerBoundMs, ...fields }) => recordActivityDeliveryReviewSample(destination, kind, {
            ...fields, truncated,
            // Unknown or unobserved records cannot establish a healthy zero. Keep a
            // known positive lower bound, and always retain coverage/heartbeat fields.
            ...(overdueSample > 0 || fields.unknownSample === 0 && !truncated ? { overdueSample, ageLowerBoundMs } : {}),
        }));
        completed.add(kind);
    };
    try {
        await Promise.race([
            Promise.all(kinds.map(observe)),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, 5_000); }),
        ]);
    } catch {
        stopped = true;
        kinds.filter(kind => !completed.has(kind)).forEach(kind => destinations.forEach(destination => recordActivityDeliveryReviewSample(destination, kind)));
    } finally { stopped = true; if (timer) clearTimeout(timer); }
}
