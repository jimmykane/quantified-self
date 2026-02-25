import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';

import { QueueStats, ReparseFailurePreview } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { EChartsHostController } from '../../../helpers/echarts-host-controller';

export type AdminQueueStatsView = 'all' | 'workout' | 'reparse';

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
        MatTableModule
    ]
})
export class AdminQueueStatsComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
    @Input() stats: QueueStats | null = null;
    @Input() loading = false;
    @Input() queueView: AdminQueueStatsView = 'all';
    hasRetryData = false;
    readonly reparseFailureColumns = ['uid', 'eventId', 'attemptCount', 'updatedAt', 'lastError'];

    @ViewChild('retryChart')
    set retryChartRef(ref: ElementRef<HTMLDivElement> | undefined) {
        this._retryChartRef = ref;

        if (!ref) {
            this.chartHost.dispose();
            return;
        }

        if (this.viewInitialized) {
            void this.tryInitializeChartAndRender();
        }
    }

    private chartHost: EChartsHostController;
    private chartInitialization: Promise<void> | null = null;
    private viewInitialized = false;
    private _retryChartRef: ElementRef<HTMLDivElement> | undefined;
    private isDark = false;

    // Theme constants
    private readonly CHART_TEXT_DARK = 'rgba(255, 255, 255, 0.8)';
    private readonly CHART_TEXT_LIGHT = 'rgba(0, 0, 0, 0.8)';
    private readonly CHART_GRID_DARK = 'rgba(255, 255, 255, 0.1)';
    private readonly CHART_GRID_LIGHT = 'rgba(0, 0, 0, 0.1)';

    private destroy$ = new Subject<void>();

    constructor(
        private appThemeService: AppThemeService,
        private eChartsLoader: EChartsLoaderService,
        private zone: NgZone
    ) {
        this.chartHost = new EChartsHostController({
            eChartsLoader: this.eChartsLoader,
            zone: this.zone,
            logPrefix: '[AdminQueueStatsComponent]'
        });
    }

    ngOnInit(): void {
        this.appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            this.isDark = theme === AppThemes.Dark;
            this.updateChartTheme();
        });
    }

    async ngAfterViewInit(): Promise<void> {
        this.viewInitialized = true;
        await this.tryInitializeChartAndRender();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['stats'] || changes['loading']) {
            void this.tryInitializeChartAndRender();
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.chartHost.dispose();
    }

    private async tryInitializeChartAndRender(): Promise<void> {
        await this.initializeChart();
        this.updateChartData();
    }

    private async initializeChart(): Promise<void> {
        if (this.chartHost.getChart() || this.chartInitialization || !this._retryChartRef?.nativeElement) {
            return;
        }

        const container = this._retryChartRef.nativeElement;
        this.chartInitialization = (async () => {
            try {
                await this.chartHost.init(container);
            } catch (error) {
                console.error('[AdminQueueStatsComponent] Failed to initialize ECharts', error);
            } finally {
                this.chartInitialization = null;
            }
        })();

        await this.chartInitialization;
    }

    private updateChartData(): void {
        if (!this.chartHost.getChart() || !this._retryChartRef?.nativeElement) {
            return;
        }

        const histogram = this.stats?.advanced?.retryHistogram;
        const values = histogram
            ? [
                histogram['0-3'] ?? 0,
                histogram['4-7'] ?? 0,
                histogram['8-9'] ?? 0
            ]
            : [0, 0, 0];
        const maxValue = Math.max(...values);
        this.hasRetryData = maxValue > 0;

        const textColor = this.isDark ? this.CHART_TEXT_DARK : this.CHART_TEXT_LIGHT;
        const gridColor = this.isDark ? this.CHART_GRID_DARK : this.CHART_GRID_LIGHT;

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: (params: any) => {
                    const item = Array.isArray(params) ? params[0] : params;
                    return `${item?.axisValueLabel || item?.name}: ${item?.value ?? 0}`;
                }
            },
            grid: { left: 18, right: 18, bottom: 32, top: 16, containLabel: true },
            xAxis: {
                type: 'category',
                data: ['0-3 Retries', '4-7 Retries', '8-9 Retries'],
                axisLabel: { color: textColor },
                axisLine: { lineStyle: { color: gridColor } },
                axisTick: { alignWithLabel: true }
            },
            yAxis: {
                type: 'value',
                min: 0,
                minInterval: 1,
                max: maxValue === 0 ? 1 : undefined,
                axisLabel: { color: textColor },
                splitLine: { lineStyle: { color: gridColor, width: 1.2 } }
            },
            series: [
                {
                    type: 'bar',
                    name: 'Pending Items',
                    data: values,
                    barMaxWidth: 54,
                    barCategoryGap: '30%',
                    barMinHeight: 8,
                    itemStyle: {
                        color: (params: any) => {
                            const idx = params?.dataIndex ?? 0;
                            if (idx === 0) return '#4caf50';
                            if (idx === 1) return '#ffb300';
                            return '#f44336';
                        },
                        borderRadius: [6, 6, 0, 0],
                        shadowBlur: 6,
                        shadowColor: this.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.18)'
                    },
                    label: {
                        show: true,
                        position: 'top',
                        color: textColor,
                        fontWeight: 600,
                        fontSize: 12,
                        distance: 6
                    }
                }
            ]
        };

        this.chartHost.setOption(option, { notMerge: true, lazyUpdate: true });
        this.chartHost.scheduleResize();
    }

    private updateChartTheme(): void {
        if (!this.chartHost.getChart()) {
            return;
        }
        this.updateChartData();
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

    getReparseFailureRows(): ReparseFailurePreview[] {
        return this.stats?.reparse?.recentFailures || [];
    }

    get showWorkoutSection(): boolean {
        return this.queueView !== 'reparse';
    }

    get showReparseSection(): boolean {
        return this.queueView !== 'workout';
    }

    formatTimestamp(value: unknown): string {
        if (!value) {
            return 'N/A';
        }
        if (typeof (value as { toDate?: unknown }).toDate === 'function') {
            const tsDate = (value as { toDate: () => Date }).toDate();
            return tsDate.toLocaleString();
        }
        if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
            const tsMillis = (value as { toMillis: () => number }).toMillis();
            if (!Number.isNaN(tsMillis)) {
                return new Date(tsMillis).toLocaleString();
            }
        }
        if (value instanceof Date) {
            return value.toLocaleString();
        }
        if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, unknown>;
            const rawSeconds = obj.seconds ?? obj._seconds;
            if (rawSeconds !== undefined && rawSeconds !== null) {
                const tsSeconds = Number(rawSeconds);
                if (!Number.isNaN(tsSeconds)) {
                    return new Date(tsSeconds * 1000).toLocaleString();
                }
            }
        }
        const date = new Date(`${value}`);
        if (Number.isNaN(date.getTime())) {
            return `${value}`;
        }
        return date.toLocaleString();
    }
}
