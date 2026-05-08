import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, Input, NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatTooltip } from '@angular/material/tooltip';
import { ChartsKpiComponent } from './charts.kpi.component';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
} from '../../../helpers/dashboard-special-chart-types';

@Component({
  selector: 'app-loading-overlay',
  template: '<ng-content></ng-content>',
  standalone: false,
})
class MockLoadingOverlayComponent {
  @Input() isLoading = false;
  @Input() hasError = false;
  @Input() allowErrorPassthrough = false;
  @Input() errorMessage = '';
  @Input() errorHint = '';
  @Input() errorIcon = '';
  @Input() showSkeleton = true;
  @Input() height = '';
}

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
  let hapticsMock: { selection: ReturnType<typeof vi.fn> };
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
    hapticsMock = { selection: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [ChartsKpiComponent, MockLoadingOverlayComponent],
      providers: [
        { provide: AppHapticsService, useValue: hapticsMock },
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

  const getLoadingOverlay = (): MockLoadingOverlayComponent => {
    const debugElement = fixture.debugElement.query(By.directive(MockLoadingOverlayComponent));
    return debugElement.componentInstance as MockLoadingOverlayComponent;
  };

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
    expect(component.secondaryLabel).toBe('Acute / Chronic');
    expect(component.secondaryValueText).toBe('210 / 190');
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
    expect(component.secondaryLabel).toBe('CTL today');
    expect(component.secondaryValueText).toBe('65');
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
    expect(component.secondaryLabel).toBe('Monotony');
    expect(component.secondaryValueText).toBe('1.7');
  });

  it('uses compact title aliases when action space is reserved', async () => {
    component.reserveTitleActionSpace = true;
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
    expect(component.titleDisplay).toBe('M/S');
  });

  it('keeps full titles and applies row layout in compact row mode', async () => {
    component.compactRow = true;
    component.reserveTitleActionSpace = true;
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
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(component.title).toBe('Monotony / Strain');
    expect(component.titleDisplay).toBe('Monotony / Strain');
    expect(nativeElement.querySelector('.kpi-layout-row')).not.toBeNull();
    expect(nativeElement.querySelector('.kpi-layout-reserve-actions')).not.toBeNull();
    expect(nativeElement.querySelector('.kpi-copy-block .kpi-title.qs-dashboard-chart-title')?.textContent?.trim()).toBe('Monotony / Strain');
    expect(nativeElement.querySelector('.kpi-subtitle-row')?.textContent).toContain('Strain');
    expect(nativeElement.querySelector('.kpi-value-block .kpi-value')?.textContent?.trim()).toBe('612');

    await (component as any).refreshChart();
    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'tooltip' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;
    expect(option?.tooltip?.show).toBe(false);
    expect(option?.series?.[0]?.silent).toBe(true);
  });

  it('updates compact title alias when action-space reservation toggles without data changes', async () => {
    component.chartType = DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE;
    component.monotonyStrain = {
      latestDayMs: Date.UTC(2026, 0, 1),
      weeklyLoad7: 360,
      monotony: 1.7,
      strain: 612,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 520 }],
    };
    component.reserveTitleActionSpace = false;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.titleDisplay).toBe('Monotony / Strain');

    component.reserveTitleActionSpace = true;
    component.ngOnChanges({
      reserveTitleActionSpace: new SimpleChange(false, true, false),
    });

    expect(component.titleDisplay).toBe('M/S');
  });

  it('shows pending no-data messaging when context is unavailable and status is stale', async () => {
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = null;
    component.acwrStatus = 'stale';

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('Updating KPI data');
    expect(component.noDataErrorHint).toBe('Training metrics are being recalculated in the background.');
  });

  it('shows no-data through the shared loading overlay after compact KPI loading finishes', async () => {
    component.compactRow = true;
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = null;
    component.acwrStatus = 'missing';
    component.isLoading = false;

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();
    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const overlay = getLoadingOverlay();

    expect(component.showNoDataError).toBe(true);
    expect(overlay.isLoading).toBe(false);
    expect(overlay.hasError).toBe(true);
    expect(overlay.errorMessage).toBe('No KPI data yet');
    expect(overlay.errorHint).toBe('Upload activities with training load to calculate this metric.');
    expect(nativeElement.querySelector('.kpi-row-status')).toBeNull();
  });

  it('uses the shared loading overlay while compact KPI data is loading', async () => {
    component.compactRow = true;
    component.isLoading = true;
    component.acwr = null;

    fixture.detectChanges();
    await fixture.whenStable();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const overlay = getLoadingOverlay();

    expect(component.showNoDataError).toBe(true);
    expect(overlay.isLoading).toBe(true);
    expect(overlay.hasError).toBe(false);
    expect(overlay.showSkeleton).toBe(false);
    expect(nativeElement.querySelector('.kpi-row-status')).toBeNull();
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
    expect(component.primaryLabel).toBe('Same-day TSB');
    expect(component.primaryValueText).toBe('-2.4');
  });

  it('renders Fitness CTL KPI presentation', async () => {
    component.chartType = DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE;
    component.fitnessCtl = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: 58.42,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 52.8 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Fitness (CTL)');
    expect(component.primaryLabel).toBe('CTL');
    expect(component.secondaryLabel).toBe('42-day TSS load');
    expect(component.primaryValueText).toBe('58.4');
  });

  it('renders Fatigue ATL KPI presentation', async () => {
    component.chartType = DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE;
    component.fatigueAtl = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: 71.37,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 62.4 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Fatigue (ATL)');
    expect(component.primaryLabel).toBe('ATL');
    expect(component.secondaryLabel).toBe('7-day TSS load');
    expect(component.primaryValueText).toBe('71.4');
  });

  it('renders Load Status as a current-state KPI presentation', async () => {
    component.chartType = DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE;
    component.formNow = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: -4,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: -2 }],
    };
    component.rampRate = {
      latestDayMs: Date.UTC(2026, 0, 1),
      ctlToday: 62,
      ctl7DaysAgo: 58,
      rampRate: 4,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 3 }],
    };
    component.fitnessCtl = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: 62,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 58 }],
    };
    component.fatigueAtl = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: 66,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 60 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Load Status');
    expect(component.primaryValueText).toBe('Building');
    expect(component.primaryLabel).toBe('Productive load');
    expect(component.secondaryValueText).toContain('TSB -4');
    expect(component.secondaryValueText).toContain('Ramp +4');
  });

  it('renders Fitness Trend KPI presentation', async () => {
    component.chartType = DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE;
    component.fitnessCtl = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: 58,
      trend8Weeks: [
        { time: Date.UTC(2025, 11, 1), value: 50 },
        { time: Date.UTC(2025, 11, 8), value: 52 },
        { time: Date.UTC(2025, 11, 15), value: 54 },
        { time: Date.UTC(2025, 11, 22), value: 56 },
        { time: Date.UTC(2025, 11, 29), value: 58 },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Fitness Trend');
    expect(component.primaryLabel).toBe('CTL delta (4w)');
    expect(component.primaryValueText).toBe('+8');
    expect(component.secondaryValueText).toBe('58');
  });

  it('renders Fatigue Trend KPI presentation', async () => {
    component.chartType = DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE;
    component.fatigueAtl = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: 72,
      trend8Weeks: [
        { time: Date.UTC(2025, 11, 22), value: 66 },
        { time: Date.UTC(2025, 11, 29), value: 72 },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Fatigue Trend');
    expect(component.primaryLabel).toBe('ATL delta (1w)');
    expect(component.primaryValueText).toBe('+6');
    expect(component.secondaryValueText).toBe('72');
  });

  it('renders Recovery Debt from freshness forecast zero-load projection', async () => {
    component.chartType = DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE;
    component.formNow = {
      latestDayMs: Date.UTC(2026, 0, 1),
      value: -12,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: -8 }],
    };
    component.freshnessForecast = {
      generatedAtMs: Date.UTC(2026, 0, 1),
      points: [
        { dayMs: Date.UTC(2026, 0, 1), trainingStressScore: 0, ctl: 55, atl: 67, formSameDay: -12, formPriorDay: -10, isForecast: false },
        { dayMs: Date.UTC(2026, 0, 2), trainingStressScore: 0, ctl: 54, atl: 60, formSameDay: -6, formPriorDay: -12, isForecast: true },
        { dayMs: Date.UTC(2026, 0, 3), trainingStressScore: 0, ctl: 53, atl: 52, formSameDay: 1, formPriorDay: -6, isForecast: true },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Recovery Debt');
    expect(component.primaryValueText).toBe('2 d');
    expect(component.secondaryLabel).toBe('TSB now');
    expect(component.secondaryValueText).toBe('-12');
  });

  it('renders Training Balance from the latest intensity distribution split', async () => {
    component.chartType = DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE;
    component.intensityDistribution = {
      latestWeekStartMs: Date.UTC(2026, 0, 1),
      latestEasyPercent: 64,
      latestModeratePercent: 22,
      latestHardPercent: 14,
      weeks: [],
    };
    component.hardPercent = {
      latestWeekStartMs: Date.UTC(2026, 0, 1),
      value: 14,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 12 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.title).toBe('Training Balance');
    expect(component.primaryValueText).toBe('Balanced');
    expect(component.secondaryValueText).toBe('Easy 64% / Moderate 22% / Hard 14%');
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
    expect(component.primaryLabel).toBe('Projected same-day TSB');
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
      fixture.detectChanges();
      await fixture.whenStable();
      await (component as any).refreshChart();

      const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
      const option = latestSetOptionArgs.find((arg) => (
        !!arg
        && typeof arg === 'object'
        && 'tooltip' in (arg as Record<string, unknown>)
      )) as Record<string, any> | undefined;

      expect(option?.tooltip?.triggerOn).toBe('click');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('trims null trend edges and clamps sparkline x-axis to data bounds', async () => {
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = {
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 210,
      chronicLoad28: 190,
      ratio: 1.11,
      trend8Weeks: [
        { time: Date.UTC(2025, 10, 24), value: null },
        { time: Date.UTC(2025, 11, 1), value: 0.9 },
        { time: Date.UTC(2025, 11, 8), value: 1.0 },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();

    expect(mockLoader.setOption.mock.calls.length).toBeGreaterThan(0);
    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'series' in (arg as Record<string, unknown>)
      && 'xAxis' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;

    expect(option).toBeTruthy();
    expect(option?.xAxis?.min).toBe('dataMin');
    expect(option?.xAxis?.max).toBe('dataMax');
    expect(option?.xAxis?.boundaryGap).toBe(false);
    expect(option?.grid?.bottom).toBe(2);
    expect(option?.series?.[0]?.data).toEqual([
      [Date.UTC(2025, 11, 1), 0.9],
      [Date.UTC(2025, 11, 8), 1.0],
    ]);
  });

  it('formats weekly sparkline tooltip headings with week number and exact range', async () => {
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
    component.acwr = {
      latestDayMs: Date.UTC(2026, 3, 6),
      acuteLoad7: 210,
      chronicLoad28: 190,
      ratio: 1.11,
      trend8Weeks: [
        { time: Date.UTC(2026, 3, 6), value: 1.11 },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();

    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'tooltip' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;
    const formatter = option?.tooltip?.formatter as ((params: Array<{ data?: [number, number | null] }>) => string);

    const tooltipHtml = formatter([{ data: [Date.UTC(2026, 3, 6), 1.11] }]);
    expect(tooltipHtml).toContain('Week 15,');
    expect(tooltipHtml).toContain('Apr');
    expect(tooltipHtml).toContain('2026 -');
    expect(tooltipHtml).not.toContain('Week of Apr 6');
  });

  it('shows the info tooltip when clicking the KPI layout', () => {
    vi.useFakeTimers();
    const tooltip = {
      show: vi.fn(),
      hide: vi.fn(),
    } as unknown as MatTooltip;
    component.infoTooltip = 'KPI info';
    component.infoTooltipDirective = tooltip;

    component.onKpiLayoutClick(new MouseEvent('click'));

    expect((tooltip.show as any)).toHaveBeenCalledWith(0);
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2200);
    expect((tooltip.hide as any)).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  it('triggers haptics when info button is clicked', () => {
    const stopPropagation = vi.fn();
    component.infoTooltip = 'KPI info';
    component.infoTooltipDirective = {
      show: vi.fn(),
      hide: vi.fn(),
    } as unknown as MatTooltip;

    component.onInfoButtonClick({ stopPropagation } as unknown as MouseEvent);

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('renders thinner sparkline with chart-type color accents', async () => {
    component.chartType = DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE;
    component.hardPercent = {
      latestWeekStartMs: Date.UTC(2026, 0, 1),
      value: 14.3,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 12.2 }],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();

    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'series' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;

    expect(option).toBeTruthy();
    expect(option?.series?.[0]?.lineStyle?.width).toBe(1);
    expect(option?.series?.[0]?.lineStyle?.color).toBe('#e65100');
    expect(option?.series?.[0]?.areaStyle?.color?.type).toBe('linear');
  });

  it('adds a below-zero band and zero guide line when sparkline includes negative values', async () => {
    component.chartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
    component.formNow = {
      latestDayMs: Date.UTC(2026, 2, 9),
      value: -14.9,
      trend8Weeks: [
        { time: Date.UTC(2026, 1, 26), value: 4.2 },
        { time: Date.UTC(2026, 2, 5), value: -3.6 },
        { time: Date.UTC(2026, 2, 9), value: -14.9 },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();

    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'series' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;

    expect(option).toBeTruthy();
    expect(option?.series?.[0]?.markLine?.data).toEqual([{ yAxis: 0 }]);
    expect(option?.series?.[0]?.markArea?.data).toEqual([
      [{ yAxis: -14.9 }, { yAxis: 0 }],
    ]);
    expect(option?.yAxis?.min).toBeLessThan(-14.9);
    expect(option?.yAxis?.max).toBeGreaterThan(4.2);
  });

  it('keeps zero baseline visible when sparkline window is entirely negative', async () => {
    component.chartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
    component.formNow = {
      latestDayMs: Date.UTC(2026, 2, 9),
      value: -7.2,
      trend8Weeks: [
        { time: Date.UTC(2026, 1, 26), value: -2.1 },
        { time: Date.UTC(2026, 2, 5), value: -5.4 },
        { time: Date.UTC(2026, 2, 9), value: -7.2 },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await (component as any).refreshChart();

    const latestSetOptionArgs = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = latestSetOptionArgs.find((arg) => (
      !!arg
      && typeof arg === 'object'
      && 'series' in (arg as Record<string, unknown>)
    )) as Record<string, any> | undefined;

    expect(option).toBeTruthy();
    expect(option?.series?.[0]?.markLine?.data).toEqual([{ yAxis: 0 }]);
    expect(option?.series?.[0]?.markArea?.data).toEqual([
      [{ yAxis: -7.2 }, { yAxis: 0 }],
    ]);
    expect(option?.yAxis?.min).toBeLessThan(-7.2);
    expect(option?.yAxis?.max).toBeGreaterThanOrEqual(0);
  });
});
