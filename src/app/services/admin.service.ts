import { inject, Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppFunctionsService } from './app.functions.service';

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
    everPaid: number;
    canceled: number;
    cancelScheduled: number;
    onboardingCompleted: number;
    providers: Record<string, number>;
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
}

export interface ReparseStats {
    queuePending: number;
    targetSportsLibVersion: string;
    jobs: ReparseJobsStats;
    checkpoint: ReparseCheckpointStats;
    recentFailures: ReparseFailurePreview[];
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
            sportsLibReparse?: {
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
    advanced?: {
        throughput: number;
        maxLagMs: number;
        retryHistogram: { '0-3': number; '4-7': number; '8-9': number };
        topErrors: { error: string; count: number }[];
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

    getTotalUserCount(): Observable<UserCountStats> {
        return from(this.functionsService.call<void, {
            count: number;
            total: number;
            pro: number;
            basic: number;
            free: number;
            everPaid?: number;
            canceled?: number;
            cancelScheduled?: number;
            onboardingCompleted?: number;
            providers: Record<string, number>;
        }>('getUserCount')).pipe(
            map(result => ({
                total: result.data.total ?? result.data.count, // Fallback for safety
                pro: result.data.pro ?? 0,
                basic: result.data.basic ?? 0,
                free: result.data.free ?? 0,
                everPaid: result.data.everPaid ?? 0,
                canceled: result.data.canceled ?? 0,
                cancelScheduled: result.data.cancelScheduled ?? 0,
                onboardingCompleted: result.data.onboardingCompleted ?? 0,
                providers: result.data.providers || {}
            }))
        );
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
