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
  DASHBOARD_FORM_CHART_TYPE,
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

  it('should render a visible drag handle button for desktop drag mode', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/chart/tile.chart.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toContain('button mat-icon-button cdkDragHandle class="drag-handle-indicator"');
    expect(template).toContain('drag_indicator');
  });
});
