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
            pending: 5,
            queues: {
                workout: { queueId: 'processWorkoutTask', pending: 3 },
                sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 2 }
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
        advanced: {
            throughput: 0,
            maxLagMs: 0,
            retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 },
            topErrors: []
        }
    };

    beforeEach(async () => {
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

    it('should render route navigation buttons', () => {
        const host: HTMLElement = fixture.nativeElement;
        const text = host.textContent || '';
        expect(text).toContain('Back To Dashboard');
        expect(text).toContain('Workout Queue');
        expect(text).toContain('Reparse Queue');
    });
});
