import { Component, Input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { AppThemes } from '@sports-alliance/sports-lib';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import {
  HEALTH_COVERAGE_STATUSES,
  HEALTH_METRIC_CATALOG,
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_PROVIDERS,
  HEALTH_QUALITY_STATUSES,
  HEALTH_RECORDING_METHODS,
  HEALTH_SCHEMA_VERSION,
  HEALTH_SOURCE_RECORD_KINDS,
  HEALTH_SYNC_STATUSES,
  HEALTH_VALUE_ORIGINS,
  HealthMetricId,
  HealthProvider,
  HealthSourceRecord,
  HealthSyncState,
  getHealthMetricDefinition,
} from '@shared/health';
import { ProviderPresentation } from '@shared/provider-presentation';
import {
  ACTIVITY_HEALTH_SOURCE_KINDS,
  type ActivityHealthRangeResult,
} from '@shared/activity-health';
import { SLEEP_PROVIDERS, SleepProvider, SleepSession, SleepSyncState } from '@shared/sleep';
import { projectLoadedHealthRange } from '@shared/health-query';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppEventService } from '../../services/app.event.service';
import { AppHealthService, HealthWorkspaceRangeLoad } from '../../services/app.health.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AppUserService } from '../../services/app.user.service';
import { AppHealthWorkspaceMetric, AppHealthWorkspaceRange } from '../../models/app-user.interface';
import { HealthWorkspaceSeries, localCalendarDate } from '../../helpers/health-workspace.helper';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { HealthMetricChartComponent } from './health-metric-chart.component';
import { HealthWorkspaceComponent } from './health-workspace.component';
import { HealthActivityQueryService } from './health-activity-query.service';

@Component({
  selector: 'app-sleep-trend-chart',
  standalone: true,
  template: '<div class="sleep-chart-stub" role="img" aria-label="Sleep trend"></div>',
})
class SleepTrendStubComponent {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() sleepTrend: unknown;
  @Input() sleepRange: unknown;
  @Input() sleepWindowLabel: unknown;
  @Input() canNavigateOlder = false;
  @Input() canNavigateNewer = false;
  @Input() infoTooltip: unknown;
}

@Component({
  selector: 'app-service-source-icon',
  standalone: true,
  template: '<span class="source-icon-stub" aria-hidden="true"></span>',
})
class ServiceSourceIconStubComponent {
  @Input() presentation: ProviderPresentation | null = null;
  @Input() showText = false;
  @Input() showTooltip = false;
  @Input() iconWidth: number | null = null;
  @Input() iconHeight = 20;
}

@Component({
  selector: 'app-health-metric-chart',
  standalone: true,
  template: `
    @for (item of series; track item.id) {
      <article class="health-chart-panel">
        <span>{{ item.sourceLabel }}</span>
        <div class="health-echarts-stub" role="img" [attr.aria-label]="item.semanticLabel"></div>
      </article>
    }
  `,
})
class HealthMetricChartStubComponent {
  @Input() series: readonly HealthWorkspaceSeries[] = [];
  @Input() startTimeMs = 0;
  @Input() endTimeMs = 0;
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
}

const todayDate = localCalendarDate();
const todayStartMs = Date.parse(`${todayDate}T00:00:00.000Z`);

function metricEntry(metricId: HealthMetricId, value: number) {
  const definition = getHealthMetricDefinition(metricId);
  return {
    kind: 'value' as const,
    metricId,
    valueType: definition.valueType,
    aggregation: 'average',
    semanticVariant: 'provider_daily_summary',
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
    quality: { status: HEALTH_QUALITY_STATUSES.Valid },
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    native: { metric: metricId, value, unit: definition.canonicalUnit },
    canonical: { value, unit: definition.canonicalUnit },
  };
}

function sourceRecord(metricId: HealthMetricId, provider: HealthProvider, value: number, suffix: string): HealthSourceRecord {
  const entry = metricEntry(metricId, value);
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    id: `record-${suffix}`,
    userID: 'user-1',
    kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
    source: {
      provider,
      accountKey: `secret-account-${suffix}`,
      sourceRecordType: 'daily',
      sourceRecordKey: `opaque-record-${suffix}`,
      revision: { order: 1, token: 'one', digest: `digest-${suffix}` },
      receivedAtMs: todayStartMs + 1_000,
    },
    calendarDate: todayDate,
    startTimeMs: todayStartMs,
    endTimeMs: todayStartMs + (24 * 60 * 60 * 1000) - 1,
    metrics: [entry],
    metricIds: [metricId],
    coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
    device: { manufacturer: provider === HEALTH_PROVIDERS.GarminAPI ? 'Garmin' : 'COROS', model: 'Test watch' },
    sampleChunkIds: [],
    createdAtMs: todayStartMs,
    updatedAtMs: todayStartMs,
  };
}

