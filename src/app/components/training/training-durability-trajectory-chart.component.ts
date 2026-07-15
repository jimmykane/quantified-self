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
import { formatDashboardWeekRangeLabel } from '../../helpers/dashboard-chart-data.helper';
import type { DashboardDerivedMetricStatus } from '../../helpers/derived-metric-status.helper';
import { isDerivedMetricPendingStatus } from '../../helpers/derived-metric-status.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import type { TrainingDurabilityTrajectoryViewModel } from '../../helpers/training-durability-view.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface TrajectoryTooltipParam {
  dataIndex?: number;
}

@Component({
  selector: 'app-training-durability-trajectory-chart',
  templateUrl: './training-durability-trajectory-chart.component.html',
  styleUrls: ['./training-durability-trajectory-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingDurabilityTrajectoryChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() trajectory: TrainingDurabilityTrajectoryViewModel | null = null;
  @Input() status: DashboardDerivedMetricStatus = 'missing';
  @Input() darkTheme = false;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  public isUpdating = true;
  public availabilityText = 'Preparing weekly durability evidence.';
  public chartAriaLabel = 'Twelve-week durability trajectory';

  private readonly chartHost: EChartsHostController;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[TrainingDurabilityTrajectoryChartComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.trajectory || changes.status || changes.darkTheme) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refresh(): Promise<void> {
    this.refreshLabels();
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

  private refreshLabels(): void {
    this.isUpdating = this.status === 'missing' || isDerivedMetricPendingStatus(this.status);
    const trajectory = this.trajectory;
    if (!trajectory) {
      this.availabilityText = 'Preparing weekly durability evidence.';
      this.chartAriaLabel = 'Twelve-week durability trajectory';
      return;
    }
    const evidenceWeekCount = trajectory.points.length - trajectory.emptyWeekCount;
    const unavailableMetricText = trajectory.unavailableMetricWeekCount
      ? ` · ${trajectory.unavailableMetricWeekCount} with eligible samples but no ${trajectory.metricLabel.toLowerCase()}`
      : '';
    this.availabilityText = `${evidenceWeekCount} of ${trajectory.points.length} weeks with eligible samples · ${trajectory.emptyWeekCount} empty${unavailableMetricText}`;
    this.chartAriaLabel = `${trajectory.contextLabel} twelve-week ${trajectory.metricLabel.toLowerCase()} trajectory with eligible activity counts`;
  }

  private buildOption(): ChartOption {
    const trajectory = this.trajectory;
    if (!trajectory?.points.length) {
      return { animation: false, tooltip: { show: false }, xAxis: [], yAxis: [], series: [] };
    }
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, this.chartDiv.nativeElement.clientWidth || 0);
    const weekLabelFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const maximumSampleCount = Math.max(0, ...trajectory.points.map(point => point.eligibleSampleCount));
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: { left: 12, right: 18, top: 38, bottom: 34, containLabel: true },
      legend: {
        top: 0,
        right: 4,
        data: [trajectory.metricLabel, 'Eligible samples'],
        textStyle: { color: style.textColor },
      },
      tooltip: {
        trigger: 'axis',
        renderMode: 'html',
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: TrajectoryTooltipParam | TrajectoryTooltipParam[]) => {
          const entries = Array.isArray(params) ? params : [params];
          const dataIndex = entries.find(entry => Number.isInteger(entry?.dataIndex))?.dataIndex;
          const point = Number.isInteger(dataIndex) ? trajectory.points[dataIndex as number] : null;
          if (!point) {
            return '';
          }
          const metricValue = point.value === null
            ? point.isEmpty ? 'No eligible evidence' : 'Unavailable'
            : `${formatNumber(point.value)}${trajectory.unitLabel}`;
          return renderDashboardEChartsTooltipCard(style, {
            title: formatDashboardWeekRangeLabel(point.weekStartDayMs, undefined, 'UTC'),
            rows: [
              { label: trajectory.metricLabel, value: metricValue, markerColor: style.trendLineColor },
              {
                label: 'Eligible samples',
                value: point.eligibleSampleCount
                  ? `${formatNumber(point.eligibleSampleCount)} activit${point.eligibleSampleCount === 1 ? 'y' : 'ies'}`
                  : 'Empty week',
                markerColor: style.axisColor,
              },
            ],
          });
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: true,
        data: trajectory.points.map(point => point.weekStartDayMs),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: {
          color: style.textColor,
          interval: 0,
          formatter: (value: number | string) => weekLabelFormatter.format(new Date(Number(value))),
        },
      },
      yAxis: [{
        type: 'value',
        name: trajectory.unitLabel,
        nameTextStyle: { color: style.textColor },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: { color: style.textColor, formatter: (value: number) => `${formatNumber(value)}%` },
      }, {
        type: 'value',
        name: 'Eligible',
        min: 0,
        max: Math.max(2, maximumSampleCount + 1),
        minInterval: 1,
        nameTextStyle: { color: style.secondaryTextColor },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: style.secondaryTextColor, formatter: (value: number) => formatNumber(value) },
      }],
      series: [{
        name: 'Eligible samples',
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 20,
        barMinHeight: 3,
        data: trajectory.points.map(point => point.eligibleSampleCount),
        itemStyle: { color: style.axisColor, opacity: 0.24 },
        label: {
          show: true,
          position: 'top',
          color: style.secondaryTextColor,
          fontSize: 10,
          formatter: (params: { value?: number }) => Number(params.value) > 0 ? `${params.value}` : 'Empty',
        },
        z: 1,
      }, {
        name: trajectory.metricLabel,
        type: 'line',
        yAxisIndex: 0,
        connectNulls: false,
        showSymbol: true,
        symbolSize: 7,
        data: trajectory.points.map(point => point.value),
        lineStyle: { width: 2.5, color: style.trendLineColor },
        itemStyle: { color: style.trendLineColor },
        z: 3,
      }],
    };
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
