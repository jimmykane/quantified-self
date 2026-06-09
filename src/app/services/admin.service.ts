import { inject, Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore } from 'app/firebase/firestore';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppFunctionsService } from './app.functions.service';

export interface CountStats {
    total: number | null;
    cacheStatus?: 'fresh' | 'refreshed' | 'stale' | 'unavailable';
    computedAt?: string | null;
    expireAt?: string | null;
}

export type EventCountStats = CountStats;
export type RouteCountStats = CountStats;

export interface GetTotalUserCountOptions {
    refreshEventCount?: boolean;
    refreshRouteCount?: boolean;
}

export interface AdminUser {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    onboardingCompleted?: boolean;
    customClaims: {
        stripeRole?: string;
        admin?: boolean;
        [key: string]: any;
    };
    metadata: {
        lastSignInTime: string;
        creationTime: string;
    };
    disabled: boolean;
    providerIds: string[];
    subscription?: {
        status: string;
        current_period_end?: { seconds: number; nanoseconds: number } | string;
        cancel_at_period_end?: boolean;
        stripeLink?: string;
    };
    connectedServices?: {
        provider: string;
        connectedAt?: { seconds: number; nanoseconds: number } | string | number | null;
    }[];
    hasSubscribedOnce?: boolean;
    aiCreditsConsumed?: number;
    eventStats?: EventCountStats;
    routeStats?: RouteCountStats;
}

export interface ListUsersParams {
    page?: number;
    pageSize?: number;
    searchTerm?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
    filterService?: 'garmin' | 'suunto' | 'coros';
}

export interface ListUsersResponse {
    users: AdminUser[];
    totalCount: number;
    page: number;
    pageSize: number;
}

export interface UserCountStats {
    total: number;
    pro: number;
    basic: number;
    free: number;
    monthlyPaid: number;
    yearlyPaid: number;
    everPaid: number;
    canceled: number;
    cancelScheduled: number;
    onboardingCompleted: number;
    providers: Record<string, number>;
    events: EventCountStats;
    routes: RouteCountStats;
}

interface UserCountFunctionResponse {
    count: number;
    total: number;
    pro: number;
    basic: number;
    free: number;
    monthlyPaid?: number;
    yearlyPaid?: number;
    everPaid?: number;
    canceled?: number;
    cancelScheduled?: number;
    onboardingCompleted?: number;
    providers: Record<string, number>;
    events?: Partial<EventCountStats>;
    routes?: Partial<RouteCountStats>;
}

export interface SubscriptionHistoryTrendBucket {
    key: string;
    label: string;
    newSubscriptions: number;
    plannedCancellations: number;
    net: number;
    basicNewSubscriptions?: number;
    basicPlannedCancellations?: number;
    basicNet?: number;
    proNewSubscriptions?: number;
    proPlannedCancellations?: number;
    proNet?: number;
}

