import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  input,
} from '@angular/core';
import type { EChartsType } from 'echarts/core';
import type { AiInsightsPowerCurveOkResponse } from '@shared/ai-insights.types';
import { formatDashboardBucketDateByInterval } from '../../helpers/dashboard-chart-data.helper';
import { resolveEventSeriesColor } from '../../helpers/event-echarts-style.helper';
import { buildEventEChartsVisualTokens } from '../../helpers/event-echarts-common.helper';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS, EChartsHostController } from '../../helpers/echarts-host-controller';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import {
  buildPowerCurveVisibleDurationLabelSet,
  formatPowerCurveDurationLabel,
  formatPowerCurvePowerLabel,
} from '../../helpers/power-curve-chart.helper';
import { LoggerService } from '../../services/logger.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface PowerCurveSeriesEntry {
  label: string;
  color: string;
  pointsByDuration: Map<number, { power: number; wattsPerKg?: number }>;
}

@Component({
  selector: 'app-ai-insights-power-curve-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-insights-power-curve-chart.component.html',
  styleUrls: ['./ai-insights-power-curve-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsPowerCurveChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly response = input.required<AiInsightsPowerCurveOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly logger = inject(LoggerService);
  private readonly eChartsLoader = inject(EChartsLoaderService);
  private readonly chartHost = new EChartsHostController({
    eChartsLoader: this.eChartsLoader,
    logger: this.logger,
    logPrefix: '[AiInsightsPowerCurveChartComponent]',
  });

  ngAfterViewInit(): void {
    void this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      return;
    }

    if (
      changes['response']
      || changes['darkTheme']
      || changes['useAnimations']
    ) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private formatSeriesLabel(series: AiInsightsPowerCurveOkResponse['powerCurve']['series'][number]): string {
    if (this.response().powerCurve.mode !== 'compare_over_time') {
      return series.label;
    }

    const bucketStartDate = series.bucketStartDate ? new Date(series.bucketStartDate) : null;
    if (!(bucketStartDate instanceof Date) || !Number.isFinite(bucketStartDate.getTime())) {
      return series.label;
    }

    return formatDashboardBucketDateByInterval(
      bucketStartDate.getTime(),
      this.response().powerCurve.resolvedTimeInterval,
      undefined,
      this.response().query.dateRange.timezone,
    );
  }

  private buildSeries(): {
    durations: number[];
    series: PowerCurveSeriesEntry[];
  } {
    const response = this.response();
    const validSeries = response.powerCurve.series.filter(seriesEntry => seriesEntry.points.length > 0);
    const durationSet = new Set<number>();

    const series = validSeries.map((seriesEntry, index) => {
      const pointsByDuration = new Map<number, { power: number; wattsPerKg?: number }>();
      for (const point of seriesEntry.points) {
        if (!Number.isFinite(point.duration) || !Number.isFinite(point.power)) {
          continue;
        }
        const duration = Number(point.duration);
        durationSet.add(duration);
        pointsByDuration.set(duration, {
          power: point.power,
          ...(Number.isFinite(point.wattsPerKg) ? { wattsPerKg: point.wattsPerKg } : {}),
        });
      }

      return {
        label: this.formatSeriesLabel(seriesEntry),
        color: resolveEventSeriesColor('Power', index, validSeries.length),
        pointsByDuration,
      } satisfies PowerCurveSeriesEntry;
    });

    return {
      durations: [...durationSet.values()].sort((left, right) => left - right),
      series,
    };
  }

  private formatTooltipDuration(
    duration: number,
  ): string {
    return formatPowerCurveDurationLabel(duration);
  }

  private formatTooltip(params: unknown): string {
    const entries = Array.isArray(params) ? params : [params];
    const validEntries = entries.filter((entry): entry is {
      axisValue?: number | string;
      seriesName?: string;
      color?: string;
      data?: {
        value?: number;
        wattsPerKg?: number;
      } | null;
    } => !!entry && typeof entry === 'object');

    const duration = Number(validEntries[0]?.axisValue ?? NaN);
    const title = Number.isFinite(duration)
      ? this.formatTooltipDuration(duration)
      : 'Power';

    const rows = validEntries
      .map((entry) => {
        const value = Number(entry.data?.value);
        if (!Number.isFinite(value)) {
          return null;
        }

        const wattsPerKg = Number(entry.data?.wattsPerKg);
        const wattsPerKgLabel = Number.isFinite(wattsPerKg)
          ? ` • ${wattsPerKg.toFixed(2)} W/kg`
          : '';

        return `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:999px;background:${entry.color};display:inline-block;"></span>
            <span>${entry.seriesName ?? ''}</span>
            <span style="margin-left:auto;font-weight:600;">${formatPowerCurvePowerLabel(value, true)}${wattsPerKgLabel}</span>
          </div>
        `;
      })
      .filter((row): row is string => row !== null)
      .join('');

    return `
      <div style="display:flex;flex-direction:column;gap:6px;min-width:200px;">
        <div style="font-weight:600;">${title}</div>
        ${rows}
      </div>
    `;
  }

  private resolveGridTop(seriesCount: number): number {
    return seriesCount > 1 ? 18 : 0;
  }

  private async refreshChart(): Promise<void> {
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme()),
    );
    if (!chart) {
      return;
    }

    const { durations, series } = this.buildSeries();
    if (!durations.length || !series.length) {
      this.chartHost.setOption({
        animation: this.useAnimations() === true,
        tooltip: { show: false },
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      }, { notMerge: true, lazyUpdate: false });
      this.chartHost.scheduleResize();
      return;
    }

    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme(), isMobileTooltipViewport);
    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const visibleDurationLabels = buildPowerCurveVisibleDurationLabelSet(durations, {
      isMobile: isMobileTooltipViewport,
      chartWidth,
    });
    const showLegend = series.length > 1 && series.length <= 12;
    const axisLabelFontSize = chartStyle.axisLabelFontSize;
    const legendFontSize = isMobileTooltipViewport ? 12 : 13;
    const lineWidth = series.length > 1 ? 2.2 : 2.8;
    const lineSmoothness = series.length > 1 ? 0.16 : 0.24;
    const maxSymbolPoints = isMobileTooltipViewport ? 140 : 240;

    const option: ChartOption = {
      animation: this.useAnimations() === true,
      backgroundColor: 'transparent',
      textStyle: {
        color: chartStyle.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      legend: {
        show: showLegend,
        top: 4,
        left: 'center',
        textStyle: {
          color: chartStyle.textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: legendFontSize,
        },
      },
      grid: {
        left: 0,
        right: 0,
        top: showLegend ? this.resolveGridTop(series.length) : 0,
        bottom: isMobileTooltipViewport ? 14 : 8,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      xAxis: {
        type: 'category',
        data: durations,
        boundaryGap: false,
        axisLine: { lineStyle: { color: chartStyle.axisColor } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          interval: 0,
          hideOverlap: true,
          rotate: isMobileTooltipViewport ? 58 : 42,
          color: chartStyle.textColor,
          fontSize: axisLabelFontSize,
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
        min: 'dataMin',
        max: 'dataMax',
        name: 'Power (W)',
        nameLocation: 'middle',
        nameGap: isMobileTooltipViewport ? 36 : 44,
        nameTextStyle: {
          color: chartStyle.textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        },
        axisLine: { lineStyle: { color: chartStyle.axisColor } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: chartStyle.textColor,
          fontSize: axisLabelFontSize,
          formatter: (value: number) => formatPowerCurvePowerLabel(value),
        },
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        alwaysShowContent: isMobileTooltipViewport,
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        extraCssText: chartStyle.tooltipExtraCssText,
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        },
        formatter: (params: unknown) => this.formatTooltip(params),
      },
      series: series.map((seriesEntry) => ({
        type: 'line',
        name: seriesEntry.label,
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
        smooth: lineSmoothness,
        connectNulls: false,
        lineStyle: {
          width: lineWidth,
          color: seriesEntry.color,
        },
        itemStyle: {
          color: seriesEntry.color,
        },
      })),
    };

    this.chartHost.setOption(option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }
}
