import { inject, Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore } from 'app/firebase/firestore';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppFunctionsService } from './app.functions.service';
import type {
    AdminQueueStatsSnapshot,
    EventReparseFailurePreview,
    GetQueueStatsRequest,
    RouteReparseFailurePreview,
    SetSportsLibReparseSettingsRequest,
    SetSportsLibReparseSettingsResponse,
} from '../../../shared/admin-queue-stats';
import type {
    GrantAdminSubscriptionGiftRequest,
    GrantAdminSubscriptionGiftResponse,
    PreviewAdminSubscriptionGiftRequest,
    PreviewAdminSubscriptionGiftResponse,
} from '../../../shared/admin-subscription-gifts';

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

export type AuthActivityWindowKey = 'last24Hours' | 'last7Days' | 'last30Days';

export interface AuthActivityWindowStats {
    last24Hours: number | null;
    last7Days: number | null;
    last30Days: number | null;
}

export interface AuthActivityPlanBreakdown {
    free: AuthActivityWindowStats;
    basic: AuthActivityWindowStats;
    pro: AuthActivityWindowStats;
}

export interface AuthActivityStats extends AuthActivityWindowStats {
    computedAt: string | null;
    byPlan: AuthActivityPlanBreakdown | null;
}

export interface SubscriptionCadenceTierStats {
    monthly: number | null;
    yearly: number | null;
    unknown: number | null;
}

export interface SubscriptionCadenceStats {
    pro: SubscriptionCadenceTierStats;
    basic: SubscriptionCadenceTierStats;
}

export type AdminDashboardHistoryDays = 30 | 90 | 365;

export interface AdminDashboardHistoryCadenceTierStats {
    monthly: number;
    yearly: number;
    unknown: number;
}

export interface AdminDashboardHistoryAuthActivityWindowStats {
    last24Hours: number;
    last7Days: number;
    last30Days: number;
}

export interface AdminDashboardHistoryAuthActivityPlanBreakdown {
    free: AdminDashboardHistoryAuthActivityWindowStats;
    basic: AdminDashboardHistoryAuthActivityWindowStats;
    pro: AdminDashboardHistoryAuthActivityWindowStats;
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
        byPlan: AdminDashboardHistoryAuthActivityPlanBreakdown | null;
    };
    subscriptionCadence: {
        pro: AdminDashboardHistoryCadenceTierStats;
        basic: AdminDashboardHistoryCadenceTierStats;
    };
}

export interface AdminDashboardHistoryResponse {
    days: AdminDashboardHistoryDays;
    startDate: string;
    endDate: string;
    snapshots: AdminDashboardHistoryPoint[];
}

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
    assistantRequestsUsed?: number;
    eventStats?: EventCountStats;
    routeStats?: RouteCountStats;
}

export interface ListUsersParams {
    page?: number;
    pageSize?: number;
    searchTerm?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
    filterService?: 'garmin' | 'suunto' | 'coros' | 'wahoo';
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
    subscriptionCadence?: SubscriptionCadenceStats;
    everPaid: number;
    canceled: number;
    cancelScheduled: number;
    onboardingCompleted: number;
    marketingConsent: number | null;
    providers: Record<string, number>;
    events: EventCountStats;
    routes: RouteCountStats;
    connections?: ConnectionCountStats;
    authActivity?: AuthActivityStats;
}

interface UserCountFunctionResponse {
    count: number;
    total: number;
    pro: number;
    basic: number;
    free: number;
    monthlyPaid?: number;
    yearlyPaid?: number;
    subscriptionCadence?: unknown;
    everPaid?: number;
    canceled?: number;
    cancelScheduled?: number;
    onboardingCompleted?: number;
    marketingConsent?: number;
    providers: Record<string, number>;
    events?: Partial<EventCountStats>;
    routes?: Partial<RouteCountStats>;
    connections?: Partial<ConnectionCountStats>;
    authActivity?: unknown;
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

export type QueueStats = AdminQueueStatsSnapshot;
export type ReparseFailurePreview = EventReparseFailurePreview;
export type { RouteReparseFailurePreview };

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

export interface MaintenanceEnvironmentStatus {
    enabled: boolean;
    message: string;
    updatedAt?: unknown;
    updatedBy?: string;
}

export interface MaintenanceStatus {
    prod: MaintenanceEnvironmentStatus;
    beta: MaintenanceEnvironmentStatus;
    dev: MaintenanceEnvironmentStatus;
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

