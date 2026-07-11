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
    );
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
