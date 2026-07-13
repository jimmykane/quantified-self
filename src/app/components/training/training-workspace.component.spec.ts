import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NEVER, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppEventService } from '../../services/app.event.service';
import { AppThemeService } from '../../services/app.theme.service';
import {
  DashboardDerivedMetricsService,
  createDashboardDerivedMetricsMissingState,
  TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
  type DashboardDerivedMetricsState,
} from '../../services/dashboard-derived-metrics.service';
import { TrainingWorkspaceComponent } from './training-workspace.component';

describe('TrainingWorkspaceComponent', () => {
  it('renders the fixed training workspace without dashboard tile rendering', async () => {
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formPoints: [],
      formStatus: 'ready', recoveryNowStatus: 'ready', acwrStatus: 'ready', rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready', formNowStatus: 'ready', formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready', hardPercentStatus: 'ready', efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready', intensityDistributionStatus: 'ready', efficiencyTrendStatus: 'ready',
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: 0,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppEventService, useValue: { getEventsBy: vi.fn(() => of([])) } },
        { provide: AppSleepService, useValue: { watchForDashboard: vi.fn(() => of([])) } },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture: ComponentFixture<TrainingWorkspaceComponent> = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#training-title')?.textContent?.trim()).toBe('Training');
    expect(element.textContent).toContain('Compared with your usual 28 days');
    expect(element.textContent).toContain('Notable changes');
    expect(element.textContent).toContain('How your load is changing');
    expect(element.textContent).toContain('Where your effort is going');
    expect(element.textContent).toContain('Progress with provenance');
    expect(element.querySelector('app-tile-chart')).toBeNull();
    expect(element.querySelector('.training-mix-panel')).toBeNull();
    expect(element.querySelector('.training-capacity-panel')).toBeNull();
    expect(element.textContent).toContain('No eligible running or cycling sessions in the last 28 days.');
    expect(element.textContent).toContain('No capacity trend yet.');
    expect(derivedMetrics.ensureForDashboard).toHaveBeenCalledTimes(1);
  });

  it('renders the workspace and requests snapshots when the derived stream has not emitted yet', async () => {
    const derivedMetrics = { watch: vi.fn(() => NEVER), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppEventService, useValue: { getEventsBy: vi.fn(() => of([])) } },
        { provide: AppSleepService, useValue: { watchForDashboard: vi.fn(() => of([])) } },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.isLoading).toBe(false);
    expect(fixture.nativeElement.querySelector('#training-title')?.textContent?.trim()).toBe('Training');
    expect(fixture.nativeElement.textContent).toContain('Reading your recent running and cycling sessions.');
    expect(fixture.nativeElement.querySelectorAll('[role="status"]').length).toBe(1);
    expect(fixture.nativeElement.textContent).not.toContain('What changed from your normal');
    expect(derivedMetrics.ensureForDashboard).toHaveBeenCalledWith(
      { uid: 'user-1' },
      expect.objectContaining({ trainingSummaryStatus: 'missing' }),
      { metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS },
    );
  });

  it('distinguishes benchmark card states and formats comparison deltas without a chart', () => {
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      { open: vi.fn() } as any,
      { markForCheck: vi.fn() } as any,
    );
    const selection = { mode: 'period' as const, durationWeeks: 12 as const, endDayMs: Date.UTC(2025, 5, 1) };
    const readySource = {
      discipline: 'running' as const,
      status: 'ready' as const,
      selection: {
        ...selection,
        selectionKey: 'period:12:1748736000000',
        windowStartDayMs: Date.UTC(2025, 3, 8),
        windowEndDayMs: Date.UTC(2025, 5, 1),
        label: null,
      },
      current: null,
      benchmark: null,
      suggestedRaces: [],
    } as any;

    component.derivedState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingBuildComparisonStatus: 'ready',
    };
    expect((component as any).resolveTrainingBuildCardState('running', null, null)).toBe('not-configured');
    expect((component as any).resolveTrainingBuildCardState('running', readySource, selection)).toBe('ready');
    expect((component as any).resolveTrainingBuildCardState('running', readySource, {
      mode: 'period', durationWeeks: 10, endDayMs: Date.UTC(2025, 5, 1),
    })).toBe('updating');
    expect((component as any).resolveTrainingBuildCardState('running', { ...readySource, status: 'invalid-selection' }, selection)).toBe('invalid');

    component.derivedState = { ...component.derivedState, trainingBuildComparisonStatus: 'building' };
    expect((component as any).resolveTrainingBuildCardState('running', null, selection)).toBe('updating');
    component.derivedState = { ...component.derivedState, trainingBuildComparisonStatus: 'failed' };
    expect((component as any).resolveTrainingBuildCardState('running', null, selection)).toBe('unavailable');
    expect(component.formatTrainingBuildDelta(14, 10)).toBe('+4');
    expect(component.formatTrainingBuildDurationDelta(5_400, 3_600)).toBe('+30m');
    expect((component as any).formatTrainingBuildActiveWeeks(8, 12)).toBe('8 / 12');
    expect((component as any).formatTrainingBuildActiveWeeks(8, null)).toBe('--');

    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
      format: (value: Date) => value.toISOString().slice(0, 10),
    } as unknown as Intl.DateTimeFormat));
    try {
      expect((component as any).formatTrainingBuildRange(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)))
        .toBe('2026-01-01 – 2026-01-02');
      expect(dateTimeFormat).toHaveBeenCalledWith(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    } finally {
      dateTimeFormat.mockRestore();
    }
  });

  it('keeps derived metric listeners active after the initial user change', async () => {
    const derivedState$ = new Subject<DashboardDerivedMetricsState>();
    const derivedMetrics = { watch: vi.fn(() => derivedState$), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppEventService, useValue: { getEventsBy: vi.fn(() => of([])) } },
        { provide: AppSleepService, useValue: { watchForDashboard: vi.fn(() => of([])) } },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    derivedState$.next({
      ...createDashboardDerivedMetricsMissingState(),
      formNow: { latestDayMs: null, value: 8.5, trend8Weeks: [] },
      formStatus: 'ready', recoveryNowStatus: 'ready', acwrStatus: 'ready', rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready', formNowStatus: 'ready', formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready', hardPercentStatus: 'ready', efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready', intensityDistributionStatus: 'ready', efficiencyTrendStatus: 'ready',
      trainingSummaryStatus: 'stale',
      trainingSummary: {
        asOfDayMs: 0,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    });

    fixture.detectChanges();
    expect(fixture.componentInstance.derivedState.formNow?.value).toBe(8.5);
    expect(fixture.componentInstance.trainingComparisonState).toBe('updating');
    expect(fixture.nativeElement.textContent).toContain('Updating your training comparison');
  });
});