    previewSubscriptionGift(
        request: PreviewAdminSubscriptionGiftRequest,
    ): Observable<PreviewAdminSubscriptionGiftResponse> {
        return from(this.functionsService.call<PreviewAdminSubscriptionGiftRequest, PreviewAdminSubscriptionGiftResponse>(
            'previewAdminSubscriptionGift',
            request,
        )).pipe(map(result => result.data));
    }

    grantSubscriptionGift(
        request: GrantAdminSubscriptionGiftRequest,
    ): Observable<GrantAdminSubscriptionGiftResponse> {
        return from(this.functionsService.call<GrantAdminSubscriptionGiftRequest, GrantAdminSubscriptionGiftResponse>(
            'grantAdminSubscriptionGift',
            request,
        )).pipe(map(result => result.data));
    }

    getQueueStats(includeAnalysis = true): Observable<QueueStats> {
        return from(this.functionsService.call<GetQueueStatsRequest, QueueStats>('getQueueStats', { includeAnalysis })).pipe(
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

    setSportsLibReparseSettings(
        enabled: boolean,
        targetUid: string | null,
        confirmGlobal = false
    ): Observable<SetSportsLibReparseSettingsResponse> {
        const payload: SetSportsLibReparseSettingsRequest = {
            enabled,
            targetUid,
            ...(confirmGlobal ? { confirmGlobal: true } : {}),
        };
        return from(this.functionsService.call<
            SetSportsLibReparseSettingsRequest,
            SetSportsLibReparseSettingsResponse
        >('setSportsLibReparseSettings', payload)).pipe(
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
                const authActivity = this.mapAuthActivityStats(result.data.authActivity);
                const subscriptionCadence = this.mapSubscriptionCadenceStats(result.data.subscriptionCadence);

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
                    marketingConsent: this.mapNonNegativeInteger(result.data.marketingConsent),
                    providers: result.data.providers || {},
                    events,
                    routes,
                    ...(result.data.connections ? {
                        connections: this.mapConnectionCountStats(result.data.connections),
                    } : {}),
                    ...(authActivity ? {
                        authActivity,
                    } : {}),
                    ...(subscriptionCadence ? {
                        subscriptionCadence,
                    } : {}),
                };
            })
        );
    }

