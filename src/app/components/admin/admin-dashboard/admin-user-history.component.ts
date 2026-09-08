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
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

const CHART_COLORS = {
    active24Hours: '#5470c6',
    active7Days: '#3ba272',
    active30Days: '#9a60b4',
    free: '#7f8c8d',
    basic: '#fac858',
    pro: '#ee6666',
    onboarding: '#73c0de',
    proMonthly: '#5470c6',
    proYearly: '#91cc75',
    basicMonthly: '#fac858',
    basicYearly: '#ee6666',
    proUnknown: '#9a60b4',
    basicUnknown: '#ea7ccc',
} as const;

type HistoryChartKey = 'activity' | 'activePlans' | 'userMix' | 'cadence';

type ChartLineType = 'solid' | 'dashed' | 'dotted';
type ChartSymbol = 'circle' | 'diamond' | 'rect' | 'triangle';

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
    private readonly cadenceChartHost: EChartsHostController;
    private authChartRef?: ElementRef<HTMLDivElement>;
    private activePlanChartRef?: ElementRef<HTMLDivElement>;
    private userMixChartRef?: ElementRef<HTMLDivElement>;
    private cadenceChartRef?: ElementRef<HTMLDivElement>;
    private isDark = false;

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

    @ViewChild('cadenceChart')
    set cadenceChart(value: ElementRef<HTMLDivElement> | undefined) {
        this.cadenceChartRef = value;
        this.handleChartReference(value, this.cadenceChartHost);
    }

    readonly selectedScale = signal<AdminHistoryScale>('auto');
    readonly seriesControls = computed(() => {
        const observed = this.historyView().observed;
        const choices = {
            activity: [
                { name: 'Active 24h', color: CHART_COLORS.active24Hours },
                { name: 'Active 7d', color: CHART_COLORS.active7Days },
                { name: 'Active 30d', color: CHART_COLORS.active30Days },
            ],
            activePlans: [
                { name: 'Free', color: CHART_COLORS.free },
                { name: 'Basic', color: CHART_COLORS.basic },
                { name: 'Pro', color: CHART_COLORS.pro },
            ],
            userMix: [
                { name: 'Free', color: CHART_COLORS.free },
                { name: 'Basic', color: CHART_COLORS.basic },
                { name: 'Pro', color: CHART_COLORS.pro },
                { name: 'Onboarding complete', color: CHART_COLORS.onboarding },
            ],
            cadence: [
                { name: 'Pro monthly', color: CHART_COLORS.proMonthly },
                { name: 'Pro yearly', color: CHART_COLORS.proYearly },
                { name: 'Basic monthly', color: CHART_COLORS.basicMonthly },
                { name: 'Basic yearly', color: CHART_COLORS.basicYearly },
                ...(observed.some(point => point.subscriptionCadence.pro.unknown > 0)
                    ? [{ name: 'Pro unknown', color: CHART_COLORS.proUnknown }] : []),
                ...(observed.some(point => point.subscriptionCadence.basic.unknown > 0)
                    ? [{ name: 'Basic unknown', color: CHART_COLORS.basicUnknown }] : []),
            ],
        };
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
        snapshot => snapshot.authActivity.byPlan !== null,
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
        void Promise.resolve().then(() => this.renderCharts());
    }

    private async renderCharts(): Promise<void> {
        const view = this.historyView();
        if (this.loading || this.error || view.availablePoints < this.minimumPoints) {
            return;
        }

        await Promise.all([
            this.renderChart('activity', this.authChartHost, this.authChartRef, () => this.buildAuthActivityOption()),
            this.renderChart('activePlans', this.activePlanChartHost, this.activePlanChartRef, () => this.buildActivePlanOption()),
            this.renderChart('userMix', this.userMixChartHost, this.userMixChartRef, () => this.buildUserMixOption()),
            this.renderChart('cadence', this.cadenceChartHost, this.cadenceChartRef, () => this.buildCadenceOption()),
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
        if (!chart) {
            return;
        }
        const option = buildOption();
        const series = option['series'] as Array<{ name: string; data: Array<number | null> }>;
        const selected = this.seriesControls()[key].selected;
        const bounds = buildAdminHistoryAxisBounds(
            series.filter(item => selected.includes(item.name)).map(item => item.data),
            this.selectedScale(),
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

    private buildAuthActivityOption(): Record<string, unknown> {
        const view = this.historyView();
        const style = this.chartStyle(this.authChartRef);
        return {
            ...this.buildCartesianBase(style, view.timeline.map(item => item.date)),
            color: [CHART_COLORS.active24Hours, CHART_COLORS.active7Days, CHART_COLORS.active30Days],
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
                        subtitle: `${this.formatCount(snapshot.authActivity.eligibleAccounts)} eligible accounts`,
                        rows: this.visibleTooltipRows('activity', [
                            {
                                label: 'Active 24h',
                                value: this.formatActivity(snapshot.authActivity.last24Hours, snapshot.authActivity.eligibleAccounts),
                                markerColor: CHART_COLORS.active24Hours,
                            },
                            {
                                label: 'Active 7d',
                                value: this.formatActivity(snapshot.authActivity.last7Days, snapshot.authActivity.eligibleAccounts),
                                markerColor: CHART_COLORS.active7Days,
                            },
                            {
                                label: 'Active 30d',
                                value: this.formatActivity(snapshot.authActivity.last30Days, snapshot.authActivity.eligibleAccounts),
                                markerColor: CHART_COLORS.active30Days,
                            },
                        ]),
                    });
                },
            },
            series: [
                this.lineSeries('Active 24h', CHART_COLORS.active24Hours, view.timeline.map(item => item.snapshot?.authActivity.last24Hours ?? null), 'solid', 'circle'),
                this.lineSeries('Active 7d', CHART_COLORS.active7Days, view.timeline.map(item => item.snapshot?.authActivity.last7Days ?? null), 'dashed', 'diamond'),
                this.lineSeries('Active 30d', CHART_COLORS.active30Days, view.timeline.map(item => item.snapshot?.authActivity.last30Days ?? null), 'dotted', 'triangle'),
            ],
        };
    }

    private buildActivePlanOption(): Record<string, unknown> {
        const view = this.historyView();
        const style = this.chartStyle(this.activePlanChartRef);
        const window = this.selectedActivePlanWindow();
        return {
            ...this.buildCartesianBase(style, view.timeline.map(item => item.date)),
            color: [CHART_COLORS.free, CHART_COLORS.basic, CHART_COLORS.pro],
            tooltip: {
                ...buildDashboardEChartsTooltipChrome(style),
                trigger: 'axis',
                confine: true,
                formatter: (params: unknown) => {
                    const snapshot = this.snapshotFromTooltip(params);
                    const byPlan = snapshot?.authActivity.byPlan;
                    if (!snapshot || !byPlan) {
                        return '';
                    }
                    return renderDashboardEChartsTooltipCard(style, {
                        title: this.formatFullDate(snapshot.date),
                        subtitle: `${this.formatCount(snapshot.authActivity[window])} active · ${this.activePlanWindowLabel(window)}`,
                        rows: this.visibleTooltipRows('activePlans', [
                            { label: 'Free', value: this.formatCount(byPlan.free[window]), markerColor: CHART_COLORS.free },
                            { label: 'Basic', value: this.formatCount(byPlan.basic[window]), markerColor: CHART_COLORS.basic },
                            { label: 'Pro', value: this.formatCount(byPlan.pro[window]), markerColor: CHART_COLORS.pro },
                        ]),
                    });
                },
            },
            series: [
                {
                    ...this.lineSeries(
                        'Free',
                        CHART_COLORS.free,
                        view.timeline.map(item => item.snapshot?.authActivity.byPlan?.free[window] ?? null),
                        'dotted',
                    ),
                    id: 'active-plan-free',
                },
                {
                    ...this.lineSeries(
                        'Basic',
                        CHART_COLORS.basic,
                        view.timeline.map(item => item.snapshot?.authActivity.byPlan?.basic[window] ?? null),
                        'dashed',
                    ),
                    id: 'active-plan-basic',
                },
                {
                    ...this.lineSeries(
                        'Pro',
                        CHART_COLORS.pro,
                        view.timeline.map(item => item.snapshot?.authActivity.byPlan?.pro[window] ?? null),
                        'solid',
                    ),
                    id: 'active-plan-pro',
                },
            ],
        };
    }

    private buildUserMixOption(): Record<string, unknown> {
        const view = this.historyView();
        const style = this.chartStyle(this.userMixChartRef);
        return {
            ...this.buildCartesianBase(style, view.timeline.map(item => item.date)),
            color: [CHART_COLORS.free, CHART_COLORS.basic, CHART_COLORS.pro, CHART_COLORS.onboarding],
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
                        subtitle: `${this.formatCount(snapshot.users.total)} total users`,
                        rows: this.visibleTooltipRows('userMix', [
                            { label: 'Free', value: this.formatCount(snapshot.users.free), markerColor: CHART_COLORS.free },
                            { label: 'Basic', value: this.formatCount(snapshot.users.basic), markerColor: CHART_COLORS.basic },
                            { label: 'Pro', value: this.formatCount(snapshot.users.pro), markerColor: CHART_COLORS.pro },
                            {
                                label: 'Onboarding complete',
                                value: this.formatCount(snapshot.users.onboardingCompleted),
                                markerColor: CHART_COLORS.onboarding,
                            },
                        ]),
                    });
                },
            },
            series: [
                this.lineSeries('Free', CHART_COLORS.free, view.timeline.map(item => item.snapshot?.users.free ?? null), 'dotted'),
                this.lineSeries('Basic', CHART_COLORS.basic, view.timeline.map(item => item.snapshot?.users.basic ?? null), 'dashed'),
                this.lineSeries('Pro', CHART_COLORS.pro, view.timeline.map(item => item.snapshot?.users.pro ?? null), 'solid'),
                {
                    ...this.lineSeries(
                        'Onboarding complete',
                        CHART_COLORS.onboarding,
                        view.timeline.map(item => item.snapshot?.users.onboardingCompleted ?? null),
                        'dashed',
                        'rect',
                    ),
                },
            ],
        };
    }

    private buildCadenceOption(): Record<string, unknown> {
        const view = this.historyView();
        const style = this.chartStyle(this.cadenceChartRef);
        const hasProUnknownCadence = view.observed.some(
            snapshot => snapshot.subscriptionCadence.pro.unknown > 0,
        );
        const hasBasicUnknownCadence = view.observed.some(
            snapshot => snapshot.subscriptionCadence.basic.unknown > 0,
        );
        const series: Record<string, unknown>[] = [
            this.lineSeries('Pro monthly', CHART_COLORS.proMonthly, view.timeline.map(item => item.snapshot?.subscriptionCadence.pro.monthly ?? null), 'solid'),
            this.lineSeries('Pro yearly', CHART_COLORS.proYearly, view.timeline.map(item => item.snapshot?.subscriptionCadence.pro.yearly ?? null), 'dashed'),
            this.lineSeries('Basic monthly', CHART_COLORS.basicMonthly, view.timeline.map(item => item.snapshot?.subscriptionCadence.basic.monthly ?? null), 'dotted'),
            this.lineSeries('Basic yearly', CHART_COLORS.basicYearly, view.timeline.map(item => item.snapshot?.subscriptionCadence.basic.yearly ?? null), 'solid'),
        ];
        if (hasProUnknownCadence) {
            series.push(this.lineSeries(
                'Pro unknown',
                CHART_COLORS.proUnknown,
                view.timeline.map(item => item.snapshot?.subscriptionCadence.pro.unknown ?? null),
                'dotted',
            ));
        }
        if (hasBasicUnknownCadence) {
            series.push(this.lineSeries(
                'Basic unknown',
                CHART_COLORS.basicUnknown,
                view.timeline.map(item => item.snapshot?.subscriptionCadence.basic.unknown ?? null),
                'dashed',
            ));
        }

        return {
            ...this.buildCartesianBase(style, view.timeline.map(item => item.date)),
            color: series.map(item => item['itemStyle']).map(item => (item as { color: string }).color),
            tooltip: {
                ...buildDashboardEChartsTooltipChrome(style),
                trigger: 'axis',
                confine: true,
                formatter: (params: unknown) => {
                    const snapshot = this.snapshotFromTooltip(params);
                    if (!snapshot) {
                        return '';
                    }
                    const rows: DashboardEChartsTooltipMetricRow[] = [
                        { label: 'Pro monthly', value: this.formatCount(snapshot.subscriptionCadence.pro.monthly), markerColor: CHART_COLORS.proMonthly },
                        { label: 'Pro yearly', value: this.formatCount(snapshot.subscriptionCadence.pro.yearly), markerColor: CHART_COLORS.proYearly },
                        { label: 'Basic monthly', value: this.formatCount(snapshot.subscriptionCadence.basic.monthly), markerColor: CHART_COLORS.basicMonthly },
                        { label: 'Basic yearly', value: this.formatCount(snapshot.subscriptionCadence.basic.yearly), markerColor: CHART_COLORS.basicYearly },
                    ];
                    if (hasProUnknownCadence) {
                        rows.push({
                            label: 'Pro unknown',
                            value: this.formatCount(snapshot.subscriptionCadence.pro.unknown),
                            markerColor: CHART_COLORS.proUnknown,
                        });
                    }
                    if (hasBasicUnknownCadence) {
                        rows.push({
                            label: 'Basic unknown',
                            value: this.formatCount(snapshot.subscriptionCadence.basic.unknown),
                            markerColor: CHART_COLORS.basicUnknown,
                        });
                    }
                    return renderDashboardEChartsTooltipCard(style, {
                        title: this.formatFullDate(snapshot.date),
                        subtitle: `${this.formatCount(snapshot.users.pro + snapshot.users.basic)} paid users`,
                        rows: this.visibleTooltipRows('cadence', rows),
                        rowColumnCount: 1,
                    });
                },
            },
            series,
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
                minInterval: 1,
                axisLabel: {
                    color: style.secondaryTextColor,
                    fontSize: style.axisFontSize,
                    formatter: (value: number) => this.formatCount(value),
                },
                splitLine: { lineStyle: { color: style.gridColor } },
            },
        };
    }

    private lineSeries(
        name: string,
        color: string,
        data: Array<number | null>,
        lineType: ChartLineType = 'solid',
        symbol: ChartSymbol = 'circle',
    ): Record<string, unknown> {
        return {
            name,
            type: 'line',
            data,
            connectNulls: false,
            showSymbol: data.length <= 90,
            symbol,
            symbolSize: 5,
            lineStyle: { width: 2, type: lineType },
            itemStyle: { color },
            emphasis: { focus: 'series' },
        };
    }

    private chartStyle(reference: ElementRef<HTMLDivElement> | undefined) {
        return buildDashboardEChartsStyleTokens(
            this.isDark,
            reference?.nativeElement.clientWidth ?? 0,
        );
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

    private formatActivity(count: number, eligibleAccounts: number): string {
        if (eligibleAccounts <= 0) {
            return this.formatCount(count);
        }
        return `${this.formatCount(count)} (${Math.round((count / eligibleAccounts) * 100)}%)`;
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
    }
}
