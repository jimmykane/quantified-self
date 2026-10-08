import { ServiceNames } from '@sports-alliance/sports-lib';
import { getActivityDeliveryRoute, type ActivityDeliveryRouteId } from '../../../shared/activity-sync-routes';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { isActivitySyncRouteUserAllowlisted } from './allowlist';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { activityDeliveryFields, recordActivityDeliverySample } from './monitoring';

export const ACTIVITY_DELIVERY_PROBE_LIMIT = 20;
const TIMEOUT_MS = 5_000;
const POLL_OVERDUE_GRACE_MS = 2 * 60 * 60 * 1000;
const ROOTS = new Map<string, string>([[ServiceNames.GarminAPI, GARMIN_API_TOKENS_COLLECTION_NAME],
    [ServiceNames.SuuntoApp, SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME], [ServiceNames.COROSAPI, COROSAPI_ACCESS_TOKENS_COLLECTION_NAME],
    [ServiceNames.WahooAPI, WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME]]);
const DESTINATIONS = ['suunto', 'wahoo', 'coros'] as const;
// No original files, credentials, continuation URLs or error text are fetched. The private
// resume ID is read only to distinguish accepted polls; it never enters telemetry.
const FIELDS = ['routeId', 'sourceServiceName', 'destinationServiceName', 'deliveryMode', 'manual', 'userID',
    'processed', 'retryCount', 'dateCreated', 'dispatchedToCloudTask', 'destinationUploadID', 'destinationProviderUserID', 'providerOperationStartedAt',
    'processingLeaseExpiresAt', 'resultStatus'];

export function recordActivityDeliveryQueueUnavailable(): void {
    DESTINATIONS.forEach(destination => recordActivityDeliverySample(destination));
}

/** Pure scheduling classification: exclude ordinary backoff, future polls and claimed operations. */
export function activityDeliveryProbeCandidate(row: Record<string, unknown>, now: number, taskDepth?: number): 'new' | 'poll' | 'excluded' | 'unknown' {
    if (!Number.isSafeInteger(row.dateCreated) || Number(row.dateCreated) < 0
        || !Number.isSafeInteger(row.retryCount) || Number(row.retryCount) < 0
        || ['dispatchedToCloudTask', 'providerOperationStartedAt', 'processingLeaseExpiresAt'].some(field => row[field] != null
            && (!Number.isSafeInteger(row[field]) || Number(row[field]) < 0))) return 'unknown';
    if (row.processed !== false || Number(row.dateCreated) > now || Number(row.processingLeaseExpiresAt) > now
        || row.resultStatus === 'deferred' || row.resultStatus === 'manual_reconciliation_required') return 'excluded';
    if (row.destinationUploadID != null && (typeof row.destinationUploadID !== 'string' || !row.destinationUploadID.trim())) return 'unknown';
    if (row.destinationUploadID) {
        // A due status-only poll is actionable only if no native task remains and its saved due
        // time is beyond the existing dispatcher's two-hour recovery interval. Never reset/resend it.
        if (row.destinationServiceName !== ServiceNames.WahooAPI && row.destinationServiceName !== ServiceNames.COROSAPI) return 'excluded';
        if (row.destinationServiceName === ServiceNames.COROSAPI && (typeof row.destinationProviderUserID !== 'string' || !row.destinationProviderUserID.trim())) return 'unknown';
        if (row.dispatchedToCloudTask == null || Number(row.dispatchedToCloudTask) > now
            || Number(row.providerOperationStartedAt) > 0) return 'excluded';
        if (taskDepth === undefined || !Number.isSafeInteger(taskDepth) || taskDepth < 0) return 'unknown';
        return taskDepth === 0 && now - Number(row.dispatchedToCloudTask) >= POLL_OVERDUE_GRACE_MS ? 'poll' : 'excluded';
    }
    return row.retryCount === 0 && row.dispatchedToCloudTask == null && !row.providerOperationStartedAt ? 'new' : 'excluded';
}

