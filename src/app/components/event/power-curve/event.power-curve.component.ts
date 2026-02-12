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

import { ActivityInterface, ChartThemes, DataDuration } from '@sports-alliance/sports-lib';
import { AppBreakpoints } from '../../../constants/breakpoints';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  buildPowerCurveSeries,
  PowerCurveChartPoint,
  PowerCurveChartSeries,
} from '../../../helpers/power-curve-chart-data-helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

const KEY_DURATION_SECONDS = [5, 15, 30, 60, 300, 1200, 3600];
const MOBILE_MAX_LABEL_CONFIG = [
  { width: 360, count: 5 },
  { width: 430, count: 6 },
  { width: 600, count: 8 },
];

@Component({
  selector: 'app-event-power-curve',
  templateUrl: './event.power-curve.component.html',
  styleUrls: ['./event.power-curve.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventPowerCurveComponent implements AfterViewInit, OnChanges, OnDestroy {
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
      this.logger.error('[EventPowerCurveComponent] Failed to initialize ECharts', error);
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

    const seriesData = buildPowerCurveSeries(this.activities, { isMerge: this.isMerge });
    const option = this.buildChartOption(seriesData);
    this.eChartsLoader.setOption(this.chart, option, { notMerge: true, lazyUpdate: true });
    this.scheduleResize();
  }

  private buildChartOption(seriesData: PowerCurveChartSeries[]): ChartOption {
    const darkTheme = this.isDarkThemeActive();
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const axisColor = darkTheme ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
    const splitLineColor = darkTheme ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.1)';
    const axisLabelFontSize = this.isMobile ? 11 : 12;

    const points = seriesData.flatMap((entry) => entry.points);
    const durations = points.map((point) => point.duration);
    const powers = points.map((point) => point.power);

    const hasData = points.length > 0;
    const hasMultipleSeries = seriesData.length > 1;
    const xDurations = hasData
      ? [...new Set(durations)].sort((left, right) => left - right)
      : [];
    const visibleDurationLabels = this.buildVisibleDurationLabelSet(xDurations);

    const minPowerRaw = hasData ? Math.min(...powers) : 0;
    const maxPowerRaw = hasData ? Math.max(...powers) : 100;
    const powerRange = Math.max(1, maxPowerRaw - minPowerRaw);
    const yPadding = Math.max(8, powerRange * 0.1);

    const yMin = Math.max(0, Math.floor((minPowerRaw - yPadding) / 5) * 5);
    let yMax = Math.ceil((maxPowerRaw + yPadding) / 5) * 5;
    if (yMax <= yMin) {
      yMax = yMin + 10;
    }

    const series = seriesData.map((seriesEntry, index) => {
      const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;
      const pointsByDuration = new Map<number, PowerCurveChartPoint>(
        seriesEntry.points.map((point) => [point.duration, point])
      );
      const chartData = xDurations.map((duration) => {
        const point = pointsByDuration.get(duration);
        if (!point) {
          return null;
        }

        return {
          value: point.power,
          duration: point.duration,
          wattsPerKg: point.wattsPerKg,
        };
      });

      const markPoints = !hasMultipleSeries
        ? this.buildKeyDurationMarkPoints(seriesEntry.points)
        : [];

      const item: Record<string, unknown> = {
        type: 'line',
        name: seriesEntry.label,
        data: chartData,
        showSymbol: !hasMultipleSeries,
        symbol: 'circle',
        symbolSize: this.isMobile ? 4 : 5,
        smooth: hasMultipleSeries ? 0.18 : 0.28,
        clip: false,
        lineStyle: {
          width: hasMultipleSeries ? 2.5 : 3,
          color: baseColor,
        },
        itemStyle: {
          color: baseColor,
        },
        emphasis: {
          focus: hasMultipleSeries ? 'series' : 'none',
        },
        z: 10 + index,
      };

      if (!hasMultipleSeries) {
        item['areaStyle'] = {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: this.toTransparentColor(baseColor, darkTheme ? 0.42 : 0.35) },
              { offset: 1, color: this.toTransparentColor(baseColor, 0.03) },
            ],
          },
        };
      }

      if (markPoints.length > 0) {
        item['markPoint'] = {
          symbol: 'circle',
          symbolSize: 10,
          itemStyle: {
            color: '#ffffff',
            borderColor: baseColor,
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: (params: { data?: { label?: string } }) => params.data?.label ?? '',
            color: textColor,
            fontSize: this.isMobile ? 10 : 11,
            fontWeight: 600,
            offset: [0, -14],
          },
          data: markPoints,
        };
      }

      return item;
    });

    return {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif",
      },
      grid: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        containLabel: true,
      },
      legend: {
        show: hasMultipleSeries,
        type: seriesData.length > 3 ? 'scroll' : 'plain',
        top: 6,
        left: 'center',
        right: 'center',
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: this.isMobile ? 12 : 13,
        },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: darkTheme ? '#222222' : '#ffffff',
        borderColor: darkTheme ? '#555555' : '#d6d6d6',
        borderWidth: 1,
        textStyle: {
          color: darkTheme ? '#ffffff' : '#2a2a2a',
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        axisPointer: {
          type: 'line',
          snap: true,
          lineStyle: {
            color: darkTheme ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)',
            type: 'dashed',
          },
        },
        formatter: (params: unknown) => this.formatTooltip(params, hasMultipleSeries),
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: xDurations,
        axisLabel: {
          interval: 0,
          hideOverlap: true,
          rotate: this.isMobile ? 70 : 50,
          fontSize: axisLabelFontSize,
          color: textColor,
          formatter: (value: string | number) => {
            const duration = this.toFiniteNumber(value) ?? 0;
            if (this.isMobile && !visibleDurationLabels.has(duration)) {
              return '';
            }
            return this.formatDurationLabel(duration);
          },
        },
        axisLine: {
          lineStyle: {
            color: axisColor,
          },
        },
        splitLine: {
          show: false,
          lineStyle: {
            color: splitLineColor,
            type: 'dashed',
          },
        },
      },
      yAxis: {
        type: 'value',
        min: yMin,
        max: yMax,
        name: 'Power (W)',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 44 : 50,
        nameTextStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        axisLabel: {
          fontSize: axisLabelFontSize,
          color: textColor,
        },
        axisLine: {
          lineStyle: {
            color: axisColor,
          },
        },
        splitLine: {
          show: false,
          lineStyle: {
            color: splitLineColor,
            type: 'dashed',
          },
        },
      },
      series,
    };
  }

  private buildKeyDurationMarkPoints(points: PowerCurveChartPoint[]): Array<{
    coord: [number, number];
    label: string;
  }> {
    if (!points.length) {
      return [];
    }

    const chartMin = points[0].duration;
    const chartMax = points[points.length - 1].duration;
    const markedDurations = new Set<number>();

    return KEY_DURATION_SECONDS
      .filter((targetDuration) => targetDuration >= chartMin && targetDuration <= chartMax)
      .map((targetDuration) => {
        const nearest = this.getNearestPoint(points, targetDuration);
        if (!nearest) {
          return null;
        }

        const ratioDiff = Math.abs(nearest.duration - targetDuration) / targetDuration;
        if (ratioDiff > 0.35 || markedDurations.has(nearest.duration)) {
          return null;
        }

        markedDurations.add(nearest.duration);

        return {
          coord: [nearest.duration, nearest.power] as [number, number],
          label: this.formatDurationLabel(targetDuration),
        };
      })
      .filter((point): point is { coord: [number, number]; label: string } => !!point);
  }

  private getNearestPoint(points: PowerCurveChartPoint[], targetDuration: number): PowerCurveChartPoint | null {
    if (!points.length) {
      return null;
    }

    return points.reduce((closest, candidate) => {
      const currentDistance = Math.abs(candidate.duration - targetDuration);
      const closestDistance = Math.abs(closest.duration - targetDuration);
      return currentDistance < closestDistance ? candidate : closest;
    }, points[0]);
  }

  private formatTooltip(params: unknown, hasMultipleSeries: boolean): string {
    const entries = Array.isArray(params) ? params : [params];
    if (!entries.length) {
      return '';
    }

    const duration = this.extractDurationFromTooltipEntry(entries[0]);
    const durationLabel = this.formatDurationLabel(duration);

    const lines = entries.map((entry: any) => {
      const powerValue = this.toFiniteNumber(
        entry?.value?.[1]
        ?? entry?.data?.value?.[1]
        ?? entry?.data?.[1]
        ?? entry?.value
        ?? entry?.data?.value
      );

      if (powerValue === null) {
        return '';
      }

      const wattsPerKg = this.toFiniteNumber(entry?.data?.wattsPerKg);
      const wattsPerKgLabel = wattsPerKg && wattsPerKg > 0
        ? ` (${wattsPerKg.toFixed(2)} W/kg)`
        : '';

      if (!hasMultipleSeries) {
        return `Power: <b>${Math.round(powerValue)} W</b>${wattsPerKgLabel}`;
      }

      return `${entry.marker}${entry.seriesName}: <b>${Math.round(powerValue)} W</b>${wattsPerKgLabel}`;
    }).filter((line: string) => line.length > 0);

    return [`<b>${durationLabel}</b>`, ...lines].join('<br/>');
  }

  private extractDurationFromTooltipEntry(entry: any): number {
    const duration = this.toFiniteNumber(
      entry?.axisValue
      ?? entry?.value?.[0]
      ?? entry?.data?.value?.[0]
      ?? entry?.data?.[0]
      ?? entry?.data?.duration
    );

    return duration ?? 0;
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

  private buildVisibleDurationLabelSet(durations: number[]): Set<number> {
    if (!this.isMobile || durations.length === 0) {
      return new Set(durations);
    }

    const mandatoryIndexes = new Set<number>([0, durations.length - 1]);
    const availableDurations = new Set(durations);

    [1, ...KEY_DURATION_SECONDS].forEach((anchorDuration) => {
      if (availableDurations.has(anchorDuration)) {
        mandatoryIndexes.add(durations.indexOf(anchorDuration));
      }
    });

    const maxLabels = Math.max(this.getMobileMaxLabelCount(), mandatoryIndexes.size);
    if (durations.length <= maxLabels) {
      return new Set(durations);
    }

    const selectedIndexes = new Set<number>(mandatoryIndexes);

    while (selectedIndexes.size < maxLabels) {
      const nextIndex = this.findLargestGapMidpointIndex(durations, selectedIndexes);
      if (nextIndex === null) {
        break;
      }
      selectedIndexes.add(nextIndex);
    }

    return new Set(
      [...selectedIndexes]
        .sort((left, right) => left - right)
        .map((index) => durations[index])
    );
  }

  private getMobileMaxLabelCount(): number {
    const rawWidth = this.chartDiv?.nativeElement?.clientWidth ?? 0;
    const effectiveWidth = rawWidth > 0
      ? rawWidth
      : (this.isMobile ? 360 : 960);

    const config = MOBILE_MAX_LABEL_CONFIG.find((entry) => effectiveWidth <= entry.width);
    return config?.count ?? 8;
  }

  private findLargestGapMidpointIndex(durations: number[], selectedIndexes: Set<number>): number | null {
    const sorted = [...selectedIndexes].sort((left, right) => left - right);
    if (sorted.length < 2) {
      return null;
    }

    let bestStart = -1;
    let bestEnd = -1;
    let bestGap = -1;

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (end - start <= 1) {
        continue;
      }

      const gap = Math.log10(Math.max(1, durations[end])) - Math.log10(Math.max(1, durations[start]));
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = start;
        bestEnd = end;
      }
    }

    if (bestStart === -1 || bestEnd === -1) {
      return null;
    }

    const targetLog = (
      Math.log10(Math.max(1, durations[bestStart]))
      + Math.log10(Math.max(1, durations[bestEnd]))
    ) / 2;

    let midpointIndex = bestStart + 1;
    let midpointDistance = Number.POSITIVE_INFINITY;
    for (let index = bestStart + 1; index < bestEnd; index += 1) {
      const distance = Math.abs(Math.log10(Math.max(1, durations[index])) - targetLog);
      if (distance < midpointDistance) {
        midpointDistance = distance;
        midpointIndex = index;
      }
    }

    return midpointIndex;
  }

  private toTransparentColor(hex: string, alpha: number): string {
    const normalized = `${hex}`.trim();
    const clampedAlpha = Math.max(0, Math.min(1, alpha));

    const sixDigit = normalized.match(/^#([a-fA-F0-9]{6})$/);
    if (sixDigit) {
      const value = sixDigit[1];
      const red = parseInt(value.substring(0, 2), 16);
      const green = parseInt(value.substring(2, 4), 16);
      const blue = parseInt(value.substring(4, 6), 16);
      return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
    }

    const threeDigit = normalized.match(/^#([a-fA-F0-9]{3})$/);
    if (threeDigit) {
      const value = threeDigit[1];
      const red = parseInt(`${value[0]}${value[0]}`, 16);
      const green = parseInt(`${value[1]}${value[1]}`, 16);
      const blue = parseInt(`${value[2]}${value[2]}`, 16);
      return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
    }

    return normalized;
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
