import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LOCALE_ID, NO_ERRORS_SCHEMA } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BehaviorSubject, concat, NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemes, DistanceUnits } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { SLEEP_PROVIDERS, type SleepSession } from '@shared/sleep';
import type {
  DerivedTrainingDurabilityMetricPayload,
  TrainingBuildBenchmarkSelection,
} from '@shared/derived-metrics';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import {
  DashboardDerivedMetricsService,
  createDashboardDerivedMetricsMissingState,
  TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
  type DashboardDerivedMetricsState,
} from '../../services/dashboard-derived-metrics.service';
import { TrainingWorkspaceComponent } from './training-workspace.component';
import { TrainingMetricTextComponent } from './training-metric-text.component';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { MetricIndicatorComponent } from '../shared/metric-indicator/metric-indicator.component';

function createSleepService(sessions: readonly SleepSession[] = []) {
  return {
    watchForDashboard: vi.fn(() => of([...sessions])),
  };
}

function createRouteReadyDerivedState(
  overrides: Partial<DashboardDerivedMetricsState> = {},
): DashboardDerivedMetricsState {
  return {
    ...createDashboardDerivedMetricsMissingState(),
    formStatus: 'ready',
    recoveryNowStatus: 'ready',
    acwrStatus: 'ready',
    rampRateStatus: 'ready',
    monotonyStrainStatus: 'ready',
    formNowStatus: 'ready',
    formPlus7dStatus: 'ready',
    freshnessForecastStatus: 'ready',
    intensityDistributionStatus: 'ready',
    trainingSummaryStatus: 'ready',
    trainingBuildComparisonStatus: 'ready',
    trainingCapacityStatus: 'ready',
    trainingExplanationStatus: 'ready',
    trainingDurabilityStatus: 'ready',
    trainingReadinessStatus: 'ready',
    bodyWeightTrendStatus: 'ready',
    powerCurveStatus: 'ready',
    trainingSwimPerformanceStatus: 'ready',
    trainingPowerSystemsStatus: 'ready',
    ...overrides,
  };
}

function createExcludedCyclingDurabilityPayload(): DerivedTrainingDurabilityMetricPayload {
  const coverage = {
    candidateActivityCount: 2,
    evidenceActivityCount: 2,
    eligibleActivityCount: 0,
    missingEvidenceActivityCount: 0,
    excludedActivityCount: 2,
    eligibilityRatio: 0,
    exclusions: [
      { reason: 'missing-output', activityCount: 1 },
      { reason: 'insufficient-duration', activityCount: 1 },
    ],
  };
  const window = (periodDays: 28 | 7) => ({
    periodDays,
    windowStartDayMs: 1,
    windowEndDayMs: 2,
    coverage,
    summaries: [],
  });
  return {
    dayBoundary: 'UTC',
    asOfDayMs: 2,
    currentWindowDays: 28,
    baselineBlockCount: 3,
    weeklyPointCount: 12,
    excludesMergedEvents: true,
    excludesFutureEvents: true,
    evidenceSource: 'persisted-activity-stat',
    scopes: [{
      scope: 'cycling',
      current: window(28),
      baselineBlocks: Array.from({ length: 3 }, () => window(28)),
      usual: { coverage, summaries: [] },
      weeks: Array.from({ length: 12 }, () => window(7)),
      recentSupportingEvents: [],
    }],
  };
}

