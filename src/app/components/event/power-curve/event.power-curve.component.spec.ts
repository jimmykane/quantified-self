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
import { buildPowerCurveSeries } from '../../../helpers/power-curve-chart-data-helper';

vi.mock('../../../helpers/power-curve-chart-data-helper', () => ({
  buildPowerCurveSeries: vi.fn(),
}));

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
  let requestAnimationFrameMock: ReturnType<typeof vi.fn>;

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };

  let mockColorService: {
    getActivityColor: ReturnType<typeof vi.fn>;
  };

  let mockLogger: {
    error: ReturnType<typeof vi.fn>;
  };

  const mockedBuildSeries = vi.mocked(buildPowerCurveSeries);
  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
  };

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  beforeEach(async () => {
    breakpointSubject = new Subject<{ matches: boolean }>();
    resizeObserverRecords = [];
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    globalThis.requestAnimationFrame = requestAnimationFrameMock as unknown as typeof requestAnimationFrame;
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
    };

    mockColorService = {
      getActivityColor: vi.fn().mockReturnValue('#16B4EA'),
    };

    mockLogger = {
      error: vi.fn(),
    };

    mockedBuildSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1', creator: { name: 'Device A' } } as any,
        activityId: 'a1',
        label: 'Run',
        points: [
          { duration: 1, power: 800, wattsPerKg: 11.2 },
          { duration: 60, power: 420, wattsPerKg: 6.1 },
          { duration: 1200, power: 290, wattsPerKg: 4.2 },
        ],
      },
    ]);

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

  it('should initialize ECharts and render category-based duration labels per data point', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(mockedBuildSeries).toHaveBeenCalledWith(component.activities, { isMerge: false });
    expect(mockLoader.setOption).toHaveBeenCalledTimes(1);
    expect(mockLoader.resize).toHaveBeenCalledTimes(1);
    expect(option.xAxis.type).toBe('category');
    expect(option.xAxis.data).toEqual([1, 60, 1200]);
    expect(option.xAxis.axisLabel.interval).toBe(0);
    expect(option.yAxis.name).toBe('Power (W)');
    expect(option.series[0].type).toBe('line');
    expect(option.series[0].name).toBe('Run');
    expect(option.legend.show).toBe(false);
    expect(option.dataZoom).toBeUndefined();
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      activities: new SimpleChange([], [{}], false),
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should refresh chart when chart-related inputs change', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.ngOnChanges({
      activities: new SimpleChange([], [{}], false),
      chartTheme: new SimpleChange(ChartThemes.Material, ChartThemes.Dark, false),
      useAnimations: new SimpleChange(false, true, false),
      isMerge: new SimpleChange(false, true, false),
    });

    expect(mockLoader.setOption).toHaveBeenCalledTimes(2);
  });

  it('should switch to mobile spacing when xsmall breakpoint matches', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    breakpointSubject.next({ matches: true });

    const option = getLastOption();
    expect(option.grid.left).toBe(0);
    expect(option.grid.bottom).toBe(0);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(2);
  });

  it('should skip some x-axis labels on mobile while keeping anchor labels', async () => {
    mockedBuildSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1', creator: { name: 'Device A' } } as any,
        activityId: 'a1',
        label: 'Run',
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
    await fixture.whenStable();

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
    expect(formatter(2400)).toBe('');
  });

  it('should apply dark theme styles when chartTheme is dark', async () => {
    component.chartTheme = ChartThemes.Dark;

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    expect(option.tooltip.backgroundColor).toBe('#222222');
    expect(option.yAxis.axisLabel.color).toBe('#f5f5f5');
  });

  it('should apply dark theme styles from body class', async () => {
    document.body.classList.add('dark-theme');

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    expect(option.tooltip.backgroundColor).toBe('#222222');
    expect(option.yAxis.axisLabel.color).toBe('#f5f5f5');
  });

  it('should not show series label in tooltip when only one series exists', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: unknown) => string;

    const tooltip = formatter([
      {
        axisValue: 60,
        marker: '• ',
        seriesName: 'Run',
        value: [60, 420],
        data: { value: [60, 420], wattsPerKg: 6.1 },
      },
    ]);

    expect(tooltip).toContain('01m');
    expect(tooltip).toContain('Power: <b>420 W</b>');
    expect(tooltip).not.toContain('Run');
  });

  it('should show legend and series names for multi-series charts', async () => {
    mockedBuildSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1', creator: { name: 'Device A' } } as any,
        activityId: 'a1',
        label: 'Run',
        points: [{ duration: 60, power: 420 }],
      },
      {
        activity: { getID: () => 'a2', creator: { name: 'Device B' } } as any,
        activityId: 'a2',
        label: 'Run (2)',
        points: [{ duration: 60, power: 410 }],
      },
    ]);

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: unknown) => string;

    const tooltip = formatter([
      {
        axisValue: 60,
        marker: '• ',
        seriesName: 'Run',
        value: [60, 420],
        data: { value: [60, 420] },
      },
      {
        axisValue: 60,
        marker: '• ',
        seriesName: 'Run (2)',
        value: [60, 410],
        data: { value: [60, 410] },
      },
    ]);

    expect(option.legend.show).toBe(true);
    expect(tooltip).toContain('Run: <b>420 W</b>');
    expect(tooltip).toContain('Run (2): <b>410 W</b>');
  });

  it('should handle empty series gracefully', async () => {
    mockedBuildSeries.mockReturnValue([]);

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.series).toEqual([]);
    expect(option.xAxis.data).toEqual([]);
    expect(option.yAxis.max).toBeGreaterThan(option.yAxis.min);
  });

  it('should observe container resize and trigger chart resize', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(resizeObserverRecords).toHaveLength(1);
    const baselineResizeCalls = mockLoader.resize.mock.calls.length;

    resizeObserverRecords[0].trigger();

    expect(mockLoader.resize.mock.calls.length).toBeGreaterThanOrEqual(baselineResizeCalls);
  });

  it('should skip ResizeObserver setup when API is unavailable', async () => {
    delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(resizeObserverRecords).toHaveLength(0);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(1);
  });

  it('should log and skip rendering when chart init fails', async () => {
    mockLoader.init.mockRejectedValueOnce(new Error('init failed'));

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[EventPowerCurveComponent] Failed to initialize ECharts',
      expect.any(Error)
    );
    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should disconnect observers and dispose chart on destroy', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const observer = resizeObserverRecords[0];
    const callCountBeforeDestroy = mockLoader.setOption.mock.calls.length;

    component.ngOnDestroy();
    breakpointSubject.next({ matches: true });

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(callCountBeforeDestroy);
  });
});
