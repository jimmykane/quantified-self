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
import {
  buildDashboardEChartsTooltipChrome,
  buildDashboardEChartsStyleTokens,
  renderDashboardEChartsTooltipCard,
} from '../../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../../helpers/dashboard-echarts-yaxis.helper';
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
import { resolveDashboardFormStatus } from '../../../helpers/dashboard-form.helper';
import type {
  DashboardFreshnessForecastContext,
  DashboardFreshnessForecastPoint,
} from '../../../helpers/dashboard-derived-metrics.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type AxisTooltipParam = {
  data?: [number, number | null];
};

@Component({
  selector: 'app-freshness-forecast-chart',
  templateUrl: './charts.freshness-forecast.component.html',
  styleUrls: ['./charts.freshness-forecast.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsFreshnessForecastComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() forecast?: DashboardFreshnessForecastContext | null;
  @Input() status?: DashboardDerivedMetricStatus | null;
  @Input() infoTooltip?: string | null;
  @Input() mobileTapFeedbackOptions?: EChartsMobileTapFeedbackOptions | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

  public currentFormText = '--';
  public forecastFormText = '--';
  public showNoDataError = false;
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'This chart needs derived freshness forecast data.';
  public noDataErrorIcon = 'insights';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsFreshnessForecastComponent]',
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
    if (changes.darkTheme || changes.isLoading || changes.forecast || changes.status) {
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

  private getSortedPoints(): DashboardFreshnessForecastPoint[] {
    return [...(this.forecast?.points || [])]
      .filter(point => Number.isFinite(point.dayMs))
      .sort((left, right) => left.dayMs - right.dayMs);
  }

  private updateHeaderAndErrorState(points: DashboardFreshnessForecastPoint[] = this.getSortedPoints()): void {
    const currentPoint = [...points].reverse().find(point => point.isForecast === false) || null;
    const forecastPoint = [...points].reverse().find(point => point.isForecast === true) || null;

    this.currentFormText = this.formatValue(currentPoint?.formSameDay ?? currentPoint?.formPriorDay ?? null);
    this.forecastFormText = this.formatValue(forecastPoint?.formSameDay ?? forecastPoint?.formPriorDay ?? null);

    this.showNoDataError = points.length === 0;
    this.noDataErrorMessage = 'No data yet';
    this.noDataErrorHint = 'This chart needs derived freshness forecast data.';
    this.noDataErrorIcon = 'insights';

    if (this.showNoDataError && isDerivedMetricPendingStatus(this.status)) {
      this.noDataErrorMessage = 'Forecast is updating';
      this.noDataErrorHint = 'Derived freshness forecast is being recalculated.';
      this.noDataErrorIcon = 'autorenew';
    }
  }

  private buildOption(points: DashboardFreshnessForecastPoint[]): ChartOption {
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
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const mobileAxisPointerHandle = isMobileTooltipViewport
      ? {
        show: true,
        size: 20,
        margin: 4,
        throttle: 16,
        color: style.axisColor,
      }
      : { show: false };

    const ctlSeries = points.map(point => [point.dayMs, point.ctl] as const);
    const atlSeries = points.map(point => [point.dayMs, point.atl] as const);
    const formActualSeries = points.map((point) => (
      point.isForecast ? [point.dayMs, null] as const : [point.dayMs, point.formSameDay ?? point.formPriorDay] as const
    ));
    const formForecastSeries = points.map((point) => (
      point.isForecast ? [point.dayMs, point.formSameDay ?? point.formPriorDay] as const : [point.dayMs, null] as const
    ));
    const valueAxis = buildDashboardValueAxisConfig([
      ...points.map(point => point.ctl),
      ...points.map(point => point.atl),
      ...points.map(point => point.formSameDay),
      ...points.map(point => point.formSameDay ?? point.formPriorDay),
    ]);

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
        top: 8,
        bottom: 22,
        containLabel: false,
      },
      tooltip: {
        show: true,
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        axisPointer: { type: 'line' },
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: AxisTooltipParam[]) => this.formatTooltip(params, points, style),
      },
      xAxis: {
        type: 'time',
        axisPointer: {
          show: true,
          snap: true,
          triggerTooltip: true,
          label: { show: false },
          handle: mobileAxisPointerHandle,
        },
        axisLine: { lineStyle: { color: style.axisColor } },
        axisTick: { show: false },
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
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: style.gridColor },
        },
        axisLabel: {
          show: false,
        },
      },
      series: [
        {
          name: 'Fitness',
          type: 'line',
          data: ctlSeries,
          showSymbol: false,
          symbol: 'none',
          lineStyle: {
            width: 1.2,
            color: style.trendLineColor,
          },
        },
        {
          name: 'Fatigue',
          type: 'line',
          data: atlSeries,
          showSymbol: false,
          symbol: 'none',
          lineStyle: {
            width: 1.2,
            color: '#e91e63',
          },
        },
        {
          name: 'Form',
          type: 'line',
          data: formActualSeries,
          showSymbol: false,
          symbol: 'none',
          lineStyle: {
            width: 1.2,
            color: '#4caf50',
          },
        },
        {
          name: 'Form (forecast)',
          type: 'line',
          data: formForecastSeries,
          showSymbol: false,
          symbol: 'none',
          lineStyle: {
            width: 1.2,
            type: 'dashed',
            color: '#4caf50',
          },
        },
      ],
    };
  }

  private formatTooltip(
    params: AxisTooltipParam[],
    points: DashboardFreshnessForecastPoint[],
    style: ReturnType<typeof buildDashboardEChartsStyleTokens>,
  ): string {
    const point = this.resolveTooltipPoint(params, points);
    if (!point) {
      return '';
    }
    const pointIndex = points.findIndex(entry => entry.dayMs === point.dayMs);
    const previousPoint = pointIndex > 0 ? points[pointIndex - 1] : null;
    const formValue = point.formSameDay ?? point.formPriorDay;
    const previousFormValue = previousPoint ? (previousPoint.formSameDay ?? previousPoint.formPriorDay) : null;
    const deltaForm = (
      Number.isFinite(formValue)
      && Number.isFinite(previousFormValue)
    ) ? Number(formValue) - Number(previousFormValue) : null;
    const status = resolveDashboardFormStatus(formValue);
    const dateLabel = new Date(point.dayMs).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const firstForecastIndex = points.findIndex(entry => entry.isForecast);
    const forecastOffset = point.isForecast && firstForecastIndex >= 0
      ? (pointIndex - firstForecastIndex + 1)
      : null;
    const phaseLabel = point.isForecast
      ? `Forecast${forecastOffset ? ` · Day +${forecastOffset}` : ''}`
      : 'Observed';

    const rows = [
      { label: 'Fitness (CTL)', value: this.formatValue(point.ctl) },
      { label: 'Fatigue (ATL)', value: this.formatValue(point.atl) },
      { label: 'Form (TSB)', value: `${this.formatSignedValue(formValue)} · ${status.title}` },
      { label: 'TSS', value: this.formatValue(point.trainingStressScore) },
    ];
    if (deltaForm !== null) {
      rows.push({ label: 'Δ Form vs prev', value: this.formatSignedValue(deltaForm) });
    }

    return renderDashboardEChartsTooltipCard(style, {
      title: status.title,
      subtitle: `${dateLabel} · ${phaseLabel}`,
      rows,
      notes: point.isForecast ? ['Assumes zero load.'] : [],
    });
  }

  private resolveTooltipPoint(
    params: AxisTooltipParam[],
    points: DashboardFreshnessForecastPoint[],
  ): DashboardFreshnessForecastPoint | null {
    const dayMs = params?.[0]?.data?.[0];
    if (!Number.isFinite(dayMs)) {
      return null;
    }
    return points.find(point => point.dayMs === dayMs) || null;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '--';
    }
    const numericValue = Number(value);
    if (Math.abs(numericValue) >= 100) {
      return `${Math.round(numericValue)}`;
    }
    return `${Math.round(numericValue * 10) / 10}`;
  }

  private formatSignedValue(value: unknown): string {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '--';
    }
    const numericValue = Number(value);
    const valueText = this.formatValue(numericValue);
    if (numericValue > 0) {
      return `+${valueText}`;
    }
    return valueText;
  }
}
