import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartThemes } from '@sports-alliance/sports-lib';

import { EventDurabilityCurveComponent } from './event.durability-curve.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { PerformanceCurveDataService } from '../../../services/performance-curve-data.service';

describe('EventDurabilityCurveComponent', () => {
  let fixture: ComponentFixture<EventDurabilityCurveComponent>;
  let component: EventDurabilityCurveComponent;
  let breakpointSubject: Subject<{ matches: boolean }>;

  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };

  let mockService: {
    buildDurabilitySeriesWithMarkerSource: ReturnType<typeof vi.fn>;
    buildBestEffortMarkers: ReturnType<typeof vi.fn>;
  };

  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
  };

  const getLastOption = (): Record<string, any> => mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;

  const waitForChartStabilization = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    breakpointSubject = new Subject<{ matches: boolean }>();

    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;

    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;

    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(_: ResizeObserverCallback) { }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };

    mockService = {
      buildDurabilitySeriesWithMarkerSource: vi.fn().mockReturnValue({
        renderSeries: [
          {
            activity: { getID: () => 'a1' } as any,
            activityId: 'a1',
            label: 'Ride',
            points: [
              { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
              { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
            ],
          },
        ],
        markerSourceSeries: [
          {
            activity: { getID: () => 'a1' } as any,
            activityId: 'a1',
            label: 'Ride',
            points: [
              { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
              { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
            ],
          },
        ],
      }),
      buildBestEffortMarkers: vi.fn().mockReturnValue([
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          activityLabel: 'Ride',
          windowSeconds: 30,
          windowLabel: '30s',
          duration: 20,
          efficiency: 2.1,
          power: 400,
          startDuration: 10,
          endDuration: 20,
        },
      ]),
    };

    await TestBed.configureTestingModule({
      declarations: [EventDurabilityCurveComponent],
      providers: [
        {
          provide: BreakpointObserver,
          useValue: {
            observe: vi.fn().mockReturnValue(breakpointSubject.asObservable()),
          },
        },
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: { getActivityColor: vi.fn().mockReturnValue('#16B4EA') } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: PerformanceCurveDataService, useValue: mockService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDurabilityCurveComponent);
    component = fixture.componentInstance;
    component.activities = [{ getID: () => 'a1' } as any];
    component.chartTheme = ChartThemes.Material;
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

    document.body.classList.remove('dark-theme');
  });

  it('should render durability lines and best-effort markers', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockService.buildDurabilitySeriesWithMarkerSource).toHaveBeenCalled();
    expect(mockService.buildBestEffortMarkers).toHaveBeenCalled();
    expect(option.series.length).toBeGreaterThanOrEqual(2);
    expect(option.xAxis.type).toBe('value');
    expect(option.xAxis.interval).toBe(5);
    expect(option.xAxis.max).toBe(20);
    expect(option.yAxis.type).toBe('value');
  });

  it('should hide legend when no marker/activity labels are available', async () => {
    mockService.buildBestEffortMarkers.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.legend.show).toBe(false);
  });

  it('should assign different colors when activity color service returns duplicates', async () => {
    mockService.buildDurabilitySeriesWithMarkerSource.mockReturnValue({
      renderSeries: [
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Ride',
          points: [
            { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
            { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
          ],
        },
        {
          activity: { getID: () => 'a2' } as any,
          activityId: 'a2',
          label: 'Run',
          points: [
            { duration: 10, efficiency: 2.0, power: 250, heartRate: 126, rawPower: 252, rawHeartRate: 127 },
            { duration: 20, efficiency: 1.9, power: 245, heartRate: 129, rawPower: 246, rawHeartRate: 130 },
          ],
        },
      ],
      markerSourceSeries: [
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Ride',
          points: [
            { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
            { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
          ],
        },
        {
          activity: { getID: () => 'a2' } as any,
          activityId: 'a2',
          label: 'Run',
          points: [
            { duration: 10, efficiency: 2.0, power: 250, heartRate: 126, rawPower: 252, rawHeartRate: 127 },
            { duration: 20, efficiency: 1.9, power: 245, heartRate: 129, rawPower: 246, rawHeartRate: 130 },
          ],
        },
      ],
    });

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const lineSeries = option.series.filter((entry: { type?: string }) => entry.type === 'line');
    expect(lineSeries.length).toBe(2);
    expect(lineSeries[0].lineStyle.color).not.toBe(lineSeries[1].lineStyle.color);
  });

  it('should avoid marker colors colliding with line colors in legend entries', async () => {
    mockService.buildDurabilitySeriesWithMarkerSource.mockReturnValue({
      renderSeries: [
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Ride',
          points: [
            { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
            { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
          ],
        },
      ],
      markerSourceSeries: [
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Ride',
          points: [
            { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
            { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
          ],
        },
      ],
    });
    mockService.buildBestEffortMarkers.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        activityLabel: 'Ride',
        windowSeconds: 5,
        windowLabel: '5s',
        duration: 12,
        efficiency: 2.2,
        power: 500,
        startDuration: 10,
        endDuration: 14,
      },
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        activityLabel: 'Ride',
        windowSeconds: 30,
        windowLabel: '30s',
        duration: 18,
        efficiency: 2.1,
        power: 440,
        startDuration: 10,
        endDuration: 20,
      },
    ]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const lineColor = option.series.find((entry: { type?: string }) => entry.type === 'line')?.lineStyle?.color;
    const markerColors = option.series
      .filter((entry: { type?: string }) => entry.type === 'scatter')
      .map((entry: { itemStyle?: { color?: string } }) => entry.itemStyle?.color);

    expect(markerColors.length).toBeGreaterThan(0);
    expect(markerColors.every((color: string) => color !== lineColor)).toBe(true);
    expect(new Set(markerColors).size).toBe(markerColors.length);
  });

  it('should apply dark theme tooltip style', async () => {
    component.chartTheme = ChartThemes.Dark;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.tooltip.backgroundColor).toBe('#222222');
  });

  it('should return empty option when there is no durability data', async () => {
    mockService.buildDurabilitySeriesWithMarkerSource.mockReturnValue({
      renderSeries: [],
      markerSourceSeries: [],
    });
    mockService.buildBestEffortMarkers.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });

  it('should refresh on mobile breakpoint changes', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const baseline = mockLoader.setOption.mock.calls.length;
    breakpointSubject.next({ matches: true });

    expect(mockLoader.setOption.mock.calls.length).toBeGreaterThan(baseline);
  });
});
