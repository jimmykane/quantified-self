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
  DataDuration,
  DataHeartRate,
  StatsClassInterface,
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
import {
  ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../helpers/echarts-host-controller';
import { buildEventEChartsVisualTokens } from '../../../helpers/event-echarts-common.helper';
import { resolveEChartsTooltipTriggerOn } from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-event-intensity-zones',
  templateUrl: './event.intensity-zones.component.html',
  styleUrls: ['./event.intensity-zones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventIntensityZonesComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() activities: StatsClassInterface[] = [];
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() orientation: 'horizontal' | 'vertical' = 'horizontal';
  @Input() showHeader = true;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private chartHost: EChartsHostController;
  private isMobile = false;
  private breakpointSubscription: Subscription;

  constructor(
    private breakpointObserver: BreakpointObserver,
    private eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    private logger: LoggerService
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[EventIntensityZonesComponent]',
      initOptions: {
        useDirtyRect: true,
      },
    });

    this.breakpointSubscription = this.breakpointObserver
      .observe([AppBreakpoints.XSmall])
      .subscribe(result => {
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
    if (changes.activities || changes.darkTheme || changes.useAnimations || changes.orientation) {
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

    const statsClassInstances = Array.isArray(this.activities) ? this.activities : [];
    const data = convertIntensityZonesStatsToEchartsData(statsClassInstances, this.isMobile);
    const option = this.buildChartOption(data);
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(data: IntensityZonesEChartsData): ChartOption {
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const darkTheme = chartStyle.darkTheme;
    const textColor = chartStyle.textColor;
    const gridLineColor = chartStyle.gridColor;
    const zoneBackgroundOpacity = darkTheme ? 0.18 : 0.12;
    const tooltipExtraCssText = chartStyle.tooltipExtraCssText;
    const rightInset = 0;
    const zoneAxisRichStyles = this.createZoneAxisRichStyles(data.zones);
    const zoneBulletRichStyles = this.createZoneBulletRichStyles(data.zones);
    const zoneBackgroundColors = data.zones.map(zone =>
      this.toTransparentColor(this.eventColorService.getColorForZoneHex(zone), zoneBackgroundOpacity)
    );
    const series = data.series.map((seriesEntry, seriesIndex) => {
      const displayName = this.getLegendLabel(seriesEntry.type);
      const borderRadius = this.orientation === 'vertical' ? [8, 8, 0, 0] : [0, 8, 8, 0];
      const position = this.orientation === 'vertical' ? 'top' : 'right';
      const align = this.orientation === 'vertical' ? 'center' : 'left';
      const distance = this.orientation === 'vertical' ? 10 : 4;

      return {
        type: 'bar',
        name: displayName,
        data: seriesEntry.values,
        barMaxWidth: 18,
        clip: false,
        itemStyle: {
          color: this.getSeriesColor(seriesEntry.type),
          borderRadius: borderRadius
        },
        label: {
          show: true,
          position: position,
          distance: distance,
          align: align,
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

    const isHorizontal = this.orientation === 'horizontal';
    const verticalValueAxisMax = isHorizontal ? undefined : this.getVerticalValueAxisMax(data);
    const verticalEdgeBleed = isHorizontal ? 0 : -3;

    const valueAxisConfig = {
      type: 'value',
      max: verticalValueAxisMax,
      axisLabel: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLine: { show: false }
    };

    const categoryAxisConfig = {
      type: 'category',
      data: data.zones,
      boundaryGap: true,
      axisTick: { show: false, alignWithLabel: false },
      axisLine: { show: false },
      splitArea: {
        show: true,
        interval: 0,
        areaStyle: {
          color: zoneBackgroundColors
        }
      },
      splitLine: {
        show: true,
        interval: 0,
        lineStyle: {
          color: gridLineColor
        }
      },
      axisLabel: {
        interval: 0,
        margin: isHorizontal ? 8 : 0,
        color: textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        formatter: (value: string) => {
          const zoneIndex = data.zones.indexOf(value);
          if (zoneIndex === -1) {
            return value;
          }
          return `{zone_${zoneIndex}|${value}}`;
        },
        rich: zoneAxisRichStyles
      }
    };

    const option: ChartOption = {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
      },
      grid: {
        left: verticalEdgeBleed,
        right: isHorizontal ? rightInset : verticalEdgeBleed,
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
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        }
      },
      tooltip: {
        trigger: 'item',
        triggerOn: resolveEChartsTooltipTriggerOn(true, this.isMobile),
        renderMode: 'html',
        appendToBody: !this.isMobile,
        confine: this.isMobile,
        extraCssText: tooltipExtraCssText,
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
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
      xAxis: isHorizontal ? valueAxisConfig : categoryAxisConfig,
      yAxis: isHorizontal ? categoryAxisConfig : valueAxisConfig,
      series
    };

    return option;
  }

  private createZoneAxisRichStyles(zones: string[]): Record<string, {
    backgroundColor: string;
    borderRadius: number;
    color: string;
    fontWeight: number;
    fontSize: number;
    width: number;
    align: 'center';
    verticalAlign: 'middle';
    lineHeight: number;
    padding: number[];
  }> {
    const isVertical = this.orientation === 'vertical';
    const badgeWidth = isVertical
      ? (this.isMobile ? 36 : 64)
      : (this.isMobile ? 28 : 56);
    const badgeFontSize = isVertical
      ? (this.isMobile ? 11 : 13)
      : (this.isMobile ? 10 : 11);
    const badgeLineHeight = isVertical
      ? (this.isMobile ? 18 : 22)
      : (this.isMobile ? 16 : 18);
    const badgePadding = isVertical ? [2, 6, 2, 6] : [1, 4, 1, 4];

    return zones.reduce((styles, zone, zoneIndex) => {
      styles[`zone_${zoneIndex}`] = {
        backgroundColor: this.eventColorService.getColorForZoneHex(zone),
        borderRadius: 6,
        color: '#ffffff',
        fontWeight: 600,
        fontSize: badgeFontSize,
        width: badgeWidth,
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: badgeLineHeight,
        padding: badgePadding,
      };
      return styles;
    }, {} as Record<string, {
      backgroundColor: string;
      borderRadius: number;
      color: string;
      fontWeight: number;
      fontSize: number;
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

  private formatPercentage(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(Math.max(0, value));
  }

  private getVerticalValueAxisMax(data: IntensityZonesEChartsData): number | undefined {
    const maxValue = data.series.reduce((currentMax, seriesEntry) => {
      const seriesMax = seriesEntry.values.reduce((entryMax, value) => {
        return Number.isFinite(value) ? Math.max(entryMax, value) : entryMax;
      }, 0);
      return Math.max(currentMax, seriesMax);
    }, 0);

    if (maxValue <= 0) {
      return undefined;
    }

    return maxValue * 1.08;
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

}
