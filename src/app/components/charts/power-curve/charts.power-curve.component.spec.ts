import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsPowerCurveComponent } from './charts.power-curve.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import type { DashboardPowerCurveContext } from '../../../helpers/dashboard-power-curve.helper';

describe('ChartsPowerCurveComponent', () => {
  let fixture: ComponentFixture<ChartsPowerCurveComponent>;
  let component: ChartsPowerCurveComponent;
  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(async () => {
    originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    const mockChart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
    };

    await TestBed.configureTestingModule({
      declarations: [ChartsPowerCurveComponent],
      imports: [MatButtonModule, MatIconModule],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsPowerCurveComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('renders compact benchmark stats with 20m as the primary benchmark', async () => {
    component.powerCurve = makePowerCurveContext();

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.benchmarkStats).toEqual([
      expect.objectContaining({
        duration: 1200,
        durationLabel: '20m',
        powerLabel: '245w',
      }),
      expect.objectContaining({
        duration: 300,
        durationLabel: '5m',
        powerLabel: '315w',
      }),
      expect.objectContaining({
        duration: 60,
        durationLabel: '1m',
        powerLabel: '420w',
      }),
    ]);
    expect(component.primaryBenchmark).toEqual(expect.objectContaining({
      duration: 1200,
      durationLabel: '20m',
      powerLabel: '245w',
    }));
    expect(component.secondaryBenchmarks).toEqual([
      expect.objectContaining({ duration: 300, durationLabel: '5m', powerLabel: '315w' }),
      expect.objectContaining({ duration: 60, durationLabel: '1m', powerLabel: '420w' }),
    ]);
    expect(component.subtitleText).toBe('Best + latest cycling activity · 2 events');
    expect(component.showNoDataError).toBe(false);
  });

  it('derives compact mobile titles for scoped Power Curve tiles', () => {
    component.title = 'Cycling Power Curve';
    expect(component.compactTitle).toBe('Cycling');

    component.title = 'Running Power Curve';
    expect(component.compactTitle).toBe('Running');

    component.title = 'Ski Touring Power Curve';
    expect(component.compactTitle).toBe('Ski Touring');
  });

  it('shows no-data state when no usable power curve series exist', async () => {
    component.powerCurve = {
      matchedEventCount: 0,
      sourceEventCount: 3,
      latestEventId: null,
      latestEventStartMs: null,
      latestSeriesLabel: 'Latest running activity',
      compareMode: 'latest',
      comparisonSeriesLabel: 'Latest running activity',
      comparisonEventCount: 0,
      series: [],
      summaryPoints: [],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('No power curve data yet');
    expect(component.noDataErrorHint).toContain('longer range');
  });

  it('uses the nearest available duration to 20m when benchmark summary durations are missing', async () => {
    component.powerCurve = {
      matchedEventCount: 1,
      sourceEventCount: 1,
      latestEventId: 'event-1',
      latestEventStartMs: Date.UTC(2026, 0, 1),
      latestSeriesLabel: 'Latest running activity',
      compareMode: 'latest',
      comparisonSeriesLabel: 'Latest running activity',
      comparisonEventCount: 1,
      summaryPoints: [],
      series: [{
        seriesKey: 'latestAndBest',
        label: 'Latest and best',
        colorKey: 'best',
        points: [
          { duration: 30, power: 620 },
          { duration: 180, power: 410 },
          { duration: 900, power: 260 },
        ],
      }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(false);
    expect(component.benchmarkStats).toEqual([
      expect.objectContaining({
        duration: 900,
        durationLabel: '15m',
        powerLabel: '260w',
      }),
    ]);
    expect(component.primaryBenchmark).toEqual(expect.objectContaining({
      duration: 900,
      durationLabel: '15m',
      powerLabel: '260w',
    }));
    expect(component.secondaryBenchmarks).toEqual([]);
  });

  it('describes recent-best comparison mode as a range-vs-range subtitle', async () => {
    component.powerCurve = {
      ...makePowerCurveContext(),
      compareMode: 'best30d',
      comparisonSeriesLabel: 'Best last 30d',
      comparisonEventCount: 4,
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.subtitleText).toBe('Best in range vs best last 30d · 2 events');
  });

  it('places the clickable series legend below the chart plot', async () => {
    component.powerCurve = makePowerCurveContext();

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as {
      legend?: { bottom?: number; left?: string; top?: number };
      grid?: { top?: number; bottom?: number };
    };

    expect(option.legend).toEqual(expect.objectContaining({
      bottom: 0,
      left: 'center',
    }));
    expect(option.legend?.top).toBeUndefined();
    expect(option.grid).toEqual(expect.objectContaining({
      top: 8,
      bottom: 44,
    }));
  });

  it('formats tooltip rows with shared dashboard tooltip chrome', async () => {
    component.powerCurve = makePowerCurveContext();

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as {
      tooltip?: {
        formatter?: (params: Array<{
          axisValue?: string | number;
          seriesName?: string;
          color?: string;
          data?: { value?: number; wattsPerKg?: number };
        }>) => string;
      };
    };
    const formatter = option.tooltip?.formatter;
    expect(typeof formatter).toBe('function');

    const tooltipHtml = formatter?.([
      {
        axisValue: 300,
        seriesName: 'Best in range',
        color: '#2196f3',
        data: { value: 315, wattsPerKg: 4.2 },
      },
      {
        axisValue: 300,
        seriesName: 'Latest running activity',
        color: '#f44336',
        data: { value: 292, wattsPerKg: 3.89 },
      },
    ]) || '';

    expect(tooltipHtml).toContain('qs-dashboard-echarts-tooltip-card');
    expect(tooltipHtml).toContain('5m');
    expect(tooltipHtml).toContain('Best in range');
    expect(tooltipHtml).toContain('315');
    expect(tooltipHtml).toContain('4.20 W/kg');
    expect(tooltipHtml).toContain('Latest running activity');
    expect(tooltipHtml).toContain('292');
    expect(tooltipHtml).toContain('3.89 W/kg');
  });

  it('uses tap-only tooltip triggering on mobile viewport', async () => {
    const originalMatchMedia = window.matchMedia;
    const matchMediaSpy = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMediaSpy as unknown as typeof window.matchMedia;

    try {
      component.powerCurve = makePowerCurveContext();

      fixture.detectChanges();
      await fixture.whenStable();
      await vi.waitFor(() => {
        expect(mockLoader.setOption).toHaveBeenCalled();
      });

      const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
      const optionCandidate = setOptionCall[1] || setOptionCall[0];
      const option = optionCandidate as Record<string, any>;
      expect(option?.legend?.bottom).toBe(0);
      expect(option?.grid?.bottom).toBe(54);
      expect(option?.tooltip?.triggerOn).toBe('click');
      expect(option?.tooltip?.confine).toBe(true);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

function makePowerCurveContext(): DashboardPowerCurveContext {
  return {
    matchedEventCount: 2,
    sourceEventCount: 4,
    latestEventId: 'latest-event',
    latestEventStartMs: Date.UTC(2026, 0, 2),
    latestSeriesLabel: 'Latest cycling activity',
    compareMode: 'latest',
    comparisonSeriesLabel: 'Latest cycling activity',
    comparisonEventCount: 1,
    summaryPoints: [
      { duration: 60, power: 420, wattsPerKg: 5.6 },
      { duration: 300, power: 315, wattsPerKg: 4.2 },
      { duration: 1200, power: 245, wattsPerKg: 3.27 },
    ],
    series: [
      {
        seriesKey: 'best',
        label: 'Best in range',
        colorKey: 'best',
        points: [
          { duration: 60, power: 420, wattsPerKg: 5.6 },
          { duration: 300, power: 315, wattsPerKg: 4.2 },
          { duration: 1200, power: 245, wattsPerKg: 3.27 },
        ],
      },
      {
        seriesKey: 'latest',
        label: 'Latest cycling activity',
        colorKey: 'latest',
        eventId: 'latest-event',
        eventStartMs: Date.UTC(2026, 0, 2),
        points: [
          { duration: 60, power: 398, wattsPerKg: 5.31 },
          { duration: 300, power: 292, wattsPerKg: 3.89 },
          { duration: 1200, power: 230, wattsPerKg: 3.07 },
        ],
      },
    ],
  };
}
