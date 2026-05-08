import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
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
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../../helpers/derived-metric-status.helper';
import {
  type EChartsMobileTapFeedbackOptions,
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { formatDashboardWeekRangeLabel } from '../../../helpers/dashboard-chart-data.helper';
import type {
  DashboardAcwrContext,
  DashboardEasyPercentContext,
  DashboardEfficiencyDelta4wContext,
  DashboardFreshnessForecastContext,
  DashboardFatigueAtlContext,
  DashboardFitnessCtlContext,
  DashboardIntensityDistributionContext,
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
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  type DashboardKpiChartType,
} from '../../../helpers/dashboard-special-chart-types';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface KpiPresentation {
  title: string;
  primaryValue: number | null;
  primaryValueText?: string;
  primaryLabel: string;
  secondaryLabel: string;
  primarySuffix?: string;
  primarySigned?: boolean;
  secondaryValueText?: string;
  trend: Array<{ time: number; value: number | null }>;
}

interface KpiSparklineStyle {
  lineColor: string;
  areaColor: string;
  areaOpacity: number;
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
  @Input() infoTooltip?: string | null;
  @Input() reserveTitleActionSpace = false;
  @Input() compactRow = false;
  @Input() mobileTapFeedbackOptions?: EChartsMobileTapFeedbackOptions | null;
  @Input() acwr?: DashboardAcwrContext | null;
  @Input() rampRate?: DashboardRampRateContext | null;
  @Input() monotonyStrain?: DashboardMonotonyStrainContext | null;
  @Input() formNow?: DashboardFormNowContext | null;
  @Input() fitnessCtl?: DashboardFitnessCtlContext | null;
  @Input() fatigueAtl?: DashboardFatigueAtlContext | null;
  @Input() formPlus7d?: DashboardFormPlus7dContext | null;
  @Input() easyPercent?: DashboardEasyPercentContext | null;
  @Input() hardPercent?: DashboardHardPercentContext | null;
  @Input() efficiencyDelta4w?: DashboardEfficiencyDelta4wContext | null;
  @Input() freshnessForecast?: DashboardFreshnessForecastContext | null;
  @Input() intensityDistribution?: DashboardIntensityDistributionContext | null;
  @Input() acwrStatus?: DashboardDerivedMetricStatus | null;
  @Input() rampRateStatus?: DashboardDerivedMetricStatus | null;
  @Input() monotonyStrainStatus?: DashboardDerivedMetricStatus | null;
  @Input() formNowStatus?: DashboardDerivedMetricStatus | null;
  @Input() fitnessCtlStatus?: DashboardDerivedMetricStatus | null;
  @Input() fatigueAtlStatus?: DashboardDerivedMetricStatus | null;
  @Input() formPlus7dStatus?: DashboardDerivedMetricStatus | null;
  @Input() easyPercentStatus?: DashboardDerivedMetricStatus | null;
  @Input() hardPercentStatus?: DashboardDerivedMetricStatus | null;
  @Input() efficiencyDelta4wStatus?: DashboardDerivedMetricStatus | null;
  @Input() freshnessForecastStatus?: DashboardDerivedMetricStatus | null;
  @Input() intensityDistributionStatus?: DashboardDerivedMetricStatus | null;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;
  @ViewChild(MatTooltip) infoTooltipDirective?: MatTooltip;

  private readonly chartHost: EChartsHostController;
  private infoTooltipHideTimeoutId: ReturnType<typeof setTimeout> | null = null;

  public title = 'ACWR';
  public titleDisplay = 'ACWR';
  public primaryValueText = '--';
  public primaryLabel = 'Ratio';
  public secondaryLabel = 'Acute / chronic load';
  public secondaryValueText = '';
  public showNoDataError = false;
  public noDataErrorMessage = 'No KPI data yet';
  public noDataErrorHint = 'Upload activities with training load to calculate this metric.';
  public noDataErrorIcon = 'insights';

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
    private hapticsService: AppHapticsService,
    private changeDetectorRef: ChangeDetectorRef,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsKpiComponent]',
      mobileTapFeedbackOptions: () => this.mobileTapFeedbackOptions,
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
    const requiresChartRefresh = (
      changes.darkTheme
      || changes.isLoading
      || changes.chartType
      || changes.acwr
      || changes.rampRate
      || changes.monotonyStrain
      || changes.formNow
      || changes.fitnessCtl
      || changes.fatigueAtl
      || changes.formPlus7d
      || changes.easyPercent
      || changes.hardPercent
      || changes.efficiencyDelta4w
      || changes.freshnessForecast
      || changes.intensityDistribution
      || changes.acwrStatus
      || changes.rampRateStatus
      || changes.monotonyStrainStatus
      || changes.formNowStatus
      || changes.fitnessCtlStatus
      || changes.fatigueAtlStatus
      || changes.formPlus7dStatus
      || changes.easyPercentStatus
      || changes.hardPercentStatus
      || changes.efficiencyDelta4wStatus
      || changes.freshnessForecastStatus
      || changes.intensityDistributionStatus
      || changes.compactRow
    );

    if (requiresChartRefresh) {
      void this.refreshChart();
      return;
    }

    if (changes.reserveTitleActionSpace) {
      // Header action-space reservation changes text aliasing only; no chart rerender needed.
      this.titleDisplay = this.resolveDisplayTitle();
    }
  }

  ngOnDestroy(): void {
    this.clearInfoTooltipTimer();
    this.chartHost.dispose();
  }

  onKpiLayoutClick(event: MouseEvent): void {
    if (!this.infoTooltip) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.title-info-button')) {
      return;
    }
    this.hapticsService.selection();
    this.showInfoTooltip();
  }

  onInfoButtonClick(event: MouseEvent): void {
    event.stopPropagation();
    this.hapticsService.selection();
    this.showInfoTooltip();
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
    this.titleDisplay = this.resolveDisplayTitle();
    this.primaryLabel = presentation.primaryLabel;
    this.secondaryLabel = presentation.secondaryLabel;
    this.primaryValueText = presentation.primaryValueText || this.formatPrimaryValue(presentation.primaryValue, {
      suffix: presentation.primarySuffix || '',
      signed: presentation.primarySigned === true,
    });
    this.secondaryValueText = presentation.secondaryValueText || '';

    const hasRenderableValue = presentation.primaryValue !== null || !!presentation.primaryValueText;
    this.showNoDataError = !hasRenderableValue;
    this.noDataErrorMessage = 'No KPI data yet';
    this.noDataErrorHint = 'Upload activities with training load to calculate this metric.';
    this.noDataErrorIcon = 'insights';

    if (isDerivedMetricPendingStatus(this.resolveActiveStatus()) && !hasRenderableValue) {
      this.showNoDataError = true;
      this.noDataErrorMessage = 'Updating KPI data';
      this.noDataErrorHint = 'Training metrics are being recalculated in the background.';
      this.noDataErrorIcon = 'autorenew';
    }
    this.changeDetectorRef.markForCheck();

    return presentation;
  }

  private resolvePresentation(): KpiPresentation {
    if (this.chartType === DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE) {
      return this.resolveLoadStatusPresentation();
    }

    if (this.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE) {
      const context = this.formNow || null;
      return {
        title: 'Form Now',
        primaryValue: context?.value ?? null,
        primaryLabel: 'Same-day TSB',
        secondaryLabel: 'Current readiness state',
        primarySigned: true,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE) {
      const context = this.fitnessCtl || null;
      return {
        title: 'Fitness (CTL)',
        primaryValue: context?.value ?? null,
        primaryLabel: 'CTL',
        secondaryLabel: '42-day TSS load',
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE) {
      const context = this.fatigueAtl || null;
      return {
        title: 'Fatigue (ATL)',
        primaryValue: context?.value ?? null,
        primaryLabel: 'ATL',
        secondaryLabel: '7-day TSS load',
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE) {
      return this.resolveFitnessTrendPresentation();
    }

    if (this.chartType === DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE) {
      return this.resolveFatigueTrendPresentation();
    }

    if (this.chartType === DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE) {
      return this.resolveRecoveryDebtPresentation();
    }

    if (this.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE) {
      const context = this.formPlus7d || null;
      return {
        title: 'Form +7d',
        primaryValue: context?.value ?? null,
        primaryLabel: 'Projected same-day TSB',
        secondaryLabel: 'Zero-load forecast',
        primarySigned: true,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE) {
      return this.resolveTrainingBalancePresentation();
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
      const ctlTodayText = context?.ctlToday !== null && context?.ctlToday !== undefined
        ? this.formatPrimaryValue(context.ctlToday)
        : '';
      return {
        title: 'Ramp Rate',
        primaryValue: context?.rampRate ?? null,
        primaryLabel: 'CTL delta (7d)',
        secondaryLabel: ctlTodayText ? 'CTL today' : 'Fitness acceleration over the last 7 days',
        secondaryValueText: ctlTodayText,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    if (this.chartType === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE) {
      const context = this.monotonyStrain || null;
      const monotonyText = context?.monotony !== null && context?.monotony !== undefined
        ? this.formatPrimaryValue(context.monotony)
        : '';
      return {
        title: 'Monotony / Strain',
        primaryValue: context?.strain ?? null,
        primaryLabel: 'Strain',
        secondaryLabel: monotonyText ? 'Monotony' : 'Weekly monotony and strain',
        secondaryValueText: monotonyText,
        trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
      };
    }

    const context = this.acwr || null;
    const acuteChronicText = context
      ? `${this.formatPrimaryValue(context.acuteLoad7)} / ${this.formatPrimaryValue(context.chronicLoad28)}`
      : '';
    return {
      title: 'ACWR',
      primaryValue: context?.ratio ?? null,
      primaryLabel: 'Ratio',
      secondaryLabel: acuteChronicText ? 'Acute / Chronic' : 'Acute 7-day vs chronic 28-day load',
      secondaryValueText: acuteChronicText,
      trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveLoadStatusPresentation(): KpiPresentation {
    const form = this.toFiniteNumber(this.formNow?.value);
    const rampRate = this.toFiniteNumber(this.rampRate?.rampRate);
    const fitness = this.toFiniteNumber(this.fitnessCtl?.value);
    const fatigue = this.toFiniteNumber(this.fatigueAtl?.value);
    const status = this.resolveLoadStatusLabel(form, rampRate, fitness, fatigue);
    const detailParts = [
      form !== null ? `TSB ${this.formatPrimaryValue(form, { signed: true })}` : '',
      rampRate !== null ? `Ramp ${this.formatPrimaryValue(rampRate, { signed: true })}` : '',
    ].filter(Boolean);

    return {
      title: 'Load Status',
      primaryValue: null,
      primaryValueText: status.label,
      primaryLabel: status.caption || 'Current state',
      secondaryLabel: detailParts.length ? 'Load signals' : 'Form and ramp summary',
      secondaryValueText: detailParts.join(' / '),
      trend: (this.formNow?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveFitnessTrendPresentation(): KpiPresentation {
    const context = this.fitnessCtl || null;
    const trendDelta = this.resolveTrendDelta(context?.trend8Weeks || [], 4);
    const currentFitnessText = context?.value !== null && context?.value !== undefined
      ? this.formatPrimaryValue(context.value)
      : '';

    return {
      title: 'Fitness Trend',
      primaryValue: trendDelta,
      primaryLabel: 'CTL delta (4w)',
      secondaryLabel: currentFitnessText ? 'CTL now' : 'Recent CTL direction',
      secondaryValueText: currentFitnessText,
      primarySigned: true,
      trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveFatigueTrendPresentation(): KpiPresentation {
    const context = this.fatigueAtl || null;
    const trendDelta = this.resolveTrendDelta(context?.trend8Weeks || [], 1);
    const currentFatigueText = context?.value !== null && context?.value !== undefined
      ? this.formatPrimaryValue(context.value)
      : '';

    return {
      title: 'Fatigue Trend',
      primaryValue: trendDelta,
      primaryLabel: 'ATL delta (1w)',
      secondaryLabel: currentFatigueText ? 'ATL now' : 'Short-term fatigue direction',
      secondaryValueText: currentFatigueText,
      primarySigned: true,
      trend: (context?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveRecoveryDebtPresentation(): KpiPresentation {
    const debt = this.resolveRecoveryDebt();
    const formNowText = this.formNow?.value !== null && this.formNow?.value !== undefined
      ? this.formatPrimaryValue(this.formNow.value, { signed: true })
      : '';

    return {
      title: 'Recovery Debt',
      primaryValue: debt.days,
      primaryValueText: debt.label,
      primaryLabel: 'Zero-load days',
      secondaryLabel: formNowText ? 'TSB now' : 'Estimated days to neutral',
      secondaryValueText: formNowText,
      trend: (this.formNow?.trend8Weeks || []).map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveTrainingBalancePresentation(): KpiPresentation {
    const easyPercent = this.toFiniteNumber(this.intensityDistribution?.latestEasyPercent ?? this.easyPercent?.value);
    const moderatePercent = this.toFiniteNumber(this.intensityDistribution?.latestModeratePercent);
    const hardPercent = this.toFiniteNumber(this.intensityDistribution?.latestHardPercent ?? this.hardPercent?.value);
    const label = this.resolveTrainingBalanceLabel(easyPercent, moderatePercent, hardPercent);
    const secondaryParts = [
      easyPercent !== null ? `Easy ${this.formatPrimaryValue(easyPercent)}%` : '',
      moderatePercent !== null ? `Moderate ${this.formatPrimaryValue(moderatePercent)}%` : '',
      hardPercent !== null ? `Hard ${this.formatPrimaryValue(hardPercent)}%` : '',
    ].filter(Boolean);

    return {
      title: 'Training Balance',
      primaryValue: null,
      primaryValueText: label,
      primaryLabel: 'Latest week',
      secondaryLabel: secondaryParts.length ? 'Intensity mix' : 'Easy/moderate/hard split',
      secondaryValueText: secondaryParts.join(' / '),
      trend: (this.hardPercent?.trend8Weeks || this.easyPercent?.trend8Weeks || [])
        .map(point => ({ time: point.time, value: point.value })),
    };
  }

  private resolveLoadStatusLabel(
    form: number | null,
    rampRate: number | null,
    fitness: number | null,
    fatigue: number | null,
  ): { label?: string; caption?: string } {
    if (form === null && rampRate === null && fitness === null && fatigue === null) {
      return {};
    }

    if (fitness !== null && fitness < 5 && fatigue !== null && fatigue < 10) {
      return { label: 'Starting', caption: 'Low training history' };
    }

    if (
      form !== null
      && (form <= -30 || (form <= -20 && fatigue !== null && fitness !== null && fatigue > fitness * 1.25))
    ) {
      return { label: 'Overload', caption: 'Back off soon' };
    }

    if (form !== null && form <= -10) {
      return { label: 'Fatigued', caption: 'Absorb the load' };
    }

    if (rampRate !== null && rampRate >= 1 && (form === null || form < 6)) {
      return { label: 'Building', caption: 'Productive load' };
    }

    if (form !== null && form >= 8 && (rampRate === null || rampRate <= 0)) {
      return { label: 'Fresh', caption: 'Ready to train' };
    }

    if (rampRate !== null && rampRate <= -3 && (form === null || form > -8)) {
      return { label: 'Detraining', caption: 'Load is falling' };
    }

    return { label: 'Balanced', caption: 'Stable load' };
  }

  private resolveTrainingBalanceLabel(
    easyPercent: number | null,
    moderatePercent: number | null,
    hardPercent: number | null,
  ): string | undefined {
    if (easyPercent === null && moderatePercent === null && hardPercent === null) {
      return undefined;
    }

    if (hardPercent !== null && hardPercent >= 25) {
      return 'Hard-heavy';
    }
    if (easyPercent !== null && easyPercent >= 75 && (hardPercent === null || hardPercent <= 12)) {
      return 'Easy-heavy';
    }
    if (
      moderatePercent !== null
      && moderatePercent >= 45
      && (hardPercent === null || hardPercent < 20)
    ) {
      return 'Moderate';
    }
    if (
      easyPercent !== null
      && easyPercent >= 55
      && easyPercent <= 80
      && (hardPercent === null || hardPercent <= 20)
    ) {
      return 'Balanced';
    }
    return 'Mixed';
  }

  private resolveRecoveryDebt(): { days: number | null; label?: string } {
    const formNow = this.toFiniteNumber(this.formNow?.value);
    if (formNow === null) {
      return { days: null };
    }
    if (formNow >= 0) {
      return { days: 0, label: '0 d' };
    }

    const latestDayMs = this.toFiniteNumber(this.formNow?.latestDayMs);
    const forecastPoints = [...(this.freshnessForecast?.points || [])]
      .filter(point => Number.isFinite(point.dayMs))
      .sort((left, right) => left.dayMs - right.dayMs);
    const neutralForecastPoint = forecastPoints.find((point) => {
      const forecastForm = this.toFiniteNumber(point.formSameDay);
      return forecastForm !== null
        && forecastForm >= 0
        && (latestDayMs === null || point.dayMs >= latestDayMs);
    });

    if (neutralForecastPoint && latestDayMs !== null) {
      const days = Math.max(0, Math.ceil((neutralForecastPoint.dayMs - latestDayMs) / 86_400_000));
      return { days, label: `${days} d` };
    }

    const projected = this.toFiniteNumber(this.formPlus7d?.value);
    if (projected !== null && projected > formNow) {
      const estimatedDays = Math.ceil(Math.abs(formNow) / (projected - formNow) * 7);
      if (estimatedDays <= 7) {
        return { days: estimatedDays, label: `${estimatedDays} d` };
      }
    }

    return { days: 7, label: '7+ d' };
  }

  private resolveTrendDelta(
    trend: ReadonlyArray<{ value: number | null | undefined }>,
    preferredPointsAgo: number,
  ): number | null {
    const numericValues = trend
      .map(point => this.toFiniteNumber(point.value))
      .filter((value): value is number => value !== null);
    if (numericValues.length < 2) {
      return null;
    }
    const latest = numericValues[numericValues.length - 1];
    const comparisonIndex = Math.max(0, numericValues.length - 1 - preferredPointsAgo);
    return latest - numericValues[comparisonIndex];
  }

  private resolveCombinedStatus(
    statuses: ReadonlyArray<DashboardDerivedMetricStatus | null | undefined>,
  ): DashboardDerivedMetricStatus | null {
    const normalizedStatuses = statuses.filter((status): status is DashboardDerivedMetricStatus => !!status);
    return normalizedStatuses.find(status => isDerivedMetricPendingStatus(status))
      || normalizedStatuses.find(status => status === 'ready')
      || normalizedStatuses[0]
      || null;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  private resolveActiveStatus(): DashboardDerivedMetricStatus | null {
    if (this.chartType === DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE) {
      return this.resolveCombinedStatus([
        this.formNowStatus,
        this.rampRateStatus,
        this.fitnessCtlStatus,
        this.fatigueAtlStatus,
      ]);
    }
    if (this.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE) {
      return this.formNowStatus || null;
    }
    if (this.chartType === DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE) {
      return this.fitnessCtlStatus || null;
    }
    if (this.chartType === DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE) {
      return this.fatigueAtlStatus || null;
    }
    if (this.chartType === DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE) {
      return this.fitnessCtlStatus || null;
    }
    if (this.chartType === DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE) {
      return this.fatigueAtlStatus || null;
    }
    if (this.chartType === DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE) {
      return this.resolveCombinedStatus([
        this.freshnessForecastStatus,
        this.formNowStatus,
        this.formPlus7dStatus,
      ]);
    }
    if (this.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE) {
      return this.formPlus7dStatus || null;
    }
    if (this.chartType === DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE) {
      return this.resolveCombinedStatus([
        this.intensityDistributionStatus,
        this.easyPercentStatus,
        this.hardPercentStatus,
      ]);
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

  private resolveDisplayTitle(): string {
    if (this.compactRow) {
      return this.title;
    }
    if (this.reserveTitleActionSpace !== true) {
      return this.title;
    }
    if (this.chartType === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE) {
      return 'Ramp';
    }
    if (this.chartType === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE) {
      return 'M/S';
    }
    if (this.chartType === DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE) {
      return 'Eff Δ';
    }
    if (this.chartType === DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE) {
      return 'Status';
    }
    if (this.chartType === DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE) {
      return 'Fitness';
    }
    if (this.chartType === DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE) {
      return 'Fatigue';
    }
    if (this.chartType === DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE) {
      return 'Fit Δ';
    }
    if (this.chartType === DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE) {
      return 'Fatigue Δ';
    }
    if (this.chartType === DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE) {
      return 'Rec Debt';
    }
    if (this.chartType === DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE) {
      return 'Balance';
    }
    return this.title;
  }

  private showInfoTooltip(): void {
    if (!this.infoTooltipDirective || !this.infoTooltip) {
      return;
    }
    this.infoTooltipDirective.show(0);
    this.clearInfoTooltipTimer();
    this.infoTooltipHideTimeoutId = setTimeout(() => {
      this.infoTooltipDirective?.hide(0);
      this.infoTooltipHideTimeoutId = null;
    }, 2200);
  }

  private clearInfoTooltipTimer(): void {
    if (this.infoTooltipHideTimeoutId === null) {
      return;
    }
    clearTimeout(this.infoTooltipHideTimeoutId);
    this.infoTooltipHideTimeoutId = null;
  }

  private buildOption(presentation: KpiPresentation): ChartOption {
    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const sparklineStyle = this.resolveSparklineStyle(style.trendLineColor);
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const rawTrendData = presentation.trend
      .filter(point => Number.isFinite(point.time))
      .map(point => {
        const numericValue = point.value === null || point.value === undefined
          ? null
          : Number(point.value);
        return [point.time, Number.isFinite(numericValue) ? numericValue : null] as const;
      });
    const trendData = this.trimNullEdgeTrendPoints(rawTrendData);
    const trendNumericValues = trendData
      .map(([, value]) => value)
      .filter((value): value is number => Number.isFinite(value));
    const minTrendValue = trendNumericValues.length ? Math.min(...trendNumericValues) : 0;
    const maxTrendValue = trendNumericValues.length ? Math.max(...trendNumericValues) : 0;
    const yAxisRangePadding = this.resolveYAxisPadding(minTrendValue, maxTrendValue);
    const hasNegativeTrend = minTrendValue < 0;
    const yAxisBounds = this.resolveYAxisBounds(
      minTrendValue,
      maxTrendValue,
      yAxisRangePadding,
      hasNegativeTrend,
    );
    const negativeBandColor = this.withAlpha(
      this.resolveThemeColor('--mat-sys-error', '#c62828'),
      this.darkTheme ? 0.12 : 0.08,
    );
    const zeroGuideLineColor = this.withAlpha(style.axisColor, this.darkTheme ? 0.24 : 0.18);

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
        left: 0,
        right: 0,
        top: 4,
        bottom: 2,
        containLabel: false,
      },
      xAxis: {
        type: 'time',
        min: 'dataMin',
        max: 'dataMax',
        boundaryGap: false,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: yAxisBounds.min,
        max: yAxisBounds.max,
        scale: true,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { show: false },
      },
      tooltip: this.buildTooltipOption(style, isMobileTooltipViewport, sparklineStyle),
      series: [
        {
          type: 'line',
          silent: this.compactRow,
          data: trendData,
          smooth: true,
          showSymbol: false,
          symbol: 'none',
          connectNulls: true,
          lineStyle: {
            width: 1,
            color: sparklineStyle.lineColor,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {
                  offset: 0,
                  color: this.withAlpha(sparklineStyle.areaColor, sparklineStyle.areaOpacity),
                },
                {
                  offset: 1,
                  color: this.withAlpha(sparklineStyle.areaColor, 0.06),
                },
              ],
            },
            origin: 'auto',
          },
          markLine: hasNegativeTrend
            ? {
              symbol: 'none',
              silent: true,
              label: { show: false },
              lineStyle: {
                color: zeroGuideLineColor,
                width: 0.75,
                type: 'dotted',
              },
              data: [{ yAxis: 0 }],
            }
            : undefined,
          markArea: hasNegativeTrend
            ? {
              silent: true,
              label: { show: false },
              itemStyle: {
                color: negativeBandColor,
              },
              data: [
                [
                  { yAxis: minTrendValue },
                  { yAxis: 0 },
                ],
              ],
            }
            : undefined,
        },
      ],
    };
  }

  private buildTooltipOption(
    style: ReturnType<typeof buildDashboardEChartsStyleTokens>,
    isMobileTooltipViewport: boolean,
    sparklineStyle: KpiSparklineStyle,
  ): Record<string, unknown> {
    if (this.compactRow) {
      return { show: false };
    }

    return {
      show: true,
      trigger: 'axis',
      triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: this.withAlpha(sparklineStyle.lineColor, 0.42),
          width: 1,
        },
      },
      renderMode: 'html',
      ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
      ...buildDashboardEChartsTooltipChrome(style),
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
        const heading = this.isWeeklyTrendKpi()
          ? formatDashboardWeekRangeLabel(entry[0], undefined, 'UTC')
          : dateLabel;
        const valueText = this.formatPrimaryValue(entry[1]);
        return renderDashboardEChartsTooltipCard(style, {
          title: heading,
          rows: [{ label: this.primaryLabel || 'Value', value: valueText }],
        });
      },
    };
  }

  private resolveSparklineStyle(fallbackColor: string): KpiSparklineStyle {
    const positiveColor = this.resolveThemeColor('--mat-sys-primary', '#1b7f38');
    const negativeColor = this.resolveThemeColor('--mat-sys-error', '#c62828');
    const neutralColor = this.resolveThemeColor('--mat-sys-secondary', '#2c6cb0');
    const readinessColor = this.resolveThemeColor('--mat-sys-tertiary', '#7a3db8');
    const hardLoadColor = this.resolveThemeColor('--mat-sys-error', '#e65100');
    const monotonyColor = this.resolveThemeColor('--mat-sys-secondary', '#7b5e57');

    if (
      this.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE
      || this.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE
      || this.chartType === DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE
    ) {
      const readinessValue = this.chartType === DASHBOARD_FORM_NOW_KPI_CHART_TYPE
        ? this.formNow?.value ?? null
        : this.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE
          ? this.formPlus7d?.value ?? null
          : this.formNow?.value ?? null;
      return {
        lineColor: this.resolveDirectionalColor(readinessValue, {
          positiveColor,
          negativeColor,
          neutralColor: readinessColor,
          neutralThreshold: 1,
        }),
        areaColor: readinessColor,
        areaOpacity: 0.16,
      };
    }

    if (
      this.chartType === DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE
      || this.chartType === DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE
    ) {
      return {
        lineColor: positiveColor,
        areaColor: positiveColor,
        areaOpacity: 0.16,
      };
    }

    if (this.chartType === DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE) {
      return {
        lineColor: hardLoadColor,
        areaColor: hardLoadColor,
        areaOpacity: 0.14,
      };
    }

    if (this.chartType === DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE) {
      const deltaValue = this.efficiencyDelta4w?.deltaAbs ?? null;
      return {
        lineColor: this.resolveDirectionalColor(deltaValue, {
          positiveColor,
          negativeColor,
          neutralColor,
          neutralThreshold: 0.02,
        }),
        areaColor: neutralColor,
        areaOpacity: 0.14,
      };
    }

    if (this.chartType === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE) {
      return {
        lineColor: this.resolveDirectionalColor(this.rampRate?.rampRate ?? null, {
          positiveColor,
          negativeColor,
          neutralColor,
          neutralThreshold: 0.15,
        }),
        areaColor: neutralColor,
        areaOpacity: 0.14,
      };
    }

    if (this.chartType === DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE) {
      return {
        lineColor: this.resolveDirectionalColor(this.formNow?.value ?? null, {
          positiveColor,
          negativeColor,
          neutralColor,
          neutralThreshold: 5,
        }),
        areaColor: neutralColor,
        areaOpacity: 0.14,
      };
    }

    if (this.chartType === DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE) {
      const fitnessDelta = this.resolveTrendDelta(this.fitnessCtl?.trend8Weeks || [], 4);
      return {
        lineColor: this.resolveDirectionalColor(fitnessDelta, {
          positiveColor,
          negativeColor,
          neutralColor,
          neutralThreshold: 0.5,
        }),
        areaColor: neutralColor,
        areaOpacity: 0.14,
      };
    }

    if (this.chartType === DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE) {
      const fatigueDelta = this.resolveTrendDelta(this.fatigueAtl?.trend8Weeks || [], 1);
      return {
        lineColor: this.resolveDirectionalColor(fatigueDelta, {
          positiveColor: hardLoadColor,
          negativeColor: positiveColor,
          neutralColor,
          neutralThreshold: 0.5,
        }),
        areaColor: hardLoadColor,
        areaOpacity: 0.12,
      };
    }

    if (
      this.chartType === DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE
      || this.chartType === DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE
    ) {
      return {
        lineColor: neutralColor,
        areaColor: neutralColor,
        areaOpacity: 0.14,
      };
    }

    if (this.chartType === DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE) {
      return {
        lineColor: monotonyColor,
        areaColor: monotonyColor,
        areaOpacity: 0.12,
      };
    }

    if (this.chartType === DASHBOARD_ACWR_KPI_CHART_TYPE) {
      const acwrRatio = this.acwr?.ratio ?? null;
      // Training-risk zones: <0.8 too low stimulus, >1.3 spike risk.
      if (Number.isFinite(acwrRatio as number) && (acwrRatio as number) > 1.3) {
        return {
          lineColor: negativeColor,
          areaColor: negativeColor,
          areaOpacity: 0.14,
        };
      }
      if (Number.isFinite(acwrRatio as number) && (acwrRatio as number) < 0.8) {
        return {
          lineColor: this.resolveThemeColor('--mat-sys-tertiary', '#8854d0'),
          areaColor: this.resolveThemeColor('--mat-sys-tertiary', '#8854d0'),
          areaOpacity: 0.12,
        };
      }
      return {
        lineColor: positiveColor,
        areaColor: positiveColor,
        areaOpacity: 0.16,
      };
    }

    return {
      lineColor: fallbackColor,
      areaColor: fallbackColor,
      areaOpacity: 0.12,
    };
  }

  private resolveThemeColor(cssVariableName: string, fallbackColor: string): string {
    if (typeof window === 'undefined') {
      return fallbackColor;
    }
    const color = window.getComputedStyle(document.documentElement)
      .getPropertyValue(cssVariableName)
      .trim();
    if (!color || color.startsWith('var(')) {
      return fallbackColor;
    }
    return color;
  }

  private resolveDirectionalColor(
    value: number | null | undefined,
    options: {
      positiveColor: string;
      negativeColor: string;
      neutralColor: string;
      neutralThreshold: number;
    },
  ): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return options.neutralColor;
    }
    if (numericValue > options.neutralThreshold) {
      return options.positiveColor;
    }
    if (numericValue < -options.neutralThreshold) {
      return options.negativeColor;
    }
    return options.neutralColor;
  }

  private withAlpha(color: string, alpha: number): string {
    const normalizedAlpha = Math.max(0, Math.min(1, alpha));
    const rgb = this.parseRgbColor(color);
    if (!rgb) {
      return color;
    }
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${normalizedAlpha})`;
  }

  private resolveYAxisPadding(minValue: number, maxValue: number): number {
    const span = Math.max(0, maxValue - minValue);
    const magnitude = Math.max(Math.abs(minValue), Math.abs(maxValue), 1);
    return Math.max(0.35, span * 0.2, magnitude * 0.08);
  }

  private resolveYAxisBounds(
    minValue: number,
    maxValue: number,
    padding: number,
    includeZeroBaseline: boolean,
  ): { min: number; max: number } {
    const min = minValue - padding;
    let max = maxValue + padding;

    if (includeZeroBaseline) {
      // Keep y=0 visible when negative-band overlays are active.
      max = Math.max(0, max);
    }

    if (max > min) {
      return { min, max };
    }

    return { min, max: min + Math.max(padding, 1) };
  }

  private parseRgbColor(
    color: string,
  ): { r: number; g: number; b: number } | null {
    const normalized = `${color || ''}`.trim().toLowerCase();
    const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
      };
    }

    const rgbMatch = normalized.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (rgbMatch) {
      return {
        r: Number.parseInt(rgbMatch[1], 10),
        g: Number.parseInt(rgbMatch[2], 10),
        b: Number.parseInt(rgbMatch[3], 10),
      };
    }

    return null;
  }

  private trimNullEdgeTrendPoints(
    trendData: ReadonlyArray<readonly [number, number | null]>,
  ): Array<readonly [number, number | null]> {
    if (!trendData.length) {
      return [];
    }

    let firstIndex = 0;
    let lastIndex = trendData.length - 1;

    while (firstIndex <= lastIndex && trendData[firstIndex][1] === null) {
      firstIndex += 1;
    }
    while (lastIndex >= firstIndex && trendData[lastIndex][1] === null) {
      lastIndex -= 1;
    }

    if (firstIndex > lastIndex) {
      return [];
    }
    return trendData.slice(firstIndex, lastIndex + 1);
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

  private isWeeklyTrendKpi(): boolean {
    return true;
  }
}
