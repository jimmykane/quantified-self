import { Component, EventEmitter, Input, NO_ERRORS_SCHEMA, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach } from 'vitest';
import { TileChartComponent } from './tile.chart.component';
import type { DashboardRecoveryNowContext } from '../../../helpers/dashboard-recovery-now.helper';
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
} from '../../../helpers/dashboard-special-chart-types';

@Component({
  selector: 'app-columns-chart',
  template: '',
  standalone: false
})
class MockColumnsChartComponent {
  @Input() isLoading = false;
  @Input() data: any;
  @Input() darkTheme = false;
  @Input() type: 'columns' | 'pyramids' = 'columns';
  @Input() vertical = true;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
}

@Component({
  selector: 'app-tile-chart-actions',
  template: '',
  standalone: false
})
class MockTileChartActionsComponent {
  @Input() user: any;
  @Input() chartType?: any;
  @Input() order?: number;
  @Input() size: any;
  @Input() type: any;
  @Input() chartDataType?: string;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartTimeInterval?: TimeIntervals;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Output() savingChange = new EventEmitter<boolean>();
  @Output() editInDashboardManager = new EventEmitter<number>();
}

@Component({
  selector: 'app-xy-chart',
  template: '',
  standalone: false
})
class MockXYChartComponent {
  @Input() isLoading = false;
  @Input() data: any;
  @Input() darkTheme = false;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() vertical = true;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
}

@Component({
  selector: 'app-pie-chart',
  template: '',
  standalone: false
})
class MockPieChartComponent {
  @Input() isLoading = false;
  @Input() data: any;
  @Input() darkTheme = false;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
  @Input() recoveryNowStatus?: string | null;
  @Input() enableRecoveryNowMode = false;
}

@Component({
  selector: 'app-form-chart',
  template: '',
  standalone: false
})
class MockFormChartComponent {
  @Input() isLoading = false;
  @Input() data: any;
  @Input() darkTheme = false;
  @Input() absoluteLatestPoint: any;
  @Input() formStatus?: string | null;
}

@Component({
  selector: 'app-kpi-chart',
  template: '',
  standalone: false
})
class MockKpiChartComponent {
  @Input() isLoading = false;
  @Input() darkTheme = false;
  @Input() chartType: any;
  @Input() acwr: any;
  @Input() rampRate: any;
  @Input() monotonyStrain: any;
  @Input() formNow: any;
  @Input() formPlus7d: any;
  @Input() easyPercent: any;
  @Input() hardPercent: any;
  @Input() efficiencyDelta4w: any;
  @Input() acwrStatus?: string | null;
  @Input() rampRateStatus?: string | null;
  @Input() monotonyStrainStatus?: string | null;
  @Input() formNowStatus?: string | null;
  @Input() formPlus7dStatus?: string | null;
  @Input() easyPercentStatus?: string | null;
  @Input() hardPercentStatus?: string | null;
  @Input() efficiencyDelta4wStatus?: string | null;
}

@Component({
  selector: 'app-freshness-forecast-chart',
  template: '',
  standalone: false
})
class MockFreshnessForecastChartComponent {
  @Input() isLoading = false;
  @Input() darkTheme = false;
  @Input() forecast: any;
  @Input() status?: string | null;
}

@Component({
  selector: 'app-intensity-distribution-chart',
  template: '',
  standalone: false
})
class MockIntensityDistributionChartComponent {
  @Input() isLoading = false;
  @Input() darkTheme = false;
  @Input() distribution: any;
  @Input() status?: string | null;
}

@Component({
  selector: 'app-efficiency-trend-chart',
  template: '',
  standalone: false
})
class MockEfficiencyTrendChartComponent {
  @Input() isLoading = false;
  @Input() darkTheme = false;
  @Input() trend: any;
  @Input() status?: string | null;
}

