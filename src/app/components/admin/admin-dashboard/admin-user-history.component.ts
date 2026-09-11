import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
    ADMIN_DASHBOARD_HISTORY_MINIMUM_POINTS,
    buildAdminDashboardHistoryView,
} from '../../../helpers/admin-dashboard-history.helper';
import {
    buildDashboardEChartsStyleTokens,
    buildDashboardEChartsTooltipChrome,
    renderDashboardEChartsTooltipCard,
} from '../../../helpers/dashboard-echarts-style.helper';
import type { DashboardEChartsTooltipMetricRow } from '../../../helpers/dashboard-echarts-style.helper';
import {
    ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
    EChartsHostController,
} from '../../../helpers/echarts-host-controller';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import type {
    AdminDashboardHistoryDays,
    AdminDashboardHistoryPoint,
    AdminDashboardHistoryResponse,
    AuthActivityWindowKey,
} from '../../../services/admin.service';
import { buildAdminHistoryAxisBounds, type AdminHistoryScale } from '../../../helpers/admin-history-axis.helper';
import { adminHistoryMetrics, type HistoryChartKey } from '../../../helpers/admin-history-series.helper';
import { adminHistoryPercentage, formatAdminHistoryPercentage, formatAdminHistoryTooltipValue, type AdminHistoryDisplayMode, type AdminHistoryPlanBasis } from '../../../helpers/admin-history-percentage.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
    selector: 'app-admin-user-history',
    standalone: true,
    imports: [
        CommonModule,
        MatButtonToggleModule,
        MatButtonModule,
        MatChipsModule,
        MatCardModule,
        MatIconModule,
        MatProgressSpinnerModule,
    ],
    templateUrl: './admin-user-history.component.html',
    styleUrls: ['./admin-user-history.component.scss'],
})
export class AdminUserHistoryComponent implements OnDestroy {
    private readonly haptics = inject(AppHapticsService);
    private readonly selectedSeriesState = signal<Partial<Record<HistoryChartKey, readonly string[]>>>({});
    private readonly historyState = signal<AdminDashboardHistoryResponse | null>(null);
    private readonly destroy$ = new Subject<void>();
    private readonly authChartHost: EChartsHostController;
    private readonly activePlanChartHost: EChartsHostController;
    private readonly userMixChartHost: EChartsHostController;
    private readonly onboardingChartHost: EChartsHostController;
    private readonly cadenceChartHost: EChartsHostController;
    private authChartRef?: ElementRef<HTMLDivElement>;
    private activePlanChartRef?: ElementRef<HTMLDivElement>;
    private userMixChartRef?: ElementRef<HTMLDivElement>;
    private onboardingChartRef?: ElementRef<HTMLDivElement>;
    private cadenceChartRef?: ElementRef<HTMLDivElement>;
    private isDark = false;
    private destroyed = false;
    private renderQueued = false;

    @Input()
    set history(value: AdminDashboardHistoryResponse | null) {
        this.historyState.set(value);
        this.scheduleRender();
    }

    get history(): AdminDashboardHistoryResponse | null {
        return this.historyState();
    }

    @Input() loading = false;
    @Input() error: string | null = null;

    @ViewChild('authChart')
    set authChart(value: ElementRef<HTMLDivElement> | undefined) {
        this.authChartRef = value;
        this.handleChartReference(value, this.authChartHost);
    }

    @ViewChild('userMixChart')
    set userMixChart(value: ElementRef<HTMLDivElement> | undefined) {
        this.userMixChartRef = value;
        this.handleChartReference(value, this.userMixChartHost);
    }

    @ViewChild('activePlanChart')
    set activePlanChart(value: ElementRef<HTMLDivElement> | undefined) {
        this.activePlanChartRef = value;
        this.handleChartReference(value, this.activePlanChartHost);
    }

    @ViewChild('onboardingChart')
    set onboardingChart(value: ElementRef<HTMLDivElement> | undefined) {
        this.onboardingChartRef = value;
        this.handleChartReference(value, this.onboardingChartHost);
    }

    @ViewChild('cadenceChart')
    set cadenceChart(value: ElementRef<HTMLDivElement> | undefined) {
        this.cadenceChartRef = value;
        this.handleChartReference(value, this.cadenceChartHost);
    }

