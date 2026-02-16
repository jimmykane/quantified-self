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
import {
  buildBestEffortMarkers,
  buildCadencePowerPaneSeries,
  buildDecouplingPaneSeries,
  buildPowerCurvePaneSeries,
} from '../../../helpers/performance-curve-chart-data-helper';

vi.mock('../../../helpers/performance-curve-chart-data-helper', () => ({
  buildPowerCurvePaneSeries: vi.fn(),
  buildDecouplingPaneSeries: vi.fn(),
  buildCadencePowerPaneSeries: vi.fn(),
  buildBestEffortMarkers: vi.fn(),
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

  const mockedBuildPowerCurvePaneSeries = vi.mocked(buildPowerCurvePaneSeries);
  const mockedBuildDecouplingPaneSeries = vi.mocked(buildDecouplingPaneSeries);
  const mockedBuildCadencePowerPaneSeries = vi.mocked(buildCadencePowerPaneSeries);
  const mockedBuildBestEffortMarkers = vi.mocked(buildBestEffortMarkers);

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
    };

    mockColorService = {
      getActivityColor: vi.fn().mockReturnValue('#16B4EA'),
    };

    mockLogger = {
      error: vi.fn(),
    };

    mockedBuildPowerCurvePaneSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Run',
        points: [
          { duration: 1, power: 800, wattsPerKg: 11.2 },
          { duration: 60, power: 420, wattsPerKg: 6.1 },
          { duration: 1200, power: 290, wattsPerKg: 4.2 },
        ],
      },
    ]);
    mockedBuildDecouplingPaneSeries.mockReturnValue([]);
    mockedBuildCadencePowerPaneSeries.mockReturnValue([]);
    mockedBuildBestEffortMarkers.mockReturnValue([]);

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

  it('should initialize ECharts and render a power-only pane when only power curve data exists', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(mockedBuildPowerCurvePaneSeries).toHaveBeenCalledWith(component.activities, { isMerge: false });
    expect(mockedBuildDecouplingPaneSeries).toHaveBeenCalled();
    expect(mockedBuildCadencePowerPaneSeries).toHaveBeenCalled();
    expect(option.xAxis).toHaveLength(1);
    expect(option.yAxis).toHaveLength(1);
    expect(option.series).toHaveLength(1);
    expect(option.xAxis[0].type).toBe('category');
    expect(option.legend.show).toBe(false);
  });

  it('should add aligned 2h+ mark points for long power-curve durations', async () => {
    mockedBuildPowerCurvePaneSeries.mockReturnValue([
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
    await fixture.whenStable();

    const option = getLastOption();
    const markPointData = option.series[0]?.markPoint?.data ?? [];
    const labels = markPointData.map((marker: { label: string }) => marker.label);
    const durations = markPointData.map((marker: { coord: [number, number] }) => marker.coord[0]);

    expect(labels.some((label: string) => label.includes('02h'))).toBe(true);
    expect(durations).toContain(7740);
  });

  it('should render three panes when decoupling and cadence-power data are available', async () => {
    mockedBuildDecouplingPaneSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Run',
        points: [
          { duration: 30, efficiency: 2.6, power: 350, heartRate: 135, rawPower: 360, rawHeartRate: 136 },
          { duration: 60, efficiency: 2.5, power: 340, heartRate: 136, rawPower: 345, rawHeartRate: 137 },
        ],
      },
    ]);
    mockedBuildCadencePowerPaneSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Run',
        points: [
          { duration: 60, cadence: 92, power: 340, density: 0.9 },
          { duration: 61, cadence: 93, power: 338, density: 0.8 },
        ],
      },
    ]);
    mockedBuildBestEffortMarkers.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        activityLabel: 'Run',
        windowSeconds: 5,
        windowLabel: '5s',
        duration: 60,
        efficiency: 2.5,
        power: 500,
        startDuration: 58,
        endDuration: 62,
      },
    ]);

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.xAxis).toHaveLength(3);
    expect(option.yAxis).toHaveLength(3);
    expect(option.series.length).toBeGreaterThanOrEqual(4);
    expect(option.visualMap).toBeDefined();
    expect(option.legend.show).toBe(true);
    expect(option.legend.data).toEqual(['5s']);
    expect(option.graphic.length).toBe(3);
    expect(option.graphic[0].children[0].style.text).toBe('Power Curve');
    expect(option.graphic[1].children[0].style.text).toBe('Durability');
    expect(option.graphic[2].children[0].style.text).toBe('Cadence vs Power');

    const cadenceScatter = option.series.find((entry: { id?: string }) => `${entry.id ?? ''}`.startsWith('cadence:'));
    const colorFormatter = cadenceScatter.itemStyle.color as (params: { value?: unknown[] }) => string;
    expect(colorFormatter({ value: [90, 300, 0.2] })).not.toBe(colorFormatter({ value: [90, 300, 0.9] }));
  });

  it('should collapse missing panes and keep remaining panes visible', async () => {
    mockedBuildPowerCurvePaneSeries.mockReturnValue([]);
    mockedBuildDecouplingPaneSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Run',
        points: [
          { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
          { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
        ],
      },
    ]);

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.xAxis).toHaveLength(1);
    expect(option.yAxis).toHaveLength(1);
    expect(option.series).toHaveLength(1);
    expect(option.xAxis[0].type).toBe('value');
  });

  it('should skip some x-axis labels on mobile while keeping anchor labels for power pane', async () => {
    mockedBuildPowerCurvePaneSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
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
    const formatter = option.xAxis[0].axisLabel.formatter as (value: string | number) => string;

    expect(formatter(1)).not.toBe('');
    expect(formatter(5)).not.toBe('');
    expect(formatter(3600)).not.toBe('');
    expect(formatter(2)).toBe('');
  });

  it('should apply dark theme styles when chartTheme is dark', async () => {
    component.chartTheme = ChartThemes.Dark;

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.tooltip.backgroundColor).toBe('#222222');
    expect(option.legend.textStyle.color).toBe('#f5f5f5');
  });

  it('should apply dark theme styles when body has dark-theme class', async () => {
    document.body.classList.add('dark-theme');

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.tooltip.backgroundColor).toBe('#222222');
  });

  it('should format single-activity power tooltip without series label', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: unknown) => string;

    const tooltip = formatter({
      seriesId: 'power:a1',
      seriesName: 'Run',
      data: { duration: 60, value: 420, wattsPerKg: 6.1 },
      value: 420,
    });

    expect(tooltip).toContain('01m');
    expect(tooltip).toContain('Power: <b>420 W</b>');
    expect(tooltip).not.toContain('Run:');
  });

  it('should handle empty data gracefully', async () => {
    mockedBuildPowerCurvePaneSeries.mockReturnValue([]);
    mockedBuildDecouplingPaneSeries.mockReturnValue([]);
    mockedBuildCadencePowerPaneSeries.mockReturnValue([]);
    mockedBuildBestEffortMarkers.mockReturnValue([]);

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
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
