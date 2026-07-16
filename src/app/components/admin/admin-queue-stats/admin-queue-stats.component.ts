import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { AdminService, QueueStats, ReparseFailurePreview, RouteReparseFailurePreview } from '../../../services/admin.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import {
    ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
    EChartsHostController
} from '../../../helpers/echarts-host-controller';
import { buildOfficialEChartsThemeTokens, ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';

export type AdminQueueStatsView = 'all' | 'workout' | 'activity-sync' | 'route-delivery-sync' | 'route-sync' | 'sleep-sync' | 'reparse' | 'route-reparse' | 'derived';

type ReparseFailureRowView = ReparseFailurePreview & {
    outcome: 'active_failure' | 'historical_failure' | 'superseded';
    outcomeLabel: string;
    tierLabel: string;
    reasonLabel: string;
    durationLabel: string;
    updatedAtLabel: string;
    retryHeavyDisabled: boolean;
    retryHeavyTooltip: string;
    retryHeavyAriaLabel: string;
    retryingHeavy: boolean;
};

type RouteReparseFailureRowView = RouteReparseFailurePreview & {
    updatedAtLabel: string;
};

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
        MatCardModule,
        MatSnackBarModule
    ]
})
export class AdminQueueStatsComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
    private _stats: QueueStats | null = null;

    @Input()
    get stats(): QueueStats | null {
        return this._stats;
    }

    set stats(value: QueueStats | null) {
        this._stats = value;
        this.updateReparseFailureRows();
    }

    @Input() loading = false;
    @Input() queueView: AdminQueueStatsView = 'all';
    @Output() retryHeavyCompleted = new EventEmitter<void>();
    hasRetryData = false;
    readonly reparseFailureColumns = ['outcome', 'uid', 'eventId', 'attemptCount', 'processingTier', 'heavyReason', 'eventDurationMs', 'updatedAt', 'lastError', 'actions'];
    readonly routeReparseFailureColumns = ['uid', 'routeId', 'attemptCount', 'updatedAt', 'lastError'];
    readonly derivedFailureColumns = ['uid', 'generation', 'dirtyMetricKinds', 'updatedAtMs', 'lastError'];
    readonly retryingHeavyJobIds = new Set<string>();
    reparseFailureRows: ReparseFailureRowView[] = [];
    routeReparseFailureRows: RouteReparseFailureRowView[] = [];

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

    private destroy$ = new Subject<void>();

    constructor(
        private appThemeService: AppThemeService,
        private eChartsLoader: EChartsLoaderService,
        private adminService: AdminService,
        private snackBar: MatSnackBar
    ) {
        this.chartHost = new EChartsHostController({
            eChartsLoader: this.eChartsLoader,
            logPrefix: '[AdminQueueStatsComponent]'
        });
    }

    ngOnInit(): void {
        this.appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            this.isDark = theme === AppThemes.Dark;
            void this.updateChartTheme();
        });
    }

    async ngAfterViewInit(): Promise<void> {
        this.viewInitialized = true;
        await this.tryInitializeChartAndRender();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['stats']) {
            this.updateReparseFailureRows();
        }
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
                await this.chartHost.init(container, resolveEChartsThemeName(this.isDark));
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

        const histogram = this.getActiveRetryHistogram();
        const values = histogram
            ? [
                histogram['0-3'] ?? 0,
                histogram['4-7'] ?? 0,
                histogram['8-9'] ?? 0
            ]
            : [0, 0, 0];
        const maxValue = Math.max(...values);
        this.hasRetryData = maxValue > 0;

        const themeTokens = buildOfficialEChartsThemeTokens(this.isDark);
        const textColor = themeTokens.textSecondary;
        const gridColor = themeTokens.splitLineColor;

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                textStyle: { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
                formatter: (params: any) => {
                    const item = Array.isArray(params) ? params[0] : params;
                    return `${item?.axisValueLabel || item?.name}: ${item?.value ?? 0}`;
                }
            },
            grid: {
                left: 18,
                right: 18,
                bottom: 32,
                top: 16,
                outerBoundsMode: 'same',
                outerBoundsContain: 'axisLabel'
            },
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
                        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                        fontWeight: 600,
                        fontSize: 12,
                        distance: 6
                    }
                }
            ]
        };

        this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
        this.chartHost.scheduleResize();
    }

    private getActiveRetryHistogram(): { '0-3': number; '4-7': number; '8-9': number } | null {
        if (this.queueView === 'activity-sync') {
            return this.stats?.activitySync?.advanced?.retryHistogram || null;
        }

        if (this.queueView === 'route-sync') {
            return this.stats?.routeSync?.advanced?.retryHistogram || null;
        }

        if (this.queueView === 'route-delivery-sync') {
            return this.stats?.routeDeliverySync?.advanced?.retryHistogram || null;
        }

        if (this.queueView === 'sleep-sync') {
            return this.stats?.sleepSync?.advanced?.retryHistogram || null;
        }

        return this.stats?.advanced?.retryHistogram || null;
    }

    private async updateChartTheme(): Promise<void> {
        if (!this._retryChartRef?.nativeElement) {
            return;
        }
        await this.chartHost.init(this._retryChartRef.nativeElement, resolveEChartsThemeName(this.isDark));
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

    private updateReparseFailureRows(): void {
        this.reparseFailureRows = (this.stats?.reparse?.recentFailures || []).map(row => {
            const jobId = `${row.jobId || ''}`.trim();
            const retryingHeavy = !!jobId && this.retryingHeavyJobIds.has(jobId);
            const outcome = this.resolveReparseOutcome(row);
            return {
                ...row,
                outcome,
                outcomeLabel: this.getReparseOutcomeLabel(row, outcome),
                tierLabel: this.getReparseTierLabel(row),
                reasonLabel: this.getReparseReasonLabel(row),
                durationLabel: this.formatOptionalDuration(row.eventDurationMs),
                updatedAtLabel: this.formatTimestamp(row.updatedAt),
                retryHeavyDisabled: !jobId || retryingHeavy || outcome !== 'active_failure',
                retryHeavyTooltip: outcome === 'active_failure'
                    ? 'Retry this failed reparse job on the heavy queue'
                    : 'Old-target outcomes are resolved records and cannot be retried',
                retryHeavyAriaLabel: outcome === 'active_failure'
                    ? 'Retry failed reparse job on heavy queue'
                    : 'Resolved reparse outcome cannot be retried',
                retryingHeavy,
            };
        });
        this.routeReparseFailureRows = (this.stats?.routeReparse?.recentFailures || []).map(row => ({
            ...row,
            updatedAtLabel: this.formatTimestamp(row.updatedAt),
        }));
    }

    private getReparseTierLabel(row: ReparseFailurePreview): string {
        return row.processingTier === 'heavy' ? 'Heavy' : 'Normal';
    }

    private resolveReparseOutcome(
        row: ReparseFailurePreview,
    ): 'active_failure' | 'historical_failure' | 'superseded' {
        if (row.outcome) {
            return row.outcome;
        }
        const targetVersion = `${row.targetSportsLibVersion || ''}`.trim();
        const currentTargetVersion = `${this.stats?.reparse?.targetSportsLibVersion || ''}`.trim();
        return targetVersion && currentTargetVersion && targetVersion !== currentTargetVersion
            ? 'historical_failure'
            : 'active_failure';
    }

    private getReparseOutcomeLabel(
        row: ReparseFailurePreview,
        outcome: 'active_failure' | 'historical_failure' | 'superseded',
    ): string {
        if (outcome === 'superseded') {
            return row.supersededBySportsLibVersion
                ? `Superseded by ${row.supersededBySportsLibVersion}`
                : 'Superseded';
        }
        if (outcome === 'historical_failure') {
            return row.targetSportsLibVersion
                ? `Historical (${row.targetSportsLibVersion})`
                : 'Historical';
        }
        return 'Active failure';
    }

    private getReparseReasonLabel(row: ReparseFailurePreview): string {
        if (row.heavyReason === 'duration_gt_32h') {
            return 'Duration > 32h';
        }
        if (row.heavyReason === 'duration_gt_24h') {
            return 'Duration > 24h';
        }
        if (row.heavyReason === 'manual_admin') {
            return 'Manual admin';
        }
        return row.heavyReason || 'N/A';
    }

    private formatOptionalDuration(ms: number | null | undefined): string {
        return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
            ? this.formatDuration(ms)
            : 'N/A';
    }

    retryHeavy(row: ReparseFailurePreview): void {
        const jobId = `${row.jobId || ''}`.trim();
        if (!jobId || this.retryingHeavyJobIds.has(jobId) || this.resolveReparseOutcome(row) !== 'active_failure') {
            return;
        }

        this.retryingHeavyJobIds.add(jobId);
        this.updateReparseFailureRows();
        this.adminService.retrySportsLibReparseHeavyJob(jobId)
            .pipe(
                takeUntil(this.destroy$),
                finalize(() => {
                    this.retryingHeavyJobIds.delete(jobId);
                    this.updateReparseFailureRows();
                })
            )
            .subscribe({
                next: (response) => {
                    const action = response.taskCreated ? 'created' : 'already exists';
                    this.snackBar.open(`Heavy reparse task ${action}.`, 'Dismiss', { duration: 4000 });
                    this.retryHeavyCompleted.emit();
                },
                error: (error) => {
                    this.snackBar.open(this.getRetryHeavyErrorMessage(error), 'Dismiss', { duration: 6000 });
                },
            });
    }

    getDerivedMetricsFailureRows(): {
        uid: string;
        generation: number;
        dirtyMetricKinds: string[];
        lastError: string;
        updatedAtMs: number;
    }[] {
        return this.stats?.derivedMetrics?.recentFailures || [];
    }

    getSleepDisabledProvidersLabel(): string {
        const providers = this.stats?.sleepSync?.disabledProviders || [];
        return providers.length ? providers.join(', ') : 'None';
    }

    private getRetryHeavyErrorMessage(error: unknown): string {
        const rawMessage = (error as { message?: unknown } | undefined)?.message;
        const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
        return message || 'Failed to enqueue heavy reparse task.';
    }

    get showWorkoutSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'workout';
    }

    get showActivitySyncSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'activity-sync';
    }

    get showRouteDeliverySyncSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'route-delivery-sync';
    }

    get showSleepSyncSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'sleep-sync';
    }

    get showRouteSyncSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'route-sync';
    }

    get showReparseSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'reparse';
    }

    get showRouteReparseSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'route-reparse';
    }

    get showDerivedSection(): boolean {
        return this.queueView === 'all' || this.queueView === 'derived';
    }

    formatTimestamp(value: unknown): string {
        if (!value) {
            return 'N/A';
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            const parsedFromEpoch = new Date(value);
            if (!Number.isNaN(parsedFromEpoch.getTime())) {
                return parsedFromEpoch.toLocaleString();
            }
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
