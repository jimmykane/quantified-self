import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onAdminCall } from '../../shared/auth';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../../wahoo/constants';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import {
    ACCEPTED_MARKETING_POLICY_FIELD,
    USER_LEGAL_COLLECTION_NAME,
} from '../../../../shared/user-profile-firestore';
import {
    ACTIVE_SUBSCRIPTION_STATUSES,
    SUBSCRIPTION_ROLE_BASIC,
    SUBSCRIPTION_ROLE_PRO
} from '../shared/subscription.constants';
import { clampListUsersPageSize } from '../shared/date.utils';
import { enrichUsers } from '../shared/user-enrichment';
import {
    buildMcpLogicalConnectionId,
    isActiveMcpConnection,
    MCP_OAUTH_COLLECTIONS,
    type McpConnection,
} from '../../mcp/oauth.service';
import {
    BasicUser,
    ConnectionCountStats,
    CountStats,
    ListUsersRequest,
    ListUsersResponse,
    UserCountRequest,
    UserCountResponse,
} from '../shared/types';
import {
    collectUserPlanActivityMetrics,
    getCanonicalSubscriptionIdentity,
} from '../shared/user-metrics';

const ADMIN_STATS_COLLECTION = 'adminStats';
const ADMIN_EVENT_COUNTS_DOC = 'eventCounts';
const ADMIN_ROUTE_COUNTS_DOC = 'routeCounts';
const ADMIN_CONNECTION_COUNTS_DOC = 'connectionCounts';
const GLOBAL_COLLECTION_COUNT_CACHE_TTL_MS = 60 * 60 * 1000;
const PAID_LIFECYCLE_SUBSCRIPTION_STATUSES = [...ACTIVE_SUBSCRIPTION_STATUSES, 'canceled', 'unpaid'] as const;
const PAID_LIFECYCLE_SUBSCRIPTION_STATUS_SET = new Set<string>(PAID_LIFECYCLE_SUBSCRIPTION_STATUSES);
const PAID_SUBSCRIPTION_ROLE_SET = new Set<string>([SUBSCRIPTION_ROLE_PRO, SUBSCRIPTION_ROLE_BASIC]);
const SERVICE_CONNECTION_PROVIDERS = [
    { collectionName: GARMIN_API_TOKENS_COLLECTION_NAME, provider: 'Garmin' },
    { collectionName: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME, provider: 'Suunto' },
    { collectionName: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, provider: 'COROS' },
    { collectionName: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME, provider: 'Wahoo' },
] as const;
const SERVICE_PROVIDER_BY_TOKEN_COLLECTION: Map<string, string> = new Map(
    SERVICE_CONNECTION_PROVIDERS.map(({ collectionName, provider }) => [collectionName, provider])
);

interface StoredConnectionCountStats {
    serviceUsers: number;
    mcpUsers: number;
    both: number;
    providers: Record<string, number>;
}

interface ActiveMcpConnectionCandidate {
    uid: string;
    connectionId: string;
    clientId: string;
    supersedesLegacy: boolean;
    active: boolean;
}

interface SubscriptionOwnerDocSnapshot {
    data: () => Record<string, unknown>;
    ref?: {
        path?: string;
    } | null;
}

function normalizeCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.floor(value));
}

async function getMarketingConsentCount(db: admin.firestore.Firestore): Promise<number | null> {
    try {
        const snapshot = await db.collectionGroup(USER_LEGAL_COLLECTION_NAME)
            .where(ACCEPTED_MARKETING_POLICY_FIELD, '==', true)
            .count()
            .get();
        const count = snapshot.data().count;
        return typeof count === 'number' && Number.isFinite(count) && count >= 0
            ? Math.floor(count)
            : null;
    } catch (error: unknown) {
        logger.warn('Failed to count marketing consent from user legal agreements.', error);
        return null;
    }
}

function readSubscriptionOwnerId(doc: SubscriptionOwnerDocSnapshot): string | null {
    return getCanonicalSubscriptionIdentity(doc)?.ownerId ?? null;
}