    getAdminDashboardHistory(days: AdminDashboardHistoryDays = 365): Observable<AdminDashboardHistoryResponse> {
        return from(this.functionsService.call<{ days: AdminDashboardHistoryDays }, unknown>(
            'getAdminDashboardHistory',
            { days }
        )).pipe(
            map(result => this.mapAdminDashboardHistoryResponse(result.data, days))
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

    private mapNonNegativeInteger(value: unknown): number | null {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
            ? value
            : null;
    }

    private mapConnectionCountStats(stats: Partial<ConnectionCountStats>): ConnectionCountStats {
        const providers: Record<string, number> = {};
        if (stats.providers && typeof stats.providers === 'object') {
            Object.entries(stats.providers).forEach(([provider, count]) => {
                if (typeof count === 'number' && Number.isFinite(count)) {
                    providers[provider] = Math.max(0, Math.floor(count));
                }
            });
        }

        const mapped: ConnectionCountStats = {
            serviceUsers: typeof stats.serviceUsers === 'number' && Number.isFinite(stats.serviceUsers)
                ? Math.max(0, Math.floor(stats.serviceUsers))
                : null,
            mcpUsers: typeof stats.mcpUsers === 'number' && Number.isFinite(stats.mcpUsers)
                ? Math.max(0, Math.floor(stats.mcpUsers))
                : null,
            both: typeof stats.both === 'number' && Number.isFinite(stats.both)
                ? Math.max(0, Math.floor(stats.both))
                : null,
            providers,
        };
        if (stats.cacheStatus) {
            mapped.cacheStatus = stats.cacheStatus;
        }
        if (Object.prototype.hasOwnProperty.call(stats, 'computedAt')) {
            mapped.computedAt = stats.computedAt ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(stats, 'expireAt')) {
            mapped.expireAt = stats.expireAt ?? null;
        }
        return mapped;
    }

    private mapAuthActivityStats(stats: unknown): AuthActivityStats | undefined {
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
            return undefined;
        }

        const rawStats = stats as Record<string, unknown>;
        const mapCount = (value: unknown): number | null => (
            typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
                ? value
                : null
        );
        const computedAt = typeof rawStats['computedAt'] === 'string'
            && !Number.isNaN(Date.parse(rawStats['computedAt']))
            ? rawStats['computedAt']
            : null;
        const last24Hours = mapCount(rawStats['last24Hours']);
        const last7Days = mapCount(rawStats['last7Days']);
        const last30Days = mapCount(rawStats['last30Days']);
        const hasInvalidWindowOrdering = (
            (last24Hours !== null && last7Days !== null && last24Hours > last7Days)
            || (last7Days !== null && last30Days !== null && last7Days > last30Days)
            || (last24Hours !== null && last30Days !== null && last24Hours > last30Days)
        );

        return {
            last24Hours: hasInvalidWindowOrdering ? null : last24Hours,
            last7Days: hasInvalidWindowOrdering ? null : last7Days,
            last30Days: hasInvalidWindowOrdering ? null : last30Days,
            computedAt,
            byPlan: hasInvalidWindowOrdering
                ? null
                : this.mapAuthActivityPlanBreakdown(rawStats['byPlan'], {
                    last24Hours,
                    last7Days,
                    last30Days,
                }),
        };
    }

    private mapAuthActivityPlanBreakdown(
        value: unknown,
        totals: AuthActivityWindowStats,
    ): AuthActivityPlanBreakdown | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        if (Object.values(totals).some(count => count === null)) {
            return null;
        }

        const rawBreakdown = value as Record<string, unknown>;
        const mapTier = (plan: 'free' | 'basic' | 'pro'): AuthActivityWindowStats | null => {
            const rawTier = rawBreakdown[plan];
            if (!rawTier || typeof rawTier !== 'object' || Array.isArray(rawTier)) {
                return null;
            }
            const tier = rawTier as Record<string, unknown>;
            const mapCount = (count: unknown): number | null => (
                typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null
            );
            const mappedTier = {
                last24Hours: mapCount(tier['last24Hours']),
                last7Days: mapCount(tier['last7Days']),
                last30Days: mapCount(tier['last30Days']),
            };
            if (
                Object.values(mappedTier).some(count => count === null)
                || (mappedTier.last24Hours ?? 0) > (mappedTier.last7Days ?? 0)
                || (mappedTier.last7Days ?? 0) > (mappedTier.last30Days ?? 0)
            ) {
                return null;
            }
            return mappedTier;
        };

        const free = mapTier('free');
        const basic = mapTier('basic');
        const pro = mapTier('pro');
        if (!free || !basic || !pro) {
            return null;
        }
        const breakdown = { free, basic, pro };
        const reconciles = (window: AuthActivityWindowKey) => (
            free[window]! + basic[window]! + pro[window]! === totals[window]
        );
        return reconciles('last24Hours') && reconciles('last7Days') && reconciles('last30Days')
            ? breakdown
            : null;
    }

    private mapSubscriptionCadenceStats(stats: unknown): SubscriptionCadenceStats | undefined {
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
            return undefined;
        }

