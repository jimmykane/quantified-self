import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsKpiComponent } from './charts.kpi.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
} from '../../../helpers/dashboard-special-chart-types';

describe('ChartsKpiComponent', () => {
  let fixture: ComponentFixture<ChartsKpiComponent>;
  let component: ChartsKpiComponent;
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
      declarations: [ChartsKpiComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsKpiComponent);
    component = fixture.componentInstance;
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = {
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 210,
      chronicLoad28: 190,
      ratio: 1.11,
      trend8Weeks: [
        { time: Date.UTC(2025, 11, 1), value: 0.9 },
        { time: Date.UTC(2025, 11, 8), value: 1.0 },
      ],
    };
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('renders ACWR headline and sparkline', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('ACWR');
    expect(component.primaryValueText).toBe('1.11');
  });

  it('switches presentation for ramp rate', async () => {
    component.chartType = DASHBOARD_RAMP_RATE_KPI_CHART_TYPE;
    component.rampRate = {
      latestDayMs: Date.UTC(2026, 0, 1),
      ctlToday: 65,
      ctl7DaysAgo: 61,
      rampRate: 4,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 2 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Ramp Rate');
    expect(component.primaryValueText).toBe('4');
  });

  it('switches presentation for monotony/strain', async () => {
    component.chartType = DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
    component.monotonyStrain = {
      latestDayMs: Date.UTC(2026, 0, 1),
      weeklyLoad7: 360,
      monotony: 1.7,
      strain: 612,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 520 }],
    };
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Monotony / Strain');
    expect(component.primaryValueText).toBe('612');
  });

  it('shows pending no-data messaging when context is unavailable and status is stale', async () => {
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = null;
    component.acwrStatus = 'stale';

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('KPI is updating');
  });
});
