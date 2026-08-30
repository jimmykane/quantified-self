import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
    AdminDashboardHistoryResponse,
    AdminService,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse,
} from './admin.service';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class AdminUserAnalyticsStore {
    private readonly adminService = inject(AdminService);
    private readonly logger = inject(LoggerService);

    private readonly statsState = signal<UserCountStats | null>(null);
    private readonly userGrowthTrendState = signal<UserGrowthTrendResponse | null>(null);
    private readonly subscriptionHistoryTrendState = signal<SubscriptionHistoryTrendResponse | null>(null);
    private readonly historyState = signal<AdminDashboardHistoryResponse | null>(null);

    private readonly statsLoadingState = signal(false);
    private readonly userGrowthTrendLoadingState = signal(false);
    private readonly subscriptionHistoryTrendLoadingState = signal(false);
    private readonly historyLoadingState = signal(false);

    private readonly statsErrorState = signal<string | null>(null);
    private readonly userGrowthTrendErrorState = signal<string | null>(null);
    private readonly subscriptionHistoryTrendErrorState = signal<string | null>(null);
    private readonly historyErrorState = signal<string | null>(null);

    private readonly refreshingEventCountState = signal(false);
    private readonly refreshingRouteCountState = signal(false);

    readonly stats = this.statsState.asReadonly();
    readonly userGrowthTrend = this.userGrowthTrendState.asReadonly();
    readonly subscriptionHistoryTrend = this.subscriptionHistoryTrendState.asReadonly();
    readonly history = this.historyState.asReadonly();

    readonly statsError = this.statsErrorState.asReadonly();
    readonly userGrowthTrendError = this.userGrowthTrendErrorState.asReadonly();
    readonly subscriptionHistoryTrendError = this.subscriptionHistoryTrendErrorState.asReadonly();
    readonly historyError = this.historyErrorState.asReadonly();

    readonly refreshingEventCount = this.refreshingEventCountState.asReadonly();
    readonly refreshingRouteCount = this.refreshingRouteCountState.asReadonly();

    readonly loadingKpis = computed(() => (
        this.statsLoadingState()
        || this.userGrowthTrendLoadingState()
        || this.subscriptionHistoryTrendLoadingState()
    ) && this.statsState() === null);
    readonly loadingTrends = computed(() => (
        this.userGrowthTrendLoadingState()
        || this.subscriptionHistoryTrendLoadingState()
    ));
    readonly refreshingKpis = computed(() => (
        this.statsLoadingState()
        || this.userGrowthTrendLoadingState()
        || this.subscriptionHistoryTrendLoadingState()
    ) && this.statsState() !== null);
    readonly loadingHistory = computed(() => this.historyLoadingState() && this.historyState() === null);
    readonly refreshingHistory = computed(() => this.historyLoadingState() && this.historyState() !== null);
    readonly refreshingAll = computed(() => this.refreshingKpis() || this.refreshingHistory());
    readonly loadingAll = computed(() => this.loadingKpis() || this.loadingHistory());
    readonly trendWarning = computed(() => {
        const warnings = [this.userGrowthTrendErrorState(), this.subscriptionHistoryTrendErrorState()]
            .filter((value): value is string => Boolean(value));
        return warnings.length > 0 ? warnings.join(' ') : null;
    });

    private refreshAllPromise: Promise<void> | null = null;
    private eventCountRefreshPromise: Promise<void> | null = null;
    private routeCountRefreshPromise: Promise<void> | null = null;
    private statsRequestSequence = 0;

    refreshAll(): Promise<void> {
        if (this.refreshAllPromise) {
            return this.refreshAllPromise;
        }

        const request = Promise.all([
            this.refreshStats(),
            this.refreshUserGrowthTrend(),
            this.refreshSubscriptionHistoryTrend(),
            this.refreshHistory(),
        ]).then(() => undefined).finally(() => {
            this.refreshAllPromise = null;
        });
        this.refreshAllPromise = request;
        return request;
    }

    refreshEventCount(): Promise<void> {
        if (this.eventCountRefreshPromise) {
            return this.eventCountRefreshPromise;
        }

        const requestSequence = ++this.statsRequestSequence;
        this.refreshingEventCountState.set(true);
        const request = firstValueFrom(this.adminService.getTotalUserCount({ refreshEventCount: true }))
            .then(stats => {
                if (requestSequence === this.statsRequestSequence) {
                    this.statsState.set(stats);
                    this.statsErrorState.set(null);
                }
            })
            .catch(error => {
                this.logger.error('Admin user analytics event count refresh failed:', error);
                throw error;
            })
            .finally(() => {
                this.refreshingEventCountState.set(false);
                this.eventCountRefreshPromise = null;
            });
        this.eventCountRefreshPromise = request;
        return request;
    }

    refreshRouteCount(): Promise<void> {
        if (this.routeCountRefreshPromise) {
            return this.routeCountRefreshPromise;
        }

        const requestSequence = ++this.statsRequestSequence;
        this.refreshingRouteCountState.set(true);
        const request = firstValueFrom(this.adminService.getTotalUserCount({ refreshRouteCount: true }))
            .then(stats => {
                if (requestSequence === this.statsRequestSequence) {
                    this.statsState.set(stats);
                    this.statsErrorState.set(null);
                }
            })
            .catch(error => {
                this.logger.error('Admin user analytics route count refresh failed:', error);
                throw error;
            })
            .finally(() => {
                this.refreshingRouteCountState.set(false);
                this.routeCountRefreshPromise = null;
            });
        this.routeCountRefreshPromise = request;
        return request;
    }

    private refreshStats(): Promise<void> {
        const requestSequence = ++this.statsRequestSequence;
        return this.loadSource({
            request: this.adminService.getTotalUserCount(),
            data: this.statsState,
            loading: this.statsLoadingState,
            error: this.statsErrorState,
            initialError: 'User KPIs are unavailable.',
            refreshError: 'User KPIs could not refresh; showing the previous data.',
            logMessage: 'Admin user analytics stats load failed:',
            accept: () => requestSequence === this.statsRequestSequence,
        });
    }

    private refreshUserGrowthTrend(): Promise<void> {
        return this.loadSource({
            request: this.adminService.getUserGrowthTrend(12),
            data: this.userGrowthTrendState,
            loading: this.userGrowthTrendLoadingState,
            error: this.userGrowthTrendErrorState,
            initialError: 'User growth trend is unavailable.',
            refreshError: 'User growth trend could not refresh; showing the previous data.',
            logMessage: 'Admin user analytics growth trend load failed:',
        });
    }

    private refreshSubscriptionHistoryTrend(): Promise<void> {
        return this.loadSource({
            request: this.adminService.getSubscriptionHistoryTrend(12),
            data: this.subscriptionHistoryTrendState,
            loading: this.subscriptionHistoryTrendLoadingState,
            error: this.subscriptionHistoryTrendErrorState,
            initialError: 'Subscription trend is unavailable.',
            refreshError: 'Subscription trend could not refresh; showing the previous data.',
            logMessage: 'Admin user analytics subscription trend load failed:',
        });
    }

    private refreshHistory(): Promise<void> {
        return this.loadSource({
            request: this.adminService.getAdminDashboardHistory(365),
            data: this.historyState,
            loading: this.historyLoadingState,
            error: this.historyErrorState,
            initialError: 'User history is unavailable.',
            refreshError: 'User history could not refresh; showing the previous data.',
            logMessage: 'Admin user analytics history load failed:',
        });
    }

    private async loadSource<T>(options: {
        request: Observable<T>;
        data: WritableSignal<T | null>;
        loading: WritableSignal<boolean>;
        error: WritableSignal<string | null>;
        initialError: string;
        refreshError: string;
        logMessage: string;
        accept?: () => boolean;
    }): Promise<void> {
        const hadData = options.data() !== null;
        options.loading.set(true);
        options.error.set(null);
        try {
            const value = await firstValueFrom(options.request);
            if (!options.accept || options.accept()) {
                options.data.set(value);
            }
        } catch (error) {
            this.logger.error(options.logMessage, error);
            if (!options.accept || options.accept()) {
                options.error.set(hadData ? options.refreshError : options.initialError);
            }
        } finally {
            options.loading.set(false);
        }
    }
}
