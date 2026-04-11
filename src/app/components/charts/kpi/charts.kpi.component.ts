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
  DashboardAcwrContext,
  DashboardEasyPercentContext,
  DashboardEfficiencyDelta4wContext,
  DashboardMonotonyStrainContext,
  DashboardFormNowContext,
  DashboardFormPlus7dContext,
  DashboardHardPercentContext,
  DashboardRampRateContext,
} from '../../../helpers/dashboard-derived-metrics.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  type DashboardKpiChartType,
} from '../../../helpers/dashboard-special-chart-types';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface KpiPresentation {
  title: string;
  primaryValue: number | null;
  primaryLabel: string;
  secondaryLabel: string;
  primarySuffix?: string;
  primarySigned?: boolean;
  secondaryValueText?: string;
  trend: Array<{ time: number; value: number | null }>;
}

@Component({
  selector: 'app-kpi-chart',
  templateUrl: './charts.kpi.component.html',
  styleUrls: ['./charts.kpi.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsKpiComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() chartType: DashboardKpiChartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
  @Input() acwr?: DashboardAcwrContext | null;
  @Input() rampRate?: DashboardRampRateContext | null;
  @Input() monotonyStrain?: DashboardMonotonyStrainContext | null;
  @Input() formNow?: DashboardFormNowContext | null;
  @Input() formPlus7d?: DashboardFormPlus7dContext | null;
  @Input() easyPercent?: DashboardEasyPercentContext | null;
  @Input() hardPercent?: DashboardHardPercentContext | null;
  @Input() efficiencyDelta4w?: DashboardEfficiencyDelta4wContext | null;
  @Input() acwrStatus?: DashboardDerivedMetricStatus | null;
  @Input() rampRateStatus?: DashboardDerivedMetricStatus | null;
  @Input() monotonyStrainStatus?: DashboardDerivedMetricStatus | null;
  @Input() formNowStatus?: DashboardDerivedMetricStatus | null;
  @Input() formPlus7dStatus?: DashboardDerivedMetricStatus | null;
  @Input() easyPercentStatus?: DashboardDerivedMetricStatus | null;
  @Input() hardPercentStatus?: DashboardDerivedMetricStatus | null;
  @Input() efficiencyDelta4wStatus?: DashboardDerivedMetricStatus | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;

  public title = 'ACWR';
  public primaryValueText = '--';
  public primaryLabel = 'Ratio';
  public secondaryLabel = 'Acute / chronic load';
  public secondaryValueText = '';
  public showNoDataError = false;
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'This KPI needs derived training metrics.';
  public noDataErrorIcon = 'insights';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsKpiComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      this.updatePresentationAndOverlay();
      return;
    }
    if (
      changes.darkTheme
      || changes.isLoading
      || changes.chartType
      || changes.acwr
      || changes.rampRate
      || changes.monotonyStrain
      || changes.formNow
      || changes.formPlus7d
      || changes.easyPercent
      || changes.hardPercent
      || changes.efficiencyDelta4w
      || changes.acwrStatus
      || changes.rampRateStatus
      || changes.monotonyStrainStatus
      || changes.formNowStatus
      || changes.formPlus7dStatus
      || changes.easyPercentStatus
      || changes.hardPercentStatus
      || changes.efficiencyDelta4wStatus
    ) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const presentation = this.updatePresentationAndOverlay();
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    const option = this.buildOption(presentation);
    this.chartHost.hideTooltip();
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private updatePresentationAndOverlay(): KpiPresentation {
    const presentation = this.resolvePresentation();
    this.title = presentation.title;
    this.primaryLabel = presentation.primaryLabel;
    this.secondaryLabel = presentation.secondaryLabel;
    this.primaryValueText = this.formatPrimaryValue(presentation.primaryValue, {
      suffix: presentation.primarySuffix || '',
      signed: presentation.primarySigned === true,
    });
    this.secondaryValueText = presentation.secondaryValueText || '';

    const hasRenderableValue = presentation.primaryValue !== null;
    this.showNoDataError = !hasRenderableValue;
    this.noDataErrorMessage = 'No data yet';
    this.noDataErrorHint = 'This KPI needs derived training metrics.';
    this.noDataErrorIcon = 'insights';

    if (isDerivedMetricPendingStatus(this.resolveActiveStatus()) && !hasRenderableValue) {
      this.showNoDataError = true;
      this.noDataErrorMessage = 'KPI is updating';
      this.noDataErrorHint = 'Derived metrics are being recalculated in the background.';
      this.noDataErrorIcon = 'autorenew';
    }

    return presentation;
  }

  private resolvePresentation(): KpiPresentation {
    if (this.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE) {
      const context = this.formNow || null;
      return {
        title: 'Form Now',
        primaryValue: context?.value ?? null,
        primaryLabel: 'Prior-day TSB',
        secondaryLabel: 'Current readiness state',
        primarySigned: true,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE) {
      const context = this.formPlus7d || null;
      return {
        title: 'Form +7d',
        primaryValue: context?.value ?? null,
        primaryLabel: 'Projected prior-day TSB',
        secondaryLabel: 'Zero-load forecast',
        primarySigned: true,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE) {
      const context = this.easyPercent || null;
      return {
        title: 'Easy %',
        primaryValue: context?.value ?? null,
        primaryLabel: 'Latest weekly bucket',
        secondaryLabel: 'Weekly intensity split',
        primarySuffix: '%',
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE) {
      const context = this.hardPercent || null;
      return {
        title: 'Hard %',
        primaryValue: context?.value ?? null,
        primaryLabel: 'Latest weekly bucket',
        secondaryLabel: 'Weekly intensity split',
        primarySuffix: '%',
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE) {
      const context = this.efficiencyDelta4w || null;
      const percentDeltaText = context?.deltaPct === null || context?.deltaPct === undefined
        ? '--'
        : `${context.deltaPct >= 0 ? '+' : ''}${this.formatPrimaryValue(context.deltaPct)}%`;
      return {
        title: 'Efficiency Δ (4w)',
        primaryValue: context?.deltaAbs ?? null,
        primaryLabel: 'Absolute delta',
        secondaryLabel: 'Percent delta',
        secondaryValueText: percentDeltaText,
        primarySigned: true,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE) {
      const context = this.rampRate || null;
      return {
        title: 'Ramp Rate',
        primaryValue: context?.rampRate ?? null,
        primaryLabel: 'CTL delta (7d)',
        secondaryLabel: context?.ctlToday !== null && context?.ctlToday !== undefined
          ? `CTL today ${this.formatPrimaryValue(context.ctlToday)}`
          : 'Fitness acceleration over the last 7 days',
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE) {
      const context = this.monotonyStrain || null;
      const monotonyText = context?.monotony !== null && context?.monotony !== undefined
        ? `Monotony ${this.formatPrimaryValue(context.monotony)}`
        : 'Weekly monotony and strain';
      return {
        title: 'Monotony / Strain',
        primaryValue: context?.strain ?? null,
        primaryLabel: 'Strain',
        secondaryLabel: monotonyText,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    const context = this.acwr || null;
    return {
      title: 'ACWR',
      primaryValue: context?.ratio ?? null,
      primaryLabel: 'Ratio',
      secondaryLabel: context
        ? `Acute ${this.formatPrimaryValue(context.acuteLoad7)} / Chronic ${this.formatPrimaryValue(context.chronicLoad28)}`
        : 'Acute 7-day vs chronic 28-day load',
      trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveActiveStatus(): DashboardDerivedMetricStatus | null {
    if (this.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE) {
      return this.formNowStatus || null;
    }
    if (this.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE) {
      return this.formPlus7dStatus || null;
    }
    if (this.chartType === DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE) {
      return this.easyPercentStatus || null;
    }
    if (this.chartType === DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE) {
      return this.hardPercentStatus || null;
    }
    if (this.chartType === DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE) {
      return this.efficiencyDelta4wStatus || null;
    }
    if (this.chartType === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE) {
      return this.rampRateStatus || null;
    }
    if (this.chartType === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE) {
      return this.monotonyStrainStatus || null;
    }
    return this.acwrStatus || null;
  }

  private buildOption(presentation: KpiPresentation): ChartOption {
    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const trendData = presentation.trend
      .filter(point => Number.isFinite(point.time))
      .map(point => [point.time, point.value] as const);

    if (!trendData.length) {
      return {
        animation: false,
        tooltip: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: {
        color: style.textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
      },
      grid: {
        left: 2,
        right: 2,
        top: 4,
        bottom: 2,
        containLabel: false,
      },
      xAxis: {
        type: 'time',
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { show: false },
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
        formatter: (params: Array<{ data?: [number, number | null] }>) => {
          const entry = params?.[0]?.data;
          if (!entry) {
            return '';
          }
          const dateLabel = new Date(entry[0]).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          const valueText = this.formatPrimaryValue(entry[1]);
          return `${dateLabel}<br/><strong>${valueText}</strong>`;
        },
      },
      series: [
        {
          type: 'line',
          data: trendData,
          smooth: true,
          showSymbol: false,
          symbol: 'none',
          lineStyle: {
            width: 1.4,
            color: style.trendLineColor,
          },
          areaStyle: {
            color: style.trendLineColor,
            opacity: 0.15,
          },
        },
      ],
    };
  }

  private formatPrimaryValue(
    value: unknown,
    options?: { suffix?: string; signed?: boolean },
  ): string {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
      return '--';
    }
    const numericValue = Number(value);
    const suffix = `${options?.suffix || ''}`;
    const prefix = options?.signed === true && numericValue > 0 ? '+' : '';
    if (Math.abs(numericValue) >= 100) {
      return `${prefix}${Math.round(numericValue)}${suffix}`;
    }
    if (Math.abs(numericValue) >= 10) {
      return `${prefix}${Math.round(numericValue * 10) / 10}${suffix}`;
    }
    return `${prefix}${Math.round(numericValue * 100) / 100}${suffix}`;
  }
}
