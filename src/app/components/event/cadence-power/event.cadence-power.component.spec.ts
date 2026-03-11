import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventCadencePowerComponent } from './event.cadence-power.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { PerformanceCurveDataService } from '../../../services/performance-curve-data.service';
import { getOrCreateEChartsTooltipHost } from '../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';

describe('EventCadencePowerComponent', () => {
  let fixture: ComponentFixture<EventCadencePowerComponent>;
  let component: EventCadencePowerComponent;
  let breakpointSubject: Subject<{ matches: boolean }>;

  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  let mockService: {
    buildCadencePowerSeries: ReturnType<typeof vi.fn>;
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
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
    };

    mockService = {
      buildCadencePowerSeries: vi.fn().mockReturnValue([
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Ride',
          points: [
            { duration: 60, cadence: 92, power: 340, density: 0.9 },
            { duration: 61, cadence: 93, power: 338, density: 0.8 },
          ],
        },
      ]),
    };

    await TestBed.configureTestingModule({
      declarations: [EventCadencePowerComponent],
      providers: [
        {
          provide: BreakpointObserver,
          useValue: {
            observe: vi.fn().mockReturnValue(breakpointSubject.asObservable()),
          },
        },
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: { getActivityColor: vi.fn().mockReturnValue('#16B4EA') } },
        { provide: LoggerService, useValue: { error: vi.fn(), log: vi.fn() } },
        { provide: PerformanceCurveDataService, useValue: mockService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCadencePowerComponent);
    component = fixture.componentInstance;
    component.activities = [{ getID: () => 'a1' } as any];
    component.darkTheme = false;
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

  it('should render cadence-power scatter with visual map', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockService.buildCadencePowerSeries).toHaveBeenCalled();
    expect(option.series).toHaveLength(1);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(option.tooltip.confine).toBe(false);
    expect(option.tooltip.position).toBe(getViewportConstrainedTooltipPosition);
    expect(option.series[0].type).toBe('scatter');
    expect(option.visualMap).toBeDefined();
  });

  it('should use standardized cadence x-axis bounds and interval', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.xAxis.min % 5).toBe(0);
    expect(option.xAxis.max % 5).toBe(0);
    expect(option.xAxis.interval % 5).toBe(0);
  });

  it('should hide legend for single activity and show for multiple activities', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();
    expect(getLastOption().legend.show).toBe(false);

    mockService.buildCadencePowerSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: [{ duration: 60, cadence: 92, power: 340, density: 0.9 }],
      },
      {
        activity: { getID: () => 'a2' } as any,
        activityId: 'a2',
        label: 'Run',
        points: [{ duration: 60, cadence: 88, power: 300, density: 0.7 }],
      },
    ]);

    component.ngOnChanges({ activities: { currentValue: [], previousValue: [], firstChange: false, isFirstChange: () => false } as any });
    await waitForChartStabilization();

    expect(getLastOption().legend.show).toBe(true);
  });

  it('should produce different point colors by density', async () => {
    mockService.buildCadencePowerSeries.mockReturnValue([
      {
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Ride',
        points: [
          { duration: 60, cadence: 92, power: 340, density: 0.2 },
          { duration: 61, cadence: 93, power: 338, density: 0.9 },
        ],
      },
    ]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const pointA = option.series[0].data[0];
    const pointB = option.series[0].data[1];

    expect(pointA.itemStyle.color).not.toBe(pointB.itemStyle.color);
    expect(pointA.symbolSize).toBeLessThan(pointB.symbolSize);
    expect(option.series[0].symbolSize).toBeUndefined();
  });

  it('should apply dark theme tooltip style', async () => {
    component.darkTheme = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(getLastOption().tooltip.backgroundColor).toBe('rgba(58,62,68,1)');
  });

  it('should return empty option when there is no cadence-power data', async () => {
    mockService.buildCadencePowerSeries.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });
});
