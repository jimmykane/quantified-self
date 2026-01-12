import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminQueueStatsComponent } from './admin-queue-stats.component';
import { QueueStats } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { of } from 'rxjs';
import { AppThemes } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SimpleChange } from '@angular/core';

describe('AdminQueueStatsComponent', () => {
    let component: AdminQueueStatsComponent;
    let fixture: ComponentFixture<AdminQueueStatsComponent>;
    let mockThemeService: any;

    beforeEach(async () => {
        mockThemeService = {
            getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Light))
        };

        await TestBed.configureTestingModule({
            imports: [AdminQueueStatsComponent],
            providers: [
                { provide: AppThemeService, useValue: mockThemeService }
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
        it('should update chart data on input change', () => {
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
                cloudTasks: { pending: 2, succeeded: 5, failed: 1 },
                dlq: { total: 0, byContext: [], byProvider: [] }
            };

            // Direct assignment + OnChanges simulation
            component.stats = mockStats;
            component.ngOnChanges({
                stats: new SimpleChange(null, mockStats, true)
            });

            expect(component.barChartData.datasets[0].data).toEqual([5, 3, 2]);
        });
    });
});
