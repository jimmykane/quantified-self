import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals,
  ActivityTypes,
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import type { DashboardFormPoint } from '../../../helpers/dashboard-form.helper';
import type { DashboardRecoveryNowContext } from '../../../helpers/dashboard-recovery-now.helper';
import type {
  DashboardAcwrContext,
  DashboardEasyPercentContext,
  DashboardEfficiencyDelta4wContext,
  DashboardEfficiencyTrendContext,
  DashboardFreshnessForecastContext,
  DashboardFormNowContext,
  DashboardFormPlus7dContext,
  DashboardHardPercentContext,
  DashboardIntensityDistributionContext,
  DashboardMonotonyStrainContext,
  DashboardRampRateContext,
} from '../../../helpers/dashboard-derived-metrics.helper';
import type { DashboardSleepTrendContext } from '../../../helpers/dashboard-sleep-chart.helper';
import type {
  DashboardSleepTrendNavigationDirection,
} from '../../../helpers/dashboard-sleep-range.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  type DashboardChartType,
  isDashboardSpecialChartType,
} from '../../../helpers/dashboard-special-chart-types';
import { resolveDashboardChartInfoTooltip } from '../../../helpers/dashboard-chart-info.helper';
import type { DerivedMetricSnapshotStatus } from '@shared/derived-metrics';
import type { DashboardDerivedMetricStatus } from '../../../helpers/derived-metric-status.helper';
import type { AppDashboardSleepTrendRange } from '../../../models/app-user.interface';
import type {
  AppDashboardTileEventFilterRange,
  AppDashboardTileEventFiltersInterface,
} from '../../../models/app-user.interface';
import type { DashboardTileEventNavigationDirection } from '../../../helpers/dashboard-tile-event-filters.helper';

type DashboardRecoveryNowSnapshotStatus = DerivedMetricSnapshotStatus | 'missing' | 'queued' | 'processing';

@Component({
  selector: 'app-tile-chart',
  templateUrl: './tile.chart.component.html',
  styleUrls: ['../tile.abstract.css', './tile.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class TileChartComponent extends TileAbstractDirective {
  @Input() chartType: DashboardChartType;
  @Input() dataType: string;
  @Input() dataValueType: ChartDataValueTypes;
  @Input() dataCategoryType: ChartDataCategoryTypes;
  @Input() darkTheme = false;
  @Input() showActions: boolean;
  @Input() enableDesktopDrag = false;
  @Input() compactKpiRow = false;
  @Input() dataTimeInterval: TimeIntervals;
  @Input() data: any;
  @Input() eventFilters?: AppDashboardTileEventFiltersInterface | null;
  @Input() canNavigateTileEventsNewer = false;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
  @Input() recoveryNowStatus?: DashboardRecoveryNowSnapshotStatus | null;
  @Input() formStatus?: DashboardDerivedMetricStatus | null;
  @Input() acwr?: DashboardAcwrContext | null;
  @Input() rampRate?: DashboardRampRateContext | null;
  @Input() monotonyStrain?: DashboardMonotonyStrainContext | null;
  @Input() formNow?: DashboardFormNowContext | null;
  @Input() formPlus7d?: DashboardFormPlus7dContext | null;
  @Input() easyPercent?: DashboardEasyPercentContext | null;
  @Input() hardPercent?: DashboardHardPercentContext | null;
  @Input() efficiencyDelta4w?: DashboardEfficiencyDelta4wContext | null;
  @Input() freshnessForecast?: DashboardFreshnessForecastContext | null;
  @Input() intensityDistribution?: DashboardIntensityDistributionContext | null;
  @Input() efficiencyTrend?: DashboardEfficiencyTrendContext | null;
  @Input() sleepTrend?: DashboardSleepTrendContext | null;
  @Input() sleepTrendRange?: AppDashboardSleepTrendRange;
  @Input() sleepTrendWindowLabel?: string | null;
  @Input() sleepTrendCanNavigateOlder = false;
  @Input() sleepTrendCanNavigateNewer = false;
  @Input() acwrStatus?: DashboardDerivedMetricStatus | null;
  @Input() rampRateStatus?: DashboardDerivedMetricStatus | null;
  @Input() monotonyStrainStatus?: DashboardDerivedMetricStatus | null;
  @Input() formNowStatus?: DashboardDerivedMetricStatus | null;
  @Input() formPlus7dStatus?: DashboardDerivedMetricStatus | null;
  @Input() easyPercentStatus?: DashboardDerivedMetricStatus | null;
  @Input() hardPercentStatus?: DashboardDerivedMetricStatus | null;
  @Input() efficiencyDelta4wStatus?: DashboardDerivedMetricStatus | null;
  @Input() freshnessForecastStatus?: DashboardDerivedMetricStatus | null;
  @Input() intensityDistributionStatus?: DashboardDerivedMetricStatus | null;
  @Input() efficiencyTrendStatus?: DashboardDerivedMetricStatus | null;
  @Input() absoluteLatestFormPoint?: DashboardFormPoint | null;
  @Output() editInDashboardManager = new EventEmitter<number>();
  @Output() sleepTrendRangeChange = new EventEmitter<AppDashboardSleepTrendRange>();
  @Output() sleepTrendNavigate = new EventEmitter<DashboardSleepTrendNavigationDirection>();
  @Output() eventFilterRangeChange = new EventEmitter<AppDashboardTileEventFilterRange>();
  @Output() eventFilterActivityTypesChange = new EventEmitter<ActivityTypes[]>();
  @Output() eventFilterNavigate = new EventEmitter<DashboardTileEventNavigationDirection>();

  public chartTypes = ChartTypes;
  public recoveryNowChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;
  public formChartType = DASHBOARD_FORM_CHART_TYPE;
  public acwrKpiChartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
  public rampRateKpiChartType = DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
  public monotonyStrainKpiChartType = DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
  public formNowKpiChartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
  public formPlus7dKpiChartType = DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE;
  public easyPercentKpiChartType = DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;
  public hardPercentKpiChartType = DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE;
  public efficiencyDelta4wKpiChartType = DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE;
  public freshnessForecastChartType = DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE;
  public intensityDistributionChartType = DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE;
  public efficiencyTrendChartType = DASHBOARD_EFFICIENCY_TREND_CHART_TYPE;
  public sleepTrendChartType = DASHBOARD_SLEEP_TREND_CHART_TYPE;
  public isTileActionSaving = false;

  get chartInfoTooltip(): string | null {
    return resolveDashboardChartInfoTooltip(this.chartType);
  }

  get showEventFilters(): boolean {
    return this.chartType !== undefined && !isDashboardSpecialChartType(this.chartType);
  }

  onTileActionSaving(isSaving: boolean): void {
    this.isTileActionSaving = isSaving === true;
  }

  onEditInDashboardManager(order: number): void {
    this.editInDashboardManager.emit(order);
  }

}
