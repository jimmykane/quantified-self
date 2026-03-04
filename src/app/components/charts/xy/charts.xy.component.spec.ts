import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDistance,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsXYComponent } from './charts.xy.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

describe('ChartsXYComponent', () => {
  let fixture: ComponentFixture<ChartsXYComponent>;
  let component: ChartsXYComponent;
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
  };

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
  };

  let mockColorService: {
    getColorForActivityTypeByActivityTypeGroup: ReturnType<typeof vi.fn>;
  };

  const waitForChartStabilization = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    resizeObserverRecords = [];
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    class ResizeObserverMock {
      public observe = vi.fn();
      public disconnect = vi.fn();

      constructor(_: ResizeObserverCallback) {
        resizeObserverRecords.push({
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => { }),
    };

    mockColorService = {
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#16B4EA'),
    };

    await TestBed.configureTestingModule({
      declarations: [ChartsXYComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: mockColorService },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsXYComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;
    component.useAnimations = false;
    component.chartDataType = DataDistance.type;
    component.chartDataValueType = ChartDataValueTypes.Total;
    component.chartDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.vertical = true;
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 30, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 60, count: 1 },
    ];
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      delete (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame;
    }
    document.body.classList.remove('dark-theme');
  });

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  it('should initialize ECharts and render line series', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendToBody).toBe(true);
    expect(option.tooltip.confine).toBe(false);
    expect(option.tooltip.position).toBe(getViewportConstrainedTooltipPosition);
    expect(option.series[0].type).toBe('line');
    expect(option.xAxis.type).toBe('category');
    expect(option.yAxis.type).toBe('value');
  });

  it('should include dashed regression line for date category', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 0, 2), [ChartDataValueTypes.Total]: 20, count: 1 },
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 30, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeDefined();
    expect(trendSeries.lineStyle.type).toBe('dashed');
  });

  it('should render summary meta as "per activity type" for activity categories', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.graphic[0].children[2].style.text).toBe('Total per activity type');
  });

  it('should render summary meta as "per month" for monthly date categories', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 1, 1), [ChartDataValueTypes.Total]: 20, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.graphic[0].children[2].style.text).toBe('Total per month');
  });

  it('should render horizontal axes when vertical is false', async () => {
    component.vertical = false;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.type).toBe('value');
    expect(option.yAxis.type).toBe('category');
    expect(option.yAxis.inverse).toBe(true);
    expect(option.yAxis.boundaryGap).toBe(false);
    expect(Array.isArray(option.series[0].data[0].value)).toBe(false);
  });

  it('should not include trend line in horizontal mode', async () => {
    component.vertical = false;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 0, 2), [ChartDataValueTypes.Total]: 20, count: 1 },
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 30, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeUndefined();
  });

  it('should fill missing daily date buckets with zero values', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 30, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.series[0].data.map((entry: { value: number }) => entry.value)).toEqual([10, 0, 30]);
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeDefined();
    expect(trendSeries.data).toHaveLength(3);
  });

  it('should pad single date point and avoid trend line', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 2), [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.series[0].data.map((entry: { value: number }) => entry.value)).toEqual([0, 10, 0]);
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeUndefined();
  });

  it('should not include a trend line for non-date categories', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeUndefined();
  });

  it('should include label, value, and count in tooltip', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 10, count: 3 }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: { dataIndex: number }) => string;
    const tooltipText = formatter({ dataIndex: 0 });

    expect(tooltipText).toContain('Running');
    expect(tooltipText).toContain('<strong>');
    expect(tooltipText).toContain('Activities');
  });

  it('should resolve activity point colors via AppEventColorService', async () => {
    const activityTypeAlias = Object.keys(ActivityTypes).find((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    )) as string;
    const normalizedActivityType = (ActivityTypes as any)[activityTypeAlias] as ActivityTypes;
    component.data = [
      { type: activityTypeAlias, [ChartDataValueTypes.Total]: 10, count: 1 }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const colorResolver = option.series[0].data[0].itemStyle.color as string;
    expect(colorResolver).toBe('#16B4EA');
    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith(normalizedActivityType);
    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledTimes(1);
  });

  it('should apply dark styles when chart theme is dark', async () => {
    component.darkTheme = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.tooltip.backgroundColor).toBe('rgba(58,62,68,1)');
    expect(option.textStyle.color).toBe('rgba(223,223,225,1)');
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      data: new SimpleChange([], [{ type: 'Running', [ChartDataValueTypes.Total]: 12 }], false)
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should return empty series and axes for empty data', async () => {
    component.data = [];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });

  it('should dispose chart on destroy', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    fixture.destroy();

    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
  });
});
