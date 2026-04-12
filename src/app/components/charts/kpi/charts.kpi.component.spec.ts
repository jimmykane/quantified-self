import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsKpiComponent } from './charts.kpi.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
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

  it('renders Form Now readiness KPI presentation', async () => {
    component.chartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
    component.formNow = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: -2.4,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: -1.1 }],
    };
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.title).toBe('Form Now');
    expect(component.primaryValueText).toBe('-2.4');
  });

  it('renders Form +7d readiness KPI presentation', async () => {
    component.chartType = DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE;
    component.formPlus7d = {
      latestDayMs: Date.UTC(2026, 0, 1),
      projectedDayMs: Date.UTC(2026, 0, 8),
      value: 3.2,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 1.6 }],
    };
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.title).toBe('Form +7d');
    expect(component.primaryValueText).toBe('+3.2');
  });

  it('renders Easy % execution KPI presentation', async () => {
    component.chartType = DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;
    component.easyPercent = {
      latestWeekStartMs: Date.UTC(2026, 0, 1),
      value: 62.5,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 58.1 }],
    };
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.title).toBe('Easy %');
    expect(component.primaryValueText).toBe('62.5%');
  });

  it('renders Hard % execution KPI presentation', async () => {
    component.chartType = DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE;
    component.hardPercent = {
      latestWeekStartMs: Date.UTC(2026, 0, 1),
      value: 14.3,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 12.2 }],
    };
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.title).toBe('Hard %');
    expect(component.primaryValueText).toBe('14.3%');
  });

  it('renders efficiency delta with absolute and percent labels', async () => {
    component.chartType = DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE;
    component.efficiencyDelta4w = {
      latestWeekStartMs: Date.UTC(2026, 0, 1),
      latestValue: 1.92,
      baselineValue: 1.8,
      baselineWeekCount: 4,
      deltaAbs: 0.12,
      deltaPct: 6.67,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 1.7 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Efficiency Δ (4w)');
    expect(component.primaryValueText).toBe('+0.12');
    expect(component.secondaryValueText).toBe('+6.67%');
  });

  it('re-enables tooltip when KPI transitions from no-data to data', async () => {
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = {
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 0,
      chronicLoad28: 0,
      ratio: null,
      trend8Weeks: [],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    const noDataCallCount = mockLoader.setOption.mock.calls.length;

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

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();

    expect(mockLoader.setOption.mock.calls.length).toBeGreaterThan(noDataCallCount);
    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const tooltipEnabledOption = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'tooltip' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;

    expect(tooltipEnabledOption).toBeTruthy();
    expect(tooltipEnabledOption?.tooltip?.show).toBe(true);
    expect(tooltipEnabledOption?.tooltip?.triggerOn).toBe('mousemove|click');
    expect(tooltipEnabledOption?.tooltip?.renderMode).toBe('html');
  });
});