describe('TileChartComponent', () => {
  let fixture: ComponentFixture<TileChartComponent>;
  let component: TileChartComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        TileChartComponent,
        MockColumnsChartComponent,
        MockTileChartActionsComponent,
        MockXYChartComponent,
        MockPieChartComponent,
        MockFormChartComponent,
        MockKpiChartComponent,
        MockFreshnessForecastChartComponent,
        MockIntensityDistributionChartComponent,
        MockEfficiencyTrendChartComponent,
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(TileChartComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;
    component.dataValueType = ChartDataValueTypes.Total;
    component.dataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.dataTimeInterval = TimeIntervals.Daily;
    component.dataType = 'distance';
    component.data = [];
    component.isLoading = false;
  });

  const getColumnsComponent = (): MockColumnsChartComponent => {
    const columnsDebugElement = fixture.debugElement.query(By.directive(MockColumnsChartComponent));
    return columnsDebugElement.componentInstance as MockColumnsChartComponent;
  };

  const getXYComponent = (): MockXYChartComponent => {
    const xyDebugElement = fixture.debugElement.query(By.directive(MockXYChartComponent));
    return xyDebugElement.componentInstance as MockXYChartComponent;
  };

  const getActionsComponent = (): MockTileChartActionsComponent => {
    const actionsDebugElement = fixture.debugElement.query(By.directive(MockTileChartActionsComponent));
    return actionsDebugElement.componentInstance as MockTileChartActionsComponent;
  };

  const getPieComponent = (): MockPieChartComponent => {
    const pieDebugElement = fixture.debugElement.query(By.directive(MockPieChartComponent));
    return pieDebugElement.componentInstance as MockPieChartComponent;
  };

  const getFormComponent = (): MockFormChartComponent => {
    const formDebugElement = fixture.debugElement.query(By.directive(MockFormChartComponent));
    return formDebugElement.componentInstance as MockFormChartComponent;
  };

  const getKpiComponent = (): MockKpiChartComponent => {
    const kpiDebugElement = fixture.debugElement.query(By.directive(MockKpiChartComponent));
    return kpiDebugElement.componentInstance as MockKpiChartComponent;
  };

  const getFreshnessForecastComponent = (): MockFreshnessForecastChartComponent => {
    const debugElement = fixture.debugElement.query(By.directive(MockFreshnessForecastChartComponent));
    return debugElement.componentInstance as MockFreshnessForecastChartComponent;
  };

  const getIntensityDistributionComponent = (): MockIntensityDistributionChartComponent => {
    const debugElement = fixture.debugElement.query(By.directive(MockIntensityDistributionChartComponent));
    return debugElement.componentInstance as MockIntensityDistributionChartComponent;
  };

  const getEfficiencyTrendComponent = (): MockEfficiencyTrendChartComponent => {
    const debugElement = fixture.debugElement.query(By.directive(MockEfficiencyTrendChartComponent));
    return debugElement.componentInstance as MockEfficiencyTrendChartComponent;
  };

  it('should set vertical=false for LinesHorizontal', () => {
    component.chartType = ChartTypes.LinesHorizontal;

    fixture.detectChanges();

    const xy = getXYComponent();
    expect(xy.vertical).toBe(false);
  });

  it('should set vertical=true for LinesVertical', () => {
    component.chartType = ChartTypes.LinesVertical;

    fixture.detectChanges();

    const xy = getXYComponent();
    expect(xy.vertical).toBe(true);
  });

  it('should set vertical=false for ColumnsHorizontal', () => {
    component.chartType = ChartTypes.ColumnsHorizontal;

    fixture.detectChanges();

    const columns = getColumnsComponent();
    expect(columns.type).toBe('columns');
    expect(columns.vertical).toBe(false);
  });

  it('should set vertical=true for ColumnsVertical', () => {
    component.chartType = ChartTypes.ColumnsVertical;

    fixture.detectChanges();

    const columns = getColumnsComponent();
    expect(columns.type).toBe('columns');
    expect(columns.vertical).toBe(true);
  });

  it('should set pyramids type and keep vertical=true for PyramidsVertical', () => {
    component.chartType = ChartTypes.PyramidsVertical;

    fixture.detectChanges();

    const columns = getColumnsComponent();
    expect(columns.type).toBe('pyramids');
    expect(columns.vertical).toBe(true);
  });

  it('should pass loading=true to line charts while tile action save is in progress', () => {
    component.chartType = ChartTypes.LinesVertical;
    component.showActions = true;
    component.isLoading = false;

    fixture.detectChanges();

    const actions = getActionsComponent();
    actions.savingChange.emit(true);
    fixture.detectChanges();

    const xy = getXYComponent();
    expect(xy.isLoading).toBe(true);
  });

  it('should pass loading=true to columns while tile action save is in progress', () => {
    component.chartType = ChartTypes.ColumnsVertical;
    component.showActions = true;
    component.isLoading = false;

    fixture.detectChanges();

    const actions = getActionsComponent();
    actions.savingChange.emit(true);
    fixture.detectChanges();

    const columns = getColumnsComponent();
    expect(columns.isLoading).toBe(true);
  });

  it('should re-emit dashboard manager edit requests from tile actions', () => {
    component.chartType = ChartTypes.ColumnsVertical;
    component.showActions = true;
    const emittedOrders: number[] = [];
    component.editInDashboardManager.subscribe((order) => emittedOrders.push(order));

    fixture.detectChanges();

    const actions = getActionsComponent();
    actions.editInDashboardManager.emit(4);

    expect(emittedOrders).toEqual([4]);
  });

  it('should keep generic pie renderer in non-curated mode', () => {
    const recoveryNow = { totalSeconds: 4800, endTimeMs: Date.UTC(2024, 0, 3, 10, 0, 0) };
    component.chartType = ChartTypes.Pie;
    component.recoveryNow = recoveryNow as any;

    fixture.detectChanges();

    const pie = getPieComponent();
    expect(pie.enableRecoveryNowMode).toBe(false);
    expect(pie.recoveryNow).toBeUndefined();
  });

  it('should render curated recovery chart type using pie renderer', () => {
    const recoveryNow = { totalSeconds: 3600, endTimeMs: Date.UTC(2024, 0, 1, 12, 0, 0) };
    component.chartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE as any;
    component.recoveryNow = recoveryNow as any;
    component.recoveryNowStatus = 'stale' as any;

    fixture.detectChanges();

    const pie = getPieComponent();
    expect(pie).toBeTruthy();
    expect(pie.enableRecoveryNowMode).toBe(true);
    expect(pie.recoveryNow).toEqual(recoveryNow);
    expect(pie.recoveryNowStatus).toBe('stale');
  });

  it('should render form chart type using form renderer', () => {
    component.chartType = DASHBOARD_FORM_CHART_TYPE as any;
    component.formStatus = 'stale' as any;
    component.absoluteLatestFormPoint = {
      time: Date.UTC(2024, 0, 5),
      trainingStressScore: 12,
      ctl: 10,
      atl: 12,
      formSameDay: -2,
      formPriorDay: -3,
    } as any;

    fixture.detectChanges();

    const form = getFormComponent();
    expect(form).toBeTruthy();
    expect(form.data).toBe(component.data);
    expect(form.formStatus).toBe('stale');
    expect(form.absoluteLatestPoint).toEqual(component.absoluteLatestFormPoint);
  });

  it('should route ACWR KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE as any;
    component.acwr = { ratio: 1.1 } as any;
    component.acwrStatus = 'ready' as any;

    fixture.detectChanges();

    const kpi = getKpiComponent();
    expect(kpi.chartType).toBe(DASHBOARD_ACWR_KPI_CHART_TYPE);
    expect(kpi.acwr).toEqual(component.acwr);
  });

  it('should route Ramp Rate KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_RAMP_RATE_KPI_CHART_TYPE as any;
    component.rampRate = { rampRate: 3 } as any;
    component.rampRateStatus = 'stale' as any;
    fixture.detectChanges();

    expect(getKpiComponent().chartType).toBe(DASHBOARD_RAMP_RATE_KPI_CHART_TYPE);
  });

  it('should route Monotony/Strain KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE as any;
    component.monotonyStrain = { strain: 500 } as any;
    fixture.detectChanges();

    expect(getKpiComponent().chartType).toBe(DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE);
  });

  it('should route Form Now KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE as any;
    component.formNow = { value: -3.2 } as any;
    component.formNowStatus = 'processing' as any;
    fixture.detectChanges();

    const kpi = getKpiComponent();
    expect(kpi.chartType).toBe(DASHBOARD_FORM_NOW_KPI_CHART_TYPE);
    expect(kpi.formNow).toEqual(component.formNow);
    expect(kpi.formNowStatus).toBe('processing');
  });

  it('should route Efficiency Δ (4w) KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE as any;
    component.efficiencyDelta4w = { deltaAbs: 0.12, deltaPct: 6 } as any;
    component.efficiencyDelta4wStatus = 'queued' as any;
    fixture.detectChanges();

    expect(getKpiComponent().chartType).toBe(DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE);
  });

  it('should route Easy % KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE as any;
    component.easyPercent = { value: 67 } as any;
    component.easyPercentStatus = 'ready' as any;
    fixture.detectChanges();
    expect(getKpiComponent().chartType).toBe(DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE);
  });

  it('should route Hard % KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE as any;
    component.hardPercent = { value: 12 } as any;
    component.hardPercentStatus = 'ready' as any;
    fixture.detectChanges();
    expect(getKpiComponent().chartType).toBe(DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE);
  });

  it('should route Form +7d KPI chart type to the KPI renderer', () => {
    component.chartType = DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE as any;
    component.formPlus7d = { value: 4.1 } as any;
    component.formPlus7dStatus = 'ready' as any;
    fixture.detectChanges();
    expect(getKpiComponent().chartType).toBe(DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE);
  });

  it('should route freshness forecast chart type to dedicated renderer', () => {
    component.chartType = DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE as any;
    component.freshnessForecast = { points: [] } as any;
    component.freshnessForecastStatus = 'queued' as any;
    fixture.detectChanges();
    expect(getFreshnessForecastComponent().forecast).toEqual(component.freshnessForecast);
  });

  it('should route intensity distribution chart type to dedicated renderer', () => {
    component.chartType = DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as any;
    component.intensityDistribution = { weeks: [] } as any;
    component.intensityDistributionStatus = 'processing' as any;
    fixture.detectChanges();
    expect(getIntensityDistributionComponent().distribution).toEqual(component.intensityDistribution);
  });

  it('should route efficiency trend chart type to dedicated renderer', () => {
    component.chartType = DASHBOARD_EFFICIENCY_TREND_CHART_TYPE as any;
    component.efficiencyTrend = { points: [] } as any;
    component.efficiencyTrendStatus = 'failed' as any;
    fixture.detectChanges();
    expect(getEfficiencyTrendComponent().trend).toEqual(component.efficiencyTrend);
  });

  it('should render a visible drag handle button for desktop drag mode', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/chart/tile.chart.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toContain('button mat-icon-button cdkDragHandle class="drag-handle-indicator"');
    expect(template).toContain('drag_indicator');
  });
});
