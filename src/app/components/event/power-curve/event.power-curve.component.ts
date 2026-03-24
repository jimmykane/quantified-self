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
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subscription } from 'rxjs';
import type { EChartsType } from 'echarts/core';

import {
  ActivityInterface,
} from '@sports-alliance/sports-lib';
import { AppBreakpoints } from '../../../constants/breakpoints';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  PerformanceCurveDataService,
  PowerCurveChartPoint,
  PowerCurveChartSeries,
} from '../../../services/performance-curve-data.service';
import {
  ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../helpers/echarts-host-controller';
import {
  buildEventEChartsVisualTokens,
  calculateEventEChartsAxisRange,
  toFiniteEventEChartsNumber
} from '../../../helpers/event-echarts-common.helper';
import {
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import {
  buildPowerCurveVisibleDurationLabelSet,
  formatPowerCurveDurationLabel,
  formatPowerCurvePowerLabel,
} from '../../../helpers/power-curve-chart.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

const KEY_POWER_DURATION_MARKERS = [5, 15, 30, 60, 300, 1200, 3600, 7200];

@Component({
  selector: 'app-event-power-curve',
  templateUrl: './event.power-curve.component.html',
  styleUrls: ['./event.power-curve.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventPowerCurveComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() activities: ActivityInterface[] = [];
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() isMerge = false;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private chartHost: EChartsHostController;
  private isMobile = false;
  private breakpointSubscription: Subscription;

  constructor(
    private breakpointObserver: BreakpointObserver,
    private eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    private logger: LoggerService,
    private performanceCurveDataService: PerformanceCurveDataService
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[EventPowerCurveComponent]',
      initOptions: {
        useDirtyRect: true,
      },
    });

    this.breakpointSubscription = this.breakpointObserver
      .observe([AppBreakpoints.XSmall])
      .subscribe((result) => {
        const wasMobile = this.isMobile;
        this.isMobile = result.matches;

        if (this.chartDiv?.nativeElement && wasMobile !== this.isMobile) {
          void this.refreshChart();
        }
      });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      return;
    }

    if (changes.activities || changes.darkTheme || changes.useAnimations || changes.isMerge) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    if (this.breakpointSubscription) {
      this.breakpointSubscription.unsubscribe();
    }
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme)
    );
    if (!chart) {
      return;
    }

    const powerSeries = this.performanceCurveDataService.buildPowerCurveSeries(this.activities, {
      isMerge: this.isMerge,
    });

    const option = this.buildChartOption(powerSeries);
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(powerSeries: PowerCurveChartSeries[]): ChartOption {
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const textColor = chartStyle.textColor;
    const axisColor = chartStyle.axisColor;
    const axisLabelFontSize = chartStyle.axisLabelFontSize;
    const tooltipExtraCssText = chartStyle.tooltipExtraCssText;

    if (powerSeries.length === 0) {
      return {
        animation: this.useAnimations === true,
        backgroundColor: 'transparent',
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const singleActivity = powerSeries.length <= 1;
    const maxSymbolPoints = this.isMobile ? 140 : 240;
    const powerPoints = powerSeries.flatMap((seriesEntry) => seriesEntry.points);
    const xDurations = [...new Set(powerPoints.map((point) => point.duration))]
      .sort((left, right) => left - right);
    const visibleDurationLabels = buildPowerCurveVisibleDurationLabelSet(xDurations, {
      isMobile: this.isMobile,
      chartWidth: this.chartDiv?.nativeElement?.clientWidth ?? 0,
    });
    const powerValues = powerPoints.map((point) => point.power);
    const [powerMin, powerMax] = calculateEventEChartsAxisRange(powerValues, {
      minFloor: 0,
      fallbackMin: 0,
      fallbackMax: 120,
    });

    const series = powerSeries.map((seriesEntry) => {
      const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;
      const pointsByDuration = new Map(seriesEntry.points.map((point) => [point.duration, point]));
      const markerData = singleActivity ? this.buildPowerDurationMarkPoints(seriesEntry.points) : [];

      const lineSeries: Record<string, unknown> = {
        type: 'line',
        id: `power:${seriesEntry.activityId}`,
        name: seriesEntry.label,
        data: xDurations.map((duration) => {
          const point = pointsByDuration.get(duration);
          if (!point) {
            return null;
          }

          return {
            value: point.power,
            duration: point.duration,
            wattsPerKg: point.wattsPerKg,
          };
        }),
        showSymbol: seriesEntry.points.length <= maxSymbolPoints,
        symbol: 'circle',
        symbolSize: this.isMobile ? 4.5 : 5.5,
        smooth: powerSeries.length > 1 ? 0.16 : 0.24,
        clip: false,
        lineStyle: {
          width: powerSeries.length > 1 ? 2.2 : 2.8,
          color: baseColor,
        },
        itemStyle: {
          color: baseColor,
        },
        emphasis: {
          focus: powerSeries.length > 1 ? 'series' : 'none',
          scale: true,
        },
      };

      if (markerData.length > 0) {
        lineSeries['markPoint'] = {
          symbol: 'circle',
          symbolSize: this.isMobile ? 8 : 10,
          itemStyle: {
            color: '#ffffff',
            borderColor: baseColor,
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: (params: { data?: { label?: string } }) => `${params.data?.label ?? ''}`,
            color: textColor,
            fontSize: this.isMobile ? 10 : 11,
            fontWeight: 600,
            offset: [0, -12],
          },
          data: markerData,
        };
      }

      return lineSeries;
    });

    return {
      animation: this.useAnimations === true,
      backgroundColor: 'transparent',
      textStyle: {
        color: textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      legend: {
        show: !singleActivity,
        data: powerSeries.map((seriesEntry) => seriesEntry.label),
        top: 2,
        left: 'center',
        textStyle: {
          color: textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: this.isMobile ? 12 : 13,
        },
      },
      grid: {
        left: 0,
        right: 0,
        top: singleActivity ? 0 : 18,
        bottom: this.isMobile ? 14 : 8,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      xAxis: {
        type: 'category',
        data: xDurations,
        boundaryGap: false,
        axisLine: {
          lineStyle: { color: axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          interval: 0,
          hideOverlap: true,
          rotate: this.isMobile ? 58 : 42,
          fontSize: axisLabelFontSize,
          color: textColor,
          formatter: (value: string | number) => {
            const duration = toFiniteEventEChartsNumber(value) ?? 0;
            if (this.isMobile && !visibleDurationLabels.has(duration)) {
              return '';
            }
            return formatPowerCurveDurationLabel(duration);
          },
        },
      },
      yAxis: {
        type: 'value',
        min: powerMin,
        max: powerMax,
        name: 'Power (W)',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 36 : 44,
        nameTextStyle: {
          color: textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        },
        axisLine: {
          lineStyle: { color: axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          fontSize: axisLabelFontSize,
          color: textColor,
          formatter: (value: number) => formatPowerCurvePowerLabel(value),
        },
      },
      tooltip: {
        trigger: this.isMobile ? 'axis' : 'item',
        triggerOn: resolveEChartsTooltipTriggerOn(true, this.isMobile),
        alwaysShowContent: this.isMobile,
        axisPointer: this.isMobile
          ? {
            type: 'line',
            snap: true,
            label: { show: false },
            handle: {
              show: true,
              size: 22,
              margin: 8,
              color: chartStyle.dataZoomHandleColor,
              shadowBlur: 3,
              shadowColor: chartStyle.emphasisShadowColor,
            },
          }
          : undefined,
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(this.isMobile),
        extraCssText: tooltipExtraCssText,
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        },
        formatter: (params: unknown) => this.formatTooltip(params, !singleActivity),
      },
      series,
    };
  }

  private buildPowerDurationMarkPoints(points: PowerCurveChartPoint[]): Array<{ coord: [number, number]; label: string }> {
    if (!points.length) {
      return [];
    }

    const chartMin = points[0].duration;
    const chartMax = points[points.length - 1].duration;
    const targetDurations = KEY_POWER_DURATION_MARKERS
      .filter((duration) => duration >= chartMin && duration <= chartMax);

    if (!targetDurations.includes(chartMax)) {
      targetDurations.push(chartMax);
    }

    const selected = new Map<number, { coord: [number, number]; label: string }>();

    targetDurations.forEach((targetDuration) => {
      const nearest = this.getNearestPowerPoint(points, targetDuration);
      if (!nearest) {
        return;
      }

      const ratioDiff = Math.abs(nearest.duration - targetDuration) / Math.max(targetDuration, 1);
      if (targetDuration !== chartMax && ratioDiff > 0.3) {
        return;
      }

      if (selected.has(nearest.duration)) {
        if (targetDuration === chartMax) {
          const existing = selected.get(nearest.duration);
          if (existing) {
            const shouldUsePlusLabel = chartMax >= 7200 && existing.label.includes('02h');
            existing.label = shouldUsePlusLabel
              ? '02h+'
              : formatPowerCurveDurationLabel(nearest.duration);
            selected.set(nearest.duration, existing);
          }
        }
        return;
      }

      const labelDuration = targetDuration === chartMax ? nearest.duration : targetDuration;
      selected.set(nearest.duration, {
        coord: [nearest.duration, nearest.power],
        label: formatPowerCurveDurationLabel(labelDuration),
      });
    });

    if (chartMax >= 7200) {
      const hasTwoHourLabel = [...selected.values()].some((entry) => entry.label.includes('02h'));
      if (!hasTwoHourLabel) {
        const nearestTwoHourPoint = this.getNearestPowerPoint(points, 7200);
        if (nearestTwoHourPoint) {
          selected.set(nearestTwoHourPoint.duration, {
            coord: [nearestTwoHourPoint.duration, nearestTwoHourPoint.power],
            label: formatPowerCurveDurationLabel(7200),
          });
        }
      }
    }

    return [...selected.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, marker]) => marker);
  }

  private getNearestPowerPoint(points: PowerCurveChartPoint[], targetDuration: number): PowerCurveChartPoint | null {
    if (!points.length) {
      return null;
    }

    return points.reduce((closest, candidate) => {
      const candidateDistance = Math.abs(Math.log10(Math.max(1, candidate.duration)) - Math.log10(Math.max(1, targetDuration)));
      const closestDistance = Math.abs(Math.log10(Math.max(1, closest.duration)) - Math.log10(Math.max(1, targetDuration)));
      return candidateDistance < closestDistance ? candidate : closest;
    }, points[0]);
  }

  private formatTooltip(params: unknown, hasMultipleActivities: boolean): string {
    const resolved = Array.isArray(params)
      ? params.find((item: any) => item && item.data)
      : params;

    const entry = resolved as {
      seriesName?: string;
      data?: {
        duration?: unknown;
        value?: unknown;
        wattsPerKg?: unknown;
      };
      value?: unknown;
    };

    const duration = toFiniteEventEChartsNumber(entry?.data?.duration) ?? toFiniteEventEChartsNumber(entry?.value) ?? 0;
    const power = toFiniteEventEChartsNumber(entry?.data?.value) ?? toFiniteEventEChartsNumber(entry?.value);
    if (power === null) {
      return '';
    }

    const wattsPerKg = toFiniteEventEChartsNumber(entry?.data?.wattsPerKg);
    const activityPrefix = hasMultipleActivities ? `${entry.seriesName}: ` : '';
    const wattsPerKgLabel = wattsPerKg && wattsPerKg > 0
      ? ` (${wattsPerKg.toFixed(2)} W/kg)`
      : '';

    return `<b>${formatPowerCurveDurationLabel(duration)}</b><br/>${activityPrefix}Power: <b>${formatPowerCurvePowerLabel(power, true)}</b>${wattsPerKgLabel}`;
  }

}