        const rawStats = stats as Record<string, unknown>;
        const mapTier = (value: unknown): SubscriptionCadenceTierStats => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return { monthly: null, yearly: null, unknown: null };
            }
            const rawTier = value as Record<string, unknown>;
            const mapCount = (count: unknown): number | null => (
                typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
                    ? count
                    : null
            );
            return {
                monthly: mapCount(rawTier['monthly']),
                yearly: mapCount(rawTier['yearly']),
                unknown: mapCount(rawTier['unknown']),
            };
        };

        return {
            pro: mapTier(rawStats['pro']),
            basic: mapTier(rawStats['basic']),
        };
    }

    private mapAdminDashboardHistoryResponse(
        value: unknown,
        expectedDays: AdminDashboardHistoryDays
    ): AdminDashboardHistoryResponse {
        const response = requireRecord(value, 'response');
        const days = requireHistoryDays(response['days']);
        if (days !== expectedDays) {
            throw new Error('Admin dashboard history range does not match the request.');
        }

        const startDate = requireUtcDateKey(response['startDate'], 'startDate');
        const endDate = requireUtcDateKey(response['endDate'], 'endDate');
        const actualRangeMs = Date.parse(`${endDate}T00:00:00.000Z`)
            - Date.parse(`${startDate}T00:00:00.000Z`);
        const expectedRangeMs = (days - 1) * 24 * 60 * 60 * 1000;
        if (actualRangeMs !== expectedRangeMs) {
            throw new Error('Admin dashboard history date range does not match the requested days.');
        }

        if (!Array.isArray(response['snapshots'])) {
            throw new Error('Admin dashboard history snapshots must be an array.');
        }

        const seenDates = new Set<string>();
        const snapshots = response['snapshots'].map((snapshot, index) => {
            const point = this.mapAdminDashboardHistoryPoint(snapshot, index);
            if (point.date < startDate || point.date > endDate) {
                throw new Error(`Admin dashboard history snapshot ${index} is outside the requested range.`);
            }
            if (seenDates.has(point.date)) {
                throw new Error(`Admin dashboard history contains duplicate date ${point.date}.`);
            }
            seenDates.add(point.date);
            return point;
        }).sort((left, right) => left.date.localeCompare(right.date));

        return { days, startDate, endDate, snapshots };
    }

    private mapAdminDashboardHistoryPoint(value: unknown, index: number): AdminDashboardHistoryPoint {
        const point = requireRecord(value, `snapshots[${index}]`);
        const users = requireRecord(point['users'], `snapshots[${index}].users`);
        const authActivity = requireRecord(point['authActivity'], `snapshots[${index}].authActivity`);
        const subscriptionCadence = requireRecord(
            point['subscriptionCadence'],
            `snapshots[${index}].subscriptionCadence`
        );
        const pro = requireCadenceTier(subscriptionCadence['pro'], `snapshots[${index}].subscriptionCadence.pro`);
        const basic = requireCadenceTier(subscriptionCadence['basic'], `snapshots[${index}].subscriptionCadence.basic`);
        const rawActivityByPlan = authActivity['byPlan'];
        const activityByPlan = rawActivityByPlan === undefined || rawActivityByPlan === null
            ? null
            : requireHistoryActivityPlanBreakdown(
                rawActivityByPlan,
                `snapshots[${index}].authActivity.byPlan`,
            );
        const mapped: AdminDashboardHistoryPoint = {
            date: requireUtcDateKey(point['date'], `snapshots[${index}].date`),
            computedAt: requireIsoTimestamp(point['computedAt'], `snapshots[${index}].computedAt`),
            users: {
                total: requireCount(users['total'], `snapshots[${index}].users.total`),
                free: requireCount(users['free'], `snapshots[${index}].users.free`),
                basic: requireCount(users['basic'], `snapshots[${index}].users.basic`),
                pro: requireCount(users['pro'], `snapshots[${index}].users.pro`),
                onboardingCompleted: requireCount(
                    users['onboardingCompleted'],
                    `snapshots[${index}].users.onboardingCompleted`
                ),
            },
            authActivity: {
                eligibleAccounts: requireCount(
                    authActivity['eligibleAccounts'],
                    `snapshots[${index}].authActivity.eligibleAccounts`
                ),
                last24Hours: requireCount(
                    authActivity['last24Hours'],
                    `snapshots[${index}].authActivity.last24Hours`
                ),
                last7Days: requireCount(
                    authActivity['last7Days'],
                    `snapshots[${index}].authActivity.last7Days`
                ),
                last30Days: requireCount(
                    authActivity['last30Days'],
                    `snapshots[${index}].authActivity.last30Days`
                ),
                byPlan: activityByPlan,
            },
            subscriptionCadence: { pro, basic },
        };

        if (
            mapped.users.free + mapped.users.basic + mapped.users.pro !== mapped.users.total
            || mapped.users.onboardingCompleted > mapped.users.total
        ) {
            throw new Error(`Admin dashboard history snapshot ${index} has inconsistent user totals.`);
        }
        if (
            mapped.authActivity.last24Hours > mapped.authActivity.last7Days
            || mapped.authActivity.last7Days > mapped.authActivity.last30Days
            || mapped.authActivity.last30Days > mapped.authActivity.eligibleAccounts
        ) {
            throw new Error(`Admin dashboard history snapshot ${index} has inconsistent activity totals.`);
        }
        const byPlan = mapped.authActivity.byPlan;
        if (byPlan) {
            const plans = ['free', 'basic', 'pro'] as const;
            const windows: readonly AuthActivityWindowKey[] = ['last24Hours', 'last7Days', 'last30Days'];
            if (windows.some(window => (
                plans.reduce((total, plan) => total + byPlan[plan][window], 0)
                !== mapped.authActivity[window]
            ))) {
                throw new Error(`Admin dashboard history snapshot ${index} has inconsistent activity plan totals.`);
            }
            if (
                byPlan.basic.last30Days > mapped.users.basic
                || byPlan.pro.last30Days > mapped.users.pro
            ) {
                throw new Error(`Admin dashboard history snapshot ${index} has activity exceeding its paid plan totals.`);
            }
        }
        if (
            cadenceTierTotal(pro) !== mapped.users.pro
            || cadenceTierTotal(basic) !== mapped.users.basic
        ) {
            throw new Error(`Admin dashboard history snapshot ${index} has inconsistent subscription cadence totals.`);
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

    getMaintenanceStatus(): Observable<MaintenanceStatus> {
        return from(this.functionsService.call<void, MaintenanceStatus>('getMaintenanceStatus')).pipe(
            map(result => result.data)
        );
    }

    impersonateUser(uid: string): Observable<{ token: string }> {
        return from(this.functionsService.call<{ uid: string }, { token: string }>('impersonateUser', { uid })).pipe(
            map(result => result.data)
        );
    }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Admin dashboard history ${field} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function requireCount(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Admin dashboard history ${field} must be a non-negative integer.`);
    }
    return value;
}

function requireHistoryDays(value: unknown): AdminDashboardHistoryDays {
    if (value !== 30 && value !== 90 && value !== 365) {
        throw new Error('Admin dashboard history days must be 30, 90, or 365.');
    }
    return value;
}

function requireUtcDateKey(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Admin dashboard history ${field} must be a UTC date.`);
    }
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        throw new Error(`Admin dashboard history ${field} must be a valid UTC date.`);
    }
    return value;
}

