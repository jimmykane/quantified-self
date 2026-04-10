export interface GetQueueStatsRequest {
    includeAnalysis?: boolean;
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
    onboardingCompleted: number;
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

export interface SportsLibReparseJobDocData {
    uid?: string;
    eventId?: string;
    status?: string;
    attemptCount?: number;
    lastError?: string;
    updatedAt?: unknown;
    targetSportsLibVersion?: string;
}

export interface DerivedMetricsCoordinatorDocData {
    entryType?: unknown;
    status?: unknown;
    generation?: unknown;
    dirtyMetricKinds?: unknown;
    updatedAtMs?: unknown;
    lastError?: unknown;
}

export interface DerivedMetricsFailurePreview {
    uid: string;
    generation: number;
    dirtyMetricKinds: string[];
    lastError: string;
    updatedAtMs: number;
}

export interface DerivedMetricsCoordinatorStats {
    idle: number;
    queued: number;
    processing: number;
    failed: number;
    total: number;
}

export interface QueueStatsResponse {
    pending: number;
    succeeded: number;
    stuck: number;
    cloudTasks: {
        pending: number;
        queues: {
            workout: {
                queueId: string;
                pending: number;
            };
            sportsLibReparse: {
                queueId: string;
                pending: number;
            };
            derivedMetrics: {
                queueId: string;
                pending: number;
            };
        };
    };
    reparse: {
        queuePending: number;
        targetSportsLibVersion: string;
        jobs: {
            total: number;
            pending: number;
            processing: number;
            completed: number;
            failed: number;
        };
        checkpoint: {
            cursorEventPath: string | null;
            lastScanAt: unknown;
            lastPassStartedAt: unknown;
            lastPassCompletedAt: unknown;
            lastScanCount: number;
            lastEnqueuedCount: number;
            overrideUsersInProgress: number;
        };
        recentFailures: {
            jobId: string;
            uid: string;
            eventId: string;
            attemptCount: number;
            lastError: string;
            updatedAt: unknown;
            targetSportsLibVersion: string;
        }[];
    };
    derivedMetrics: {
        coordinators: DerivedMetricsCoordinatorStats;
        recentFailures: DerivedMetricsFailurePreview[];
    };
    providers: Array<{
        name: string;
        pending: number;
        succeeded: number;
        stuck: number;
        dead: number;
    }>;
    dlq: {
        total: number;
        byContext: { context: string; count: number }[];
        byProvider: { provider: string; count: number }[];
    } | undefined;
    advanced: {
        throughput: number;
        maxLagMs: number;
        retryHistogram: {
            '0-3': number;
            '4-7': number;
            '8-9': number;
        };
        topErrors: {
            error: string;
            count: number;
        }[];
    };
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
