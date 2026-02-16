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
  PerformanceCurveCadencePowerSeries,
  PerformanceCurveDataService,
} from '../../../services/performance-curve-data.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

const CADENCE_SYMBOLS = ['circle', 'diamond', 'triangle', 'rect', 'roundRect'];

@Component({
  selector: 'app-event-cadence-power',
  templateUrl: './event.cadence-power.component.html',
  styleUrls: ['./event.cadence-power.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class EventCadencePowerComponent implements AfterViewInit, OnChanges, OnDestroy {
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
      this.logger.error('[EventCadencePowerComponent] Failed to initialize ECharts', error);
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

    const cadencePowerSeries = this.performanceCurveDataService.buildCadencePowerSeries(this.activities, {
      isMerge: this.isMerge,
      maxPointsPerSeries: this.isMobile ? 420 : 1500,
    });

    const option = this.buildChartOption(cadencePowerSeries);
    this.eChartsLoader.setOption(this.chart, option, { notMerge: true, lazyUpdate: true });
    this.scheduleResize();
  }

  private buildChartOption(cadencePowerSeries: PerformanceCurveCadencePowerSeries[]): ChartOption {
    const darkTheme = this.isDarkThemeActive();
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const axisColor = darkTheme ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.24)';
    const axisLabelFontSize = this.isMobile ? 11 : 12;

    if (cadencePowerSeries.length === 0) {
      return {
        animation: this.useAnimations === true,
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const singleActivity = cadencePowerSeries.length <= 1;
    const cadencePoints = cadencePowerSeries.flatMap((seriesEntry) => seriesEntry.points);
    const cadenceValues = cadencePoints.map((point) => point.cadence);
    const powerValues = cadencePoints.map((point) => point.power);
    const [cadenceMin, cadenceMax] = this.calculateAxisRange(cadenceValues, {
      minFloor: 0,
      fallbackMin: 60,
      fallbackMax: 110,
    });
    const [powerMin, powerMax] = this.calculateAxisRange(powerValues, {
      minFloor: 0,
      fallbackMin: 100,
      fallbackMax: 350,
    });

    const series = cadencePowerSeries.map((seriesEntry, cadenceIndex) => {
      const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;
      return {
        type: 'scatter',
        id: `cadence:${seriesEntry.activityId}`,
        name: seriesEntry.label,
        large: seriesEntry.points.length > 400,
        symbol: CADENCE_SYMBOLS[cadenceIndex % CADENCE_SYMBOLS.length],
        data: seriesEntry.points.map((point) => ({
          value: [point.cadence, point.power, point.density],
          duration: point.duration,
          cadence: point.cadence,
          power: point.power,
          density: point.density,
        })),
        symbolSize: (value: unknown) => {
          const density = this.toFiniteNumber(Array.isArray(value) ? value[2] : null) ?? 0.2;
          return this.isMobile
            ? 3 + density * 2.5
            : 4 + density * 3.5;
        },
        itemStyle: {
          color: (params: { value?: unknown[] }) => {
            const density = this.toFiniteNumber(Array.isArray(params?.value) ? params.value[2] : null) ?? 0.2;
            return this.getCadencePointColor(baseColor, density, darkTheme);
          },
          borderColor: darkTheme ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)',
          borderWidth: 0.8,
        },
        emphasis: {
          focus: cadencePowerSeries.length > 1 ? 'series' : 'none',
          scale: true,
        },
        z: 12,
      };
    });

    return {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif",
      },
      legend: {
        show: !singleActivity,
        data: cadencePowerSeries.map((seriesEntry) => seriesEntry.label),
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
        top: singleActivity ? 0 : 18,
        bottom: this.isMobile ? 8 : 4,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        min: cadenceMin,
        max: cadenceMax,
        name: 'Cadence',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 26 : 30,
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
          formatter: (value: number) => `${Math.round(value)}`,
        },
      },
      yAxis: {
        type: 'value',
        min: powerMin,
        max: powerMax,
        name: 'Power',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 34 : 40,
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
        },
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: darkTheme ? '#222222' : '#ffffff',
        borderColor: darkTheme ? '#555555' : '#d6d6d6',
        borderWidth: 1,
        textStyle: {
          color: darkTheme ? '#ffffff' : '#2a2a2a',
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        formatter: (params: unknown) => this.formatTooltip(params, !singleActivity),
      },
      visualMap: {
        show: false,
        seriesIndex: cadencePowerSeries.map((_, index) => index),
        dimension: 2,
        min: 0,
        max: 1,
        inRange: {
          opacity: [0.35, 0.95],
        },
      },
      series,
    };
  }

  private formatTooltip(params: unknown, hasMultipleActivities: boolean): string {
    const entry = params as {
      seriesName?: string;
      data?: {
        cadence?: unknown;
        power?: unknown;
        duration?: unknown;
      };
      value?: unknown;
    };

    const cadence = this.toFiniteNumber(entry?.data?.cadence) ?? this.extractTupleValue(entry?.value, 0);
    const power = this.toFiniteNumber(entry?.data?.power) ?? this.extractTupleValue(entry?.value, 1);
    const duration = this.toFiniteNumber(entry?.data?.duration);

    if (cadence === null || power === null) {
      return '';
    }

    const lines: string[] = [];
    if (hasMultipleActivities) {
      lines.push(`<b>${entry.seriesName}</b>`);
    }

    lines.push(`Cadence: <b>${Math.round(cadence)} rpm</b>`);
    lines.push(`Power: <b>${Math.round(power)} W</b>`);

    if (duration !== null && duration > 0) {
      lines.push(`At: <b>${new DataDuration(duration).getDisplayValue(false, false).trim()}</b>`);
    }

    return lines.join('<br/>');
  }

  private extractTupleValue(value: unknown, index: number): number | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return this.toFiniteNumber(value[index]);
  }

  private getCadencePointColor(baseColor: string, density: number, darkTheme: boolean): string {
    const clampedDensity = Math.max(0, Math.min(1, density));
    const base = this.hexToRgb(baseColor) ?? { r: 22, g: 180, b: 234 };
    const lowMixTarget = darkTheme
      ? { r: 26, g: 29, b: 35 }
      : { r: 255, g: 255, b: 255 };
    const warmAccent = { r: 245, g: 146, b: 35 };

    const softened = this.mixRgb(base, lowMixTarget, 0.58 * (1 - clampedDensity));
    const accented = this.mixRgb(softened, warmAccent, Math.max(0, clampedDensity - 0.7) * 0.42);
    const alpha = 0.42 + (clampedDensity * 0.52);

    return `rgba(${Math.round(accented.r)}, ${Math.round(accented.g)}, ${Math.round(accented.b)}, ${alpha.toFixed(3)})`;
  }

  private hexToRgb(color: string): { r: number; g: number; b: number } | null {
    const normalized = `${color}`.trim();
    const sixDigit = normalized.match(/^#([a-fA-F0-9]{6})$/);
    if (sixDigit) {
      const value = sixDigit[1];
      return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
      };
    }

    const threeDigit = normalized.match(/^#([a-fA-F0-9]{3})$/);
    if (threeDigit) {
      const value = threeDigit[1];
      return {
        r: parseInt(`${value[0]}${value[0]}`, 16),
        g: parseInt(`${value[1]}${value[1]}`, 16),
        b: parseInt(`${value[2]}${value[2]}`, 16),
      };
    }

    return null;
  }

  private mixRgb(
    source: { r: number; g: number; b: number },
    target: { r: number; g: number; b: number },
    ratio: number
  ): { r: number; g: number; b: number } {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const inverse = 1 - clampedRatio;
    return {
      r: (source.r * inverse) + (target.r * clampedRatio),
      g: (source.g * inverse) + (target.g * clampedRatio),
      b: (source.b * inverse) + (target.b * clampedRatio),
    };
  }

  private calculateAxisRange(values: number[], options: {
    minFloor?: number;
    fallbackMin: number;
    fallbackMax: number;
  }): [number, number] {
    const validValues = values.filter((value) => Number.isFinite(value));
    if (!validValues.length) {
      return [options.fallbackMin, options.fallbackMax];
    }

    const minRaw = Math.min(...validValues);
    const maxRaw = Math.max(...validValues);
    const range = Math.max(1, maxRaw - minRaw);
    const padding = Math.max(0.05, range * 0.12);

    let min = minRaw - padding;
    let max = maxRaw + padding;

    if (Number.isFinite(options.minFloor)) {
      min = Math.max(options.minFloor as number, min);
    }

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
