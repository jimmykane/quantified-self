import type * as admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import * as logger from 'firebase-functions/logger';
import {
    ACTIVE_SUBSCRIPTION_STATUSES,
    SUBSCRIPTION_INTERVAL_MONTH,
    SUBSCRIPTION_INTERVAL_YEAR,
    SUBSCRIPTION_ROLE_BASIC,
    SUBSCRIPTION_ROLE_PRO,
} from './subscription.constants';
import { toEpochMillis } from './date.utils';
import type {
    AuthActivityPlanBreakdown,
    AuthActivityStats,
    AuthActivityWindowStats,
    SubscriptionCadenceStats,
} from './types';

const AUTH_ACTIVITY_WINDOW_MS = {
    last24Hours: 24 * 60 * 60 * 1000,
    last7Days: 7 * 24 * 60 * 60 * 1000,
    last30Days: 30 * 24 * 60 * 60 * 1000,
} as const;

interface AuthActivityUserRecord {
    uid: string;
    disabled?: boolean;
    customClaims?: Record<string, unknown>;
    metadata?: {
        lastSignInTime?: unknown;
        lastRefreshTime?: unknown;
    };
    providerData?: Array<{ providerId: string }>;
}

export interface SubscriptionDocumentSnapshotLike {
    id?: string;
    ref?: {
        path?: string;
    } | null;
    data: () => Record<string, unknown>;
}

interface CanonicalSubscriptionIdentity {
    ownerId: string;
    subscriptionId: string;
}

interface CanonicalSubscriptionCandidate extends CanonicalSubscriptionIdentity {
    createdAtMs: number | null;
    data: Record<string, unknown>;
}

type ActivePaidPlan = 'basic' | 'pro';

interface ResolvedActivePaidSubscriptions {
    summary: ActivePaidSubscriptionSummary;
    planByOwner: ReadonlyMap<string, ActivePaidPlan>;
}

export interface ActivePaidSubscriptionSummary {
    pro: number;
    basic: number;
    monthlyPaid: number;
    yearlyPaid: number;
    subscriptionCadence: SubscriptionCadenceStats;
    cancelScheduled: number;
    ignoredNonCanonicalDocuments: number;
    duplicateCanonicalDocuments: number;
}

export interface UserPlanActivityMetrics {
    total: number;
    pro: number;
    basic: number;
    free: number;
    monthlyPaid: number;
    yearlyPaid: number;
    subscriptionCadence: SubscriptionCadenceStats;
    cancelScheduled: number;
    onboardingCompleted: number;
    authActivity: AuthActivityStats;
    eligibleAccounts: number;
    providers: Record<string, number>;
}

function resolveSubscriptionInterval(subscription: Record<string, unknown>): string | null {
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
    return typeof recurring?.interval === 'string' ? recurring.interval : null;
}

export function getCanonicalSubscriptionIdentity(
    document: SubscriptionDocumentSnapshotLike,
): CanonicalSubscriptionIdentity | null {
    const path = document.ref?.path;
    if (typeof path !== 'string') {
        return null;
    }

    const segments = path.split('/');
    if (
        segments.length !== 4
        || segments[0] !== 'customers'
        || !segments[1]
        || segments[2] !== 'subscriptions'
        || !segments[3]
    ) {
        return null;
    }

    return {
        ownerId: segments[1],
        subscriptionId: segments[3],
    };
}

function shouldReplaceSubscriptionCandidate(
    current: CanonicalSubscriptionCandidate,
    candidate: CanonicalSubscriptionCandidate,
): boolean {
    const currentCreatedAtMs = current.createdAtMs ?? Number.NEGATIVE_INFINITY;
    const candidateCreatedAtMs = candidate.createdAtMs ?? Number.NEGATIVE_INFINITY;
    if (candidateCreatedAtMs !== currentCreatedAtMs) {
        return candidateCreatedAtMs > currentCreatedAtMs;
    }

    return candidate.subscriptionId.localeCompare(current.subscriptionId) > 0;
}

