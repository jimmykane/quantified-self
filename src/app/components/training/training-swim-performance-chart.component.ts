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
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import type { DashboardTrainingSwimPerformanceContext } from '../../helpers/dashboard-derived-metrics.helper';
import type { DashboardDerivedMetricStatus } from '../../helpers/derived-metric-status.helper';
import { isDerivedMetricPendingStatus } from '../../helpers/derived-metric-status.helper';
import {
  buildTrainingSwimPerformanceViewModel,
  formatTrainingSwimPace,
  type TrainingSwimPerformanceViewModel,
} from '../../helpers/training-swim-performance.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
} from '../../helpers/dashboard-echarts-style.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { formatDashboardWeekRangeLabel } from '../../helpers/dashboard-chart-data.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-training-swim-performance-chart',
  templateUrl: './training-swim-performance-chart.component.html',
  styleUrls: ['./training-swim-performance-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingSwimPerformanceChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() performance: DashboardTrainingSwimPerformanceContext | null = null;
  @Input() status: DashboardDerivedMetricStatus = 'missing';
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  public view: TrainingSwimPerformanceViewModel = buildTrainingSwimPerformanceViewModel(null, null);
  public showEmpty = true;
  public isUpdating = true;
  public emptyTitle = 'No swimming sessions yet';
  public emptyHint = 'Pool and open-water pace appear after eligible swims are available.';

  private readonly chartHost: EChartsHostController;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[TrainingSwimPerformanceChartComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.performance || changes.status || changes.darkTheme || changes.unitSettings) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refresh(): Promise<void> {
    this.view = buildTrainingSwimPerformanceViewModel(this.performance, this.unitSettings);
    this.updateEmptyState();
    if (!this.chartDiv?.nativeElement) {
      return;
    }
    const chart = await this.chartHost.init(this.chartDiv.nativeElement, resolveEChartsThemeName(this.darkTheme));
    if (!chart) {
      return;
    }
    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private updateEmptyState(): void {
    this.isUpdating = this.status === 'missing' || isDerivedMetricPendingStatus(this.status);
    this.showEmpty = this.status === 'failed' || !this.view.hasPace;
    if (this.isUpdating) {
      this.emptyTitle = 'Swimming pace is updating';
      this.emptyHint = 'Building the 12-week pool and open-water comparison.';
      return;
    }
    if (this.status === 'failed') {
      this.emptyTitle = 'Swimming pace is unavailable';
      this.emptyHint = 'Refresh to request another derived snapshot.';
      return;
    }
    if (this.view.hasSessions) {
      this.emptyTitle = 'No explicit swim pace yet';
      this.emptyHint = 'These swims have no stored Average Swim Pace; rests are not used to estimate it.';
      return;
    }
    this.emptyTitle = 'No swimming sessions yet';
    this.emptyHint = 'Pool and open-water pace appear after eligible swims are available.';
  }

  private buildOption(): ChartOption {
    if (!this.view.hasPace) {
      return { animation: false, tooltip: { show: false }, xAxis: [], yAxis: [], series: [] };
    }
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, this.chartDiv.nativeElement.clientWidth || 0);
    const pointsByTime = new Map<number, { pool: typeof this.view.pool[number] | null; open: typeof this.view.openWater[number] | null }>();
    this.view.pool.forEach(point => pointsByTime.set(point.weekStartMs, { pool: point, open: null }));
    this.view.openWater.forEach((point) => {
      const entry = pointsByTime.get(point.weekStartMs) || { pool: null, open: null };
      entry.open = point;
      pointsByTime.set(point.weekStartMs, entry);
    });
    const paceValue = (value: number | null): number | null => value === null
      ? null
      : value * (this.view.usesYards ? 0.9144 : 1);
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: { left: 14, right: 18, top: 28, bottom: 34, containLabel: true },
      legend: { top: 0, right: 4, textStyle: { color: style.textColor } },
      tooltip: {
        trigger: 'axis',
        renderMode: 'html',
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: Array<{ data?: [number, number | null]; seriesName?: string }>) => {
          const time = params?.[0]?.data?.[0];
          if (!Number.isFinite(time)) {
            return '';
          }
          const week = pointsByTime.get(time as number);
          const rows = [
            { label: 'Pool', point: week?.pool || null },
            { label: 'Open water', point: week?.open || null },
          ].filter(row => row.point?.activityCount || row.point?.paceSeconds !== null).flatMap((row) => {
            if (!row.point) {
              return [];
            }
            return [{
              label: row.label,
              value: `${formatTrainingSwimPace(row.point.paceSeconds, this.view.usesYards)} · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(row.point.distanceMeters)} m · ${row.point.activityCount} swim${row.point.activityCount === 1 ? '' : 's'}`,
            }];
          });
          return renderDashboardEChartsTooltipCard(style, {
            title: formatDashboardWeekRangeLabel(time as number, undefined, 'UTC'),
            rows,
          });
        },
      },
      xAxis: {
        type: 'time',
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: { color: style.textColor, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        inverse: true,
        name: this.view.paceUnit,
        nameTextStyle: { color: style.textColor },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.textColor,
          formatter: (value: number) => formatTrainingSwimPace(
            value / (this.view.usesYards ? 0.9144 : 1),
            this.view.usesYards,
          ).split(' ')[0],
        },
      },
      series: [
        {
          name: 'Pool', type: 'line', connectNulls: false, showSymbol: true, symbolSize: 6,
          data: this.view.pool.map(point => [point.weekStartMs, paceValue(point.paceSeconds)]),
          lineStyle: { width: 2, color: style.trendLineColor },
          itemStyle: { color: style.trendLineColor },
        },
        {
          name: 'Open water', type: 'line', connectNulls: false, showSymbol: true, symbolSize: 6,
          data: this.view.openWater.map(point => [point.weekStartMs, paceValue(point.paceSeconds)]),
          lineStyle: { width: 2, type: 'dashed', color: style.axisColor },
          itemStyle: { color: style.axisColor },
        },
      ],
    };
  }
}
