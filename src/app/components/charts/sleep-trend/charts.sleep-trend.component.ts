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
  type DashboardEChartsTooltipMetricRow,
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
type ChartActionPayload = Parameters<EChartsType['dispatchAction']>[0];
type AxisTooltipParam = { dataIndex?: number; seriesName?: string; value?: number };
type AxisPointerEvent = {
  axesInfo?: Array<{ axisDim?: string; axisIndex?: number; value?: number | string }>;
  dataIndex?: number;
  seriesData?: Array<{ dataIndex?: number }>;
};
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
const STACK_BAR_EMPHASIS = { focus: 'none' as const };

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
  private sleepStackSeriesNames: readonly string[] = STAGE_SERIES.map(stage => stage.name);
  private sleepCategoryLabels: readonly string[] = [];
  private sleepPointsCount = 0;
  private highlightedSleepDataIndex: number | null = null;
  private sleepHighlightBoundChart: EChartsType | null = null;
  private readonly sleepAxisPointerHighlightHandler = (event: AxisPointerEvent): void => {
    const dataIndex = this.resolveAxisPointerDataIndex(event);
    if (dataIndex === null) {
      this.clearSleepBarHighlight();
      return;
    }
    this.highlightSleepBar(dataIndex);
  };
  private readonly sleepGlobalOutHandler = (): void => {
    this.clearSleepBarHighlight();
  };

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
    this.unbindSleepBarHighlight();
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

    this.clearSleepBarHighlight();
    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(points), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.bindSleepBarHighlight(chart);
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
    this.sleepPointsCount = points.length;
    this.sleepCategoryLabels = points.map(point => point.categoryLabel);
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
    const xAxisLabelInterval = this.buildXAxisLabelInterval(points, chartWidth);
    const hrvData = points.map(point => this.toFiniteMetric(point.averageHrvMs));
    const hasHrvSeries = hrvData.some(value => value !== null);
    const averageHrvMs = this.averageMetric(hrvData);
    const napData = points.map(point => this.secondsToHours(point.napSeconds));
    const hasNapSeries = napData.some(value => value > 0);
    this.sleepStackSeriesNames = [
      ...STAGE_SERIES.map(stage => stage.name),
      ...(hasNapSeries ? [NAP_SERIES.name] : []),
    ];
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
      emphasis: STACK_BAR_EMPHASIS,
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
      emphasis: STACK_BAR_EMPHASIS,
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
        data: this.sleepCategoryLabels,
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

    const rows: DashboardEChartsTooltipMetricRow[] = [];
    if (hasSeparateNap) {
      rows.push(
        { label: 'Sleep', value: formatSleepDuration(point.totalSeconds) },
        { label: napLabel, value: formatSleepDuration(point.napSeconds), markerColor: NAP_SERIES.color },
        { label: 'Total', value: formatSleepDuration(totalWithNapSeconds) },
      );
    } else {
      rows.push({ label: 'Total', value: formatSleepDuration(point.totalSeconds) });
    }
    for (const stage of STAGE_SERIES) {
      if (point[stage.key] > 0) {
        rows.push({
          label: stage.name,
          value: formatSleepDuration(point[stage.key]),
          markerColor: stage.color,
        });
      }
    }
    if (point.score !== null) {
      rows.push({ label: 'Score', value: `${Math.round(point.score)}` });
    }
    if (point.averageHeartRateBpm !== null) {
      rows.push({ label: 'HR avg', value: `${Math.round(point.averageHeartRateBpm)} bpm` });
    }
    if (averageHrvMs !== null) {
      rows.push({ label: 'HRV', value: `${Math.round(averageHrvMs)} ms`, markerColor: HRV_SERIES.color });
    }
    if (napAverageHeartRateBpm !== null) {
      rows.push({ label: `${napLabel} HR avg`, value: `${Math.round(napAverageHeartRateBpm)} bpm` });
    }
    if (napAverageHrvMs !== null) {
      rows.push({ label: `${napLabel} HRV`, value: `${Math.round(napAverageHrvMs)} ms`, markerColor: HRV_SERIES.color });
    }
    if (point.maxSpo2Percent !== null) {
      rows.push({ label: 'SpO2 max', value: `${Math.round(point.maxSpo2Percent)}%` });
    }

    return renderDashboardEChartsTooltipCard(style, {
      title: `${point.providerLabel}${point.isNap ? ' nap' : ''} · ${point.sleepDate}`,
      subtitle: this.formatTooltipSubtitle(point),
      rows,
    });
  }

  private bindSleepBarHighlight(chart: EChartsType): void {
    if (this.sleepHighlightBoundChart === chart) {
      return;
    }
    this.unbindSleepBarHighlight();
    chart.on('updateAxisPointer', this.sleepAxisPointerHighlightHandler);
    chart.on('globalout', this.sleepGlobalOutHandler);
    this.sleepHighlightBoundChart = chart;
  }

  private unbindSleepBarHighlight(): void {
    const chart = this.sleepHighlightBoundChart;
    if (!chart || chart.isDisposed()) {
      this.sleepHighlightBoundChart = null;
      this.highlightedSleepDataIndex = null;
      return;
    }
    chart.off('updateAxisPointer', this.sleepAxisPointerHighlightHandler);
    chart.off('globalout', this.sleepGlobalOutHandler);
    this.clearSleepBarHighlight();
    this.sleepHighlightBoundChart = null;
  }

  private resolveAxisPointerDataIndex(event: AxisPointerEvent): number | null {
    const candidateValues = [
      event.axesInfo?.find(axisInfo => axisInfo.axisDim === 'x')?.value,
      event.axesInfo?.[0]?.value,
      event.dataIndex,
      event.seriesData?.find(seriesData => Number.isFinite(seriesData.dataIndex))?.dataIndex,
    ];

    for (const candidateValue of candidateValues) {
      const dataIndex = this.resolveAxisPointerCandidateIndex(candidateValue);
      if (dataIndex !== null) {
        return dataIndex;
      }
    }
    return null;
  }

  private resolveAxisPointerCandidateIndex(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 && value < this.sleepPointsCount ? value : null;
    }

    if (typeof value !== 'string') {
      return null;
    }

    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      const dataIndex = Number(trimmedValue);
      if (Number.isInteger(dataIndex) && dataIndex >= 0 && dataIndex < this.sleepPointsCount) {
        return dataIndex;
      }
    }

    const categoryIndex = this.sleepCategoryLabels.indexOf(value);
    if (categoryIndex >= 0) {
      return categoryIndex;
    }

    const trimmedCategoryIndex = this.sleepCategoryLabels.indexOf(trimmedValue);
    return trimmedCategoryIndex >= 0 ? trimmedCategoryIndex : null;
  }

  private highlightSleepBar(dataIndex: number): void {
    if (this.highlightedSleepDataIndex === dataIndex) {
      return;
    }
    this.clearSleepBarHighlight();
    this.highlightedSleepDataIndex = dataIndex;
    this.dispatchSleepStackAction('highlight', dataIndex);
  }

  private clearSleepBarHighlight(): void {
    if (this.highlightedSleepDataIndex === null) {
      return;
    }
    const dataIndex = this.highlightedSleepDataIndex;
    this.highlightedSleepDataIndex = null;
    this.dispatchSleepStackAction('downplay', dataIndex);
  }

  private dispatchSleepStackAction(type: 'highlight' | 'downplay', dataIndex: number): void {
    const chart = this.sleepHighlightBoundChart || this.chartHost.getChart();
    if (!chart || chart.isDisposed()) {
      return;
    }
    for (const seriesName of this.sleepStackSeriesNames) {
      const payload: ChartActionPayload = {
        type,
        seriesName,
        dataIndex,
      };
      chart.dispatchAction(payload);
    }
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
