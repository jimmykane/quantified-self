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
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../../helpers/echarts-host-controller';
import { buildDashboardEChartsStyleTokens } from '../../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../../helpers/dashboard-echarts-yaxis.helper';
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../../helpers/derived-metric-status.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import type {
  DashboardEfficiencyTrendContext,
  DashboardEfficiencyTrendPoint,
} from '../../../helpers/dashboard-derived-metrics.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-efficiency-trend-chart',
  templateUrl: './charts.efficiency-trend.component.html',
  styleUrls: ['./charts.efficiency-trend.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsEfficiencyTrendComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() trend?: DashboardEfficiencyTrendContext | null;
  @Input() status?: DashboardDerivedMetricStatus | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

  public latestValueText = '--';
  public showNoDataError = false;
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'This chart needs derived efficiency trend data.';
  public noDataErrorIcon = 'show_chart';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsEfficiencyTrendComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      this.updateHeaderAndErrorState();
      return;
    }
    if (changes.darkTheme || changes.isLoading || changes.trend || changes.status) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const points = this.getSortedPoints();
    this.updateHeaderAndErrorState(points);
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(points), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private getSortedPoints(): DashboardEfficiencyTrendPoint[] {
    return [...(this.trend?.points || [])]
      .filter(point => Number.isFinite(point.weekStartMs) && Number.isFinite(point.value))
      .sort((left, right) => left.weekStartMs - right.weekStartMs);
  }

  private updateHeaderAndErrorState(points: DashboardEfficiencyTrendPoint[] = this.getSortedPoints()): void {
    const latest = points[points.length - 1] || null;
    this.latestValueText = this.formatValue(latest?.value ?? null);

    this.showNoDataError = points.length === 0;
    this.noDataErrorMessage = 'No data yet';
    this.noDataErrorHint = 'This chart needs derived efficiency trend data.';
    this.noDataErrorIcon = 'show_chart';
    if (this.showNoDataError && isDerivedMetricPendingStatus(this.status)) {
      this.noDataErrorMessage = 'Efficiency trend is updating';
      this.noDataErrorHint = 'Derived efficiency trend is being recalculated.';
      this.noDataErrorIcon = 'autorenew';
    }
  }

  private buildOption(points: DashboardEfficiencyTrendPoint[]): ChartOption {
    if (!points.length) {
      return {
        animation: false,
        tooltip: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);

    const values = points.map(point => point.value);
    const valueAxis = buildDashboardValueAxisConfig(values);

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      grid: {
        left: 32,
        right: 8,
        top: 8,
        bottom: 24,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        borderWidth: 1,
        borderColor: style.tooltipBorderColor,
        backgroundColor: style.tooltipBackgroundColor,
        textStyle: {
          color: style.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
      },
      xAxis: {
        type: 'time',
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: {
          color: style.textColor,
          fontSize: style.axisFontSize,
          hideOverlap: true,
          formatter: (value: number) => new Date(value).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }),
        },
      },
      yAxis: {
        type: 'value',
        min: valueAxis.min,
        max: valueAxis.max,
        interval: valueAxis.interval,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.textColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => `${Math.round(value * 100) / 100}`,
        },
      },
      series: [
        {
          name: 'Efficiency',
          type: 'line',
          data: points.map(point => [point.weekStartMs, point.value] as const),
          showSymbol: false,
          symbol: 'none',
          lineStyle: {
            width: 1.3,
            color: style.trendLineColor,
          },
          areaStyle: {
            color: style.trendLineColor,
            opacity: 0.16,
          },
        },
      ],
    };
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '--';
    }
    const numericValue = Number(value);
    return `${Math.round(numericValue * 100) / 100}`;
  }
}
