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
import { ChartDataCategoryTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type {
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsMultiMetricAggregateOkResponse,
} from '@shared/ai-insights.types';
import { formatUnitAwareDataValue, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildDashboardEChartsStyleTokens } from '../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../helpers/dashboard-echarts-yaxis.helper';
import { formatDashboardBucketDateByInterval } from '../../helpers/dashboard-chart-data.helper';
import { resolveMetricColorGroupKey, resolveEventSeriesColor } from '../../helpers/event-echarts-style.helper';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS, EChartsHostController } from '../../helpers/echarts-host-controller';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { LoggerService } from '../../services/logger.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface MultiMetricChartSeries {
  metricKey: string;
  metricLabel: string;
  dataType: string;
  axisKey: string;
  axisLabel: string;
  axisIndex: number;
  color: string;
  valuesByTime: Map<number, number>;
}

function formatAxisLabel(
  dataType: string,
  value: number,
  unitSettings: UserUnitSettingsInterface | null | undefined,
): string {
  return formatUnitAwareDataValue(dataType, value, unitSettings, {
    stripRepeatedUnit: true,
  }) ?? `${value}`;
}

function resolveAxisKey(metricResult: AiInsightsMultiMetricAggregateMetricResult): string {
  return metricResult.query.dataType;
}

function resolveAxisLabel(metricResult: AiInsightsMultiMetricAggregateMetricResult): string {
  return metricResult.metricLabel;
}

