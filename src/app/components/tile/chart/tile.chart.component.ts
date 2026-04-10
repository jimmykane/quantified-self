import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TimeIntervals
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import type { DashboardFormPoint } from '../../../helpers/dashboard-form.helper';
import type { DashboardRecoveryNowContext } from '../../../helpers/dashboard-recovery-now.helper';
import type {
  DashboardAcwrContext,
  DashboardEfficiencyTrendContext,
  DashboardFreshnessForecastContext,
  DashboardIntensityDistributionContext,
  DashboardMonotonyStrainContext,
  DashboardRampRateContext,
} from '../../../helpers/dashboard-derived-metrics.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  type DashboardChartType,
} from '../../../helpers/dashboard-special-chart-types';
import type { DerivedMetricSnapshotStatus } from '@shared/derived-metrics';
import type { DashboardDerivedMetricStatus } from '../../../helpers/derived-metric-status.helper';

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
  @Input() dataTimeInterval: TimeIntervals;
  @Input() data: any;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
  @Input() recoveryNowStatus?: DashboardRecoveryNowSnapshotStatus | null;
  @Input() formStatus?: DashboardDerivedMetricStatus | null;
  @Input() acwr?: DashboardAcwrContext | null;
  @Input() rampRate?: DashboardRampRateContext | null;
  @Input() monotonyStrain?: DashboardMonotonyStrainContext | null;
  @Input() freshnessForecast?: DashboardFreshnessForecastContext | null;
  @Input() intensityDistribution?: DashboardIntensityDistributionContext | null;
  @Input() efficiencyTrend?: DashboardEfficiencyTrendContext | null;
  @Input() acwrStatus?: DashboardDerivedMetricStatus | null;
  @Input() rampRateStatus?: DashboardDerivedMetricStatus | null;
  @Input() monotonyStrainStatus?: DashboardDerivedMetricStatus | null;
  @Input() freshnessForecastStatus?: DashboardDerivedMetricStatus | null;
  @Input() intensityDistributionStatus?: DashboardDerivedMetricStatus | null;
  @Input() efficiencyTrendStatus?: DashboardDerivedMetricStatus | null;
  @Input() absoluteLatestFormPoint?: DashboardFormPoint | null;
  @Output() editInDashboardManager = new EventEmitter<number>();

  public chartTypes = ChartTypes;
  public recoveryNowChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;
  public formChartType = DASHBOARD_FORM_CHART_TYPE;
  public acwrKpiChartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
  public rampRateKpiChartType = DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
  public monotonyStrainKpiChartType = DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
  public freshnessForecastChartType = DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE;
  public intensityDistributionChartType = DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE;
  public efficiencyTrendChartType = DASHBOARD_EFFICIENCY_TREND_CHART_TYPE;
  public isTileActionSaving = false;

  onTileActionSaving(isSaving: boolean): void {
    this.isTileActionSaving = isSaving === true;
  }

  onEditInDashboardManager(order: number): void {
    this.editInDashboardManager.emit(order);
  }

}
