import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTES, type RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';
import { getMissingGarminPermissionsForTokenLike, selectPreferredGarminTokenLike } from '../../../shared/garmin-service-token';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { normalizeWahooUserID } from '../wahoo/account';
import { normalizeCOROSOpenId } from '../coros/account';
import { ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD, doesOAuthCredentialGenerationAuthorizeToken } from '../token-refresh-coordinator';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { getRouteDeliverySyncRouteAllowlistConfigError, isRouteDeliverySyncRouteUserAllowlisted } from '../route-delivery-sync/allowlist';
import { buildRouteDeliverySourceRevisionKeyForRouteSource } from '../route-delivery-sync/revision';
import { parseRouteDeliverySourceLifecycleFence } from '../route-delivery-sync/source-lifecycle';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from './route-sync.constants';
import { recordRouteQueueSample, routeQueueFields, type RouteQueueLane } from './monitoring';

export const ROUTE_QUEUE_PROBE_LIMIT = 20;
export const ROUTE_QUEUE_PROBE_TIMEOUT_MS = 5_000;
const TOKEN_LIMIT = 5;
const ROOTS = new Map<string, string>([[ServiceNames.GarminAPI, GARMIN_API_TOKENS_COLLECTION_NAME],
    [ServiceNames.COROSAPI, COROSAPI_ACCESS_TOKENS_COLLECTION_NAME], [ServiceNames.WahooAPI, WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME]]);
// Read references/generations only for comparisons, never payloads, credentials, names or geometry.
const QUEUE_FIELDS = ['routeId', 'sourceServiceName', 'destinationServiceName', 'manual', 'userID', 'firebaseUserID',
    'providerUserId', 'providerRouteId', 'savedRouteID', 'sourceRevisionKey', 'sourceProviderRouteId', 'sourceProviderUserId',
    'sourceConnectionStateGeneration', 'sourceTokenCredentialGeneration', 'sourceRootOAuthCredentialGeneration',
    'processed', 'retryCount', 'dateCreated', 'dispatchedToCloudTask', 'providerOperationStartedAt', 'processingLeaseExpiresAt',
    'resultStatus', 'destinationDeliveryAcceptedAt', 'destinationProviderRouteId', 'destinationDeliveries', 'manualReconciliationRequiredAt'];
const STATE_FIELDS = [...new Set([...QUEUE_FIELDS, 'expireAt', 'serviceSyncSettings.routeDeliverySyncRoutes', 'connectionState',
    'connectionStateGeneration', 'disconnectState', 'disconnectOperationGeneration', 'routeRestorePending',
    ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD, 'tokenCredentialGeneration', 'serviceName', 'userName', 'providerUserId',
    'sourceSummary.sourceServiceName', 'sourceSummary.providerRouteId', 'sourceSummary.providerUserId',
    'sourceSummary.modifiedAt', 'sourceSummary.importedAt', 'importedAt'])];
const TOKEN_FIELDS = ['serviceName', 'userID', 'providerUserId', 'wahooUserID', 'openId', 'scope', 'permissions', 'dateCreated', 'connectedAtMs', 'tokenCredentialGeneration'];
const DESTINATIONS = ['garmin', 'wahoo', 'coros'] as const;
type Classification = 'new' | 'excluded' | 'unknown';
type Eligibility = 'excluded' | 'unknown' | number;

function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function documentID(value: unknown): value is string { return nonEmpty(value) && value === value.trim() && !value.includes('/'); }

