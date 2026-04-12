import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsEfficiencyTrendComponent } from './charts.efficiency-trend.component';
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
      declarations: [ChartsEfficiencyTrendComponent],
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
});
