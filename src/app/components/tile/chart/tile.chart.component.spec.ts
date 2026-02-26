import { Component, Input, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartThemes,
  ChartTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it, beforeEach } from 'vitest';
import { TileChartComponent } from './tile.chart.component';

@Component({
  selector: 'app-columns-chart',
  template: '',
  standalone: false
})
class MockColumnsChartComponent {
  @Input() isLoading = false;
  @Input() data: any;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() type: 'columns' | 'pyramids' = 'columns';
  @Input() vertical = true;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
}

@Component({
  selector: 'app-xy-chart',
  template: '',
  standalone: false
})
class MockXYChartComponent {
  @Input() isLoading = false;
  @Input() data: any;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() vertical = true;
}

describe('TileChartComponent', () => {
  let fixture: ComponentFixture<TileChartComponent>;
  let component: TileChartComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TileChartComponent, MockColumnsChartComponent, MockXYChartComponent],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(TileChartComponent);
    component = fixture.componentInstance;
    component.chartTheme = ChartThemes.Material;
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
});
