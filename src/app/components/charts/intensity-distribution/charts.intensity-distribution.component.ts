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
  type EChartsMobileTapFeedbackOptions,
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../../helpers/derived-metric-status.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import type {
  DashboardIntensityDistributionContext,
  DashboardIntensityDistributionWeek,
} from '../../../helpers/dashboard-derived-metrics.helper';
import {
  DASHBOARD_DERIVED_CHART_DEFAULT_RANGE,
  filterDashboardDerivedWeeklyRange,
  normalizeDashboardDerivedChartRange,
  type DashboardDerivedChartRange,
} from '../../../helpers/dashboard-derived-chart-range.helper';
import { formatDashboardWeekRangeLabel } from '../../../helpers/dashboard-chart-data.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type IntensityXAxisLabelMode = 'day-month' | 'month-year' | 'year';

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
  @Input() infoTooltip?: string | null;
  @Input() reserveTitleActionSpace = false;
  @Input() mobileTapFeedbackOptions?: EChartsMobileTapFeedbackOptions | null;
  @Input()
  set range(value: DashboardDerivedChartRange | null | undefined) {
    const nextRange = normalizeDashboardDerivedChartRange(value);
    if (nextRange === this.selectedRange) {
      return;
    }
    this.selectedRange = nextRange;
    if (this.chartDiv?.nativeElement) {
      void this.refreshChart();
    } else {
      this.updateHeaderAndErrorState();
    }
  }
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

  public easyText = '--';
  public moderateText = '--';
  public hardText = '--';
  public weekContextText = 'Current week';
  public showNoDataError = false;
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'This chart needs derived intensity distribution data.';
  public noDataErrorIcon = 'query_stats';
  public selectedRange: DashboardDerivedChartRange = DASHBOARD_DERIVED_CHART_DEFAULT_RANGE;

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsIntensityDistributionComponent]',
      mobileTapFeedbackOptions: () => this.mobileTapFeedbackOptions,
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
    const weeks = this.getVisibleWeeks();
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

  private getVisibleWeeks(): DashboardIntensityDistributionWeek[] {
    return filterDashboardDerivedWeeklyRange(this.getSortedWeeks(), this.selectedRange);
  }

  private updateHeaderAndErrorState(weeks: DashboardIntensityDistributionWeek[] = this.getVisibleWeeks()): void {
    const latest = weeks[weeks.length - 1] || null;
    if (latest) {
      const total = latest.easySeconds + latest.moderateSeconds + latest.hardSeconds;
      this.easyText = total > 0 ? `${Math.round((latest.easySeconds / total) * 100)}%` : '--';
      this.moderateText = total > 0 ? `${Math.round((latest.moderateSeconds / total) * 100)}%` : '--';
      this.hardText = total > 0 ? `${Math.round((latest.hardSeconds / total) * 100)}%` : '--';
      this.weekContextText = this.resolveWeekContextText(latest.weekStartMs);
    } else {
      this.easyText = '--';
      this.moderateText = '--';
      this.hardText = '--';
      this.weekContextText = 'Current week';
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
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();

    const categories = weeks.map((week) => week.weekStartMs);
    const xAxisLabelMode = this.resolveXAxisLabelMode(weeks);
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
        left: 6,
        right: 6,
        top: 6,
        bottom: 20,
        containLabel: false,
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        axisPointer: { type: 'shadow' },
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        borderWidth: 1,
        borderColor: style.tooltipBorderColor,
        backgroundColor: style.tooltipBackgroundColor,
        textStyle: {
          color: style.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: style.axisFontSize,
        },
        formatter: (params: Array<{ axisValue?: string | number; seriesName?: string; value?: number }>) => {
          if (!Array.isArray(params) || params.length === 0) {
            return '';
          }
          const axisHeading = this.formatTooltipWeekLabel(params[0]?.axisValue ?? null);
          const lines = params
            .map((entry) => {
              const seriesName = `${entry?.seriesName || ''}`.trim();
              const valueText = this.formatPercent(entry?.value ?? null);
              return seriesName ? `${seriesName}: ${valueText}` : valueText;
            })
            .filter((line) => line.trim().length > 0);
          if (!lines.length) {
            return axisHeading;
          }
          return axisHeading ? `${axisHeading}<br/>${lines.join('<br/>')}` : lines.join('<br/>');
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
          formatter: (value: string | number) => this.formatXAxisLabel(value, xAxisLabelMode),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          show: false,
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

  private formatPercent(value: unknown): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '--';
    }
    return `${Math.round(Number(value))}%`;
  }

  private resolveWeekContextText(weekStartMs: number): string {
    const currentWeekStartMs = this.resolveUtcWeekStartMs(Date.now());
    const contextPrefix = weekStartMs === currentWeekStartMs ? 'Current week' : 'Latest week';
    const weekEndMs = weekStartMs + (6 * 24 * 60 * 60 * 1000);
    const startLabel = new Date(weekStartMs).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = new Date(weekEndMs).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    return `${contextPrefix} (${startLabel} - ${endLabel})`;
  }

  private resolveUtcWeekStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    const dayIndexMondayFirst = (date.getUTCDay() + 6) % 7;
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - dayIndexMondayFirst,
    );
  }

  private resolveXAxisLabelMode(weeks: DashboardIntensityDistributionWeek[]): IntensityXAxisLabelMode {
    if (weeks.length < 2) {
      return 'day-month';
    }
    const firstWeekMs = weeks[0]?.weekStartMs ?? 0;
    const lastWeekMs = weeks[weeks.length - 1]?.weekStartMs ?? firstWeekMs;
    const spanMs = Math.max(0, lastWeekMs - firstWeekMs);
    const spanDays = spanMs / (24 * 60 * 60 * 1000);
    const spansMultipleYears = new Date(firstWeekMs).getFullYear() !== new Date(lastWeekMs).getFullYear();

    if (spanDays >= 730) {
      return 'year';
    }
    if (spansMultipleYears || spanDays >= 180) {
      return 'month-year';
    }
    return 'day-month';
  }

  private formatXAxisLabel(value: string | number | null | undefined, mode: IntensityXAxisLabelMode): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '';
    }
    const date = new Date(Number(value));
    switch (mode) {
      case 'year':
        return date.toLocaleDateString(undefined, { year: 'numeric' });
      case 'month-year':
        return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      case 'day-month':
      default:
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  }

  private formatTooltipWeekLabel(value: string | number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '';
    }

    return formatDashboardWeekRangeLabel(Number(value), undefined, 'UTC');
  }
}
