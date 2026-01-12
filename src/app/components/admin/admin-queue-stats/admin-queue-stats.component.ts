import { Component, Input, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { QueueStats } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
    selector: 'app-admin-queue-stats',
    templateUrl: './admin-queue-stats.component.html',
    styleUrls: ['./admin-queue-stats.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatButtonModule,
        MatTooltipModule,
        MatTableModule,
        BaseChartDirective
    ],
    providers: [provideCharts(withDefaultRegisterables())]
})
export class AdminQueueStatsComponent implements OnInit, OnChanges, OnDestroy {
    @Input() stats: QueueStats | null = null;
    @Input() loading = false;

    // Chart configuration
    public barChartLegend = true;
    public barChartPlugins = [];
    public barChartData: ChartConfiguration<'bar'>['data'] = {
        labels: ['0-3 Retries', '4-7 Retries', '8-9 Retries'],
        datasets: [
            { data: [0, 0, 0], label: 'Pending Items' }
        ]
    };
    public barChartOptions: ChartConfiguration<'bar'>['options'] = {
        responsive: true,
        maintainAspectRatio: false
    };

    // Theme constants
    private readonly CHART_TEXT_DARK = 'rgba(255, 255, 255, 0.8)';
    private readonly CHART_TEXT_LIGHT = 'rgba(0, 0, 0, 0.8)';
    private readonly CHART_GRID_DARK = 'rgba(255, 255, 255, 0.1)';
    private readonly CHART_GRID_LIGHT = 'rgba(0, 0, 0, 0.1)';

    private destroy$ = new Subject<void>();

    constructor(private appThemeService: AppThemeService) { }

    ngOnInit(): void {
        this.appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            this.updateChartTheme(theme);
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['stats'] && this.stats) {
            this.updateChartData();
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private updateChartData(): void {
        if (this.stats?.advanced?.retryHistogram) {
            this.barChartData = {
                labels: ['0-3 Retries', '4-7 Retries', '8-9 Retries'],
                datasets: [
                    {
                        data: [
                            this.stats.advanced.retryHistogram['0-3'],
                            this.stats.advanced.retryHistogram['4-7'],
                            this.stats.advanced.retryHistogram['8-9']
                        ],
                        label: 'Pending Items',
                        backgroundColor: [
                            'rgba(75, 192, 192, 0.6)', // Greenish
                            'rgba(255, 206, 86, 0.6)', // Yellowish
                            'rgba(255, 99, 132, 0.6)'  // Reddish
                        ]
                    }
                ]
            };
        }
    }

    private updateChartTheme(theme: AppThemes): void {
        const isDark = theme === AppThemes.Dark;
        const textColor = isDark ? this.CHART_TEXT_DARK : this.CHART_TEXT_LIGHT;
        const gridColor = isDark ? this.CHART_GRID_DARK : this.CHART_GRID_LIGHT;

        this.barChartOptions = {
            ...this.barChartOptions,
            scales: {
                x: {
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                },
                y: {
                    ticks: { color: textColor },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: {
                    labels: { color: textColor }
                }
            }
        };
    }

    formatDuration(ms: number): string {
        if (!ms) return '0s';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    getServiceLogo(provider: string): string {
        switch (provider.toLowerCase()) {
            case 'garmin': return 'assets/logos/garmin.svg';
            case 'suunto': return 'assets/logos/suunto.svg';
            case 'coros': return 'assets/logos/coros.svg';
            default: return '';
        }
    }
}
