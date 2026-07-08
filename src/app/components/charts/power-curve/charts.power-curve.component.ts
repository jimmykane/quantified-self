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
import { ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS, EChartsHostController } from '../../../helpers/echarts-host-controller';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
} from '../../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../../helpers/dashboard-echarts-yaxis.helper';
import type { DashboardPowerCurveContext } from '../../../helpers/dashboard-power-curve.helper';
import type { PowerCurvePoint } from '@shared/power-curve';
import { resolveEventSeriesColor } from '../../../helpers/event-echarts-style.helper';
import {
  buildPowerCurveVisibleDurationLabelSet,
  formatPowerCurveDurationLabel,
  formatPowerCurvePowerLabel,
} from '../../../helpers/power-curve-chart.helper';
import {
  type EChartsMobileTapFeedbackOptions,
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface PowerCurveRenderSeries {
  label: string;
  color: string;
  pointsByDuration: Map<number, {
    power: number;
    wattsPerKg?: number;
  }>;
}

interface PowerCurveBenchmarkStat {
  duration: number;
  durationLabel: string;
  powerLabel: string;
}

const PRIMARY_POWER_CURVE_BENCHMARK_DURATION_SECONDS = 1200;
const POWER_CURVE_BENCHMARK_DURATIONS_SECONDS = [
  PRIMARY_POWER_CURVE_BENCHMARK_DURATION_SECONDS,
  300,
  60,
] as const;

function formatPowerCurveBenchmarkDurationLabel(seconds: number): string {
  return formatPowerCurveDurationLabel(seconds).replace(/^0(?=\d+m$)/, '');
}

function formatPowerCurveBenchmarkPowerLabel(power: number): string {
  return formatPowerCurvePowerLabel(power, true).replace(/\s+watts?$/i, 'w');
}

@Component({
  selector: 'app-power-curve-chart',
  templateUrl: './charts.power-curve.component.html',
  styleUrls: ['./charts.power-curve.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsPowerCurveComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() title = 'Power Curve';
  @Input() powerCurve?: DashboardPowerCurveContext | null;
  @Input() infoTooltip?: string | null;
  @Input() reserveTitleActionSpace = false;
  @Input() mobileTapFeedbackOptions?: EChartsMobileTapFeedbackOptions | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

  public benchmarkStats: PowerCurveBenchmarkStat[] = [];
  public primaryBenchmark: PowerCurveBenchmarkStat | null = null;
  public secondaryBenchmarks: PowerCurveBenchmarkStat[] = [];
  public subtitleText = 'Best + latest activity';
  public showNoDataError = false;
  public noDataErrorMessage = 'No power curve data yet';
  public noDataErrorHint = 'Choose a longer range or upload an activity with power data.';
  public noDataErrorIcon = 'speed';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsPowerCurveComponent]',
      mobileTapFeedbackOptions: () => this.mobileTapFeedbackOptions,
    });
  }

  get compactTitle(): string {
    const normalizedTitle = `${this.title || ''}`.trim();
    if (/^cycling power curve$/i.test(normalizedTitle)) {
      return 'Cycling';
    }
    if (/^running power curve$/i.test(normalizedTitle)) {
      return 'Running';
    }
    return normalizedTitle.replace(/\s+power\s+curve$/i, '') || normalizedTitle || 'Power Curve';
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      this.updateHeaderAndErrorState();
      return;
    }
    if (changes.darkTheme || changes.isLoading || changes.powerCurve) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const renderModel = this.buildSeries();
    this.updateHeaderAndErrorState(renderModel.durations);
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(renderModel), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private updateHeaderAndErrorState(durations: number[] = this.buildSeries().durations): void {
    this.benchmarkStats = this.resolveBenchmarkStats();
    this.primaryBenchmark = this.benchmarkStats[0] || null;
    this.secondaryBenchmarks = this.benchmarkStats.slice(1);
    const matchedEventCount = this.powerCurve?.matchedEventCount ?? 0;
    const comparisonLabel = this.resolveComparisonLabel();
    const subtitlePrefix = this.powerCurve?.compareMode && this.powerCurve.compareMode !== 'latest'
      ? `Best in range vs ${comparisonLabel}`
      : `Best + ${comparisonLabel}`;
    this.subtitleText = matchedEventCount > 0
      ? `${subtitlePrefix} · ${matchedEventCount} ${matchedEventCount === 1 ? 'event' : 'events'}`
      : subtitlePrefix;
    this.showNoDataError = !durations.length || !(this.powerCurve?.series || []).length;
  }

  private resolveComparisonLabel(): string {
    const comparisonLabel = `${this.powerCurve?.comparisonSeriesLabel || this.powerCurve?.latestSeriesLabel || 'Latest power activity'}`.trim();
    return comparisonLabel
      ? comparisonLabel.charAt(0).toLowerCase() + comparisonLabel.slice(1)
      : 'latest power activity';
  }

  private resolveBenchmarkStats(): PowerCurveBenchmarkStat[] {
    const summaryPoints = this.powerCurve?.summaryPoints || [];
    const stats = POWER_CURVE_BENCHMARK_DURATIONS_SECONDS
      .map(duration => summaryPoints.find(point => point.duration === duration) || null)
      .filter((point): point is { duration: number; power: number } => !!point)
      .map(point => this.buildBenchmarkStat(point));

    if (!stats.length) {
      const fallbackPoint = this.resolveNearestBenchmarkSeriesPoint(PRIMARY_POWER_CURVE_BENCHMARK_DURATION_SECONDS);
      return fallbackPoint ? [this.buildBenchmarkStat(fallbackPoint)] : [];
    }

    return stats;
  }

  private buildBenchmarkStat(
    point: { duration: number; power: number },
  ): PowerCurveBenchmarkStat {
    return {
      duration: point.duration,
      durationLabel: formatPowerCurveBenchmarkDurationLabel(point.duration),
      powerLabel: formatPowerCurveBenchmarkPowerLabel(point.power),
    };
  }

  private resolveNearestBenchmarkSeriesPoint(targetDurationSeconds: number): PowerCurvePoint | null {
    const headlineSeries = (this.powerCurve?.series || []).find(series => series.seriesKey === 'best' || series.seriesKey === 'latestAndBest')
      || this.powerCurve?.series?.[0]
      || null;
    const points = [...(headlineSeries?.points || [])]
      .filter(point => Number.isFinite(point.duration) && Number.isFinite(point.power) && point.duration > 0 && point.power > 0)
      .sort((left, right) => left.duration - right.duration);
    if (!points.length) {
      return null;
    }

    return points.reduce((nearestPoint, point) => (
      Math.abs(Math.log10(point.duration) - Math.log10(targetDurationSeconds))
      < Math.abs(Math.log10(nearestPoint.duration) - Math.log10(targetDurationSeconds))
        ? point
        : nearestPoint
    ), points[0]);
  }

  private buildSeries(): { durations: number[]; series: PowerCurveRenderSeries[] } {
    const durationSet = new Set<number>();
    const validSeries = (this.powerCurve?.series || [])
      .filter(series => Array.isArray(series.points) && series.points.length > 0);
    const series = validSeries.map((seriesEntry, index) => {
      const pointsByDuration = new Map<number, { power: number; wattsPerKg?: number }>();
      seriesEntry.points.forEach((point) => {
        if (!Number.isFinite(point.duration) || !Number.isFinite(point.power)) {
          return;
        }
        const duration = Number(point.duration);
        durationSet.add(duration);
        pointsByDuration.set(duration, {
          power: point.power,
          ...(Number.isFinite(point.wattsPerKg) ? { wattsPerKg: point.wattsPerKg } : {}),
        });
      });
      return {
        label: seriesEntry.label,
        color: resolveEventSeriesColor('Power', index, Math.max(validSeries.length, 1)),
        pointsByDuration,
      };
    }).filter(seriesEntry => seriesEntry.pointsByDuration.size > 0);

    return {
      durations: [...durationSet].sort((left, right) => left - right),
      series,
    };
  }

  private buildOption(renderModel: { durations: number[]; series: PowerCurveRenderSeries[] }): ChartOption {
    const { durations, series } = renderModel;
    if (!durations.length || !series.length) {
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
    const visibleDurationLabels = buildPowerCurveVisibleDurationLabelSet(durations, {
      isMobile: isMobileTooltipViewport,
      chartWidth,
    });
    const values = series.flatMap(seriesEntry => [...seriesEntry.pointsByDuration.values()].map(point => point.power));
    const valueAxis = buildDashboardValueAxisConfig(values);
    const maxSymbolPoints = isMobileTooltipViewport ? 140 : 240;
    const showLegend = series.length > 1;
    const mobileAxisPointerHandle = isMobileTooltipViewport
      ? {
        show: true,
        size: 20,
        margin: 4,
        throttle: 16,
        color: style.axisColor,
      }
      : { show: false };

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      legend: {
        show: showLegend,
        bottom: 0,
        left: 'center',
        textStyle: {
          color: style.textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
      },
      grid: {
        left: 6,
        right: 6,
        top: 8,
        bottom: showLegend ? (isMobileTooltipViewport ? 54 : 44) : 22,
        containLabel: false,
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        axisPointer: { type: 'line' },
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: unknown) => this.formatTooltip(params, style),
      },
      xAxis: {
        type: 'category',
        data: durations,
        boundaryGap: false,
        axisPointer: {
          show: true,
          snap: true,
          triggerTooltip: true,
          label: { show: false },
          handle: mobileAxisPointerHandle,
        },
        axisLine: { lineStyle: { color: style.axisColor } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          interval: 0,
          hideOverlap: true,
          rotate: isMobileTooltipViewport ? 56 : 42,
          color: style.textColor,
          fontSize: style.axisFontSize,
          formatter: (value: string | number) => {
            const duration = Number(value);
            if (isMobileTooltipViewport && !visibleDurationLabels.has(duration)) {
              return '';
            }
            return formatPowerCurveDurationLabel(duration);
          },
        },
      },
      yAxis: {
        type: 'value',
        min: valueAxis.min,
        max: valueAxis.max,
        interval: valueAxis.interval,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.textColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => formatPowerCurvePowerLabel(value),
        },
      },
      series: series.map(seriesEntry => ({
        name: seriesEntry.label,
        type: 'line',
        data: durations.map((duration) => {
          const point = seriesEntry.pointsByDuration.get(duration);
          if (!point) {
            return null;
          }
          return {
            value: point.power,
            wattsPerKg: point.wattsPerKg,
          };
        }),
        showSymbol: durations.length <= maxSymbolPoints,
        symbol: 'circle',
        symbolSize: isMobileTooltipViewport ? 4.5 : 5.5,
        smooth: series.length > 1 ? 0.16 : 0.24,
        connectNulls: false,
        lineStyle: {
          width: series.length > 1 ? 2.2 : 2.8,
          color: seriesEntry.color,
        },
        itemStyle: {
          color: seriesEntry.color,
        },
      })),
    };
  }

  private formatTooltip(params: unknown, style: ReturnType<typeof buildDashboardEChartsStyleTokens>): string {
    const entries = (Array.isArray(params) ? params : [params])
      .filter((entry): entry is {
        axisValue?: string | number;
        seriesName?: string;
        color?: string;
        data?: { value?: number; wattsPerKg?: number } | null;
      } => !!entry && typeof entry === 'object');
    const duration = Number(entries[0]?.axisValue ?? NaN);
    const rows = entries
      .map((entry) => {
        const value = Number(entry.data?.value);
        if (!Number.isFinite(value)) {
          return null;
        }
        const wattsPerKg = Number(entry.data?.wattsPerKg);
        const wattsPerKgLabel = Number.isFinite(wattsPerKg)
          ? ` · ${wattsPerKg.toFixed(2)} W/kg`
          : '';
        return {
          label: entry.seriesName || 'Power',
          value: `${formatPowerCurvePowerLabel(value, true)}${wattsPerKgLabel}`,
          markerColor: entry.color || null,
        };
      })
      .filter((row): row is { label: string; value: string; markerColor: string | null } => row !== null);

    return renderDashboardEChartsTooltipCard(style, {
      title: Number.isFinite(duration) ? formatPowerCurveDurationLabel(duration) : 'Power',
      rows,
    });
  }
}
