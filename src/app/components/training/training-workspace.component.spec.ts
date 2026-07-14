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
    expect(element.textContent).toContain('Settings vs recent evidence');
    expect(element.querySelector('app-tile-chart')).toBeNull();
    expect(element.querySelector('.training-mix-panel')).toBeNull();
    expect(element.querySelector('.training-capacity-panel')).toBeNull();
    expect(element.textContent).toContain('No eligible running, cycling/MTB, or swimming sessions in the last 28 days.');
    expect(element.textContent).toContain('Preparing capacity evidence');
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
    expect(fixture.nativeElement.textContent).toContain('Reading your recent running, cycling/MTB, and swimming sessions.');
    expect(fixture.nativeElement.querySelectorAll('[role="status"]').length).toBe(2);
    expect(fixture.nativeElement.textContent).not.toContain('What changed from your normal');
    expect(derivedMetrics.ensureForDashboard).toHaveBeenCalledWith(
      { uid: 'user-1' },
      expect.objectContaining({ trainingSummaryStatus: 'missing' }),
      { metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS },
    );
  });

  it('renders FTP as an imported setting and a lower modeled CP as unvalidated evidence', async () => {
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: { asOfDayMs: 0, currentWindowDays: 28, baselineWindowDays: 84, disciplines: [] },
      trainingCapacityStatus: 'ready',
      trainingCapacity: {
        asOfDayMs: Date.UTC(2026, 6, 13),
        disciplines: [{
          discipline: 'running', ftpSetting: null, importedVo2Max: null,
          modeledCriticalPower: {
            status: 'insufficient-evidence', valueWatts: null, valueWattsPerKg: null, wPrimeJoules: null,
            confidence: null, windowDays: 90, sourceEventCount: 0, anchorPointCount: 0,
            minDurationSeconds: null, maxDurationSeconds: null, rSquared: null, normalizedRmse: null,
          },
        }, {
          discipline: 'cycling',
          ftpSetting: {
            kind: 'ftp-setting', value: 222, sourceKey: 'garmin', provenance: 'imported-activity-stat',
            firstSeenAtMs: Date.UTC(2026, 0, 1), lastSeenAtMs: Date.UTC(2026, 6, 12), observationCount: 12,
            previousValue: null, previousAtMs: null, previousSourceKey: null, changePct: null,
          },
          importedVo2Max: null,
          modeledCriticalPower: {
            status: 'ready', valueWatts: 186, valueWattsPerKg: null, wPrimeJoules: 18_000,
            confidence: 'high', windowDays: 90, sourceEventCount: 4, anchorPointCount: 5,
            minDurationSeconds: 180, maxDurationSeconds: 1_200, rSquared: 0.98, normalizedRmse: 0.03,
          },
        }],
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

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('FTP setting');
    expect(text).toContain('Cycling capacity evidence');
    expect(text).toContain('222 W');
    expect(text).toContain('Modeled critical power');
    expect(text).toContain('186 W');
    expect(text).toContain('Recent efforts have not validated this FTP yet');
    expect(text).toContain('16% below the imported setting');
    expect(text).toContain('does not show that fitness declined.');
  });

  it('filters every sport-specific module while leaving global training sections visible', async () => {
    const window = (activityCount: number) => ({
      periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, activityCount,
      durationSeconds: 3600, easySeconds: 1800, moderateSeconds: 900, hardSeconds: 900,
    });
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: 2,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [
          { discipline: 'running', current28d: window(3), baseline28d: window(3) },
          { discipline: 'cycling', current28d: window(4), baseline28d: window(4) },
        ],
      },
      trainingCapacityStatus: 'ready',
      trainingCapacity: {
        asOfDayMs: 2,
        disciplines: [
          {
            discipline: 'running', ftpSetting: null, importedVo2Max: null,
            modeledCriticalPower: {
              status: 'insufficient-evidence', valueWatts: null, valueWattsPerKg: null, wPrimeJoules: null,
              confidence: null, windowDays: 90, sourceEventCount: 0, anchorPointCount: 0,
              minDurationSeconds: null, maxDurationSeconds: null, rSquared: null, normalizedRmse: null,
            },
          },
          {
            discipline: 'cycling', ftpSetting: null, importedVo2Max: null,
            modeledCriticalPower: {
              status: 'insufficient-evidence', valueWatts: null, valueWattsPerKg: null, wPrimeJoules: null,
              confidence: null, windowDays: 90, sourceEventCount: 0, anchorPointCount: 0,
              minDurationSeconds: null, maxDurationSeconds: null, rSquared: null, normalizedRmse: null,
            },
          },
        ],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: of({ uid: 'user-1', settings: { trainingSettings: { visibleDisciplines: ['cycling'] } } }) },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: { watchForDashboard: vi.fn(() => of([])) } },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Cycling');
    expect(element.querySelectorAll('.training-build-card')).toHaveLength(1);
    expect(element.querySelectorAll('.training-mix-panel')).toHaveLength(1);
    expect(element.textContent).toContain('Cycling capacity evidence');
    expect(element.textContent).not.toContain('Running capacity evidence');
    expect(element.querySelector('app-power-curve-chart[title="Cycling Power Curve"]')).not.toBeNull();
    expect(element.querySelector('app-power-curve-chart[title="Running Power Curve"]')).toBeNull();
    expect(element.textContent).toContain('Running, cycling/MTB, and swimming');
    expect(element.textContent).toContain('All activities with TSS');
    expect(element.textContent).toContain('Intensity chart uses all eligible zone data');
  });

  it('renders Swimming-only detail cards without capacity or power placeholders', async () => {
    const window = (activityCount: number) => ({
      periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, activityCount,
      durationSeconds: activityCount ? 3_600 : 0, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
    });
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: 2, currentWindowDays: 28, baselineWindowDays: 84,
        disciplines: [
          { discipline: 'running', current28d: window(2), baseline28d: window(2) },
          { discipline: 'cycling', current28d: window(2), baseline28d: window(2) },
          { discipline: 'swimming', current28d: window(3), baseline28d: window(2) },
        ],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: of({ uid: 'user-1', settings: { trainingSettings: { visibleDisciplines: ['swimming'] } } }) },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: { watchForDashboard: vi.fn(() => of([])) } },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.training-build-card')).toHaveLength(1);
    expect(element.querySelectorAll('.training-mix-panel')).toHaveLength(1);
    expect(element.querySelector('app-training-swim-performance-chart')).not.toBeNull();
    expect(element.querySelector('app-power-curve-chart')).toBeNull();
    expect(element.textContent).not.toContain('Preparing capacity evidence');
    expect(element.textContent).not.toContain('capacity evidence');
    expect(element.textContent).toContain('Running, cycling/MTB, and swimming');
  });

  it('applies a saved visibility result immediately while settings propagation catches up', () => {
    const afterClosed = new Subject<{ saved: true; visibleDisciplines: ['cycling'] }>();
    const dialogRef = { afterClosed: () => afterClosed };
    const dialog = { open: vi.fn(() => dialogRef) };
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      dialog as any,
      { markForCheck: vi.fn() } as any,
    );
    component.derivedState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: 2, currentWindowDays: 28, baselineWindowDays: 84,
        disciplines: [{
          discipline: 'running',
          current28d: {
            periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, activityCount: 2,
            durationSeconds: 1, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
          },
          baseline28d: {
            periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, activityCount: 2,
            durationSeconds: 1, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
          },
        }],
      },
    };
    (component as any).refreshSportSpecificViewModels();
    expect(component.visibleDisciplines).toEqual(['running']);

    component.openTrainingSportVisibilityDialog();
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: { visibleDisciplines: ['running'], isAutomatic: true },
    }));
    afterClosed.next({ saved: true, visibleDisciplines: ['cycling'] });

    expect(component.visibleDisciplines).toEqual(['cycling']);
    expect(component.isAutomaticSportVisibility).toBe(false);
  });

  it('does not retain a pending override when settings propagated before the dialog result', () => {
    const afterClosed = new Subject<{ saved: true; visibleDisciplines: ['cycling'] }>();
    const dialog = { open: vi.fn(() => ({ afterClosed: () => afterClosed })) };
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      dialog as any,
      { markForCheck: vi.fn() } as any,
    );
    (component as any).trainingSettings = { visibleDisciplines: ['cycling'] };

    component.openTrainingSportVisibilityDialog();
    afterClosed.next({ saved: true, visibleDisciplines: ['cycling'] });

    expect((component as any).pendingTrainingVisibleDisciplines).toBeUndefined();
    (component as any).trainingSettings = { visibleDisciplines: ['running'] };
    (component as any).reconcilePendingTrainingSportVisibility();
    (component as any).refreshSportSpecificViewModels();
    expect(component.visibleDisciplines).toEqual(['running']);
  });

  it('releases a pending override when a newer persisted choice arrives from another tab', () => {
    const afterClosed = new Subject<{ saved: true; visibleDisciplines: ['cycling'] }>();
    const dialog = { open: vi.fn(() => ({ afterClosed: () => afterClosed })) };
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      dialog as any,
      { markForCheck: vi.fn() } as any,
    );

    component.openTrainingSportVisibilityDialog();
    afterClosed.next({ saved: true, visibleDisciplines: ['cycling'] });
    expect(component.visibleDisciplines).toEqual(['cycling']);

    (component as any).trainingSettings = { visibleDisciplines: ['running'] };
    (component as any).reconcilePendingTrainingSportVisibility();
    (component as any).refreshSportSpecificViewModels();

    expect((component as any).pendingTrainingVisibleDisciplines).toBeUndefined();
    expect(component.visibleDisciplines).toEqual(['running']);
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
    expect((component as any).resolveTrainingBuildEventSuggestionsState(null)).toBe('loading');
    expect((component as any).resolveTrainingBuildEventSuggestionsState(readySource)).toBe('ready');
    expect((component as any).resolveTrainingBuildCardState('running', null, null)).toBe('not-configured');
    expect((component as any).resolveTrainingBuildCardState('running', readySource, selection)).toBe('ready');
    expect((component as any).resolveTrainingBuildCardState('running', readySource, {
      mode: 'period', durationWeeks: 10, endDayMs: Date.UTC(2025, 5, 1),
    })).toBe('updating');
    expect((component as any).resolveTrainingBuildCardState('running', { ...readySource, status: 'invalid-selection' }, selection)).toBe('invalid');

    component.derivedState = { ...component.derivedState, trainingBuildComparisonStatus: 'building' };
    expect((component as any).resolveTrainingBuildCardState('running', null, selection)).toBe('updating');
    component.derivedState = { ...component.derivedState, trainingBuildComparisonStatus: 'failed' };
    expect((component as any).resolveTrainingBuildEventSuggestionsState(null)).toBe('unavailable');
    expect((component as any).resolveTrainingBuildCardState('running', null, selection)).toBe('unavailable');
    expect(component.formatTrainingBuildDelta(14, 10)).toBe('+4');
    expect(component.formatTrainingBuildDurationDelta(5_400, 3_600)).toBe('+30m');
    expect((component as any).formatTrainingBuildActiveWeeks(8, 12)).toBe('8 / 12');
    expect((component as any).formatTrainingBuildActiveWeeks(8, null)).toBe('--');

    const swimWindow = {
      periodWeeks: 12, windowStartDayMs: 1, windowEndDayMs: 2, activityCount: 4,
      durationSeconds: 10_000, distanceMeters: 8_000, distanceEventCount: 4,
      trainingStressScore: null, trainingStressScoreEventCount: 0, activeWeekCount: 4,
      longestActivityDurationSeconds: 3_000, easySeconds: null, moderateSeconds: null, hardSeconds: null,
      intensitySourceEventCount: 0, efficiency: 2, efficiencySampleCount: 4,
      poolAveragePaceSecondsPer100m: 95, poolPaceActivityCount: 3,
      openWaterAveragePaceSecondsPer100m: null, openWaterPaceActivityCount: 0,
    };
    const swimRows = (component as any).buildTrainingBuildMetricRows({
      current: swimWindow,
      benchmark: { ...swimWindow, poolAveragePaceSecondsPer100m: 100 },
    }, 'swimming');
    expect(swimRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Pool pace', deltaText: '0:05 /100m faster' }),
      expect.objectContaining({ label: 'Open-water pace', currentText: '--', benchmarkText: '--' }),
    ]));
    expect(swimRows).not.toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Power / HR' })]));

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

  it('updates an open benchmark dialog when event suggestions arrive', () => {
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      { open: vi.fn() } as any,
      { markForCheck: vi.fn() } as any,
    );
    const updateEventSuggestions = vi.fn();
    const suggestedEvent = {
      eventId: 'event-1',
      startDayMs: Date.UTC(2025, 7, 20),
      label: 'New event',
      distanceMeters: 80_000,
      durationSeconds: 10_800,
      trainingStressScore: 220,
    };
    component.derivedState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingBuildComparisonStatus: 'ready',
      trainingBuildComparison: {
        asOfDayMs: Date.UTC(2026, 0, 2),
        disciplines: [
          {
            discipline: 'running', status: 'not-configured', selection: null, current: null, benchmark: null,
            suggestedRaces: [], suggestedEvents: [],
          },
          {
            discipline: 'cycling', status: 'not-configured', selection: null, current: null, benchmark: null,
            suggestedRaces: [], suggestedEvents: [suggestedEvent],
          },
        ],
      },
    } as any;
    (component as any).trainingBuildBenchmarkDialogRef = { componentInstance: { updateEventSuggestions } };
    (component as any).trainingBuildBenchmarkDialogDiscipline = 'cycling';

    (component as any).refreshTrainingBuildCards();

    expect(updateEventSuggestions).toHaveBeenCalledWith({
      asOfDayMs: Date.UTC(2026, 0, 2),
      suggestedRaces: [],
      suggestedEvents: [suggestedEvent],
      state: 'ready',
    });
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
