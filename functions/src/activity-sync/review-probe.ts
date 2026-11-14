import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { activityDeliveryFields, recordActivityDeliveryReviewSample } from './monitoring';

const LIMIT = 20;
const DAY_MS = 86_400_000;
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
            const age = await db.runTransaction(async tx => {
                const refs = [doc.ref, db.doc(`users/${row.userID}`), db.doc(`userDeletionTombstones/${row.userID}`)];
                if (kind === 'dead_letter') refs.push(db.doc(`activitySyncQueue/${doc.id}`));
                const [current, owner, tombstone, live] = await tx.getAll(...refs, { fieldMask: [...FIELDS, 'expireAt'] });
                if (stopped || !current.exists || !current.updateTime?.isEqual(doc.updateTime!) || !owner.exists
                    || isUserDeletionTombstoneActive(tombstone.exists ? tombstone.data() : null, now) || live?.exists) return 'excluded';
                const data = current.data()!;
                if (data.skippedReason || data.deferredReason || Number(data.processingLeaseExpiresAt) > now) return 'excluded';
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
        groups.forEach(({ destination, ...fields }) => recordActivityDeliveryReviewSample(destination, kind, { ...fields, truncated: sample.size > LIMIT }));
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
