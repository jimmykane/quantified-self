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
import type { EChartsType } from 'echarts/core';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
} from '../../helpers/dashboard-echarts-style.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import type {
  TrainingPowerSystemsTrendPointViewModel,
  TrainingPowerSystemsTrendViewModel,
} from '../../helpers/training-power-systems.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface TrendTooltipParam {
  data?: [number, number | null];
}

@Component({
  selector: 'app-training-power-systems-trend-chart',
  templateUrl: './training-power-systems-trend-chart.component.html',
  styleUrls: ['./training-power-systems-trend-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingPowerSystemsTrendChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input()
  public set trend(value: TrainingPowerSystemsTrendViewModel | null) {
    this.trendValue = value;
    const readyPoints = value?.points.filter(point => point.value !== null) || [];
    this.hasReadyValues = readyPoints.length > 0;
    if (!value) {
      this.chartAriaLabel = 'Twelve-week power-system capacity history';
      return;
    }
    const currentPoint = value.points.find(point => point.isCurrent) || null;
    const readyPointText = `${readyPoints.length} ready ${readyPoints.length === 1 ? 'value' : 'values'}`;
    const currentText = currentPoint?.value === null || !currentPoint
      ? 'current value unavailable'
      : `current value ${formatTrendValue(currentPoint.value, value.unit)} ${value.unit}`;
    this.chartAriaLabel = `${value.label} over the latest 12 weeks; ${
      this.hasReadyValues ? readyPointText : '0 ready values'
    }; ${currentText}`;
  }
  public get trend(): TrainingPowerSystemsTrendViewModel | null {
    return this.trendValue;
  }
  @Input() darkTheme = false;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  public hasReadyValues = false;
  public chartAriaLabel = 'Twelve-week power-system capacity history';

  private readonly chartHost: EChartsHostController;
  private trendValue: TrainingPowerSystemsTrendViewModel | null = null;
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[TrainingPowerSystemsTrendChartComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewInitialized && (changes.trend || changes.darkTheme)) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHost.dispose();
  }

  private async refresh(): Promise<void> {
    if (!this.chartDiv?.nativeElement) {
      return;
    }
    const chart = await this.chartHost.init(
      this.chartDiv.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }
    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildOption(): ChartOption {
    const trend = this.trend;
    if (!trend) {
      return { animation: false, tooltip: { show: false }, xAxis: [], yAxis: [], series: [] };
    }
    const style = buildDashboardEChartsStyleTokens(
      this.darkTheme,
      this.chartDiv?.nativeElement.clientWidth || 0,
    );
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const pointsByTime = new Map(trend.points.map(point => [point.dayMs, point]));
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: {
        left: 8,
        right: 10,
        top: 8,
        bottom: 6,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: TrendTooltipParam | TrendTooltipParam[]) => {
          const entries = Array.isArray(params) ? params : [params];
          const time = entries.find(entry => Number.isFinite(entry?.data?.[0]))?.data?.[0];
          const point = Number.isFinite(time) ? pointsByTime.get(time as number) : null;
          if (!point) {
            return '';
          }
          return renderDashboardEChartsTooltipCard(style, {
            title: `${dateFormatter.format(new Date(point.dayMs))}${point.isCurrent ? ' · Current' : ''}`,
            rows: [{
              label: trend.label,
              value: point.value === null
                ? `Unavailable · ${point.statusText}`
                : `${formatTrendValue(point.value, trend.unit)} ${trend.unit}`,
              markerColor: style.trendLineColor,
            }],
          });
        },
      },
      xAxis: {
        type: 'time',
        min: trend.rangeStartDayMs,
        max: trend.rangeEndDayMs,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        minInterval: trend.unit === 'W' ? 1 : undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        splitNumber: 2,
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          formatter: (value: number) => formatTrendValue(value, trend.unit),
        },
      },
      series: [{
        name: trend.label,
        type: 'line',
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: (_value: unknown, params: { dataIndex?: number }) => {
          const point = resolvePointAtIndex(trend.points, params.dataIndex);
          return point?.isCurrent ? 9 : 6;
        },
        data: trend.points.map(point => [point.dayMs, point.value]),
        lineStyle: { width: 2.25, color: style.trendLineColor },
        itemStyle: { color: style.trendLineColor },
        emphasis: { scale: 1.25 },
      }],
    };
  }
}

function resolvePointAtIndex(
  points: TrainingPowerSystemsTrendPointViewModel[],
  index: number | undefined,
): TrainingPowerSystemsTrendPointViewModel | null {
  return Number.isInteger(index) ? points[index as number] || null : null;
}

function formatTrendValue(value: number, unit: TrainingPowerSystemsTrendViewModel['unit']): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: unit === 'kJ' ? 1 : 0,
  }).format(value);
}
