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
            dispose: vi.fn(),
            subscribeToViewportResize: vi.fn(() => () => { }),
            attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
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

    describe('formatTimestamp', () => {
        it('should format epoch milliseconds numbers', () => {
            const result = component.formatTimestamp(1700000000000);
            expect(result).not.toBe('1700000000000');
            expect(result).not.toBe('N/A');
        });

        it('should format firestore-like objects with _seconds', () => {
            const result = component.formatTimestamp({ _seconds: 1700000000, _nanoseconds: 0 });
            expect(result).not.toBe('[object Object]');
            expect(result).not.toBe('N/A');
        });

        it('should format timestamp objects with toMillis', () => {
            const result = component.formatTimestamp({ toMillis: () => 1700000000000 });
            expect(result).not.toBe('[object Object]');
            expect(result).not.toBe('N/A');
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
            expect(optionArg.backgroundColor).toBe('transparent');
            expect(optionArg.series[0].data).toEqual([5, 3, 2]);
        });
    });

    describe('Cloud Tasks Queue Breakdown', () => {
        it('should render workout, reparse, and derived queue pending values', () => {
            component.loading = false;
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 56,
                    queues: {
                        workout: { queueId: 'processWorkoutTask', pending: 42 },
                        sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 8 },
                        derivedMetrics: { queueId: 'processDerivedMetricsTask', pending: 6 }
                    }
                },
                derivedMetrics: {
                    coordinators: { idle: 2, queued: 1, processing: 1, failed: 1, total: 5 },
                    recentFailures: []
                },
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Cloud Tasks (Workout)');
            expect(host.textContent).toContain('Cloud Tasks (Reparse)');
            expect(host.textContent).toContain('Cloud Tasks (Derived Metrics)');
            expect(host.textContent).not.toContain('Cloud Tasks (All Queues)');
            expect(host.textContent).toContain('42');
            expect(host.textContent).toContain('8');
            expect(host.textContent).toContain('6');
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
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).not.toContain('Cloud Tasks (All Queues)');

            const cards = Array.from(host.querySelectorAll('.app-stat-card')) as HTMLElement[];
            const readCardValue = (label: string): string | undefined => {
                const card = cards.find((node) =>
                    node.querySelector('.app-stat-header span')?.textContent?.trim() === label
                );
                return card?.querySelector('.app-stat-value')?.textContent?.trim();
            };

            expect(readCardValue('Cloud Tasks (Workout)')).toBe('0');
            expect(readCardValue('Cloud Tasks (Reparse)')).toBe('0');
            expect(readCardValue('Cloud Tasks (Derived Metrics)')).toBe('0');
        });
    });

    describe('Queue View Filtering', () => {
        it('should hide workout section in reparse-only view', () => {
            component.loading = false;
            component.queueView = 'reparse';
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: { pending: 0 },
                reparse: {
                    queuePending: 0,
                    targetSportsLibVersion: '9.1.5',
                    jobs: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
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
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).not.toContain('Workout Ingestion');
            expect(host.textContent).toContain('Sports-lib Reparse');
            expect(host.textContent).not.toContain('Derived Metrics');
        });

        it('should hide reparse section in workout-only view', () => {
            component.loading = false;
            component.queueView = 'workout';
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: { pending: 0 },
                advanced: {
                    throughput: 0,
                    maxLagMs: 0,
                    retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 },
                    topErrors: []
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Workout Ingestion');
            expect(host.textContent).not.toContain('Sports-lib Reparse');
            expect(host.textContent).not.toContain('Derived Metrics');
        });

        it('should show only derived section in derived-only view', () => {
            component.loading = false;
            component.queueView = 'derived';
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 6,
                    queues: {
                        derivedMetrics: { queueId: 'processDerivedMetricsTask', pending: 6 }
                    }
                },
                derivedMetrics: {
                    coordinators: { idle: 1, queued: 2, processing: 0, failed: 1, total: 4 },
                    recentFailures: []
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Derived Metrics');
            expect(host.textContent).not.toContain('Workout Ingestion');
            expect(host.textContent).not.toContain('Sports-lib Reparse');
        });
    });

    describe('Reparse Section', () => {
        it('should render reparse job and checkpoint cards', () => {
            component.loading = false;
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 3,
                    queues: {
                        workout: { queueId: 'processWorkoutTask', pending: 1 },
                        sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 2 }
                    }
                },
                reparse: {
                    queuePending: 2,
                    targetSportsLibVersion: '9.1.4',
                    jobs: {
                        total: 10,
                        pending: 3,
                        processing: 2,
                        completed: 4,
                        failed: 1
                    },
                    checkpoint: {
                        cursorEventPath: null,
                        lastScanAt: new Date('2026-02-20T14:00:00Z'),
                        lastPassStartedAt: new Date('2026-02-20T13:50:00Z'),
                        lastPassCompletedAt: new Date('2026-02-20T13:59:00Z'),
                        lastScanCount: 200,
                        lastEnqueuedCount: 100,
                        overrideUsersInProgress: 1
                    },
                    recentFailures: []
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Sports-lib Reparse');
            expect(host.textContent).toContain('Reparse Jobs (Pending)');
            expect(host.textContent).toContain('Reparse Jobs (Processing)');
            expect(host.textContent).toContain('Reparse Jobs (Completed)');
            expect(host.textContent).toContain('Reparse Jobs (Failed)');
            expect(host.textContent).toContain('9.1.4');
            expect(host.textContent).toContain('200');
            expect(host.textContent).toContain('100');
        });

        it('should render reparse failures table rows when failures are present', () => {
            component.loading = false;
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 2,
                    queues: {
                        workout: { queueId: 'processWorkoutTask', pending: 1 },
                        sportsLibReparse: { queueId: 'processSportsLibReparseTask', pending: 1 }
                    }
                },
                reparse: {
                    queuePending: 1,
                    targetSportsLibVersion: '9.1.4',
                    jobs: {
                        total: 1,
                        pending: 0,
                        processing: 0,
                        completed: 0,
                        failed: 1
                    },
                    checkpoint: {
                        cursorEventPath: null,
                        lastScanAt: null,
                        lastPassStartedAt: null,
                        lastPassCompletedAt: null,
                        lastScanCount: 0,
                        lastEnqueuedCount: 0,
                        overrideUsersInProgress: 0
                    },
                    recentFailures: [
                        {
                            jobId: 'job1',
                            uid: 'uid-1',
                            eventId: 'event-1',
                            attemptCount: 2,
                            lastError: 'Parse failed',
                            updatedAt: new Date('2026-02-20T14:30:00Z'),
                            targetSportsLibVersion: '9.1.4'
                        }
                    ]
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Recent Reparse Failures');
            expect(host.textContent).toContain('uid-1');
            expect(host.textContent).toContain('event-1');
            expect(host.textContent).toContain('Parse failed');
        });
    });

    describe('Derived Section', () => {
        it('should render coordinator cards and derived failures table', () => {
            component.loading = false;
            component.stats = {
                pending: 1,
                succeeded: 1,
                stuck: 0,
                providers: [],
                cloudTasks: {
                    pending: 7,
                    queues: {
                        derivedMetrics: { queueId: 'processDerivedMetricsTask', pending: 7 }
                    }
                },
                derivedMetrics: {
                    coordinators: { idle: 2, queued: 3, processing: 1, failed: 1, total: 7 },
                    recentFailures: [
                        {
                            uid: 'uid-derived',
                            generation: 8,
                            dirtyMetricKinds: ['form', 'recovery_now'],
                            lastError: 'Worker timeout',
                            updatedAtMs: 1700000000000
                        }
                    ]
                }
            };

            fixture.detectChanges();
            const host: HTMLElement = fixture.nativeElement;
            expect(host.textContent).toContain('Cloud Tasks (Derived Metrics)');
            expect(host.textContent).toContain('Coordinators (Queued)');
            expect(host.textContent).toContain('Coordinators (Processing)');
            expect(host.textContent).toContain('Coordinators (Failed)');
            expect(host.textContent).toContain('Coordinators (Idle)');
            expect(host.textContent).toContain('Coordinators (Total)');
            expect(host.textContent).toContain('Recent Derived Metrics Failures');
            expect(host.textContent).toContain('uid-derived');
            expect(host.textContent).toContain('Worker timeout');
        });
    });
});