function resolveActivePaidSubscriptions(
    documents: SubscriptionDocumentSnapshotLike[],
): ResolvedActivePaidSubscriptions {
    const latestSubscriptionByOwner = new Map<string, CanonicalSubscriptionCandidate>();
    let cancelScheduled = 0;
    let ignoredNonCanonicalDocuments = 0;
    let duplicateCanonicalDocuments = 0;

    documents.forEach((document) => {
        const identity = getCanonicalSubscriptionIdentity(document);
        if (!identity) {
            ignoredNonCanonicalDocuments += 1;
            return;
        }

        const data = document.data();
        if (data.cancel_at_period_end === true) {
            cancelScheduled += 1;
        }
        if (data.role !== SUBSCRIPTION_ROLE_PRO && data.role !== SUBSCRIPTION_ROLE_BASIC) {
            return;
        }

        const candidate: CanonicalSubscriptionCandidate = {
            ...identity,
            createdAtMs: toEpochMillis(data.created),
            data,
        };
        const current = latestSubscriptionByOwner.get(identity.ownerId);
        if (!current) {
            latestSubscriptionByOwner.set(identity.ownerId, candidate);
            return;
        }

        duplicateCanonicalDocuments += 1;
        if (shouldReplaceSubscriptionCandidate(current, candidate)) {
            latestSubscriptionByOwner.set(identity.ownerId, candidate);
        }
    });

    let pro = 0;
    let basic = 0;
    let monthlyPaid = 0;
    let yearlyPaid = 0;
    const planByOwner = new Map<string, ActivePaidPlan>();
    const subscriptionCadence: SubscriptionCadenceStats = {
        pro: { monthly: 0, yearly: 0, unknown: 0 },
        basic: { monthly: 0, yearly: 0, unknown: 0 },
    };

    latestSubscriptionByOwner.forEach(({ data }, ownerId) => {
        const plan: ActivePaidPlan = data.role === SUBSCRIPTION_ROLE_PRO ? 'pro' : 'basic';
        planByOwner.set(ownerId, plan);
        const tierCadence = data.role === SUBSCRIPTION_ROLE_PRO
            ? subscriptionCadence.pro
            : subscriptionCadence.basic;
        if (data.role === SUBSCRIPTION_ROLE_PRO) {
            pro += 1;
        } else {
            basic += 1;
        }

        const interval = resolveSubscriptionInterval(data);
        if (interval === SUBSCRIPTION_INTERVAL_MONTH) {
            monthlyPaid += 1;
            tierCadence.monthly += 1;
        } else if (interval === SUBSCRIPTION_INTERVAL_YEAR) {
            yearlyPaid += 1;
            tierCadence.yearly += 1;
        } else {
            tierCadence.unknown += 1;
        }
    });

    return {
        summary: {
            pro,
            basic,
            monthlyPaid,
            yearlyPaid,
            subscriptionCadence,
            cancelScheduled,
            ignoredNonCanonicalDocuments,
            duplicateCanonicalDocuments,
        },
        planByOwner,
    };
}

export function summarizeActivePaidSubscriptions(
    documents: SubscriptionDocumentSnapshotLike[],
): ActivePaidSubscriptionSummary {
    return resolveActivePaidSubscriptions(documents).summary;
}

function createEmptyAuthActivityWindows(): AuthActivityWindowStats {
    return {
        last24Hours: 0,
        last7Days: 0,
        last30Days: 0,
    };
}

function createEmptyAuthActivityPlanBreakdown(): AuthActivityPlanBreakdown {
    return {
        free: createEmptyAuthActivityWindows(),
        basic: createEmptyAuthActivityWindows(),
        pro: createEmptyAuthActivityWindows(),
    };
}

function incrementAuthActivityWindow(
    stats: AuthActivityWindowStats,
    window: keyof AuthActivityWindowStats,
): void {
    stats[window] += 1;
}

function recordAuthActivity(
    stats: AuthActivityStats,
    userRecord: AuthActivityUserRecord,
    computedAtMs: number,
    planByOwner: ReadonlyMap<string, ActivePaidPlan>,
): boolean {
    if (userRecord.disabled === true || userRecord.customClaims?.admin === true) {
        return false;
    }

    const activityTimes = [
        toEpochMillis(userRecord.metadata?.lastSignInTime),
        toEpochMillis(userRecord.metadata?.lastRefreshTime),
    ].filter((value): value is number => value !== null && value <= computedAtMs);
    if (activityTimes.length === 0) {
        return true;
    }

    const latestActivityMs = Math.max(...activityTimes);
    const plan = planByOwner.get(userRecord.uid) ?? 'free';
    const planStats = stats.byPlan[plan];
    if (latestActivityMs >= computedAtMs - AUTH_ACTIVITY_WINDOW_MS.last24Hours) {
        incrementAuthActivityWindow(stats, 'last24Hours');
        incrementAuthActivityWindow(planStats, 'last24Hours');
    }
    if (latestActivityMs >= computedAtMs - AUTH_ACTIVITY_WINDOW_MS.last7Days) {
        incrementAuthActivityWindow(stats, 'last7Days');
        incrementAuthActivityWindow(planStats, 'last7Days');
    }
    if (latestActivityMs >= computedAtMs - AUTH_ACTIVITY_WINDOW_MS.last30Days) {
        incrementAuthActivityWindow(stats, 'last30Days');
        incrementAuthActivityWindow(planStats, 'last30Days');
    }
    return true;
}

