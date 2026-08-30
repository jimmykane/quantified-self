import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    AdminDashboardHistoryResponse,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse,
} from '../../../services/admin.service';
import { AdminUserAnalyticsStore } from '../../../services/admin-user-analytics.store';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { AdminUserGrowthChartComponent } from './admin-user-growth-chart.component';
import { AdminUserOverviewComponent } from './admin-user-overview.component';

describe('AdminUserOverviewComponent', () => {
    let fixture: ComponentFixture<AdminUserOverviewComponent>;
    let component: AdminUserOverviewComponent;
    let analytics: ReturnType<typeof analyticsStore>;
    let snackBar: { open: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        analytics = analyticsStore();
        snackBar = { open: vi.fn() };
        const chart = { isDisposed: vi.fn(() => false), dispatchAction: vi.fn() };
        const loader = {
            init: vi.fn(() => Promise.resolve(chart)),
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            subscribeToViewportResize: vi.fn(() => () => undefined),
            attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
        };

        await TestBed.configureTestingModule({
            imports: [AdminUserOverviewComponent, NoopAnimationsModule],
            providers: [
                { provide: AdminUserAnalyticsStore, useValue: analytics },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: AppThemeService, useValue: { getAppTheme: () => of(AppThemes.Normal) } },
                { provide: EChartsLoaderService, useValue: loader },
                { provide: LoggerService, useValue: { error: vi.fn() } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AdminUserOverviewComponent);
        component = fixture.componentInstance;
        (component as unknown as { snackBar: typeof snackBar }).snackBar = snackBar;
        fixture.detectChanges();
    });

    it('loads and renders the complete analytics profile', () => {
        const text = (fixture.nativeElement as HTMLElement).textContent || '';

        expect(analytics.refreshAll).toHaveBeenCalledOnce();
        expect(component.kpiCards()).toHaveLength(21);
        expect(text).toContain('Marketing Opt-ins');
        expect(text).toContain('Service Connected');
        expect(text).toContain('MCP Connected');
        expect(text).toContain('Ever Paid');
        expect(text).toContain('Auth Provider Breakdown');
        expect(text).toContain('User & Subscription Growth');
        expect(text).toContain('Collecting daily history');
    });

    it('refreshes aggregate event and route counts with feedback', async () => {
        await component.refreshEventCount();
        await component.refreshRouteCount();

        expect(analytics.refreshEventCount).toHaveBeenCalledOnce();
        expect(analytics.refreshRouteCount).toHaveBeenCalledOnce();
        expect(snackBar.open).toHaveBeenCalledWith('Event count refreshed', undefined, { duration: 3000 });
        expect(snackBar.open).toHaveBeenCalledWith('Route count refreshed', undefined, { duration: 3000 });
    });

    it('blocks competing refresh actions while an aggregate count refresh is running', () => {
        analytics.refreshingEventCount.set(true);
        expect(component.refreshInProgress()).toBe(true);

        analytics.refreshingEventCount.set(false);
        analytics.refreshingRouteCount.set(true);
        expect(component.refreshInProgress()).toBe(true);
    });

    it('uses trend loading state for the growth chart after KPI stats settle', () => {
        analytics.loadingKpis.set(false);
        analytics.loadingTrends.set(true);
        fixture.detectChanges();

        const growthChart = fixture.debugElement.query(By.directive(AdminUserGrowthChartComponent))
            .componentInstance as AdminUserGrowthChartComponent;
        expect(growthChart.loading).toBe(true);
    });
});

function analyticsStore() {
    const stats: UserCountStats = {
        total: 20,
        pro: 4,
        basic: 3,
        free: 13,
        monthlyPaid: 5,
        yearlyPaid: 2,
        everPaid: 8,
        canceled: 1,
        cancelScheduled: 1,
        onboardingCompleted: 15,
        marketingConsent: 9,
        providers: { password: 12, 'google.com': 8 },
        events: { total: 100 },
        routes: { total: 10 },
        connections: { serviceUsers: 8, mcpUsers: 3, both: 2, providers: {} },
        authActivity: { last24Hours: 2, last7Days: 5, last30Days: 10, computedAt: null, byPlan: null },
    };
    const growth: UserGrowthTrendResponse = {
        months: 12,
        buckets: [{ key: '2026-08', label: 'Aug', registeredUsers: 2, onboardedUsers: 1 }],
        totals: { registeredUsers: 2, onboardedUsers: 1 },
    };
    const subscriptions: SubscriptionHistoryTrendResponse = {
        months: 12,
        buckets: [{ key: '2026-08', label: 'Aug', basicNet: 1, proNet: 1 }],
        totals: { net: 2 },
    };
    const history: AdminDashboardHistoryResponse = {
        days: 365,
        startDate: '2025-08-29',
        endDate: '2026-08-29',
        snapshots: [],
    };
    return {
        stats: signal<UserCountStats | null>(stats),
        userGrowthTrend: signal<UserGrowthTrendResponse | null>(growth),
        subscriptionHistoryTrend: signal<SubscriptionHistoryTrendResponse | null>(subscriptions),
        history: signal<AdminDashboardHistoryResponse | null>(history),
        statsError: signal<string | null>(null),
        historyError: signal<string | null>(null),
        trendWarning: signal<string | null>(null),
        loadingKpis: signal(false),
        loadingTrends: signal(false),
        loadingHistory: signal(false),
        loadingAll: signal(false),
        refreshingAll: signal(false),
        refreshingEventCount: signal(false),
        refreshingRouteCount: signal(false),
        refreshAll: vi.fn(() => Promise.resolve()),
        refreshEventCount: vi.fn(() => Promise.resolve()),
        refreshRouteCount: vi.fn(() => Promise.resolve()),
    };
}
