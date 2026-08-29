import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    AdminDashboardHistoryResponse,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse,
} from './admin.service';
import { AdminService } from './admin.service';
import { AdminUserAnalyticsStore } from './admin-user-analytics.store';
import { LoggerService } from './logger.service';

const stats = { total: 10 } as UserCountStats;
const growth = { months: 12, buckets: [], totals: { registeredUsers: 2, onboardedUsers: 1 } } as UserGrowthTrendResponse;
const subscriptions = { months: 12, buckets: [], totals: { net: 1 } } as SubscriptionHistoryTrendResponse;
const history = { days: 365, snapshots: [] } as unknown as AdminDashboardHistoryResponse;

describe('AdminUserAnalyticsStore', () => {
    let store: AdminUserAnalyticsStore;
    let adminService: {
        getTotalUserCount: ReturnType<typeof vi.fn>;
        getUserGrowthTrend: ReturnType<typeof vi.fn>;
        getSubscriptionHistoryTrend: ReturnType<typeof vi.fn>;
        getAdminDashboardHistory: ReturnType<typeof vi.fn>;
    };
    let logger: { error: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        adminService = {
            getTotalUserCount: vi.fn(() => of(stats)),
            getUserGrowthTrend: vi.fn(() => of(growth)),
            getSubscriptionHistoryTrend: vi.fn(() => of(subscriptions)),
            getAdminDashboardHistory: vi.fn(() => of(history)),
        };
        logger = { error: vi.fn() };
        TestBed.configureTestingModule({
            providers: [
                AdminUserAnalyticsStore,
                { provide: AdminService, useValue: adminService },
                { provide: LoggerService, useValue: logger },
            ],
        });
        store = TestBed.inject(AdminUserAnalyticsStore);
    });

    it('loads all user analytics sources', async () => {
        await store.refreshAll();

        expect(store.stats()).toBe(stats);
        expect(store.userGrowthTrend()).toBe(growth);
        expect(store.subscriptionHistoryTrend()).toBe(subscriptions);
        expect(store.history()).toBe(history);
        expect(adminService.getUserGrowthTrend).toHaveBeenCalledWith(12);
        expect(adminService.getSubscriptionHistoryTrend).toHaveBeenCalledWith(12);
        expect(adminService.getAdminDashboardHistory).toHaveBeenCalledWith(365);
        expect(store.loadingAll()).toBe(false);
    });

    it('coalesces an in-flight full refresh', async () => {
        const statsSubject = new Subject<UserCountStats>();
        adminService.getTotalUserCount.mockReturnValue(statsSubject);

        const first = store.refreshAll();
        const second = store.refreshAll();
        expect(second).toBe(first);
        expect(adminService.getTotalUserCount).toHaveBeenCalledTimes(1);

        statsSubject.next(stats);
        statsSubject.complete();
        await first;
    });

    it('retains the last good source value after a partial refresh failure', async () => {
        await store.refreshAll();
        adminService.getUserGrowthTrend.mockReturnValue(throwError(() => new Error('growth failed')));

        await store.refreshAll();

        expect(store.userGrowthTrend()).toBe(growth);
        expect(store.userGrowthTrendError()).toContain('showing the previous data');
        expect(store.stats()).toBe(stats);
        expect(logger.error).toHaveBeenCalled();
    });

    it('surfaces an initial stats failure without blocking successful sources', async () => {
        adminService.getTotalUserCount.mockReturnValue(throwError(() => new Error('stats failed')));

        await store.refreshAll();

        expect(store.stats()).toBeNull();
        expect(store.statsError()).toBe('User KPIs are unavailable.');
        expect(store.userGrowthTrend()).toBe(growth);
        expect(store.history()).toBe(history);
    });

    it('refreshes event and route counts with operation-specific state', async () => {
        const eventStats = { total: 11 } as UserCountStats;
        const routeStats = { total: 12 } as UserCountStats;
        adminService.getTotalUserCount
            .mockReturnValueOnce(of(eventStats))
            .mockReturnValueOnce(of(routeStats));

        await store.refreshEventCount();
        expect(adminService.getTotalUserCount).toHaveBeenNthCalledWith(1, { refreshEventCount: true });
        expect(store.stats()).toBe(eventStats);
        expect(store.refreshingEventCount()).toBe(false);

        await store.refreshRouteCount();
        expect(adminService.getTotalUserCount).toHaveBeenNthCalledWith(2, { refreshRouteCount: true });
        expect(store.stats()).toBe(routeStats);
        expect(store.refreshingRouteCount()).toBe(false);
    });
});
