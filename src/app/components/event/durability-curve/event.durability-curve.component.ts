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
  DataDuration,
  DataHeartRate,
  DataPower,
} from '@sports-alliance/sports-lib';
import { AppBreakpoints } from '../../../constants/breakpoints';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  PerformanceCurveBestEffortMarker,
  PerformanceCurveDataService,
  PerformanceCurveDurabilitySeries,
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

type ChartOption = Parameters<EChartsType['setOption']>[0];

const DEFAULT_ROLLING_WINDOW_SECONDS = 180;
const BEST_EFFORT_WINDOWS = [5, 30, 60, 300, 1200, 3600, 7200];
const DURATION_TICK_CANDIDATES_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
const EFFICIENCY_TICK_CANDIDATES = [0.05, 0.1, 0.2, 0.25, 0.5];
const EFFORT_MARKER_COLORS = ['#ff7043', '#ffa726', '#ffd54f', '#66bb6a', '#42a5f5', '#ab47bc'];
const DURABILITY_FALLBACK_COLORS = ['#16B4EA', '#FF7043', '#66BB6A', '#AB47BC', '#FFA726', '#42A5F5', '#EC407A'];

@Component({
  selector: 'app-event-durability-curve',
  templateUrl: './event.durability-curve.component.html',
  styleUrls: ['./event.durability-curve.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventDurabilityCurveComponent implements AfterViewInit, OnChanges, OnDestroy {
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
      logPrefix: '[EventDurabilityCurveComponent]',
      initOptions: {
        useDirtyRect: true,
      },
    });

    this.breakpointSubscription = this.breakpointObserver
      .observe([AppBreakpoints.XSmall])
      .subscribe((result) => {
        const wasMobile = this.isMobile;
        this.isMobile = result.matches;

        if (this.chartHost.getChart() && wasMobile !== this.isMobile) {
          this.refreshChart();
        }
      });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.chartHost.init(this.chartDiv?.nativeElement);
    this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartHost.getChart()) {
      return;
    }

    if (changes.activities || changes.darkTheme || changes.useAnimations || changes.isMerge) {
      this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    if (this.breakpointSubscription) {
      this.breakpointSubscription.unsubscribe();
    }
    this.chartHost.dispose();
  }

  private refreshChart(): void {
    if (!this.chartHost.getChart()) {
      return;
    }

    const { renderSeries: durabilitySeries, markerSourceSeries } = this.performanceCurveDataService
      .buildDurabilitySeriesWithMarkerSource(this.activities, {
        isMerge: this.isMerge,
        rollingWindowSeconds: DEFAULT_ROLLING_WINDOW_SECONDS,
        maxPointsPerSeries: this.isMobile ? 220 : 640,
      });
    const bestEffortMarkers = this.performanceCurveDataService.buildBestEffortMarkers(markerSourceSeries, {
      windowDurations: BEST_EFFORT_WINDOWS,
      maxMarkersPerWindow: this.isMobile ? 3 : 6,
    });

    const option = this.buildChartOption(durabilitySeries, bestEffortMarkers);
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(
    durabilitySeries: PerformanceCurveDurabilitySeries[],
    bestEffortMarkers: PerformanceCurveBestEffortMarker[]
  ): ChartOption {
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const darkTheme = chartStyle.darkTheme;
    const textColor = chartStyle.textColor;
    const axisColor = chartStyle.axisColor;
    const axisLabelFontSize = chartStyle.axisLabelFontSize;
    const tooltipExtraCssText = chartStyle.tooltipExtraCssText;

    if (durabilitySeries.length === 0) {
      return {
        animation: this.useAnimations === true,
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const activityLabels = new Set<string>(durabilitySeries.map((seriesEntry) => seriesEntry.label));
    const markerLabels = new Set<string>(bestEffortMarkers.map((marker) => marker.windowLabel));
    const singleActivity = activityLabels.size <= 1;
    const legendData = singleActivity
      ? [...markerLabels.values()]
      : [...new Set([...activityLabels.values(), ...markerLabels.values()]).values()];
    const showLegend = legendData.length > 0;

    const durabilityPoints = durabilitySeries.flatMap((seriesEntry) => seriesEntry.points);
    const durations = durabilityPoints.map((point) => point.duration);
    const efficiencyValues = durabilityPoints.map((point) => point.efficiency);
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 1;
    const durationAxis = this.buildDurationAxisConfig(maxDuration);
    const [efficiencyMin, efficiencyMax] = calculateEventEChartsAxisRange(efficiencyValues, {
      fallbackMin: 1,
      fallbackMax: 2.5,
    });
    const efficiencyAxis = this.buildEfficiencyAxisConfig(efficiencyMin, efficiencyMax);

    const usedSeriesColors = new Set<string>();
    const series: Array<Record<string, unknown>> = durabilitySeries.map((seriesEntry, seriesIndex) => {
      const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;
      const seriesColor = this.resolveUniqueColor(baseColor, usedSeriesColors, seriesIndex, DURABILITY_FALLBACK_COLORS);
      return {
        type: 'line',
        id: `durability:${seriesEntry.activityId}`,
        name: seriesEntry.label,
        data: seriesEntry.points.map((point) => ({
          value: [point.duration, point.efficiency],
          duration: point.duration,
          efficiency: point.efficiency,
          power: point.power,
          heartRate: point.heartRate,
        })),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: {
          width: 2,
          color: seriesColor,
        },
        itemStyle: {
          color: seriesColor,
        },
        emphasis: {
          focus: activityLabels.size > 1 ? 'series' : 'none',
          scale: true,
        },
        z: 15,
      };
    });

    const markersByWindow = bestEffortMarkers.reduce((map, marker) => {
      const collection = map.get(marker.windowLabel) ?? [];
      collection.push(marker);
      map.set(marker.windowLabel, collection);
      return map;
    }, new Map<string, PerformanceCurveBestEffortMarker[]>());

    [...markersByWindow.entries()].forEach(([windowLabel, markerEntries], index) => {
      const preferredMarkerColor = EFFORT_MARKER_COLORS[index % EFFORT_MARKER_COLORS.length];
      const markerColor = this.resolveUniqueColor(
        preferredMarkerColor,
        usedSeriesColors,
        index,
        [...EFFORT_MARKER_COLORS, ...DURABILITY_FALLBACK_COLORS]
      );
      series.push({
        type: 'scatter',
        id: `effort:${windowLabel}`,
        name: windowLabel,
        symbol: 'diamond',
        symbolSize: this.isMobile ? 6 : 8,
        itemStyle: {
          color: markerColor,
          borderColor: darkTheme ? '#000000' : '#ffffff',
          borderWidth: 1,
        },
        data: markerEntries.map((marker) => ({
          value: [marker.duration, marker.efficiency],
          duration: marker.duration,
          efficiency: marker.efficiency,
          markerPower: marker.power,
          startDuration: marker.startDuration,
          endDuration: marker.endDuration,
          windowLabel: marker.windowLabel,
          activityLabel: marker.activityLabel,
        })),
        z: 40,
      });
    });

    return {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif",
      },
      legend: {
        show: showLegend,
        data: legendData,
        icon: 'circle',
        itemWidth: this.isMobile ? 8 : 10,
        itemHeight: this.isMobile ? 8 : 10,
        type: legendData.length > 5 ? 'scroll' : 'plain',
        top: 2,
        left: 'center',
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: this.isMobile ? 12 : 13,
        },
      },
      grid: {
        left: 0,
        right: 0,
        top: showLegend ? 18 : 0,
        bottom: this.isMobile ? 8 : 4,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: durationAxis.max,
        interval: durationAxis.interval,
        axisLine: {
          lineStyle: { color: axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          hideOverlap: true,
          color: textColor,
          fontSize: axisLabelFontSize,
          formatter: (value: number) => this.formatDurationLabel(value),
        },
      },
      yAxis: {
        type: 'value',
        min: efficiencyAxis.min,
        max: efficiencyAxis.max,
        interval: efficiencyAxis.interval,
        name: 'W/bpm',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 36 : 42,
        nameTextStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        axisLine: {
          lineStyle: { color: axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          hideOverlap: true,
          color: textColor,
          fontSize: axisLabelFontSize,
          formatter: (value: number) => this.formatEfficiencyAxisLabel(value),
        },
      },
      tooltip: {
        trigger: this.isMobile ? 'axis' : 'item',
        triggerOn: this.isMobile ? 'click' : 'mousemove|click',
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
              color: darkTheme ? '#90caf9' : '#1976d2',
              shadowBlur: 3,
              shadowColor: darkTheme ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)',
            },
          }
          : undefined,
        appendToBody: !this.isMobile,
        confine: this.isMobile,
        extraCssText: tooltipExtraCssText,
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        formatter: (params: unknown) => this.formatTooltip(params, activityLabels.size > 1),
      },
      series,
    };
  }

  private formatTooltip(params: unknown, hasMultipleActivities: boolean): string {
    const resolved = Array.isArray(params)
      ? params.find((item: any) => item && item.data)
      : params;

    const entry = resolved as {
      seriesId?: string;
      seriesName?: string;
      data?: any;
      value?: unknown;
    };

    if (!entry || !entry.seriesId) {
      return '';
    }

    const paneType = `${entry.seriesId}`.split(':')[0];
    const data = entry.data ?? {};

    if (paneType === 'durability') {
      const duration = toFiniteEventEChartsNumber(data.duration) ?? this.extractTupleValue(entry.value, 0) ?? 0;
      const efficiency = toFiniteEventEChartsNumber(data.efficiency) ?? this.extractTupleValue(entry.value, 1);
      const power = toFiniteEventEChartsNumber(data.power);
      const heartRate = toFiniteEventEChartsNumber(data.heartRate);

      if (efficiency === null) {
        return '';
      }

      const lines = [`<b>${this.formatDurationLabel(duration)}</b>`];
      if (hasMultipleActivities) {
        lines.push(`${entry.seriesName}`);
      }

      lines.push(`Efficiency: <b>${efficiency.toFixed(2)} W/bpm</b>`);
      if (power !== null && heartRate !== null) {
        lines.push(`Rolling: <b>${this.formatPowerLabel(power, true)}</b> / <b>${this.formatHeartRateLabel(heartRate, true)}</b>`);
      }

      return lines.join('<br/>');
    }

    if (paneType === 'effort') {
      const windowLabel = `${data.windowLabel ?? entry.seriesName ?? ''}`;
      const activityLabel = `${data.activityLabel ?? ''}`;
      const power = toFiniteEventEChartsNumber(data.markerPower);
      const startDuration = toFiniteEventEChartsNumber(data.startDuration);
      const endDuration = toFiniteEventEChartsNumber(data.endDuration);

      if (!windowLabel || power === null) {
        return '';
      }

      const intervalLabel = (startDuration !== null && endDuration !== null)
        ? `${this.formatDurationLabel(startDuration)} - ${this.formatDurationLabel(endDuration)}`
        : '';

      const lines = [`<b>${windowLabel} Best Effort</b>`];
      if (activityLabel.length > 0) {
        lines.push(activityLabel);
      }

      lines.push(`Power: <b>${this.formatPowerLabel(power, true)}</b>`);
      if (intervalLabel.length > 0) {
        lines.push(`Window: <b>${intervalLabel}</b>`);
      }

      return lines.join('<br/>');
    }

    return '';
  }

  private extractTupleValue(value: unknown, index: number): number | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return toFiniteEventEChartsNumber(value[index]);
  }

  private resolveUniqueColor(
    preferredColor: string,
    usedColors: Set<string>,
    seriesIndex: number,
    palette: string[]
  ): string {
    const normalizedPreferred = `${preferredColor}`.trim().toLowerCase();
    if (normalizedPreferred.length > 0 && !usedColors.has(normalizedPreferred)) {
      usedColors.add(normalizedPreferred);
      return preferredColor;
    }

    for (let i = 0; i < palette.length; i += 1) {
      const candidate = palette[(seriesIndex + i) % palette.length];
      const normalizedCandidate = candidate.toLowerCase();
      if (!usedColors.has(normalizedCandidate)) {
        usedColors.add(normalizedCandidate);
        return candidate;
      }
    }

    const fallback = palette[seriesIndex % palette.length];
    usedColors.add(fallback.toLowerCase());
    return fallback;
  }

  private buildDurationAxisConfig(maxDuration: number): { max: number; interval: number } {
    if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
      return { max: 60, interval: 10 };
    }

    const targetTicks = this.isMobile ? 6 : 9;
    let bestInterval = DURATION_TICK_CANDIDATES_SECONDS[0];
    let bestScore = Number.POSITIVE_INFINITY;

    DURATION_TICK_CANDIDATES_SECONDS.forEach((candidate) => {
      const roundedMax = Math.ceil(maxDuration / candidate) * candidate;
      const ticks = Math.floor(roundedMax / candidate) + 1;
      const score = Math.abs(ticks - targetTicks);
      if (score < bestScore) {
        bestInterval = candidate;
        bestScore = score;
      }
    });

    const roundedMax = Math.ceil(maxDuration / bestInterval) * bestInterval;
    return {
      max: Math.max(bestInterval, roundedMax),
      interval: bestInterval,
    };
  }

  private buildEfficiencyAxisConfig(minValue: number, maxValue: number): { min: number; max: number; interval: number } {
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
      return { min: 1, max: 2.5, interval: 0.25 };
    }

    const targetTicks = this.isMobile ? 5 : 7;
    let bestInterval = EFFICIENCY_TICK_CANDIDATES[0];
    let bestScore = Number.POSITIVE_INFINITY;

    EFFICIENCY_TICK_CANDIDATES.forEach((candidate) => {
      const snappedMin = Math.floor(minValue / candidate) * candidate;
      const snappedMax = Math.ceil(maxValue / candidate) * candidate;
      const tickCount = Math.floor((snappedMax - snappedMin) / candidate) + 1;
      const score = Math.abs(tickCount - targetTicks);
      if (score < bestScore) {
        bestScore = score;
        bestInterval = candidate;
      }
    });

    const snappedMin = Math.floor(minValue / bestInterval) * bestInterval;
    const snappedMax = Math.ceil(maxValue / bestInterval) * bestInterval;
    return {
      min: snappedMin,
      max: Math.max(snappedMin + bestInterval, snappedMax),
      interval: bestInterval,
    };
  }

  private formatDurationLabel(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '';
    }

    return new DataDuration(seconds).getDisplayValue(false, false).trim();
  }

  private formatEfficiencyAxisLabel(value: number): string {
    if (!Number.isFinite(value)) {
      return '';
    }

    return value.toFixed(2).replace(/\.?0+$/, '');
  }

  private formatPowerLabel(power: number, includeUnit = false): string {
    if (!Number.isFinite(power)) {
      return '';
    }

    const dataPower = new DataPower(power);
    const value = `${dataPower.getDisplayValue()}`.trim();
    if (!includeUnit) {
      return value;
    }

    const unit = `${dataPower.getDisplayUnit()}`.trim();
    return unit.length > 0
      ? `${value} ${unit}`
      : value;
  }

  private formatHeartRateLabel(heartRate: number, includeUnit = false): string {
    if (!Number.isFinite(heartRate)) {
      return '';
    }

    const dataHeartRate = new DataHeartRate(heartRate);
    const value = `${dataHeartRate.getDisplayValue()}`.trim();
    if (!includeUnit) {
      return value;
    }

    const unit = `${dataHeartRate.getDisplayUnit()}`.trim();
    return unit.length > 0
      ? `${value} ${unit}`
      : value;
  }

}
