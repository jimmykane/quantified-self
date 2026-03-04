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
  DataCadence,
  DataDuration,
  DataPower,
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
import {
  ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../helpers/echarts-host-controller';
import { getOrCreateEChartsTooltipHost } from '../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';
import {
  buildEventEChartsVisualTokens,
  calculateEventEChartsAxisRange,
  toFiniteEventEChartsNumber
} from '../../../helpers/event-echarts-common.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';

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
      logPrefix: '[EventCadencePowerComponent]',
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

    const cadencePowerSeries = this.performanceCurveDataService.buildCadencePowerSeries(this.activities, {
      isMerge: this.isMerge,
      maxPointsPerSeries: this.isMobile ? 420 : 1500,
    });

    const option = this.buildChartOption(cadencePowerSeries);
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(cadencePowerSeries: PerformanceCurveCadencePowerSeries[]): ChartOption {
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const darkTheme = chartStyle.darkTheme;
    const textColor = chartStyle.textColor;
    const axisColor = chartStyle.axisColor;
    const axisLabelFontSize = chartStyle.axisLabelFontSize;
    const tooltipExtraCssText = chartStyle.tooltipExtraCssText;

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
    const cadenceAxisConfig = this.buildCadenceAxisConfig(cadenceValues);
    const [powerMin, powerMax] = calculateEventEChartsAxisRange(powerValues, {
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
          symbolSize: this.resolveCadencePointSymbolSize(point.density),
          itemStyle: {
            color: this.getCadencePointColor(baseColor, point.density, darkTheme),
          },
        })),
        itemStyle: {
          borderColor: chartStyle.subtleBorderColor,
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
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      legend: {
        show: !singleActivity,
        data: cadencePowerSeries.map((seriesEntry) => seriesEntry.label),
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
        right: this.isMobile ? 6 : 4,
        top: singleActivity ? 0 : 18,
        bottom: this.isMobile ? 8 : 4,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        min: cadenceAxisConfig.min,
        max: cadenceAxisConfig.max,
        interval: cadenceAxisConfig.interval,
        name: 'Cadence',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 26 : 30,
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
          color: textColor,
          fontSize: axisLabelFontSize,
          hideOverlap: true,
          formatter: (value: number) => this.formatCadenceLabel(value),
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
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        },
        axisLine: {
          lineStyle: { color: axisColor },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: textColor,
          fontSize: axisLabelFontSize,
          formatter: (value: number) => this.formatPowerLabel(value),
        },
      },
      tooltip: {
        trigger: 'item',
        triggerOn: this.isMobile ? 'click' : 'mousemove|click',
        renderMode: 'html',
        appendTo: getOrCreateEChartsTooltipHost,
        confine: this.isMobile,
        position: getViewportConstrainedTooltipPosition,
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

    const cadence = toFiniteEventEChartsNumber(entry?.data?.cadence) ?? this.extractTupleValue(entry?.value, 0);
    const power = toFiniteEventEChartsNumber(entry?.data?.power) ?? this.extractTupleValue(entry?.value, 1);
    const duration = toFiniteEventEChartsNumber(entry?.data?.duration);

    if (cadence === null || power === null) {
      return '';
    }

    const lines: string[] = [];
    if (hasMultipleActivities) {
      lines.push(`<b>${entry.seriesName}</b>`);
    }

    lines.push(`Cadence: <b>${this.formatCadenceLabel(cadence, true)}</b>`);
    lines.push(`Power: <b>${this.formatPowerLabel(power, true)}</b>`);

    if (duration !== null && duration > 0) {
      lines.push(`At: <b>${new DataDuration(duration).getDisplayValue(false, false).trim()}</b>`);
    }

    return lines.join('<br/>');
  }

  private extractTupleValue(value: unknown, index: number): number | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return toFiniteEventEChartsNumber(value[index]);
  }

  private resolveCadencePointSymbolSize(density: number): number {
    const resolvedDensity = Number.isFinite(density) ? density : 0.2;
    return this.isMobile
      ? 3 + resolvedDensity * 2.5
      : 4 + resolvedDensity * 3.5;
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

  private buildCadenceAxisConfig(values: number[]): { min: number; max: number; interval: number } {
    const validValues = values.filter((value) => Number.isFinite(value));
    if (!validValues.length) {
      return { min: 60, max: 110, interval: 10 };
    }

    const minRaw = Math.min(...validValues);
    const maxRaw = Math.max(...validValues);
    const snappedMin = Math.max(0, Math.floor(minRaw / 5) * 5);
    let snappedMax = Math.ceil(maxRaw / 5) * 5;

    if (snappedMax <= snappedMin) {
      snappedMax = snappedMin + 10;
    }

    const range = snappedMax - snappedMin;
    const targetTicks = this.isMobile ? 6 : 10;
    const baseInterval = Math.max(5, Math.ceil((range / targetTicks) / 5) * 5);
    const interval = this.selectCadenceInterval(range, Math.min(20, baseInterval), targetTicks);

    return {
      min: snappedMin,
      max: snappedMax,
      interval,
    };
  }

  private selectCadenceInterval(range: number, fallbackInterval: number, targetTicks: number): number {
    const candidates = [5, 10, 15, 20];
    const divisibleCandidates = candidates.filter((candidate) => candidate > 0 && range % candidate === 0);
    if (!divisibleCandidates.length) {
      return fallbackInterval;
    }

    let best = divisibleCandidates[0];
    let bestDistance = Math.abs((range / best) - targetTicks);

    for (let index = 1; index < divisibleCandidates.length; index += 1) {
      const candidate = divisibleCandidates[index];
      const distance = Math.abs((range / candidate) - targetTicks);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return best;
  }

  private formatCadenceLabel(cadence: number, includeUnit = false): string {
    if (!Number.isFinite(cadence)) {
      return '';
    }

    const dataCadence = new DataCadence(cadence);
    const value = `${dataCadence.getDisplayValue()}`.trim();
    if (!includeUnit) {
      return value;
    }

    const unit = `${dataCadence.getDisplayUnit()}`.trim();
    return unit.length > 0
      ? `${value} ${unit}`
      : value;
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

}