function requireIsoTimestamp(value: unknown, field: string): string {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (
        typeof value !== 'string'
        || !Number.isFinite(parsed)
        || new Date(parsed).toISOString() !== value
    ) {
        throw new Error(`Admin dashboard history ${field} must be an ISO timestamp.`);
    }
    return value;
}

function requireCadenceTier(value: unknown, field: string): AdminDashboardHistoryCadenceTierStats {
    const tier = requireRecord(value, field);
    return {
        monthly: requireCount(tier['monthly'], `${field}.monthly`),
        yearly: requireCount(tier['yearly'], `${field}.yearly`),
        unknown: requireCount(tier['unknown'], `${field}.unknown`),
    };
}

function requireHistoryActivityPlanBreakdown(
    value: unknown,
    field: string,
): AdminDashboardHistoryAuthActivityPlanBreakdown {
    const breakdown = requireRecord(value, field);
    const requireTier = (plan: 'free' | 'basic' | 'pro'): AdminDashboardHistoryAuthActivityWindowStats => {
        const tier = requireRecord(breakdown[plan], `${field}.${plan}`);
        const mapped = {
            last24Hours: requireCount(tier['last24Hours'], `${field}.${plan}.last24Hours`),
            last7Days: requireCount(tier['last7Days'], `${field}.${plan}.last7Days`),
            last30Days: requireCount(tier['last30Days'], `${field}.${plan}.last30Days`),
        };
        if (mapped.last24Hours > mapped.last7Days || mapped.last7Days > mapped.last30Days) {
            throw new Error(`Admin dashboard history ${field}.${plan} has inconsistent activity totals.`);
        }
        return mapped;
    };
    return {
        free: requireTier('free'),
        basic: requireTier('basic'),
        pro: requireTier('pro'),
    };
}

function cadenceTierTotal(value: AdminDashboardHistoryCadenceTierStats): number {
    return value.monthly + value.yearly + value.unknown;
}