function rangeLoad(metricId: HealthMetricId, empty = false): HealthWorkspaceRangeLoad {
  const records = empty ? [] : [
    sourceRecord(metricId, HEALTH_PROVIDERS.GarminAPI, metricId === HEALTH_METRIC_IDS.HeartRateVariability ? 55 : 52, 'garmin'),
    sourceRecord(metricId, HEALTH_PROVIDERS.COROSAPI, metricId === HEALTH_METRIC_IDS.HeartRateVariability ? 61 : 58, 'coros'),
  ];
  const result = projectLoadedHealthRange(records, [], {
    startDate: new Date(todayStartMs - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
    endDate: todayDate,
    metricIds: [metricId],
    includeSamples: false,
  }, { sourceRecordsComplete: true, samplesComplete: true });
  return {
    result,
    limitReached: null,
    sourceRecordCount: records.length,
    sampleChunkCount: 0,
    samplePointCount: 0,
    serializedBytes: 1_000,
    hasMatchingSourceRecords: records.length > 0,
    hasSampleBackedMetric: false,
    providers: [...new Set(records.map(record => record.source.provider))],
    sampleBackedProviders: [],
  };
}

function activityRangeResult(
  options: { metricId?: typeof HEALTH_METRIC_IDS.BodyWeight | typeof HEALTH_METRIC_IDS.Vo2Max } = {},
): ActivityHealthRangeResult {
  const metricId = options.metricId || HEALTH_METRIC_IDS.BodyWeight;
  const isWeight = metricId === HEALTH_METRIC_IDS.BodyWeight;
  return {
    observations: [{
      id: 'opaque-workout-observation',
      metricId,
      observedAtMs: todayStartMs + 10_000,
      value: isWeight ? 72 : 51,
      unit: isWeight ? 'kg' : 'ml_per_kg_per_min',
      provider: HEALTH_PROVIDERS.GarminAPI,
      sourceAccountKey: 'opaque-workout-account',
      sourceKind: isWeight
        ? ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutProfileContext
        : ACTIVITY_HEALTH_SOURCE_KINDS.WorkoutImported,
      discipline: isWeight ? null : 'running',
      semanticVariant: isWeight ? 'workout_profile_context' : 'workout_imported_running',
    }],
    complete: true,
    incompleteReason: null,
    candidateCount: 1,
    serializedBytes: 256,
  };
}

function sleepSession(overrides: Partial<SleepSession> = {}): SleepSession {
  return {
    id: 'sleep-one',
    userID: 'user-1',
    source: {
      provider: SLEEP_PROVIDERS.GarminAPI,
      sourceSessionKey: 'opaque-sleep',
      providerUserId: 'secret-provider-user',
    },
    sleepDate: todayDate,
    startTimeMs: todayStartMs - (8 * 60 * 60 * 1000),
    endTimeMs: todayStartMs,
    durationSeconds: 8 * 60 * 60,
    isNap: false,
    stages: [],
    stageDurationsSeconds: {
      deep: 7_200,
      light: 14_400,
      rem: 5_400,
      awake: 1_800,
    },
    score: { value: 86 },
    vitals: { averageHrvMs: 58, averageHeartRateBpm: 52 },
    createdAtMs: todayStartMs,
    updatedAtMs: todayStartMs,
    ...overrides,
  };
}

describe('HealthWorkspaceComponent', () => {
  let fixture: ComponentFixture<HealthWorkspaceComponent>;
  let component: HealthWorkspaceComponent;
  let router: Router;
  let loadMetricRange: ReturnType<typeof vi.fn>;
  let loadAvailableMetricIds: ReturnType<typeof vi.fn>;
  let loadActivityHealthRange: ReturnType<typeof vi.fn>;
  let updateHealthWorkspacePreferences: ReturnType<typeof vi.fn>;
  let hydrateSavedRange: (range: AppHealthWorkspaceRange) => void;
  let hydrateSavedMetric: (metric: AppHealthWorkspaceMetric) => void;
  let syncStates: BehaviorSubject<HealthSyncState[]>;
  let sleepSyncStates: Record<SleepProvider, BehaviorSubject<SleepSyncState | null>>;
  let backfillGarminHealthForCurrentUser: ReturnType<typeof vi.fn>;
  let backfillSuuntoSleepForCurrentUser: ReturnType<typeof vi.fn>;
  let backfillCorosSleepForCurrentUser: ReturnType<typeof vi.fn>;
  let hasProAccess: ReturnType<typeof signal<boolean>>;
  let setCurrentUserID: (uid: string) => void;
  let backfillResponse: {
    queued: number;
    sleepQueued: number;
    healthQueued: number;
    startDate: string;
    endDate: string;
    nextAllowedAtMs: number;
  };

  async function createComponent(
    loadImplementation?: (metricId: HealthMetricId) => Promise<HealthWorkspaceRangeLoad>,
    savedRange?: AppHealthWorkspaceRange,
    availability: {
      metricIds?: readonly HealthMetricId[];
      healthError?: unknown;
      hasSleep?: boolean;
      sleepSessions?: readonly SleepSession[];
      sleepError?: unknown;
      sleepSyncErrors?: readonly SleepProvider[];
    } = {},
    savedMetric?: AppHealthWorkspaceMetric,
  ): Promise<void> {
    loadMetricRange = vi.fn().mockImplementation((_uid: string, request: { metricId: HealthMetricId }) =>
      loadImplementation ? loadImplementation(request.metricId) : Promise.resolve(rangeLoad(request.metricId)));
    loadAvailableMetricIds = availability.healthError
      ? vi.fn().mockRejectedValue(availability.healthError)
      : vi.fn().mockResolvedValue(
        availability.metricIds || Object.keys(HEALTH_METRIC_CATALOG) as HealthMetricId[],
      );
    loadActivityHealthRange = vi.fn().mockResolvedValue(activityRangeResult());
    updateHealthWorkspacePreferences = vi.fn().mockResolvedValue(undefined);
    const savedHealthWorkspace = {
      ...(savedRange ? { range: savedRange } : {}),
      ...(savedMetric ? { metric: savedMetric } : {}),
    };
    const user = signal({
      uid: 'user-1',
      settings: Object.keys(savedHealthWorkspace).length > 0
        ? { appSettings: { healthWorkspace: savedHealthWorkspace } }
        : {},
    });
    setCurrentUserID = uid => user.update(current => ({ ...current, uid }));
    hydrateSavedRange = range => user.update(current => ({
      ...current,
      settings: {
        appSettings: {
          healthWorkspace: {
            ...current.settings.appSettings?.healthWorkspace,
            range,
          },
        },
      },
    }));
    hydrateSavedMetric = metric => user.update(current => ({
      ...current,
      settings: {
        appSettings: {
          healthWorkspace: {
            ...current.settings.appSettings?.healthWorkspace,
            metric,
          },
        },
      },
    }));
    syncStates = new BehaviorSubject<HealthSyncState[]>([{
      provider: HEALTH_PROVIDERS.GarminAPI,
      status: HEALTH_SYNC_STATUSES.Ready,
      lastSyncedAtMs: todayStartMs,
      updatedAtMs: 1,
    }]);
    sleepSyncStates = {
      [SLEEP_PROVIDERS.GarminAPI]: new BehaviorSubject<SleepSyncState | null>(null),
      [SLEEP_PROVIDERS.SuuntoApp]: new BehaviorSubject<SleepSyncState | null>(null),
      [SLEEP_PROVIDERS.COROSAPI]: new BehaviorSubject<SleepSyncState | null>(null),
    };
    backfillResponse = {
      queued: 2,
      sleepQueued: 1,
      healthQueued: 1,
      startDate: new Date(todayStartMs - (30 * 24 * 60 * 60 * 1000)).toISOString(),
      endDate: new Date(todayStartMs).toISOString(),
      nextAllowedAtMs: todayStartMs + (7 * 24 * 60 * 60 * 1000),
    };
    backfillGarminHealthForCurrentUser = vi.fn().mockResolvedValue(backfillResponse);
    backfillSuuntoSleepForCurrentUser = vi.fn().mockResolvedValue(backfillResponse);
    backfillCorosSleepForCurrentUser = vi.fn().mockResolvedValue(backfillResponse);
    hasProAccess = signal(true);

    const defaultSleepSessions = (availability.hasSleep ?? true) ? [sleepSession()] : [];

    await TestBed.configureTestingModule({
      imports: [HealthWorkspaceComponent],
      providers: [
        provideRouter([]),
        { provide: AppEventService, useValue: { getEventMetaDataKeys: () => of([]) } },
        {
          provide: AppUserService,
          useValue: {
            user,
            hasProAccessSignal: hasProAccess,
            backfillGarminHealthForCurrentUser,
            backfillSuuntoSleepForCurrentUser,
            backfillCorosSleepForCurrentUser,
          },
        },
        {
          provide: AppUserSettingsQueryService,
          useValue: {
            unitSettings: signal(getDefaultUserUnitSettings()),
            updateHealthWorkspacePreferences,
          },
        },
        {
          provide: AppHealthService,
          useValue: {
            loadMetricRange,
            loadActivityHealthRange,
            loadAvailableMetricIds,
            watchSyncStates: () => syncStates.asObservable(),
          },
        },
        {
          provide: HealthActivityQueryService,
          useValue: { loadRange: loadActivityHealthRange },
        },
        {
          provide: AppSleepService,
          useValue: {
            watchForDashboard: () => of([...(availability.sleepSessions || defaultSleepSessions)]),
            watchHasAnySleepSession: () => availability.sleepError
              ? throwError(() => availability.sleepError)
              : of(availability.hasSleep ?? true),
            watchSyncState: (_uid: string, provider: SleepProvider) =>
              availability.sleepSyncErrors?.includes(provider)
                ? throwError(() => new Error('sync state unavailable'))
                : sleepSyncStates[provider].asObservable(),
          },
        },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Light) } },
      ],
    })
      .overrideComponent(HealthWorkspaceComponent, {
        remove: { imports: [AppChartsModule, ServiceSourceIconComponent, HealthMetricChartComponent] },
        add: { imports: [SleepTrendStubComponent, ServiceSourceIconStubComponent, HealthMetricChartStubComponent] },
      })
      .overrideComponent(ServiceSourceIconComponent, {
        set: { template: '<span class="source-icon-stub" aria-hidden="true"></span>' },
      })
      .compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(HealthWorkspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('defaults to Resting heart rate for 30 days and keeps priority cards in product order', async () => {
    await createComponent();

    expect(component.routeState()).toMatchObject({
      metric: HEALTH_METRIC_IDS.RestingHeartRate,
      range: '30d',
      endDate: todayDate,
    });
    expect(component.priorityCards().map(card => card.label)).toEqual(['Sleep', 'Heart rate', 'HRV']);
    const prioritySection = (fixture.nativeElement as HTMLElement).querySelector('.health-priority-section');
    expect(prioritySection?.textContent).toContain('Highlights');
    expect(prioritySection?.textContent).not.toContain('Last 30 days');
    expect((fixture.nativeElement as HTMLElement).querySelector('#health-detail-title')?.textContent).toContain('Resting heart rate');
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-grid')?.tagName).toBe('MAT-CARD');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-card')).toHaveLength(3);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-card mat-card-header')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-card mat-card-actions')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-explorer')?.classList).toContain('qs-glass-card-panel');
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-footer')?.tagName).toBe('FOOTER');
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-card')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-metric-option-selected')?.getAttribute('aria-pressed')).toBe('true');
    const metricOptionIcons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.health-metric-option .health-metric-option-icon',
    );
    expect(metricOptionIcons).toHaveLength((fixture.nativeElement as HTMLElement).querySelectorAll('.health-metric-option').length);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-avatar > mat-icon')).toHaveLength(3);
    expect(fixture.debugElement.queryAll(By.css(
      '.health-priority-card app-service-source-icon',
    ))).toHaveLength(0);
    const prioritySourceLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-source-label'),
    );
    expect(prioritySourceLabels.length).toBeGreaterThan(0);
    expect(prioritySourceLabels.some(label => label.textContent?.trim() === 'Garmin')).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-chart-source')).toHaveLength(2);
    const sleepDetails = (fixture.nativeElement as HTMLElement).querySelector('.health-priority-card:first-child')?.textContent;
    expect(sleepDetails).toContain('Score86');
    expect(sleepDetails).toContain('HRV58 ms');
    expect(sleepDetails).toContain('Avg HR52 bpm');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-health-sleep-stage-summary')).toHaveLength(1);
    expect(sleepDetails).toContain('Sleep stages');
    const filterProviderIcons = fixture.debugElement.queryAll(By.css(
      '.health-provider-filter app-service-source-icon',
    ));
    expect(filterProviderIcons.length).toBeGreaterThan(0);
    expect(filterProviderIcons.every(icon => icon.componentInstance.iconWidth === null)).toBe(true);
    expect(filterProviderIcons.every(icon => icon.componentInstance.iconHeight === 20)).toBe(true);
    const providerFilterButtons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.health-provider-filter'),
    );
    expect(providerFilterButtons).toHaveLength(component.providerFilterOptions().length + 1);
    expect(providerFilterButtons[0]?.textContent).toContain('All sources');
    expect(providerFilterButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect((fixture.nativeElement as HTMLElement).querySelector('mat-chip-listbox')).toBeNull();
    expect(router.url).not.toContain('?');
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      metricId: HEALTH_METRIC_IDS.HeartRate,
      includeSamples: true,
    }));
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      includeSamples: true,
    }));
  }, 10_000);

  it('removes unavailable highlights instead of rendering empty cards', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(
      metricId,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability,
    )), undefined, {
      sleepSessions: [sleepSession({ vitals: { averageHeartRateBpm: 52 } })],
    });

    expect(component.visiblePriorityCards().map(card => card.label)).toEqual(['Sleep', 'Heart rate']);
    const cards = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.health-priority-card'),
    );
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.querySelector('h3')?.textContent?.trim())).toEqual(['Sleep', 'Heart rate']);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-grid')?.classList)
      .toContain('health-priority-grid-double');
  });

  it('surfaces normalized Sleep HRV when standalone Health HRV is unavailable', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(
      metricId,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability,
    )), undefined, {
      metricIds: [HEALTH_METRIC_IDS.HeartRate],
      sleepSessions: [sleepSession()],
    }, HEALTH_METRIC_IDS.HeartRateVariability);

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.HeartRateVariability);
    expect(component.metricCatalogGroups().flatMap(group => group.metrics.map(metric => metric.id)))
      .toContain(HEALTH_METRIC_IDS.HeartRateVariability);
    expect(component.metricView().series).toEqual([
      expect.objectContaining({
        provider: HEALTH_PROVIDERS.GarminAPI,
        semanticVariant: 'sleep_session_average_hrv',
        semanticLabel: 'Average HRV · Sleep session · Provider summary · Provider calculated',
      }),
    ]);
    expect(component.providerFilterOptions().map(provider => provider.label)).toContain('Garmin');
    expect(component.sleepHrvNotice()).toContain('never averaged with standalone HRV');
    expect(component.visiblePriorityCards().map(card => card.label)).toContain('HRV');
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('Sleep HRV is read from normalized Sleep sessions');
  });

  it('restores and persists the account-owned metric and range without adding query parameters', async () => {
    await createComponent(undefined, '90d', {}, HEALTH_METRIC_IDS.Steps);

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.Steps);
    expect(component.routeState().range).toBe('90d');
    component.selectMetric(HEALTH_METRIC_IDS.HeartRateVariability);
    await fixture.whenStable();
    component.selectRange('14d');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.routeState().range).toBe('14d');
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.HeartRateVariability,
      range: '14d',
    });
    expect(router.url).not.toContain('?');
    expect(component.isSavingPreferences()).toBe(false);
  });

  it('loads and remembers the 1d sample-enabled window', async () => {
    await createComponent();

    component.selectRange('today');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.routeState().range).toBe('today');
    expect(component.selectedWindow()).toMatchObject({
      startDate: todayDate,
      endDate: todayDate,
      dayCount: 1,
      includeSamples: true,
    });
    const explicitTodayLabel = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${todayDate}T00:00:00.000Z`));
    expect(component.selectedWindow().label).toBe(`Today · ${explicitTodayLabel}`);
    expect(component.detailSubtitle()).toBe(component.selectedWindow().label);
    expect(component.ranges[0]).toMatchObject({ range: 'today', label: '1 day', buttonLabel: '1d' });
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-range-selector')?.textContent).toContain('1d');
    expect((fixture.nativeElement as HTMLElement).querySelector('button[aria-label="1 day"]')?.textContent).toContain('1d');
    expect(updateHealthWorkspacePreferences).toHaveBeenCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.RestingHeartRate,
      range: 'today',
    });
    expect(loadMetricRange.mock.calls.some(([, request]) => request.startDate === todayDate
      && request.endDate === todayDate
      && request.includeSamples === true)).toBe(true);
    expect(router.url).not.toContain('?');
  });

  it('identifies one-day history and jumps back to today without changing saved range', async () => {
    await createComponent();

    component.selectRange('today');
    await fixture.whenStable();
    component.navigateWindow('older');
    fixture.detectChanges();

    const yesterdayDate = new Date(
      Date.parse(`${todayDate}T00:00:00.000Z`) - (24 * 60 * 60 * 1000),
    ).toISOString().slice(0, 10);
    expect(component.selectedEndDate()).toBe(yesterdayDate);
    expect(component.selectedWindow().label).toMatch(/^Yesterday · /);
    const todayButton = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[aria-label="Jump to today"]');
    expect(todayButton).not.toBeNull();

    todayButton?.click();
    fixture.detectChanges();

    expect(component.selectedEndDate()).toBe(todayDate);
    expect(component.selectedWindow().label).toMatch(/^Today · /);
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Jump to today"]')).toBeNull();
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.RestingHeartRate,
      range: 'today',
    });
  });

  it('shows only metrics with stored history and falls back from an unavailable default', async () => {
    await createComponent(undefined, undefined, {
      metricIds: [
        HEALTH_METRIC_IDS.Steps,
        HEALTH_METRIC_IDS.HeartRate,
        HEALTH_METRIC_IDS.BodyWeight,
        HEALTH_METRIC_IDS.Vo2Max,
      ],
      hasSleep: false,
    });

    const host = fixture.nativeElement as HTMLElement;
    const metricLabels = [...host.querySelectorAll('.health-metric-option')]
      .map(option => option.querySelector('.health-metric-option-content > span:last-child')?.textContent?.trim());
    expect(metricLabels).toEqual(['Heart rate', 'Steps', 'Body weight', 'VO2 max']);
    expect(host.textContent).not.toContain('Sleep overview');
    expect(host.textContent).not.toContain('Resting heart rate');
    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.HeartRate);
    expect((host.querySelector('[aria-label="Open Heart rate"]') as HTMLButtonElement).disabled).toBe(false);
    expect(host.querySelector('[aria-label="Open Sleep"]')).toBeNull();
    expect((host.querySelector('[aria-label="Open HRV"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the verified metric catalog filtered while a saved metric preference echoes back', async () => {
    await createComponent(undefined, undefined, {
      metricIds: [HEALTH_METRIC_IDS.HeartRate, HEALTH_METRIC_IDS.Steps],
      hasSleep: false,
    });

    const host = fixture.nativeElement as HTMLElement;
    const initialLabels = [...host.querySelectorAll('.health-metric-option')]
      .map(option => option.querySelector('.health-metric-option-content > span:last-child')?.textContent?.trim());
    expect(initialLabels).toEqual(['Heart rate', 'Steps', 'Body weight', 'VO2 max']);
    expect(component.showSleepMetric()).toBe(false);

    let resolveUnexpectedAvailabilityLoad: (metricIds: HealthMetricId[]) => void;
    const unexpectedAvailabilityLoad = new Promise<HealthMetricId[]>(resolve => {
      resolveUnexpectedAvailabilityLoad = resolve;
    });
    loadAvailableMetricIds.mockImplementationOnce(() => unexpectedAvailabilityLoad);

    component.selectMetric(HEALTH_METRIC_IDS.Steps);
    hydrateSavedMetric(HEALTH_METRIC_IDS.Steps);
    fixture.detectChanges();

    expect(loadAvailableMetricIds).toHaveBeenCalledTimes(1);
    expect(component.healthMetricAvailabilityStatus()).toBe('ready');
    expect(component.sleepMetricAvailabilityStatus()).toBe('ready');
    expect(component.metricCatalogGroups().flatMap(group => group.metrics.map(metric => metric.id))).toEqual([
      HEALTH_METRIC_IDS.HeartRate,
      HEALTH_METRIC_IDS.Steps,
      HEALTH_METRIC_IDS.BodyWeight,
      HEALTH_METRIC_IDS.Vo2Max,
    ]);
    expect(component.showSleepMetric()).toBe(false);

    resolveUnexpectedAvailabilityLoad!([]);
  });

  it('keeps the complete catalog visible when availability discovery fails', async () => {
    await createComponent(undefined, undefined, {
      healthError: new Error('offline'),
      sleepError: new Error('offline'),
    });

    expect(component.metricCatalogGroups().flatMap(group => group.metrics))
      .toHaveLength(Object.keys(HEALTH_METRIC_CATALOG).length);
    expect(component.showSleepMetric()).toBe(true);
    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.RestingHeartRate);
    expect((fixture.nativeElement as HTMLElement).textContent)
      .toContain('Some metric availability could not be verified');
  });

  it('keeps Health filtering active when only Sleep availability fails', async () => {
    await createComponent(undefined, undefined, {
      metricIds: [HEALTH_METRIC_IDS.Steps],
      sleepError: new Error('offline'),
    });

    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.health-metric-option')]
      .map(option => option.querySelector('.health-metric-option-content > span:last-child')?.textContent?.trim());
    expect(labels).toEqual(['Sleep overview', 'Heart rate variability', 'Steps', 'Body weight', 'VO2 max']);
    expect(component.routeState().metric).toBe('sleep');
  });

  it('keeps Sleep filtering active when only Health availability fails', async () => {
    await createComponent(undefined, undefined, {
      healthError: new Error('offline'),
      hasSleep: false,
    });

    expect(component.metricCatalogGroups().flatMap(group => group.metrics))
      .toHaveLength(Object.keys(HEALTH_METRIC_CATALOG).length);
    expect(component.showSleepMetric()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Sleep overview');
  });

  it('restores a saved range when settings hydrate after the signed-in account', async () => {
    await createComponent();

    hydrateSavedRange('1y');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.routeState().range).toBe('1y');
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
  });

  it('restores a saved metric when settings hydrate late without overwriting a local selection', async () => {
    await createComponent();

    hydrateSavedMetric(HEALTH_METRIC_IDS.Steps);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.Steps);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();

    component.selectMetric(HEALTH_METRIC_IDS.HeartRate);
    await fixture.whenStable();
    hydrateSavedMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.HeartRate);
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.HeartRate,
      range: '30d',
    });
  });

  it('keeps loaded highlights mounted when same-user metric and range settings change', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    const priorityGrid = host.querySelector('.health-priority-grid');
    const sleepSummary = host.querySelector('app-health-sleep-stage-summary');
    const priorityCalls = (metricId: HealthMetricId) => loadMetricRange.mock.calls
      .filter(([, request]) => request.metricId === metricId);
    expect(priorityCalls(HEALTH_METRIC_IDS.HeartRate)).toHaveLength(1);
    expect(priorityCalls(HEALTH_METRIC_IDS.HeartRateVariability)).toHaveLength(1);

    loadMetricRange.mockImplementation(() => new Promise<HealthWorkspaceRangeLoad>(() => undefined));
    hydrateSavedMetric(HEALTH_METRIC_IDS.Steps);
    fixture.detectChanges();
    await Promise.resolve();
    hydrateSavedRange('90d');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(host.querySelector('.health-priority-grid')).toBe(priorityGrid);
    expect(host.querySelector('app-health-sleep-stage-summary')).toBe(sleepSummary);
    expect(priorityGrid?.textContent).not.toContain('Loading sources…');
    expect(priorityCalls(HEALTH_METRIC_IDS.HeartRate)).toHaveLength(1);
    expect(priorityCalls(HEALTH_METRIC_IDS.HeartRateVariability)).toHaveLength(1);
  });

  it('serializes rapid metric and range changes without losing either preference', async () => {
    await createComponent();
    let resolveFirstWrite: () => void;
    const firstWrite = new Promise<void>(resolve => {
      resolveFirstWrite = resolve;
    });
    updateHealthWorkspacePreferences.mockReturnValueOnce(firstWrite);

    component.selectMetric(HEALTH_METRIC_IDS.Steps);
    component.selectRange('90d');

    expect(updateHealthWorkspacePreferences).toHaveBeenCalledTimes(1);
    expect(updateHealthWorkspacePreferences).toHaveBeenNthCalledWith(1, 'user-1', {
      metric: HEALTH_METRIC_IDS.Steps,
      range: '30d',
    });

    resolveFirstWrite!();
    await fixture.whenStable();

    expect(updateHealthWorkspacePreferences).toHaveBeenCalledTimes(2);
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.Steps,
      range: '90d',
    });
  });

  it('renders providers as separate series, exposes an accessible source table, and filters locally', async () => {
    await createComponent();
    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelectorAll('.health-chart-panel')).toHaveLength(2);
    expect(nativeElement.querySelectorAll('.health-echarts-stub')).toHaveLength(2);
    expect(nativeElement.querySelector('.health-chart-svg')).toBeNull();
    expect(nativeElement.textContent).toContain('Garmin');
    expect(nativeElement.textContent).toContain('COROS');
    expect(nativeElement.textContent).not.toContain('secret-account');
    expect(nativeElement.textContent).toContain('Health never blends providers');
    expect(nativeElement.querySelector('table caption')?.textContent).toContain('Providers are not blended');
    expect(nativeElement.querySelector('mat-expansion-panel.health-source-table-panel')).toBeTruthy();
    expect(nativeElement.querySelector('details.health-source-table-panel')).toBeNull();
    expect(nativeElement.textContent).toContain('missing');
    expect(nativeElement.textContent).toContain('source-days');

    const garminFilter = fixture.debugElement.queryAll(By.css('.health-provider-filter'))
      .find(button => button.nativeElement.textContent.includes('Garmin'));
    const allSourcesFilter = fixture.debugElement.queryAll(By.css('.health-provider-filter'))
      .find(button => button.nativeElement.textContent.includes('All sources'));
    expect(garminFilter?.nativeElement.tagName).toBe('BUTTON');
    expect(garminFilter?.nativeElement.getAttribute('aria-pressed')).toBe('false');
    garminFilter?.triggerEventHandler('click');
    fixture.detectChanges();

    expect(nativeElement.querySelectorAll('.health-chart-panel')).toHaveLength(1);
    expect(nativeElement.querySelector('.health-chart-panel')?.textContent).toContain('Garmin');
    expect(garminFilter?.nativeElement.getAttribute('aria-pressed')).toBe('true');
    expect(allSourcesFilter?.nativeElement.getAttribute('aria-pressed')).toBe('false');
    expect(loadMetricRange).toHaveBeenCalledTimes(3);
  });

  it('opens Sleep as local workspace state and reuses the normalized Sleep trend surface', async () => {
    await createComponent();
    component.selectMetric('sleep');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.routeState()).toEqual({ metric: 'sleep', range: '30d', endDate: todayDate });
    expect(router.url).not.toContain('?');
    expect((fixture.nativeElement as HTMLElement).querySelector('.sleep-chart-stub')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('table caption')?.textContent)
      .toContain('Normalized Sleep sessions by source');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('secret-provider-user');
  });

  it('keeps a 1d Sleep view on the selected sleep date without blending same-day providers', async () => {
    const yesterdayDate = new Date(todayStartMs - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    const previousSleep = {
      ...sleepSession(),
      id: 'sleep-previous',
      sleepDate: yesterdayDate,
      startTimeMs: todayStartMs - (26 * 60 * 60 * 1000),
      endTimeMs: todayStartMs,
    };
    const sameDaySuuntoSleep = {
      ...sleepSession(),
      id: 'sleep-suunto',
      source: {
        ...sleepSession().source,
        provider: SLEEP_PROVIDERS.SuuntoApp,
        sourceSessionKey: 'opaque-suunto-sleep',
      },
    };
    await createComponent(undefined, undefined, {
      sleepSessions: [previousSleep, sleepSession(), sameDaySuuntoSleep],
    });

    component.selectMetric('sleep');
    component.selectRange('today');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.windowedSleepSessions().map(session => session.id)).toEqual(['sleep-one', 'sleep-suunto']);
    expect(component.sleepTrend().points.filter(point => !point.isPlaceholder)).toHaveLength(2);
    expect(component.sleepRows()).toHaveLength(2);
    expect(component.availableProviders()).toEqual([
      HEALTH_PROVIDERS.GarminAPI,
      HEALTH_PROVIDERS.SuuntoApp,
    ]);
  });

  it('ignores a stale in-flight metric response after local metric navigation changes', async () => {
    await createComponent();
    let resolveSteps: ((value: HealthWorkspaceRangeLoad) => void) | null = null;
    const stepsPromise = new Promise<HealthWorkspaceRangeLoad>(resolve => {
      resolveSteps = resolve;
    });
    loadMetricRange.mockImplementation((_uid: string, request: { metricId: HealthMetricId }) =>
      request.metricId === HEALTH_METRIC_IDS.Steps
        ? stepsPromise
        : Promise.resolve(rangeLoad(request.metricId)));

    component.selectMetric(HEALTH_METRIC_IDS.Steps);
    fixture.detectChanges();
    await Promise.resolve();
    component.selectMetric(HEALTH_METRIC_IDS.HeartRateVariability);
    fixture.detectChanges();
    await Promise.resolve();
    resolveSteps?.(rangeLoad(HEALTH_METRIC_IDS.Steps));
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.HeartRateVariability);
    expect(component.selectedHealthLoad()?.result.query.metricIds).toEqual([HEALTH_METRIC_IDS.HeartRateVariability]);
    expect((fixture.nativeElement as HTMLElement).querySelector('#health-detail-title')?.textContent).toContain('Heart rate variability');
  });

  it('loads workout Weight for the exact remembered Health window and labels it as fallback context', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, metricId === HEALTH_METRIC_IDS.BodyWeight)));

    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(loadActivityHealthRange).toHaveBeenCalledWith({
      metricId: HEALTH_METRIC_IDS.BodyWeight,
      startTimeMs: component.selectedWindow().startTimeMs,
      endTimeMs: component.selectedWindow().endTimeMs,
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Workout Weight is profile context');
    expect(host.textContent).toContain('Workout profile context');
    expect(host.textContent).toContain('Not applicable');
    expect(host.textContent).not.toContain('opaque-workout-account');
    expect(host.querySelectorAll('.health-chart-panel')).toHaveLength(1);
  });

  it('keeps a later workout-metric response when an earlier request resolves late', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    let resolveWeight: ((value: ActivityHealthRangeResult) => void) | null = null;
    const weightPromise = new Promise<ActivityHealthRangeResult>(resolve => {
      resolveWeight = resolve;
    });
    loadActivityHealthRange.mockImplementation((request: { metricId: HealthMetricId }) => (
      request.metricId === HEALTH_METRIC_IDS.BodyWeight
        ? weightPromise
        : Promise.resolve(activityRangeResult({ metricId: HEALTH_METRIC_IDS.Vo2Max }))
    ));

    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    await Promise.resolve();
    component.selectMetric(HEALTH_METRIC_IDS.Vo2Max);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.selectedActivityHealthResult()?.observations[0].metricId).toBe(HEALTH_METRIC_IDS.Vo2Max);
    resolveWeight?.(activityRangeResult());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.Vo2Max);
    expect(component.selectedActivityHealthResult()?.observations[0].metricId).toBe(HEALTH_METRIC_IDS.Vo2Max);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Workout VO₂ max is separate evidence');
  });

  it('surfaces incomplete and failed workout-source loads without hiding valid Health data', async () => {
    await createComponent();
    loadMetricRange.mockResolvedValueOnce({
      ...rangeLoad(HEALTH_METRIC_IDS.Vo2Max),
      limitReached: 'source_records',
    });
    loadActivityHealthRange.mockResolvedValueOnce({
      ...activityRangeResult({ metricId: HEALTH_METRIC_IDS.Vo2Max }),
      complete: false,
      incompleteReason: 'candidate_limit',
      candidateCount: 2_048,
    });
    component.selectMetric(HEALTH_METRIC_IDS.Vo2Max);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('2,048 source records');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('2,048 workout candidates');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('safety limits');

    loadActivityHealthRange.mockRejectedValueOnce(new Error('irrelevant private provider failure'));
    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent)
      .not.toContain('Workout-backed observations could not be loaded');

    loadActivityHealthRange.mockRejectedValueOnce(new Error('private provider failure'));
    component.selectMetric(HEALTH_METRIC_IDS.Vo2Max);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Workout-backed observations could not be loaded');
    expect(text).not.toContain('private provider failure');
  });

  it('refreshes selected and priority data when sync-state timestamps advance', async () => {
    await createComponent();
    expect(loadMetricRange).toHaveBeenCalledTimes(3);
    expect(loadAvailableMetricIds).toHaveBeenCalledTimes(1);

    syncStates.next([{
      provider: HEALTH_PROVIDERS.GarminAPI,
      status: HEALTH_SYNC_STATUSES.Ready,
      lastSyncedAtMs: todayStartMs + 1_000,
      updatedAtMs: 2,
    }]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(loadMetricRange.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(loadAvailableMetricIds).toHaveBeenCalledTimes(2);
  });

  it('keeps rendered highlights mounted while a sync-driven refresh is pending', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    const priorityGrid = host.querySelector('.health-priority-grid');
    const sleepSummary = host.querySelector('app-health-sleep-stage-summary');
    const originalText = priorityGrid?.textContent;
    loadMetricRange.mockImplementation(() => new Promise<HealthWorkspaceRangeLoad>(() => undefined));

    syncStates.next([{
      provider: HEALTH_PROVIDERS.GarminAPI,
      status: HEALTH_SYNC_STATUSES.Ready,
      lastSyncedAtMs: todayStartMs + 1_000,
      updatedAtMs: 2,
    }]);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(host.querySelector('.health-priority-grid')).toBe(priorityGrid);
    expect(host.querySelector('app-health-sleep-stage-summary')).toBe(sleepSummary);
    expect(priorityGrid?.textContent).toBe(originalText);
    expect(priorityGrid?.textContent).not.toContain('Loading sources…');
  });

  it('shows the newest provider sync timestamp even when an older field is also present', async () => {
    await createComponent();
    const newestTimestamp = todayStartMs + (2 * 60 * 60 * 1000);
    syncStates.next([{
      provider: HEALTH_PROVIDERS.GarminAPI,
      status: HEALTH_SYNC_STATUSES.Ready,
      lastSyncedAtMs: todayStartMs + (60 * 60 * 1000),
      lastWebhookAtMs: newestTimestamp,
      updatedAtMs: 2,
    }]);
    fixture.detectChanges();

    const expectedDate = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(newestTimestamp));
    expect(component.syncStateViews()[0].lastUpdateText).toContain(expectedDate);
  });

  it('maps sync-state permission failures to Connectivity instead of emitting an unhandled error', async () => {
    await createComponent();

    syncStates.error({ code: 'permission-denied' });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(component.syncStatesStatus()).toBe('denied');
    expect(host.textContent).toContain('Health sync status access was denied');
    expect(host.querySelector('.health-sync-footer [routerlink="/services"]')).toBeTruthy();
  });

  it('maps ready source recency to current, delayed, stale, and waiting footer states', async () => {
    await createComponent();
    const nowMs = Date.now();
    syncStates.next([
      {
        provider: HEALTH_PROVIDERS.GarminAPI,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: nowMs - (2 * 60 * 60 * 1000),
        updatedAtMs: 4,
      },
      {
        provider: HEALTH_PROVIDERS.SuuntoApp,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: nowMs - (2 * 24 * 60 * 60 * 1000),
        updatedAtMs: 3,
      },
      {
        provider: HEALTH_PROVIDERS.COROSAPI,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: nowMs - (8 * 24 * 60 * 60 * 1000),
        updatedAtMs: 2,
      },
      {
        provider: HEALTH_PROVIDERS.WahooAPI,
        status: HEALTH_SYNC_STATUSES.Ready,
        updatedAtMs: 1,
      },
    ]);
    fixture.detectChanges();

    expect(Object.fromEntries(component.syncStateViews().map(state => [state.provider, {
      statusLabel: state.statusLabel,
      tone: state.tone,
      statusTooltip: state.statusTooltip,
    }]))).toEqual({
      [HEALTH_PROVIDERS.COROSAPI]: {
        statusLabel: 'Stale',
        tone: 'stale',
        statusTooltip: 'Stale: no source update has arrived for more than 7 days.',
      },
      [HEALTH_PROVIDERS.GarminAPI]: {
        statusLabel: 'Current',
        tone: 'current',
        statusTooltip: 'Current: the latest source update arrived within the last 36 hours.',
      },
      [HEALTH_PROVIDERS.SuuntoApp]: {
        statusLabel: 'Delayed',
        tone: 'delayed',
        statusTooltip: 'Delayed: the latest source update is between 36 hours and 7 days old.',
      },
      [HEALTH_PROVIDERS.WahooAPI]: {
        statusLabel: 'Waiting',
        tone: 'neutral',
        statusTooltip: 'Waiting: no Health update has arrived yet.',
      },
    });
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-sync-item')).toHaveLength(4);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-dot[data-tone="current"]')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-dot[data-tone="delayed"]')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-dot[data-tone="stale"]')).toBeTruthy();
    expect(
      fixture.debugElement
        .query(By.css('.health-sync-dot[data-tone="current"]'))
        .injector.get(MatTooltip)
        .message,
    ).toBe('Current: the latest source update arrived within the last 36 hours.');
  });

  it('offers the existing provider history import when no Sleep or Health backfill has run', async () => {
    await createComponent();

    const host = fixture.nativeElement as HTMLElement;
    const actionsButton = host.querySelector('.health-sync-actions') as HTMLButtonElement;
    expect(actionsButton.getAttribute('aria-label')).toBe('More actions for Garmin');
    expect(actionsButton.textContent).not.toContain('Import history');

    await component.startHistoryImport(HEALTH_PROVIDERS.GarminAPI);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(backfillGarminHealthForCurrentUser).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.health-sync-actions')).toBeNull();
    expect(host.textContent).toContain('History queued');
  });

  it('does not offer history import after a previous request or without plan access', async () => {
    await createComponent();
    sleepSyncStates[SLEEP_PROVIDERS.GarminAPI].next({
      provider: SLEEP_PROVIDERS.GarminAPI,
      status: 'ready',
      lastBackfillQueuedAtMs: todayStartMs,
      lastBackfillStartMs: todayStartMs - 1_000,
      lastBackfillEndMs: todayStartMs,
      updatedAtMs: todayStartMs,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-actions')).toBeNull();

    sleepSyncStates[SLEEP_PROVIDERS.GarminAPI].next(null);
    hasProAccess.set(false);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-actions')).toBeNull();
  });

  it('offers a retry after a failed history import and keeps provider errors inline', async () => {
    await createComponent();
    sleepSyncStates[SLEEP_PROVIDERS.GarminAPI].next({
      provider: SLEEP_PROVIDERS.GarminAPI,
      status: 'failed',
      healthBackfillStatus: 'failed',
      lastBackfillQueuedAtMs: null,
      nextBackfillAllowedAtMs: null,
      updatedAtMs: todayStartMs,
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const actionsButton = host.querySelector('.health-sync-actions') as HTMLButtonElement;
    expect(actionsButton.getAttribute('aria-label')).toBe('More actions for Garmin');

    backfillGarminHealthForCurrentUser.mockRejectedValueOnce(new Error('provider details'));
    await component.startHistoryImport(HEALTH_PROVIDERS.GarminAPI);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain('History import could not be started.');
    expect(host.textContent).not.toContain('provider details');
    expect((host.querySelector('.health-sync-actions') as HTMLButtonElement).getAttribute('aria-label'))
      .toBe('More actions for Garmin');
  });

  it('does not mistake an unrelated live-sync failure for a failed history import', async () => {
    await createComponent();
    sleepSyncStates[SLEEP_PROVIDERS.GarminAPI].next({
      provider: SLEEP_PROVIDERS.GarminAPI,
      status: 'failed',
      lastError: 'Live sync failed.',
      updatedAtMs: todayStartMs,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-import')).toBeNull();

    await component.startHistoryImport(HEALTH_PROVIDERS.GarminAPI);
    expect(backfillGarminHealthForCurrentUser).not.toHaveBeenCalled();
  });

  it('does not mistake a later live-sync failure for a failed backfill', async () => {
    await createComponent();
    sleepSyncStates[SLEEP_PROVIDERS.GarminAPI].next({
      provider: SLEEP_PROVIDERS.GarminAPI,
      status: 'failed',
      lastBackfillQueuedAtMs: todayStartMs,
      lastBackfillStartMs: todayStartMs - 1_000,
      lastBackfillEndMs: todayStartMs,
      lastBackfillQueueItems: 2,
      nextBackfillAllowedAtMs: todayStartMs,
      lastError: 'A later live sync failed.',
      updatedAtMs: todayStartMs,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-import')).toBeNull();
  });

  it('suppresses history import when sync-state absence could not be verified', async () => {
    await createComponent(undefined, undefined, {
      sleepSyncErrors: [SLEEP_PROVIDERS.GarminAPI],
    });

    expect(component.sleepSyncStateResolved()[SLEEP_PROVIDERS.GarminAPI]).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-import')).toBeNull();
  });

  it('directs permission-blocked history imports to Connectivity instead of retrying', async () => {
    await createComponent();
    sleepSyncStates[SLEEP_PROVIDERS.GarminAPI].next({
      provider: SLEEP_PROVIDERS.GarminAPI,
      status: 'permission_missing',
      lastError: 'Missing required Garmin permissions.',
      updatedAtMs: todayStartMs,
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-sync-import')).toBeNull();
    expect(host.textContent).toContain('History permission needed');
    expect(host.querySelector('.health-sync-footer [routerlink="/services"]')).toBeTruthy();
  });

  it('does not let an old account request clear a newer account request', async () => {
    await createComponent();
    let resolveFirst: (value: typeof backfillResponse) => void;
    let resolveSecond: (value: typeof backfillResponse) => void;
    const firstResponse = new Promise<typeof backfillResponse>(resolve => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise<typeof backfillResponse>(resolve => {
      resolveSecond = resolve;
    });
    backfillGarminHealthForCurrentUser
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);

    const firstRequest = component.startHistoryImport(HEALTH_PROVIDERS.GarminAPI);
    expect(component.historyImportProvider()).toBe(HEALTH_PROVIDERS.GarminAPI);

    setCurrentUserID('user-2');
    fixture.detectChanges();
    const secondRequest = component.startHistoryImport(HEALTH_PROVIDERS.GarminAPI);
    expect(component.historyImportProvider()).toBe(HEALTH_PROVIDERS.GarminAPI);

    resolveFirst!(backfillResponse);
    await firstRequest;
    expect(component.historyImportProvider()).toBe(HEALTH_PROVIDERS.GarminAPI);

    resolveSecond!(backfillResponse);
    await secondRequest;
    expect(component.historyImportProvider()).toBeNull();
  });

  it('keeps an import active across same-account profile refreshes', async () => {
    await createComponent();
    let resolveRequest: (value: typeof backfillResponse) => void;
    const response = new Promise<typeof backfillResponse>(resolve => {
      resolveRequest = resolve;
    });
    backfillGarminHealthForCurrentUser.mockReturnValueOnce(response);

    const request = component.startHistoryImport(HEALTH_PROVIDERS.GarminAPI);
    setCurrentUserID('user-1');
    fixture.detectChanges();

    expect(component.historyImportProvider()).toBe(HEALTH_PROVIDERS.GarminAPI);

    resolveRequest!(backfillResponse);
    await request;
    expect(component.historyImportProvider()).toBeNull();
    expect(component.sleepSyncStates()[SLEEP_PROVIDERS.GarminAPI]?.healthBackfillStatus).toBe('queued');
  });

  it('refreshes when one provider advances below another provider timestamp', async () => {
    await createComponent();
    syncStates.next([
      {
        provider: HEALTH_PROVIDERS.GarminAPI,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: todayStartMs,
        updatedAtMs: 30,
      },
      {
        provider: HEALTH_PROVIDERS.SuuntoApp,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: todayStartMs,
        updatedAtMs: 10,
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const callCountAfterGarminAdvanced = loadMetricRange.mock.calls.length;

    syncStates.next([
      {
        provider: HEALTH_PROVIDERS.GarminAPI,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: todayStartMs,
        updatedAtMs: 30,
      },
      {
        provider: HEALTH_PROVIDERS.SuuntoApp,
        status: HEALTH_SYNC_STATUSES.Ready,
        lastSyncedAtMs: todayStartMs,
        updatedAtMs: 20,
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(loadMetricRange.mock.calls.length).toBeGreaterThanOrEqual(callCountAfterGarminAdvanced + 3);
  });

  it('maps denied reads to Connectivity, but keeps empty windows actionable in place', async () => {
    await createComponent(() => Promise.reject({ code: 'permission-denied' }));
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Health data access was denied');
    expect((fixture.nativeElement as HTMLElement).querySelector('[routerlink="/services"]')).toBeTruthy();

    TestBed.resetTestingModule();
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    const emptyState = (fixture.nativeElement as HTMLElement).querySelector('.health-detail-state');
    expect(emptyState?.textContent).toContain('No Resting heart rate data in this window');
    expect(emptyState?.textContent).toContain('Choose another date range or a metric with imported readings.');
    expect(emptyState?.querySelector('[routerlink="/services"]')).toBeNull();
  });

  it('explains sample-only metrics instead of implying an empty 90-day aggregate', async () => {
    await createComponent();
    loadMetricRange.mockImplementation((_uid: string, request: { metricId: HealthMetricId }) => Promise.resolve({
      ...rangeLoad(request.metricId, true),
      hasMatchingSourceRecords: true,
      hasSampleBackedMetric: true,
      providers: [HEALTH_PROVIDERS.GarminAPI],
      sampleBackedProviders: [HEALTH_PROVIDERS.GarminAPI],
    }));

    component.selectMetric(HEALTH_METRIC_IDS.HeartRate);
    component.selectRange('90d');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('This metric is stored as detailed samples');
    expect(text).toContain('Detailed samples load only for Today, 14-day, and 30-day windows');
    expect(text).not.toContain('No Heart rate data in this window');
  });

  it('keeps sample-only providers filterable and scopes the long-range explanation', async () => {
    await createComponent();
    loadMetricRange.mockImplementation((_uid: string, request: { metricId: HealthMetricId }) => Promise.resolve({
      ...rangeLoad(request.metricId, true),
      hasMatchingSourceRecords: true,
      hasSampleBackedMetric: true,
      providers: [HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.COROSAPI],
      sampleBackedProviders: [HEALTH_PROVIDERS.GarminAPI],
    }));

    component.selectMetric(HEALTH_METRIC_IDS.HeartRate);
    component.selectRange('90d');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.availableProviders()).toEqual([HEALTH_PROVIDERS.COROSAPI, HEALTH_PROVIDERS.GarminAPI]);
    expect(component.sampleOnlyLongRange()).toBe(true);

    component.toggleProvider(HEALTH_PROVIDERS.COROSAPI);
    fixture.detectChanges();

    expect(component.sampleOnlyLongRange()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No Heart rate data in this window');
  });

  it('keeps a selected Health view active and offers retry when preference persistence fails', async () => {
    await createComponent();
    updateHealthWorkspacePreferences.mockRejectedValueOnce(new Error('offline'));

    component.selectMetric(HEALTH_METRIC_IDS.Steps);
    await fixture.whenStable();
    updateHealthWorkspacePreferences.mockRejectedValueOnce(new Error('offline'));
    component.selectRange('1y');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.routeState().range).toBe('1y');
    expect(component.preferencesSaveFailed()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('This Health view is active, but it was not saved');

    component.retryPreferenceSave();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.Steps,
      range: '1y',
    });
    expect(component.preferencesSaveFailed()).toBe(false);
  });
});
