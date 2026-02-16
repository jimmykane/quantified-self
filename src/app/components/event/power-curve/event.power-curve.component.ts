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
  buildBestEffortMarkers,
  buildCadencePowerPaneSeries,
  buildDecouplingPaneSeries,
  buildPowerCurvePaneSeries,
  PerformanceCurveBestEffortMarker,
  PerformanceCurveCadencePowerSeries,
  PerformanceCurveDecouplingSeries,
  PowerCurveChartPoint,
  PowerCurveChartSeries,
} from '../../../helpers/performance-curve-chart-data-helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

const DEFAULT_ROLLING_WINDOW_SECONDS = 180;
const BEST_EFFORT_WINDOWS = [5, 30, 60, 300, 1200, 3600, 7200];
const KEY_POWER_DURATION_MARKERS = [5, 15, 30, 60, 300, 1200, 3600, 7200];
const MOBILE_MAX_LABEL_CONFIG = [
  { width: 360, count: 5 },
  { width: 430, count: 6 },
  { width: 600, count: 8 },
];
const EFFORT_MARKER_COLORS = ['#ff7043', '#ffa726', '#ffd54f', '#66bb6a', '#42a5f5', '#ab47bc'];
const CADENCE_SYMBOLS = ['circle', 'diamond', 'triangle', 'rect', 'roundRect'];

type PaneType = 'power' | 'decoupling' | 'cadence';