async function collectAuthenticationMetrics(
    auth: Auth,
    computedAt: Date,
    planByOwnerPromise: Promise<ReadonlyMap<string, ActivePaidPlan>>,
): Promise<{
    authActivity: AuthActivityStats;
    eligibleAccounts: number;
    providers: Record<string, number>;
}> {
    const computedAtMs = computedAt.getTime();
    const authActivity: AuthActivityStats = {
        last24Hours: 0,
        last7Days: 0,
        last30Days: 0,
        computedAt: computedAt.toISOString(),
        byPlan: createEmptyAuthActivityPlanBreakdown(),
    };
    const providers: Record<string, number> = {};
    let eligibleAccounts = 0;
    const [planByOwner, firstPage] = await Promise.all([
        planByOwnerPromise,
        auth.listUsers(1000, undefined),
    ]);
    let listResult = firstPage;

    while (true) {
        listResult.users.forEach((userRecord) => {
            if (recordAuthActivity(authActivity, userRecord, computedAtMs, planByOwner)) {
                eligibleAccounts += 1;
            }

            const providerIds = userRecord.providerData.map(provider => provider.providerId);
            if (providerIds.length === 0) {
                providers['password'] = (providers['password'] || 0) + 1;
                return;
            }
            providerIds.forEach((providerId) => {
                providers[providerId] = (providers[providerId] || 0) + 1;
            });
        });
        if (!listResult.pageToken) {
            break;
        }
        listResult = await auth.listUsers(1000, listResult.pageToken);
    }

    return { authActivity, eligibleAccounts, providers };
}

export async function collectUserPlanActivityMetrics(
    db: admin.firestore.Firestore,
    auth: Auth,
    computedAt: Date = new Date(),
): Promise<UserPlanActivityMetrics> {
    // Resolve every query before starting reads. Besides keeping the query shape
    // explicit, this prevents an invalid query construction from leaving already
    // started read promises unobserved.
    const totalQuery = db.collection('users').count();
    const onboardedQuery = db.collection('users')
        .where('onboardingCompleted', '==', true)
        .count();
    const activeSubscriptionQuery = db.collectionGroup('subscriptions')
        .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
        .select('items', 'cancel_at_period_end', 'role', 'created');

    const activeSubscriptionResolutionPromise = activeSubscriptionQuery.get()
        .then(snapshot => resolveActivePaidSubscriptions(snapshot.docs));
    const authenticationMetricsPromise = collectAuthenticationMetrics(
        auth,
        computedAt,
        activeSubscriptionResolutionPromise.then(resolution => resolution.planByOwner),
    );

    const [
        totalSnapshot,
        onboardedSnapshot,
        activeSubscriptionResolution,
        authenticationMetrics,
    ] = await Promise.all([
        totalQuery.get(),
        onboardedQuery.get(),
        activeSubscriptionResolutionPromise,
        authenticationMetricsPromise,
    ]);

    const total = totalSnapshot.data().count;
    const subscriptionSummary = activeSubscriptionResolution.summary;
    const {
        pro,
        basic,
        monthlyPaid,
        yearlyPaid,
        subscriptionCadence,
        cancelScheduled,
        ignoredNonCanonicalDocuments,
        duplicateCanonicalDocuments,
    } = subscriptionSummary;
    const activePaid = pro + basic;
    const onboardingCompleted = onboardedSnapshot.data().count;
    const free = Math.max(0, total - activePaid);

    if (ignoredNonCanonicalDocuments > 0) {
        logger.warn('Ignored non-canonical active subscription documents while collecting admin metrics.', {
            ignoredDocumentCount: ignoredNonCanonicalDocuments,
        });
    }
    if (duplicateCanonicalDocuments > 0) {
        logger.warn('Deduplicated multiple active subscriptions while collecting admin plan metrics.', {
            duplicateDocumentCount: duplicateCanonicalDocuments,
        });
    }

    const unknownCadencePaid = Math.max(0, activePaid - monthlyPaid - yearlyPaid);
    if (unknownCadencePaid > 0) {
        logger.warn('Detected active paid subscriptions without supported monthly/yearly cadence.', {
            unknownCadencePaid,
            activePaid,
            monthlyPaid,
            yearlyPaid,
        });
    }

    return {
        total,
        pro,
        basic,
        free,
        monthlyPaid,
        yearlyPaid,
        subscriptionCadence,
        cancelScheduled,
        onboardingCompleted,
        ...authenticationMetrics,
    };
}

export const adminUserMetricsTestInternals = {
    collectAuthenticationMetrics,
};
