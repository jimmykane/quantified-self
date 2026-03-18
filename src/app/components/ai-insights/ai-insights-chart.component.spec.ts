import { CommonModule } from '@angular/common';
import { Component, ComponentRef, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import type { AiInsightsOkResponse } from '@shared/ai-insights.types';
import { AiInsightsChartComponent } from './ai-insights-chart.component';

@Component({
  selector: 'app-xy-chart',
  standalone: true,
  template: '',
})
class MockXYChartComponent {
  @Input() data: unknown;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() vertical = true;
  @Input() userUnitSettings?: UserUnitSettingsInterface | null;
}

@Component({
  selector: 'app-columns-chart',
  standalone: true,
  template: '',
})
class MockColumnsChartComponent {
  @Input() data: unknown;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() vertical = true;
  @Input() type: 'columns' | 'pyramids' = 'columns';
  @Input() userUnitSettings?: UserUnitSettingsInterface | null;
}

@Component({
  selector: 'app-pie-chart',
  standalone: true,
  template: '',
})
class MockPieChartComponent {
  @Input() data: unknown;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() userUnitSettings?: UserUnitSettingsInterface | null;
}

function buildResponse(chartType: ChartTypes, categoryType = ChartDataCategoryTypes.DateType): AiInsightsOkResponse {
  return {
    status: 'ok',
    narrative: 'Insight narrative',
    query: {
      dataType: 'DataCadenceAvg',
      valueType: ChartDataValueTypes.Average,
      categoryType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        startDate: '2025-12-01',
        endDate: '2026-03-01',
        timezone: 'Europe/Helsinki',
      },
      chartType,
    },
    aggregation: {
      dataType: 'DataCadenceAvg',
      valueType: ChartDataValueTypes.Average,
      categoryType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        {
          bucketKey: categoryType === ChartDataCategoryTypes.DateType ? '2026-01' : ActivityTypes.Cycling,
          time: categoryType === ChartDataCategoryTypes.DateType ? Date.UTC(2026, 0, 1) : undefined,
          totalCount: 3,
          aggregateValue: 84.5,
          seriesValues: { Cycling: 84.5 },
          seriesCounts: { Cycling: 3 },
        },
      ],
    },
    summary: {
      matchedEventCount: 3,
      overallAggregateValue: 84.5,
      peakBucket: {
        bucketKey: categoryType === ChartDataCategoryTypes.DateType ? '2026-01' : ActivityTypes.Cycling,
        time: categoryType === ChartDataCategoryTypes.DateType ? Date.UTC(2026, 0, 1) : undefined,
        aggregateValue: 84.5,
        totalCount: 3,
      },
      latestBucket: {
        bucketKey: categoryType === ChartDataCategoryTypes.DateType ? '2026-01' : ActivityTypes.Cycling,
        time: categoryType === ChartDataCategoryTypes.DateType ? Date.UTC(2026, 0, 1) : undefined,
        aggregateValue: 84.5,
        totalCount: 3,
      },
    },
    presentation: {
      title: 'Average cadence over time for Cycling',
      chartType,
    },
  };
}

describe('AiInsightsChartComponent', () => {
  let fixture: ComponentFixture<AiInsightsChartComponent>;
  let componentRef: ComponentRef<AiInsightsChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiInsightsChartComponent],
    })
      .overrideComponent(AiInsightsChartComponent, {
        set: {
          imports: [
            CommonModule,
            MockXYChartComponent,
            MockColumnsChartComponent,
            MockPieChartComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AiInsightsChartComponent);
    componentRef = fixture.componentRef;
  });

  it('should render the xy chart for line insights and pass resolved chart inputs', () => {
    componentRef.setInput('response', buildResponse(ChartTypes.LinesVertical));
    componentRef.setInput('darkTheme', true);
    componentRef.setInput('useAnimations', true);
    componentRef.setInput('userUnitSettings', { paceUnits: ['Pace'] } as UserUnitSettingsInterface);
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(MockXYChartComponent));
    expect(chart).toBeTruthy();
    expect(chart.componentInstance.vertical).toBe(true);
    expect(chart.componentInstance.darkTheme).toBe(true);
    expect(chart.componentInstance.useAnimations).toBe(true);
    expect(chart.componentInstance.userUnitSettings).toEqual({ paceUnits: ['Pace'] });
    expect(chart.componentInstance.chartDataTimeInterval).toBe(TimeIntervals.Monthly);
    expect(chart.componentInstance.data).toEqual([
      {
        time: Date.UTC(2026, 0, 1),
        type: '2026-01',
        count: 3,
        Average: 84.5,
        Cycling: 84.5,
        'Cycling-Count': 3,
      },
    ]);
  });

  it('should render the columns chart for activity comparisons', () => {
    componentRef.setInput(
      'response',
      buildResponse(ChartTypes.ColumnsHorizontal, ChartDataCategoryTypes.ActivityType),
    );
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(MockColumnsChartComponent));
    expect(chart).toBeTruthy();
    expect(chart.componentInstance.vertical).toBe(false);
    expect(chart.componentInstance.type).toBe('columns');
    expect(chart.componentInstance.chartDataCategoryType).toBe(ChartDataCategoryTypes.ActivityType);
  });
});