    readonly selectedMode = signal<AdminHistoryDisplayMode>('count');
    readonly selectedActivePlanBasis = signal<AdminHistoryPlanBasis>('withinPlan');
    readonly selectedScale = signal<AdminHistoryScale>('auto');
    readonly seriesControls = computed(() => {
        const choices = Object.fromEntries(
            (['activity', 'activePlans', 'userMix', 'onboarding', 'cadence'] as const).map(key => [
                key, this.metricsForChart(key).map(metric => ({ name: metric.name, color: metric.color })),
            ]),
        ) as Record<HistoryChartKey, Array<{ name: string; color: string }>>;
        const control = (key: HistoryChartKey) => {
            const names = choices[key].map(choice => choice.name);
            const requested = this.selectedSeriesState()[key];
            const matching = names.filter(name => !requested || requested.includes(name));
            // A range may no longer contain the only selected unknown-cadence series.
            const selected = matching.length ? matching : names;
            return { choices: choices[key], names, selected, allSelected: selected.length === names.length };
        };
        return {
            activity: control('activity'),
            activePlans: control('activePlans'),
            userMix: control('userMix'),
            cadence: control('cadence'),
            onboarding: control('onboarding'),
        };
    });
    readonly selectedDays = signal<AdminDashboardHistoryDays>(90);
    readonly selectedActivePlanWindow = signal<AuthActivityWindowKey>('last30Days');
    readonly minimumPoints = ADMIN_DASHBOARD_HISTORY_MINIMUM_POINTS;
    readonly ranges: ReadonlyArray<{ days: AdminDashboardHistoryDays; label: string }> = [
        { days: 30, label: '30d' },
        { days: 90, label: '90d' },
        { days: 365, label: '1y' },
    ];
    readonly activePlanWindows: ReadonlyArray<{ window: AuthActivityWindowKey; label: string }> = [
        { window: 'last24Hours', label: '24h' },
        { window: 'last7Days', label: '7d' },
        { window: 'last30Days', label: '30d' },
    ];
    readonly historyView = computed(() => buildAdminDashboardHistoryView(
        this.historyState(),
        this.selectedDays(),
    ));
    readonly activePlanHistoryPoints = computed(() => this.historyView().observed.filter(
        snapshot => snapshot.authActivity.byPlan != null && (
            this.selectedMode() === 'count' || this.selectedActivePlanBasis() === 'activeShare'
            || snapshot.authActivity.eligibleByPlan != null
        ),
    ).length);

    constructor(
        appThemeService: AppThemeService,
        eChartsLoader: EChartsLoaderService,
        logger: LoggerService,
    ) {
        const hostConfig = (logPrefix: string) => ({ eChartsLoader, logger, logPrefix });
        this.authChartHost = new EChartsHostController(hostConfig('[AdminUserHistory:activity]'));
        this.activePlanChartHost = new EChartsHostController(hostConfig('[AdminUserHistory:active-plans]'));
        this.userMixChartHost = new EChartsHostController(hostConfig('[AdminUserHistory:plans]'));
        this.onboardingChartHost = new EChartsHostController(hostConfig('[AdminUserHistory:onboarding]'));
        this.cadenceChartHost = new EChartsHostController(hostConfig('[AdminUserHistory:cadence]'));

        appThemeService.getAppTheme().pipe(takeUntil(this.destroy$)).subscribe(theme => {
            const nextIsDark = theme === AppThemes.Dark;
            if (this.isDark === nextIsDark) {
                return;
            }
            this.isDark = nextIsDark;
            this.disposeCharts();
            this.scheduleRender();
        });
    }

    selectDays(days: AdminDashboardHistoryDays): void {
        if (!this.ranges.some(range => range.days === days) || this.selectedDays() === days) {
            return;
        }
        this.selectedDays.set(days);
        this.haptics.selection();
        this.scheduleRender();
    }

    selectActivePlanWindow(window: AuthActivityWindowKey): void {
        if (
            !this.activePlanWindows.some(option => option.window === window)
            || this.selectedActivePlanWindow() === window
        ) {
            return;
        }
        this.selectedActivePlanWindow.set(window);
        this.haptics.selection();
        this.scheduleRender();
    }

    selectMode(mode: AdminHistoryDisplayMode): void {
        if ((mode !== 'count' && mode !== 'percentage') || this.selectedMode() === mode) {
            return;
        }
        this.selectedMode.set(mode);
        this.haptics.selection();
        this.scheduleRender();
    }

    selectActivePlanBasis(basis: AdminHistoryPlanBasis): void {
        if (this.selectedMode() !== 'percentage'
            || (basis !== 'withinPlan' && basis !== 'activeShare') || this.selectedActivePlanBasis() === basis) {
            return;
        }
        this.selectedActivePlanBasis.set(basis);
        this.haptics.selection();
        this.scheduleRender();
    }

    selectScale(scale: AdminHistoryScale): void {
        if ((scale !== 'auto' && scale !== 'zero') || this.selectedScale() === scale) {
            return;
        }
        this.selectedScale.set(scale);
        this.haptics.selection();
        this.scheduleRender();
    }

