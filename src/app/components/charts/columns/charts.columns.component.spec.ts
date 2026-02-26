import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartThemes,
  DataDistance,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsColumnsComponent } from './charts.columns.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

describe('ChartsColumnsComponent', () => {
  let fixture: ComponentFixture<ChartsColumnsComponent>;
  let component: ChartsColumnsComponent;
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
    };

    mockColorService = {
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#16B4EA'),
    };

    await TestBed.configureTestingModule({
      declarations: [ChartsColumnsComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: mockColorService },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsColumnsComponent);
    component = fixture.componentInstance;
    component.chartTheme = ChartThemes.Material;
    component.useAnimations = false;
    component.chartDataType = DataDistance.type;
    component.chartDataValueType = ChartDataValueTypes.Total;
    component.chartDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.vertical = true;
    component.type = 'columns';
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

  it('should initialize ECharts and render vertical columns', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(option.series[0].type).toBe('bar');
    expect(option.xAxis.type).toBe('category');
    expect(option.yAxis.type).toBe('value');
  });

  it('should render horizontal axes when vertical is false', async () => {
    component.vertical = false;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.type).toBe('value');
    expect(option.yAxis.type).toBe('category');
    expect(option.yAxis.inverse).toBe(true);
  });

  it('should render pictorial bars for pyramids in vertical mode', async () => {
    component.type = 'pyramids';
    component.vertical = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.series[0].type).toBe('pictorialBar');
    expect(option.series[0].symbol).toBe('path://M50,0 L100,100 L0,100 Z');
  });

  it('should include dashed regression line for date category in vertical mode', async () => {
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

  it('should fill missing daily date buckets with zero-valued bars', async () => {
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
    expect(option.series[0].data).toEqual([10, 0, 30]);
  });

  it('should pad a single daily point with adjacent zero buckets and skip trend line', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 2), [ChartDataValueTypes.Total]: 10, count: 1 }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.series[0].data).toEqual([0, 10, 0]);
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeUndefined();
  });

  it('should build stacked date activity series with proportional splits and no labels', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [`${primaryAlias}-Count`]: 1,
        [secondaryAlias]: 20,
        [`${secondaryAlias}-Count`]: 1,
      },
      {
        time: Date.UTC(2024, 0, 2),
        [ChartDataValueTypes.Total]: 50,
        count: 1,
        [primaryAlias]: 10,
        [secondaryAlias]: 40,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const dataSeries = option.series.filter((seriesEntry: { name?: string }) => seriesEntry.name !== 'Trend');
    expect(dataSeries.length).toBeGreaterThanOrEqual(2);
    expect(dataSeries.every((seriesEntry: { type?: string; stack?: string; label?: { show?: boolean } }) => (
      seriesEntry.type === 'bar'
      && seriesEntry.stack === 'date-activity-stack'
      && seriesEntry.label?.show === false
    ))).toBe(true);
    expect(option.tooltip.trigger).toBe('axis');
  });

  it('should render segmented custom pyramids for date category', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.type = 'pyramids';
    component.vertical = true;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [secondaryAlias]: 20,
      },
      {
        time: Date.UTC(2024, 0, 2),
        [ChartDataValueTypes.Total]: 50,
        count: 1,
        [primaryAlias]: 10,
        [secondaryAlias]: 40,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const dataSeries = option.series.filter((seriesEntry: { name?: string }) => seriesEntry.name !== 'Trend');
    expect(dataSeries.length).toBeGreaterThanOrEqual(2);
    expect(dataSeries.every((seriesEntry: { type?: string; renderItem?: unknown }) => (
      seriesEntry.type === 'custom' && typeof seriesEntry.renderItem === 'function'
    ))).toBe(true);
  });

  it('should render stacked date series in horizontal mode', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.vertical = false;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [secondaryAlias]: 20,
      },
      {
        time: Date.UTC(2024, 0, 2),
        [ChartDataValueTypes.Total]: 50,
        count: 1,
        [primaryAlias]: 10,
        [secondaryAlias]: 40,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.type).toBe('value');
    expect(option.yAxis.type).toBe('category');
    const trendSeries = option.series.find((seriesEntry: { name?: string }) => seriesEntry.name === 'Trend');
    expect(trendSeries).toBeUndefined();
    const dataSeries = option.series.filter((seriesEntry: { name?: string }) => seriesEntry.name !== 'Trend');
    expect(dataSeries.every((seriesEntry: { type?: string; stack?: string }) => (
      seriesEntry.type === 'bar' && seriesEntry.stack === 'date-activity-stack'
    ))).toBe(true);
  });

  it('should format segmented date tooltip with per-activity percentages', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [`${primaryAlias}-Count`]: 1,
        [secondaryAlias]: 20,
        [`${secondaryAlias}-Count`]: 1,
      }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: Array<{ dataIndex: number }>) => string;
    const tooltipText = formatter([{ dataIndex: 1 }]);

    expect(tooltipText).toContain('100');
    expect(tooltipText).toContain('%');
    expect(tooltipText).toContain(primaryAlias);
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

  it('should resolve activity colors via AppEventColorService', async () => {
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

    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith(normalizedActivityType);
  });

  it('should apply dark styles when chart theme is dark', async () => {
    component.chartTheme = ChartThemes.Dark;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.tooltip.backgroundColor).toBe('#303030');
    expect(option.textStyle.color).toBe('#f5f5f5');
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
