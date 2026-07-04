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

  public headlineValueText = '--';
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
    const summaryPoint = this.resolveHeadlineSummaryPoint();
    this.headlineValueText = summaryPoint
      ? `${formatPowerCurveDurationLabel(summaryPoint.duration)} ${formatPowerCurvePowerLabel(summaryPoint.power, true)}`
      : '--';
    const matchedEventCount = this.powerCurve?.matchedEventCount ?? 0;
    this.subtitleText = matchedEventCount > 0
      ? `Best + latest activity · ${matchedEventCount} ${matchedEventCount === 1 ? 'event' : 'events'}`
      : 'Best + latest activity';
    this.showNoDataError = !durations.length || !(this.powerCurve?.series || []).length;
  }

  private resolveHeadlineSummaryPoint(): { duration: number; power: number } | null {
    const summaryPoints = this.powerCurve?.summaryPoints || [];
    return summaryPoints.find(point => point.duration === 300)
      || summaryPoints.find(point => point.duration === 60)
      || summaryPoints[0]
      || this.resolveNearestHeadlineSeriesPoint()
      || null;
  }

  private resolveNearestHeadlineSeriesPoint(): PowerCurvePoint | null {
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
      Math.abs(Math.log10(point.duration) - Math.log10(300))
      < Math.abs(Math.log10(nearestPoint.duration) - Math.log10(300))
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

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      legend: {
        show: showLegend,
        top: 0,
        right: 4,
        textStyle: {
          color: style.textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
      },
      grid: {
        left: 6,
        right: 6,
        top: showLegend ? 20 : 8,
        bottom: 22,
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
