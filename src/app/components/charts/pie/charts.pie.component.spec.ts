import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartThemes,
  DataDistance,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsPieComponent } from './charts.pie.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

describe('ChartsPieComponent', () => {
  let fixture: ComponentFixture<ChartsPieComponent>;
  let component: ChartsPieComponent;
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

    await TestBed.configureTestingModule({
      declarations: [ChartsPieComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        {
          provide: AppEventColorService,
          useValue: {
            getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#16B4EA')
          }
        },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsPieComponent);
    component = fixture.componentInstance;
    component.chartTheme = ChartThemes.Material;
    component.useAnimations = false;
    component.chartDataType = DataDistance.type;
    component.chartDataValueType = ChartDataValueTypes.Total;
    component.chartDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
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

  it('should initialize ECharts and render pie option', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 60, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 40, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(option.series[0].type).toBe('pie');
    expect(option.series[0].data).toHaveLength(2);
  });

  it('should keep activity-type slices ungrouped', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 90, count: 5 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 5, count: 1 },
      { type: 'Swimming', [ChartDataValueTypes.Total]: 5, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const names = option.series[0].data.map((entry: { name: string }) => entry.name);

    expect(names).toContain('Running');
    expect(names).toContain('Cycling');
    expect(names).toContain('Swimming');
    expect(names).not.toContain('Other');
    expect(option.series[0].data).toHaveLength(3);
  });

  it('should render center sub label as "per activity type" for activity categories', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 60, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 40, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.graphic[0].children[2].style.text).toBe('Total per activity type');
  });

  it('should not group date-type slices', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { type: 1704067200000, time: 1704067200000, [ChartDataValueTypes.Total]: 90, count: 5 },
      { type: 1704153600000, time: 1704153600000, [ChartDataValueTypes.Total]: 5, count: 1 },
      { type: 1704240000000, time: 1704240000000, [ChartDataValueTypes.Total]: 5, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const names = option.series[0].data.map((entry: { name: string }) => entry.name);

    expect(option.series[0].data).toHaveLength(3);
    expect(names).not.toContain('Other');
  });

  it('should render center sub label as "per month" for monthly date categories', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.data = [
      { type: Date.UTC(2024, 0, 1), time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 90, count: 5 },
      { type: Date.UTC(2024, 1, 1), time: Date.UTC(2024, 1, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.graphic[0].children[2].style.text).toBe('Total per month');
  });

  it('should use dark tooltip styles for dark chart theme', async () => {
    component.chartTheme = ChartThemes.Dark;
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.tooltip.backgroundColor).toBe('#303030');
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      data: new SimpleChange([], [{ type: 'Running', [ChartDataValueTypes.Total]: 12 }], false)
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should dispose chart on destroy', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.destroy();

    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
  });
});
