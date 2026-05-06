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
import { buildDashboardEChartsStyleTokens } from '../../../helpers/dashboard-echarts-style.helper';
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

const GRID_BOTTOM_WITH_LEGEND = 58;
const GRID_BOTTOM_COMPACT = 34;
const MIN_SINGLE_SOURCE_AXIS_LABEL_WIDTH = 58;
const MIN_MULTI_SOURCE_AXIS_LABEL_WIDTH = 72;
const FALLBACK_MAX_AXIS_LABELS = 8;

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
    const latest = this.sleepTrend?.latestPoint || points[points.length - 1] || null;
    const latestHrvMs = this.toFiniteMetric(latest?.averageHrvMs);
    this.latestDurationText = latest ? formatSleepDuration(latest.totalSeconds) : '--';
    this.latestScoreText = latest?.score !== null && latest?.score !== undefined ? `${Math.round(latest.score)}` : '--';
    this.latestHrvText = latestHrvMs !== null ? `${Math.round(latestHrvMs)}` : '--';
    this.latestContextText = latest ? `${latest.providerLabel} · ${this.formatDateTime(latest.endTimeMs)}` : 'Latest sleep';
    this.showNoDataError = points.length === 0;
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
        borderRadius: stage.key === 'awakeSeconds' ? [3, 3, 0, 0] : 0,
      },
      emphasis: { focus: 'series' },
      data: points.map(point => this.secondsToHours(point[stage.key])),
    }));
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
        borderWidth: 1,
        borderColor: style.tooltipBorderColor,
        backgroundColor: style.tooltipBackgroundColor,
        textStyle: {
          color: style.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
        formatter: (params: AxisTooltipParam[]) => this.formatTooltip(params, points),
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
        ...hrvSeries,
      ],
    };
  }

  private formatTooltip(params: AxisTooltipParam[], points: DashboardSleepTrendPoint[]): string {
    if (!Array.isArray(params) || params.length === 0) {
      return '';
    }
    const dataIndex = Number(params[0]?.dataIndex);
    const point = Number.isFinite(dataIndex) ? points[dataIndex] : null;
    if (!point) {
      return '';
    }
    const averageHrvMs = this.toFiniteMetric(point.averageHrvMs);

    const lines = [
      `${point.providerLabel} · ${point.sleepDate}`,
      `${this.formatDateTime(point.startTimeMs)} - ${this.formatDateTime(point.endTimeMs)}`,
      `Total: ${formatSleepDuration(point.totalSeconds)}`,
      ...STAGE_SERIES
        .filter(stage => point[stage.key] > 0)
        .map(stage => `${stage.name}: ${formatSleepDuration(point[stage.key])}`),
      point.score !== null ? `Score: ${Math.round(point.score)}` : '',
      point.averageHeartRateBpm !== null ? `HR avg: ${Math.round(point.averageHeartRateBpm)} bpm` : '',
      averageHrvMs !== null ? `HRV: ${Math.round(averageHrvMs)} ms` : '',
      point.maxSpo2Percent !== null ? `SpO2 max: ${Math.round(point.maxSpo2Percent)}%` : '',
    ].filter(line => line.length > 0);

    return lines.join('<br/>');
  }

  private secondsToHours(seconds: number): number {
    return Math.round((seconds / 3600) * 100) / 100;
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
}
