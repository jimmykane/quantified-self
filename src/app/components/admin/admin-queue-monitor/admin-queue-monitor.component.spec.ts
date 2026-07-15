import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminQueueMonitorComponent } from './admin-queue-monitor.component';
import { AdminService } from '../../../services/admin.service';
import { LoggerService } from '../../../services/logger.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';

describe('AdminQueueMonitorComponent', () => {
    let fixture: ComponentFixture<AdminQueueMonitorComponent>;
    let component: AdminQueueMonitorComponent;
    let adminServiceSpy: { getQueueStats: ReturnType<typeof vi.fn> };
    const routeData = { queueView: 'workout' };

    const mockQueueStats = {
        pending: 2,
        succeeded: 8,
        stuck: 1,
        providers: [],
        cloudTasks: {
            pending: 11,
            queues: {
                workout: { queueId: 'processWorkoutTask', pending: 3 },
                activitySync: { queueId: 'processActivitySyncTask', pending: 0 },
                routeDeliverySync: { queueId: 'processRouteDeliverySyncTask', pending: 5 },
                routeSync: { queueId: 'processRouteSyncTask', pending: 2 },
                sleepSync: { queueId: 'processSleepSyncTask', pending: 1 },
                sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 2 },
                sportsLibRouteReparse: { queueId: 'processSportsLibRouteReparseTask', pending: 4 },
                derivedMetricsIngress: { queueId: 'processDerivedMetricsIngressTask', pending: 2 },
                derivedMetrics: { queueId: 'processDerivedMetricsTask', pending: 6 }
            }
        },
        reparse: {
            queuePending: 2,
            targetSportsLibVersion: '9.1.5',
            jobs: { total: 10, pending: 2, processing: 1, completed: 6, failed: 1 },
            checkpoint: {
                cursorEventPath: null,
                lastScanAt: null,
                lastPassStartedAt: null,
                lastPassCompletedAt: null,
                lastScanCount: 0,
                lastEnqueuedCount: 0,
                overrideUsersInProgress: 0
            },
            recentFailures: []
        },
        routeReparse: {
            queuePending: 4,
            targetSportsLibVersion: '9.1.5',
            jobs: { total: 8, pending: 4, processing: 1, completed: 2, skipped: 0, failed: 1 },
            checkpoint: {
                cursorProcessingDocPath: null,
                cursorProcessingVersionCode: null,
                lastScanAt: null,
                lastPassStartedAt: null,
                lastPassCompletedAt: null,
                lastScanCount: 0,
                lastEnqueuedCount: 0,
                overrideUsersInProgress: 0
            },
            recentFailures: []
        },
        advanced: {
            throughput: 0,
            maxLagMs: 0,
            retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 },
            topErrors: []
        },
        derivedMetrics: {
            coordinators: { idle: 1, queued: 1, processing: 1, staleQueued: 0, staleProcessing: 0, failed: 0, total: 3 },
            recentFailures: []
        }
    };

    beforeEach(async () => {
        routeData.queueView = 'workout';
        adminServiceSpy = {
            getQueueStats: vi.fn().mockReturnValue(of(mockQueueStats))
        };

        const chartMock = {
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            isDisposed: vi.fn().mockReturnValue(false)
        };

        await TestBed.configureTestingModule({
            imports: [AdminQueueMonitorComponent],
            providers: [
                { provide: AdminService, useValue: adminServiceSpy },
                { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { data: routeData } } },
                { provide: AppThemeService, useValue: { getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Light)) } },
                {
                    provide: EChartsLoaderService,
                    useValue: {
                        init: vi.fn().mockResolvedValue(chartMock),
                        setOption: vi.fn(),
                        resize: vi.fn(),
                        dispose: vi.fn(),
                        subscribeToViewportResize: vi.fn(() => () => { }),
                        attachMobileSeriesTapFeedback: vi.fn(() => () => { })
                    }
                }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminQueueMonitorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should configure workout queue view from route data', () => {
        expect(component.queueView).toBe('workout');
        expect(component.pageTitle).toContain('Workout Queue');
    });

    it('should load queue stats on init', () => {
        expect(adminServiceSpy.getQueueStats).toHaveBeenCalledWith(true);
        expect(component.queueStats).toEqual(mockQueueStats);
        expect(component.isLoadingStats).toBe(false);
    });

    it('should fallback to all view when route data is invalid', () => {
        routeData.queueView = 'unexpected';

        const fallbackFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const fallbackComponent = fallbackFixture.componentInstance;
        fallbackFixture.detectChanges();

        expect(fallbackComponent.queueView).toBe('all');
        expect(fallbackComponent.pageTitle).toContain('Queue Monitoring');
    });

    it('should configure derived queue view from route data', () => {
        routeData.queueView = 'derived';
        const derivedFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const derivedComponent = derivedFixture.componentInstance;
        derivedFixture.detectChanges();

        expect(derivedComponent.queueView).toBe('derived');
        expect(derivedComponent.pageTitle).toContain('Derived Metrics Queue');
    });

    it('should configure activity sync queue view from route data', () => {
        routeData.queueView = 'activity-sync';
        const activitySyncFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const activitySyncComponent = activitySyncFixture.componentInstance;
        activitySyncFixture.detectChanges();

        expect(activitySyncComponent.queueView).toBe('activity-sync');
        expect(activitySyncComponent.pageTitle).toContain('Activity Sync Queue');
    });

    it('should configure route sync queue view from route data', () => {
        routeData.queueView = 'route-sync';
        const routeSyncFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const routeSyncComponent = routeSyncFixture.componentInstance;
        routeSyncFixture.detectChanges();

        expect(routeSyncComponent.queueView).toBe('route-sync');
        expect(routeSyncComponent.pageTitle).toContain('Route Sync Queue');
    });

    it('should configure route delivery sync queue view from route data', () => {
        routeData.queueView = 'route-delivery-sync';
        const routeDeliverySyncFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const routeDeliverySyncComponent = routeDeliverySyncFixture.componentInstance;
        routeDeliverySyncFixture.detectChanges();

        expect(routeDeliverySyncComponent.queueView).toBe('route-delivery-sync');
        expect(routeDeliverySyncComponent.pageTitle).toContain('Route Delivery Sync Queue');
    });

    it('should configure sleep sync queue view from route data', () => {
        routeData.queueView = 'sleep-sync';
        const sleepSyncFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const sleepSyncComponent = sleepSyncFixture.componentInstance;
        sleepSyncFixture.detectChanges();

        expect(sleepSyncComponent.queueView).toBe('sleep-sync');
        expect(sleepSyncComponent.pageTitle).toContain('Sleep Sync Queue');
    });

    it('should configure route reparse queue view from route data', () => {
        routeData.queueView = 'route-reparse';
        const routeReparseFixture = TestBed.createComponent(AdminQueueMonitorComponent);
        const routeReparseComponent = routeReparseFixture.componentInstance;
        routeReparseFixture.detectChanges();

        expect(routeReparseComponent.queueView).toBe('route-reparse');
        expect(routeReparseComponent.pageTitle).toContain('Route Reparse Queue');
    });

    it('should render route navigation buttons', () => {
        const host: HTMLElement = fixture.nativeElement;
        const text = host.textContent || '';
        expect(text).toContain('Back To Dashboard');
        expect(text).toContain('Workout Queue');
        expect(text).toContain('Activity Sync Queue');
        expect(text).toContain('Route Delivery Sync Queue');
        expect(text).toContain('Route Sync Queue');
        expect(text).toContain('Sleep Sync Queue');
        expect(text).toContain('Event Reparse Queue');
        expect(text).toContain('Route Reparse Queue');
        expect(text).toContain('Derived Metrics Queue');
    });
});