    selectSeries(key: HistoryChartKey, names: readonly string[]): void {
        const control = this.seriesControls()[key];
        const selected = control.names.filter(name => names.includes(name));
        if (!selected.length || selected.join('|') === control.selected.join('|')) {
            return;
        }
        this.selectedSeriesState.update(state => ({ ...state, [key]: selected }));
        this.haptics.selection();
        this.scheduleRender();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.destroy$.next();
        this.destroy$.complete();
        this.disposeCharts();
    }

    private handleChartReference(
        reference: ElementRef<HTMLDivElement> | undefined,
        host: EChartsHostController,
    ): void {
        if (!reference) {
            host.dispose();
            return;
        }
        this.scheduleRender();
    }

    private scheduleRender(): void {
        if (this.destroyed || this.renderQueued) {
            return;
        }
        // Inputs and ViewChild setters can all change in the same view update.
        // Render their final state once instead of redrawing every chart for each setter.
        this.renderQueued = true;
        void Promise.resolve().then(() => {
            this.renderQueued = false;
            return this.renderCharts();
        });
    }

    private async renderCharts(): Promise<void> {
        // A display change can queue this work just before the workspace is closed.
        if (this.destroyed) {
            return;
        }
        const view = this.historyView();
        if (this.loading || this.error || view.availablePoints < this.minimumPoints) {
            return;
        }

        await Promise.all([
            this.renderChart('activity', this.authChartHost, this.authChartRef, () => this.buildMetricOption('activity', this.authChartRef)),
            this.renderChart('activePlans', this.activePlanChartHost, this.activePlanChartRef, () => this.buildMetricOption('activePlans', this.activePlanChartRef)),
            this.renderChart('userMix', this.userMixChartHost, this.userMixChartRef, () => this.buildMetricOption('userMix', this.userMixChartRef)),
            this.renderChart('onboarding', this.onboardingChartHost, this.onboardingChartRef, () => this.buildMetricOption('onboarding', this.onboardingChartRef)),
            this.renderChart('cadence', this.cadenceChartHost, this.cadenceChartRef, () => this.buildMetricOption('cadence', this.cadenceChartRef)),
        ]);
    }

