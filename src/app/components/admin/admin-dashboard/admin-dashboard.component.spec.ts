import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AdminDashboardComponent } from './admin-dashboard.component';
import {
    AdminService,
    FinancialStats,
    MaintenanceStatus,
    QueueStats,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse,
} from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { AppWhatsNewService, ChangelogPost } from '../../../services/app.whats-new.service';

describe('AdminDashboardComponent', () => {
    let fixture: ComponentFixture<AdminDashboardComponent>;
    let component: AdminDashboardComponent;
    let adminServiceSpy: {
        getFinancialStats: ReturnType<typeof vi.fn>;
        getTotalUserCount: ReturnType<typeof vi.fn>;
        getUserGrowthTrend: ReturnType<typeof vi.fn>;
        getSubscriptionHistoryTrend: ReturnType<typeof vi.fn>;
        getQueueStats: ReturnType<typeof vi.fn>;
        getMaintenanceStatus: ReturnType<typeof vi.fn>;
    };
    let whatsNewServiceSpy: {
        changelogs: WritableSignal<ChangelogPost[]>;
        setAdminMode: ReturnType<typeof vi.fn>;
    };
    let loggerSpy: { error: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };

    const mockFinancialStats: FinancialStats = {
        revenue: { total: 1000, currency: 'USD', invoiceCount: 10 },
        cost: {
            billingAccountId: null,
            projectId: 'quantified-self-io',
            reportUrl: 'https://example.com/report',
            currency: 'USD',
            total: 2500,
            budget: null
        }
    };

    const mockUserStats: UserCountStats = {
        total: 120,
        pro: 30,
        basic: 25,
        free: 65,
        monthlyPaid: 40,
        yearlyPaid: 15,
        everPaid: 70,
        canceled: 15,
        cancelScheduled: 3,
        onboardingCompleted: 90,
        providers: { 'google.com': 80 },
        events: { total: 1_250, computedAt: '2026-06-01T10:00:00.000Z' },
        routes: { total: 42 },
    };

    const mockGrowthTrend: UserGrowthTrendResponse = {
        months: 12,
        buckets: [],
        totals: { registeredUsers: 18, onboardedUsers: 12 },
    };

    const mockSubscriptionTrend: SubscriptionHistoryTrendResponse = {
        months: 12,
        buckets: [],
        totals: {
            newSubscriptions: 10,
            plannedCancellations: 4,
            net: 6,
            basicNewSubscriptions: 4,
            basicPlannedCancellations: 1,
            basicNet: 3,
            proNewSubscriptions: 6,
            proPlannedCancellations: 3,
            proNet: 3,
        },
    };

    const mockQueueStats: QueueStats = {
        pending: 2,
        succeeded: 10,
        stuck: 0,
        providers: [{ name: 'Garmin', pending: 2, succeeded: 5, stuck: 0, dead: 0 }],
        dlq: { total: 1, byContext: [], byProvider: [] },
        cloudTasks: {
            pending: 14,
            queues: {
                workout: { queueId: 'workout', pending: 3 },
                activitySync: { queueId: 'activity', pending: 0 },
                routeDeliverySync: { queueId: 'delivery', pending: 1 },
                routeSync: { queueId: 'route', pending: 0 },
                sleepSync: { queueId: 'sleep', pending: 2 },
                sportsLibReparse: { queueId: 'reparse', pending: 4 },
                sportsLibReparseHeavy: { queueId: 'heavy', pending: 1 },
                sportsLibRouteReparse: { queueId: 'route-reparse', pending: 0 },
                derivedMetrics: { queueId: 'derived', pending: 3 },
            },
        },
        advanced: {
            throughput: 6,
            maxLagMs: 65_000,
            retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 },
            topErrors: [],
        },
        activitySync: {
            pending: 0,
            succeeded: 20,
            stuck: 0,
            dead: 0,
            dlqByContext: [],
            advanced: { throughput: 7, maxLagMs: 0, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
        },
        routeDeliverySync: {
            pending: 1,
            succeeded: 12,
            skipped: 5,
            stuck: 0,
            dead: 0,
            dlqByContext: [],
            advanced: { throughput: 3, maxLagMs: 1_000, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
        },
        routeSync: {
            pending: 0,
            succeeded: 8,
            skipped: 2,
            stuck: 0,
            dead: 0,
            dlqByContext: [],
            advanced: { throughput: 2, maxLagMs: 0, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
        },
        sleepSync: {
            pending: 2,
            succeeded: 30,
            providerDisabled: 1,
            disabledProviders: ['Garmin'],
            providers: [],
            stuck: 0,
            dead: 0,
            dlqByContext: [],
            advanced: { throughput: 5, maxLagMs: 5_000, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
        },
        reparse: {
            queuePending: 5,
            targetSportsLibVersion: '9.1.5',
            jobs: { total: 20, pending: 5, processing: 2, completed: 12, failed: 1 },
            checkpoint: {
                cursorEventPath: null,
                lastScanAt: null,
                lastPassStartedAt: null,
                lastPassCompletedAt: null,
                lastScanCount: 0,
                lastEnqueuedCount: 0,
                overrideUsersInProgress: 0,
            },
            recentFailures: [],
        },
        routeReparse: {
            queuePending: 0,
            targetSportsLibVersion: '9.1.5',
            jobs: { total: 10, pending: 0, processing: 0, completed: 8, skipped: 2, failed: 0 },
            checkpoint: {
                cursorProcessingDocPath: null,
                cursorProcessingVersionCode: null,
                lastScanAt: null,
                lastPassStartedAt: null,
                lastPassCompletedAt: null,
                lastScanCount: 0,
                lastEnqueuedCount: 0,
                overrideUsersInProgress: 0,
            },
            recentFailures: [],
        },
        derivedMetrics: {
            coordinators: { idle: 4, queued: 1, processing: 1, staleQueued: 0, staleProcessing: 1, failed: 0, total: 7 },
            recentFailures: [],
        },
    };

    const mockMaintenanceStatus: MaintenanceStatus = {
        prod: { enabled: false, message: '' },
        beta: { enabled: true, message: 'Deploying' },
        dev: { enabled: false, message: '' },
    };

    beforeEach(async () => {
        adminServiceSpy = {
            getFinancialStats: vi.fn().mockReturnValue(of(mockFinancialStats)),
            getTotalUserCount: vi.fn().mockReturnValue(of(mockUserStats)),
            getUserGrowthTrend: vi.fn().mockReturnValue(of(mockGrowthTrend)),
            getSubscriptionHistoryTrend: vi.fn().mockReturnValue(of(mockSubscriptionTrend)),
            getQueueStats: vi.fn().mockReturnValue(of(mockQueueStats)),
            getMaintenanceStatus: vi.fn().mockReturnValue(of(mockMaintenanceStatus)),
        };
        whatsNewServiceSpy = {
            changelogs: signal([
                { id: 'old', title: 'Old', description: '', date: new Date('2026-01-01T00:00:00Z'), published: true, type: 'minor' },
                { id: 'new', title: 'New Draft', description: '', date: new Date('2026-02-01T00:00:00Z'), published: false, type: 'patch' },
            ] as ChangelogPost[]),
            setAdminMode: vi.fn(),
        };
        loggerSpy = { error: vi.fn(), log: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [AdminDashboardComponent, NoopAnimationsModule],
            providers: [
                provideRouter([]),
                { provide: AdminService, useValue: adminServiceSpy },
                { provide: AppWhatsNewService, useValue: whatsNewServiceSpy },
                { provide: LoggerService, useValue: loggerSpy },
            ]
        }).compileComponents();
    });

    function createComponent(): void {
        fixture = TestBed.createComponent(AdminDashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    it('should create without taking ownership of changelog admin mode', () => {
        createComponent();

        expect(component).toBeTruthy();
        expect(whatsNewServiceSpy.setAdminMode).not.toHaveBeenCalled();
    });

    it('should load all dashboard sections independently on init', () => {
        createComponent();

        expect(adminServiceSpy.getFinancialStats).toHaveBeenCalled();
        expect(adminServiceSpy.getTotalUserCount).toHaveBeenCalled();
        expect(adminServiceSpy.getUserGrowthTrend).toHaveBeenCalledWith(12);
        expect(adminServiceSpy.getSubscriptionHistoryTrend).toHaveBeenCalledWith(12);
        expect(adminServiceSpy.getQueueStats).toHaveBeenCalledWith(true);
        expect(adminServiceSpy.getMaintenanceStatus).toHaveBeenCalled();
        expect(component.financialStats()).toEqual(mockFinancialStats);
        expect(component.userStats()).toEqual(mockUserStats);
        expect(component.queueRows()).toHaveLength(8);
        expect(component.maintenanceCards()).toHaveLength(3);
    });

    it('should render user KPIs, queue rows, maintenance cards, and changelog summary', () => {
        createComponent();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Total Users');
        expect(text).toContain('Ever Paid');
        expect(text).toContain('Scheduled Cancels');
        expect(text).toContain('Workout');
        expect(text).toContain('Event Reparse');
        expect(text).toContain('Derived Metrics');
        expect(text).toContain('Beta');
        expect(text).toContain('Deploying');
        expect(text).toContain('Old');
    });

    it('should render section-level error states without blocking other sections', () => {
        adminServiceSpy.getQueueStats.mockReturnValue(throwError(() => new Error('queue failed')));
        createComponent();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Queue stats are unavailable.');
        expect(text).toContain('Unavailable');
        expect(text).toContain('Stats unavailable');
        expect(text).toContain('Total Users');
        expect(text).toContain('Maintenance');
        expect(loggerSpy.error).toHaveBeenCalledWith('Failed to load admin queue stats:', expect.any(Error));
    });

    it('should keep core user KPIs visible when user trend calls fail', () => {
        adminServiceSpy.getUserGrowthTrend.mockReturnValue(throwError(() => new Error('growth failed')));
        adminServiceSpy.getSubscriptionHistoryTrend.mockReturnValue(throwError(() => new Error('subscription failed')));
        createComponent();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Total Users');
        expect(text).toContain('Ever Paid');
        expect(text).toContain('12-Month Growth');
        expect(text).not.toContain('User KPIs are unavailable.');
        expect(loggerSpy.error).toHaveBeenCalledWith('Failed to load admin user growth trend:', expect.any(Error));
        expect(loggerSpy.error).toHaveBeenCalledWith('Failed to load admin subscription history trend:', expect.any(Error));
    });

    it('should show top-level unavailable state when financial stats fail', () => {
        adminServiceSpy.getFinancialStats.mockReturnValue(throwError(() => new Error('financial failed')));
        createComponent();

        const text = (fixture.nativeElement as HTMLElement).textContent || '';
        expect(text).toContain('Paid Invoices');
        expect(text).toContain('Unavailable');
        expect(text).toContain('Financial stats are unavailable.');
        expect(text).not.toContain('GCP Billing');
    });

    it('should not reset changelog admin mode on destroy', () => {
        createComponent();

        fixture.destroy();

        expect(whatsNewServiceSpy.setAdminMode).not.toHaveBeenCalled();
    });

    it('should call fetchFinancialStats and update signal state', () => {
        createComponent();
        adminServiceSpy.getFinancialStats.mockClear();

        component.fetchFinancialStats();

        expect(adminServiceSpy.getFinancialStats).toHaveBeenCalled();
        expect(component.financialStats()).toEqual(mockFinancialStats);
        expect(component.isLoadingFinancials()).toBe(false);
    });
});