/** Fresh undispatched work only: native transport owns retry backoff and claimed operations. */
export function routeQueueProbeCandidate(row: Record<string, unknown>, now: number): Classification {
    if (!Number.isSafeInteger(row.dateCreated) || Number(row.dateCreated) < 0
        || !Number.isSafeInteger(row.retryCount) || Number(row.retryCount) < 0
        || ['dispatchedToCloudTask', 'providerOperationStartedAt', 'processingLeaseExpiresAt'].some(field => row[field] != null
            && (!Number.isSafeInteger(row[field]) || Number(row[field]) < 0))) return 'unknown';
    if (row.resultStatus != null && !['success', 'skipped', 'deferred', 'manual_reconciliation_required'].includes(row.resultStatus as string)) return 'unknown';
    if (row.processed !== false || Number(row.dateCreated) > now || row.retryCount !== 0 || row.dispatchedToCloudTask != null
        || Number(row.providerOperationStartedAt) > 0 || Number(row.processingLeaseExpiresAt) > now
        || row.resultStatus != null
        || row.destinationDeliveryAcceptedAt != null || row.destinationProviderRouteId != null || row.destinationDeliveries != null
        || row.manualReconciliationRequiredAt != null) return 'excluded';
    return 'new';
}

export function recordRouteQueuesUnavailable(): void {
    recordRouteQueueSample('import', 'qs');
    DESTINATIONS.forEach(destination => recordRouteQueueSample('delivery', destination));
}

function destinationEligibility(service: string, tokens: FirebaseFirestore.QuerySnapshot,
    meta: FirebaseFirestore.DocumentSnapshot, root: FirebaseFirestore.DocumentSnapshot): Classification {
    if (tokens.empty) return 'excluded';
    if (tokens.size > TOKEN_LIMIT) return 'unknown';
    const rows = tokens.docs.map(doc => doc.data());
    if (service === ServiceNames.GarminAPI) {
        const preferred = selectPreferredGarminTokenLike(rows, ['COURSE_IMPORT']);
        return preferred && nonEmpty(preferred.userID)
            && getMissingGarminPermissionsForTokenLike(preferred, ['COURSE_IMPORT']).length === 0 ? 'new' : 'excluded';
    }
    const rawPinned = meta.get('providerUserId');
    const normalize = service === ServiceNames.WahooAPI ? normalizeWahooUserID : normalizeCOROSOpenId;
    const pinned = normalize(rawPinned);
    if (rawPinned != null && rawPinned !== '' && !pinned) return 'excluded';
    // Do not guess the active account from an ambiguous legacy multi-account prefix.
    if (!pinned && tokens.size !== 1) return 'unknown';
    const selected = pinned ? tokens.docs.find(doc => doc.id === pinned) : tokens.docs[0];
    if (!selected) return 'excluded';
    const token = selected.data();
    if (service === ServiceNames.WahooAPI) {
        if (normalizeWahooUserID(token.wahooUserID) !== selected.id) return 'excluded';
        const activeGeneration = root.get(ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD);
        if (nonEmpty(activeGeneration) && activeGeneration !== token.tokenCredentialGeneration) return 'unknown';
        if (typeof token.scope !== 'string') return 'unknown';
        const scopes = new Set(token.scope.split(/\s+/));
        return scopes.has('routes_read') && scopes.has('routes_write') ? 'new' : 'excluded';
    }
    if (!root.exists || normalizeCOROSOpenId(token.openId || selected.id) !== selected.id
        || !doesOAuthCredentialGenerationAuthorizeToken(root.data(), token.tokenCredentialGeneration)) return 'excluded';
    return 'new';
}

