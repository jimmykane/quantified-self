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
  DataHeartRate,
} from '@sports-alliance/sports-lib';
import { AppBreakpoints } from '../../../constants/breakpoints';
import { AppDataColors } from '../../../services/color/app.data.colors';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  convertIntensityZonesStatsToEchartsData,
  IntensityZonesEChartsData,
} from '../../../helpers/intensity-zones-chart-data-helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-event-intensity-zones',
  templateUrl: './event.intensity-zones.component.html',
  styleUrls: ['./event.intensity-zones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventIntensityZonesComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() activities: ActivityInterface[] = [];
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() useAnimations = false;

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
      .subscribe(result => {
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
    if (changes.activities || changes.chartTheme || changes.useAnimations) {
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
      this.logger.error('[EventIntensityZonesComponent] Failed to initialize ECharts', error);
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

    const data = convertIntensityZonesStatsToEchartsData(this.activities, this.isMobile);
    const option = this.buildChartOption(data);
    this.eChartsLoader.setOption(this.chart, option, { notMerge: true, lazyUpdate: true });
    this.scheduleResize();
  }

  private buildChartOption(data: IntensityZonesEChartsData): ChartOption {
    const darkTheme = this.isDarkThemeActive();
    const textColor = darkTheme ? '#ffffff' : '#2a2a2a';
    const gridLineColor = darkTheme ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    const zoneBackgroundOpacity = darkTheme ? 0.18 : 0.12;
    const rightInset = this.isMobile ? 16 : 0;
    const zoneAxisRichStyles = this.createZoneAxisRichStyles(data.zones);
    const zoneBulletRichStyles = this.createZoneBulletRichStyles(data.zones);
    const zoneBackgroundColors = data.zones.map(zone =>
      this.toTransparentColor(this.eventColorService.getColorForZoneHex(zone), zoneBackgroundOpacity)
    );
    const series = data.series.map((seriesEntry, seriesIndex) => {
      const displayName = this.getLegendLabel(seriesEntry.type);
      return {
        type: 'bar',
        name: displayName,
        data: seriesEntry.values,
        barMaxWidth: 18,
        clip: false,
        itemStyle: {
          color: this.getSeriesColor(seriesEntry.type),
          borderRadius: [0, 8, 8, 0]
        },
        label: {
          show: true,
          position: 'right',
          distance: 4,
          align: 'left',
          color: textColor,
          padding: [0, 2, 0, 2],
          formatter: (params: { dataIndex: number }) => {
            const dataIndex = params.dataIndex;
            const value = seriesEntry.values[dataIndex] ?? 0;
            if (value <= 0.1) {
              return '';
            }
            const percent = this.formatPercentage(seriesEntry.percentages[dataIndex] ?? 0);
            return `{zone_${dataIndex}|${percent}%}`;
          },
          rich: zoneBulletRichStyles
        },
        emphasis: {
          focus: 'none'
        },
        tooltip: {
          valueFormatter: (value: number) => new DataDuration(value).getDisplayValue()
        },
        z: seriesIndex + 1
      };
    });

    const option: ChartOption = {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif"
      },
      grid: {
        left: 0,
        right: rightInset,
        top: 0,
        bottom: 0,
        containLabel: true
      },
      legend: {
        show: false,
        selectedMode: true,
        left: 'center',
        bottom: 0,
        orient: 'horizontal',
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
        }
      },
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        confine: false,
        backgroundColor: darkTheme ? '#303030' : '#ffffff',
        borderColor: darkTheme ? '#6b6b6b' : '#d6d6d6',
        textStyle: {
          color: darkTheme ? '#ffffff' : '#2a2a2a',
          fontFamily: "'Barlow Condensed', sans-serif",
        },
        formatter: (params: { dataIndex: number; seriesIndex: number; marker: string }) => {
          const dataIndex = params.dataIndex;
          const seriesIndex = params.seriesIndex;
          const zone = data.zones[dataIndex];
          const currentSeries = data.series[seriesIndex];
          if (!zone || !currentSeries) {
            return '';
          }

          const value = currentSeries.values[dataIndex] ?? 0;
          const percent = this.formatPercentage(currentSeries.percentages[dataIndex] ?? 0);
          const duration = new DataDuration(value).getDisplayValue();
          return `${params.marker}<b>${zone}</b><br/>${currentSeries.type}: <b>${percent}%</b><br/>Time: <b>${duration}</b>`;
        }
      },
      xAxis: {
        type: 'value',
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLine: { show: false }
      },
      yAxis: {
        type: 'category',
        data: data.zones,
        axisTick: { show: false },
        axisLine: { show: false },
        splitArea: {
          show: true,
          areaStyle: {
            color: zoneBackgroundColors
          }
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: gridLineColor
          }
        },
        axisLabel: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
          formatter: (value: string) => {
            const zoneIndex = data.zones.indexOf(value);
            if (zoneIndex === -1) {
              return value;
            }
            return `{zone_${zoneIndex}|${value}}`;
          },
          rich: zoneAxisRichStyles
        }
      },
      series
    };

    return option;
  }

  private createZoneAxisRichStyles(zones: string[]): Record<string, {
    backgroundColor: string;
    borderRadius: number;
    color: string;
    fontWeight: number;
    width: number;
    align: 'center';
    verticalAlign: 'middle';
    lineHeight: number;
    padding: number[];
  }> {
    const badgeWidth = this.isMobile ? 28 : 56;
    const badgeLineHeight = this.isMobile ? 16 : 18;

    return zones.reduce((styles, zone, zoneIndex) => {
      styles[`zone_${zoneIndex}`] = {
        backgroundColor: this.eventColorService.getColorForZoneHex(zone),
        borderRadius: 6,
        color: '#ffffff',
        fontWeight: 600,
        width: badgeWidth,
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: badgeLineHeight,
        padding: [1, 4, 1, 4],
      };
      return styles;
    }, {} as Record<string, {
      backgroundColor: string;
      borderRadius: number;
      color: string;
      fontWeight: number;
      width: number;
      align: 'center';
      verticalAlign: 'middle';
      lineHeight: number;
      padding: number[];
    }>);
  }

  private createZoneBulletRichStyles(zones: string[]): Record<string, {
    backgroundColor: string;
    borderRadius: number;
    color: string;
    fontWeight: number;
    width: number;
    align: 'center';
    verticalAlign: 'middle';
    lineHeight: number;
    padding: number[];
  }> {
    const bulletWidth = this.isMobile ? 18 : 22;
    const bulletLineHeight = this.isMobile ? 14 : 16;

    return zones.reduce((styles, zone, zoneIndex) => {
      styles[`zone_${zoneIndex}`] = {
        backgroundColor: this.eventColorService.getColorForZoneHex(zone),
        borderRadius: 6,
        color: '#ffffff',
        fontWeight: 600,
        width: bulletWidth,
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: bulletLineHeight,
        padding: [0, 1, 0, 1],
      };
      return styles;
    }, {} as Record<string, {
      backgroundColor: string;
      borderRadius: number;
      color: string;
      fontWeight: number;
      width: number;
      align: 'center';
      verticalAlign: 'middle';
      lineHeight: number;
      padding: number[];
    }>);
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

  private formatPercentage(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(Math.max(0, value));
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

  private getLegendLabel(type: string): string {
    const normalizedType = `${type}`.trim().toLowerCase();
    if (type === DataHeartRate.type || normalizedType === 'heart rate') {
      return 'HR';
    }
    if (normalizedType === 'power') {
      return 'PWR';
    }
    if (normalizedType === 'speed') {
      return 'SPD';
    }
    return type;
  }

  private getSeriesColor(type: string): string {
    const colorMap = AppDataColors as unknown as Record<string, string>;
    return colorMap[type] ?? AppColors.Blue;
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
