import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import type { EChartsType } from 'echarts/core';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../../helpers/echarts-host-controller';
import {
  buildDashboardEChartsTooltipChrome,
  buildDashboardEChartsStyleTokens,
  renderDashboardEChartsTooltipCard,
} from '../../../helpers/dashboard-echarts-style.helper';
import {
  type EChartsMobileTapFeedbackOptions,
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import {
  DashboardSleepTrendContext,
  DashboardSleepTrendPoint,
  formatSleepDuration,
} from '../../../helpers/dashboard-sleep-chart.helper';
import {
  DASHBOARD_SLEEP_TREND_DEFAULT_RANGE,
  normalizeDashboardSleepTrendRange,
} from '../../../helpers/dashboard-sleep-range.helper';
import type { AppDashboardSleepTrendRange } from '../../../models/app-user.interface';
import { AppColors } from '../../../services/color/app.colors';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type AxisTooltipParam = { dataIndex?: number; seriesName?: string; value?: number };
type SleepStackValueKey = 'deepSeconds' | 'lightSeconds' | 'remSeconds' | 'unknownSeconds' | 'awakeSeconds' | 'napSeconds';

const STAGE_SERIES = [
  { key: 'deepSeconds', name: 'Deep', color: '#3F51B5' },
  { key: 'lightSeconds', name: 'Light', color: '#4DB6AC' },
  { key: 'remSeconds', name: 'REM', color: '#AB47BC' },
  { key: 'unknownSeconds', name: 'Unknown', color: '#90A4AE' },
  { key: 'awakeSeconds', name: 'Awake', color: '#F9A825' },
] as const;

const HRV_SERIES = {
  name: 'HRV',
  color: AppColors.Green,
} as const;

const NAP_SERIES = {
  name: 'Nap',
  color: AppColors.LightBlue,
} as const;

const GRID_BOTTOM_WITH_LEGEND = 58;
const GRID_BOTTOM_COMPACT = 34;
const MIN_SINGLE_SOURCE_AXIS_LABEL_WIDTH = 58;
const MIN_MULTI_SOURCE_AXIS_LABEL_WIDTH = 72;
const FALLBACK_MAX_AXIS_LABELS = 8;
const STACK_TOP_BORDER_RADIUS = [3, 3, 0, 0] as const;

@Component({
  selector: 'app-sleep-trend-chart',
  templateUrl: './charts.sleep-trend.component.html',
  styleUrls: ['./charts.sleep-trend.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsSleepTrendComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() sleepTrend?: DashboardSleepTrendContext | null;
  @Input()
  set sleepRange(value: AppDashboardSleepTrendRange | null | undefined) {
    this._sleepRange = normalizeDashboardSleepTrendRange(value);
  }
  get sleepRange(): AppDashboardSleepTrendRange {
    return this._sleepRange;
  }
  @Input() sleepWindowLabel?: string | null;
  @Input() canNavigateOlder = false;
  @Input() canNavigateNewer = false;
  @Input() infoTooltip?: string | null;
  @Input() reserveTitleActionSpace = false;
  @Input() mobileTapFeedbackOptions?: EChartsMobileTapFeedbackOptions | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private _sleepRange: AppDashboardSleepTrendRange = DASHBOARD_SLEEP_TREND_DEFAULT_RANGE;

  public latestDurationText = '--';
  public latestScoreText = '--';
  public latestHrvText = '--';
  public latestContextText = 'Latest sleep';
  public showNoDataError = false;
  public noDataErrorMessage = 'No sleep data yet';
  public noDataErrorHint = 'Connect Garmin, Suunto, or COROS sleep sync to populate this chart.';
  public noDataErrorIcon = 'hotel';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsSleepTrendComponent]',
      mobileTapFeedbackOptions: () => this.mobileTapFeedbackOptions,
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      this.updateHeaderAndErrorState();
      return;
    }
    if (changes.darkTheme || changes.isLoading || changes.sleepTrend) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const points = this.getPoints();
    this.updateHeaderAndErrorState(points);

    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(points), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private getPoints(): DashboardSleepTrendPoint[] {
    return [...(this.sleepTrend?.points || [])];
  }

  private updateHeaderAndErrorState(points: DashboardSleepTrendPoint[] = this.getPoints()): void {
    const latest = this.sleepTrend?.latestPoint || this.getLatestRealPoint(points);
    const latestHrvMs = this.toFiniteMetric(latest?.averageHrvMs);
    this.latestDurationText = latest ? formatSleepDuration(latest.totalSeconds) : '--';
    this.latestScoreText = latest?.score !== null && latest?.score !== undefined ? `${Math.round(latest.score)}` : '--';
    this.latestHrvText = latestHrvMs !== null ? `${Math.round(latestHrvMs)}` : '--';
    this.latestContextText = latest ? `${latest.providerLabel} · ${this.formatDateTime(latest.endTimeMs)}` : 'Latest sleep';
    this.showNoDataError = this.sleepTrend?.hasRealPoints === false || points.every(point => point.isPlaceholder);
  }

  private getLatestRealPoint(points: DashboardSleepTrendPoint[]): DashboardSleepTrendPoint | null {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      if (!points[index].isPlaceholder) {
        return points[index];
      }
    }
    return null;
  }

  private buildOption(points: DashboardSleepTrendPoint[]): ChartOption {
    if (!points.length) {
      return {
        animation: false,
        tooltip: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const mobileAxisPointerHandle = isMobileTooltipViewport
      ? {
        show: true,
        size: 20,
        margin: 4,
        throttle: 16,
        color: style.axisColor,
      }
      : { show: false };
    const categories = points.map(point => point.categoryLabel);
    const xAxisLabelInterval = this.buildXAxisLabelInterval(points, chartWidth);
    const hrvData = points.map(point => this.toFiniteMetric(point.averageHrvMs));
    const hasHrvSeries = hrvData.some(value => value !== null);
    const averageHrvMs = this.averageMetric(hrvData);
    const napData = points.map(point => this.secondsToHours(point.napSeconds));
    const hasNapSeries = napData.some(value => value > 0);
    const stackKeys: SleepStackValueKey[] = [
      ...STAGE_SERIES.map(stage => stage.key),
      ...(hasNapSeries ? ['napSeconds' as const] : []),
    ];
    const sleepDurationAxis = {
      type: 'value',
      min: 0,
      axisLabel: {
        color: style.secondaryTextColor,
        fontSize: style.axisFontSize,
        formatter: (value: number) => `${value}h`,
      },
      splitLine: { lineStyle: { color: style.gridColor } },
    };
    const hrvAxis = {
      type: 'value',
      min: 0,
      axisLabel: {
        color: style.secondaryTextColor,
        fontSize: style.axisFontSize,
        formatter: (value: number) => `${Math.round(value)}ms`,
      },
      splitLine: { show: false },
    };
    const stageSeries = STAGE_SERIES.map((stage) => ({
      name: stage.name,
      type: 'bar',
      stack: 'sleep',
      barMaxWidth: 32,
      yAxisIndex: 0,
      itemStyle: {
        color: stage.color,
        borderRadius: 0,
      },
      emphasis: { focus: 'series' },
      data: this.buildStackedBarData(points, stage.key, stackKeys),
    }));
    const napSeries = hasNapSeries ? [{
      name: NAP_SERIES.name,
      type: 'bar',
      stack: 'sleep',
      barMaxWidth: 32,
      yAxisIndex: 0,
      itemStyle: {
        color: NAP_SERIES.color,
        borderRadius: 0,
      },
      emphasis: { focus: 'series' },
      data: this.buildStackedBarData(points, 'napSeconds', stackKeys),
    }] : [];
    const hrvSeries = hasHrvSeries ? [{
      name: HRV_SERIES.name,
      type: 'line',
      yAxisIndex: 1,
      smooth: false,
      connectNulls: false,
      showSymbol: true,
      symbolSize: 5,
      lineStyle: {
        color: HRV_SERIES.color,
        width: 2,
      },
      itemStyle: {
        color: HRV_SERIES.color,
      },
      emphasis: { focus: 'series' },
      markLine: averageHrvMs === null ? undefined : {
        silent: true,
        symbol: 'none',
        lineStyle: {
          color: HRV_SERIES.color,
          type: 'dashed',
          width: 1.5,
          opacity: 0.72,
        },
        label: {
          show: true,
          position: 'middle',
          distance: 8,
          color: HRV_SERIES.color,
          backgroundColor: style.tooltipBackgroundColor,
          borderColor: HRV_SERIES.color,
          borderWidth: 1,
          borderRadius: 4,
          padding: [2, 6],
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
          fontWeight: 600,
          formatter: `Avg HRV ${Math.round(averageHrvMs)}ms`,
        },
        data: [{
          name: 'Avg HRV',
          yAxis: averageHrvMs,
        }],
      },
      data: hrvData,
    }] : [];

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      grid: {
        left: 26,
        right: hasHrvSeries ? 32 : 8,
        top: 8,
        bottom: style.isCompactLayout ? GRID_BOTTOM_COMPACT : GRID_BOTTOM_WITH_LEGEND,
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        axisPointer: {
          type: 'shadow',
          axis: 'x',
          snap: true,
        },
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: AxisTooltipParam[]) => this.formatTooltip(params, points, style),
      },
      legend: {
        show: !style.isCompactLayout,
        bottom: 0,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: {
          color: style.secondaryTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
      },
      xAxis: {
        type: 'category',
        data: categories,
        containShape: true,
        axisPointer: {
          show: true,
          snap: true,
          triggerTooltip: true,
          label: { show: false },
          handle: mobileAxisPointerHandle,
        },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          lineHeight: 14,
          interval: xAxisLabelInterval,
          hideOverlap: true,
        },
      },
      yAxis: hasHrvSeries ? [sleepDurationAxis, hrvAxis] : sleepDurationAxis,
      series: [
        ...stageSeries,
        ...napSeries,
        ...hrvSeries,
      ],
    };
  }

  private formatTooltip(
    params: AxisTooltipParam[],
    points: DashboardSleepTrendPoint[],
    style: ReturnType<typeof buildDashboardEChartsStyleTokens>,
  ): string {
    if (!Array.isArray(params) || params.length === 0) {
      return '';
    }
    const dataIndex = Number(params[0]?.dataIndex);
    const point = Number.isFinite(dataIndex) ? points[dataIndex] : null;
    if (!point) {
      return '';
    }
    if (point.isPlaceholder) {
      return renderDashboardEChartsTooltipCard(style, {
        title: point.categoryLabel,
        subtitle: 'No sleep data',
        rows: [],
      });
    }
    const averageHrvMs = this.toFiniteMetric(point.averageHrvMs);
    const napAverageHrvMs = this.toFiniteMetric(point.napAverageHrvMs);
    const napAverageHeartRateBpm = this.toFiniteMetric(point.napAverageHeartRateBpm);
    const hasSeparateNap = point.napSeconds > 0;
    const totalWithNapSeconds = point.totalSeconds + point.napSeconds;
    const napLabel = point.napCount > 1 ? 'Naps' : 'Nap';

    const rows = [
      ...(hasSeparateNap
        ? [
          { label: 'Sleep', value: formatSleepDuration(point.totalSeconds) },
          { label: napLabel, value: formatSleepDuration(point.napSeconds) },
          { label: 'Total', value: formatSleepDuration(totalWithNapSeconds) },
        ]
        : [{ label: 'Total', value: formatSleepDuration(point.totalSeconds) }]),
      ...STAGE_SERIES
        .filter(stage => point[stage.key] > 0)
        .map(stage => ({ label: stage.name, value: formatSleepDuration(point[stage.key]) })),
      ...(point.score !== null ? [{ label: 'Score', value: `${Math.round(point.score)}` }] : []),
      ...(point.averageHeartRateBpm !== null ? [{ label: 'HR avg', value: `${Math.round(point.averageHeartRateBpm)} bpm` }] : []),
      ...(averageHrvMs !== null ? [{ label: 'HRV', value: `${Math.round(averageHrvMs)} ms` }] : []),
      ...(napAverageHeartRateBpm !== null ? [{ label: `${napLabel} HR avg`, value: `${Math.round(napAverageHeartRateBpm)} bpm` }] : []),
      ...(napAverageHrvMs !== null ? [{ label: `${napLabel} HRV`, value: `${Math.round(napAverageHrvMs)} ms` }] : []),
      ...(point.maxSpo2Percent !== null ? [{ label: 'SpO2 max', value: `${Math.round(point.maxSpo2Percent)}%` }] : []),
    ];

    return renderDashboardEChartsTooltipCard(style, {
      title: `${point.providerLabel}${point.isNap ? ' nap' : ''} · ${point.sleepDate}`,
      subtitle: this.formatTooltipSubtitle(point),
      rows,
    });
  }

  private secondsToHours(seconds: number): number {
    return Math.round((seconds / 3600) * 100) / 100;
  }

  private buildStackedBarData(
    points: DashboardSleepTrendPoint[],
    key: SleepStackValueKey,
    stackKeys: SleepStackValueKey[],
  ): Array<number | { value: number; itemStyle: { borderRadius: readonly [number, number, number, number] } }> {
    return points.map(point => {
      const value = this.secondsToHours(point[key]);
      if (value <= 0 || this.resolveTopStackKey(point, stackKeys) !== key) {
        return value;
      }
      return {
        value,
        itemStyle: {
          borderRadius: STACK_TOP_BORDER_RADIUS,
        },
      };
    });
  }

  private resolveTopStackKey(point: DashboardSleepTrendPoint, stackKeys: SleepStackValueKey[]): SleepStackValueKey | null {
    for (let index = stackKeys.length - 1; index >= 0; index -= 1) {
      const key = stackKeys[index];
      if (this.secondsToHours(point[key]) > 0) {
        return key;
      }
    }
    return null;
  }

  private toFiniteMetric(value: number | null | undefined): number | null {
    return Number.isFinite(value) ? Number(value) : null;
  }

  private averageMetric(values: ReadonlyArray<number | null>): number | null {
    const finiteValues = values.filter((value): value is number => value !== null);
    if (!finiteValues.length) {
      return null;
    }
    const total = finiteValues.reduce((sum, value) => sum + value, 0);
    return total / finiteValues.length;
  }

  private buildXAxisLabelInterval(points: DashboardSleepTrendPoint[], chartWidth: number): 0 | ((index: number) => boolean) {
    if (points.length <= 1) {
      return 0;
    }

    const hasProviderLine = points.some(point => point.categoryLabel.includes('\n'));
    const minimumLabelWidth = hasProviderLine ? MIN_MULTI_SOURCE_AXIS_LABEL_WIDTH : MIN_SINGLE_SOURCE_AXIS_LABEL_WIDTH;
    const availableWidth = Math.max(0, chartWidth - 68);
    const maxLabels = availableWidth > 0
      ? Math.max(2, Math.floor(availableWidth / minimumLabelWidth))
      : FALLBACK_MAX_AXIS_LABELS;

    if (points.length <= maxLabels) {
      return 0;
    }

    const lastIndex = points.length - 1;
    const step = Math.max(1, Math.ceil(points.length / maxLabels));
    const visibleIndexes = new Set<number>();
    for (let index = 0; index < points.length; index += step) {
      visibleIndexes.add(index);
    }

    const previousVisibleIndex = Math.max(...Array.from(visibleIndexes).filter(index => index < lastIndex));
    if (Number.isFinite(previousVisibleIndex) && previousVisibleIndex > 0 && lastIndex - previousVisibleIndex < Math.ceil(step / 2)) {
      visibleIndexes.delete(previousVisibleIndex);
    }
    visibleIndexes.add(lastIndex);

    return (index: number) => visibleIndexes.has(index);
  }

  private formatDateTime(timestampMs: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestampMs));
  }

  private formatTooltipSubtitle(point: DashboardSleepTrendPoint): string {
    const sleepWindow = `${this.formatDateTime(point.startTimeMs)} - ${this.formatDateTime(point.endTimeMs)}`;
    if (!Number.isFinite(point.napStartTimeMs) || !Number.isFinite(point.napEndTimeMs)) {
      return sleepWindow;
    }
    const napWindow = `${this.formatDateTime(point.napStartTimeMs)} - ${this.formatDateTime(point.napEndTimeMs)}`;
    return `Sleep ${sleepWindow} · Nap ${napWindow}`;
  }
}