/** Bounded observation only, attached to the existing dispatcher; never writes or calls providers. */
export async function observeActivityDeliveryQueue(db: FirebaseFirestore.Firestore, proAccess: (uid: string) => Promise<boolean>, taskDepth?: number, now = Date.now()): Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entitlements = new Map<string, Promise<boolean>>();
    const sample = async () => {
        const candidates = await db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).where('processed', '==', false)
            .orderBy('dateCreated', 'asc').select(...FIELDS).limit(ACTIVITY_DELIVERY_PROBE_LIMIT + 1).get();
        if (stopped) return;
        const groups = DESTINATIONS.map(destination => ({ destination, sampled: 0, dueSample: 0, overduePollSample: 0, excludedSample: 0, unknownSample: 0, ageLowerBoundMs: 0 }));
        for (const doc of candidates.docs.slice(0, ACTIVITY_DELIVERY_PROBE_LIMIT)) {
            if (stopped) return;
            const row = doc.data();
            const labels = activityDeliveryFields(row);
            const group = groups.find(group => group.destination === labels.destination);
            if (!group || labels.mode === 'unknown') { groups.forEach(group => group.unknownSample++); continue; }
            group.sampled++;
            const classification = activityDeliveryProbeCandidate(row, now, taskDepth);
            if (classification === 'excluded') { group.excludedSample++; continue; }
            const uid = row.userID;
            if (classification === 'unknown' || typeof uid !== 'string' || !uid.trim() || uid.includes('/')
                || row.manual != null && typeof row.manual !== 'boolean') { group.unknownSample++; continue; }
            const route = getActivityDeliveryRoute(row.routeId as ActivityDeliveryRouteId)!;
            if (classification === 'new') {
                // Accepted uploads must still be reconciled if the new-send
                // allowlist changes, matching the worker's resume boundary.
                if (!isActivitySyncRouteUserAllowlisted(row.routeId as ActivityDeliveryRouteId, uid)) { group.excludedSample++; continue; }
                if (!entitlements.has(uid)) entitlements.set(uid, proAccess(uid));
                if (!await entitlements.get(uid)) { group.excludedSample++; continue; }
            }
            if (stopped) return;
            const services = classification === 'poll' || row.deliveryMode === 'historical'
                ? [route.destinationServiceName] : [route.sourceServiceName, route.destinationServiceName];
            const state = await db.runTransaction(async tx => {
                const user = db.collection('users').doc(uid);
                const refs = services.map(service => ({ root: db.collection(ROOTS.get(service)!).doc(uid), meta: user.collection('meta').doc(service) }));
                const [current, owner, tombstone, settings, ...connections] = await tx.getAll(doc.ref, user,
                    db.collection('userDeletionTombstones').doc(uid), user.collection('config').doc('settings'),
                    ...refs.flatMap(ref => [ref.root, ref.meta]),
                    { fieldMask: [...FIELDS, 'expireAt', 'serviceSyncSettings', 'connectionState', 'disconnectState', 'disconnectOperationGeneration', 'routeRestorePending'] });
                if (stopped || !current.exists || !current.updateTime?.isEqual(doc.updateTime!) || !owner.exists
                    || isUserDeletionTombstoneActive(tombstone.exists ? tombstone.data() : null, now)) return 'excluded';
                if (activityDeliveryProbeCandidate(current.data()!, now, taskDepth) !== classification) return 'excluded';
                if (classification === 'new' && row.manual !== true && row.deliveryMode !== 'historical'
                    && settings.get(`serviceSyncSettings.activitySyncRoutes.${row.routeId}.enabled`) !== true) return 'excluded';
                for (let index = 0; index < refs.length; index++) {
                    const root = connections[index * 2]; const meta = connections[index * 2 + 1];
                    if (!root.exists || root.get('disconnectState') === 'disconnect_pending' || root.get('disconnectOperationGeneration')
                        || ['disconnect_pending', 'reconnect_required'].includes(meta.get('connectionState')) || meta.get('routeRestorePending')) return 'excluded';
                    if (stopped) return 'excluded';
                    const tokens = await tx.get(refs[index].root.collection('tokens').select('serviceName').limit(1));
                    if (tokens.empty) return 'excluded';
                }
                const updated = current.updateTime?.toMillis();
                if (!Number.isSafeInteger(updated) || updated! < 0 || updated! > now + TIMEOUT_MS) return 'unknown';
                return Math.max(0, now - Math.max(updated!, classification === 'poll' ? Number(row.dispatchedToCloudTask) : Number(row.dateCreated)));
            }, { readOnly: true });
            if (stopped) return;
            if (state === 'excluded') group.excludedSample++;
            else if (state === 'unknown') group.unknownSample++;
            else { group.dueSample++; if (classification === 'poll') group.overduePollSample++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs, state); }
        }
        if (stopped) return;
        for (const group of groups) recordActivityDeliverySample(group.destination, {
            sampled: group.sampled, excludedSample: group.excludedSample, unknownSample: group.unknownSample,
            truncated: candidates.size > ACTIVITY_DELIVERY_PROBE_LIMIT,
            ...(group.dueSample > 0 || group.unknownSample === 0 ? { dueSample: group.dueSample, overduePollSample: group.overduePollSample, ageLowerBoundMs: group.ageLowerBoundMs } : {}),
        });
    };
    try {
        await Promise.race([sample(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, TIMEOUT_MS);
        })]);
    } catch { recordActivityDeliveryQueueUnavailable(); }
    finally { stopped = true; if (timer) clearTimeout(timer); }
}