    private async renderChart(
        key: HistoryChartKey,
        host: EChartsHostController,
        reference: ElementRef<HTMLDivElement> | undefined,
        buildOption: () => Record<string, unknown>,
    ): Promise<void> {
        if (!reference?.nativeElement) {
            return;
        }
        const chart = await host.init(reference.nativeElement, resolveEChartsThemeName(this.isDark));
        if (!chart || this.destroyed) {
            return;
        }
        const option = buildOption();
        const series = option['series'] as Array<{ name: string; data: Array<number | null> }>;
        const selected = this.seriesControls()[key].selected;
        const bounds = buildAdminHistoryAxisBounds(
            series.filter(item => selected.includes(item.name)).map(item => item.data),
            this.selectedScale(),
            this.selectedMode(),
        );
        host.setOption({
            ...option,
            legend: {
                show: false,
                data: series.map(item => item.name),
                selected: Object.fromEntries(series.map(item => [item.name, selected.includes(item.name)])),
            },
            yAxis: { ...(option['yAxis'] as Record<string, unknown>), ...bounds },
        }, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
        host.scheduleResize();
    }

    private metricsForChart(key: HistoryChartKey) {
        return adminHistoryMetrics(key, this.selectedActivePlanWindow(), this.selectedActivePlanBasis())
            .filter(metric => !metric.onlyWhenNonzero
                || this.historyView().observed.some(point => (metric.count(point) ?? 0) > 0));
    }

    private buildMetricOption(key: HistoryChartKey, reference: ElementRef<HTMLDivElement> | undefined): Record<string, unknown> {
        const view = this.historyView();
        const style = this.chartStyle(reference);
        const metrics = this.metricsForChart(key);
        const percentage = this.selectedMode() === 'percentage';
        return {
            ...this.buildCartesianBase(style, view.timeline.map(item => item.date)),
            color: metrics.map(metric => metric.color),
            tooltip: {
                ...buildDashboardEChartsTooltipChrome(style),
                trigger: 'axis',
                confine: true,
                formatter: (params: unknown) => {
                    const snapshot = this.snapshotFromTooltip(params);
                    if (!snapshot) {
                        return '';
                    }
                    return renderDashboardEChartsTooltipCard(style, {
                        title: this.formatFullDate(snapshot.date),
                        subtitle: key === 'activePlans' ? this.activePlanWindowLabel(this.selectedActivePlanWindow()) : undefined,
                        rows: this.visibleTooltipRows(key, metrics.map(metric => ({
                            label: metric.name,
                            ...formatAdminHistoryTooltipValue(
                                metric.count(snapshot), metric.denominator(snapshot), metric.population, this.selectedMode(),
                            ),
                            markerColor: metric.color,
                        }))),
                        rowColumnCount: 1,
                        stackHeader: true,
                    });
                },
            },
            series: metrics.map(metric => {
                const data = view.timeline.map(({ snapshot }) => !snapshot ? null
                    : percentage ? adminHistoryPercentage(metric.count(snapshot), metric.denominator(snapshot))
                    : metric.count(snapshot) ?? null);
                return {
                    name: metric.name,
                    id: metric.id ?? `${key}-${metric.name}`,
                    type: 'line', data, connectNulls: false,
                    showSymbol: data.length <= 90,
                    symbol: metric.symbol ?? 'circle', symbolSize: 5,
                    lineStyle: { width: 2, type: metric.lineType },
                    itemStyle: { color: metric.color },
                    emphasis: { focus: 'series' },
                };
            }),
        };
    }

    private buildCartesianBase(
        style: ReturnType<typeof buildDashboardEChartsStyleTokens>,
        dates: string[],
    ): Record<string, unknown> {
        const labelStep = Math.max(1, Math.ceil(dates.length / (style.isCompactLayout ? 5 : 9)));
        return {
            backgroundColor: 'transparent',
            animationDuration: 250,
            textStyle: { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
            grid: {
                left: 16,
                right: 18,
                top: 18,
                bottom: 30,
                outerBoundsMode: 'same',
                outerBoundsContain: 'axisLabel',
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: dates,
                axisLine: { lineStyle: { color: style.axisColor } },
                axisTick: { show: false },
                axisLabel: {
                    color: style.secondaryTextColor,
                    fontSize: style.axisFontSize,
                    hideOverlap: true,
                    interval: (index: number) => index === 0 || index === dates.length - 1 || index % labelStep === 0,
                    formatter: (value: string) => this.formatAxisDate(value),
                },
            },
            yAxis: {
                type: 'value',
                scale: true,
                minInterval: this.selectedMode() === 'percentage' ? 0.1 : 1,
                axisLabel: {
                    color: style.secondaryTextColor,
                    fontSize: style.axisFontSize,
                    formatter: (value: number) => this.selectedMode() === 'percentage' ? formatAdminHistoryPercentage(value) : this.formatCount(value),
                },
                splitLine: { lineStyle: { color: style.gridColor } },
            },
        };
    }

    private chartStyle(reference: ElementRef<HTMLDivElement> | undefined) {
        const style = buildDashboardEChartsStyleTokens(
            this.isDark,
            reference?.nativeElement.clientWidth ?? 0,
        );
        return {
            ...style,
            tooltipTypography: {
                ...style.tooltipTypography,
                labelFontSize: 14,
                valueFontSize: 16,
                titleFontSize: 14,
                textLineHeight: 1.35,
                metricGapPx: 10,
                maxWidthPx: Math.min(320, reference?.nativeElement.clientWidth || 320),
            },
        };
    }

    private visibleTooltipRows(
        key: HistoryChartKey,
        rows: DashboardEChartsTooltipMetricRow[],
    ): DashboardEChartsTooltipMetricRow[] {
        const selected = this.seriesControls()[key].selected;
        return rows.filter(row => selected.includes(row.label));
    }

    private snapshotFromTooltip(params: unknown): AdminDashboardHistoryPoint | null {
        const items = Array.isArray(params) ? params : [params];
        const first = items[0] as { axisValue?: unknown; name?: unknown } | undefined;
        const candidate = first?.axisValue ?? first?.name;
        if (typeof candidate !== 'string') {
            return null;
        }
        return this.historyView().observed.find(snapshot => snapshot.date === candidate) ?? null;
    }

    private activePlanWindowLabel(window: AuthActivityWindowKey): string {
        switch (window) {
            case 'last24Hours':
                return 'rolling 24 hours';
            case 'last7Days':
                return 'rolling 7 days';
            case 'last30Days':
                return 'rolling 30 days';
        }
    }

    private formatCount(value: number): string {
        return new Intl.NumberFormat('en-US').format(value);
    }

    private formatAxisDate(value: string): string {
        const [, month, day] = value.split('-');
        return month && day ? `${month}/${day}` : value;
    }

    private formatFullDate(value: string): string {
        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeZone: 'UTC',
        }).format(new Date(`${value}T00:00:00.000Z`));
    }

    private disposeCharts(): void {
        this.authChartHost.dispose();
        this.activePlanChartHost.dispose();
        this.userMixChartHost.dispose();
        this.cadenceChartHost.dispose();
        this.onboardingChartHost.dispose();
    }
}