interface PaneLayout {
  top: string;
  height: string;
}

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

    const powerSeries = buildPowerCurvePaneSeries(this.activities, { isMerge: this.isMerge });
    const decouplingSeries = buildDecouplingPaneSeries(this.activities, {
      isMerge: this.isMerge,
      rollingWindowSeconds: DEFAULT_ROLLING_WINDOW_SECONDS,
      maxPointsPerSeries: this.isMobile ? 220 : 640,
    });
    const cadencePowerSeries = buildCadencePowerPaneSeries(this.activities, {
      isMerge: this.isMerge,
      maxPointsPerSeries: this.isMobile ? 420 : 1500,
    });
    const bestEffortMarkers = buildBestEffortMarkers(decouplingSeries, {
      windowDurations: BEST_EFFORT_WINDOWS,
      maxMarkersPerWindow: this.isMobile ? 3 : 6,
    });

    const option = this.buildChartOption({
      powerSeries,
      decouplingSeries,
      cadencePowerSeries,
      bestEffortMarkers,
    });

    this.eChartsLoader.setOption(this.chart, option, { notMerge: true, lazyUpdate: true });
    this.scheduleResize();
  }

  private buildChartOption(data: {
    powerSeries: PowerCurveChartSeries[];
    decouplingSeries: PerformanceCurveDecouplingSeries[];
    cadencePowerSeries: PerformanceCurveCadencePowerSeries[];
    bestEffortMarkers: PerformanceCurveBestEffortMarker[];
  }): ChartOption {
    const darkTheme = this.isDarkThemeActive();
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const axisColor = darkTheme ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.24)';
    const axisLabelFontSize = this.isMobile ? 11 : 12;

    const panes: PaneType[] = [];
    if (data.powerSeries.length > 0) {
      panes.push('power');
    }
    if (data.decouplingSeries.length > 0) {
      panes.push('decoupling');
    }
    if (data.cadencePowerSeries.length > 0) {
      panes.push('cadence');
    }

    const activityLabels = new Set<string>([
      ...data.powerSeries.map((series) => series.label),
      ...data.decouplingSeries.map((series) => series.label),
      ...data.cadencePowerSeries.map((series) => series.label),
    ]);
    const markerLabels = new Set<string>(data.bestEffortMarkers.map((marker) => marker.windowLabel));
    const singleActivity = activityLabels.size <= 1;
    const legendData = singleActivity
      ? [...markerLabels.values()]
      : [...new Set([...activityLabels.values(), ...markerLabels.values()]).values()];
    const showLegend = legendData.length > 0;

    if (!panes.length) {
      return {
        animation: this.useAnimations === true,
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        legend: {
          show: false,
        },
        grid: [],
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const paneLayouts = this.buildPaneLayouts(panes.length, showLegend);
    const paneIndexByType = new Map<PaneType, number>();
    panes.forEach((pane, index) => {
      paneIndexByType.set(pane, index);
    });

    const grid: Array<Record<string, unknown>> = paneLayouts.map((layout) => ({
      left: 0,
      right: 0,
      top: layout.top,
      height: layout.height,
      containLabel: true,
    }));
    const paneDescriptions = this.buildPaneDescriptions(panes, paneLayouts, darkTheme);

    const xAxis: Array<Record<string, unknown>> = [];
    const yAxis: Array<Record<string, unknown>> = [];
    const series: Array<Record<string, unknown>> = [];
    const scatterSeriesIndexes: number[] = [];

    if (paneIndexByType.has('power')) {
      const paneIndex = paneIndexByType.get('power') as number;
      const powerPoints = data.powerSeries.flatMap((seriesEntry) => seriesEntry.points);
      const xDurations = [...new Set(powerPoints.map((point) => point.duration))]
        .sort((left, right) => left - right);
      const visibleDurationLabels = this.buildVisibleDurationLabelSet(xDurations);
      const powerValues = powerPoints.map((point) => point.power);
      const [powerMin, powerMax] = this.calculateAxisRange(powerValues, { minFloor: 0, fallbackMin: 0, fallbackMax: 120 });

      xAxis[paneIndex] = {
        type: 'category',
        gridIndex: paneIndex,
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
            const duration = this.toFiniteNumber(value) ?? 0;
            if (this.isMobile && !visibleDurationLabels.has(duration)) {
              return '';
            }
            return this.formatDurationLabel(duration);
          },
        },
      };

      yAxis[paneIndex] = {
        type: 'value',
        gridIndex: paneIndex,
        min: powerMin,
        max: powerMax,
        name: panes.length === 1 ? 'Power (W)' : 'Power',
        nameLocation: 'middle',
        nameGap: this.isMobile ? 36 : 44,
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
          fontSize: axisLabelFontSize,
          color: textColor,
        },
      };

      data.powerSeries.forEach((seriesEntry) => {
        const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;
        const pointsByDuration = new Map(seriesEntry.points.map((point) => [point.duration, point]));
        const markerData = singleActivity ? this.buildPowerDurationMarkPoints(seriesEntry.points) : [];

        const lineData = xDurations.map((duration) => {
          const point = pointsByDuration.get(duration);
          if (!point) {
            return null;
          }

          return {
            value: point.power,
            duration: point.duration,
            wattsPerKg: point.wattsPerKg,
            activityLabel: seriesEntry.label,
            paneType: 'power',
          };
        });

        const lineSeries: Record<string, unknown> = {
          type: 'line',
          id: `power:${seriesEntry.activityId}`,
          name: seriesEntry.label,
          xAxisIndex: paneIndex,
          yAxisIndex: paneIndex,
          data: lineData,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: this.isMobile ? 4.5 : 5.5,
          smooth: activityLabels.size > 1 ? 0.16 : 0.24,
          clip: false,
          lineStyle: {
            width: activityLabels.size > 1 ? 2.2 : 2.8,
            color: baseColor,
          },
          itemStyle: {
            color: baseColor,
          },
          emphasis: {
            focus: activityLabels.size > 1 ? 'series' : 'none',
            scale: true,
          },
          z: 20,
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

        series.push(lineSeries);
      });
    }

    if (paneIndexByType.has('decoupling')) {
      const paneIndex = paneIndexByType.get('decoupling') as number;
      const decouplingPoints = data.decouplingSeries.flatMap((seriesEntry) => seriesEntry.points);
      const durations = decouplingPoints.map((point) => point.duration);
      const efficiencyValues = decouplingPoints.map((point) => point.efficiency);
      const maxDuration = durations.length > 0 ? Math.max(...durations) : 1;
      const [efficiencyMin, efficiencyMax] = this.calculateAxisRange(efficiencyValues, { fallbackMin: 1, fallbackMax: 2.5 });

      xAxis[paneIndex] = {
        type: 'value',
        gridIndex: paneIndex,
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
      };

      yAxis[paneIndex] = {
        type: 'value',
        gridIndex: paneIndex,
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
      };

      data.decouplingSeries.forEach((seriesEntry) => {
        const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;

        series.push({
          type: 'line',
          id: `decoupling:${seriesEntry.activityId}`,
          name: seriesEntry.label,
          xAxisIndex: paneIndex,
          yAxisIndex: paneIndex,
          data: seriesEntry.points.map((point) => ({
            value: [point.duration, point.efficiency],
            duration: point.duration,
            efficiency: point.efficiency,
            power: point.power,
            heartRate: point.heartRate,
            activityLabel: seriesEntry.label,
            paneType: 'decoupling',
          })),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: {
            width: 2,
            color: baseColor,
          },
          itemStyle: {
            color: baseColor,
          },
          emphasis: {
            focus: activityLabels.size > 1 ? 'series' : 'none',
            scale: true,
          },
          z: 15,
        });
      });

      const markersByWindow = data.bestEffortMarkers.reduce((map, marker) => {
        const collection = map.get(marker.windowLabel) ?? [];
        collection.push(marker);
        map.set(marker.windowLabel, collection);
        return map;
      }, new Map<string, PerformanceCurveBestEffortMarker[]>());

      [...markersByWindow.entries()].forEach(([windowLabel, markerEntries], index) => {
        series.push({
          type: 'scatter',
          id: `effort:${windowLabel}`,
          name: windowLabel,
          xAxisIndex: paneIndex,
          yAxisIndex: paneIndex,
          symbol: 'diamond',
          symbolSize: this.isMobile ? 6 : 8,
          itemStyle: {
            color: EFFORT_MARKER_COLORS[index % EFFORT_MARKER_COLORS.length],
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
            paneType: 'effort',
          })),
          z: 40,
        });
      });
    }

    if (paneIndexByType.has('cadence')) {
      const paneIndex = paneIndexByType.get('cadence') as number;
      const cadencePoints = data.cadencePowerSeries.flatMap((seriesEntry) => seriesEntry.points);
      const cadenceValues = cadencePoints.map((point) => point.cadence);
      const powerValues = cadencePoints.map((point) => point.power);
      const [cadenceMin, cadenceMax] = this.calculateAxisRange(cadenceValues, { minFloor: 0, fallbackMin: 60, fallbackMax: 110 });
      const [powerMin, powerMax] = this.calculateAxisRange(powerValues, { minFloor: 0, fallbackMin: 100, fallbackMax: 350 });

      xAxis[paneIndex] = {
        type: 'value',
        gridIndex: paneIndex,
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
        },
      };

      yAxis[paneIndex] = {
        type: 'value',
        gridIndex: paneIndex,
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
      };

      data.cadencePowerSeries.forEach((seriesEntry, cadenceIndex) => {
        const baseColor = this.eventColorService.getActivityColor(this.activities, seriesEntry.activity) || AppColors.Blue;
        scatterSeriesIndexes.push(series.length);

        series.push({
          type: 'scatter',
          id: `cadence:${seriesEntry.activityId}`,
          name: seriesEntry.label,
          xAxisIndex: paneIndex,
          yAxisIndex: paneIndex,
          large: seriesEntry.points.length > 400,
          symbol: CADENCE_SYMBOLS[cadenceIndex % CADENCE_SYMBOLS.length],
          data: seriesEntry.points.map((point) => ({
            value: [point.cadence, point.power, point.density],
            duration: point.duration,
            cadence: point.cadence,
            power: point.power,
            density: point.density,
            activityLabel: seriesEntry.label,
            paneType: 'cadence',
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
            focus: activityLabels.size > 1 ? 'series' : 'none',
            scale: true,
          },
          z: 12,
        });
      });
    }

    const option: ChartOption = {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif",
      },
      legend: {
        show: showLegend,
        data: legendData,
        type: legendData.length > 5 ? 'scroll' : 'plain',
        top: 4,
        left: 'center',
        right: 'center',
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: this.isMobile ? 12 : 13,
        },
      },
      grid,
      xAxis,
      yAxis,
      tooltip: {
        trigger: 'item',
        backgroundColor: darkTheme ? '#222222' : '#ffffff',
        borderColor: darkTheme ? '#555555' : '#d6d6d6',
        borderWidth: 1,
        textStyle: {
          color: darkTheme ? '#ffffff' : '#2a2a2a',
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        formatter: (params: unknown) => this.formatTooltip(params, activityLabels.size > 1),
      },
      graphic: paneDescriptions,
      series,
    };

    if (scatterSeriesIndexes.length > 0) {
      option.visualMap = {
        show: false,
        seriesIndex: scatterSeriesIndexes,
        dimension: 2,
        min: 0,
        max: 1,
        inRange: {
          opacity: [0.35, 0.95],
        },
      };
    }

    return option;
  }

  private buildPaneLayouts(paneCount: number, showLegend: boolean): PaneLayout[] {
    if (paneCount <= 0) {
      return [];
    }

    const headerSpace = showLegend ? 12 : 2;
    const gapSpace = paneCount > 1 ? 4 : 0;
    const totalGapSpace = gapSpace * (paneCount - 1);
    const paneHeight = (100 - headerSpace - totalGapSpace) / paneCount;

    const layouts: PaneLayout[] = [];
    for (let index = 0; index < paneCount; index += 1) {
      const top = headerSpace + (index * (paneHeight + gapSpace));
      layouts.push({
        top: `${top}%`,
        height: `${paneHeight}%`,
      });
    }

    return layouts;
  }

  private buildPaneDescriptions(panes: PaneType[], paneLayouts: PaneLayout[], darkTheme: boolean): Array<Record<string, unknown>> {
    return panes.map((pane, index) => {
      const layout = paneLayouts[index];
      const top = Number.parseFloat(layout.top);
      const paneTitle = this.getPaneTitle(pane);
      const paneDescription = this.getPaneDescription(pane);

      return {
        type: 'group',
        right: this.isMobile ? 4 : 8,
        top: `${top + 0.6}%`,
        z: 100,
        children: [
          {
            type: 'text',
            style: {
              text: paneTitle,
              fill: darkTheme ? '#ffffff' : '#1f1f1f',
              font: `600 ${this.isMobile ? 11 : 12}px 'Barlow Condensed', sans-serif`,
              textAlign: 'right',
            },
          },
          {
            type: 'text',
            top: this.isMobile ? 12 : 13,
            style: {
              text: paneDescription,
              fill: darkTheme ? 'rgba(245,245,245,0.85)' : 'rgba(40,40,40,0.80)',
              font: `${this.isMobile ? 9 : 10}px 'Barlow Condensed', sans-serif`,
              textAlign: 'right',
            },
          },
        ],
      };
    });
  }

  private getPaneTitle(pane: PaneType): string {
    if (pane === 'power') {
      return 'Power Curve';
    }
    if (pane === 'decoupling') {
      return 'Durability';
    }
    return 'Cadence vs Power';
  }

  private getPaneDescription(pane: PaneType): string {
    if (pane === 'power') {
      return 'Best power you can hold for each duration.';
    }
    if (pane === 'decoupling') {
      return 'W/bpm over time. Downward drift suggests fatigue.';
    }
    return 'Point density shows where you spent most time.';
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
              : this.formatDurationLabel(nearest.duration);
            selected.set(nearest.duration, existing);
          }
        }
        return;
      }

      const labelDuration = targetDuration === chartMax ? nearest.duration : targetDuration;
      selected.set(nearest.duration, {
        coord: [nearest.duration, nearest.power],
        label: this.formatDurationLabel(labelDuration),
      });
    });

    if (chartMax >= 7200) {
      const hasTwoHourLabel = [...selected.values()].some((entry) => entry.label.includes('02h'));
      if (!hasTwoHourLabel) {
        const nearestTwoHourPoint = this.getNearestPowerPoint(points, 7200);
        if (nearestTwoHourPoint) {
          selected.set(nearestTwoHourPoint.duration, {
            coord: [nearestTwoHourPoint.duration, nearestTwoHourPoint.power],
            label: this.formatDurationLabel(7200),
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

  private formatTooltip(params: unknown, hasMultipleActivities: boolean): string {
    const entry = params as {
      seriesId?: string;
      seriesName?: string;
      data?: any;
      value?: unknown;
      marker?: string;
    };

    if (!entry || !entry.seriesId) {
      return '';
    }

    const paneType = `${entry.seriesId}`.split(':')[0];
    const data = entry.data ?? {};

    if (paneType === 'power') {
      const duration = this.toFiniteNumber(data.duration) ?? this.toFiniteNumber(entry.value) ?? 0;
      const power = this.toFiniteNumber(data.value) ?? this.toFiniteNumber(entry.value);
      if (power === null) {
        return '';
      }

      const wattsPerKg = this.toFiniteNumber(data.wattsPerKg);
      const activityPrefix = hasMultipleActivities ? `${entry.seriesName}: ` : '';
      const wattsPerKgLabel = wattsPerKg && wattsPerKg > 0
        ? ` (${wattsPerKg.toFixed(2)} W/kg)`
        : '';

      return `<b>${this.formatDurationLabel(duration)}</b><br/>${activityPrefix}Power: <b>${Math.round(power)} W</b>${wattsPerKgLabel}`;
    }

    if (paneType === 'decoupling') {
      const duration = this.toFiniteNumber(data.duration) ?? this.extractTupleValue(entry.value, 0) ?? 0;
      const efficiency = this.toFiniteNumber(data.efficiency) ?? this.extractTupleValue(entry.value, 1);
      const power = this.toFiniteNumber(data.power);
      const heartRate = this.toFiniteNumber(data.heartRate);

      if (efficiency === null) {
        return '';
      }

      const lines = [
        `<b>${this.formatDurationLabel(duration)}</b>`,
      ];

      if (hasMultipleActivities) {
        lines.push(`${entry.seriesName}`);
      }

      lines.push(`Efficiency: <b>${efficiency.toFixed(2)} W/bpm</b>`);

      if (power !== null && heartRate !== null) {
        lines.push(`Rolling: <b>${Math.round(power)} W</b> / <b>${Math.round(heartRate)} bpm</b>`);
      }

      return lines.join('<br/>');
    }

    if (paneType === 'cadence') {
      const cadence = this.toFiniteNumber(data.cadence) ?? this.extractTupleValue(entry.value, 0);
      const power = this.toFiniteNumber(data.power) ?? this.extractTupleValue(entry.value, 1);
      const duration = this.toFiniteNumber(data.duration);

      if (cadence === null || power === null) {
        return '';
      }

      const lines = [];
      if (hasMultipleActivities) {
        lines.push(`<b>${entry.seriesName}</b>`);
      }
      lines.push(`Cadence: <b>${Math.round(cadence)} rpm</b>`);
      lines.push(`Power: <b>${Math.round(power)} W</b>`);
      if (duration !== null && duration > 0) {
        lines.push(`At: <b>${this.formatDurationLabel(duration)}</b>`);
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

      const lines = [
        `<b>${windowLabel} Best Effort</b>`,
      ];

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

    [1, 5, 15, 30, 60, 300, 1200, 3600, 7200].forEach((anchorDuration) => {
      const directIndex = durations.indexOf(anchorDuration);
      if (directIndex >= 0) {
        mandatoryIndexes.add(directIndex);
        return;
      }

      const nearestIndex = this.findNearestDurationIndex(durations, anchorDuration);
      if (nearestIndex !== null) {
        mandatoryIndexes.add(nearestIndex);
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

  private findNearestDurationIndex(durations: number[], target: number): number | null {
    if (!durations.length) {
      return null;
    }

    let nearestIndex = 0;
    let nearestLogDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < durations.length; index += 1) {
      const candidate = durations[index];
      const logDistance = Math.abs(Math.log10(Math.max(1, candidate)) - Math.log10(Math.max(1, target)));
      if (logDistance < nearestLogDistance) {
        nearestLogDistance = logDistance;
        nearestIndex = index;
      }
    }

    const nearestDuration = durations[nearestIndex];
    const ratio = Math.abs(nearestDuration - target) / Math.max(target, 1);
    if (ratio > 0.45) {
      return null;
    }

    return nearestIndex;
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
