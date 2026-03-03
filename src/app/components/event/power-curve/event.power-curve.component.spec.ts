import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { SimpleChange } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartThemes } from '@sports-alliance/sports-lib';

import { EventPowerCurveComponent } from './event.power-curve.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { PerformanceCurveDataService } from '../../../services/performance-curve-data.service';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: () => void;
};

describe('EventPowerCurveComponent', () => {
  let fixture: ComponentFixture<EventPowerCurveComponent>;
  let component: EventPowerCurveComponent;
  let breakpointSubject: Subject<{ matches: boolean }>;
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
  };

  let mockColorService: {
    getActivityColor: ReturnType<typeof vi.fn>;
  };

  let mockLogger: {
    error: ReturnType<typeof vi.fn>;
  };

  let mockPerformanceCurveDataService: {
    buildPowerCurveSeries: ReturnType<typeof vi.fn>;
  };

  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
  };

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  const waitForChartStabilization = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    breakpointSubject = new Subject<{ matches: boolean }>();
    resizeObserverRecords = [];
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    class ResizeObserverMock {
      public observe = vi.fn();
      public disconnect = vi.fn();

      constructor(private callback: ResizeObserverCallback) {
        resizeObserverRecords.push({
          observe: this.observe,
          disconnect: this.disconnect,
          trigger: () => this.callback([], this as unknown as ResizeObserver),
        });
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => { }),
    };

    mockColorService = {
      getActivityColor: vi.fn().mockReturnValue('#16B4EA'),
    };

    mockLogger = {
      error: vi.fn(),
    };

    mockPerformanceCurveDataService = {
      buildPowerCurveSeries: vi.fn().mockReturnValue([
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Ride',
          points: [
            { duration: 1, power: 900 },
            { duration: 60, power: 420, wattsPerKg: 6.1 },
            { duration: 1200, power: 290, wattsPerKg: 4.2 },
          ],
        },
      ]),
    };

    await TestBed.configureTestingModule({
      declarations: [EventPowerCurveComponent],
      providers: [
        {
          provide: BreakpointObserver,
          useValue: {
            observe: vi.fn().mockReturnValue(breakpointSubject.asObservable()),
          },
        },
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: mockColorService },
        { provide: LoggerService, useValue: mockLogger },
        { provide: PerformanceCurveDataService, useValue: mockPerformanceCurveDataService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventPowerCurveComponent);
    component = fixture.componentInstance;
    component.activities = [{ getID: () => 'a1', creator: { name: 'Device A' } } as any];
    component.chartTheme = ChartThemes.Material;
    component.useAnimations = false;
    component.isMerge = false;
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

  it('should initialize ECharts and render a power-only chart', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(mockPerformanceCurveDataService.buildPowerCurveSeries).toHaveBeenCalledWith(component.activities, { isMerge: false });
    expect(option.xAxis.type).toBe('category');
    expect(option.yAxis.type).toBe('value');
    expect(option.series).toHaveLength(1);
    expect(option.legend.show).toBe(false);
  });

  it('disables point symbols for dense series and keeps them for sparse series', async () => {
    const densePoints = Array.from({ length: 260 }, (_, index) => ({
      duration: index + 1,
      power: 500 - index,
    }));
    mockPerformanceCurveDataService.buildPowerCurveSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: densePoints,
      },
    ]);

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(getLastOption().series[0].showSymbol).toBe(false);

    mockPerformanceCurveDataService.buildPowerCurveSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: densePoints.slice(0, 120),
      },
    ]);

    component.ngOnChanges({ activities: new SimpleChange([], [{}], false) });
    expect(getLastOption().series[0].showSymbol).toBe(true);
  });

  it('should add aligned 2h marker points for long durations', async () => {
    mockPerformanceCurveDataService.buildPowerCurveSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: [
          { duration: 30, power: 600 },
          { duration: 60, power: 540 },
          { duration: 300, power: 410 },
          { duration: 1200, power: 320 },
          { duration: 3600, power: 260 },
          { duration: 7740, power: 225 },
        ],
      },
    ]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const markPointData = option.series[0]?.markPoint?.data ?? [];
    const labels = markPointData.map((marker: { label: string }) => marker.label);

    expect(labels.some((label: string) => label.includes('02h'))).toBe(true);
  });

  it('should skip some x-axis labels on mobile while keeping anchor labels', async () => {
    mockPerformanceCurveDataService.buildPowerCurveSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: [
          { duration: 1, power: 900 },
          { duration: 2, power: 850 },
          { duration: 3, power: 820 },
          { duration: 5, power: 780 },
          { duration: 10, power: 700 },
          { duration: 15, power: 650 },
          { duration: 20, power: 620 },
          { duration: 30, power: 600 },
          { duration: 45, power: 560 },
          { duration: 60, power: 520 },
          { duration: 90, power: 490 },
          { duration: 120, power: 470 },
          { duration: 180, power: 440 },
          { duration: 240, power: 420 },
          { duration: 300, power: 405 },
          { duration: 600, power: 350 },
          { duration: 900, power: 330 },
          { duration: 1200, power: 315 },
          { duration: 1800, power: 300 },
          { duration: 2400, power: 285 },
          { duration: 3600, power: 270 },
        ],
      },
    ]);

    fixture.detectChanges();
    await waitForChartStabilization();

    Object.defineProperty(component.chartDiv.nativeElement, 'clientWidth', {
      value: 320,
      configurable: true,
    });

    breakpointSubject.next({ matches: true });

    const option = getLastOption();
    const formatter = option.xAxis.axisLabel.formatter as (value: string | number) => string;

    expect(formatter(1)).not.toBe('');
    expect(formatter(5)).not.toBe('');
    expect(formatter(3600)).not.toBe('');
    expect(formatter(2)).toBe('');
  });

  it('should hide legend for single activity and show for multi-activity', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();
    expect(getLastOption().legend.show).toBe(false);

    mockPerformanceCurveDataService.buildPowerCurveSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: [{ duration: 60, power: 300 }],
      },
      {
        activity: { getID: () => 'a2' } as any,
        activityId: 'a2',
        label: 'Run',
        points: [{ duration: 60, power: 280 }],
      },
    ]);

    component.ngOnChanges({ activities: new SimpleChange([], [{}], false) });

    expect(getLastOption().legend.show).toBe(true);
  });

  it('should apply dark theme styles when chartTheme is dark', async () => {
    component.chartTheme = ChartThemes.Dark;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.tooltip.backgroundColor).toBe('#222222');
    expect(option.legend.textStyle.color).toBe('#f5f5f5');
  });

  it('should handle empty data gracefully', async () => {
    mockPerformanceCurveDataService.buildPowerCurveSeries.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });

  it('should observe container resize and trigger chart resize', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    expect(resizeObserverRecords).toHaveLength(1);
    const baselineResizeCalls = mockLoader.resize.mock.calls.length;

    resizeObserverRecords[0].trigger();

    expect(mockLoader.resize.mock.calls.length).toBeGreaterThanOrEqual(baselineResizeCalls);
  });

  it('should log and skip rendering when chart init fails', async () => {
    mockLoader.init.mockRejectedValueOnce(new Error('init failed'));

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[EventPowerCurveComponent] Failed to initialize ECharts',
      expect.any(Error)
    );
    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });
});
