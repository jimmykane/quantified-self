import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsFreshnessForecastComponent } from './charts.freshness-forecast.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

describe('ChartsFreshnessForecastComponent', () => {
  let fixture: ComponentFixture<ChartsFreshnessForecastComponent>;
  let component: ChartsFreshnessForecastComponent;
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
      declarations: [ChartsFreshnessForecastComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsFreshnessForecastComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('renders current and +7d form values from derived forecast points', async () => {
    component.forecast = {
      generatedAtMs: Date.now(),
      points: [
        {
          dayMs: Date.UTC(2026, 0, 8),
          trainingStressScore: 20,
          ctl: 50,
          atl: 55,
          formSameDay: -5,
          formPriorDay: -4,
          isForecast: false,
        },
        {
          dayMs: Date.UTC(2026, 0, 15),
          trainingStressScore: 0,
          ctl: 47,
          atl: 40,
          formSameDay: 7,
          formPriorDay: 6,
          isForecast: true,
        },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.currentFormText).toBe('-4');
    expect(component.forecastFormText).toBe('6');
  });

  it('shows pending message when no points exist and status is stale', async () => {
    component.forecast = { generatedAtMs: Date.now(), points: [] };
    component.status = 'stale';

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('Forecast is updating');
  });
});
