import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  NgZone,
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
  ChartThemes,
  DataDuration,
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

type ChartOption = Parameters<EChartsType['setOption']>[0];

const DEFAULT_ROLLING_WINDOW_SECONDS = 180;
const BEST_EFFORT_WINDOWS = [5, 30, 60, 300, 1200, 3600, 7200];
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
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() useAnimations = false;
  @Input() isMerge = false;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private chart: EChartsType | null = null;
  private isMobile = false;
  private breakpointSubscription: Subscription;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrameId: number | null = null;

  constructor(
    private breakpointObserver: BreakpointObserver,
    private eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    private logger: LoggerService,
    private performanceCurveDataService: PerformanceCurveDataService,
    private zone: NgZone
  ) {
    this.breakpointSubscription = this.breakpointObserver
      .observe([AppBreakpoints.XSmall])
      .subscribe((result) => {
        const wasMobile = this.isMobile;
        this.isMobile = result.matches;

        if (this.chart && wasMobile !== this.isMobile) {
          this.refreshChart();
        }
      });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.initializeChart();
    this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chart) {
      return;
    }

    if (changes.activities || changes.chartTheme || changes.useAnimations || changes.isMerge) {
      this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    if (this.breakpointSubscription) {
      this.breakpointSubscription.unsubscribe();
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.resizeFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.resizeFrameId);
      this.resizeFrameId = null;
    }

    this.eChartsLoader.dispose(this.chart);
    this.chart = null;
  }

  private async initializeChart(): Promise<void> {
    if (!this.chartDiv?.nativeElement) {
      return;
    }

    try {
      this.chart = await this.eChartsLoader.init(this.chartDiv.nativeElement);
      this.setupResizeObserver();
    } catch (error) {
      this.logger.error('[EventDurabilityCurveComponent] Failed to initialize ECharts', error);
    }
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined' || !this.chartDiv?.nativeElement) {
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleResize();
      });
      this.resizeObserver.observe(this.chartDiv.nativeElement);
    });
  }

  private refreshChart(): void {
    if (!this.chart) {
      return;
    }

    const durabilitySeries = this.performanceCurveDataService.buildDurabilitySeries(this.activities, {
      isMerge: this.isMerge,
      rollingWindowSeconds: DEFAULT_ROLLING_WINDOW_SECONDS,
      maxPointsPerSeries: this.isMobile ? 220 : 640,
    });
    // Keep the rendered line downsampled for performance, but compute effort markers from
    // full-resolution durability so long windows (e.g. 2h) are not lost by downsampling.
    const markerSourceSeries = this.performanceCurveDataService.buildDurabilitySeries(this.activities, {
      isMerge: this.isMerge,
      rollingWindowSeconds: DEFAULT_ROLLING_WINDOW_SECONDS,
    });
    const bestEffortMarkers = this.performanceCurveDataService.buildBestEffortMarkers(markerSourceSeries, {
      windowDurations: BEST_EFFORT_WINDOWS,
      maxMarkersPerWindow: this.isMobile ? 3 : 6,
    });

    const option = this.buildChartOption(durabilitySeries, bestEffortMarkers);
    this.eChartsLoader.setOption(this.chart, option, { notMerge: true, lazyUpdate: true });
    this.scheduleResize();
  }

  private buildChartOption(
    durabilitySeries: PerformanceCurveDurabilitySeries[],
    bestEffortMarkers: PerformanceCurveBestEffortMarker[]
  ): ChartOption {
    const darkTheme = this.isDarkThemeActive();
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const axisColor = darkTheme ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.24)';
    const axisLabelFontSize = this.isMobile ? 11 : 12;

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
    const [efficiencyMin, efficiencyMax] = this.calculateAxisRange(efficiencyValues, {
      fallbackMin: 1,
      fallbackMax: 2.5,
    });

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
        max: maxDuration,
        axisLine: {
          lineStyle: { color: axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: textColor,
          fontSize: axisLabelFontSize,
          formatter: (value: number) => this.formatDurationLabel(value),
        },
      },
      yAxis: {
        type: 'value',
        min: efficiencyMin,
        max: efficiencyMax,
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
          color: textColor,
          fontSize: axisLabelFontSize,
          formatter: (value: number) => value.toFixed(2),
        },
      },
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        confine: false,
        backgroundColor: darkTheme ? '#222222' : '#ffffff',
        borderColor: darkTheme ? '#555555' : '#d6d6d6',
        borderWidth: 1,
        textStyle: {
          color: darkTheme ? '#ffffff' : '#2a2a2a',
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        formatter: (params: unknown) => this.formatTooltip(params, activityLabels.size > 1),
      },
      series,
    };
  }

  private formatTooltip(params: unknown, hasMultipleActivities: boolean): string {
    const entry = params as {
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
      const duration = this.toFiniteNumber(data.duration) ?? this.extractTupleValue(entry.value, 0) ?? 0;
      const efficiency = this.toFiniteNumber(data.efficiency) ?? this.extractTupleValue(entry.value, 1);
      const power = this.toFiniteNumber(data.power);
      const heartRate = this.toFiniteNumber(data.heartRate);

      if (efficiency === null) {
        return '';
      }

      const lines = [`<b>${this.formatDurationLabel(duration)}</b>`];
      if (hasMultipleActivities) {
        lines.push(`${entry.seriesName}`);
      }

      lines.push(`Efficiency: <b>${efficiency.toFixed(2)} W/bpm</b>`);
      if (power !== null && heartRate !== null) {
        lines.push(`Rolling: <b>${Math.round(power)} W</b> / <b>${Math.round(heartRate)} bpm</b>`);
      }

      return lines.join('<br/>');
    }

    if (paneType === 'effort') {
      const windowLabel = `${data.windowLabel ?? entry.seriesName ?? ''}`;
      const activityLabel = `${data.activityLabel ?? ''}`;
      const power = this.toFiniteNumber(data.markerPower);
      const startDuration = this.toFiniteNumber(data.startDuration);
      const endDuration = this.toFiniteNumber(data.endDuration);

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

      lines.push(`Power: <b>${Math.round(power)} W</b>`);
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

    return this.toFiniteNumber(value[index]);
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

  private calculateAxisRange(values: number[], options: { fallbackMin: number; fallbackMax: number }): [number, number] {
    const validValues = values.filter((value) => Number.isFinite(value));
    if (!validValues.length) {
      return [options.fallbackMin, options.fallbackMax];
    }

    const minRaw = Math.min(...validValues);
    const maxRaw = Math.max(...validValues);
    const range = Math.max(1, maxRaw - minRaw);
    const padding = Math.max(0.05, range * 0.12);

    const min = minRaw - padding;
    let max = maxRaw + padding;

    if (max <= min) {
      max = min + 1;
    }

    return [min, max];
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    return null;
  }

  private formatDurationLabel(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '';
    }

    return new DataDuration(seconds).getDisplayValue(false, false).trim();
  }

  private scheduleResize(): void {
    if (!this.chart) {
      return;
    }

    if (typeof requestAnimationFrame === 'undefined') {
      this.eChartsLoader.resize(this.chart);
      return;
    }

    if (this.resizeFrameId !== null) {
      return;
    }

    this.resizeFrameId = requestAnimationFrame(() => {
      this.resizeFrameId = null;
      if (!this.chart) {
        return;
      }

      this.eChartsLoader.resize(this.chart);
    });
  }

  private isDarkThemeActive(): boolean {
    const chartTheme = `${this.chartTheme}`.toLowerCase();
    if (chartTheme === 'dark' || chartTheme === 'amchartsdark') {
      return true;
    }

    if (typeof document === 'undefined') {
      return false;
    }

    return document.body.classList.contains('dark-theme');
  }
}