describe('TrainingWorkspaceComponent', () => {
  let analyticsService: { logEvent: ReturnType<typeof vi.fn> };

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    analyticsService = { logEvent: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MatMenuModule, MatTooltipModule, PageHeaderComponent],
      providers: [{ provide: AppAnalyticsService, useValue: analyticsService }],
    });
  });

  it('renders the fixed training workspace without dashboard tile rendering', async () => {
    const trainingSummaryAsOfDayMs = Date.UTC(2026, 7, 6);
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formPoints: [],
      recoveryNow: {
        totalSeconds: 7_200,
        endTimeMs: Date.now(),
      },
      formStatus: 'ready', recoveryNowStatus: 'ready', acwrStatus: 'ready', rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready', formNowStatus: 'ready', formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready', hardPercentStatus: 'ready', efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready', intensityDistributionStatus: 'ready', efficiencyTrendStatus: 'ready',
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: trainingSummaryAsOfDayMs,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
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
    expect(element.querySelector('.qs-page-header__leading-icon')?.textContent?.trim()).toBe('monitoring');
    expect(element.querySelector('.qs-page-header__subtitle')).toBeNull();
    const feedbackAction = element.querySelector('.training-feedback-action');
    expect(feedbackAction?.getAttribute('aria-label')).toBe('Send feedback about Training to support');
    expect(feedbackAction?.getAttribute('href')).toContain('mailto:');
    expect(feedbackAction?.getAttribute('href')).toContain('subject=Training%20feedback');
    expect(feedbackAction?.getAttribute('target')).toBe('_blank');
    const calendarAction = element.querySelector('.training-calendar-action');
    expect(calendarAction?.getAttribute('aria-label')).toBe('Open activity calendar');
    expect(calendarAction?.querySelector('mat-icon')?.textContent?.trim()).toBe('calendar_month');
    expect(element.querySelector('.training-dashboard-action')?.getAttribute('aria-label')).toBe('Return to dashboard');
    const sportVisibilityAction = element.querySelector('.training-sport-visibility-action');
    expect(sportVisibilityAction?.getAttribute('aria-label')).toContain('Choose sports shown.');
    expect(sportVisibilityAction?.querySelector('.training-sport-visibility-action-label')?.textContent?.trim()).toBe('No sports');
    expect(element.textContent).toContain('No sport-specific details · Overall comparison uses all training');
    expect(element.textContent).toContain('No sport-specific benchmark cards qualify yet');
    const template = readFileSync(resolve(process.cwd(), 'src/app/components/training/training-workspace.component.html'), 'utf8');
    for (const actionClass of [
      'training-sport-visibility-action',
      'training-feedback-action',
      'training-calendar-action',
      'training-dashboard-action',
    ]) {
      expect(template).toMatch(new RegExp(`<[^>]+mat-button[^>]+class="${actionClass}"`, 's'));
      expect(template).not.toMatch(new RegExp(`<[^>]+mat-stroked-button[^>]+class="${actionClass}"`, 's'));
    }
    expect(element.textContent).toContain('Compared with your usual 28 days');
    expect(element.querySelector('.training-readiness-method')?.textContent).toContain('Freshness stays TSS-only');
    expect(element.textContent).toContain('What drove this');
    expect(element.textContent).toContain('How your load is changing');
    expect(element.textContent).toContain('Where your effort is going');
    expect(element.textContent).not.toContain('Settings vs recent evidence');
    expect(element.textContent).toContain('Recorded body weight');
    const performanceGrid = element.querySelector('.training-performance-grid');
    const bodyContextSection = element.querySelector('.training-body-context-section');
    expect(performanceGrid).toBeNull();
    expect(bodyContextSection?.querySelector('.training-body-weight-panel')).not.toBeNull();
    expect(element.querySelector('main.training-workspace')?.lastElementChild).toBe(bodyContextSection);
    expect(element.querySelector('app-durability-reading-guide[context="training"]')).toBeNull();
    expect(element.querySelector('app-tile-chart')).toBeNull();
    expect(fixture.componentInstance.freshnessForecastInfoTooltip).toContain('training-load only');
    const recoveryContext = element.querySelector('.training-recovery-context');
    const importedRecovery = recoveryContext?.querySelector('.training-readiness-imported-recovery');
    const sleepHistory = recoveryContext?.querySelector('.training-recovery-history');
    const sleepHistoryDetails = sleepHistory?.querySelector('#training-recovery-history-details') as HTMLElement | null;
    expect(recoveryContext?.querySelector('#training-recovery-context-title')?.textContent).toContain('Recovery context');
    expect(element.querySelector('.training-readiness-source')?.nextElementSibling).toBe(recoveryContext);
    expect(importedRecovery?.textContent).toContain('Recovery left');
    expect(importedRecovery?.textContent).toContain('remaining · until');
    expect(importedRecovery?.textContent).toContain('Imported post-workout estimate');
    expect(importedRecovery?.textContent).toContain('separate from Readiness and Freshness');
    expect(sleepHistory?.querySelector('#training-recovery-history-title')?.textContent).toContain('Sleep history');
    expect(importedRecovery?.nextElementSibling).toBe(sleepHistory);
    expect(sleepHistoryDetails?.hidden).toBe(true);
    expect((importedRecovery as HTMLElement | null)?.hidden).toBe(false);
    expect(element.querySelector('#training-recovery-history-details .training-readiness-imported-recovery')).toBeNull();
    const sleepDetailsButton = sleepHistory?.querySelector('button') as HTMLButtonElement | null;
    expect(sleepDetailsButton?.textContent).toContain('Show sleep details');
    sleepDetailsButton?.click();
    fixture.detectChanges();
    expect(sleepDetailsButton?.textContent).toContain('Hide sleep details');
    expect(sleepHistoryDetails?.hidden).toBe(false);
    expect(element.querySelector('.training-status-grid .training-recovery-estimate-panel')).toBeNull();
    expect(element.querySelector('.training-mix-panel')).toBeNull();
    expect(element.querySelector('.training-capacity-panel')).toBeNull();
    expect(element.textContent).toContain('No eligible sport workouts in the last 28 days.');
    expect(element.textContent).not.toContain('Preparing imported capacity markers');
    expect(element.textContent).toContain('Preparing rolling power capacity');
    expect(element.querySelector('.training-power-systems-section')).not.toBeNull();
    expect(derivedMetrics.ensureForDashboard).toHaveBeenCalledTimes(1);
  });

  it('shows the validated training-summary cutoff when the route is ready', async () => {
    const trainingSummaryAsOfDayMs = Date.UTC(2026, 7, 6);
    const derivedState = createRouteReadyDerivedState({
      trainingSummary: {
        asOfDayMs: trainingSummaryAsOfDayMs,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    });
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
        { provide: LOCALE_ID, useValue: 'en-GB' },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture: ComponentFixture<TrainingWorkspaceComponent> = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const expectedAsOfDate = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(trainingSummaryAsOfDayMs));
    const title = fixture.nativeElement.querySelector('#training-title');
    const subtitle = fixture.nativeElement.querySelector('.qs-page-header__subtitle');
    expect(subtitle?.textContent?.trim())
      .toBe(`Data through ${expectedAsOfDate}`);
    expect(subtitle?.previousElementSibling?.classList).toContain('qs-page-header__title-row');
    expect(subtitle?.previousElementSibling?.querySelector('#training-title')).toBe(title);
  });

  it('keeps every route-header action in one compact row through tablet widths', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/training/training-workspace.component.scss');
    const styles = readFileSync(stylePath, 'utf8');
    const compactActionsStart = styles.indexOf('@media (max-width: 800px)');
    const extraSmallLayoutStart = styles.indexOf('@media (max-width: 400px)', compactActionsStart);
    const compactActionsStyles = styles.slice(compactActionsStart, extraSmallLayoutStart);

    expect(compactActionsStart).toBeGreaterThan(-1);
    expect(extraSmallLayoutStart).toBeGreaterThan(compactActionsStart);
    expect(compactActionsStyles).toContain('.training-sport-visibility-action,');
    expect(compactActionsStyles).toContain('.training-sport-visibility-action-label,');
    expect(compactActionsStyles).toContain('.training-page-actions .training-sport-visibility-action mat-icon,');
    expect(compactActionsStyles).toContain('.training-calendar-action,');
    expect(compactActionsStyles).toContain('.training-calendar-action-label,');
    expect(compactActionsStyles).toContain('.training-page-actions .training-calendar-action mat-icon,');
    expect(compactActionsStyles).toContain('flex-wrap: nowrap;');
    expect(compactActionsStyles).toContain('width: 48px;');
  });

  it('keeps the mobile header actions close to the first section divider', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/training/training-workspace.component.scss');
    const styles = readFileSync(stylePath, 'utf8');
    const mobileHeaderRule = styles.match(/@media \(max-width: 640px\) \{ \.training-page-header \{([^}]*)\}/)?.[1];

    expect(mobileHeaderRule).toContain('margin-bottom: 8px;');
  });

  it('separates adjacent Training Mix sport contexts with matching dividers', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/training/training-workspace.component.scss');
    const styles = readFileSync(stylePath, 'utf8');
    const adjacentContextRule = styles.match(/\.training-mix-contexts section \+ section \{([^}]*)\}/)?.[1];

    expect(styles).toContain('--training-mix-context-divider-color: color-mix(in srgb, var(--mat-sys-outline) 28%, transparent);');
    expect(adjacentContextRule).toContain('padding-top: 12px;');
    expect(adjacentContextRule).toContain('border-top: 1px solid var(--training-mix-context-divider-color);');
  });

  it('renders activity-family icons only for sport-specific training driver cards', async () => {
    const coverage = {
      totalCount: 4,
      loadedCount: 4,
      classifiedCount: 4,
      unclassifiedCount: 0,
      ratio: 1,
    };
    const currentMetrics = {
      parentEventCount: 4,
      parentLoadEventCount: 4,
      parentTrainingStressScore: 300,
      parentLoadCoverage: coverage,
      childActivityCount: 4,
      childLoadActivityCount: 4,
      childTrainingStressScore: 300,
      childLoadCoverage: coverage,
      sportLoads: [{
        sport: 'cycling' as const,
        label: 'Cycling',
        activityCount: 4,
        loadActivityCount: 4,
        trainingStressScore: 300,
        loadSharePercent: 100,
      }],
      rhythms: [{
        discipline: 'running' as const,
        sessionCount: 3,
        activeDayCount: 10,
        activeWeekCount: 4,
        longestInactivityGapDays: 3,
        longestSessionDurationSeconds: 7_200,
      }],
    };
    const baselineMetrics = {
      ...currentMetrics,
      parentTrainingStressScore: 200,
      childTrainingStressScore: 200,
      sportLoads: [{
        ...currentMetrics.sportLoads[0],
        activityCount: 3,
        loadActivityCount: 3,
        trainingStressScore: 200,
      }],
      rhythms: [{
        ...currentMetrics.rhythms[0],
        sessionCount: 2,
        activeDayCount: 8,
      }],
    };
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: 0,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
      trainingExplanationStatus: 'ready',
      trainingExplanation: {
        dayBoundary: 'UTC',
        asOfDayMs: 2,
        currentWindowDays: 28,
        baselineBlockCount: 3,
        excludesMergedEvents: true,
        excludesMissingDates: true,
        excludesFutureEvents: true,
        current: {
          periodDays: 28,
          windowStartDayMs: 1,
          windowEndDayMs: 2,
          ...currentMetrics,
        },
        baselineBlocks: Array.from({ length: 3 }, () => ({
          periodDays: 28 as const,
          windowStartDayMs: 1,
          windowEndDayMs: 2,
          ...baselineMetrics,
        })),
        baselineMedian: baselineMetrics,
        topContributors: [{
          eventId: 'event-1',
          label: 'Long ride',
          startDayMs: 1,
          trainingStressScore: 150,
          loadSharePercent: 50,
          childComposition: currentMetrics.sportLoads,
        }],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    const cards = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.training-insight-panel'),
    );
    const sportCards = cards.filter(card => /Cycling load|Running rhythm/u.test(card.textContent || ''));
    const globalCards = cards.filter(card => /Overall load|Top contributors/u.test(card.textContent || ''));
    const icons = sportCards.map(card => card.querySelector<HTMLElement>('app-activity-type-icon'));

    expect(sportCards).toHaveLength(2);
    expect(icons.every(Boolean)).toBe(true);
    expect(icons.map(icon => icon?.getAttribute('aria-hidden'))).toEqual(['true', 'true']);
    expect(icons.map(icon => (icon as HTMLElement & { activityType?: string })?.activityType))
      .toEqual(['Cycling', 'Running']);
    expect(globalCards).toHaveLength(2);
    expect(globalCards.every(card => card.querySelector('app-activity-type-icon') === null)).toBe(true);
  });

  it('keeps the last complete Training state visible but labels it while the Form/TSS refresh is building', async () => {
    const nowMs = Date.UTC(2026, 6, 19, 12);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formStatus: 'building',
      formPoints: [
        {
          time: nowMs - (7 * 24 * 60 * 60 * 1000),
          trainingStressScore: 40,
          ctl: 100,
          atl: 98,
          formSameDay: 2,
          formPriorDay: 1,
        },
        {
          time: nowMs,
          trainingStressScore: 60,
          ctl: 102,
          atl: 98,
          formSameDay: 4,
          formPriorDay: 3,
        },
      ],
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: nowMs,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    try {
      await TestBed.configureTestingModule({
        declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
        imports: [MetricIndicatorComponent],
        providers: [
          { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
          { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
          { provide: AppSleepService, useValue: createSleepService() },
          { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();

      const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
      fixture.detectChanges();

      const statePanel = fixture.nativeElement.querySelector('.training-state-panel') as HTMLElement;
      expect(statePanel.textContent).toContain('Building');
      expect(statePanel.textContent).toContain('Updating from the latest completed TSS calculation');
      expect(statePanel.querySelector('.training-state-value-row > strong')?.textContent?.trim()).toBe('Building');
      expect(statePanel.querySelector('.training-state-value-row app-metric-indicator')).toBeNull();
      const infoButton = statePanel.querySelector('.training-state-info-button');
      expect(infoButton?.getAttribute('aria-label')).toBe('How Building is calculated');
      expect(fixture.componentInstance.trainingStatus.stateInfo.tooltip).toContain('CTL minus ATL');
      expect(fixture.componentInstance.trainingStatus.stateInfo.tooltip).toContain('Form +4 (CTL 102 − ATL 98)');
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses the bounded sleep-only readiness path without loading event or activity history', async () => {
    const nowMs = Date.UTC(2026, 6, 16, 12);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const createSession = (
      id: string,
      daysAgo: number,
      score: number,
      averageHrvMs: number,
      minimumHeartRateBpm: number,
    ): SleepSession => {
      const endTimeMs = nowMs - (daysAgo * 24 * 60 * 60 * 1000) - (6 * 60 * 60 * 1000);
      const startTimeMs = endTimeMs - (8 * 60 * 60 * 1000);
      return {
        id,
        userID: 'user-1',
        source: {
          provider: SLEEP_PROVIDERS.GarminAPI,
          sourceSessionKey: id,
          providerUserId: 'garmin-user-1',
        },
        sleepDate: new Date(endTimeMs).toISOString().slice(0, 10),
        startTimeMs,
        endTimeMs,
        durationSeconds: 8 * 60 * 60,
        isNap: false,
        stages: [],
        stageDurationsSeconds: {},
        score: { value: score },
        vitals: { averageHrvMs, minimumHeartRateBpm },
        createdAtMs: endTimeMs,
        updatedAtMs: endTimeMs,
      };
    };
    const sleepSessions = [
      createSession('baseline-6', 6, 75, 50, 50),
      createSession('baseline-5', 5, 75, 50, 50),
      createSession('baseline-4', 4, 75, 50, 50),
      createSession('baseline-3', 3, 75, 50, 50),
      createSession('baseline-2', 2, 75, 50, 50),
      createSession('baseline-1', 1, 75, 50, 50),
      createSession('latest', 0, 90, 55, 48),
    ];
    const sleepService = createSleepService(sleepSessions);
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formNowStatus: 'ready',
      formNow: { latestDayMs: nowMs, value: 10, trend8Weeks: [] },
      rampRateStatus: 'ready',
      rampRate: { rampRate: 1 } as any,
      trainingReadinessStatus: 'ready',
      trainingReadiness: {
        formulaVersion: 3,
        dayBoundary: 'UTC',
        asOfDayMs: Date.UTC(2026, 6, 16),
        generatedAtMs: nowMs - 1000,
        historyDays: 14,
        points: Array.from({ length: 14 }, (_, index) => ({
          dayMs: Date.UTC(2026, 6, 3 + index),
          score: 70,
          label: 'Mixed',
          confidence: 'medium',
          availableSignalCount: 4,
          baselineEvidenceCount: 3,
          totalSignalCount: 4,
          form: 5,
          rampRate: 1,
          sleepScore: 80,
          latestSleepAtMs: Date.UTC(2026, 6, 3 + index, 6),
          hrvRatio: 1,
          averageHeartRateRatio: 1,
          minimumHeartRateRatio: 1,
          overnightHeartRateRatio: 1,
        })),
      },
      trainingSummaryStatus: 'ready',
      trainingSummary: {
        asOfDayMs: nowMs,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    try {
      await TestBed.configureTestingModule({
        declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
        providers: [
          { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
          { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
          { provide: AppSleepService, useValue: sleepService },
          { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();

      const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
      fixture.detectChanges();

      expect(sleepService.watchForDashboard).toHaveBeenCalledWith(
        'user-1',
        nowMs - (30 * 24 * 60 * 60 * 1000),
        Number.MAX_SAFE_INTEGER,
      );
      const panel = fixture.nativeElement.querySelector('.training-readiness-panel') as HTMLElement;
      expect(panel.textContent).toContain('Readiness today');
      expect(panel.textContent).toContain('Ready');
      expect(panel.textContent).toContain('4/4 signals');
      expect(panel.textContent).toContain('Sleep');
      expect(panel.textContent).toContain('90/100');
      expect(panel.textContent).toContain('+10%');
      expect(panel.textContent).toContain('-4%');
      expect(panel.textContent).toContain('14-day trend');
      expect(panel.textContent).toContain('14/14 days scored');
      expect(panel.textContent).toContain('browser does not load workout history');
      expect(panel.querySelector('app-training-readiness-trend-chart')).not.toBeNull();
      expect(panel.querySelector('svg.training-readiness-trend')).toBeNull();
      expect(fixture.nativeElement.querySelector('.training-recovery-panel')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('.training-current-context-grid > article')).toHaveLength(1);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a sleep read failure separately while retaining load-only readiness', async () => {
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formNowStatus: 'ready',
      formNow: { latestDayMs: Date.now(), value: 10, trend8Weeks: [] },
      rampRateStatus: 'ready',
      rampRate: { rampRate: 1 } as never,
      trainingReadinessStatus: 'failed',
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };
    const sleepService = {
      watchForDashboard: vi.fn(() => throwError(() => new Error('sleep read failed'))),
    };
    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: sleepService },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.training-readiness-panel') as HTMLElement;

    expect(panel.textContent).toContain('showing available load signals only');
    expect(panel.textContent).toContain('Recorded sleep evidence could not be loaded');
    fixture.destroy();
  });

  it('retains eligible sleep evidence when the live listener fails after loading', async () => {
    const nowMs = Date.now();
    const sleepSession = {
      id: 'retained-sleep',
      userID: 'user-1',
      source: {
        provider: SLEEP_PROVIDERS.GarminAPI,
        sourceSessionKey: 'retained-sleep',
        providerUserId: 'garmin-user-1',
      },
      sleepDate: new Date(nowMs).toISOString().slice(0, 10),
      startTimeMs: nowMs - (9 * 60 * 60 * 1000),
      endTimeMs: nowMs - (60 * 60 * 1000),
      durationSeconds: 8 * 60 * 60,
      isNap: false,
      stages: [],
      stageDurationsSeconds: {},
      score: { value: 88 },
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    } as SleepSession;
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formNowStatus: 'ready',
      formNow: { latestDayMs: nowMs, value: 10, trend8Weeks: [] },
      rampRateStatus: 'ready',
      rampRate: { rampRate: 1 } as never,
      trainingReadinessStatus: 'failed',
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };
    const sleepService = {
      watchForDashboard: vi.fn(() => concat(
        of([sleepSession]),
        throwError(() => new Error('listener disconnected')),
      )),
    };
    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: sleepService },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.training-readiness-panel') as HTMLElement;

    expect(panel.textContent).toContain('88/100');
    expect(panel.textContent).toContain('showing the last loaded evidence');
    fixture.destroy();
  });

  it('shows failed current load reads separately from missing readiness evidence', async () => {
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formNowStatus: 'failed',
      rampRateStatus: 'failed',
      trainingReadinessStatus: 'failed',
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };
    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Current load evidence could not be loaded');
    fixture.destroy();
  });

  it('requests readiness projections and the body-weight trend at the next UTC day', async () => {
    const nowMs = Date.UTC(2026, 6, 16, 23, 59, 59, 500);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      formNowStatus: 'ready',
      formNow: { latestDayMs: Date.UTC(2026, 6, 16), value: 10, trend8Weeks: [] },
      rampRateStatus: 'ready',
      rampRate: { rampRate: 1 } as never,
      trainingReadinessStatus: 'ready',
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    try {
      await TestBed.configureTestingModule({
        declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
        providers: [
          { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
          { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
          { provide: AppSleepService, useValue: createSleepService() },
          { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();
      const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
      fixture.detectChanges();
      derivedMetrics.ensureForDashboard.mockClear();

      await vi.advanceTimersByTimeAsync(502);

      expect(derivedMetrics.ensureForDashboard).toHaveBeenCalledWith(
        { uid: 'user-1' },
        derivedState,
        {
          force: true,
          metricKinds: [
            'form_now',
            'ramp_rate',
            'form_plus_7d',
            'freshness_forecast',
            'training_readiness',
            'body_weight_trend',
          ],
        },
      );
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the workspace and requests snapshots when the derived stream has not emitted yet', async () => {
    const derivedMetrics = { watch: vi.fn(() => NEVER), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.isLoading).toBe(false);
    expect(fixture.nativeElement.querySelector('#training-title')?.textContent?.trim()).toBe('Training');
    expect(fixture.nativeElement.querySelector('.training-derived-metrics-status')?.textContent)
      .toContain('Building derived metrics');
    expect(fixture.nativeElement.textContent).toContain('Reading your recent workouts across the Training sport groups.');
    expect(fixture.nativeElement.querySelectorAll('[role="status"]').length).toBeGreaterThanOrEqual(3);
    expect(fixture.nativeElement.textContent).toContain('Preparing training drivers');
    expect(fixture.nativeElement.textContent).toContain('Preparing load chart');
    expect(fixture.nativeElement.textContent).not.toContain('Preparing cycling power profile');
    expect(fixture.nativeElement.querySelector('.training-performance-grid')).toBeNull();
    expect(fixture.nativeElement.querySelector('.training-power-systems-section')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Preparing rolling power capacity');
    expect(fixture.nativeElement.querySelector('app-form-chart')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-power-curve-chart')).toBeNull();
    expect(derivedMetrics.ensureForDashboard).toHaveBeenCalledWith(
      { uid: 'user-1' },
      expect.objectContaining({ trainingSummaryStatus: 'missing' }),
      { metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS },
    );
  });

  it('renders FTP only as an imported setting and does not retain the old modeled CP card', async () => {
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: { asOfDayMs: 0, currentWindowDays: 28, baselineWindowDays: 84, disciplines: [] },
      trainingCapacityStatus: 'ready',
      trainingCapacity: {
        asOfDayMs: Date.UTC(2026, 6, 13),
        disciplines: [{
          discipline: 'running', ftpSetting: null, importedVo2Max: null,
        }, {
          discipline: 'cycling',
          ftpSetting: {
            kind: 'ftp-setting', value: 222, sourceKey: 'garmin', provenance: 'imported-activity-stat',
            firstSeenAtMs: Date.UTC(2026, 0, 1), lastSeenAtMs: Date.UTC(2026, 6, 12), observationCount: 12,
            previousValue: null, previousAtMs: null, previousSourceKey: null, changePct: null,
          },
          importedVo2Max: null,
        }],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: of({ uid: 'user-1', settings: { trainingSettings: { visibleDisciplines: ['cycling'] } } }) },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
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
    expect(text).toContain('not a new Quantified Self estimate');
    expect(text).not.toContain('Modeled critical power');
    expect(text).not.toContain('186 W');
  });

  it('renders exact-type rolling power systems for every account independently of Training sport visibility', async () => {
    const asOfDayMs = Date.UTC(2026, 6, 20);
    const powerSystemsEntry = (
      activityType: string,
      criticalPowerWatts: number,
      wPrimeUnstable = false,
    ) => {
      const current = {
        effectiveDayMs: asOfDayMs,
        status: wPrimeUnstable ? 'partial' as const : 'ready' as const,
        reason: wPrimeUnstable ? 'unstable-w-prime-fit' as const : null,
        activityType,
        sourceFingerprint: 'three-dimensional-capacity:0123456789abcdef',
        criticalPower: { status: 'ready' as const, reason: null, value: criticalPowerWatts },
        wPrime: wPrimeUnstable
          ? {
              status: 'unstable' as const,
              reason: 'unstable-w-prime-fit' as const,
              value: null,
            }
          : { status: 'ready' as const, reason: null, value: 18_500 },
        maximumPower: wPrimeUnstable
          ? {
              status: 'insufficient-evidence' as const,
              reason: 'unstable-w-prime-fit' as const,
              value: null,
            }
          : { status: 'ready' as const, reason: null, value: 1_200 },
        diagnostics: {
          sourceCount: 3,
          historyStartDayMs: asOfDayMs - (30 * 24 * 60 * 60 * 1000),
          historyEndDayMs: asOfDayMs - (24 * 60 * 60 * 1000),
          historySpanDays: 29,
          rejectedPointCount: 0,
          rejectedShortPowerSpikePointCount: 0,
          criticalPowerAnchorCount: 8,
          earlyCriticalPowerAnchorCount: 4,
          longCriticalPowerAnchorCount: 3,
          criticalPowerContributingSourceCount: 2,
          maximumPowerAnchorCount: 8,
          maximumPowerContributingSourceCount: 2,
          criticalPowerNormalizedRmse: 0.02,
          criticalPowerSpreadRatio: 0.01,
          wPrimeSpreadRatio: 0.04,
          wPrimeCandidateCount: wPrimeUnstable ? 3 : 0,
          wPrimeCandidateMinimumJoules: wPrimeUnstable ? 10_017 : null,
          wPrimeCandidateMaximumJoules: wPrimeUnstable ? 14_410 : null,
          criticalPowerLeaveOneOutSpreadRatio: 0.02,
          wPrimeLeaveOneOutSpreadRatio: 0.08,
          criticalPowerSourceRemovalFitCount: 2,
          criticalPowerSourceRemovalFailureCount: 0,
          criticalPowerSourceRemovalMaximumChangeRatio: 0.03,
          wPrimeSourceRemovalMaximumChangeRatio: 0.1,
          maximumPowerNormalizedRmse: 0.02,
          maximumPowerLeaveOneOutSpreadRatio: 0.04,
        },
      };
      return {
        activityType,
        current,
        history: [{
          effectiveDayMs: asOfDayMs - (7 * 24 * 60 * 60 * 1000),
          status: 'ready' as const,
          reason: null,
          criticalPowerStatus: 'ready' as const,
          criticalPowerWatts: criticalPowerWatts - 5,
          wPrimeStatus: 'ready' as const,
          wPrimeJoules: 18_000,
          maximumPowerStatus: 'ready' as const,
          maximumPowerWatts: 1_180,
        }, {
          effectiveDayMs: asOfDayMs,
          status: current.status,
          reason: current.reason,
          criticalPowerStatus: current.criticalPower.status,
          criticalPowerWatts: current.criticalPower.value,
          wPrimeStatus: current.wPrime.status,
          wPrimeJoules: current.wPrime.value,
          maximumPowerStatus: current.maximumPower.status,
          maximumPowerWatts: current.maximumPower.value,
        }],
        evidenceCounts: {
          candidateActivityCount: 4,
          usableCurveActivityCount: 3,
          excludedActivityCount: 1,
        },
      };
    };
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSummary: { asOfDayMs, currentWindowDays: 28, baselineWindowDays: 84, disciplines: [] },
      trainingPowerSystemsStatus: 'ready',
      trainingPowerSystems: {
        dayBoundary: 'UTC',
        asOfDayMs,
        policyVersion: 1,
        windowDays: 42,
        historyDays: 84,
        cadence: 'workout-date',
        excludesEffectiveDay: true,
        excludesMergedEvents: true,
        activityTypes: [
          powerSystemsEntry('Cycling', 260, true),
          powerSystemsEntry('Rowing', 280),
        ],
      },
    };
    const derivedStateSubject = new Subject<DashboardDerivedMetricsState>();
    const authUser$ = new BehaviorSubject({
      uid: 'user-1',
      settings: { trainingSettings: { visibleDisciplines: ['swimming'] } },
    });
    const derivedMetrics = {
      watch: vi.fn(() => derivedStateSubject.asObservable()),
      ensureForDashboard: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: authUser$ },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    derivedStateSubject.next(derivedState);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.trainingPowerSystemsActivityTypes.map(item => item.activityType)).toEqual(['Cycling', 'Rowing']);
    expect(component.selectedTrainingPowerSystemsActivityType).toBe('Cycling');
    expect(fixture.nativeElement.querySelectorAll('.training-power-systems-trend')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('260 W');
    expect(fixture.nativeElement.textContent).toContain('Critical power is usable');
    expect(fixture.nativeElement.textContent).toContain('W′ changes too much');
    expect(fixture.nativeElement.textContent).toContain('What this means');
    expect(fixture.nativeElement.textContent).toContain('from 10.0 to 14.4 kJ');
    expect(fixture.nativeElement.textContent).toContain('Pmax is intentionally unavailable');
    expect(fixture.nativeElement.textContent).toContain('Unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('All sports');

    fixture.debugElement.query(By.css('mat-select')).triggerEventHandler('selectionChange', { value: 'Rowing' });
    fixture.detectChanges();

    expect(component.selectedTrainingPowerSystems?.activityType).toBe('Rowing');
    expect(fixture.nativeElement.textContent).toContain('Rowing');
    expect(fixture.nativeElement.textContent).toContain('280 W');
    expect(fixture.nativeElement.textContent).toContain('not TSS, FTP, fitness, fatigue, or readiness');

    derivedStateSubject.next({
      ...derivedState,
      trainingPowerSystems: {
        ...derivedState.trainingPowerSystems!,
        activityTypes: [derivedState.trainingPowerSystems!.activityTypes[1]],
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Modeled sustained-power boundary');
    expect(fixture.nativeElement.querySelectorAll('.training-power-systems-evidence li').length)
      .toBeGreaterThan(3);

    authUser$.next({
      uid: 'user-2',
      settings: { trainingSettings: { visibleDisciplines: ['swimming'] } },
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.training-power-systems-section')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Preparing rolling power capacity');
  });

  it('filters every sport-specific module while leaving global training sections visible', async () => {
    const window = (activityCount: number) => ({
      periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, activityCount,
      durationSeconds: 3600, easySeconds: 1800, moderateSeconds: 900, hardSeconds: 900,
    });
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      powerCurveStatus: 'ready',
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
          },
          {
            discipline: 'cycling', ftpSetting: null, importedVo2Max: null,
          },
        ],
      },
    };
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: of({ uid: 'user-1', settings: { trainingSettings: { visibleDisciplines: ['cycling'] } } }) },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Cycling');
    expect(element.querySelectorAll('.training-build-card')).toHaveLength(1);
    const benchmarkAction = element.querySelector('.training-build-benchmark-action');
    expect(benchmarkAction?.getAttribute('aria-label')).toBe('Set Cycling benchmark');
    expect(benchmarkAction?.querySelector('.training-build-benchmark-action-label')?.textContent?.trim())
      .toBe('Set benchmark');
    expect(element.querySelectorAll('.training-mix-panel')).toHaveLength(1);
    expect(element.querySelector('.training-mix-grid')?.classList.contains('training-mix-grid--single')).toBe(true);
    expect(element.querySelector('.training-mix-panel')?.classList.contains('training-mix-panel--single')).toBe(true);
    expect(element.querySelector('.training-mix-zone-comparison')?.textContent).toContain('Intensity balance');
    expect(element.querySelectorAll('.training-mix-zone-track')).toHaveLength(3);
    expect(element.textContent).toContain('Cycling capacity evidence');
    expect(element.textContent).not.toContain('Running capacity evidence');
    expect(element.querySelector('app-power-curve-chart[title="Cycling Power Curve"]')).not.toBeNull();
    expect(element.querySelector('app-power-curve-chart[title="Running Power Curve"]')).toBeNull();
    expect(element.textContent).toContain('Cycling/MTB details · Overall comparison uses all training');
    expect(element.textContent).toContain('TSS-backed workouts only');
    expect(element.textContent).toContain('Intensity chart uses all eligible zone data');
  });

  it('renders Cycling exclusion evidence and its trajectory in fixed sport mode', async () => {
    const trainingDurability = createExcludedCyclingDurabilityPayload();
    const derivedState = createRouteReadyDerivedState({
      trainingSummary: {
        asOfDayMs: 2,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
      trainingDurability,
    });
    const derivedMetrics = { watch: vi.fn(() => of(derivedState)), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: of({ uid: 'user-1', settings: { trainingSettings: { visibleDisciplines: ['cycling'] } } }) },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.trainingDurabilityScopes[0].contexts).toHaveLength(1);
    expect(element.querySelector('app-training-durability-trajectory-chart')).not.toBeNull();
    expect(element.textContent).toContain('Cycling · Power');
    expect(element.textContent).toContain('No recorded power 1');
    expect(element.textContent).toContain('Too short 1');
    expect(element.textContent).not.toContain('Preparing durability evidence');
  });

  it('keeps automatic Cycling durability visible while retained snapshots refresh', async () => {
    const window = (activityCount: number) => ({
      periodDays: 28,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
      activityCount,
      durationSeconds: activityCount ? 3_600 : 0,
      easySeconds: 0,
      moderateSeconds: 0,
      hardSeconds: 0,
    });
    const trainingSummary = {
      asOfDayMs: 2,
      currentWindowDays: 28,
      baselineWindowDays: 84,
      disciplines: [{ discipline: 'cycling' as const, current28d: window(2), baseline28d: window(2) }],
    };
    const trainingDurability = createExcludedCyclingDurabilityPayload();
    const derivedState = new BehaviorSubject(createRouteReadyDerivedState({ trainingSummary, trainingDurability }));
    const derivedMetrics = { watch: vi.fn(() => derivedState.asObservable()), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.visibleDisciplines).toEqual(['cycling']);

    derivedState.next(createRouteReadyDerivedState({
      trainingSummary,
      trainingSummaryStatus: 'building',
      trainingDurability,
      trainingDurabilityStatus: 'building',
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.visibleDisciplines).toEqual(['cycling']);
    expect(fixture.nativeElement.querySelector('app-training-durability-trajectory-chart')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Updating durability evidence');
  });

  it('renders Swimming-only detail cards without capacity or power placeholders', async () => {
    const window = (activityCount: number) => ({
      periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, activityCount,
      durationSeconds: activityCount ? 3_600 : 0, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
    });
    const derivedState: DashboardDerivedMetricsState = {
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'ready',
      trainingSwimPerformanceStatus: 'ready',
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
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        {
          provide: AppAuthService,
          useValue: { user$: of({ uid: 'user-1', settings: { trainingSettings: { visibleDisciplines: ['swimming'] } } }) },
        },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
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
    expect(element.textContent).toContain('Swimming details · Overall comparison uses all training');
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
      null,
      analyticsService as any,
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
    expect(analyticsService.logEvent).toHaveBeenCalledWith('training_sport_visibility_saved', {
      selection_mode: 'fixed',
      selection_count: 1,
    });
  });

  it('opens the benchmark picker as a wide dialog bounded by the viewport', () => {
    const afterClosed = new Subject<{ saved: true; selection: null }>();
    const dialog = { open: vi.fn(() => ({ afterClosed: () => afterClosed })) };
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      dialog as any,
      { markForCheck: vi.fn() } as any,
      null,
      analyticsService as any,
    );

    component.toggleTrainingBuildRecovery('cycling');
    component.openTrainingBuildBenchmarkDialog('cycling');

    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      width: '720px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      data: expect.objectContaining({ discipline: 'cycling' }),
    }));
    afterClosed.next({ saved: true, selection: null });
    expect(component.trainingBuildRecoveryExpanded.cycling).toBe(false);
    expect(analyticsService.logEvent).toHaveBeenCalledWith('training_benchmark_saved', {
      action: 'cleared',
      discipline: 'cycling',
    });
  });

  it('opens Training state details in a viewport-bounded dialog for mobile', () => {
    const dialogRef = { afterClosed: () => of(undefined) };
    const dialog = { open: vi.fn(() => dialogRef) };
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      dialog as any,
      { markForCheck: vi.fn() } as any,
    );
    (component as any).trainingStateDetailsDialogTemplate = {};
    const stopPropagation = vi.fn();

    component.openTrainingStateDetailsDialog({ stopPropagation } as unknown as MouseEvent);

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ariaLabel: 'Training state details',
      autoFocus: false,
      maxWidth: '340px',
      restoreFocus: true,
      width: 'calc(100vw - 32px)',
    }));
  });

  it('records only the non-identifying benchmark configuration after a saved selection', () => {
    const afterClosed = new Subject<{ saved: true; selection: TrainingBuildBenchmarkSelection }>();
    const dialog = { open: vi.fn(() => ({ afterClosed: () => afterClosed })) };
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      dialog as any,
      { markForCheck: vi.fn() } as any,
      null,
      analyticsService as any,
    );

    component.openTrainingBuildBenchmarkDialog('swimming');
    afterClosed.next({
      saved: true,
      selection: { mode: 'period', durationWeeks: 12, endDayMs: Date.UTC(2026, 6, 18) },
    });

    expect(analyticsService.logEvent).toHaveBeenCalledWith('training_benchmark_saved', {
      action: 'set',
      discipline: 'swimming',
      reference_mode: 'period',
      duration_weeks: 12,
    });
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
    expect(component.formatTrainingBuildDurationDelta(3_600, 3_600)).toBe('Same');
    expect((component as any).formatTrainingBuildActiveWeeks(8, 12)).toBe('8 / 12');
    expect((component as any).formatTrainingBuildActiveWeeks(8, null)).toBe('--');

    component.derivedState = { ...component.derivedState, trainingBuildComparisonStatus: 'ready' };
    const recoveryComparison = {
      sameProvider: true,
      isComparable: true,
      current: {
        periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, provider: 'GarminAPI',
        recordedNightCount: 20, expectedNightCount: 28, coverage: 'sufficient',
        averageSleepSeconds: 8 * 3600, typicalLocalStartMinutes: 22 * 60, typicalLocalEndMinutes: 6 * 60, bedtimeVariationMinutes: 30,
        medianOvernightHrvMs: 60, overnightHrvNightCount: 20,
      },
      reference: {
        periodDays: 84, windowStartDayMs: 1, windowEndDayMs: 2, provider: 'GarminAPI',
        recordedNightCount: 50, expectedNightCount: 84, coverage: 'sufficient',
        averageSleepSeconds: 7 * 3600, typicalLocalStartMinutes: (22 * 60) + 15, typicalLocalEndMinutes: (6 * 60) + 15, bedtimeVariationMinutes: 45,
        medianOvernightHrvMs: 50, overnightHrvNightCount: 50,
      },
    };
    const recoveryView = (component as any).buildTrainingRecoveryViewModel(recoveryComparison, 'Now', 'Usual');
    expect(recoveryView).toMatchObject({ state: 'ready', isUpdating: false });
    expect(recoveryView.compactText).toBe('Sleep 1h 00m longer per night · Overnight HRV +10 ms');
    expect(recoveryView.metricRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Sleep / night', currentText: '8h 00m', deltaText: '+1h 00m', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Typical sleep window', currentText: '22:00\n06:00', referenceText: '22:15\n06:15', deltaText: '15m earlier', deltaTone: 'neutral' }),
      expect.objectContaining({ label: 'Recorded nights', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Bedtime variation', deltaText: '15m steadier', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Overnight HRV', deltaText: '+10 ms', deltaTone: 'positive' }),
    ]));
    expect(recoveryView.sourceText).toContain('Garmin');
    expect(recoveryView.sourceText).toContain('naps are excluded');

    const missingBedtimeRecoveryView = (component as any).buildTrainingRecoveryViewModel({
      ...recoveryComparison,
      reference: {
        ...recoveryComparison.reference,
        bedtimeVariationMinutes: null,
      },
    }, 'Now', 'Benchmark');
    expect(missingBedtimeRecoveryView.metricRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Bedtime variation', referenceText: '--', deltaText: '--' }),
      expect.objectContaining({ label: 'Overnight HRV', referenceText: '50 ms', deltaText: '+10 ms' }),
    ]));
    expect(missingBedtimeRecoveryView.detailText).toBe(
      'Recorded sleep coverage supports comparison where matching metrics are available.',
    );
    expect(missingBedtimeRecoveryView.sourceText).toContain(
      'Bedtime variation and the typical sleep window need at least five nights with local start and end times.',
    );
    expect(missingBedtimeRecoveryView.sourceText).not.toContain('Overnight HRV needs');

    const missingHrvRecoveryView = (component as any).buildTrainingRecoveryViewModel({
      ...recoveryComparison,
      reference: {
        ...recoveryComparison.reference,
        medianOvernightHrvMs: null,
        overnightHrvNightCount: 0,
      },
    }, 'Now', 'Benchmark');
    expect(missingHrvRecoveryView.metricRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Bedtime variation', referenceText: '±45m', deltaText: '15m steadier' }),
      expect.objectContaining({ label: 'Overnight HRV', referenceText: '--', deltaText: '--' }),
    ]));
    expect(missingHrvRecoveryView.sourceText).toContain(
      'Overnight HRV needs at least five nights that include HRV data.',
    );
    expect(missingHrvRecoveryView.sourceText).not.toContain('Bedtime variation needs');

    const bedtimeOnlyRecoveryView = (component as any).buildTrainingRecoveryViewModel({
      ...recoveryComparison,
      current: {
        ...recoveryComparison.current,
        averageSleepSeconds: null,
        medianOvernightHrvMs: null,
        overnightHrvNightCount: 0,
      },
      reference: {
        ...recoveryComparison.reference,
        averageSleepSeconds: null,
        medianOvernightHrvMs: null,
        overnightHrvNightCount: 0,
      },
    }, 'Now', 'Benchmark');
    expect(bedtimeOnlyRecoveryView.compactText).toBe('Bedtime 15m steadier');

    const similarSleepRecoveryView = (component as any).buildTrainingRecoveryViewModel({
      ...recoveryComparison,
      current: {
        ...recoveryComparison.current,
        averageSleepSeconds: recoveryComparison.reference.averageSleepSeconds + (10 * 60),
        bedtimeVariationMinutes: null,
        medianOvernightHrvMs: null,
        overnightHrvNightCount: 0,
      },
      reference: {
        ...recoveryComparison.reference,
        bedtimeVariationMinutes: null,
        medianOvernightHrvMs: null,
        overnightHrvNightCount: 0,
      },
    }, 'Now', 'Benchmark');
    expect(similarSleepRecoveryView.compactText).toBe('Sleep is similar per night');

    const lowerRecoveryView = (component as any).buildTrainingRecoveryViewModel({
      ...recoveryComparison,
      current: {
        ...recoveryComparison.current,
        recordedNightCount: 14,
        averageSleepSeconds: 6 * 3600,
        bedtimeVariationMinutes: 60,
        medianOvernightHrvMs: 40,
      },
    }, 'Now', 'Usual');
    expect(lowerRecoveryView.metricRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Sleep / night', deltaTone: 'negative' }),
      expect.objectContaining({ label: 'Recorded nights', deltaTone: 'negative' }),
      expect.objectContaining({ label: 'Bedtime variation', deltaText: '15m more variable', deltaTone: 'negative' }),
      expect.objectContaining({ label: 'Overnight HRV', deltaTone: 'negative' }),
    ]));
    expect((component as any).resolveTrainingComparisonDeltaTone(100.4, 100, 'direct', 0.5)).toBe('neutral');
    expect((component as any).resolveTrainingComparisonDeltaTone(null, 100)).toBe('neutral');
    expect((component as any).formatTrainingRecoveryCoverageDelta(
      { ...recoveryComparison.current, recordedNightCount: 21 },
      { ...recoveryComparison.reference, recordedNightCount: 62 },
    )).toBe('+1 pt');
    expect((component as any).formatTrainingRecoveryCoverageDelta(
      { ...recoveryComparison.current, expectedNightCount: 0 },
      recoveryComparison.reference,
    )).toBe('--');
    expect((component as any).resolveTrainingRecoveryCoverageDeltaTone(
      { ...recoveryComparison.current, expectedNightCount: 0 },
      recoveryComparison.reference,
    )).toBe('neutral');

    component.derivedState = { ...component.derivedState, trainingBuildComparisonStatus: 'failed' };
    const failedRecoveryView = (component as any).buildTrainingRecoveryViewModel(recoveryComparison, 'Now', 'Usual');
    expect(failedRecoveryView).toMatchObject({
      state: 'unavailable',
      isUpdating: false,
      metricRows: [],
    });
    expect(failedRecoveryView.detailText).toContain('could not be refreshed');
    expect(failedRecoveryView.sourceText).toContain('may be incomplete or stale');

    expect(component.trainingBuildRecoveryExpanded.cycling).toBe(false);
    component.toggleTrainingBuildRecovery('cycling');
    expect(component.trainingBuildRecoveryExpanded.cycling).toBe(true);
    expect(component.trainingBuildRecoveryExpanded.running).toBe(false);

    const swimWindow = {
      periodWeeks: 12, windowStartDayMs: 1, windowEndDayMs: 2, activityCount: 4,
      durationSeconds: 10_000, distanceMeters: 8_000, distanceEventCount: 4,
      trainingStressScore: 250, trainingStressScoreEventCount: 4, activeWeekCount: 4,
      longestActivityDurationSeconds: 3_000, easySeconds: null, moderateSeconds: null, hardSeconds: null,
      intensitySourceEventCount: 0,
      durability: {
        evidenceActivityCount: 4,
        medianDurationSeconds: 3_600,
        medianCoverageRatio: 0.9,
        aerobic: {
          sampleCount: 4,
          medianDecouplingPercent: 3,
          medianOutputRetentionPercent: 97,
          medianHeartRateDriftBpm: 4,
        },
        pool: null,
      },
      poolAveragePaceSecondsPer100m: 95, poolPaceActivityCount: 3,
      openWaterAveragePaceSecondsPer100m: null, openWaterPaceActivityCount: 0,
      contexts: [],
    };
    const swimRows = (component as any).buildTrainingBuildMetricRows({
      current: swimWindow,
      benchmark: {
        ...swimWindow,
        activityCount: 3,
        durationSeconds: 9_000,
        distanceMeters: 7_000,
        trainingStressScore: 200,
        activeWeekCount: 3,
        longestActivityDurationSeconds: 2_500,
        poolAveragePaceSecondsPer100m: 100,
      },
    }, 'swimming');
    expect(swimRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Distance', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Time', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Workouts', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Active weeks', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Longest workout', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Pool pace', deltaText: '0:05 /100m faster', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Open-water pace', currentText: '--', benchmarkText: '--', deltaTone: 'neutral' }),
      expect.objectContaining({ label: 'TSS', deltaTone: 'positive' }),
    ]));
    expect(swimRows).not.toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Power / HR' })]));
    const gravityWindow = {
      ...swimWindow,
      trainingStressScore: null,
      trainingStressScoreEventCount: 0,
      durability: null,
      poolAveragePaceSecondsPer100m: null,
      poolPaceActivityCount: 0,
      contexts: [{
        context: 'downhill', profile: 'gravity', activityCount: 4,
        metrics: [
          { metric: 'descent', value: 4_000, sourceActivityCount: 4 },
          { metric: 'descent-time', value: 2_400, sourceActivityCount: 4 },
          { metric: 'jump-count', value: 18, sourceActivityCount: 3 },
          { metric: 'max-jump-distance', value: 7.4, sourceActivityCount: 3 },
        ],
      }],
    };
    const gravityRows = (component as any).buildTrainingBuildMetricRows({
      current: gravityWindow,
      benchmark: {
        ...gravityWindow,
        contexts: [{
          ...gravityWindow.contexts[0],
          metrics: [
            { metric: 'descent', value: 3_000, sourceActivityCount: 4 },
            { metric: 'descent-time', value: 2_100, sourceActivityCount: 4 },
            { metric: 'jump-count', value: 12, sourceActivityCount: 3 },
            { metric: 'max-jump-distance', value: 5.8, sourceActivityCount: 3 },
          ],
        }],
      },
    }, 'cycling');
    expect(gravityRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Downhill MTB · Descent', deltaTone: 'neutral' }),
      expect.objectContaining({ label: 'Downhill MTB · Descent time', deltaTone: 'neutral' }),
      expect.objectContaining({ label: 'Downhill MTB · Jumps', deltaText: '+6' }),
      expect.objectContaining({
        label: 'Downhill MTB · Longest jump',
        currentText: '7.4 m',
        benchmarkText: '5.8 m',
        deltaText: '+1.6 m',
      }),
    ]));
    expect(gravityRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'TSS' }),
      expect.objectContaining({ label: 'Intensity mix' }),
    ]));
    expect(component.formatTrainingBuildFootnote('cycling')).toContain('Enduro and Downhill');
    expect(component.formatTrainingBuildFootnote('rowing')).toContain('durability is not available');
    expect((component as any).formatTrainingProfileMetric('stroke-distance', 10, 'rowing')).toBe('10.0 m');
    expect((component as any).formatTrainingProfileMetric('descent', 4_000, 'cycling')).toMatch(/^4[,.]000 m$/);
    component.unitSettings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    expect((component as any).formatTrainingProfileMetric('max-jump-distance', 7.4, 'cycling')).toBe('24.3 ft');
    component.unitSettings = null;
    expect((component as any).buildTrainingContextMetricViews([{
      context: 'strength', profile: 'strength', activityCount: 2,
      metrics: [{ metric: 'elapsed-time', value: 7_200, sourceActivityCount: 2 }],
    }], [], 'strength', true)).toEqual([expect.objectContaining({
      context: 'strength',
      metrics: [expect.objectContaining({ metric: 'elapsed-time', currentText: '2h 00m' })],
    })]);
    const durabilityContext = {
      contextKey: 'pool:25:freestyle', scope: 'pool-swimming', outputSource: 'pool-length-speed',
      outputUnit: 'm/s', poolLengthMeters: 25, stroke: 'freestyle',
    };
    const durabilitySummary = {
      context: durabilityContext,
      sampleCount: 3,
      medianDurationSeconds: 3_600,
      medianCoverageRatio: 0.9,
      medianDecouplingPercent: null,
      medianOutputRetentionPercent: null,
      medianHeartRateDriftBpm: null,
      medianPaceRetentionPercent: 98,
      medianSwolfChange: 1,
    };
    const durabilityRows = (component as any).buildTrainingBuildMetricRows({
      current: swimWindow,
      benchmark: swimWindow,
      durabilityComparisons: [{
        context: durabilityContext,
        current: durabilitySummary,
        benchmark: { ...durabilitySummary, sampleCount: 4, medianPaceRetentionPercent: 96, medianSwolfChange: 2 },
        isComparable: true,
      }],
    }, 'swimming');
    expect(durabilityRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '25 m freestyle evidence', currentText: '3 workouts', benchmarkText: '4 workouts' }),
      expect.objectContaining({ label: '25 m freestyle pace retained', deltaText: '+2%', deltaTone: 'positive' }),
      expect.objectContaining({ label: '25 m freestyle SWOLF change', deltaText: '−1', deltaTone: 'positive' }),
    ]));
    const aerobicContext = {
      contextKey: 'running:power', scope: 'running', outputSource: 'power',
      outputUnit: 'W', poolLengthMeters: null, stroke: null,
    };
    const aerobicSummary = {
      ...durabilitySummary,
      context: aerobicContext,
      medianDecouplingPercent: -5,
      medianOutputRetentionPercent: 95,
      medianHeartRateDriftBpm: -5,
      medianPaceRetentionPercent: null,
      medianSwolfChange: null,
    };
    const aerobicRows = (component as any).buildTrainingBuildMetricRows({
      current: swimWindow,
      benchmark: swimWindow,
      durabilityComparisons: [{
        context: aerobicContext,
        current: aerobicSummary,
        benchmark: { ...aerobicSummary, medianDecouplingPercent: 1, medianHeartRateDriftBpm: 1 },
        isComparable: true,
      }],
    }, 'running');
    expect(aerobicRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Power decoupling', deltaText: '−6%', deltaTone: 'negative' }),
      expect.objectContaining({ label: 'Power HR drift', deltaText: '−6 bpm', deltaTone: 'negative' }),
    ]));
    const slowerSwimRows = (component as any).buildTrainingBuildMetricRows({
      current: { ...swimWindow, poolAveragePaceSecondsPer100m: 105 },
      benchmark: { ...swimWindow, poolAveragePaceSecondsPer100m: 100 },
    }, 'swimming');
    expect(slowerSwimRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Pool pace', deltaText: '0:05 /100m slower', deltaTone: 'negative' }),
    ]));

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

  it('keeps build sleep comparison compact until details are requested', async () => {
    const derivedState$ = new Subject<DashboardDerivedMetricsState>();
    const derivedMetrics = { watch: vi.fn(() => derivedState$), ensureForDashboard: vi.fn() };
    const eventId = 'event-1';
    const selection = { mode: 'event' as const, durationWeeks: 12 as const, eventId };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({
          uid: 'user-1',
          settings: { trainingSettings: { visibleDisciplines: ['cycling'], buildBenchmarks: { cycling: selection } } },
        }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrainingWorkspaceComponent);
    fixture.detectChanges();
    derivedState$.next({
      ...createDashboardDerivedMetricsMissingState(),
      trainingBuildComparisonStatus: 'ready',
      trainingBuildComparison: {
        asOfDayMs: Date.UTC(2026, 6, 15),
        recovery: null,
        disciplines: [{
          discipline: 'cycling', status: 'ready',
          selection: {
            ...selection,
            selectionKey: `event:12:${eventId}`,
            windowStartDayMs: Date.UTC(2026, 0, 1), windowEndDayMs: Date.UTC(2026, 2, 25), label: 'New Event',
          },
          current: null, benchmark: null, suggestedRaces: [], suggestedEvents: [],
          recovery: {
            sameProvider: true, isComparable: true,
            current: {
              periodDays: 84, windowStartDayMs: 1, windowEndDayMs: 2, provider: 'GarminAPI',
              recordedNightCount: 78, expectedNightCount: 84, coverage: 'sufficient',
              averageSleepSeconds: 31_200, typicalLocalStartMinutes: 1_380, typicalLocalEndMinutes: 420, bedtimeVariationMinutes: 36,
              medianOvernightHrvMs: 33, overnightHrvNightCount: 78,
            },
            reference: {
              periodDays: 84, windowStartDayMs: 1, windowEndDayMs: 2, provider: 'GarminAPI',
              recordedNightCount: 78, expectedNightCount: 84, coverage: 'sufficient',
              averageSleepSeconds: 32_400, typicalLocalStartMinutes: 1_365, typicalLocalEndMinutes: 405, bedtimeVariationMinutes: 35,
              medianOvernightHrvMs: 30, overnightHrvNightCount: 78,
            },
          },
        }],
      },
    } as any);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const benchmarkAction = element.querySelector('.training-build-benchmark-action');
    expect(benchmarkAction?.getAttribute('aria-label')).toBe('Change Cycling benchmark');
    expect(benchmarkAction?.querySelector('.training-build-benchmark-action-label')?.textContent?.trim())
      .toBe('Change');
    expect(element.textContent).toContain('Selected reference event');
    expect(element.textContent).toContain('12-week build before this event');
    expect(element.textContent).toContain('Used as the comparison reference; event day is excluded.');
    const toggle = element.querySelector<HTMLButtonElement>('.training-build-recovery-toggle');
    expect(element.textContent).toContain('Sleep 20m shorter per night · Overnight HRV +3 ms');
    expect(element.querySelectorAll('.training-build-card .training-build-delta').length).toBeGreaterThan(0);
    expect(element.querySelector('.training-build-card .training-comparison-delta')).toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const details = element.querySelector<HTMLElement>('.training-build-recovery-details');
    expect(details?.hidden).toBe(true);

    toggle?.click();
    fixture.detectChanges();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(details?.hidden).toBe(false);
    expect(details?.textContent).toContain('8h 40m');
    expect(details?.textContent).toContain('Garmin');
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
    component.visibleDisciplines = ['cycling'];
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

  it('uses the selected event date when a saved benchmark has only a generic name', () => {
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      { open: vi.fn() } as any,
      { markForCheck: vi.fn() } as any,
    );
    const genericEvent = {
      selection: {
        mode: 'event',
        eventId: 'event-1',
        label: 'New Event',
        windowStartDayMs: Date.UTC(2026, 0, 17),
        windowEndDayMs: Date.UTC(2026, 2, 13),
      },
    };

    expect((component as any).formatTrainingBuildReference(genericEvent))
      .toMatch(/^Event on (Mar 14, 2026|14 Mar 2026)$/);
    expect((component as any).formatTrainingBuildReference({
      selection: { ...genericEvent.selection, label: 'Gran Fondo' },
    })).toBe('Gran Fondo');
  });

  it('keeps derived metric listeners active after the initial user change', async () => {
    const derivedState$ = new Subject<DashboardDerivedMetricsState>();
    const derivedMetrics = { watch: vi.fn(() => derivedState$), ensureForDashboard: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [TrainingWorkspaceComponent, TrainingMetricTextComponent],
      providers: [
        { provide: AppAuthService, useValue: { user$: of({ uid: 'user-1' }) } },
        { provide: DashboardDerivedMetricsService, useValue: derivedMetrics },
        { provide: AppSleepService, useValue: createSleepService() },
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
    const routeStatus = fixture.nativeElement.querySelector('.training-derived-metrics-status') as HTMLElement | null;
    const pageHeader = routeStatus?.closest('.training-page-header');
    const firstSection = fixture.nativeElement.querySelector('.training-section');
    expect(routeStatus?.textContent).toContain('Refreshing derived metrics');
    expect(routeStatus?.textContent).toContain('Available last completed values');
    expect(pageHeader?.nextElementSibling).toBe(firstSection);
    expect(fixture.nativeElement.textContent).toContain('Updating your training comparison');

    derivedState$.next({
      ...createDashboardDerivedMetricsMissingState(),
      trainingSummaryStatus: 'failed',
      trainingSummary: {
        asOfDayMs: 0,
        currentWindowDays: 28,
        baselineWindowDays: 84,
        disciplines: [],
      },
    });
    fixture.detectChanges();
    const retryButton = fixture.nativeElement.querySelector('.training-derived-metrics-retry') as HTMLButtonElement;
    expect(fixture.nativeElement.querySelector('.training-derived-metrics-status')?.textContent)
      .toContain('Derived metrics update failed');
    expect(retryButton.getAttribute('aria-label')).toBe('Retry derived metrics update');
    retryButton.click();
    expect(derivedMetrics.ensureForDashboard).toHaveBeenLastCalledWith(
      { uid: 'user-1' },
      expect.objectContaining({ trainingSummaryStatus: 'failed' }),
      { force: true, metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS },
    );
  });

  it('ignores the optional recovery status unless an active estimate is visible', () => {
    const nowMs = Date.UTC(2026, 6, 18, 12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      { open: vi.fn() } as any,
      { markForCheck: vi.fn() } as any,
    );
    component.derivedState = createRouteReadyDerivedState({ recoveryNowStatus: 'failed' });

    (component as any).refreshTrainingRecoveryEstimate();
    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus).toBeNull();

    component.derivedState = createRouteReadyDerivedState({
      recoveryNowStatus: 'failed',
      recoveryNow: { totalSeconds: 3_600, endTimeMs: nowMs },
    });
    (component as any).refreshTrainingRecoveryEstimate();
    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus?.type).toBe('warning');
  });

  it('ignores durability failures unless a visible sport supports durability', () => {
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      { open: vi.fn() } as any,
      { markForCheck: vi.fn() } as any,
    );
    component.derivedState = createRouteReadyDerivedState({ trainingDurabilityStatus: 'failed' });
    component.visibleTrainingCapabilities = new Set(['best-build']);

    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus).toBeNull();

    component.visibleTrainingCapabilities = new Set(['best-build', 'durability']);
    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus?.type).toBe('warning');
  });

  it('ignores compact fallback failures when the rendered Form and forecast series supply those values', () => {
    const nowMs = Date.UTC(2026, 6, 18);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    const component = new TrainingWorkspaceComponent(
      {} as any,
      {} as any,
      {} as any,
      { appTheme: () => AppThemes.Normal } as any,
      { open: vi.fn() } as any,
      { markForCheck: vi.fn() } as any,
    );
    const formPoints = [
      {
        time: nowMs - (7 * 24 * 60 * 60 * 1000),
        trainingStressScore: 40,
        ctl: 100,
        atl: 98,
        formSameDay: 2,
        formPriorDay: 1,
      },
      {
        time: nowMs,
        trainingStressScore: 60,
        ctl: 102,
        atl: 98,
        formSameDay: 4,
        formPriorDay: 3,
      },
    ];
    const freshnessForecast = {
      generatedAtMs: nowMs,
      points: [{
        dayMs: nowMs + (7 * 24 * 60 * 60 * 1000),
        trainingStressScore: 0,
        ctl: 90,
        atl: 70,
        formSameDay: 20,
        formPriorDay: 19,
        isForecast: true,
      }],
    };
    component.derivedState = createRouteReadyDerivedState({
      formPoints,
      freshnessForecast,
      formNowStatus: 'failed',
      rampRateStatus: 'failed',
      formPlus7dStatus: 'failed',
    });

    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus).toBeNull();

    component.derivedState = { ...component.derivedState, formPoints: null };
    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus?.type).toBe('warning');

    component.derivedState = { ...component.derivedState, formPoints, freshnessForecast: null };
    (component as any).refreshDerivedMetricsRouteStatus();
    expect(component.derivedMetricsRouteStatus?.type).toBe('warning');
  });
});
