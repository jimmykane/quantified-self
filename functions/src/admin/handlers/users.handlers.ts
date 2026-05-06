import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../../shared/auth';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../../coros/constants';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import {
    ACTIVE_SUBSCRIPTION_STATUSES,
    SUBSCRIPTION_INTERVAL_MONTH,
    SUBSCRIPTION_INTERVAL_YEAR
} from '../shared/subscription.constants';
import { clampListUsersPageSize } from '../shared/date.utils';
import { enrichUsers } from '../shared/user-enrichment';
import { BasicUser, ListUsersRequest, ListUsersResponse, UserCountResponse } from '../shared/types';
import {
    EVENT_STATS_COLLECTION_ID,
    EVENT_STATS_KIND,
    EVENT_STATS_SCHEMA_VERSION,
    normalizeEventStatsCounts,
    type EventStatsCounts,
} from '../../../../shared/event-stats';

const resolveSubscriptionInterval = (subscription: Record<string, unknown>): string | null => {
    const items = Array.isArray(subscription.items) ? subscription.items : [];
    const firstItem = items.length > 0 && typeof items[0] === 'object' && items[0] !== null
        ? items[0] as Record<string, unknown>
        : null;

    if (!firstItem) {
        return null;
    }

    const plan = typeof firstItem.plan === 'object' && firstItem.plan !== null
        ? firstItem.plan as Record<string, unknown>
        : null;
    if (typeof plan?.interval === 'string') {
        return plan.interval;
    }

    const price = typeof firstItem.price === 'object' && firstItem.price !== null
        ? firstItem.price as Record<string, unknown>
        : null;
    const recurring = typeof price?.recurring === 'object' && price.recurring !== null
        ? price.recurring as Record<string, unknown>
        : null;
    if (typeof recurring?.interval === 'string') {
        return recurring.interval;
    }

    return null;
};

interface GlobalEventStats extends EventStatsCounts {
    backfilledUsers: number;
}

async function getGlobalEventStats(db: admin.firestore.Firestore): Promise<GlobalEventStats> {
    try {
        const snapshot = await db.collectionGroup(EVENT_STATS_COLLECTION_ID)
            .where('kind', '==', EVENT_STATS_KIND)
            .where('schemaVersion', '==', EVENT_STATS_SCHEMA_VERSION)
            .where('backfilledAt', '!=', null)
            .aggregate({
                backfilledUsers: admin.firestore.AggregateField.count(),
                total: admin.firestore.AggregateField.sum('total'),
                standard: admin.firestore.AggregateField.sum('standard'),
                benchmark: admin.firestore.AggregateField.sum('benchmark'),
            })
            .get();

        const data = snapshot.data() as Record<string, unknown>;
        return {
            ...normalizeEventStatsCounts(data),
            backfilledUsers: typeof data.backfilledUsers === 'number' && Number.isFinite(data.backfilledUsers)
                ? Math.max(0, data.backfilledUsers)
                : 0,
        };
    } catch (error) {
        logger.warn('Failed to aggregate event stats for admin user count', error);
        return { total: 0, standard: 0, benchmark: 0, backfilledUsers: 0 };
    }
}

/**
 * Lists all users with pagination, search, and sorting support.
 * OPTIMIZED: Only enriches users on the current page to minimize Firestore reads.
 *
 * Performance:
 * - Firebase Auth listUsers: FREE (no Firestore reads)
 * - Search/Sort on Auth data: FREE
 * - Enrich current page only: ~5-7 reads per user (onboarding, subscription, service tokens, AI usage with fallback lookup)
 * - For pageSize=10: ~50-70 Firestore reads total
 */
export const listUsers = onAdminCall<ListUsersRequest, ListUsersResponse>({
    region: FUNCTIONS_MANIFEST.listUsers.region,
    memory: '256MiB',
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
        // This is the ONLY place we do Firestore reads!
        // ~4 reads per user = ~40 reads for pageSize=10
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
export const getUserCount = onAdminCall<void, UserCountResponse>({
    region: FUNCTIONS_MANIFEST.getUserCount.region,
    memory: '256MiB',
}, async () => {
    try {
        const db = admin.firestore();

        // 1. Get stats from Firestore (subscriptions)
        // Parallel efficient count queries
        const [totalSnapshot, proSnapshot, basicSnapshot, onboardedSnapshot, eventStats] = await Promise.all([
            db.collection('users').count().get(),
            db.collectionGroup('subscriptions')
                .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
                .where('role', '==', 'pro')
                .count().get(),
            db.collectionGroup('subscriptions')
                .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
                .where('role', '==', 'basic')
                .count().get(),
            db.collection('users')
                .where('onboardingCompleted', '==', true)
                .count().get(),
            getGlobalEventStats(db)
        ]);

        const total = totalSnapshot.data().count;
        const pro = proSnapshot.data().count;
        const basic = basicSnapshot.data().count;
        const activePaid = pro + basic;
        const onboardingCompleted = onboardedSnapshot.data().count;
        const free = Math.max(0, total - activePaid);

        let monthlyPaid = 0;
        let yearlyPaid = 0;

        if (activePaid > 0) {
            const activeSubscriptionSnapshot = await db.collectionGroup('subscriptions')
                .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
                .select('items')
                .get();

            activeSubscriptionSnapshot.docs.forEach((doc) => {
                const subscription = doc.data() as Record<string, unknown>;
                const interval = resolveSubscriptionInterval(subscription);
                if (interval === SUBSCRIPTION_INTERVAL_MONTH) {
                    monthlyPaid += 1;
                } else if (interval === SUBSCRIPTION_INTERVAL_YEAR) {
                    yearlyPaid += 1;
                }
            });
        }

        const unknownCadencePaid = Math.max(0, activePaid - monthlyPaid - yearlyPaid);

        if (unknownCadencePaid > 0) {
            logger.warn('Detected active paid subscriptions without supported monthly/yearly cadence.', {
                unknownCadencePaid,
                activePaid,
                monthlyPaid,
                yearlyPaid
            });
        }

        // 2. Get provider breakdown from Firebase Auth
        const providerCounts: Record<string, number> = {};
        let nextPageToken: string | undefined;

        do {
            const listResult = await admin.auth().listUsers(1000, nextPageToken);
            listResult.users.forEach(userRecord => {
                const providers = userRecord.providerData.map(p => p.providerId);
                if (providers.length === 0) {
                    providerCounts['password'] = (providerCounts['password'] || 0) + 1;
                } else {
                    providers.forEach(p => {
                        providerCounts[p] = (providerCounts[p] || 0) + 1;
                    });
                }
            });
            nextPageToken = listResult.pageToken;
        } while (nextPageToken);

        return {
            count: total,
            total,
            pro,
            basic,
            free,
            monthlyPaid,
            yearlyPaid,
            onboardingCompleted,
            events: {
                total: eventStats.total,
                standard: eventStats.standard,
                benchmark: eventStats.benchmark,
            },
            eventsBackfilled: eventStats.backfilledUsers >= total,
            providers: providerCounts
        };
    } catch (error: unknown) {
        logger.error('Error getting user count:', error);
        throw new HttpsError('internal', 'Failed to get user count');
    }
});