@Component({
  selector: 'app-ai-insights-multi-metric-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-insights-multi-metric-chart.component.html',
  styleUrls: ['./ai-insights-multi-metric-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsMultiMetricChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly response = input.required<AiInsightsMultiMetricAggregateOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);
  readonly userUnitSettings = input<UserUnitSettingsInterface | null>(null);

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly logger = inject(LoggerService);
  private readonly eChartsLoader = inject(EChartsLoaderService);
  private readonly chartHost = new EChartsHostController({
    eChartsLoader: this.eChartsLoader,
    logger: this.logger,
    logPrefix: '[AiInsightsMultiMetricChartComponent]',
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
      || changes['userUnitSettings']
    ) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private getNormalizedUnitSettings(): UserUnitSettingsInterface {
    return normalizeUserUnitSettings(this.userUnitSettings());
  }

  private buildSeries(): {
    timePoints: number[];
    series: MultiMetricChartSeries[];
  } {
    const response = this.response();
    const validMetricResults = response.metricResults.filter((metricResult) => (
      metricResult.query.categoryType === ChartDataCategoryTypes.DateType
      && metricResult.aggregation.buckets.some(bucket => Number.isFinite(bucket.time))
    ));

    const timePointSet = new Set<number>();
    const axisKeyToIndex = new Map<string, number>();
    const axisKeyToLabel = new Map<string, string>();
    const colorGroupKeyToCount = new Map<string, number>();

    validMetricResults.forEach((metricResult) => {
      const colorGroupKey = resolveMetricColorGroupKey(metricResult.query.dataType);
      colorGroupKeyToCount.set(
        colorGroupKey,
        (colorGroupKeyToCount.get(colorGroupKey) ?? 0) + 1,
      );
    });

    const colorGroupKeyToSeenCount = new Map<string, number>();

    const series = validMetricResults.map((metricResult) => {
      const valuesByTime = new Map<number, number>();
      metricResult.aggregation.buckets.forEach((bucket) => {
        if (!Number.isFinite(bucket.time) || !Number.isFinite(bucket.aggregateValue)) {
          return;
        }

        const time = bucket.time as number;
        timePointSet.add(time);
        valuesByTime.set(time, bucket.aggregateValue);
      });

      const axisKey = resolveAxisKey(metricResult);
      if (!axisKeyToIndex.has(axisKey)) {
        axisKeyToIndex.set(axisKey, Math.min(axisKeyToIndex.size, 1));
        axisKeyToLabel.set(axisKey, resolveAxisLabel(metricResult));
      }

      const colorGroupKey = resolveMetricColorGroupKey(metricResult.query.dataType);
      const colorGroupSeriesIndex = colorGroupKeyToSeenCount.get(colorGroupKey) ?? 0;
      colorGroupKeyToSeenCount.set(colorGroupKey, colorGroupSeriesIndex + 1);

      return {
        metricKey: metricResult.metricKey,
        metricLabel: metricResult.metricLabel,
        dataType: metricResult.query.dataType,
        axisKey,
        axisLabel: axisKeyToLabel.get(axisKey) ?? metricResult.metricLabel,
        axisIndex: axisKeyToIndex.get(axisKey) ?? 0,
        color: resolveEventSeriesColor(
          colorGroupKey,
          colorGroupSeriesIndex,
          colorGroupKeyToCount.get(colorGroupKey) ?? 1,
        ),
        valuesByTime,
      } satisfies MultiMetricChartSeries;
    });

    return {
      timePoints: [...timePointSet].sort((left, right) => left - right),
      series,
    };
  }

  private formatTooltip(
    time: number,
    series: MultiMetricChartSeries[],
    locale: string | undefined,
    timeZone: string,
  ): string {
    const title = formatDashboardBucketDateByInterval(
      time,
      this.response().metricResults[0]?.aggregation.resolvedTimeInterval ?? this.response().query.requestedTimeInterval ?? 0,
      locale,
      timeZone,
    );
    const rows = series
      .map((seriesEntry) => {
        const value = seriesEntry.valuesByTime.get(time);
        if (!Number.isFinite(value)) {
          return null;
        }

        return `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:999px;background:${seriesEntry.color};display:inline-block;"></span>
            <span>${seriesEntry.metricLabel}</span>
            <span style="margin-left:auto;font-weight:600;">${formatAxisLabel(seriesEntry.dataType, value as number, this.userUnitSettings())}</span>
          </div>
        `;
      })
      .filter((row): row is string => row !== null)
      .join('');

    return `
      <div style="display:flex;flex-direction:column;gap:6px;min-width:180px;">
        <div style="font-weight:600;">${title}</div>
        ${rows}
      </div>
    `;
  }

  private async refreshChart(): Promise<void> {
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme()),
    );
    if (!chart) {
      return;
    }

    const { timePoints, series } = this.buildSeries();
    if (!timePoints.length || !series.length) {
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

    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const chartStyle = buildDashboardEChartsStyleTokens(this.darkTheme(), chartWidth);
    const locale = this.response().query.dateRange.kind === 'bounded'
      ? undefined
      : undefined;
    const timeZone = this.response().query.dateRange.timezone;
    const isCompactLayout = chartStyle.isCompactLayout;
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const axisGroups = [0, 1]
      .map((axisIndex) => {
        const axisSeries = series.filter(entry => entry.axisIndex === axisIndex);
        if (!axisSeries.length) {
          return null;
        }

        const values = axisSeries.flatMap(entry => [...entry.valuesByTime.values()]);
        const axisConfig = buildDashboardValueAxisConfig(values);
        return {
          axisIndex,
          series: axisSeries,
          axisConfig,
        };
      })
      .filter((axisGroup): axisGroup is NonNullable<typeof axisGroup> => axisGroup !== null);

    const option: ChartOption = {
      animation: this.useAnimations() === true,
      backgroundColor: 'transparent',
      textStyle: {
        color: chartStyle.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      grid: {
        left: 8,
        right: 12,
        top: 72,
        bottom: isCompactLayout ? 20 : 12,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      legend: {
        top: 8,
        left: 0,
        textStyle: {
          color: chartStyle.textColor,
        },
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: isCompactLayout ? 12 : 13,
        },
        formatter: (params: Array<{ axisValue: string | number }>) => {
          const time = Number(params[0]?.axisValue);
          return this.formatTooltip(time, series, locale, timeZone);
        },
      },
      xAxis: {
        type: 'category',
        data: timePoints.map(time => `${time}`),
        boundaryGap: false,
        axisLine: {
          lineStyle: { color: chartStyle.axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: chartStyle.textColor,
          fontSize: chartStyle.axisFontSize,
          hideOverlap: true,
          interval: 0,
          rotate: isCompactLayout ? 54 : 42,
          formatter: (value: string) => formatDashboardBucketDateByInterval(
            Number(value),
            this.response().metricResults[0]?.aggregation.resolvedTimeInterval ?? this.response().query.requestedTimeInterval ?? 0,
            locale,
            timeZone,
          ),
        },
      },
      yAxis: axisGroups.map((axisGroup) => ({
        type: 'value',
        min: axisGroup.axisConfig.min,
        max: axisGroup.axisConfig.max,
        interval: axisGroup.axisConfig.interval,
        position: axisGroup.axisIndex === 0 ? 'left' : 'right',
        name: axisGroup.series[0]?.axisLabel ?? '',
        nameTextStyle: {
          color: chartStyle.textColor,
          fontSize: chartStyle.axisFontSize,
          padding: axisGroup.axisIndex === 0 ? [0, 0, 8, 0] : [0, 0, 8, 0],
        },
        axisLine: {
          lineStyle: { color: chartStyle.axisColor },
        },
        axisTick: { show: false },
        splitLine: {
          show: axisGroup.axisIndex === 0,
          lineStyle: { color: chartStyle.gridColor },
        },
        axisLabel: {
          color: chartStyle.textColor,
          fontSize: chartStyle.axisFontSize,
          formatter: (value: number) => formatAxisLabel(
            axisGroup.series[0]?.dataType ?? '',
            value,
            this.userUnitSettings(),
          ),
        },
      })),
      series: series.map((seriesEntry) => ({
        name: seriesEntry.metricLabel,
        type: 'line',
        yAxisIndex: seriesEntry.axisIndex,
        smooth: false,
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: isCompactLayout ? 6 : 7,
        clip: false,
        lineStyle: {
          color: seriesEntry.color,
          width: 2,
        },
        itemStyle: {
          color: seriesEntry.color,
        },
        data: timePoints.map(time => seriesEntry.valuesByTime.get(time) ?? null),
      })),
    };

    this.chartHost.hideTooltip();
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }
}