function countDistinctPaidSubscriptionOwners(docs: SubscriptionOwnerDocSnapshot[]): number {
    const ownerIds = new Set<string>();
    docs.forEach((doc) => {
        const data = doc.data();
        if (!PAID_SUBSCRIPTION_ROLE_SET.has(`${data.role || ''}`)) {
            return;
        }
        if (!PAID_LIFECYCLE_SUBSCRIPTION_STATUS_SET.has(`${data.status || ''}`)) {
            return;
        }
        const ownerId = readSubscriptionOwnerId(doc);
        if (ownerId) {
            ownerIds.add(ownerId);
        }
    });
    return ownerIds.size;
}

function toEpochMillis(value: unknown): number | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const time = Date.parse(value);
        return Number.isFinite(time) ? time : null;
    }

    const timestampLike = value as {
        toMillis?: () => number;
        seconds?: number;
        nanoseconds?: number;
    };
    if (typeof timestampLike.toMillis === 'function') {
        const time = timestampLike.toMillis();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof timestampLike.seconds === 'number') {
        const time = (timestampLike.seconds * 1000) + Math.floor((timestampLike.nanoseconds || 0) / 1_000_000);
        return Number.isFinite(time) ? time : null;
    }

    return null;
}

function toIsoString(value: unknown): string | null {
    const time = toEpochMillis(value);
    return time === null ? null : new Date(time).toISOString();
}

function readCachedGlobalCollectionCount(data: admin.firestore.DocumentData | undefined, nowMs: number): CountStats | null {
    const total = data?.total;
    if (typeof total !== 'number' || !Number.isFinite(total)) {
        return null;
    }

    const expireAtMs = toEpochMillis(data?.expireAt);
    if (expireAtMs === null || expireAtMs <= nowMs) {
        return null;
    }

    return {
        total: normalizeCount(total),
        cacheStatus: 'fresh',
        computedAt: toIsoString(data?.computedAt),
        expireAt: new Date(expireAtMs).toISOString(),
    };
}

function readStaleGlobalCollectionCount(data: admin.firestore.DocumentData | undefined): CountStats | null {
    const total = data?.total;
    if (typeof total !== 'number' || !Number.isFinite(total)) {
        return null;
    }

    return {
        total: normalizeCount(total),
        cacheStatus: 'stale',
        computedAt: toIsoString(data?.computedAt),
        expireAt: toIsoString(data?.expireAt),
    };
}

function resolveGlobalCollectionCountCacheRef(
    db: admin.firestore.Firestore,
    cacheDocId: string,
    logLabel: string
): admin.firestore.DocumentReference | null {
    try {
        const collectionRef = db.collection(ADMIN_STATS_COLLECTION);
        if (!collectionRef || typeof collectionRef.doc !== 'function') {
            return null;
        }
        return collectionRef.doc(cacheDocId);
    } catch (error) {
        logger.warn(`Failed to resolve admin global ${logLabel} count cache doc`, error);
        return null;
    }
}

