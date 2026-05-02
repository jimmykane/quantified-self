import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsEfficiencyTrendComponent } from './charts.efficiency-trend.component';
import { ChartRangeSelectorComponent } from '../shared/chart-range-selector/chart-range-selector.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

describe('ChartsEfficiencyTrendComponent', () => {
  let fixture: ComponentFixture<ChartsEfficiencyTrendComponent>;
  let component: ChartsEfficiencyTrendComponent;
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
      declarations: [ChartsEfficiencyTrendComponent, ChartRangeSelectorComponent],
      imports: [MatButtonModule, MatIconModule, MatMenuModule],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsEfficiencyTrendComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('renders latest efficiency value and trend series', async () => {
    component.trend = {
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestValue: 1.92,
      points: [
        {
          weekStartMs: Date.UTC(2025, 11, 29),
          value: 1.8,
          sampleCount: 4,
          totalDurationSeconds: 12400,
        },
        {
          weekStartMs: Date.UTC(2026, 0, 5),
          value: 1.92,
          sampleCount: 3,
          totalDurationSeconds: 9600,
        },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.latestValueText).toBe('1.92');
  });

  it('shows pending no-data message while stale', async () => {
    component.trend = { latestWeekStartMs: null, latestValue: null, points: [] };
    component.status = 'stale';

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('Efficiency trend is updating');
  });

  it('includes year in x-axis labels for wide history spans', async () => {
    const points = [
      {
        weekStartMs: Date.UTC(2023, 0, 2),
        value: 1.7,
        sampleCount: 3,
        totalDurationSeconds: 8400,
      },
      {
        weekStartMs: Date.UTC(2026, 0, 5),
        value: 1.95,
        sampleCount: 4,
        totalDurationSeconds: 9200,
      },
    ];
    component.trend = {
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestValue: 1.95,
      points,
    };

    fixture.detectChanges();
    await fixture.whenStable();

    const option = (component as any).buildOption(points) as Record<string, any>;
    const formatter = option?.xAxis?.axisLabel?.formatter as ((value: number) => string);
    expect(typeof formatter).toBe('function');

    const firstLabel = formatter(Date.UTC(2023, 0, 1));
    const secondLabel = formatter(Date.UTC(2026, 0, 1));
    expect(firstLabel).not.toBe(secondLabel);
    expect(firstLabel).toMatch(/\d{4}/);
    expect(secondLabel).toMatch(/\d{4}/);
  });

  it('enables draggable x-axis tooltip handle on mobile viewport', async () => {
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
      component.trend = {
        latestWeekStartMs: Date.UTC(2026, 0, 5),
        latestValue: 1.92,
        points: [
          {
            weekStartMs: Date.UTC(2025, 11, 29),
            value: 1.8,
            sampleCount: 4,
            totalDurationSeconds: 12400,
          },
          {
            weekStartMs: Date.UTC(2026, 0, 5),
            value: 1.92,
            sampleCount: 3,
            totalDurationSeconds: 9600,
          },
        ],
      };
      fixture.detectChanges();
      await fixture.whenStable();
      await vi.waitFor(() => {
        expect(mockLoader.setOption).toHaveBeenCalled();
      });

      const setOptionCall = mockLoader.setOption.mock.calls.at(-1) || [];
      const optionCandidate = setOptionCall[1] || setOptionCall[0];
      const option = optionCandidate as Record<string, any>;
      expect(option?.xAxis?.axisPointer?.handle?.show).toBe(true);
      expect(option?.xAxis?.axisPointer?.handle?.size).toBe(20);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('renders a chart range selector and filters to the selected weekly window', async () => {
    const baseWeekMs = Date.UTC(2025, 0, 6);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    component.trend = {
      latestWeekStartMs: baseWeekMs + (59 * weekMs),
      latestValue: 2.1,
      points: Array.from({ length: 60 }, (_, index) => ({
        weekStartMs: baseWeekMs + (index * weekMs),
        value: 1.5 + (index / 100),
        sampleCount: 2,
        totalDurationSeconds: 7200,
      })),
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.chart-range-selector-button')).toBeTruthy();
    expect((component as any).getVisiblePoints()).toHaveLength(52);

    component.onRangeSelection('8w');

    expect(component.selectedRange).toBe('8w');
    expect((component as any).getVisiblePoints()).toHaveLength(8);
  });
});
