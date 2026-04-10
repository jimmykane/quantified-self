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
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../../helpers/derived-metric-status.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import type {
  DashboardIntensityDistributionContext,
  DashboardIntensityDistributionWeek,
} from '../../../helpers/dashboard-derived-metrics.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-intensity-distribution-chart',
  templateUrl: './charts.intensity-distribution.component.html',
  styleUrls: ['./charts.intensity-distribution.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsIntensityDistributionComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() distribution?: DashboardIntensityDistributionContext | null;
  @Input() status?: DashboardDerivedMetricStatus | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

  public easyText = '--';
  public moderateText = '--';
  public hardText = '--';
  public showNoDataError = false;
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'This chart needs derived intensity distribution data.';
  public noDataErrorIcon = 'query_stats';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsIntensityDistributionComponent]',
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
    if (changes.darkTheme || changes.isLoading || changes.distribution || changes.status) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const weeks = this.getSortedWeeks();
    this.updateHeaderAndErrorState(weeks);

    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(weeks), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private getSortedWeeks(): DashboardIntensityDistributionWeek[] {
    return [...(this.distribution?.weeks || [])]
      .filter(week => Number.isFinite(week.weekStartMs))
      .sort((left, right) => left.weekStartMs - right.weekStartMs);
  }

  private updateHeaderAndErrorState(weeks: DashboardIntensityDistributionWeek[] = this.getSortedWeeks()): void {
    const latest = weeks[weeks.length - 1] || null;
    if (latest) {
      const total = latest.easySeconds + latest.moderateSeconds + latest.hardSeconds;
      this.easyText = total > 0 ? `${Math.round((latest.easySeconds / total) * 100)}%` : '--';
      this.moderateText = total > 0 ? `${Math.round((latest.moderateSeconds / total) * 100)}%` : '--';
      this.hardText = total > 0 ? `${Math.round((latest.hardSeconds / total) * 100)}%` : '--';
    } else {
      this.easyText = '--';
      this.moderateText = '--';
      this.hardText = '--';
    }

    this.showNoDataError = weeks.length === 0;
    this.noDataErrorMessage = 'No data yet';
    this.noDataErrorHint = 'This chart needs derived intensity distribution data.';
    this.noDataErrorIcon = 'query_stats';
    if (this.showNoDataError && isDerivedMetricPendingStatus(this.status)) {
      this.noDataErrorMessage = 'Intensity distribution is updating';
      this.noDataErrorHint = 'Derived intensity distribution is being recalculated.';
      this.noDataErrorIcon = 'autorenew';
    }
  }

  private buildOption(weeks: DashboardIntensityDistributionWeek[]): ChartOption {
    if (!weeks.length) {
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

    const categories = weeks.map((week) => new Date(week.weekStartMs).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }));
    const percentages = weeks.map((week) => {
      const total = week.easySeconds + week.moderateSeconds + week.hardSeconds;
      if (total <= 0) {
        return { easy: 0, moderate: 0, hard: 0 };
      }
      return {
        easy: (week.easySeconds / total) * 100,
        moderate: (week.moderateSeconds / total) * 100,
        hard: (week.hardSeconds / total) * 100,
      };
    });

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      grid: {
        left: 30,
        right: 8,
        top: 6,
        bottom: 22,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
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
        type: 'category',
        data: categories,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: {
          color: style.textColor,
          fontSize: style.axisFontSize,
          hideOverlap: true,
          interval: 0,
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.textColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => `${Math.round(value)}%`,
        },
      },
      series: [
        {
          name: 'Easy',
          type: 'bar',
          stack: 'intensity',
          data: percentages.map(entry => entry.easy),
          itemStyle: { color: '#43a047' },
          barMaxWidth: 28,
        },
        {
          name: 'Moderate',
          type: 'bar',
          stack: 'intensity',
          data: percentages.map(entry => entry.moderate),
          itemStyle: { color: '#fb8c00' },
          barMaxWidth: 28,
        },
        {
          name: 'Hard',
          type: 'bar',
          stack: 'intensity',
          data: percentages.map(entry => entry.hard),
          itemStyle: { color: '#e53935' },
          barMaxWidth: 28,
        },
      ],
    };
  }
}
