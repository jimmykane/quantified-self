import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventDurabilityCurveComponent } from './event.durability-curve.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { PerformanceCurveDataService } from '../../../services/performance-curve-data.service';
import { getOrCreateEChartsTooltipHost } from '../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';
import { SharedModule } from '../../../modules/shared.module';
import { AppHapticsService } from '../../../services/app.haptics.service';

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
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
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
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
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
      imports: [SharedModule, NoopAnimationsModule],
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
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDurabilityCurveComponent);
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

  it('should render durability lines and best-effort markers', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockService.buildDurabilitySeriesWithMarkerSource).toHaveBeenCalled();
    expect(mockService.buildBestEffortMarkers).toHaveBeenCalled();
    expect(option.series.length).toBeGreaterThanOrEqual(2);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(option.tooltip.confine).toBe(false);
    expect(option.tooltip.position).toBe(getViewportConstrainedTooltipPosition);
    expect(option.xAxis.type).toBe('value');
    expect(option.xAxis.interval).toBe(5);
    expect(option.xAxis.max).toBe(20);
    expect(option.yAxis.type).toBe('value');
    expect(option.grid.left).toBe(54);
    expect(option.grid.bottom).toBe(16);
  });

  it('explains eligible cycling evidence without implementation-facing durability jargon', async () => {
    mockService.buildDurabilitySeriesWithMarkerSource.mockReturnValue({
      renderSeries: [
        {
          activity: { getID: () => 'a1' } as any,
          activityId: 'a1',
          label: 'Cycling',
          outputUnit: 'W',
          points: [
            { duration: 10, efficiency: 2.2, power: 280, heartRate: 127, rawPower: 282, rawHeartRate: 128 },
            { duration: 20, efficiency: 2.1, power: 275, heartRate: 131, rawPower: 276, rawHeartRate: 132 },
          ],
        },
      ],
      markerSourceSeries: [],
      activitySummaries: [{
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Cycling',
        eligibilityLabel: 'Comparable first and second halves',
        summary: {
          protocolVersion: 1,
          discipline: 'cycling',
          outputSource: 'power',
          outputUnit: 'W',
          context: null,
          durationSeconds: 6_000,
          qualifyingDurationSeconds: 4_680,
          coverageRatio: 0.92,
          eligibility: {
            eligible: true,
            reason: 'eligible',
            validSampleCount: 4_680,
            comparisonSegments: 'halves',
            earlySampleCount: 2_340,
            lateSampleCount: 2_340,
            outputCoefficientOfVariation: 0.12,
            hardZoneRatio: 0.08,
          },
          evidence: {
            kind: 'aerobic-efficiency',
            firstHalfEfficiency: 2.4,
            secondHalfEfficiency: 2.244,
            decouplingPercent: 6.5,
            firstHalfOutput: 250,
            secondHalfOutput: 231.75,
            outputRetentionPercent: 92.7,
            firstHalfHeartRateBpm: 104,
            secondHalfHeartRateBpm: 103,
            heartRateDriftBpm: -1,
          },
        },
      }],
    });
    mockService.buildBestEffortMarkers.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Steady-effort comparison available');
    expect(text).toContain('01h 40m total · 01h 18m of matched power and heart-rate data (92% coverage)');
    expect(text).toContain('Power relative to heart rate was 6.5% lower in the second half.');
    expect(text).toContain('Second-half power was 92.7% of the first half; average heart rate was 1 bpm lower.');
    expect(text).not.toContain('decoupling');
    expect(text).not.toContain('paired coverage');
    expect(fixture.nativeElement.querySelector('[aria-label="How to read durability"]')).not.toBeNull();
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
    component.darkTheme = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.backgroundColor).toBe('transparent');
    expect(option.tooltip.backgroundColor).toBe('rgba(58,62,68,1)');
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

  it('should show pool context and eligibility summaries without inventing a timeline', async () => {
    mockService.buildDurabilitySeriesWithMarkerSource.mockReturnValue({
      renderSeries: [],
      markerSourceSeries: [],
      activitySummaries: [{
        activity: { getID: () => 'swim-1' } as any,
        activityId: 'swim-1',
        label: 'Pool Swimming',
        eligibilityLabel: 'Comparable early and late thirds',
        summary: {
          protocolVersion: 1,
          discipline: 'pool-swimming',
          outputSource: 'pool-length-speed',
          outputUnit: 'm/s',
          context: { poolLengthMeters: 25, stroke: 'freestyle' },
          durationSeconds: 3600,
          qualifyingDurationSeconds: 1800,
          coverageRatio: 1,
          eligibility: {
            eligible: true,
            reason: 'eligible',
            validSampleCount: 30,
            comparisonSegments: 'outer-thirds',
            earlySampleCount: 10,
            lateSampleCount: 10,
            outputCoefficientOfVariation: null,
            hardZoneRatio: null,
          },
          evidence: {
            kind: 'pool-consistency',
            poolLengthMeters: 25,
            stroke: 'freestyle',
            comparableLengthCount: 30,
            firstPaceSecondsPer100m: 100,
            finalPaceSecondsPer100m: 102,
            paceRetentionPercent: 98,
            firstSwolf: 42,
            finalSwolf: 43,
            swolfChange: 1,
          },
        },
      }],
    });
    mockService.buildBestEffortMarkers.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('25 m · freestyle · 30 comparable lengths');
    expect(fixture.nativeElement.textContent).toContain('98.0% pace retained');
    expect(getLastOption().series).toEqual([]);
  });

  it('should collapse durability details by default on mobile and allow them to expand', async () => {
    mockService.buildDurabilitySeriesWithMarkerSource.mockReturnValue({
      renderSeries: [],
      markerSourceSeries: [],
      activitySummaries: [{
        activity: { getID: () => 'a1' } as any,
        activityId: 'a1',
        label: 'Cycling',
        eligibilityLabel: 'Output varied too much for a steady comparison',
        summary: {
          protocolVersion: 1,
          discipline: 'cycling',
          outputSource: 'power',
          outputUnit: 'W',
          context: null,
          durationSeconds: 8400,
          qualifyingDurationSeconds: 6900,
          coverageRatio: 0.79,
          eligibility: {
            eligible: false,
            reason: 'too-variable',
            validSampleCount: 6900,
            comparisonSegments: 'halves',
            earlySampleCount: 3450,
            lateSampleCount: 3450,
            outputCoefficientOfVariation: 0.31,
            hardZoneRatio: null,
          },
          evidence: null,
        },
      }],
    });
    mockService.buildBestEffortMarkers.mockReturnValue([]);

    fixture.detectChanges();
    await waitForChartStabilization();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.durability-summary-list')).not.toBeNull();

    breakpointSubject.next({ matches: true });
    await waitForChartStabilization();
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.durability-summary-toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.durability-summary-list')).toBeNull();

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.durability-summary-list')).not.toBeNull();
  });

  it('should refresh on mobile breakpoint changes', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const baseline = mockLoader.setOption.mock.calls.length;
    breakpointSubject.next({ matches: true });
    await waitForChartStabilization();

    expect(mockLoader.setOption.mock.calls.length).toBeGreaterThan(baseline);
    expect(getLastOption().grid.left).toBe(46);
    expect(getLastOption().grid.bottom).toBe(20);
  });
});
