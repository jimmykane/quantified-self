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
  @Input() infoTooltip?: string | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

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
    this.latestDurationText = latest ? formatSleepDuration(latest.totalSeconds) : '--';
    this.latestScoreText = latest?.score !== null && latest?.score !== undefined ? `${Math.round(latest.score)}` : '--';
    this.latestHrvText = latest?.averageHrvMs !== null && latest?.averageHrvMs !== undefined ? `${Math.round(latest.averageHrvMs)}` : '--';
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
    const categories = points.map(point => point.categoryLabel);

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      grid: {
        left: 26,
        right: 8,
        top: 8,
        bottom: 34,
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, false),
        axisPointer: { type: 'shadow' },
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
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          lineHeight: 14,
          interval: 0,
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => `${value}h`,
        },
        splitLine: { lineStyle: { color: style.gridColor } },
      },
      series: STAGE_SERIES.map((stage) => ({
        name: stage.name,
        type: 'bar',
        stack: 'sleep',
        barMaxWidth: 32,
        itemStyle: {
          color: stage.color,
          borderRadius: stage.key === 'awakeSeconds' ? [3, 3, 0, 0] : 0,
        },
        emphasis: { focus: 'series' },
        data: points.map(point => this.secondsToHours(point[stage.key])),
      })),
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

    const lines = [
      `${point.providerLabel} · ${point.sleepDate}`,
      `${this.formatDateTime(point.startTimeMs)} - ${this.formatDateTime(point.endTimeMs)}`,
      `Total: ${formatSleepDuration(point.totalSeconds)}`,
      ...STAGE_SERIES
        .filter(stage => point[stage.key] > 0)
        .map(stage => `${stage.name}: ${formatSleepDuration(point[stage.key])}`),
      point.score !== null ? `Score: ${Math.round(point.score)}` : '',
      point.averageHeartRateBpm !== null ? `HR avg: ${Math.round(point.averageHeartRateBpm)} bpm` : '',
      point.averageHrvMs !== null ? `HRV: ${Math.round(point.averageHrvMs)} ms` : '',
      point.maxSpo2Percent !== null ? `SpO2 max: ${Math.round(point.maxSpo2Percent)}%` : '',
    ].filter(line => line.length > 0);

    return lines.join('<br/>');
  }

  private secondsToHours(seconds: number): number {
    return Math.round((seconds / 3600) * 100) / 100;
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
