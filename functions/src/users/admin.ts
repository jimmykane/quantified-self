import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../shared/auth';
import { getStripe } from '../stripe/client';
import { CloudBillingClient } from '@google-cloud/billing';
import { BudgetServiceClient } from '@google-cloud/billing-budgets';
import { BigQuery } from '@google-cloud/bigquery';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, getCloudTaskQueueDepthForQueue } from '../utils';
import { GARMIN_API_TOKENS_COLLECTION_NAME, GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME, SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { config } from '../config';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from '../reparse/sports-lib-reparse.config';
import { DERIVED_METRICS_COORDINATOR_DOC_ID, normalizeDerivedMetricKindsStrict } from '../../../shared/derived-metrics';

/**
 * Normalizes error messages by replacing dynamic values (numbers, IDs) with placeholders.
 * This allows similar errors with different dynamic data to be clustered together.
 */
function normalizeError(error: string): string {
    return error
        .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#') // Replace UUIDs first
        .replace(/[0-9a-fA-F]{24,}/g, '#') // Replace long hex IDs
        .replace(/\d+/g, '#'); // Replace remaining numbers
}

const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
const SPORTS_LIB_REPARSE_CHECKPOINT_DOC_PATH = 'systemJobs/sportsLibReparse';
const SPORTS_LIB_REPARSE_FAILURE_PREVIEW_LIMIT = 10;
const DERIVED_METRICS_FAILURE_PREVIEW_LIMIT = 10;

const DERIVED_METRICS_COORDINATOR_STATUSES = ['idle', 'queued', 'processing', 'failed'] as const;
type DerivedMetricsCoordinatorStatus = typeof DERIVED_METRICS_COORDINATOR_STATUSES[number];

interface SportsLibReparseJobDocData {
    uid?: string;
    eventId?: string;
    status?: string;
    attemptCount?: number;
    lastError?: string;
    updatedAt?: unknown;
    targetSportsLibVersion?: string;
}

interface DerivedMetricsCoordinatorDocData {
    status?: unknown;
    generation?: unknown;
    dirtyMetricKinds?: unknown;
    updatedAtMs?: unknown;
    lastError?: unknown;
}

interface DerivedMetricsFailurePreview {
    uid: string;
    generation: number;
    dirtyMetricKinds: string[];
    lastError: string;
    updatedAtMs: number;
}

interface DerivedMetricsCoordinatorStats {
    idle: number;
    queued: number;
    processing: number;
    failed: number;
    total: number;
}

function toSafeNumber(value: unknown, fallback: number = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isDerivedMetricsCoordinatorStatus(value: unknown): value is DerivedMetricsCoordinatorStatus {
    return DERIVED_METRICS_COORDINATOR_STATUSES.includes(`${value}` as DerivedMetricsCoordinatorStatus);
}

const DEFAULT_SUBSCRIPTION_HISTORY_MONTHS = 12;
const MAX_SUBSCRIPTION_HISTORY_MONTHS = 24;
const DEFAULT_LIST_USERS_PAGE_SIZE = 10;
const MAX_LIST_USERS_PAGE_SIZE = 50;
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;
const ACTIVE_SUBSCRIPTION_STATUS_SET = new Set<string>(ACTIVE_SUBSCRIPTION_STATUSES);
const SUBSCRIPTION_ROLE_BASIC = 'basic';
const SUBSCRIPTION_ROLE_PRO = 'pro';

interface GetSubscriptionHistoryTrendRequest {
    months?: number;
}

interface SubscriptionHistoryTrendBucket {
    key: string;
    label: string;
    newSubscriptions: number;
    plannedCancellations: number;
    net: number;
    basicNewSubscriptions: number;
    basicPlannedCancellations: number;
    basicNet: number;
    proNewSubscriptions: number;
    proPlannedCancellations: number;
    proNet: number;
}

interface SubscriptionHistoryTrendResponse {
    months: number;
    buckets: SubscriptionHistoryTrendBucket[];
    totals: {
        newSubscriptions: number;
        plannedCancellations: number;
        net: number;
        basicNewSubscriptions: number;
        basicPlannedCancellations: number;
        basicNet: number;
        proNewSubscriptions: number;
        proPlannedCancellations: number;
        proNet: number;
    };
}

interface GetUserGrowthTrendRequest {
    months?: number;
}

interface UserGrowthTrendBucket {
    key: string;
    label: string;
    registeredUsers: number;
    onboardedUsers: number;
}

interface UserGrowthTrendResponse {
    months: number;
    buckets: UserGrowthTrendBucket[];
    totals: {
        registeredUsers: number;
        onboardedUsers: number;
    };
}

function clampSubscriptionHistoryMonths(rawMonths: unknown): number {
    const parsed = Number(rawMonths);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_SUBSCRIPTION_HISTORY_MONTHS;
    }
    const normalized = Math.floor(parsed);
    if (normalized < 1) {
        return 1;
    }
    if (normalized > MAX_SUBSCRIPTION_HISTORY_MONTHS) {
        return MAX_SUBSCRIPTION_HISTORY_MONTHS;
    }
    return normalized;
}

function clampListUsersPageSize(rawPageSize: unknown): number {
    if (rawPageSize === null || rawPageSize === undefined || rawPageSize === '') {
        return DEFAULT_LIST_USERS_PAGE_SIZE;
    }

    const parsed = Number.parseInt(String(rawPageSize), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_LIST_USERS_PAGE_SIZE;
    }

    return Math.min(parsed, MAX_LIST_USERS_PAGE_SIZE);
}

function normalizeEpochNumberToMillis(value: number): number | null {
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    if (value > 1e12) {
        return Math.trunc(value);
    }

    if (value > 1e9) {
        return Math.trunc(value * 1000);
    }

    return null;
}

function toEpochMillis(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return normalizeEpochNumberToMillis(value);
    }

    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return normalizeEpochNumberToMillis(numeric);
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    if (value instanceof Date) {
        const parsed = value.getTime();
        return Number.isNaN(parsed) ? null : parsed;
    }

    if (typeof value === 'object') {
        const timestamp = value as {
            toMillis?: () => number;
            toDate?: () => Date;
            seconds?: unknown;
            _seconds?: unknown;
            nanoseconds?: unknown;
            _nanoseconds?: unknown;
        };

        if (typeof timestamp.toMillis === 'function') {
            const millis = timestamp.toMillis();
            return Number.isFinite(millis) ? millis : null;
        }

        if (typeof timestamp.toDate === 'function') {
            const date = timestamp.toDate();
            const millis = date.getTime();
            return Number.isFinite(millis) ? millis : null;
        }

        const rawSeconds = timestamp.seconds ?? timestamp._seconds;
        if (rawSeconds !== undefined && rawSeconds !== null) {
            const seconds = Number(rawSeconds);
            if (!Number.isFinite(seconds)) {
                return null;
            }
            const rawNanos = timestamp.nanoseconds ?? timestamp._nanoseconds;
            const nanos = Number(rawNanos);
            const extraMillis = Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0;
            return (seconds * 1000) + extraMillis;
        }
    }

    return null;
}

