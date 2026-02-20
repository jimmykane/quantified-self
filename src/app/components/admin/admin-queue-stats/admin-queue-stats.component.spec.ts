import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminQueueStatsComponent } from './admin-queue-stats.component';
import { QueueStats } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { of } from 'rxjs';
import { AppThemes } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SimpleChange } from '@angular/core';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';

describe('AdminQueueStatsComponent', () => {
    let component: AdminQueueStatsComponent;
    let fixture: ComponentFixture<AdminQueueStatsComponent>;
    let mockThemeService: any;
    let mockEchartsService: any;

    if (!(global as any).requestAnimationFrame) {
        (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0);
    }

    beforeEach(async () => {
        mockThemeService = {
            getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Light))
        };

        const chartMock = {
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
            isDisposed: vi.fn().mockReturnValue(false)
        };

        mockEchartsService = {
            init: vi.fn().mockResolvedValue(chartMock),
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [AdminQueueStatsComponent],
            providers: [
                { provide: AppThemeService, useValue: mockThemeService },
                { provide: EChartsLoaderService, useValue: mockEchartsService }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminQueueStatsComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('formatDuration', () => {
        it('should format milliseconds to readable string', () => {
            expect(component.formatDuration(1000)).toBe('1s');
            expect(component.formatDuration(61000)).toBe('1m 1s');
            expect(component.formatDuration(3661000)).toBe('1h 1m');
        });

        it('should return 0s for 0 or null', () => {
            expect(component.formatDuration(0)).toBe('0s');
        });
    });

    describe('getServiceLogo', () => {
        it('should return correct path for providers', () => {
            expect(component.getServiceLogo('Garmin')).toBe('assets/logos/garmin.svg');
            expect(component.getServiceLogo('suunto')).toBe('assets/logos/suunto.svg');
            expect(component.getServiceLogo('Coros')).toBe('assets/logos/coros.svg');
        });

        it('should return empty string for unknown', () => {
            expect(component.getServiceLogo('unknown')).toBe('');
        });
    });

    describe('Chart Updates', () => {
        it('should initialize chart when retry container appears after async stats load', async () => {
            component.loading = true;
            component.stats = null;
            fixture.detectChanges();
            await fixture.whenStable();

            expect(mockEchartsService.init).not.toHaveBeenCalled();

            const asyncStats: QueueStats = {
                pending: 4,
                succeeded: 20,
                stuck: 1,
                providers: [],
                advanced: {
                    throughput: 11,
                    maxLagMs: 2000,
                    retryHistogram: {
                        '0-3': 2,
                        '4-7': 1,
                        '8-9': 0
                    },
                    topErrors: []
                },
                cloudTasks: {
                    pending: 1,
                    queues: {
                        workout: { queueId: 'processWorkoutTask', pending: 1 },
                        sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 0 }
                    }
                },
                dlq: { total: 0, byContext: [], byProvider: [] }
            };

            component.loading = false;
            component.stats = asyncStats;
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockEchartsService.init).toHaveBeenCalledTimes(1);
            expect(mockEchartsService.setOption).toHaveBeenCalled();
        });

        it('should update chart data on input change', async () => {
            const mockStats: QueueStats = {
                pending: 10,
                succeeded: 100,
                stuck: 5,
                providers: [],
                advanced: {
                    throughput: 50,
                    maxLagMs: 1000,
                    retryHistogram: {
                        '0-3': 5,
                        '4-7': 3,
                        '8-9': 2
                    },
                    topErrors: []
                },
                cloudTasks: {
                    pending: 2,
                    queues: {
                        workout: { queueId: 'processWorkoutTask', pending: 2 },
                        sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 0 }
                    }
                },
                dlq: { total: 0, byContext: [], byProvider: [] }
            };

            component.stats = mockStats;
            component.ngOnChanges({ stats: new SimpleChange(null, mockStats, true) });
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockEchartsService.setOption).toHaveBeenCalled();
            const optionArg = mockEchartsService.setOption.mock.calls[0][1];
            expect(optionArg.series[0].data).toEqual([5, 3, 2]);
        });
    });

    describe('Cloud Tasks Queue Breakdown', () => {
        it('should render workout and reparse queue pending values', () => {
            component.loading = false;
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 50,
                    queues: {
                        workout: { queueId: 'processWorkoutTask', pending: 42 },
                        sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 8 }
                    }
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Cloud Tasks (Workout)');
            expect(host.textContent).toContain('Cloud Tasks (Reparse)');
            expect(host.textContent).toContain('42');
            expect(host.textContent).toContain('8');
        });

        it('should render zero for missing queue breakdown data', () => {
            component.loading = false;
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 7
                }
            };

            fixture.detectChanges();
            const queueValues = Array.from(
                fixture.nativeElement.querySelectorAll('.app-stat-card.status-info .app-stat-value')
            ).map((node: Element) => node.textContent?.trim() || '');

            expect(queueValues).toEqual(expect.arrayContaining(['7', '0', '0']));
        });
    });
});
