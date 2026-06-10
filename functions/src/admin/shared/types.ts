export type {
    AdminQueueStatsResponse as QueueStatsResponse,
    CloudTaskQueueStats,
    DerivedMetricsCoordinatorStats,
    DerivedMetricsFailurePreview,
    EventReparseFailurePreview,
    EventReparseStats,
    GetQueueStatsRequest,
    ReparseJobsStats,
    ReparseQueueStats,
    RouteReparseFailurePreview,
    RouteReparseJobsStats,
    RouteReparseStats,
} from '../../../../shared/admin-queue-stats';

export interface CountStats {
    total: number | null;
    cacheStatus?: 'fresh' | 'refreshed' | 'stale' | 'unavailable';
    computedAt?: string | null;
    expireAt?: string | null;
}

export type EventCountStats = CountStats;
export type RouteCountStats = CountStats;

export interface UserCountRequest {
    refreshEventCount?: boolean;
    refreshRouteCount?: boolean;
}

export interface ListUsersRequest {
    pageSize?: number;
    page?: number;
    searchTerm?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
    filterService?: 'garmin' | 'suunto' | 'coros';
}

export interface BasicUser {
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

export interface EnrichedUser extends BasicUser {
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
    eventStats: EventCountStats;
    routeStats: RouteCountStats;
}

export interface ListUsersResponse {
    users: EnrichedUser[];
    totalCount: number;
    page: number;
    pageSize: number;
}

export interface UserCountResponse {
    count: number;
    total: number;
    pro: number;
    basic: number;
    free: number;
    monthlyPaid: number;
    yearlyPaid: number;
    onboardingCompleted: number;
    events: EventCountStats;
    routes: RouteCountStats;
    providers: Record<string, number>;
}

export interface GetSubscriptionHistoryTrendRequest {
    months?: number;
}

export interface SubscriptionHistoryTrendBucket {
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

export interface SubscriptionHistoryTrendResponse {
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

export interface GetUserGrowthTrendRequest {
    months?: number;
}

export interface UserGrowthTrendBucket {
    key: string;
    label: string;
    registeredUsers: number;
    onboardedUsers: number;
}

export interface UserGrowthTrendResponse {
    months: number;
    buckets: UserGrowthTrendBucket[];
    totals: {
        registeredUsers: number;
        onboardedUsers: number;
    };
}

export interface SportsLibReparseJobDocDataBase {
    uid?: string;
    status?: string;
    attemptCount?: number;
    lastError?: string;
    terminalFailure?: boolean;
    terminalFailureAt?: unknown;
    updatedAt?: unknown;
    targetSportsLibVersion?: string;
}

export interface SportsLibReparseJobDocData extends SportsLibReparseJobDocDataBase {
    eventId?: string;
    processingTier?: string;
    heavyReason?: string;
    eventDurationMs?: number;
}

export interface SportsLibRouteReparseJobDocData extends SportsLibReparseJobDocDataBase {
    routeId?: string;
}

export interface DerivedMetricsCoordinatorDocData {
    entryType?: unknown;
    status?: unknown;
    generation?: unknown;
    dirtyMetricKinds?: unknown;
    requestedAtMs?: unknown;
    startedAtMs?: unknown;
    updatedAtMs?: unknown;
    lastError?: unknown;
}

export interface RetrySportsLibReparseHeavyJobRequest {
    jobId?: string;
}

export interface RetrySportsLibReparseHeavyJobResponse {
    success: boolean;
    jobId: string;
    taskCreated: boolean;
}

export interface SetMaintenanceModeRequest {
    enabled: boolean;
    message?: string;
    env?: 'prod' | 'beta' | 'dev';
}

export interface SetMaintenanceModeResponse {
    success: true;
    enabled: boolean;
    message: string;
    env: 'prod' | 'beta' | 'dev';
}

export interface MaintenanceStatusResponse {
    prod: {
        enabled: boolean;
        message: string;
    };
    beta: {
        enabled: boolean;
        message: string;
    };
    dev: {
        enabled: boolean;
        message: string;
    };
}

export interface ImpersonateUserRequest {
    uid: string;
}

export interface TokenResponse {
    token: string;
}

export interface FinancialStatsResponse {
    revenue: {
        total: number;
        currency: string;
        invoiceCount: number;
    };
    cost: {
        billingAccountId: string | null;
        projectId: string;
        reportUrl: string | null;
        currency: string;
        total: number | null;
        budget: { amount: number; currency: string } | null;
        advice?: string;
        lastUpdated?: unknown;
    };
}