export interface SubscriptionHistoryTrendResponse {
    months: number;
    buckets: SubscriptionHistoryTrendBucket[];
    totals: {
        newSubscriptions: number;
        plannedCancellations: number;
        net: number;
        basicNewSubscriptions?: number;
        basicPlannedCancellations?: number;
        basicNet?: number;
        proNewSubscriptions?: number;
        proPlannedCancellations?: number;
        proNet?: number;
    };
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

export interface DLQStats {
    total: number;
    byContext: { context: string; count: number }[];
    byProvider: { provider: string; count: number }[];
}

export interface ReparseCheckpointStats {
    cursorEventPath: string | null;
    lastScanAt: unknown;
    lastPassStartedAt: unknown;
    lastPassCompletedAt: unknown;
    lastScanCount: number;
    lastEnqueuedCount: number;
    overrideUsersInProgress: number;
}

export interface ReparseJobsStats {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

export interface ReparseFailurePreview {
    jobId: string;
    uid: string;
    eventId: string;
    attemptCount: number;
    lastError: string;
    updatedAt: unknown;
    targetSportsLibVersion: string;
    processingTier?: string;
    heavyReason?: string;
    eventDurationMs?: number | null;
}

export interface RouteReparseFailurePreview {
    jobId: string;
    uid: string;
    routeId: string;
    attemptCount: number;
    lastError: string;
    updatedAt: unknown;
    targetSportsLibVersion: string;
}

export interface ReparseStats {
    queuePending: number;
    targetSportsLibVersion: string;
    jobs: ReparseJobsStats;
    checkpoint: ReparseCheckpointStats;
    recentFailures: ReparseFailurePreview[];
}

export interface RouteReparseStats {
    queuePending: number;
    targetSportsLibVersion: string;
    jobs: ReparseJobsStats & {
        skipped?: number;
    };
    checkpoint: Omit<ReparseCheckpointStats, 'cursorEventPath'> & {
        cursorProcessingDocPath: string | null;
        cursorProcessingVersionCode: number | null;
    };
    recentFailures: RouteReparseFailurePreview[];
}

export interface DerivedMetricsCoordinatorStats {
    idle: number;
    queued: number;
    processing: number;
    staleQueued?: number;
    staleProcessing?: number;
    failed: number;
    total: number;
}

export interface DerivedMetricsFailurePreview {
    uid: string;
    generation: number;
    dirtyMetricKinds: string[];
    lastError: string;
    updatedAtMs: number;
}

export interface DerivedMetricsStats {
    coordinators: DerivedMetricsCoordinatorStats;
    recentFailures: DerivedMetricsFailurePreview[];
}

export interface QueueStats {
    pending: number;
    succeeded: number;
    stuck: number;
    cloudTasks?: {
        pending: number;
        queues?: {
            workout?: {
                queueId: string;
                pending: number;
            };
            activitySync?: {
                queueId: string;
                pending: number;
            };
            sportsLibReparse?: {
                queueId: string;
                pending: number;
            };
            sportsLibReparseHeavy?: {
                queueId: string;
                pending: number;
            };
            sportsLibRouteReparse?: {
                queueId: string;
                pending: number;
            };
            derivedMetrics?: {
                queueId: string;
                pending: number;
            };
            sleepSync?: {
                queueId: string;
                pending: number;
            };
        };
    };
    providers: {
        name: string;
        pending: number;
        succeeded: number;
        stuck: number;
        dead: number;
    }[];
    dlq?: DLQStats;
    reparse?: ReparseStats;
    routeReparse?: RouteReparseStats;
    derivedMetrics?: DerivedMetricsStats;
    advanced?: {
        throughput: number;
        maxLagMs: number;
        retryHistogram: { '0-3': number; '4-7': number; '8-9': number };
        topErrors: { error: string; count: number }[];
    };
    activitySync?: {
        pending: number;
        succeeded: number;
        stuck: number;
        dead: number;
        dlqByContext: { context: string; count: number }[];
        advanced: {
            throughput: number;
            maxLagMs: number;
            retryHistogram: { '0-3': number; '4-7': number; '8-9': number };
            topErrors: { error: string; count: number }[];
        };
    };
    sleepSync?: {
        pending: number;
        succeeded: number;
        providerDisabled: number;
        stuck: number;
        dead: number;
        disabledProviders: string[];
        providers: {
            provider: string;
            pending: number;
            succeeded: number;
            providerDisabled: number;
            stuck: number;
            dead: number;
        }[];
        dlqByContext: { context: string; count: number }[];
        advanced: {
            throughput: number;
            maxLagMs: number;
            retryHistogram: { '0-3': number; '4-7': number; '8-9': number };
            topErrors: { error: string; count: number }[];
        };
    };
}

export interface FinancialStats {
    revenue: {
        total: number; // in cents
        currency: string;
        invoiceCount: number;
    };
    cost: {
        billingAccountId: string | null;
        projectId: string;
        reportUrl: string | null;
        currency: string;
        total: number | null;
        lastUpdated?: string;
        budget: { amount: number; currency: string } | null;
        advice?: string;
    };
}

export interface RetrySportsLibReparseHeavyJobResponse {
    success: boolean;
    jobId: string;
    taskCreated: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class AdminService {
    private functionsService = inject(AppFunctionsService);
    private firestore = inject(Firestore);
    private injector = inject(EnvironmentInjector);

    getUsers(params: ListUsersParams = {}): Observable<ListUsersResponse> {
        return from(this.functionsService.call<ListUsersParams, ListUsersResponse>('listUsers', {
            page: params.page ?? 0,
            pageSize: params.pageSize ?? 25,
            searchTerm: params.searchTerm,
            sortField: params.sortField,
            sortDirection: params.sortDirection,
            filterService: params.filterService
        })).pipe(
            map(result => result.data)
        );
    }

    getQueueStats(includeAnalysis = true): Observable<QueueStats> {
        return from(this.functionsService.call<{ includeAnalysis?: boolean }, QueueStats>('getQueueStats', { includeAnalysis })).pipe(
            map(result => result.data)
        );
    }

    retrySportsLibReparseHeavyJob(jobId: string): Observable<RetrySportsLibReparseHeavyJobResponse> {
        return from(this.functionsService.call<{ jobId: string }, RetrySportsLibReparseHeavyJobResponse>(
            'retrySportsLibReparseHeavyJob',
            { jobId }
        )).pipe(
            map(result => result.data)
        );
    }

    getTotalUserCount(options: GetTotalUserCountOptions = {}): Observable<UserCountStats> {
        const payload = {
            ...(options.refreshEventCount === true ? { refreshEventCount: true } : {}),
            ...(options.refreshRouteCount === true ? { refreshRouteCount: true } : {}),
        };
        const hasPayload = Object.keys(payload).length > 0;

        const request = hasPayload
            ? this.functionsService.call<GetTotalUserCountOptions, UserCountFunctionResponse>('getUserCount', payload)
            : this.functionsService.call<void, UserCountFunctionResponse>('getUserCount');

        return from(request).pipe(
            map(result => {
                const events = this.mapCountStats(result.data.events);
                const routes = this.mapCountStats(result.data.routes);

                return {
                    total: result.data.total ?? result.data.count, // Fallback for safety
                    pro: result.data.pro ?? 0,
                    basic: result.data.basic ?? 0,
                    free: result.data.free ?? 0,
                    monthlyPaid: result.data.monthlyPaid ?? 0,
                    yearlyPaid: result.data.yearlyPaid ?? 0,
                    everPaid: result.data.everPaid ?? 0,
                    canceled: result.data.canceled ?? 0,
                    cancelScheduled: result.data.cancelScheduled ?? 0,
                    onboardingCompleted: result.data.onboardingCompleted ?? 0,
                    providers: result.data.providers || {},
                    events,
                    routes,
                };
            })
        );
    }

    private mapCountStats(stats: Partial<CountStats> | undefined): CountStats {
        const mapped: CountStats = {
            total: typeof stats?.total === 'number'
                ? stats.total
                : null,
        };
        if (stats?.cacheStatus) {
            mapped.cacheStatus = stats.cacheStatus;
        }
        if (stats && Object.prototype.hasOwnProperty.call(stats, 'computedAt')) {
            mapped.computedAt = stats.computedAt ?? null;
        }
        if (stats && Object.prototype.hasOwnProperty.call(stats, 'expireAt')) {
            mapped.expireAt = stats.expireAt ?? null;
        }
        return mapped;
    }

    getSubscriptionHistoryTrend(months = 12): Observable<SubscriptionHistoryTrendResponse> {
        const parsedMonths = Number(months);
        const boundedMonths = Number.isFinite(parsedMonths)
            ? Math.min(24, Math.max(1, Math.floor(parsedMonths)))
            : 12;

        return from(this.functionsService.call<{ months: number }, SubscriptionHistoryTrendResponse>('getSubscriptionHistoryTrend', {
            months: boundedMonths
        })).pipe(
            map(result => result.data)
        );
    }

    getUserGrowthTrend(months = 12): Observable<UserGrowthTrendResponse> {
        const parsedMonths = Number(months);
        const boundedMonths = Number.isFinite(parsedMonths)
            ? Math.min(24, Math.max(1, Math.floor(parsedMonths)))
            : 12;

        return from(this.functionsService.call<{ months: number }, UserGrowthTrendResponse>('getUserGrowthTrend', {
            months: boundedMonths
        })).pipe(
            map(result => result.data)
        );
    }

    getFinancialStats(): Observable<FinancialStats> {
        return from(this.functionsService.call<void, FinancialStats>('getFinancialStats')).pipe(
            map(result => result.data)
        );
    }

    setMaintenanceMode(enabled: boolean, message: string, env: 'prod' | 'beta' | 'dev'): Observable<{ success: boolean; enabled: boolean; message: string; env: 'prod' | 'beta' | 'dev' }> {
        return from(this.functionsService.call<
            { enabled: boolean; message?: string; env?: 'prod' | 'beta' | 'dev' },
            { success: boolean; enabled: boolean; message: string; env: 'prod' | 'beta' | 'dev' }
        >('setMaintenanceMode', { enabled, message, env })).pipe(
            map(result => result.data)
        );
    }

    getMaintenanceStatus(): Observable<{
        prod: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
        beta: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
        dev: { enabled: boolean; message: string; updatedAt?: unknown; updatedBy?: string };
    }> {
        return from(this.functionsService.call<void, any>('getMaintenanceStatus')).pipe(
            map(result => result.data)
        );
    }

    impersonateUser(uid: string): Observable<{ token: string }> {
        return from(this.functionsService.call<{ uid: string }, { token: string }>('impersonateUser', { uid })).pipe(
            map(result => result.data)
        );
    }
}
