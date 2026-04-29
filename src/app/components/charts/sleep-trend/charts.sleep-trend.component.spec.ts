import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLEEP_PROVIDERS } from '@shared/sleep';
import { ChartsSleepTrendComponent } from './charts.sleep-trend.component';
import type { DashboardSleepTrendPoint } from '../../../helpers/dashboard-sleep-chart.helper';
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
});

function buildSleepPoint(): DashboardSleepTrendPoint {
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
  };
}