async function getGlobalCollectionCount(
    db: admin.firestore.Firestore,
    options: {
        collectionGroupId: 'events' | 'routes';
        cacheDocId: string;
        kind: 'eventCounts' | 'routeCounts';
        logLabel: string;
        forceRefresh?: boolean;
        requestedByUid?: string | null;
    }
): Promise<CountStats> {
    const nowMs = Date.now();
    const cacheRef = resolveGlobalCollectionCountCacheRef(db, options.cacheDocId, options.logLabel);
    let cachedData: admin.firestore.DocumentData | undefined;

    if (cacheRef) {
        try {
            const cacheSnapshot = await cacheRef.get();
            cachedData = cacheSnapshot.exists ? cacheSnapshot.data() : undefined;
            if (!options.forceRefresh) {
                const cached = readCachedGlobalCollectionCount(cachedData, nowMs);
                if (cached) {
                    return cached;
                }
            }
        } catch (error) {
            logger.warn(`Failed to read admin global ${options.logLabel} count cache`, error);
        }
    }

    try {
        const snapshot = await db.collectionGroup(options.collectionGroupId).count().get();
        const total = normalizeCount(snapshot.data().count);
        const computedAt = new Date(nowMs);
        const expireAt = new Date(nowMs + GLOBAL_COLLECTION_COUNT_CACHE_TTL_MS);

        if (cacheRef) {
            try {
                await cacheRef.set({
                    kind: options.kind,
                    schemaVersion: 1,
                    total,
                    computedAt,
                    expireAt,
                    refreshedBy: options.requestedByUid || null,
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (error) {
                logger.warn(`Failed to write admin global ${options.logLabel} count cache`, error);
            }
        }

        return {
            total,
            cacheStatus: 'refreshed',
            computedAt: computedAt.toISOString(),
            expireAt: expireAt.toISOString(),
        };
    } catch (error) {
        logger.warn(`Failed to count ${options.collectionGroupId} for admin user stats`, error);
        return readStaleGlobalCollectionCount(cachedData) || {
            total: null,
            cacheStatus: 'unavailable',
            computedAt: null,
            expireAt: null,
        };
    }
}

function getGlobalEventCount(
    db: admin.firestore.Firestore,
    options: { forceRefresh?: boolean; requestedByUid?: string | null } = {}
): Promise<CountStats> {
    return getGlobalCollectionCount(db, {
        collectionGroupId: 'events',
        cacheDocId: ADMIN_EVENT_COUNTS_DOC,
        kind: 'eventCounts',
        logLabel: 'event',
        ...options,
    });
}

function getGlobalRouteCount(
    db: admin.firestore.Firestore,
    options: { forceRefresh?: boolean; requestedByUid?: string | null } = {}
): Promise<CountStats> {
    return getGlobalCollectionCount(db, {
        collectionGroupId: 'routes',
        cacheDocId: ADMIN_ROUTE_COUNTS_DOC,
        kind: 'routeCounts',
        logLabel: 'route',
        ...options,
    });
}

function emptyServiceProviderCounts(): Record<string, number> {
    return Object.fromEntries(SERVICE_CONNECTION_PROVIDERS.map(({ provider }) => [provider, 0]));
}

function readStoredConnectionCountStats(data: admin.firestore.DocumentData | undefined): StoredConnectionCountStats | null {
    if (!data) {
        return null;
    }

    const serviceUsers = data.serviceUsers;
    const mcpUsers = data.mcpUsers;
    const both = data.both;
    const providers = data.providers;
    if (
        typeof serviceUsers !== 'number' || !Number.isFinite(serviceUsers)
        || typeof mcpUsers !== 'number' || !Number.isFinite(mcpUsers)
        || typeof both !== 'number' || !Number.isFinite(both)
        || !providers || typeof providers !== 'object' || Array.isArray(providers)
    ) {
        return null;
    }

    const normalizedProviders = emptyServiceProviderCounts();
    for (const { provider } of SERVICE_CONNECTION_PROVIDERS) {
        const providerCount = (providers as Record<string, unknown>)[provider];
        if (typeof providerCount !== 'number' || !Number.isFinite(providerCount)) {
            return null;
        }
        normalizedProviders[provider] = normalizeCount(providerCount);
    }

    return {
        serviceUsers: normalizeCount(serviceUsers),
        mcpUsers: normalizeCount(mcpUsers),
        both: normalizeCount(both),
        providers: normalizedProviders,
    };
}

function toConnectionCountStats(
    stats: StoredConnectionCountStats,
    cacheStatus: NonNullable<ConnectionCountStats['cacheStatus']>,
    computedAt: string | null,
    expireAt: string | null,
): ConnectionCountStats {
    return {
        ...stats,
        cacheStatus,
        computedAt,
        expireAt,
    };
}

function readCachedConnectionCountStats(
    data: admin.firestore.DocumentData | undefined,
    nowMs: number,
): ConnectionCountStats | null {
    const stats = readStoredConnectionCountStats(data);
    const expireAtMs = toEpochMillis(data?.expireAt);
    if (!stats || expireAtMs === null || expireAtMs <= nowMs) {
        return null;
    }

    return toConnectionCountStats(
        stats,
        'fresh',
        toIsoString(data?.computedAt),
        new Date(expireAtMs).toISOString(),
    );
}

function readStaleConnectionCountStats(data: admin.firestore.DocumentData | undefined): ConnectionCountStats | null {
    const stats = readStoredConnectionCountStats(data);
    if (!stats) {
        return null;
    }

    return toConnectionCountStats(
        stats,
        'stale',
        toIsoString(data?.computedAt),
        toIsoString(data?.expireAt),
    );
}

function unavailableConnectionCountStats(): ConnectionCountStats {
    return {
        serviceUsers: null,
        mcpUsers: null,
        both: null,
        providers: emptyServiceProviderCounts(),
        cacheStatus: 'unavailable',
        computedAt: null,
        expireAt: null,
    };
}

function resolveServiceConnectionFromToken(
    document: admin.firestore.QueryDocumentSnapshot,
): { uid: string; provider: string } | null {
    const tokenRoot = document.ref.parent.parent;
    const collectionName = tokenRoot?.parent.id;
    if (!tokenRoot || !collectionName) {
        return null;
    }

    const provider = SERVICE_PROVIDER_BY_TOKEN_COLLECTION.get(collectionName);
    if (!provider) {
        return null;
    }

    return { uid: tokenRoot.id, provider };
}

function resolveMcpConnectionCandidate(
    document: admin.firestore.QueryDocumentSnapshot,
): Pick<ActiveMcpConnectionCandidate, 'uid' | 'connectionId' | 'clientId' | 'supersedesLegacy'> | null {
    const userDocument = document.ref.parent.parent;
    const data = document.data() as Record<string, unknown>;
    const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : '';
    if (!userDocument?.id || !clientId || !document.id) {
        return null;
    }

    return {
        uid: userDocument.id,
        connectionId: document.id,
        clientId,
        supersedesLegacy: data.supersedesLegacy === true,
    };
}

async function calculateConnectionCountStats(
    db: admin.firestore.Firestore,
): Promise<StoredConnectionCountStats> {
    const [tokenSnapshot, mcpConnectionSnapshot] = await Promise.all([
        db.collectionGroup('tokens').select('serviceName').get(),
        db.collectionGroup(MCP_OAUTH_COLLECTIONS.userConnections)
            .select('clientId', 'status', 'revokedAtMs', 'lastUsedAtMs', 'supersedesLegacy')
            .get(),
    ]);
    const serviceUserIds = new Set<string>();
    const serviceUserIdsByProvider = new Map<string, Set<string>>(
        SERVICE_CONNECTION_PROVIDERS.map(({ provider }) => [provider, new Set<string>()])
    );

    tokenSnapshot.docs.forEach((document) => {
        const connection = resolveServiceConnectionFromToken(document);
        if (!connection) {
            return;
        }

        serviceUserIds.add(connection.uid);
        serviceUserIdsByProvider.get(connection.provider)?.add(connection.uid);
    });

    const mcpConnectionsByUserId = new Map<string, ActiveMcpConnectionCandidate[]>();
    mcpConnectionSnapshot.docs.forEach((document) => {
        const connection = resolveMcpConnectionCandidate(document);
        if (!connection) {
            return;
        }

        const candidate: ActiveMcpConnectionCandidate = {
            ...connection,
            active: isActiveMcpConnection(document.data() as McpConnection),
        };
        const userConnections = mcpConnectionsByUserId.get(candidate.uid) || [];
        userConnections.push(candidate);
        mcpConnectionsByUserId.set(candidate.uid, userConnections);
    });

    const mcpUserIds = new Set<string>();
    mcpConnectionsByUserId.forEach((connections, userId) => {
        const supersedingClientIds = new Set(
            connections
                .filter(connection => (
                    connection.supersedesLegacy
                    && connection.connectionId === buildMcpLogicalConnectionId(connection.clientId)
                ))
                .map(connection => connection.clientId)
        );
        const hasActiveConnection = connections.some(connection => (
            connection.active
            && (
                !supersedingClientIds.has(connection.clientId)
                || connection.connectionId === buildMcpLogicalConnectionId(connection.clientId)
            )
        ));
        if (hasActiveConnection) {
            mcpUserIds.add(userId);
        }
    });

    const providers = emptyServiceProviderCounts();
    serviceUserIdsByProvider.forEach((userIds, provider) => {
        providers[provider] = userIds.size;
    });

    return {
        serviceUsers: serviceUserIds.size,
        mcpUsers: mcpUserIds.size,
        both: [...serviceUserIds].filter(userId => mcpUserIds.has(userId)).length,
        providers,
    };
}

async function getConnectionCountStats(
    db: admin.firestore.Firestore,
    requestedByUid?: string | null,
): Promise<ConnectionCountStats> {
    const nowMs = Date.now();
    const cacheRef = resolveGlobalCollectionCountCacheRef(db, ADMIN_CONNECTION_COUNTS_DOC, 'connection');
    let cachedData: admin.firestore.DocumentData | undefined;

    if (cacheRef) {
        try {
            const cacheSnapshot = await cacheRef.get();
            cachedData = cacheSnapshot.exists ? cacheSnapshot.data() : undefined;
            const cached = readCachedConnectionCountStats(cachedData, nowMs);
            if (cached) {
                return cached;
            }
        } catch (error) {
            logger.warn('Failed to read admin connection count cache', error);
        }
    }

    try {
        const stats = await calculateConnectionCountStats(db);
        const computedAt = new Date(nowMs);
        const expireAt = new Date(nowMs + GLOBAL_COLLECTION_COUNT_CACHE_TTL_MS);

        if (cacheRef) {
            try {
                await cacheRef.set({
                    kind: 'connectionCounts',
                    schemaVersion: 1,
                    ...stats,
                    computedAt,
                    expireAt,
                    refreshedBy: requestedByUid || null,
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (error) {
                logger.warn('Failed to write admin connection count cache', error);
            }
        }

        return toConnectionCountStats(stats, 'refreshed', computedAt.toISOString(), expireAt.toISOString());
    } catch (error) {
        logger.warn('Failed to calculate admin connection counts', error);
        return readStaleConnectionCountStats(cachedData) || unavailableConnectionCountStats();
    }
}

/**
 * Lists all users with pagination, search, and sorting support.
 * OPTIMIZED: Only enriches users on the current page to minimize Firestore reads.
 *
 * Performance:
 * - Firebase Auth listUsers: FREE (no Firestore reads)
 * - Search/Sort on Auth data: FREE
 * - Enrich current page only: user detail reads plus event/route count aggregations per visible user
 * - Event and route counts are display-only and are not used for sorting/filtering in v1
 */
export const listUsers = onAdminCall<ListUsersRequest, ListUsersResponse>({
    region: FUNCTIONS_MANIFEST.listUsers.region,
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (request) => {
    try {
        const data = request.data || {};
        const pageSize = clampListUsersPageSize(data.pageSize);
        const page = data.page ? parseInt(String(data.page)) : 0;
        const searchTerm = (data.searchTerm || '').toLowerCase().trim();
        const sortField = data.sortField || 'created';
        const sortDirection = data.sortDirection || 'desc';
        const filterService = data.filterService;

        // Step 0: Get Service User IDs (if filtering)
        let allowedUids: Set<string> | null = null;
        if (filterService) {
            let collectionName = '';
            switch (filterService) {
                case 'garmin':
                    collectionName = GARMIN_API_TOKENS_COLLECTION_NAME;
                    break;
                case 'suunto':
                    collectionName = SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME;
                    break;
                case 'coros':
                    collectionName = COROSAPI_ACCESS_TOKENS_COLLECTION_NAME;
                    break;
                case 'wahoo':
                    collectionName = WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME;
                    break;
            }

            if (collectionName) {
                // Optimization: getting docs with select() only fetches the ID in some SDKs,
                // but in Admin SDK it usually fetches full doc unless select() is strictly respected by the backend.
                // However, the cost is 1 read per document.
                const snapshot = await admin.firestore().collection(collectionName).select().get();
                allowedUids = new Set(snapshot.docs.map(d => d.id));
            }
        }

        // ============================================
        // STEP 1: Fetch ALL users from Firebase Auth
        // This is FREE - no Firestore reads
        // ============================================
        const allAuthUsers: BasicUser[] = [];
        let nextPageToken: string | undefined;

        do {
            const listResult = await admin.auth().listUsers(1000, nextPageToken);

            // Extract only the fields we need (minimizes memory usage)
            for (const userRecord of listResult.users) {
                const user: BasicUser = {
                    uid: userRecord.uid,
                    email: userRecord.email,
                    displayName: userRecord.displayName,
                    photoURL: userRecord.photoURL,
                    customClaims: userRecord.customClaims || {},
                    metadata: {
                        lastSignInTime: userRecord.metadata?.lastSignInTime || null,
                        creationTime: userRecord.metadata?.creationTime || null,
                    },
                    disabled: userRecord.disabled,
                    providerIds: userRecord.providerData.map(p => p.providerId)
                };

                // Filter by Service UID Set (if applicable)
                if (allowedUids && !allowedUids.has(user.uid)) {
                    continue;
                }

                allAuthUsers.push(user);
            }

            nextPageToken = listResult.pageToken;
        } while (nextPageToken);

        logger.info(`Fetched ${allAuthUsers.length} total users from Firebase Auth (0 Firestore reads)`);

        // ============================================
        // STEP 2: Apply search filter (FREE - in-memory)
        // ============================================
        let filteredUsers = allAuthUsers;
        if (searchTerm) {
            filteredUsers = allAuthUsers.filter(user => {
                const emailMatch = user.email?.toLowerCase().includes(searchTerm);
                const nameMatch = user.displayName?.toLowerCase().includes(searchTerm);
                const uidMatch = user.uid.toLowerCase().includes(searchTerm);
                return emailMatch || nameMatch || uidMatch;
            });
            logger.info(`Search "${searchTerm}" matched ${filteredUsers.length} users`);
        }

        // ============================================
        // STEP 3: Apply sorting (FREE - in-memory)
        // Note: Sorting by subscription/services not supported (would require full enrichment)
        // ============================================
        filteredUsers.sort((a, b) => {
            let aValue: string | number;
            let bValue: string | number;

            switch (sortField) {
                case 'email':
                    aValue = a.email || '';
                    bValue = b.email || '';
                    break;
                case 'displayName':
                    aValue = a.displayName || '';
                    bValue = b.displayName || '';
                    break;
                case 'role':
                    aValue = String((a.customClaims as Record<string, unknown>)?.stripeRole || 'free');
                    bValue = String((b.customClaims as Record<string, unknown>)?.stripeRole || 'free');
                    break;
                case 'admin':
                    aValue = (a.customClaims as Record<string, unknown>)?.admin ? 1 : 0;
                    bValue = (b.customClaims as Record<string, unknown>)?.admin ? 1 : 0;
                    break;
                case 'created':
                    aValue = a.metadata.creationTime ? new Date(a.metadata.creationTime).getTime() : 0;
                    bValue = b.metadata.creationTime ? new Date(b.metadata.creationTime).getTime() : 0;
                    break;
                case 'lastLogin':
                    aValue = a.metadata.lastSignInTime ? new Date(a.metadata.lastSignInTime).getTime() : 0;
                    bValue = b.metadata.lastSignInTime ? new Date(b.metadata.lastSignInTime).getTime() : 0;
                    break;
                case 'status':
                    aValue = a.disabled ? 1 : 0;
                    bValue = b.disabled ? 1 : 0;
                    break;
                case 'providerIds':
                    aValue = a.providerIds[0] || '';
                    bValue = b.providerIds[0] || '';
                    break;
                default:
                    aValue = a.metadata.creationTime ? new Date(a.metadata.creationTime).getTime() : 0;
                    bValue = b.metadata.creationTime ? new Date(b.metadata.creationTime).getTime() : 0;
            }

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                const comparison = aValue.localeCompare(bValue);
                return sortDirection === 'asc' ? comparison : -comparison;
            }

            if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        // ============================================
        // STEP 4: Slice to current page
        // ============================================
        const totalCount = filteredUsers.length;
        const startIndex = page * pageSize;
        const endIndex = startIndex + pageSize;
        const pageUsers = filteredUsers.slice(startIndex, endIndex);

        // ============================================
        // STEP 5: Enrich ONLY the current page users
        // This is the only place we read Firestore user details and run per-visible-user event counts.
        // ============================================
        const db = admin.firestore();
        const enrichedUsers = await enrichUsers(pageUsers, db);

        return {
            users: enrichedUsers,
            totalCount: totalCount,
            page: page,
            pageSize: pageSize
        };
    } catch (error: unknown) {
        logger.error('Error listing users:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to list users';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Gets the total number of users in the system, broken down by subscription status.
 * Uses optimized Aggregation Queries.
 */
export const getUserCount = onAdminCall<UserCountRequest, UserCountResponse>({
    region: FUNCTIONS_MANIFEST.getUserCount.region,
    memory: '512MiB',
}, async (request) => {
    try {
        const db = admin.firestore();
        const forceRefreshEventCount = request.data?.refreshEventCount === true;
        const forceRefreshRouteCount = request.data?.refreshRouteCount === true;

        // 1. Get stats from Firestore (subscriptions)
        // Parallel efficient count queries
        const computedAt = new Date();
        const paidLifecycleQuery = db.collectionGroup('subscriptions')
            .where('status', 'in', [...PAID_LIFECYCLE_SUBSCRIPTION_STATUSES])
            .select('role', 'status');
        const [
            userPlanActivityMetrics,
            marketingConsent,
            paidSubscriptionHistorySnapshot,
            eventStats,
            routeStats,
            connectionStats,
        ] = await Promise.all([
            collectUserPlanActivityMetrics(db, admin.auth(), computedAt),
            getMarketingConsentCount(db),
            paidLifecycleQuery.get(),
            getGlobalEventCount(db, {
                forceRefresh: forceRefreshEventCount,
                requestedByUid: request.auth?.uid || null,
            }),
            getGlobalRouteCount(db, {
                forceRefresh: forceRefreshRouteCount,
                requestedByUid: request.auth?.uid || null,
            }),
            getConnectionCountStats(db, request.auth?.uid || null),
        ]);

        const {
            total,
            pro,
            basic,
            free,
            monthlyPaid,
            yearlyPaid,
            subscriptionCadence,
            cancelScheduled,
            onboardingCompleted,
            authActivity,
            providers,
        } = userPlanActivityMetrics;
        const activePaid = pro + basic;
        const everPaid = Math.max(activePaid, countDistinctPaidSubscriptionOwners(paidSubscriptionHistorySnapshot.docs));
        const canceled = Math.max(0, everPaid - activePaid);

        return {
            count: total,
            total,
            pro,
            basic,
            free,
            monthlyPaid,
            yearlyPaid,
            subscriptionCadence,
            everPaid,
            canceled,
            cancelScheduled,
            onboardingCompleted,
            marketingConsent,
            events: eventStats,
            routes: routeStats,
            connections: connectionStats,
            authActivity,
            providers
        };
    } catch (error: unknown) {
        logger.error('Error getting user count:', error);
        throw new HttpsError('internal', 'Failed to get user count');
    }
});
