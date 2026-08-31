export type {
    AdminQueueStatsResponse as QueueStatsResponse,
    CloudTaskQueueStats,
    DerivedMetricsCoordinatorStats,
    DerivedMetricsFailurePreview,
    EventReparseFailurePreview,
    EventReparseJobsStats,
    EventReparseStats,
    GetQueueStatsRequest,
    ReparseJobsStats,
    ReparseQueueStats,
    RouteReparseFailurePreview,
    RouteReparseJobsStats,
    RouteReparseStats,
    RouteSyncQueueStats,
    SetSportsLibReparseSettingsRequest,
    SetSportsLibReparseSettingsResponse,
    SportsLibReparseRuntimeSettings,
} from '../../../../shared/admin-queue-stats';

export interface CountStats {
    total: number | null;
    cacheStatus?: 'fresh' | 'refreshed' | 'stale' | 'unavailable';
    computedAt?: string | null;
    expireAt?: string | null;
}

export type EventCountStats = CountStats;
export type RouteCountStats = CountStats;

export interface ConnectionCountStats {
    serviceUsers: number | null;
    mcpUsers: number | null;
    both: number | null;
    providers: Record<string, number>;
    cacheStatus?: 'fresh' | 'refreshed' | 'stale' | 'unavailable';
    computedAt?: string | null;
    expireAt?: string | null;
}

export interface AuthActivityWindowStats {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
}

export interface AuthActivityPlanBreakdown {
    free: AuthActivityWindowStats;
    basic: AuthActivityWindowStats;
    pro: AuthActivityWindowStats;
}

export interface AuthActivityStats extends AuthActivityWindowStats {
    computedAt: string;
    byPlan: AuthActivityPlanBreakdown;
}

export interface SubscriptionCadenceTierStats {
    monthly: number;
    yearly: number;
    unknown: number;
}

export interface SubscriptionCadenceStats {
    pro: SubscriptionCadenceTierStats;
    basic: SubscriptionCadenceTierStats;
}

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
    filterService?: 'garmin' | 'suunto' | 'coros' | 'wahoo';
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
    assistantRequestsUsed: number;
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
    subscriptionCadence: SubscriptionCadenceStats;
    everPaid: number;
    canceled: number;
    cancelScheduled: number;
    onboardingCompleted: number;
    marketingConsent: number | null;
    events: EventCountStats;
    routes: RouteCountStats;
    connections: ConnectionCountStats;
    authActivity: AuthActivityStats;
    providers: Record<string, number>;
}

export type AdminDashboardHistoryDays = 30 | 90 | 365;

export interface GetAdminDashboardHistoryRequest {
    days?: AdminDashboardHistoryDays;
}

export interface AdminDashboardHistoryPoint {
    date: string;
    computedAt: string;
    users: {
        total: number;
        free: number;
        basic: number;
        pro: number;
        onboardingCompleted: number;
    };
    authActivity: {
        eligibleAccounts: number;
        last24Hours: number;
        last7Days: number;
        last30Days: number;
        byPlan: AuthActivityPlanBreakdown | null;
    };
    subscriptionCadence: SubscriptionCadenceStats;
}

export interface AdminDashboardHistoryResponse {
    days: AdminDashboardHistoryDays;
    startDate: string;
    endDate: string;
    snapshots: AdminDashboardHistoryPoint[];
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
    failureReason?: string;
    terminalFailure?: boolean;
    terminalFailureAt?: unknown;
    updatedAt?: unknown;
    enqueuedAt?: unknown;
    targetSportsLibVersion?: string;
    supersededBySportsLibVersion?: string;
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
    allowPendingStale?: boolean;
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
