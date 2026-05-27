import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLEEP_PROVIDERS } from '@shared/sleep';
import { ChartsSleepTrendComponent } from './charts.sleep-trend.component';
import type { DashboardSleepTrendPoint } from '../../../helpers/dashboard-sleep-chart.helper';
import { AppColors } from '../../../services/color/app.colors';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

describe('ChartsSleepTrendComponent', () => {
  let fixture: ComponentFixture<ChartsSleepTrendComponent>;
  let component: ChartsSleepTrendComponent;
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
      declarations: [ChartsSleepTrendComponent],
      imports: [MatButtonModule, MatIconModule],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsSleepTrendComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('reserves bottom grid space for the visible legend below x-axis labels', async () => {
    const point = buildSleepPoint();
    component.sleepTrend = {
      points: [point],
      latestPoint: point,
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as Record<string, any>;

    expect(option?.legend?.show).toBe(true);
    expect(option?.legend?.bottom).toBe(0);
    expect(option?.grid?.bottom).toBeGreaterThan(34);
  });

  it('thins x-axis labels for dense 90-day sleep windows', async () => {
    const points = Array.from({ length: 90 }, (_, index) => {
      const startTimeMs = Date.UTC(2026, 2, index + 1, 21);
      const endTimeMs = Date.UTC(2026, 2, index + 2, 5);
      const sleepDate = new Date(endTimeMs).toISOString().slice(0, 10);
      return buildSleepPoint({
        id: `suunto-sleep-${index + 1}`,
        sleepDate,
        categoryLabel: `Mar ${index + 1}`,
        startTimeMs,
        endTimeMs,
      });
    });
    component.sleepRange = '90d';
    component.sleepTrend = {
      points,
      latestPoint: points[points.length - 1],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as Record<string, any>;
    const interval = option?.xAxis?.axisLabel?.interval as ((index: number) => boolean);
    const visibleLabelCount = points.filter((_point, index) => interval(index)).length;

    expect(typeof interval).toBe('function');
    expect(option?.xAxis?.axisLabel?.hideOverlap).toBe(true);
    expect(interval(0)).toBe(true);
    expect(interval(points.length - 1)).toBe(true);
    expect(interval(1)).toBe(false);
    expect(visibleLabelCount).toBeLessThanOrEqual(10);
  });

  it('reserves header space while sleep controls live in the tile header', () => {
    component.sleepRange = '30d';
    component.sleepWindowLabel = 'Last 30 days';
    component.canNavigateOlder = true;
    component.canNavigateNewer = false;
    component.reserveTitleActionSpace = true;

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const rangeMenuButton = element.querySelector('.chart-range-selector-button');
    const reservedHeader = element.querySelector('.sleep-header.sleep-header-reserve-actions');
    const controlsInTitleRow = element.querySelector('.title-row .sleep-controls');
    const navButtons = element.querySelectorAll('.sleep-nav-button');

    expect(rangeMenuButton).toBeNull();
    expect(reservedHeader).toBeTruthy();
    expect(controlsInTitleRow).toBeNull();
    expect(navButtons).toHaveLength(0);
    expect(element.querySelector('.sleep-context-label')?.textContent).toContain('Last 30 days');
  });

  it('normalizes invalid sleep range input while controls live in the tile header', () => {
    component.sleepRange = 'not-a-range' as any;

    expect(component.sleepRange).toBe('14d');
  });

  it('renders recorded sleep HRV as a secondary-axis line', async () => {
    const point = buildSleepPoint();
    const secondPoint = buildSleepPoint({
      id: 'suunto-sleep-2',
      categoryLabel: 'Apr 29\nSuunto',
      sleepDate: '2026-04-29',
      startTimeMs: Date.UTC(2026, 3, 28, 21, 45),
      endTimeMs: Date.UTC(2026, 3, 29, 5, 30),
      averageHrvMs: 42,
    });
    component.sleepTrend = {
      points: [point, secondPoint],
      latestPoint: secondPoint,
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as Record<string, any>;
    const hrvSeries = option.series.find((series: any) => series.name === 'HRV');

    expect(Array.isArray(option.yAxis)).toBe(true);
    expect(option.yAxis).toHaveLength(2);
    expect(option.grid.right).toBeGreaterThan(8);
    expect(hrvSeries).toMatchObject({
      name: 'HRV',
      type: 'line',
      yAxisIndex: 1,
      connectNulls: false,
      lineStyle: { color: AppColors.Green },
      itemStyle: { color: AppColors.Green },
      data: [62, 42],
      markLine: {
        data: [{ name: 'Avg HRV', yAxis: 52 }],
      },
    });
    expect(hrvSeries.markLine.label.formatter).toBe('Avg HRV 52ms');
    expect(hrvSeries.markLine.label).toMatchObject({
      position: 'middle',
      distance: 8,
      color: AppColors.Green,
      borderColor: AppColors.Green,
      borderWidth: 1,
      borderRadius: 4,
      padding: [2, 6],
    });
    expect(hrvSeries.markLine.lineStyle).toMatchObject({
      color: AppColors.Green,
      type: 'dashed',
    });
  });

  it('omits the HRV line and secondary axis when no sleep point has HRV', async () => {
    const point = {
      ...buildSleepPoint(),
      averageHrvMs: null,
    };
    component.sleepTrend = {
      points: [point],
      latestPoint: point,
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as Record<string, any>;

    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(option.grid.right).toBe(8);
    expect(option.series.some((series: any) => series.name === 'HRV')).toBe(false);
  });

  it('keeps empty sleep dates on the x-axis without connecting HRV across the gap', async () => {
    const firstPoint = buildSleepPoint();
    const missingPoint = buildSleepPoint({
      id: 'sleep-placeholder:2026-04-29',
      sleepDate: '2026-04-29',
      provider: null,
      providerLabel: '',
      categoryLabel: 'Wed, Apr 29',
      startTimeMs: 0,
      endTimeMs: 0,
      totalSeconds: 0,
      deepSeconds: 0,
      lightSeconds: 0,
      remSeconds: 0,
      awakeSeconds: 0,
      unknownSeconds: 0,
      score: null,
      averageHeartRateBpm: null,
      averageHrvMs: null,
      maxSpo2Percent: null,
      isNap: false,
      napSeconds: 0,
      napCount: 0,
      napAverageHrvMs: null,
      napAverageHeartRateBpm: null,
      napStartTimeMs: null,
      napEndTimeMs: null,
      isPlaceholder: true,
    });
    const lastPoint = buildSleepPoint({
      id: 'suunto-sleep-3',
      sleepDate: '2026-04-30',
      categoryLabel: 'Thu, Apr 30',
      startTimeMs: Date.UTC(2026, 3, 29, 22),
      endTimeMs: Date.UTC(2026, 3, 30, 6),
      averageHrvMs: 42,
    });
    component.sleepTrend = {
      points: [firstPoint, missingPoint, lastPoint],
      latestPoint: lastPoint,
      hasRealPoints: true,
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as Record<string, any>;
    const deepSeries = option.series.find((series: any) => series.name === 'Deep');
    const hrvSeries = option.series.find((series: any) => series.name === 'HRV');
    const tooltipHtml = option.tooltip.formatter([{ dataIndex: 1 }]);

    expect(option.xAxis.data).toEqual(['Apr 28\nSuunto', 'Wed, Apr 29', 'Thu, Apr 30']);
    expect(deepSeries.data[1]).toBe(0);
    expect(hrvSeries.data).toEqual([62, null, 42]);
    expect(hrvSeries.connectNulls).toBe(false);
    expect(tooltipHtml).toContain('No sleep data');
    expect(component.showNoDataError).toBe(false);
  });

  it('renders same-day naps as a segment in the stacked sleep bar', async () => {
    const point = buildSleepPoint({
      id: 'suunto-sleep-with-nap',
      categoryLabel: 'Tue, May 26',
      sleepDate: '2026-05-26',
      startTimeMs: Date.UTC(2026, 4, 26, 18, 47),
      endTimeMs: Date.UTC(2026, 4, 27, 4, 38),
      totalSeconds: 33300,
      deepSeconds: 5940,
      lightSeconds: 23580,
      remSeconds: 3780,
      awakeSeconds: 2160,
      unknownSeconds: 0,
      score: 74,
      averageHeartRateBpm: 64,
      averageHrvMs: 32,
      napSeconds: 10320,
      napCount: 1,
      napAverageHeartRateBpm: 56,
      napAverageHrvMs: 45,
      napStartTimeMs: Date.UTC(2026, 4, 26, 2),
      napEndTimeMs: Date.UTC(2026, 4, 26, 4, 52),
    });
    component.sleepTrend = {
      points: [point],
      latestPoint: point,
      hasRealPoints: true,
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(mockLoader.setOption).toHaveBeenCalled();
    });

    const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const optionCandidate = setOptionCall[1] || setOptionCall[0];
    const option = optionCandidate as Record<string, any>;
    const tooltipHtml = option.tooltip.formatter([{ dataIndex: 0 }]);
    const napSeries = option.series.find((series: any) => series.name === 'Nap');
    const awakeSeries = option.series.find((series: any) => series.name === 'Awake');

    expect(option.xAxis.data).toEqual(['Tue, May 26']);
    expect(option.xAxis.containShape).toBe(true);
    expect(napSeries).toMatchObject({
      name: 'Nap',
      type: 'bar',
      stack: 'sleep',
      barMaxWidth: 32,
    });
    expect(napSeries.data).toEqual([
      {
        value: 2.87,
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
        },
      },
    ]);
    expect(awakeSeries.data).toEqual([0.6]);
    expect(tooltipHtml).toContain('Suunto · 2026-05-26');
    expect(tooltipHtml).toContain('9h 15m');
    expect(tooltipHtml).toContain('2h 52m');
    expect(tooltipHtml).toContain('12h 07m');
    expect(tooltipHtml).toContain('Nap HRV');
    expect(tooltipHtml).toContain('45 ms');
  });

  it('enables the draggable x-axis tooltip handle on mobile viewport', async () => {
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
      const point = buildSleepPoint();
      component.sleepTrend = {
        points: [point],
        latestPoint: point,
      };

      fixture.detectChanges();
      await fixture.whenStable();
      await vi.waitFor(() => {
        expect(mockLoader.setOption).toHaveBeenCalled();
      });

      const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
      const optionCandidate = setOptionCall[1] || setOptionCall[0];
      const option = optionCandidate as Record<string, any>;
      expect(option?.tooltip?.triggerOn).toBe('click');
      expect(option?.tooltip?.axisPointer).toMatchObject({
        type: 'shadow',
        axis: 'x',
        snap: true,
      });
      expect(option?.xAxis?.axisPointer?.triggerTooltip).toBe(true);
      expect(option?.xAxis?.axisPointer?.handle?.show).toBe(true);
      expect(option?.xAxis?.axisPointer?.handle?.size).toBe(20);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

function buildSleepPoint(overrides: Partial<DashboardSleepTrendPoint> = {}): DashboardSleepTrendPoint {
  const startTimeMs = Date.UTC(2026, 3, 27, 21, 45);
  const endTimeMs = Date.UTC(2026, 3, 28, 5, 30);

  return {
    id: 'suunto-sleep-1',
    sleepDate: '2026-04-28',
    provider: SLEEP_PROVIDERS.SuuntoApp,
    providerLabel: 'Suunto',
    categoryLabel: 'Apr 28\nSuunto',
    startTimeMs,
    endTimeMs,
    totalSeconds: 27900,
    deepSeconds: 5400,
    lightSeconds: 14400,
    remSeconds: 5400,
    awakeSeconds: 900,
    unknownSeconds: 1800,
    score: 82,
    averageHeartRateBpm: 48,
    averageHrvMs: 62,
    maxSpo2Percent: 98,
    isNap: false,
    napSeconds: 0,
    napCount: 0,
    napAverageHrvMs: null,
    napAverageHeartRateBpm: null,
    napStartTimeMs: null,
    napEndTimeMs: null,
    ...overrides,
  };
}