/** Bounded read-only observation on the existing dispatcher; not a dispatch/admission decision. */
export async function observeRouteQueues(db: FirebaseFirestore.Firestore, proAccess: (uid: string) => Promise<boolean>, now = Date.now()): Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entitlements = new Map<string, Promise<boolean>>();
    const sample = async () => {
        // Both lanes share one deadline. Neither query fetches route files or error arrays.
        const snapshots = await Promise.all([ROUTE_SYNC_QUEUE_COLLECTION_NAME, ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME].map(collection =>
            db.collection(collection).where('processed', '==', false).orderBy('dateCreated', 'asc')
                .select(...QUEUE_FIELDS).limit(ROUTE_QUEUE_PROBE_LIMIT + 1).get()));
        if (stopped) return;
        const groups = [
            { lane: 'import' as RouteQueueLane, destination: 'qs' as const, snapshot: snapshots[0] },
            ...DESTINATIONS.map(destination => ({ lane: 'delivery' as RouteQueueLane, destination, snapshot: snapshots[1] })),
        ].map(group => ({ ...group, sampled: 0, excludedSample: 0, unknownSample: 0, dueSample: 0, ageLowerBoundMs: 0 }));
        for (const [index, snapshot] of snapshots.entries()) {
            const lane: RouteQueueLane = index === 0 ? 'import' : 'delivery';
            for (const doc of snapshot.docs.slice(0, ROUTE_QUEUE_PROBE_LIMIT)) {
                if (stopped) return;
                const row = doc.data();
                const labels = routeQueueFields(lane, row);
                const group = groups.find(group => group.lane === lane && group.destination === labels.destination);
                if (!group || labels.mode === 'unknown') { groups.filter(group => group.lane === lane).forEach(group => group.unknownSample++); continue; }
                group.sampled++;
                const classification = routeQueueProbeCandidate(row, now);
                if (classification === 'excluded') { group.excludedSample++; continue; }
                const uid = lane === 'import' ? row.firebaseUserID : row.userID;
                const providerUserID = lane === 'import' ? row.providerUserId : row.sourceProviderUserId;
                if (classification === 'unknown' || !documentID(uid) || !documentID(providerUserID)
                    || lane === 'import' && !nonEmpty(row.providerRouteId)
                    || lane === 'delivery' && (!documentID(row.savedRouteID) || !nonEmpty(row.sourceRevisionKey))) { group.unknownSample++; continue; }
                if (lane === 'delivery' && (getRouteDeliverySyncRouteAllowlistConfigError(row.routeId as RouteDeliverySyncRouteId)
                    || !isRouteDeliverySyncRouteUserAllowlisted(row.routeId as RouteDeliverySyncRouteId, uid))) { group.excludedSample++; continue; }
                // Only outgoing copies require Pro at processing time; the inbound worker does not.
                if (lane === 'delivery') {
                    if (!entitlements.has(uid)) entitlements.set(uid, proAccess(uid));
                    if (!await entitlements.get(uid)) { group.excludedSample++; continue; }
                }
                if (stopped) return;
                const eligibility = await db.runTransaction(async (tx): Promise<Eligibility> => {
                    const user = db.collection('users').doc(uid);
                    const sourceRoot = db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(uid);
                    const sourceToken = sourceRoot.collection('tokens').doc(providerUserID);
                    const route = lane === 'delivery' ? ROUTE_DELIVERY_SYNC_ROUTES[row.routeId as RouteDeliverySyncRouteId] : null;
                    const destinationRoot = route ? db.collection(ROOTS.get(route.destinationServiceName)!).doc(uid) : null;
                    const [current, owner, tombstone, settings, sourceMeta, root, token, ...delivery] = await tx.getAll(doc.ref, user,
                        db.collection('userDeletionTombstones').doc(uid), user.collection('config').doc('settings'),
                        user.collection('meta').doc(ServiceNames.SuuntoApp), sourceRoot, sourceToken,
                        ...(route ? [user.collection('routes').doc(row.savedRouteID as string), destinationRoot!, user.collection('meta').doc(route.destinationServiceName)] : []),
                        { fieldMask: STATE_FIELDS });
                    if (stopped || !current.exists || !owner.exists
                        || isUserDeletionTombstoneActive(tombstone.exists ? tombstone.data() : null, now)) return 'excluded';
                    const currentClassification = routeQueueProbeCandidate(current.data()!, now);
                    if (currentClassification !== 'new') return currentClassification;
                    // A still-new replacement has not been examined under its current owner/references.
                    // Do not clear a backlog alert as healthy zero just because the query raced an edit.
                    if (!current.updateTime || !doc.updateTime?.isEqual(current.updateTime)) return 'unknown';
                    if (sourceMeta.get('connectionState') === 'disconnect_pending' || root.get('disconnectState') === 'disconnect_pending'
                        || root.get('disconnectOperationGeneration') || sourceMeta.get('routeRestorePending')) return 'excluded';
                    const fence = parseRouteDeliverySourceLifecycleFence({ connectionStateGeneration: sourceMeta.get('connectionStateGeneration'),
                        tokenCredentialGeneration: token.get('tokenCredentialGeneration'), rootOAuthCredentialGeneration: root.get(ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD) });
                    if (!root.exists || !token.exists || sourceMeta.get('connectionState') !== 'connected'
                        || token.get('serviceName') !== ServiceNames.SuuntoApp || token.get('userName') !== providerUserID || !fence) return 'excluded';
                    if (route) {
                        if (row.manual !== true && settings.get(`serviceSyncSettings.routeDeliverySyncRoutes.${route.id}.enabled`) !== true) return 'excluded';
                        const captured = [row.sourceConnectionStateGeneration, row.sourceTokenCredentialGeneration, row.sourceRootOAuthCredentialGeneration];
                        if (captured.some(value => value != null) && (captured[0] !== fence.connectionStateGeneration
                            || captured[1] !== fence.tokenCredentialGeneration || captured[2] !== fence.rootOAuthCredentialGeneration)) return 'excluded';
                        const [saved, destination, meta] = delivery;
                        if (!saved.exists || meta.get('connectionState') === 'disconnect_pending' || meta.get('connectionState') === 'reconnect_required'
                            || meta.get('routeRestorePending') || destination.get('disconnectState') === 'disconnect_pending' || destination.get('disconnectOperationGeneration')) return 'excluded';
                        const sourceSummary = saved.get('sourceSummary');
                        if (sourceSummary?.sourceServiceName !== ServiceNames.SuuntoApp
                            || nonEmpty(row.sourceProviderRouteId) && sourceSummary?.providerRouteId !== row.sourceProviderRouteId
                            || nonEmpty(sourceSummary?.providerUserId) && sourceSummary.providerUserId !== providerUserID) return 'excluded';
                        if (buildRouteDeliverySourceRevisionKeyForRouteSource({ sourceServiceName: route.sourceServiceName, sourceSummary,
                            fallbackProviderRouteId: row.sourceProviderRouteId, routeImportedAt: saved.get('importedAt'), fallbackRouteID: row.savedRouteID as string }) !== row.sourceRevisionKey) return 'excluded';
                        if (stopped) return 'excluded';
                        const tokens = await tx.get(destinationRoot!.collection('tokens').select(...TOKEN_FIELDS).limit(TOKEN_LIMIT + 1));
                        const eligible = destinationEligibility(route.destinationServiceName, tokens, meta, destination);
                        if (eligible !== 'new') return eligible;
                    }
                    const updated = current.updateTime.toMillis();
                    if (!Number.isSafeInteger(updated) || updated < 0 || updated > now + ROUTE_QUEUE_PROBE_TIMEOUT_MS) return 'unknown';
                    return Math.max(0, now - Math.max(updated, Number(row.dateCreated)));
                }, { readOnly: true });
                if (stopped) return;
                if (eligibility === 'unknown') group.unknownSample++;
                else if (eligibility === 'excluded') group.excludedSample++;
                else { group.dueSample++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs, eligibility); }
            }
        }
        if (stopped) return;
        for (const group of groups) {
            const truncated = group.snapshot.size > ROUTE_QUEUE_PROBE_LIMIT;
            recordRouteQueueSample(group.lane, group.destination, { sampled: group.sampled, excludedSample: group.excludedSample,
                unknownSample: group.unknownSample, truncated,
                // A positive lower bound is useful even with partial coverage. An incomplete zero is not healthy.
                ...(group.dueSample > 0 || !truncated && group.unknownSample === 0 ? { dueSample: group.dueSample, ageLowerBoundMs: group.ageLowerBoundMs } : {}) });
        }
    };
    try {
        await Promise.race([sample(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, ROUTE_QUEUE_PROBE_TIMEOUT_MS);
        })]);
    } catch { recordRouteQueuesUnavailable(); }
    finally { stopped = true; if (timer) clearTimeout(timer); }
}