function toUtcMonthKey(epochMillis: number): string {
    const date = new Date(epochMillis);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function formatUtcMonthLabel(epochMillis: number): string {
    return new Date(epochMillis).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

function buildMonthlyBucketWindows(months: number, now: Date): Array<{ key: string; label: string; startMs: number; endMs: number }> {
    const currentMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    const firstMonthStartDate = new Date(currentMonthStartMs);
    firstMonthStartDate.setUTCMonth(firstMonthStartDate.getUTCMonth() - (months - 1));

    const windows: Array<{ key: string; label: string; startMs: number; endMs: number }> = [];

    for (let index = 0; index < months; index++) {
        const monthStartDate = new Date(Date.UTC(
            firstMonthStartDate.getUTCFullYear(),
            firstMonthStartDate.getUTCMonth() + index,
            1
        ));
        const nextMonthStartDate = new Date(Date.UTC(
            firstMonthStartDate.getUTCFullYear(),
            firstMonthStartDate.getUTCMonth() + index + 1,
            1
        ));
        const startMs = monthStartDate.getTime();
        windows.push({
            key: toUtcMonthKey(startMs),
            label: formatUtcMonthLabel(startMs),
            startMs,
            endMs: nextMonthStartDate.getTime()
        });
    }

    return windows;
}

interface ListUsersRequest {
    pageSize?: number;
    page?: number;
    searchTerm?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
    filterService?: 'garmin' | 'suunto' | 'coros';
}

interface BasicUser {
    uid: string;
    email: string | undefined;
    displayName: string | undefined;
    photoURL: string | undefined;
    customClaims: { [key: string]: unknown };
    metadata: {
        lastSignInTime: string | null;
        creationTime: string | null;
    };
    disabled: boolean;
    providerIds: string[];
}

interface EnrichedUser extends BasicUser {
    subscription: {
        status: string;
        current_period_end: unknown;
        cancel_at_period_end: boolean | undefined;
        stripeLink: string | undefined;
    } | null;
    connectedServices: { provider: string; connectedAt: unknown }[];
    onboardingCompleted: boolean;
    hasSubscribedOnce: boolean;
    aiCreditsConsumed: number;
}

function buildAiInsightsUsageDocIdForSubscriptionPeriod(
    periodStart: unknown,
    periodEnd: unknown
): string | null {
    const periodStartMs = toEpochMillis(periodStart);
    const periodEndMs = toEpochMillis(periodEnd);

    if (periodStartMs === null || periodEndMs === null) {
        return null;
    }

    return `period_${periodStartMs}_${periodEndMs}`;
}

function resolveAiInsightsSuccessfulRequestCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.floor(value));
}

function resolveAiCreditsConsumedFromUsageData(value: unknown): number {
    if (!value || typeof value !== 'object') {
        return 0;
    }

    return resolveAiInsightsSuccessfulRequestCount(
        (value as { successfulRequestCount?: unknown }).successfulRequestCount
    );
}

/**
 * Enrich a small batch of users with Firestore data (subscriptions, services)
 * This is the ONLY place we do Firestore reads
 */
async function enrichUsers(
    users: BasicUser[],
    db: admin.firestore.Firestore
): Promise<EnrichedUser[]> {
    const userFlagsByUid = new Map<string, { onboardingCompleted: boolean; hasSubscribedOnce: boolean }>();

    if (users.length > 0) {
        try {
            const userDocRefs = users.map(user => db.collection('users').doc(user.uid));
            const userDocs = await db.getAll(...userDocRefs);

            userDocs.forEach(snapshot => {
                const userData = snapshot.data() || {};
                userFlagsByUid.set(snapshot.id, {
                    onboardingCompleted: userData.onboardingCompleted === true,
                    hasSubscribedOnce: userData.hasSubscribedOnce === true
                });
            });
        } catch (e) {
            logger.warn('Failed to fetch onboarding flags for admin user list', e);
        }
    }

    return Promise.all(
        users.map(async (user) => {
            let subscriptionData: EnrichedUser['subscription'] = null;
            const connectedServices: { provider: string; connectedAt: unknown }[] = [];
            let aiCreditsConsumed = 0;
            let hasResolvedAiUsageFromCurrentPeriod = false;
            const hasSubscribedOnce = userFlagsByUid.get(user.uid)?.hasSubscribedOnce === true;

            try {
                const [subsSnapshot, garminDoc, suuntoSnapshot, corosSnapshot] = await Promise.all([
                    db.collection('customers')
                        .doc(user.uid)
                        .collection('subscriptions')
                        .where('status', 'in', ['active', 'trialing', 'past_due'])
                        .orderBy('created', 'desc')
                        .limit(1)
                        .get(),
                    db.collection(GARMIN_API_TOKENS_COLLECTION_NAME).doc(user.uid).collection('tokens').limit(1).get(),
                    db.collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(user.uid).collection('tokens').limit(1).get(),
                    db.collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).doc(user.uid).collection('tokens').limit(1).get()
                ]);

                if (!subsSnapshot.empty) {
                    const sub = subsSnapshot.docs[0].data();
                    subscriptionData = {
                        status: sub.status,
                        current_period_end: sub.current_period_end,
                        cancel_at_period_end: sub.cancel_at_period_end,
                        stripeLink: sub.stripeLink
                    };

                    const usageDocID = buildAiInsightsUsageDocIdForSubscriptionPeriod(
                        sub.current_period_start,
                        sub.current_period_end
                    );

                    if (usageDocID) {
                        const usageSnapshot = await db.collection('users')
                            .doc(user.uid)
                            .collection('aiInsightsUsage')
                            .doc(usageDocID)
                            .get();

                        if (usageSnapshot.exists) {
                            aiCreditsConsumed = resolveAiCreditsConsumedFromUsageData(usageSnapshot.data());
                            hasResolvedAiUsageFromCurrentPeriod = true;
                        }
                    }
                }

                if (!hasResolvedAiUsageFromCurrentPeriod && !subscriptionData && hasSubscribedOnce) {
                    try {
                        const latestUsageSnapshot = await db.collection('users')
                            .doc(user.uid)
                            .collection('aiInsightsUsage')
                            .orderBy('periodEnd', 'desc')
                            .limit(1)
                            .get();

                        if (!latestUsageSnapshot.empty) {
                            aiCreditsConsumed = resolveAiCreditsConsumedFromUsageData(
                                latestUsageSnapshot.docs[0].data()
                            );
                        }
                    } catch (fallbackUsageError) {
                        logger.warn(`Failed to fetch fallback AI usage for ${user.uid}`, fallbackUsageError);
                    }
                }

                if (!garminDoc.empty) {
                    const doc = garminDoc.docs[0];
                    const docData = doc.data();
                    connectedServices.push({ provider: 'Garmin', connectedAt: docData?.dateCreated || doc.createTime });
                }
                if (!suuntoSnapshot.empty) {
                    const doc = suuntoSnapshot.docs[0];
                    const docData = doc.data();
                    connectedServices.push({ provider: 'Suunto', connectedAt: docData?.dateCreated || doc.createTime });
                }
                if (!corosSnapshot.empty) {
                    const doc = corosSnapshot.docs[0];
                    const docData = doc.data();
                    connectedServices.push({ provider: 'COROS', connectedAt: docData?.dateCreated || doc.createTime });
                }
            } catch (e) {
                logger.warn(`Failed to fetch details for ${user.uid}`, e);
            }

            return {
                ...user,
                subscription: subscriptionData,
                connectedServices: connectedServices,
                onboardingCompleted: userFlagsByUid.get(user.uid)?.onboardingCompleted === true,
                hasSubscribedOnce,
                aiCreditsConsumed
            };
        })
    );
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
export const listUsers = onAdminCall<ListUsersRequest, any>({
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

        // Debug: Count users with photoURL

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
 * Gets the total number of users in the system.
 */
/**
 * Gets the total number of users in the system, broken down by subscription status.
 * Uses optimized Aggregation Queries.
 */
export const getUserCount = onAdminCall<void, any>({
    region: FUNCTIONS_MANIFEST.getUserCount.region,
    memory: '256MiB',
}, async () => {
    try {
        const db = admin.firestore();

        // 1. Get stats from Firestore (subscriptions)
        // Parallel efficient count queries
        const [totalSnapshot, proSnapshot, basicSnapshot, onboardedSnapshot] = await Promise.all([
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
                .count().get()
        ]);

        const total = totalSnapshot.data().count;
        const pro = proSnapshot.data().count;
        const basic = basicSnapshot.data().count;
        const activePaid = pro + basic;
        const onboardingCompleted = onboardedSnapshot.data().count;
        const free = Math.max(0, total - activePaid); // Users with no active subscription

        // 2. Get provider breakdown from Firebase Auth
        // This is done by listing ALL users. 
        // Note: For very large user bases (>100k), this should be cached or aggregated differently.
        const providerCounts: Record<string, number> = {};
        let nextPageToken: string | undefined;

        do {
            const listResult = await admin.auth().listUsers(1000, nextPageToken);
            listResult.users.forEach(userRecord => {
                // providerData contains the providers. Use first one as primary or count all?
                // Usually providerData[0].providerId is the one used for login.
                // We'll count all unique providers per user or just the primary?
                // Let's count all providers linked to accounts to see the footprint.
                const providers = userRecord.providerData.map(p => p.providerId);
                // If no providers (anonymous or just email/pass without provider data?), check providerId
                if (providers.length === 0) {
                    // Check if it's password auth
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
            count: total, // Keep for backward compatibility
            total,
            pro,
            basic,
            free,
            onboardingCompleted,
            providers: providerCounts
        };
    } catch (error: unknown) {
        logger.error('Error getting user count:', error);
        throw new HttpsError('internal', 'Failed to get user count');
    }
});

/**
 * Returns historical monthly subscription lifecycle buckets for Admin dashboards.
 * Buckets are generated in UTC and include:
 * - newSubscriptions: subscriptions created in each month
 * - plannedCancellations: subscriptions with cancel_at_period_end=true whose current_period_end falls in month
 * - net: newSubscriptions - plannedCancellations
 */
export const getSubscriptionHistoryTrend = onAdminCall<GetSubscriptionHistoryTrendRequest, SubscriptionHistoryTrendResponse>({
    region: FUNCTIONS_MANIFEST.getSubscriptionHistoryTrend.region,
    memory: '256MiB',
}, async (request) => {
    try {
        const db = admin.firestore();
        const months = clampSubscriptionHistoryMonths(request.data?.months);
        const bucketWindows = buildMonthlyBucketWindows(months, new Date());

        if (bucketWindows.length === 0) {
            return {
                months,
                buckets: [],
                totals: {
                    newSubscriptions: 0,
                    plannedCancellations: 0,
                    net: 0,
                    basicNewSubscriptions: 0,
                    basicPlannedCancellations: 0,
                    basicNet: 0,
                    proNewSubscriptions: 0,
                    proPlannedCancellations: 0,
                    proNet: 0
                }
            };
        }

        const rangeStartMs = bucketWindows[0].startMs;
        const rangeEndMs = bucketWindows[bucketWindows.length - 1].endMs;
        const rangeStartDate = new Date(rangeStartMs);
        const rangeEndDate = new Date(rangeEndMs);

        const [newSubscriptionSnapshot, plannedCancellationSnapshot] = await Promise.all([
            db.collectionGroup('subscriptions')
                .where('created', '>=', rangeStartDate)
                .where('created', '<', rangeEndDate)
                .select('created', 'role')
                .get(),
            db.collectionGroup('subscriptions')
                .where('cancel_at_period_end', '==', true)
                .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
                .where('current_period_end', '>=', rangeStartDate)
                .where('current_period_end', '<', rangeEndDate)
                .select('current_period_end', 'cancel_at_period_end', 'status', 'role')
                .get()
        ]);

        const buckets = bucketWindows.map((window) => ({
            key: window.key,
            label: window.label,
            newSubscriptions: 0,
            plannedCancellations: 0,
            net: 0,
            basicNewSubscriptions: 0,
            basicPlannedCancellations: 0,
            basicNet: 0,
            proNewSubscriptions: 0,
            proPlannedCancellations: 0,
            proNet: 0
        }));
        const bucketByKey = new Map<string, SubscriptionHistoryTrendBucket>();
        buckets.forEach(bucket => {
            bucketByKey.set(bucket.key, bucket);
        });

        newSubscriptionSnapshot.docs.forEach(doc => {
            const subscription = doc.data() as Record<string, unknown>;
            const createdAtMillis = toEpochMillis(subscription.created);
            if (createdAtMillis === null || createdAtMillis < rangeStartMs || createdAtMillis >= rangeEndMs) {
                return;
            }
            const bucket = bucketByKey.get(toUtcMonthKey(createdAtMillis));
            if (bucket) {
                bucket.newSubscriptions += 1;
                const role = `${subscription.role || ''}`.toLowerCase();
                if (role === SUBSCRIPTION_ROLE_BASIC) {
                    bucket.basicNewSubscriptions += 1;
                } else if (role === SUBSCRIPTION_ROLE_PRO) {
                    bucket.proNewSubscriptions += 1;
                }
            }
        });

        plannedCancellationSnapshot.docs.forEach(doc => {
            const subscription = doc.data() as Record<string, unknown>;
            const status = `${subscription.status || ''}`.toLowerCase();
            if (subscription.cancel_at_period_end !== true || !ACTIVE_SUBSCRIPTION_STATUS_SET.has(status)) {
                return;
            }
            const periodEndMillis = toEpochMillis(subscription.current_period_end);
            if (periodEndMillis === null || periodEndMillis < rangeStartMs || periodEndMillis >= rangeEndMs) {
                return;
            }
            const bucket = bucketByKey.get(toUtcMonthKey(periodEndMillis));
            if (bucket) {
                bucket.plannedCancellations += 1;
                const role = `${subscription.role || ''}`.toLowerCase();
                if (role === SUBSCRIPTION_ROLE_BASIC) {
                    bucket.basicPlannedCancellations += 1;
                } else if (role === SUBSCRIPTION_ROLE_PRO) {
                    bucket.proPlannedCancellations += 1;
                }
            }
        });

        let totalNewSubscriptions = 0;
        let totalPlannedCancellations = 0;
        let totalBasicNewSubscriptions = 0;
        let totalBasicPlannedCancellations = 0;
        let totalProNewSubscriptions = 0;
        let totalProPlannedCancellations = 0;
        buckets.forEach(bucket => {
            bucket.net = bucket.newSubscriptions - bucket.plannedCancellations;
            bucket.basicNet = bucket.basicNewSubscriptions - bucket.basicPlannedCancellations;
            bucket.proNet = bucket.proNewSubscriptions - bucket.proPlannedCancellations;
            totalNewSubscriptions += bucket.newSubscriptions;
            totalPlannedCancellations += bucket.plannedCancellations;
            totalBasicNewSubscriptions += bucket.basicNewSubscriptions;
            totalBasicPlannedCancellations += bucket.basicPlannedCancellations;
            totalProNewSubscriptions += bucket.proNewSubscriptions;
            totalProPlannedCancellations += bucket.proPlannedCancellations;
        });

        return {
            months,
            buckets,
            totals: {
                newSubscriptions: totalNewSubscriptions,
                plannedCancellations: totalPlannedCancellations,
                net: totalNewSubscriptions - totalPlannedCancellations,
                basicNewSubscriptions: totalBasicNewSubscriptions,
                basicPlannedCancellations: totalBasicPlannedCancellations,
                basicNet: totalBasicNewSubscriptions - totalBasicPlannedCancellations,
                proNewSubscriptions: totalProNewSubscriptions,
                proPlannedCancellations: totalProPlannedCancellations,
                proNet: totalProNewSubscriptions - totalProPlannedCancellations
            }
        };
    } catch (error: unknown) {
        logger.error('Error getting subscription history trend:', error);
        throw new HttpsError('internal', 'Failed to get subscription history trend');
    }
});

/**
 * Returns historical monthly user growth buckets for Admin dashboards.
 * Buckets are generated in UTC and include:
 * - registeredUsers: users created in each month
 * - onboardedUsers: same users where onboardingCompleted === true
 */
export const getUserGrowthTrend = onAdminCall<GetUserGrowthTrendRequest, UserGrowthTrendResponse>({
    region: FUNCTIONS_MANIFEST.getUserGrowthTrend.region,
    memory: '256MiB',
}, async (request) => {
    try {
        const db = admin.firestore();
        const months = clampSubscriptionHistoryMonths(request.data?.months);
        const bucketWindows = buildMonthlyBucketWindows(months, new Date());

        if (bucketWindows.length === 0) {
            return {
                months,
                buckets: [],
                totals: {
                    registeredUsers: 0,
                    onboardedUsers: 0
                }
            };
        }

        const rangeStartMs = bucketWindows[0].startMs;
        const rangeEndMs = bucketWindows[bucketWindows.length - 1].endMs;
        const rangeStartDate = new Date(rangeStartMs);
        const rangeEndDate = new Date(rangeEndMs);

        const userSnapshot = await db.collection('users')
            .where('creationDate', '>=', rangeStartDate)
            .where('creationDate', '<', rangeEndDate)
            .select('creationDate', 'onboardingCompleted')
            .get();

        const buckets = bucketWindows.map((window) => ({
            key: window.key,
            label: window.label,
            registeredUsers: 0,
            onboardedUsers: 0
        }));
        const bucketByKey = new Map<string, UserGrowthTrendBucket>();
        buckets.forEach(bucket => {
            bucketByKey.set(bucket.key, bucket);
        });

        userSnapshot.docs.forEach(doc => {
            const user = doc.data() as Record<string, unknown>;
            const creationDateMillis = toEpochMillis(user.creationDate);
            if (creationDateMillis === null || creationDateMillis < rangeStartMs || creationDateMillis >= rangeEndMs) {
                return;
            }

            const bucket = bucketByKey.get(toUtcMonthKey(creationDateMillis));
            if (!bucket) {
                return;
            }

            bucket.registeredUsers += 1;
            if (user.onboardingCompleted === true) {
                bucket.onboardedUsers += 1;
            }
        });

        const totals = buckets.reduce(
            (accu, bucket) => {
                accu.registeredUsers += bucket.registeredUsers;
                accu.onboardedUsers += bucket.onboardedUsers;
                return accu;
            },
            {
                registeredUsers: 0,
                onboardedUsers: 0
            }
        );

        return {
            months,
            buckets,
            totals
        };
    } catch (error: unknown) {
        logger.error('Error getting user growth trend:', error);
        throw new HttpsError('internal', 'Failed to get user growth trend');
    }
});

/**
 * Gets aggregated statistics for all workout queues.
 * Uses efficient Firestore count() queries.
 */
export const getQueueStats = onAdminCall<{ includeAnalysis?: boolean }, any>({
    region: FUNCTIONS_MANIFEST.getQueueStats.region,
    memory: '256MiB',
}, async (request) => {
    const includeAnalysis = request.data?.includeAnalysis ?? false;
    const PROVIDER_QUEUES: Record<string, string[]> = {
        'Suunto': [SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME],
        'COROS': [COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME],
        'Garmin': [GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME]
    };

    try {
        const db = admin.firestore();
        const { workoutQueue, sportsLibReparseQueue, derivedMetricsQueue } = config.cloudtasks;
        const [workoutCloudTaskDepth, sportsLibReparseCloudTaskDepth, derivedMetricsCloudTaskDepth] = await Promise.all([
            getCloudTaskQueueDepthForQueue(workoutQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${workoutQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(sportsLibReparseQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${sportsLibReparseQueue}:`, e);
                return 0;
            }),
            getCloudTaskQueueDepthForQueue(derivedMetricsQueue).catch(e => {
                logger.error(`Error getting Cloud Task depth for queue ${derivedMetricsQueue}:`, e);
                return 0;
            }),
        ]);
        const totalCloudTaskDepth = workoutCloudTaskDepth + sportsLibReparseCloudTaskDepth + derivedMetricsCloudTaskDepth;
        const reparseJobsCollection = db.collection(SPORTS_LIB_REPARSE_JOBS_COLLECTION);

        const [
            reparseTotalJobs,
            reparsePendingJobs,
            reparseProcessingJobs,
            reparseCompletedJobs,
            reparseFailedJobs,
        ] = await Promise.all([
            reparseJobsCollection.count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count total reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'pending').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count pending reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'processing').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count processing reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'completed').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count completed reparse jobs:`, e);
                return null;
            }),
            reparseJobsCollection.where('status', '==', 'failed').count().get().catch(e => {
                logger.error(`[admin/getQueueStats] Failed to count failed reparse jobs:`, e);
                return null;
            }),
        ]);

        // Querying the `meta` collection group by coordinator doc ID gives one coordinator snapshot per user.
        const derivedMetricsCoordinatorSnapshot = await db.collectionGroup('meta')
            .where(admin.firestore.FieldPath.documentId(), '==', DERIVED_METRICS_COORDINATOR_DOC_ID)
            .get()
            .catch(e => {
                // Keep queue observability available even if coordinator aggregation fails (e.g. missing index/transient read issue).
                logger.error('[admin/getQueueStats] Failed to query derived metrics coordinators:', e);
                return null;
            });

        const derivedCoordinatorCounts: DerivedMetricsCoordinatorStats = {
            idle: 0,
            queued: 0,
            processing: 0,
            failed: 0,
            total: 0,
        };
        const derivedFailures: DerivedMetricsFailurePreview[] = [];

        (derivedMetricsCoordinatorSnapshot?.docs || []).forEach((doc) => {
            const rawData = doc.data() as DerivedMetricsCoordinatorDocData;
            const rawStatus = `${rawData.status || ''}`.trim();
            const status = isDerivedMetricsCoordinatorStatus(rawStatus) ? rawStatus : null;
            const generation = Math.max(0, Math.floor(toSafeNumber(rawData.generation)));
            const updatedAtMs = Math.max(
                0,
                toEpochMillis(rawData.updatedAtMs) ?? toSafeNumber(rawData.updatedAtMs),
            );
            const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(
                Array.isArray(rawData.dirtyMetricKinds) ? rawData.dirtyMetricKinds : [],
            );
            const lastError = `${rawData.lastError || ''}`.trim();
            const uid = `${doc.ref.parent?.parent?.id || ''}`.trim();

            derivedCoordinatorCounts.total += 1;
            if (status) {
                derivedCoordinatorCounts[status] += 1;
            }

            if (status === 'failed') {
                derivedFailures.push({
                    uid,
                    generation,
                    dirtyMetricKinds,
                    lastError,
                    updatedAtMs,
                });
            }
        });

        derivedFailures.sort((left, right) => right.updatedAtMs - left.updatedAtMs);

        const checkpointSnapshot = await admin.firestore().doc(SPORTS_LIB_REPARSE_CHECKPOINT_DOC_PATH).get().catch(e => {
            logger.error('[admin/getQueueStats] Failed to read sports-lib reparse checkpoint:', e);
            return null;
        });
        const checkpointData = checkpointSnapshot?.data() as Record<string, unknown> | undefined;
        const checkpointOverrideCursors = checkpointData?.overrideCursorByUid;
        const overrideCursorByUid = (checkpointOverrideCursors && typeof checkpointOverrideCursors === 'object')
            ? (checkpointOverrideCursors as Record<string, string | null>)
            : {};
        const overrideUsersInProgress = Object.values(overrideCursorByUid).filter(cursor => !!cursor).length;

        const recentReparseJobsSnapshot = await reparseJobsCollection
            .where('status', '==', 'failed')
            .orderBy('updatedAt', 'desc')
            .limit(SPORTS_LIB_REPARSE_FAILURE_PREVIEW_LIMIT)
            .get()
            .catch(e => {
                logger.error('[admin/getQueueStats] Failed to load recent reparse jobs:', e);
                return null;
            });
        const recentReparseFailures = (recentReparseJobsSnapshot?.docs || [])
            .map(doc => ({
                data: doc.data() as SportsLibReparseJobDocData,
                jobId: doc.id,
                uid: '',
                eventId: '',
                attemptCount: 0,
                lastError: '',
                updatedAt: null as unknown,
                targetSportsLibVersion: '',
            }))
            .map(entry => ({
                jobId: entry.jobId,
                uid: `${entry.data.uid || ''}`,
                eventId: `${entry.data.eventId || ''}`,
                attemptCount: toSafeNumber(entry.data.attemptCount),
                lastError: `${entry.data.lastError || ''}`,
                updatedAt: entry.data.updatedAt || null,
                targetSportsLibVersion: `${entry.data.targetSportsLibVersion || ''}`,
            }));

        let totalPending = 0;
        let totalSucceeded = 0;
        let totalStuck = 0;
        // Advanced stats
        let totalThroughput = 0;
        let maxLagMs = 0;
        const retryHistogram = { '0-3': 0, '4-7': 0, '8-9': 0 };

        const ONE_HOUR_AGO = Date.now() - (60 * 60 * 1000);

        const providers: { name: string; pending: number; succeeded: number; stuck: number; dead: number }[] = [];

        // Map over providers to get individual and total stats
        for (const [providerName, collections] of Object.entries(PROVIDER_QUEUES)) {
            let providerPending = 0;
            let providerSucceeded = 0;
            let providerStuck = 0;

            await Promise.all(collections.map(async (collectionName) => {
                const col = db.collection(collectionName);

                // Base stats + Retry Histogram + Throughput
                const [
                    p, s, f,
                    retry0to3, retry4to7, retry8to9,
                    throughput
                ] = await Promise.all([
                    // Standard stats
                    col.where('processed', '==', false).where('retryCount', '<', 10).count().get(),
                    col.where('processed', '==', true).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 10).count().get(),

                    // Retry Histogram
                    col.where('processed', '==', false).where('retryCount', '<', 4).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 4).where('retryCount', '<', 8).count().get(),
                    col.where('processed', '==', false).where('retryCount', '>=', 8).where('retryCount', '<', 10).count().get(),

                    // Throughput (Processed in last hour)
                    col.where('processed', '==', true).where('processedAt', '>', ONE_HOUR_AGO).count().get()
                ]);

                // Max Lag (Oldest pending item)
                const oldestPendingSnap = await col.where('processed', '==', false).orderBy('dateCreated', 'asc').limit(1).get();
                if (!oldestPendingSnap.empty) {
                    const oldestDate = oldestPendingSnap.docs[0].data().dateCreated;
                    if (oldestDate) {
                        const lag = Date.now() - oldestDate;
                        if (lag > maxLagMs) maxLagMs = lag;
                    }
                }

                providerPending += p.data().count;
                providerSucceeded += s.data().count;
                providerStuck += f.data().count;

                retryHistogram['0-3'] += retry0to3.data().count;
                retryHistogram['4-7'] += retry4to7.data().count;
                retryHistogram['8-9'] += retry8to9.data().count;

                totalThroughput += throughput.data().count;
            }));

            // Get Dead/Failed count for this provider (efficient count query)
            const deadSnap = await db.collection('failed_jobs')
                .where('originalCollection', 'in', collections)
                .count()
                .get();
            const providerDead = deadSnap.data().count;

            totalPending += providerPending;
            totalSucceeded += providerSucceeded;
            totalStuck += providerStuck;

            providers.push({
                name: providerName,
                pending: providerPending,
                succeeded: providerSucceeded,
                stuck: providerStuck,
                dead: providerDead
            });
        }

        // Dead Letter Queue stats & Error Clustering (Expensive)
        let dlq: any = undefined;
        let topErrors: any[] = [];

        if (includeAnalysis) {
            const dlqCol = db.collection('failed_jobs');

            // Use limited query for clustering to save reads
            const [dlqCountSnap, dlqRecentSnap] = await Promise.all([
                dlqCol.count().get(),
                dlqCol.orderBy('failedAt', 'desc').limit(50).get()
            ]);

            const dlqByContext: Record<string, number> = {};
            const dlqByProvider: Record<string, number> = {};
            const errorCounts: Record<string, number> = {};

            dlqRecentSnap.docs.forEach(doc => {
                const data = doc.data();
                const context = data.context || 'UNKNOWN';
                const originalCollection = data.originalCollection || 'unknown';
                const errorMsg = normalizeError(data.error || 'Unknown Error');

                dlqByContext[context] = (dlqByContext[context] || 0) + 1;
                dlqByProvider[originalCollection] = (dlqByProvider[originalCollection] || 0) + 1;
                errorCounts[errorMsg] = (errorCounts[errorMsg] || 0) + 1;
            });

            dlq = {
                total: dlqCountSnap.data().count,
                byContext: Object.entries(dlqByContext).map(([context, count]) => ({ context, count })),
                byProvider: Object.entries(dlqByProvider).map(([provider, count]) => ({ provider, count }))
            };

            topErrors = Object.entries(errorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([error, count]) => ({ error, count }));
        }

        return {
            pending: totalPending,
            succeeded: totalSucceeded,
            stuck: totalStuck,
            cloudTasks: {
                pending: totalCloudTaskDepth,
                queues: {
                    workout: {
                        queueId: workoutQueue,
                        pending: workoutCloudTaskDepth,
                    },
                    sportsLibReparse: {
                        queueId: sportsLibReparseQueue,
                        pending: sportsLibReparseCloudTaskDepth,
                    },
                    derivedMetrics: {
                        queueId: derivedMetricsQueue,
                        pending: derivedMetricsCloudTaskDepth,
                    },
                },
            },
            reparse: {
                queuePending: sportsLibReparseCloudTaskDepth,
                targetSportsLibVersion: `${checkpointData?.targetSportsLibVersion || SPORTS_LIB_REPARSE_TARGET_VERSION}`,
                jobs: {
                    total: reparseTotalJobs?.data().count || 0,
                    pending: reparsePendingJobs?.data().count || 0,
                    processing: reparseProcessingJobs?.data().count || 0,
                    completed: reparseCompletedJobs?.data().count || 0,
                    failed: reparseFailedJobs?.data().count || 0,
                },
                checkpoint: {
                    cursorEventPath: checkpointData?.cursorEventPath || null,
                    lastScanAt: checkpointData?.lastScanAt || null,
                    lastPassStartedAt: checkpointData?.lastPassStartedAt || null,
                    lastPassCompletedAt: checkpointData?.lastPassCompletedAt || null,
                    lastScanCount: toSafeNumber(checkpointData?.lastScanCount),
                    lastEnqueuedCount: toSafeNumber(checkpointData?.lastEnqueuedCount),
                    overrideUsersInProgress,
                },
                recentFailures: recentReparseFailures,
            },
            derivedMetrics: {
                coordinators: derivedCoordinatorCounts,
                recentFailures: derivedFailures.slice(0, DERIVED_METRICS_FAILURE_PREVIEW_LIMIT),
            },
            providers,
            dlq,
            advanced: {
                throughput: totalThroughput, // Per hour
                maxLagMs,
                retryHistogram,
                topErrors
            }
        };
    } catch (error: unknown) {
        logger.error('Error getting queue stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get queue statistics';
        throw new HttpsError('internal', errorMessage);
    }
});

interface SetMaintenanceModeRequest {
    enabled: boolean;
    message?: string;
    env?: 'prod' | 'beta' | 'dev';
}

/**
 * Sets the maintenance mode status using Firebase Remote Config Parameter Groups.
 * Remote Config is the single source of truth for maintenance state.
 * Each environment (prod, beta, dev) has its own parameters within the 'maintenance' group.
 */
export const setMaintenanceMode = onAdminCall<SetMaintenanceModeRequest, any>({
    region: FUNCTIONS_MANIFEST.setMaintenanceMode.region,
    memory: '256MiB',
}, async (request) => {
    try {
        const data = request.data;
        const env = data.env || 'prod';
        const msg = data.message || "";

        const rc = admin.remoteConfig();
        const template = await rc.getTemplate();

        // Initialize parameterGroups if not exists
        template.parameterGroups = template.parameterGroups || {};

        // Create or get the 'maintenance' parameter group
        const groupKey = 'maintenance';
        if (!template.parameterGroups[groupKey]) {
            template.parameterGroups[groupKey] = {
                description: 'Maintenance mode settings for each environment',
                parameters: {}
            };
        }

        const group = template.parameterGroups[groupKey];

        // Set the enabled parameter for this environment
        group.parameters[`${env}_enabled`] = {
            defaultValue: { value: String(data.enabled) },
            description: `Maintenance mode enabled for ${env}`,
            valueType: 'BOOLEAN' as any
        };

        // Set the message parameter for this environment
        group.parameters[`${env}_message`] = {
            defaultValue: { value: msg },
            description: `Maintenance message for ${env}`,
            valueType: 'STRING' as any
        };



        // Validate and publish
        await rc.validateTemplate(template);
        await rc.publishTemplate(template);

        logger.info(`Maintenance mode [${env}] ${data.enabled ? 'ENABLED' : 'DISABLED'} by ${request.auth!.uid}`);

        return {
            success: true,
            enabled: data.enabled,
            message: msg,
            env
        };
    } catch (error: unknown) {
        logger.error('Error setting maintenance mode:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to set maintenance mode';
        throw new HttpsError('internal', errorMessage);
    }
});
/**
 * Gets the current maintenance mode status from Remote Config Parameter Groups.
 */
export const getMaintenanceStatus = onAdminCall<void, any>({
    region: FUNCTIONS_MANIFEST.getMaintenanceStatus.region,
    memory: '256MiB',
}, async () => {
    try {
        const rc = admin.remoteConfig();
        const template = await rc.getTemplate();

        // Read from the 'maintenance' parameter group
        const groupKey = 'maintenance';
        const group = template.parameterGroups?.[groupKey];
        const params = group?.parameters || {};

        const getStatusData = (env: string) => {
            const enabledParam = params[`${env}_enabled`];
            const messageParam = params[`${env}_message`];

            // Get enabled value
            let enabled = false;
            if (enabledParam?.defaultValue && 'value' in enabledParam.defaultValue) {
                enabled = enabledParam.defaultValue.value === 'true';
            }

            // Get message
            let message = "";
            if (messageParam?.defaultValue && 'value' in messageParam.defaultValue) {
                message = messageParam.defaultValue.value || "";
            }

            return { enabled, message };
        };

        return {
            prod: getStatusData('prod'),
            beta: getStatusData('beta'),
            dev: getStatusData('dev')
        };
    } catch (error: unknown) {
        logger.error('Error getting maintenance status:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get maintenance status';
        throw new HttpsError('internal', errorMessage);
    }
});


/**
 * Impersonates a user by generating a custom token.
 * This allows an admin to sign in as the target user.
 * 
 * SECURITY: Critical function. Only strictly verified admins can call this.
 */
export const impersonateUser = onAdminCall<{ uid: string }, { token: string }>({
    region: FUNCTIONS_MANIFEST.impersonateUser.region,
    memory: '256MiB',
}, async (request) => {
    const targetUid = request.data.uid;
    if (!targetUid || typeof targetUid !== 'string') {
        throw new HttpsError('invalid-argument', 'The function must be called with a valid user UID.');
    }

    try {
        // 3. Generate Custom Token
        // detailed claims are optional but good for future security rules
        const additionalClaims = {
            impersonatedBy: request.auth!.uid
        };

        const customToken = await admin.auth().createCustomToken(targetUid, additionalClaims);

        logger.info(`Admin ${request.auth!.uid} is impersonating user ${targetUid}`);

        return {
            token: customToken
        };

    } catch (error: unknown) {
        logger.error('Error creating impersonation token:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to create token';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Ends an impersonation session and restores the original admin account.
 *
 * This relies on the `impersonatedBy` claim that was attached to the
 * impersonated user's custom token when the session started.
 */
export const stopImpersonation = onCall({
    region: FUNCTIONS_MANIFEST.stopImpersonation.region,
    memory: '256MiB',
    cors: ALLOWED_CORS_ORIGINS,
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const adminUid = request.auth.token.impersonatedBy;
    if (typeof adminUid !== 'string' || adminUid.length === 0) {
        throw new HttpsError('permission-denied', 'The current session is not impersonating another user.');
    }

    const auth = admin.auth();

    try {
        const adminUser = await auth.getUser(adminUid);
        if (adminUser.disabled || adminUser.customClaims?.admin !== true) {
            throw new HttpsError('permission-denied', 'The original admin session is no longer eligible for restoration.');
        }
    } catch (error: unknown) {
        if (error instanceof HttpsError) {
            throw error;
        }

        logger.warn(`Unable to load original admin ${adminUid} while ending impersonation for ${request.auth.uid}`, error);
        throw new HttpsError('permission-denied', 'The original admin session is no longer available.');
    }

    try {
        const customToken = await auth.createCustomToken(adminUid);
        logger.info(`User ${request.auth.uid} ended impersonation and returned to admin ${adminUid}`);
        return {
            token: customToken
        };
    } catch (error: unknown) {
        logger.error('Error creating admin restoration token:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to create token';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Gets financial statistics for the current month.
 * - Revenue: Calculated from Stripe Invoices (Total - Tax)
 * - Cost: Links to GCP Cloud Billing Report (since API doesn't provide live spend safely)
 */
export const getFinancialStats = onAdminCall<void, any>({
    region: FUNCTIONS_MANIFEST.getFinancialStats.region,
    memory: '256MiB',
}, async () => {
    try {
        const envCurrency = process.env.GCP_BILLING_CURRENCY?.toLowerCase();
        // Initialize with undefined/null so we know it's not detected yet
        const stats = {
            revenue: {
                total: 0,
                currency: envCurrency as string,
                invoiceCount: 0
            },
            cost: {
                billingAccountId: null as string | null,
                projectId: process.env.GCLOUD_PROJECT || '',
                reportUrl: null as string | null,
                currency: envCurrency as string,
                total: process.env.GCP_BILLING_SPEND ? Number(process.env.GCP_BILLING_SPEND) : null as number | null,
                budget: process.env.GCP_BILLING_BUDGET
                    ? { amount: Number(process.env.GCP_BILLING_BUDGET), currency: envCurrency as string }
                    : null as { amount: number; currency: string } | null,
                advice: 'To automate cost tracking, enable "Billing Export to BigQuery" in the GCP Console.'
            }
        };

        // --- 1. Get Valid Products from Firestore ---
        // We only count revenue if the product ID exists in the `products` collection.
        const productsSnapshot = await admin.firestore().collection('products').get();
        const validProductIds = new Set(productsSnapshot.docs.map(doc => doc.id));

        // --- 2. Calculate Revenue (Stripe) ---
        // Sum of PAID invoice line items where product is in validProductIds
        const stripe = await getStripe();
        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

        // Fetch paid invoices
        let hasMore = true;
        let lastId: string | undefined;
        let totalCents = 0;
        let detectedCurrency: string | undefined = envCurrency;
        let count = 0;

        while (hasMore) {
            const invoices = await stripe.invoices.list({
                limit: 100,
                starting_after: lastId,
                created: { gte: startTimestamp },
                status: 'paid',
            });

            for (const invoice of invoices.data) {
                if (!detectedCurrency && invoice.currency) detectedCurrency = invoice.currency.toLowerCase();

                const amountPaid = invoice.amount_paid || 0;
                // Use any type to access potentially missing/complex Stripe fields
                const taxAmount = (invoice as any).tax || 0;
                const netAmount = amountPaid - taxAmount;

                // Check if the invoice contains valid products
                let hasValidProduct = false;
                const lineItems = invoice.lines?.data || [];
                for (const line of lineItems) {
                    const price = (line as any).price;
                    const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;

                    if (productId && validProductIds.has(productId)) {
                        hasValidProduct = true;
                        break;
                    }
                }

                if (hasValidProduct) {
                    totalCents += netAmount;
                    count++;
                }
            }

            hasMore = invoices.has_more;
            if (hasMore && invoices.data.length > 0) {
                lastId = invoices.data[invoices.data.length - 1].id;
            }
        }

        stats.revenue.total = totalCents;
        // Final fallback for revenue if nothing detected: eur (local project default) > usd
        stats.revenue.currency = detectedCurrency || 'eur';
        stats.revenue.invoiceCount = count;

        // If GCP cost currency is still not detected, inherit from revenue
        if (!stats.cost.currency) {
            stats.cost.currency = stats.revenue.currency;
            if (stats.cost.budget) {
                stats.cost.budget.currency = stats.revenue.currency;
            }
        }

        // --- 3. Get GCP Billing Info ---
        const billingClient = new CloudBillingClient();
        const budgetClient = new BudgetServiceClient();
        const projectIdForBilling = process.env.GCLOUD_PROJECT;
        const projectName = `projects/${projectIdForBilling}`;

        try {
            const [info] = await billingClient.getProjectBillingInfo({ name: projectName });

            if (info.billingAccountName) {
                // billingAccountName format: "billingAccounts/XXXXXX-XXXXXX-XXXXXX"
                const id = info.billingAccountName.split('/').pop();
                stats.cost.billingAccountId = id || null;

                if (id) {
                    // Generate direct link to reports
                    stats.cost.reportUrl = `https://console.cloud.google.com/billing/${id}/reports;project=${projectIdForBilling}`;

                    // Fetch Billing Account details for currency
                    try {
                        const [billingAccount] = await billingClient.getBillingAccount({ name: info.billingAccountName });
                        if (billingAccount.currencyCode) {
                            stats.cost.currency = billingAccount.currencyCode.toLowerCase();
                            // Update budget and spend currency if they were defaulted
                            if (stats.cost.budget) stats.cost.budget.currency = stats.cost.currency;
                        }
                    } catch (e: any) {
                        logger.warn(`Failed to fetch billing account details (permission required for service account):`, {
                            error: e.message,
                            billingAccount: info.billingAccountName,
                            suggestion: 'Grant "Billing Account Viewer" to the Cloud Functions service account.'
                        });
                    }

                    // Fetch Budgets (only if not manually overridden)
                    if (!process.env.GCP_BILLING_BUDGET) {
                        try {
                            const [budgets] = await budgetClient.listBudgets({ parent: info.billingAccountName });
                            if (budgets && budgets.length > 0) {
                                // Find the first budget with a specified amount
                                const budgetWithAmount = budgets.find(b => b.amount?.specifiedAmount);
                                if (budgetWithAmount && budgetWithAmount.amount?.specifiedAmount) {
                                    stats.cost.budget = {
                                        amount: Number(budgetWithAmount.amount.specifiedAmount.units || 0) * 100 +
                                            Math.floor((budgetWithAmount.amount.specifiedAmount.nanos || 0) / 10000000),
                                        currency: (budgetWithAmount.amount.specifiedAmount.currencyCode || stats.cost.currency).toLowerCase()
                                    };
                                }
                            }
                        } catch (e: any) {
                            logger.warn('Failed to fetch budgets:', e.message);
                        }
                    }

                    // --- 4. Fetch Actual Spend via BigQuery ---
                    // User provided: Project: billing-administration-gr, Dataset: all_billing_data
                    const bqProjectId = 'billing-administration-gr';
                    const bqDatasetId = 'all_billing_data';

                    try {
                        const bigquery = new BigQuery({ projectId: bqProjectId });

                        // 1. Find the table name dynamically (it changes based on export config)
                        const [tables] = await bigquery.dataset(bqDatasetId).getTables();
                        const exportTable = tables.find(t => t.id && t.id.startsWith('gcp_billing_export_v1_'));

                        if (exportTable) {
                            const tableName = exportTable.id;
                            logger.info(`Found BigQuery export table: ${tableName}`);
                            const fullTableName = `\`${bqProjectId}.${bqDatasetId}.${tableName}\``;

                            // 2. Query for current usage month's cost.
                            // We intentionally filter by usage timestamps, not invoice.month, so dashboard
                            // numbers align with Cloud Billing usage-based reports for the same month.
                            const query = `
                                SELECT 
                                    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) as total_cost,
                                    MAX(usage_end_time) as last_updated,
                                    ANY_VALUE(currency) as currency,
                                    COUNT(DISTINCT currency) as currency_count
                                FROM ${fullTableName} 
                                WHERE DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
                                AND DATE(usage_start_time) < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH)
                                AND project.id = @projectId
                            `;

                            const options = {
                                query,
                                location: 'EU',
                                params: { projectId: projectIdForBilling }
                            };

                            const [rows] = await bigquery.query(options);

                            // Successfully connected to BigQuery export - clear the advice message
                            (stats.cost as any).advice = undefined;

                            if (rows && rows.length > 0) {
                                const row = rows[0];
                                // Convert to cents for frontend compatibility
                                stats.cost.total = (row.total_cost || 0) * 100;
                                (stats.cost as any).lastUpdated = row.last_updated?.value || row.last_updated;
                                logger.info(`Calculated total cost: ${stats.cost.total} ${row.currency}, last updated: ${stats.cost as any}.lastUpdated`);
                                if (Number(row.currency_count || 0) > 1) {
                                    logger.warn(`Multiple currencies detected in billing export for project ${projectIdForBilling}; total may not be directly comparable`, {
                                        currencyCount: row.currency_count
                                    });
                                }
                                if (row.currency) {
                                    stats.cost.currency = row.currency.toLowerCase();
                                }
                            }
                        } else {
                            logger.warn(`No table found starting with 'gcp_billing_export_v1_' in dataset ${bqDatasetId}`);
                        }
                    } catch (bqError: any) {
                        logger.warn('Failed to query BigQuery for billing stats:', bqError.message);
                    }
                }
            }
        } catch (e: any) {
            logger.warn('Failed to fetch project billing info (likely permission denied):', e.message);
        }

        return stats;

    } catch (error: any) {
        logger.error('Error getting financial stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get financial stats';
        throw new HttpsError('internal', errorMessage);
    }
});
