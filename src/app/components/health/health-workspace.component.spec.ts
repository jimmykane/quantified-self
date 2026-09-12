import { Component, Input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { AppThemes, DistanceUnits } from '@sports-alliance/sports-lib';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
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
  HealthSampleChunk,
  HealthSyncState,
  getHealthMetricDefinition,
} from '@shared/health';
import { ProviderPresentation } from '@shared/provider-presentation';
import {
  ACTIVITY_HEALTH_SOURCE_KINDS,
  type ActivityHealthRangeResult,
} from '@shared/activity-health';
import { SLEEP_PROVIDERS, SleepSession } from '@shared/sleep';
import { projectLoadedHealthRange } from '@shared/health-query';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppEventService } from '../../services/app.event.service';
import { AppHealthService, HealthWorkspaceRangeLoad } from '../../services/app.health.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../helpers/echarts-tooltip-interaction.helper';
import { AppHealthWorkspaceMetric, AppHealthWorkspaceRange, AppHealthHighlightSources } from '../../models/app-user.interface';
import {
  HealthWorkspaceSeries,
  type ManualHealthObservationEdit,
  localCalendarDate,
} from '../../helpers/health-workspace.helper';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { HealthMetricChartComponent } from './health-metric-chart.component';
import { HealthWorkspaceComponent } from './health-workspace.component';
import { HealthPrioritySummaryComponent } from './health-priority-summary.component';
import { TimelineNotesWorkspaceComponent } from '../timeline-notes/timeline-notes-workspace.component';
import { HealthActivityQueryService } from './health-activity-query.service';
import { HealthSourcesBottomSheetComponent, type HealthSourcesResult } from './health-sources-bottom-sheet.component';
import { HealthMetricsBottomSheetComponent } from './health-metrics-bottom-sheet.component';
import type { HealthWorkspaceMetricSelection } from '../../helpers/health-workspace.helper';

@Component({
  selector: 'app-sleep-trend-chart',
  standalone: true,
  template: '<div class="sleep-chart-stub" role="img" aria-label="Sleep trend"></div>',
})
class SleepTrendStubComponent {
  @Input() mobileTapFeedbackOptions: unknown;
  @Input() timelineNotes = null;
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
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
  @Input() fillHeight = false;
  @Input() timelineNotes = null;
  @Input() series: readonly HealthWorkspaceSeries[] = [];
  @Input() startTimeMs = 0;
  @Input() endTimeMs = 0;
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @Input() chartStatuses: Readonly<Record<string, unknown>> = {};
}

const todayDate = localCalendarDate();

@Component({ selector: 'app-timeline-notes-workspace', standalone: true, template: '<button>Timeline notes</button>' })
class TimelineNotesWorkspaceStubComponent { context = () => null; }
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

function manualSourceRecord(
  metricId: typeof HEALTH_METRIC_IDS.BodyWeight | typeof HEALTH_METRIC_IDS.Vo2Max,
  value: number,
  suffix: string,
): HealthSourceRecord {
  const record = sourceRecord(metricId, HEALTH_PROVIDERS.QuantifiedSelf, value, suffix);
  const metric = record.metrics[0];
  if (metric.kind !== 'value') throw new Error('Expected a scalar test metric.');
  return {
    ...record,
    kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
    timezoneOffsetSeconds: 7_200,
    source: {
      ...record.source,
      sourceRecordType: 'manual_measurement',
      revision: { ...record.source.revision, order: 4 },
    },
    metrics: [{
      ...metric,
      aggregation: 'measurement',
      semanticVariant: metricId === HEALTH_METRIC_IDS.BodyWeight
        ? 'point'
        : 'manual_running_lab_test',
      origin: HEALTH_VALUE_ORIGINS.Recorded,
      recordingMethod: HEALTH_RECORDING_METHODS.Manual,
      native: {
        ...metric.native,
        qualifiers: metricId === HEALTH_METRIC_IDS.Vo2Max
          ? { context: 'running', method: 'lab_test' }
          : undefined,
      },
    }],
  };
}

function rangeLoad(metricId: HealthMetricId, empty = false, allDayHeartRate = true): HealthWorkspaceRangeLoad {
  const records = empty ? [] : [
    sourceRecord(metricId, HEALTH_PROVIDERS.GarminAPI, metricId === HEALTH_METRIC_IDS.HeartRateVariability ? 55 : 52, 'garmin'),
    sourceRecord(metricId, metricId === HEALTH_METRIC_IDS.HeartRate && allDayHeartRate ? HEALTH_PROVIDERS.SuuntoApp : HEALTH_PROVIDERS.COROSAPI,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability ? 61 : 58, 'coros'),
  ];
  const chunks: HealthSampleChunk[] = metricId === HEALTH_METRIC_IDS.HeartRate && allDayHeartRate ? records.map((record, index) => {
    const id = `chunk-${index}`;
    record.sampleChunkIds = [id];
    const value = index ? 58 : 52;
    return {
      schemaVersion: HEALTH_SCHEMA_VERSION, id, userID: 'user-1', parentSourceRecordId: record.id,
      provider: record.source.provider, accountKey: record.source.accountKey, metricId, valueType: 'number',
      aggregation: index ? 'average' : 'representative_sample',
      semanticVariant: index ? 'activity_interval_average' : 'daily_15_second',
      origin: HEALTH_VALUE_ORIGINS.Recorded, recordingMethod: HEALTH_RECORDING_METHODS.Device,
      normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
      nativeMetric: 'heartRate', nativeUnit: 'bpm', canonicalUnit: 'bpm',
      calendarDate: todayDate, startTimeMs: todayStartMs, endTimeMs: todayStartMs + (index + 1) * 60_000,
      seriesKey: id, chunkIndex: 0, offsetMs: [0, (index + 1) * 60_000],
      nativeValues: [value - 2, value], canonicalValues: [value - 2, value],
      revision: record.source.revision, coverage: record.coverage,
      receivedAtMs: record.source.receivedAtMs, createdAtMs: todayStartMs, updatedAtMs: todayStartMs,
    };
  }) : [];
  const result = projectLoadedHealthRange(records, chunks, {
    startDate: new Date(todayStartMs - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
    endDate: todayDate,
    metricIds: [metricId],
    includeSamples: chunks.length > 0,
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
  options: {
    metricId?: typeof HEALTH_METRIC_IDS.BodyWeight | typeof HEALTH_METRIC_IDS.Vo2Max;
    provider?: HealthProvider;
  } = {},
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
      provider: options.provider || HEALTH_PROVIDERS.GarminAPI,
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

function hrvSleepSessions(): SleepSession[] {
  return [
    { daysAgo: 4, value: 50 },
    { daysAgo: 2, value: 52 },
    { daysAgo: 0, value: 58 },
  ].map(({ daysAgo, value }) => {
    const endTimeMs = todayStartMs - (daysAgo * 24 * 60 * 60 * 1000);
    return sleepSession({
      id: `sleep-${daysAgo}`,
      sleepDate: localCalendarDate(endTimeMs),
      startTimeMs: endTimeMs - (8 * 60 * 60 * 1000),
      endTimeMs,
      vitals: { averageHrvMs: value, averageHeartRateBpm: 52 },
    });
  });
}

function hrvBaselineSleepSessions(): SleepSession[] {
  return Array.from({ length: 20 }, (_, daysAgo) => {
    const endTimeMs = todayStartMs - (daysAgo * 24 * 60 * 60 * 1000);
    return sleepSession({
      id: `baseline-sleep-${daysAgo}`,
      sleepDate: localCalendarDate(endTimeMs),
      startTimeMs: endTimeMs - (8 * 60 * 60 * 1000),
      endTimeMs,
      vitals: { averageHrvMs: 50 + (daysAgo % 3), averageHeartRateBpm: 52 },
    });
  });
}

describe('HealthWorkspaceComponent', () => {
  let haptics: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<HealthWorkspaceComponent>;
  let component: HealthWorkspaceComponent;
  let router: Router;
  let openBottomSheet: ReturnType<typeof vi.fn>;
  let dismissBottomSheet: ReturnType<typeof vi.fn>;
  let sourcesDismissed: Subject<HealthSourcesResult | undefined>;
  let metricsDismissed: Subject<HealthWorkspaceMetricSelection | undefined>;
  let loadMetricRange: ReturnType<typeof vi.fn>;
  let loadAvailableMetricIds: ReturnType<typeof vi.fn>;
  let loadActivityHealthRange: ReturnType<typeof vi.fn>;
  let saveManualMeasurement: ReturnType<typeof vi.fn>;
  let deleteManualMeasurement: ReturnType<typeof vi.fn>;
  let loadManualBloodPressure: ReturnType<typeof vi.fn>;
  let updateHealthWorkspacePreferences: ReturnType<typeof vi.fn>;
  let hydrateSavedRange: (range: AppHealthWorkspaceRange) => void;
  let hydrateSavedMetric: (metric: AppHealthWorkspaceMetric) => void;
  let hydrateHighlightSources: (sources: AppHealthHighlightSources) => void;
  let syncStates: BehaviorSubject<HealthSyncState[]>;
  let setCurrentUserID: (uid: string) => void;

  async function createComponent(
    loadImplementation?: (metricId: HealthMetricId) => Promise<HealthWorkspaceRangeLoad>,
    savedRange?: AppHealthWorkspaceRange,
    availability: {
      metricIds?: readonly HealthMetricId[];
      healthError?: unknown;
      hasSleep?: boolean;
      sleepSessions?: readonly SleepSession[];
      sleepError?: unknown;
    } = {},
    savedMetric?: AppHealthWorkspaceMetric,
    highlightSources?: AppHealthHighlightSources,
  ): Promise<void> {
    haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    sourcesDismissed = new Subject();
    metricsDismissed = new Subject();
    dismissBottomSheet = vi.fn();
    openBottomSheet = vi.fn().mockImplementation(sheetComponent => ({
      dismiss: dismissBottomSheet,
      afterDismissed: () => sheetComponent === HealthMetricsBottomSheetComponent
        ? metricsDismissed.asObservable() : sourcesDismissed.asObservable(),
    }));
    loadMetricRange = vi.fn().mockImplementation((_uid: string, request: { metricId: HealthMetricId }) =>
      loadImplementation ? loadImplementation(request.metricId) : Promise.resolve(rangeLoad(request.metricId)));
    loadAvailableMetricIds = availability.healthError
      ? vi.fn().mockRejectedValue(availability.healthError)
      : vi.fn().mockResolvedValue(
        availability.metricIds || Object.keys(HEALTH_METRIC_CATALOG) as HealthMetricId[],
      );
    loadActivityHealthRange = vi.fn().mockResolvedValue(activityRangeResult());
    saveManualMeasurement = vi.fn().mockResolvedValue({
      sourceRecordId: 'manual-record',
      revisionOrder: todayStartMs,
    });
    deleteManualMeasurement = vi.fn().mockResolvedValue({ deleted: true });
    loadManualBloodPressure = vi.fn();
    updateHealthWorkspacePreferences = vi.fn().mockResolvedValue(undefined);
    const savedHealthWorkspace = {
      ...(highlightSources ? { highlightSources } : {}),
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
    hydrateHighlightSources = highlightSources => user.update(current => ({
      ...current,
      settings: { appSettings: { healthWorkspace: {
        ...current.settings.appSettings?.healthWorkspace, highlightSources,
      } } },
    }));
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
    const defaultSleepSessions = (availability.hasSleep ?? true) ? [sleepSession()] : [];

    await TestBed.configureTestingModule({
      imports: [HealthWorkspaceComponent],
      providers: [
        provideRouter([]),
        { provide: AppHapticsService, useValue: haptics },
        { provide: MatBottomSheet, useValue: { open: openBottomSheet } },
        { provide: AppEventService, useValue: { getEventMetaDataKeys: () => of([]) } },
        {
          provide: AppUserService,
          useValue: {
            user,
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
            saveManualMeasurement,
            deleteManualMeasurement,
            loadManualBloodPressure,
            watchSyncStates: () => syncStates.asObservable(),
          },
        },
        {
          provide: BrowserCompatibilityService,
          useValue: { createRandomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
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
          },
        },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Light) } },
        // Highlight charts use the series component directly. Keep workspace
        // orchestration tests independent of real canvas/timing; chart behavior
        // has its own component suites.
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue({ isDisposed: () => false, dispatchAction: vi.fn() }),
          setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: vi.fn().mockReturnValue(() => undefined),
          attachMobileSeriesTapFeedback: vi.fn().mockReturnValue(() => undefined),
        } },
      ],
    })
      .overrideComponent(HealthWorkspaceComponent, {
        remove: { imports: [AppChartsModule, ServiceSourceIconComponent, HealthMetricChartComponent, TimelineNotesWorkspaceComponent] },
        add: { imports: [SleepTrendStubComponent, ServiceSourceIconStubComponent, HealthMetricChartStubComponent, TimelineNotesWorkspaceStubComponent] },
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

  it('keeps initialization, saved-view hydration, and sync refreshes silent', async () => {
    await createComponent();
    hydrateSavedMetric(HEALTH_METRIC_IDS.Steps);
    hydrateSavedRange('14d');
    syncStates.next([{ provider: HEALTH_PROVIDERS.GarminAPI, status: HEALTH_SYNC_STATUSES.Ready, updatedAtMs: 2 }]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
  });

  it('provides one selection pulse for metric, range, source, and window actions, but none for no-ops', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    component.selectMetric(component.routeState().metric);
    component.selectRange(component.routeState().range);
    component.showAllProviders();
    component.jumpToToday();
    host.querySelector<HTMLButtonElement>('.health-window-newer')!.click();
    expect(haptics.selection).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('.health-mobile-metric-title')!.click();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    metricsDismissed.next(HEALTH_METRIC_IDS.Steps);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    fixture.detectChanges();
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('button[aria-label="14 days"]')!.click();
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    component.toggleProvider(HEALTH_PROVIDERS.GarminAPI);
    expect(haptics.selection).toHaveBeenCalledTimes(4);
    component.showAllProviders();
    expect(haptics.selection).toHaveBeenCalledTimes(5);
    host.querySelector<HTMLButtonElement>('.health-window-older')!.click();
    fixture.detectChanges();
    expect(haptics.selection).toHaveBeenCalledTimes(6);
    host.querySelector<HTMLButtonElement>('.health-window-today')!.click();
    expect(haptics.selection).toHaveBeenCalledTimes(7);
  });

  it('uses the mobile title picker without a duplicate form field and saves through existing preferences', async () => {
    await createComponent(undefined, '14d');
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-mobile-metric-selector')).toBeNull();
    expect(host.querySelector('.health-explorer mat-select')).toBeNull();
    expect(host.querySelector('.health-metric-list')).not.toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>('.health-mobile-metric-title')!;
    expect(trigger.closest('h2')?.id).toBe('health-detail-title');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    trigger.click(); component.openMetricPicker();
    fixture.detectChanges();
    expect(openBottomSheet).toHaveBeenCalledOnce();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(openBottomSheet).toHaveBeenCalledWith(HealthMetricsBottomSheetComponent, expect.objectContaining({
      autoFocus: 'first-tabbable', restoreFocus: true, data: expect.objectContaining({ selected: component.selectedMetric() }),
    }));
    metricsDismissed.next('sleep');
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.routeState()).toMatchObject({ metric: 'sleep', range: '14d' });
    expect(updateHealthWorkspacePreferences).toHaveBeenCalledWith('user-1', expect.objectContaining({ metric: 'sleep', range: '14d' }));
    expect(component.metricPickerOpen()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('does not save cancelled, unchanged, unavailable or unauthenticated metric choices', async () => {
    await createComponent();
    component.openMetricPicker(); metricsDismissed.next(undefined);
    component.openMetricPicker(); metricsDismissed.next(component.selectedMetric());
    component.openMetricPicker(); metricsDismissed.next('not-a-metric' as HealthWorkspaceMetricSelection);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    setCurrentUserID(''); fixture.detectChanges(); await fixture.whenStable();
    component.openMetricPicker();
    expect(openBottomSheet).toHaveBeenCalledTimes(3);
  });

  it.each(['metric', 'window', 'account', 'destroy'] as const)('rejects a late metric choice after a %s change', async change => {
    await createComponent();
    component.openMetricPicker();
    if (change === 'metric') component.selectMetric(HEALTH_METRIC_IDS.Steps);
    if (change === 'window') component.navigateWindow('older');
    if (change === 'account') setCurrentUserID('user-2');
    if (change === 'destroy') fixture.destroy();
    else { fixture.detectChanges(); await fixture.whenStable(); }
    expect(dismissBottomSheet).toHaveBeenCalledOnce();
    const selected = component.selectedMetric();
    haptics.selection.mockClear(); updateHealthWorkspacePreferences.mockClear();
    metricsDismissed.next('sleep');
    expect(component.selectedMetric()).toBe(selected);
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
  });

  it('wires highlight selection, Sleep chart gestures, and mouse/keyboard observation disclosure', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="Open Sleep"]')!.click();
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(SleepTrendStubComponent)).componentInstance.mobileTapFeedbackOptions)
      .toEqual(DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS);
    const header = host.querySelector<HTMLElement>('mat-expansion-panel-header')!;
    header.click();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    expect(haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('defaults to Resting heart rate for 30 days and keeps priority cards in product order', async () => {
    await createComponent();

    expect(component.routeState()).toMatchObject({
      metric: HEALTH_METRIC_IDS.RestingHeartRate,
      range: '30d',
      endDate: todayDate,
    });
    expect(component.priorityCards().map(card => card.label)).toEqual(['Sleep', 'Today’s heart rate', 'HRV']);
    const prioritySection = (fixture.nativeElement as HTMLElement).querySelector('.health-priority-section');
    expect(prioritySection?.textContent).toContain('Highlights');
    expect(prioritySection?.textContent).not.toContain('Last 30 days');
    expect((fixture.nativeElement as HTMLElement).querySelector('#health-detail-title')?.textContent).toContain('Resting heart rate');
    expect(fixture.debugElement.query(By.directive(HealthMetricChartStubComponent)).componentInstance.fillHeight).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-grid')?.tagName).toBe('DIV');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-card app-compact-row')).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-card')).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-card mat-card-header')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-card mat-card-actions')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-explorer')?.classList).not.toContain('qs-glass-card-panel');
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-footer')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.qs-page-header__title-row .health-sources-button')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-sync-card')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('a[href="/dashboard"]')).toBeNull();
    const connectivityLinks = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'a[aria-label="Manage Health connections in Connectivity"]',
    );
    expect(connectivityLinks).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).querySelector(
      'app-page-header a[aria-label="Manage Health connections in Connectivity"]',
    )).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-metric-option-selected')?.getAttribute('aria-pressed')).toBe('true');
    const metricOptionIcons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.health-metric-option .health-metric-option-icon',
    );
    expect(metricOptionIcons).toHaveLength((fixture.nativeElement as HTMLElement).querySelectorAll('.health-metric-option').length);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-card .compact-row__icon > mat-icon')).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-card-selected')).toBeNull();
    expect(Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-open-button'),
    ).every(button => button.getAttribute('aria-pressed') === null)).toBe(true);
    expect(fixture.debugElement.queryAll(By.css(
      '.health-priority-card app-service-source-icon',
    ))).toHaveLength(0);
    const prioritySourceLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-source-label'),
    );
    expect(prioritySourceLabels.length).toBeGreaterThan(0);
    expect(prioritySourceLabels.some(label => label.textContent?.trim() === 'Garmin')).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-chart-source')).toHaveLength(1);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-priority-source-tabs [role="tab"]')).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Open HRV"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-grid')?.classList)
      .toContain('health-priority-grid-double');
    const sleepDetails = (fixture.nativeElement as HTMLElement).querySelector('.health-priority-card:first-child')?.textContent;
    expect(sleepDetails).toContain('Score86');
    expect(sleepDetails).toContain('HRV58 ms');
    expect(sleepDetails).toContain('Avg HR52 bpm');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-health-sleep-stage-summary')).toHaveLength(1);
    expect(sleepDetails).toContain('Sleep stages');
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-provider-filters')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('mat-chip-listbox')).toBeNull();
    expect(router.url).not.toContain('?');
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      metricId: HEALTH_METRIC_IDS.HeartRate,
      includeSamples: true,
    }));
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      includeSamples: false,
    }));
  }, 10_000);

  it('opens the source sheet from the title and keeps range selection beside the chart', async () => {
    await createComponent();
    const button = fixture.nativeElement.querySelector('.health-sources-button') as HTMLButtonElement;
    expect(button.closest('.qs-page-header__title-row')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toContain('Health sources: All sources');
    expect(fixture.nativeElement.querySelector('.health-mobile-view-options')).toBeNull();
    expect(fixture.nativeElement.querySelector('.health-range-menu-button').closest('.health-window-navigation')).not.toBeNull();
    button.click();
    component.openSources();
    expect(openBottomSheet).toHaveBeenCalledOnce();
    expect(openBottomSheet).toHaveBeenCalledWith(HealthSourcesBottomSheetComponent, expect.objectContaining({
      ariaLabel: 'Health sources', restoreFocus: true,
      data: expect.objectContaining({ providers: component.workspaceSourceOptions(), syncStatus: 'ready' }),
    }));
    expect(haptics.selection).toHaveBeenCalledOnce();
    sourcesDismissed.next(undefined);
    expect(component.sourcesOpen()).toBe(false);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
  });

  it('applies sources to Highlights and the explorer without changing preferences or fetching data', async () => {
    await createComponent();
    const loads = loadMetricRange.mock.calls.length;
    component.openSources();
    sourcesDismissed.next({ providers: [HEALTH_PROVIDERS.GarminAPI] });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.routeState().range).toBe('30d');
    expect(component.effectiveProviderFilters()).toEqual([HEALTH_PROVIDERS.GarminAPI]);
    expect(component.visiblePriorityCards().flatMap(card => [...card.rows, ...card.chartSeries])
      .every(item => item.provider === HEALTH_PROVIDERS.GarminAPI)).toBe(true);
    expect(component.metricView().series.every(series => series.provider === HEALTH_PROVIDERS.GarminAPI)).toBe(true);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(loadMetricRange).toHaveBeenCalledTimes(loads);
    expect(component.sourcesButtonLabel()).toBe('Sources · 1');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('does not substitute other providers when the selected source has no data', async () => {
    await createComponent();
    component.selectedProviders.set([HEALTH_PROVIDERS.QuantifiedSelf]);
    fixture.detectChanges();
    expect(component.effectiveProviderFilters()).toEqual([HEALTH_PROVIDERS.QuantifiedSelf]);
    expect(component.metricView().series).toEqual([]);
    expect(component.visiblePriorityCards()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No readings from your selected sources');
    component.selectMetric('sleep');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.filteredSleepSessions()).toEqual([]);
    component.showAllProviders();
    expect(component.filteredSleepSessions().length).toBeGreaterThan(0);
  });

  it('keeps provider choices discovered in another metric until the account changes', async () => {
    await createComponent(async metric => ({
      ...rangeLoad(metric),
      providers: metric === HEALTH_METRIC_IDS.BodyWeight ? [HEALTH_PROVIDERS.QuantifiedSelf] : rangeLoad(metric).providers,
    }));
    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    await fixture.whenStable();
    component.selectMetric(HEALTH_METRIC_IDS.RestingHeartRate);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.workspaceSourceOptions().map(option => option.provider)).toContain(HEALTH_PROVIDERS.QuantifiedSelf);
    component.selectedProviders.set([HEALTH_PROVIDERS.QuantifiedSelf]);
    setCurrentUserID('user-2');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.selectedProviders()).toEqual([]);
    expect(component.workspaceSourceOptions().map(option => option.provider)).not.toContain(HEALTH_PROVIDERS.QuantifiedSelf);
  });

  it('keeps an unchanged source Apply silent', async () => {
    await createComponent();
    component.openSources();
    sourcesDismissed.next({ providers: null });
    expect(haptics.selection).toHaveBeenCalledOnce();
    component.openSources();
    sourcesDismissed.next({ providers: [] });
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
  });

  it.each(['metric', 'window', 'account', 'destroy'] as const)('rejects a late source draft after a %s change', async change => {
    await createComponent();
    component.openSources();
    if (change === 'metric') component.selectMetric(HEALTH_METRIC_IDS.Steps);
    if (change === 'window') component.navigateWindow('older');
    if (change === 'account') setCurrentUserID('user-2');
    if (change === 'destroy') fixture.destroy();
    else { fixture.detectChanges(); await fixture.whenStable(); }
    expect(dismissBottomSheet).toHaveBeenCalledOnce();
    haptics.selection.mockClear();
    sourcesDismissed.next({ providers: [HEALTH_PROVIDERS.GarminAPI] });
    expect(component.selectedProviders()).toEqual([]);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('keeps sources independent from range changes, including during loading', async () => {
    await createComponent();
    component.selectedProviders.set([HEALTH_PROVIDERS.GarminAPI]);
    component.selectedHealthStatus.set('loading');
    component.openSources();
    expect(openBottomSheet.mock.calls[0][1].data.providers.length).toBeGreaterThan(0);
    sourcesDismissed.next({ providers: null });
    component.selectRange('14d');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.selectedProviders()).toEqual([HEALTH_PROVIDERS.GarminAPI]);
    expect(updateHealthWorkspacePreferences).toHaveBeenCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.RestingHeartRate, range: '14d',
    });
  });

  it('uses a Material range menu with checked selection and semantic haptics', async () => {
    await createComponent();
    fixture.nativeElement.querySelector('.health-range-menu-button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const choices = Array.from(document.querySelectorAll<HTMLButtonElement>('.qs-menu-panel [role="menuitemradio"]'));
    expect(choices).toHaveLength(5);
    expect(choices.find(choice => choice.textContent?.includes('30 days'))?.getAttribute('aria-checked')).toBe('true');
    choices.find(choice => choice.textContent?.includes('14 days'))?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.routeState().range).toBe('14d');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('opens highlight metrics without styling the highlight as selected', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    const openHeartRate = host.querySelector<HTMLButtonElement>('[aria-label="Open Today’s heart rate"]');
    const heading = host.querySelector<HTMLElement>('#health-detail-title')!;
    heading.scrollIntoView = vi.fn();

    openHeartRate?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.routeState().metric).toBe(HEALTH_METRIC_IDS.HeartRate);
    expect(host.querySelector('.health-priority-card-selected')).toBeNull();
    expect(openHeartRate?.getAttribute('aria-pressed')).toBeNull();
    expect(host.querySelector('.health-metric-option-selected')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(heading);
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: 'start', inline: 'nearest', behavior: 'auto' });
    expect(haptics.selection).toHaveBeenCalledTimes(1);

    // Reopening the same metric must still take the user from its highlight to the chart.
    openHeartRate?.click();
    expect(document.activeElement).toBe(heading);
    expect(heading.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(component.selectedRange()).toBe('30d');
  });

  it('removes unavailable highlights instead of rendering empty cards', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(
      metricId,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability,
    )), undefined, {
      sleepSessions: [sleepSession({ vitals: { averageHeartRateBpm: 52 } })],
    });

    expect(component.visiblePriorityCards().map(card => card.label)).toEqual(['Sleep', 'Today’s heart rate']);
    const cards = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.health-priority-card'),
    );
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.querySelector('h3')?.textContent?.trim())).toEqual(['Sleep', 'Today’s heart rate']);
    expect((fixture.nativeElement as HTMLElement).querySelector('.health-priority-grid')?.classList)
      .toContain('health-priority-grid-double');
  });

  it('surfaces normalized Sleep HRV when standalone Health HRV is unavailable', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(
      metricId,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability,
    )), undefined, {
      metricIds: [HEALTH_METRIC_IDS.HeartRate],
      sleepSessions: hrvSleepSessions(),
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
    expect(component.workspaceSourceOptions().map(provider => provider.label)).toContain('Garmin');
    expect(component.sleepHrvNotice()).toContain('never averaged with standalone HRV');
    expect(component.visiblePriorityCards().map(card => card.label)).toContain('HRV');
    const hostText = (fixture.nativeElement as HTMLElement).textContent;
    expect(hostText).toContain('Sleep HRV is read from normalized Sleep sessions');
    expect(hostText).toContain('Sleep HRV · 14-day trend');
    expect(hostText).toContain('Building personal range');
    expect(hostText).toContain('3/14 nights');
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', expect.objectContaining({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      startDate: component.priorityHrvHistoryStartDate,
      includeSamples: false,
    }));
    expect(
      (Date.parse(`${component.priorityHrvWindow.endDate}T00:00:00.000Z`)
        - Date.parse(`${component.priorityHrvHistoryStartDate}T00:00:00.000Z`))
      / (24 * 60 * 60 * 1000),
    ).toBe(72);
  });

  it('shows a source-specific HRV personal range after enough recorded nights', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(
      metricId,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability,
    )), undefined, {
      metricIds: [HEALTH_METRIC_IDS.HeartRate],
      sleepSessions: hrvBaselineSleepSessions(),
    });

    const host = fixture.nativeElement as HTMLElement;
    const hrvCard = host.querySelector<HTMLElement>('[aria-labelledby="health-priority-card-heart_rate_variability"]');
    expect(hrvCard?.textContent).toContain('Within personal range');
    expect(hrvCard?.textContent).toContain('7-day average');
    expect(hrvCard?.textContent).toContain('Range');
    expect(hrvCard?.querySelector<HTMLElement>('.health-priority-range-status-dot')?.style.backgroundColor).not.toBe('');
    const setOption = TestBed.inject(EChartsLoaderService).setOption as ReturnType<typeof vi.fn>;
    let hrvChartOption: { series?: Array<{ lineStyle?: { color?: string } }> } | undefined;
    await vi.waitFor(() => {
      hrvChartOption = setOption.mock.calls
        .map(call => call[1] as { series?: Array<{ lineStyle?: { color?: string } }> })
        .find(option => option.series?.[0]?.lineStyle?.color === 'transparent');
      expect(hrvChartOption).toBeDefined();
    });
    expect(hrvChartOption?.series?.length).toBeGreaterThan(1);
    expect(hrvChartOption?.series?.slice(1).every(series => series.lineStyle?.color !== 'transparent')).toBe(true);
  });

  it('applies the same historical personal-range colors to the selected HRV chart', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(
      metricId,
      metricId === HEALTH_METRIC_IDS.HeartRateVariability,
    )), undefined, {
      metricIds: [HEALTH_METRIC_IDS.HeartRate],
      sleepSessions: hrvBaselineSleepSessions(),
    }, HEALTH_METRIC_IDS.HeartRateVariability);

    const chart = fixture.debugElement.query(By.directive(HealthMetricChartStubComponent))
      .componentInstance as HealthMetricChartStubComponent;
    const sleepHrvSeries = component.metricView().series.find(series =>
      series.semanticVariant === 'sleep_session_average_hrv');
    expect(sleepHrvSeries).toBeDefined();
    expect(chart.chartStatuses[sleepHrvSeries!.id]).toMatchObject({
      label: 'Within personal range',
      normalRange: expect.any(Object),
    });
    expect(chart.chartStatuses[sleepHrvSeries!.id].pointStatuses).toHaveLength(
      sleepHrvSeries!.points.length,
    );
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', {
      ...component.selectedHrvContextWindow(),
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      includeSamples: false,
    });
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
    expect(todayButton?.closest('.health-detail-window')).not.toBeNull();
    expect(todayButton?.closest('.health-window-navigation')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-window-navigation > button'))
      .toHaveLength(3);

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
    expect((host.querySelector('[aria-label="Open Today’s heart rate"]') as HTMLButtonElement).disabled).toBe(false);
    expect(host.querySelector('[aria-label="Open Sleep"]')).toBeNull();
    expect(host.querySelector('[aria-label="Open HRV"]')).toBeNull();
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

  it('shows today’s recorded HR and its latest time independently of the explorer range', async () => {
    await createComponent(undefined, '1y');
    const summary = fixture.debugElement.query(By.directive(HealthPrioritySummaryComponent)).componentInstance as HealthPrioritySummaryComponent;
    const heart = summary.renderedCards().find(card => card.id === 'heart_rate')!;
    const window = component.priorityHeartRateWindow;
    expect(window.dayCount).toBe(1);
    expect(heart.chartModels.every(chart => chart.startTimeMs === window.startTimeMs && chart.endTimeMs === window.endTimeMs)).toBe(true);
    expect(loadMetricRange).toHaveBeenCalledWith('user-1', {
      metricId: HEALTH_METRIC_IDS.HeartRate, includeSamples: true,
      startDate: new Date(todayStartMs - 86_400_000).toISOString().slice(0, 10),
      endDate: new Date(todayStartMs + 86_400_000).toISOString().slice(0, 10),
    });
    const chart = heart.sources[heart.selectedSourceIndex].chart!;
    const latestTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
      .format(todayStartMs + 120_000);
    expect(chart.latestValueText).toBe('58 bpm');
    expect(chart.contextText).toBe(`Last recorded ${latestTime} · Interval averages`);
    expect(component.priorityWindow.dayCount).toBe(30);
    expect(component.priorityHrvWindow.label).toBe('14-day trend');
    expect(component.selectedRange()).toBe('1y');
  });

  it('hides today’s HR without eligible samples, including empty, failed, and filtered sources', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    component.toggleProvider(HEALTH_PROVIDERS.COROSAPI);
    fixture.detectChanges();
    expect(host.querySelector('#health-priority-card-heart_rate')).toBeNull();
    component.showAllProviders();
    component.priorityHeartRateLoad.set(rangeLoad(HEALTH_METRIC_IDS.HeartRate, false, false));
    fixture.detectChanges();
    expect(host.querySelector('#health-priority-card-heart_rate')).toBeNull();
    expect(host.querySelector('#health-priority-card-sleep')).not.toBeNull();
    component.priorityHeartRateLoad.set(null);
    component.priorityHeartRateStatus.set('error');
    fixture.detectChanges();
    expect(host.querySelector('#health-priority-card-heart_rate')).toBeNull();
    component.priorityHeartRateStatus.set('ready');
    component.priorityHeartRateLoad.set(rangeLoad(HEALTH_METRIC_IDS.HeartRate, true));
    fixture.detectChanges();
    expect(host.querySelector('#health-priority-card-heart_rate')).toBeNull();
  });

  it('falls back without overwriting a saved source when only another source has today’s readings', async () => {
    await createComponent();
    const summary = fixture.debugElement.query(By.directive(HealthPrioritySummaryComponent)).componentInstance as HealthPrioritySummaryComponent;
    const heart = () => summary.renderedCards().find(card => card.id === 'heart_rate');
    const key = heart()!.sources[1].key;
    hydrateHighlightSources({ heart_rate: key });
    const original = component.priorityHeartRateLoad()!;
    const previousDay = (load: HealthWorkspaceRangeLoad, provider?: HealthProvider) => ({ ...load,
      result: { ...load.result, sampleChunks: load.result.sampleChunks.map(chunk => provider && chunk.provider !== provider
        ? chunk : { ...chunk, startTimeMs: component.priorityHeartRateWindow.startTimeMs - 86_400_000,
          endTimeMs: component.priorityHeartRateWindow.startTimeMs - 1 }) },
    });
    component.priorityHeartRateLoad.set(previousDay(original, HEALTH_PROVIDERS.GarminAPI));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(heart()!.sources).toHaveLength(1);
    expect(heart()!.sources[0].label).toBe('Suunto');
    expect(component.preferredHighlightSources().heart_rate).toBe(key);
    component.priorityHeartRateLoad.set(previousDay(original));
    fixture.detectChanges();
    expect(heart()).toBeUndefined();
    component.priorityHeartRateLoad.set(original);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(heart()!.sources[heart()!.selectedSourceIndex].key).toBe(key);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('switches one highlight chart using Material tabs, keeps both readings, and saves only accepted selections', async () => {
    await createComponent();
    const heart = fixture.nativeElement.querySelector('[aria-labelledby="health-priority-card-heart_rate"]') as HTMLElement;
    const tabs = heart.querySelectorAll<HTMLElement>('[role="tab"]');
    const loadCount = loadMetricRange.mock.calls.length;
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toContain('58 bpm');
    expect(tabs[1].textContent).toContain('52 bpm');
    expect(heart.querySelectorAll('app-health-metric-series-chart')).toHaveLength(1);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();

    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const key = component.visiblePriorityCards().find(card => card.id === 'heart_rate')!.chartSeries[1].sourceSelectionKey!;
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(heart.querySelectorAll('app-health-metric-series-chart')).toHaveLength(1);
    expect(heart.querySelector('app-health-metric-series-chart [role="img"]')?.getAttribute('aria-label')).toContain('Garmin');
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.RestingHeartRate, range: '30d', highlightSources: { heart_rate: key },
    });
    expect(component.selectedProviders()).toEqual([]);
    expect(loadMetricRange.mock.calls.length).toBe(loadCount);
    expect(haptics.selection).toHaveBeenCalledTimes(1);

    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(updateHealthWorkspacePreferences).toHaveBeenCalledTimes(1);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });

  it('restores highlight choices on a fresh visit and keeps Sports Lib formatting under non-default units', async () => {
    await createComponent();
    const key = component.visiblePriorityCards().find(card => card.id === 'heart_rate')!.chartSeries[1].sourceSelectionKey!;
    fixture.destroy();
    TestBed.resetTestingModule();
    await createComponent(undefined, '14d', {}, undefined, { heart_rate: key });
    const summary = fixture.debugElement.query(By.directive(HealthPrioritySummaryComponent)).componentInstance as HealthPrioritySummaryComponent;
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    (TestBed.inject(AppUserSettingsQueryService).unitSettings as ReturnType<typeof signal<UserUnitSettingsInterface>>).set(units);
    fixture.detectChanges();
    await fixture.whenStable();
    const heart = summary.renderedCards().find(card => card.id === 'heart_rate')!;
    expect(heart.sources[heart.selectedSourceIndex].key).toBe(key);
    const formatted = formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.HeartRate, 52, units)!;
    expect(heart.sources[heart.selectedSourceIndex].valueText).toBe(`${formatted.value} ${formatted.unit}`);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('hydrates a saved highlight independently and retains it through filters and late settings', async () => {
    await createComponent();
    const summary = fixture.debugElement.query(By.directive(HealthPrioritySummaryComponent)).componentInstance as HealthPrioritySummaryComponent;
    const heart = () => summary.renderedCards().find(card => card.id === 'heart_rate')!;
    const selectedKey = heart().sources[1].key;
    hydrateHighlightSources({ heart_rate: selectedKey });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(heart().sources[heart().selectedSourceIndex].key).toBe(selectedKey);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();

    component.toggleProvider(HEALTH_PROVIDERS.SuuntoApp);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(heart().sources).toHaveLength(1);
    expect(heart().sources[0].key).not.toBe(selectedKey);
    expect(component.preferredHighlightSources().heart_rate).toBe(selectedKey);
    component.showAllProviders();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(heart().sources[heart().selectedSourceIndex].key).toBe(selectedKey);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();

    const other = heart().sources[0].key;
    component.selectHighlightSource({ cardId: 'heart_rate', sourceKey: other });
    hydrateHighlightSources({ heart_rate: selectedKey, sleep: 'health-series-0123456789abcdef' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.preferredHighlightSources()).toEqual({ heart_rate: other, sleep: 'health-series-0123456789abcdef' });
  });

  it('keeps the selected source when newer data changes source ordering', async () => {
    await createComponent();
    const summary = fixture.debugElement.query(By.directive(HealthPrioritySummaryComponent)).componentInstance as HealthPrioritySummaryComponent;
    const heart = () => summary.renderedCards().find(card => card.id === 'heart_rate')!;
    const key = heart().sources[1].key;
    hydrateHighlightSources({ heart_rate: key });
    fixture.detectChanges();
    await fixture.whenStable();
    component.priorityHeartRateLoad.update(load => {
      if (!load) return load;
      return { ...load, result: { ...load.result, sampleChunks: load.result.sampleChunks.map(item => ({
        ...item,
        endTimeMs: todayStartMs + (item.provider === HEALTH_PROVIDERS.GarminAPI ? 180_000 : 120_000),
        offsetMs: [0, item.provider === HEALTH_PROVIDERS.GarminAPI ? 180_000 : 120_000],
      })) } };
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(heart().selectedSourceIndex).toBe(0);
    expect(heart().sources[heart().selectedSourceIndex].key).toBe(key);
    expect(updateHealthWorkspacePreferences).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('queues source and range changes together and clears pending source choices on an account switch', async () => {
    await createComponent();
    const sources = component.visiblePriorityCards().find(card => card.id === 'heart_rate')!.chartSeries;
    let resolveFirst!: () => void;
    updateHealthWorkspacePreferences.mockReturnValueOnce(new Promise<void>(resolve => resolveFirst = resolve));
    component.selectHighlightSource({ cardId: 'heart_rate', sourceKey: sources[1].sourceSelectionKey! });
    component.selectRange('90d');
    component.selectHighlightSource({ cardId: 'heart_rate', sourceKey: sources[0].sourceSelectionKey! });
    expect(updateHealthWorkspacePreferences).toHaveBeenCalledTimes(1);
    resolveFirst();
    await fixture.whenStable();
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.RestingHeartRate, range: '90d',
      highlightSources: { heart_rate: sources[0].sourceSelectionKey },
    });

    updateHealthWorkspacePreferences.mockReturnValueOnce(new Promise<void>(resolve => resolveFirst = resolve));
    component.selectHighlightSource({ cardId: 'heart_rate', sourceKey: sources[1].sourceSelectionKey! });
    component.selectHighlightSource({ cardId: 'heart_rate', sourceKey: sources[0].sourceSelectionKey! });
    setCurrentUserID('user-2');
    hydrateHighlightSources({});
    fixture.detectChanges();
    resolveFirst();
    await fixture.whenStable();
    expect(component.preferredHighlightSources()).toEqual({});
    expect(updateHealthWorkspacePreferences).toHaveBeenCalledTimes(3);
    expect(updateHealthWorkspacePreferences.mock.calls.every(([uid]) => uid === 'user-1')).toBe(true);
  });

  it('keeps a failed source selection active and retries it without changing other highlights', async () => {
    await createComponent();
    const sourceKey = component.visiblePriorityCards().find(card => card.id === 'heart_rate')!.chartSeries[1].sourceSelectionKey!;
    updateHealthWorkspacePreferences.mockRejectedValueOnce(new Error('offline'));
    component.selectHighlightSource({ cardId: 'heart_rate', sourceKey });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.preferencesSaveFailed()).toBe(true);
    expect(component.preferredHighlightSources()).toEqual({ heart_rate: sourceKey });
    expect(haptics.error).toHaveBeenCalledOnce();
    component.retryPreferenceSave();
    await fixture.whenStable();
    expect(component.preferencesSaveFailed()).toBe(false);
    expect(updateHealthWorkspacePreferences).toHaveBeenLastCalledWith('user-1', {
      metric: HEALTH_METRIC_IDS.RestingHeartRate, range: '30d', highlightSources: { heart_rate: sourceKey },
    });
  });

  it('keeps a single Sleep summary visible when choosing between two accounts', async () => {
    await createComponent(undefined, undefined, { sleepSessions: [sleepSession(), sleepSession({
      id: 'second-sleep', durationSeconds: 7 * 3600,
      source: { provider: SLEEP_PROVIDERS.GarminAPI, providerUserId: 'second-private-account', sourceSessionKey: 'second-session' },
    })] });
    const sleep = fixture.nativeElement.querySelector('[aria-labelledby="health-priority-card-sleep"]') as HTMLElement;
    const tabs = sleep.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(sleep.textContent).toContain('Garmin account 1');
    expect(sleep.textContent).toContain('Garmin account 2');
    expect(sleep.textContent).not.toContain('second-private-account');
    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sleep.querySelectorAll('app-health-sleep-stage-summary')).toHaveLength(1);
    expect(component.preferredHighlightSources().sleep).toMatch(/^health-series-[a-f0-9]{16}$/);
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
    expect(nativeElement.textContent).toContain('each source kept separate');
    expect(nativeElement.querySelector('table caption')?.textContent).toContain('Providers are not blended');
    expect(nativeElement.querySelector('mat-expansion-panel.health-source-table-panel')).toBeTruthy();
    expect(nativeElement.querySelector('details.health-source-table-panel')).toBeNull();
    expect(nativeElement.textContent).toContain('missing');
    expect(nativeElement.textContent).toContain('source-days');

    expect(component.allProvidersSelected()).toBe(true);
    component.openSources();
    sourcesDismissed.next({ providers: [HEALTH_PROVIDERS.GarminAPI] });
    fixture.detectChanges();

    expect(nativeElement.querySelectorAll('.health-chart-panel')).toHaveLength(1);
    expect(nativeElement.querySelector('.health-chart-panel')?.textContent).toContain('Garmin');
    expect(component.sourcesAriaLabel()).toContain('Garmin');
    expect(component.allProvidersSelected()).toBe(false);
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
    expect(host.textContent).toContain('Latest workout profile context: 72.0 kg from Garmin');
    expect(host.textContent).toContain('It is not plotted as a weigh-in');
    expect(host.textContent).not.toContain('opaque-workout-account');
    expect(host.querySelectorAll('.health-chart-panel')).toHaveLength(0);
  });

  it('keeps workout Weight as fallback context while provider filters change', async () => {
    const garminWeight = sourceRecord(
      HEALTH_METRIC_IDS.BodyWeight,
      HEALTH_PROVIDERS.GarminAPI,
      71,
      'garmin-weight',
    );
    const garminOnlyLoad = (): HealthWorkspaceRangeLoad => {
      const result = projectLoadedHealthRange([garminWeight], [], {
        startDate: new Date(todayStartMs - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
        endDate: todayDate,
        metricIds: [HEALTH_METRIC_IDS.BodyWeight],
        includeSamples: false,
      }, { sourceRecordsComplete: true, samplesComplete: true });
      return {
        result,
        limitReached: null,
        sourceRecordCount: 1,
        sampleChunkCount: 0,
        samplePointCount: 0,
        serializedBytes: 500,
        hasMatchingSourceRecords: true,
        hasSampleBackedMetric: false,
        providers: [HEALTH_PROVIDERS.GarminAPI],
        sampleBackedProviders: [],
      };
    };
    await createComponent(metricId => Promise.resolve(
      metricId === HEALTH_METRIC_IDS.BodyWeight ? garminOnlyLoad() : rangeLoad(metricId),
    ));
    loadActivityHealthRange.mockResolvedValue(activityRangeResult({
      provider: HEALTH_PROVIDERS.SuuntoApp,
    }));

    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.metricView().series.map(series => series.provider)).toEqual([
      HEALTH_PROVIDERS.GarminAPI,
    ]);

    component.toggleProvider(HEALTH_PROVIDERS.SuuntoApp);
    fixture.detectChanges();
    expect(component.metricView().series).toEqual([]);
    expect(component.workoutWeightFallback()).toMatchObject({ sourceLabel: 'Suunto' });

    component.showAllProviders();
    fixture.detectChanges();
    expect(component.metricView().series.map(series => series.provider)).toEqual([
      HEALTH_PROVIDERS.GarminAPI,
    ]);
    expect(component.workoutWeightFallback()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.health-chart-panel')).toHaveLength(1);
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

  it.each(['create', 'update', 'delete'])('invalidates an open %s dialog when the account changes', async action => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    const closed = new Subject<unknown>();
    const close = vi.fn();
    vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({
      afterClosed: () => closed.asObservable(), close,
    } as never);
    const measurement: ManualHealthObservationEdit = {
      sourceRecordId: 'manual-record', expectedRevisionOrder: 1,
      metricId: HEALTH_METRIC_IDS.BodyWeight, canonicalValue: 72,
      observedAtMs: todayStartMs, timezoneOffsetSeconds: 0,
    };
    if (action === 'create') component.openManualMeasurement();
    else if (action === 'update') component.editManualMeasurement(measurement);
    else component.deleteManualMeasurement(measurement);

    setCurrentUserID('user-2');
    fixture.detectChanges();
    await fixture.whenStable();
    // Even a late dialog result must not submit under the new account.
    closed.next(action === 'delete' ? true : measurement);
    await fixture.whenStable();
    expect(saveManualMeasurement).not.toHaveBeenCalled();
    expect(deleteManualMeasurement).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('discards a manual dialog result after leaving the workspace', async () => {
    await createComponent();
    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    const closed = new Subject<unknown>();
    const close = vi.fn();
    vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({
      afterClosed: () => closed.asObservable(), close,
    } as never);
    component.openManualMeasurement();
    fixture.destroy();
    closed.next({ canonicalValue: 72, observedAtMs: todayStartMs, timezoneOffsetSeconds: 0 });
    expect(saveManualMeasurement).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it.each([
    HEALTH_METRIC_IDS.BodyFat, HEALTH_METRIC_IDS.MuscleMass, HEALTH_METRIC_IDS.BodyWater, HEALTH_METRIC_IDS.BoneMass, HEALTH_METRIC_IDS.BloodOxygenSaturation,
  ])('opens the general picker from an unsupported metric and reveals a saved %s observation in its date window', async metricId => {
    await createComponent(undefined, '14d', { metricIds: [HEALTH_METRIC_IDS.HeartRate], hasSleep: false });
    const closed = new Subject<unknown>();
    const open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({
      afterClosed: () => closed.asObservable(), close: vi.fn(),
    } as never);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('app-page-header .health-add-measurement');
    expect(button?.textContent).toContain('Add measurement');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-page-header .qs-page-header--compact')).toBeNull();
    button!.click();
    expect(open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ metricId: HEALTH_METRIC_IDS.BodyWeight }) }));
    loadAvailableMetricIds.mockResolvedValue([metricId]);
    closed.next({ metricId, canonicalValue: 20,
      observedAtMs: Date.UTC(2025, 0, 15, 9), timezoneOffsetSeconds: 0 });
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(saveManualMeasurement).toHaveBeenCalledWith(expect.objectContaining({ metricId, canonicalValue: 20 }), 'user-1');
    expect(component.selectedMetric()).toBe(metricId);
    expect(component.selectedRange()).toBe('14d');
    expect(component.selectedEndDate()).toBe('2025-01-15');
    expect(component.selectedProviders()).toEqual([]);
  });

  it('preselects blood pressure from a diastolic view and loads the complete pair before editing', async () => {
    await createComponent();
    component.selectMetric(HEALTH_METRIC_IDS.BloodPressureDiastolic);
    const open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of(undefined), close: vi.fn(),
    } as never);
    component.openManualMeasurement();
    expect(open).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ metricId: HEALTH_METRIC_IDS.BloodPressureSystolic }) }));
    const measurement: ManualHealthObservationEdit = { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic,
      canonicalValue: 80, observedAtMs: todayStartMs, timezoneOffsetSeconds: 0,
      sourceRecordId: 'a'.repeat(64), expectedRevisionOrder: 3 };
    loadManualBloodPressure.mockResolvedValue({ ...measurement, canonicalValue: 120, diastolicValue: 80, pulseValue: 65 });
    await component.editManualMeasurement(measurement);
    expect(loadManualBloodPressure).toHaveBeenCalledWith('user-1', measurement.sourceRecordId, 3);
    expect(open).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ existing: expect.objectContaining({ canonicalValue: 120, diastolicValue: 80, pulseValue: 65 }) }) }));
  });

  it('discards a paired edit load when its owner changes', async () => {
    await createComponent();
    const open = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open');
    let resolveLoad: (value: unknown) => void;
    loadManualBloodPressure.mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
    const measurement: ManualHealthObservationEdit = { metricId: HEALTH_METRIC_IDS.BloodPressureSystolic,
      canonicalValue: 80, observedAtMs: todayStartMs, timezoneOffsetSeconds: 0,
      sourceRecordId: 'a'.repeat(64), expectedRevisionOrder: 3 };
    const pending = component.editManualMeasurement(measurement);
    setCurrentUserID('user-2');
    fixture.detectChanges();
    resolveLoad!({ ...measurement, canonicalValue: 120, diastolicValue: 80 });
    await pending;
    expect(open).not.toHaveBeenCalled();
    expect(saveManualMeasurement).not.toHaveBeenCalled();
    expect(component.manualMutationBusy()).toBe(false);
  });

  it('keeps the measurement action in a block-level centered row, not a baseline-aligned inline row', () => {
    const styles = readFileSync(resolve(
      process.cwd(), 'src/app/components/health/health-workspace.component.scss',
    ), 'utf8');
    const contentRule = styles.match(/\.health-add-measurement-content\s*\{([^}]+)\}/)?.[1];
    expect(contentRule).toMatch(/display:\s*flex\s*;/);
    expect(contentRule).toMatch(/align-items:\s*center\s*;/);
    expect(contentRule).toMatch(/justify-content:\s*center\s*;/);
  });

  it('uses a compact mobile measurement label with a full accessible name and a plain Material action', async () => {
    await createComponent();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.health-add-measurement')!;
    expect(button.hasAttribute('mat-button')).toBe(true);
    expect(button.hasAttribute('mat-flat-button')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Add measurement');
    expect(button.querySelector('.health-add-measurement-label')?.textContent).toBe('Add measurement');
    expect(button.querySelector('.health-add-measurement-label-compact')?.textContent).toBe('Add');
    const styles = readFileSync(resolve(process.cwd(), 'src/app/components/health/health-workspace.component.scss'), 'utf8');
    const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 720px)'));
    expect(mobileStyles).toMatch(/\.health-add-measurement-label\s*\{\s*display: none;/);
    expect(mobileStyles).toMatch(/\.health-add-measurement-label-compact\s*\{\s*display: inline;/);
    expect(mobileStyles).toContain('--mat-button-text-container-height: 44px;');
  });

  it('shows save progress, creates manual Weight with an idempotency key, and refreshes the range', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const addButton = host.querySelector<HTMLButtonElement>('.health-add-measurement')!;
    const contentRow = addButton.querySelector('.health-add-measurement-content')!;
    expect(contentRow.querySelector('mat-icon')?.parentElement).toBe(contentRow);
    const callsBeforeMutation = loadMetricRange.mock.calls.length;
    let finishSave!: (value: { sourceRecordId: string; revisionOrder: number }) => void;
    saveManualMeasurement.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));

    const pendingSave = (component as unknown as {
      createManualMeasurement: (
        metricId: typeof HEALTH_METRIC_IDS.BodyWeight,
        value: { canonicalValue: number; observedAtMs: number; timezoneOffsetSeconds: number },
      ) => Promise<void>;
    }).createManualMeasurement(HEALTH_METRIC_IDS.BodyWeight, {
      canonicalValue: 72.4,
      observedAtMs: todayStartMs + 10_000,
      timezoneOffsetSeconds: 7_200,
    });
    fixture.detectChanges();
    expect(addButton.disabled).toBe(true);
    expect(addButton.querySelector('.health-add-measurement-content')).toBe(contentRow);
    expect(addButton.querySelector('mat-spinner')?.parentElement).toBe(contentRow);
    expect(addButton.querySelector('mat-spinner')?.getAttribute('diameter')).toBe('18');
    expect(addButton.textContent).toContain('Add measurement');
    expect(host.querySelector('[role="status"].cdk-visually-hidden')?.textContent).toContain('Updating measurements');
    expect(haptics.success).not.toHaveBeenCalled();
    haptics.selection.mockClear();

    finishSave({ sourceRecordId: 'opaque', revisionOrder: 1 });
    await pendingSave;
    expect(haptics.success).toHaveBeenCalledOnce();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(saveManualMeasurement).toHaveBeenCalledWith({
      mode: 'create',
      clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      metricId: HEALTH_METRIC_IDS.BodyWeight,
      canonicalValue: 72.4,
      observedAtMs: todayStartMs + 10_000,
      timezoneOffsetSeconds: 7_200,
    }, 'user-1');
    expect(loadMetricRange.mock.calls.length).toBeGreaterThan(callsBeforeMutation);
    expect(component.manualMutationBusy()).toBe(false);
    expect(addButton.disabled).toBe(false);
    expect(addButton.querySelector('mat-spinner')).toBeNull();
    expect(addButton.querySelector('.health-add-measurement-content')).toBe(contentRow);
    expect(contentRow.querySelector('mat-icon')?.parentElement).toBe(contentRow);
    expect(host.querySelector('[role="status"].cdk-visually-hidden')?.textContent?.trim()).toBe('');
  });

  it('reveals a saved measurement after midnight without changing the remembered range', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 8, 6, 23, 59));
      await createComponent(undefined, '14d');
      expect(component.selectedWindow().endDate).toBe('2026-09-06');
      vi.setSystemTime(new Date(2026, 8, 7, 0, 1));
      const observed = new Date();
      const closed = new Subject<unknown>();
      vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({
        afterClosed: () => closed.asObservable(), close: vi.fn(),
      } as never);
      component.openManualMeasurement();
      closed.next({
        metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 20,
        observedAtMs: observed.getTime(), timezoneOffsetSeconds: -observed.getTimezoneOffset() * 60,
      });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(saveManualMeasurement).toHaveBeenCalledOnce();
      expect(component.selectedWindow()).toMatchObject({ endDate: '2026-09-07', range: '14d' });
      expect(component.selectedMetric()).toBe(HEALTH_METRIC_IDS.BodyFat);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveals an edited measurement whose original timezone is already on the next calendar day', async () => {
    vi.stubEnv('TZ', 'UTC');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.UTC(2026, 8, 6, 20));
      await createComponent(undefined, '14d');
      const measurement: ManualHealthObservationEdit = {
        sourceRecordId: 'manual-record', expectedRevisionOrder: 1,
        metricId: HEALTH_METRIC_IDS.BodyFat, canonicalValue: 20,
        observedAtMs: Date.now(), timezoneOffsetSeconds: 9 * 3600,
      };
      const closed = new Subject<unknown>();
      vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open').mockReturnValue({
        afterClosed: () => closed.asObservable(), close: vi.fn(),
      } as never);
      await component.editManualMeasurement(measurement);
      closed.next({
        metricId: measurement.metricId, canonicalValue: 21,
        observedAtMs: measurement.observedAtMs, timezoneOffsetSeconds: measurement.timezoneOffsetSeconds,
      });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(saveManualMeasurement).toHaveBeenCalledOnce();
      expect(component.selectedWindow()).toMatchObject({ endDate: '2026-09-07', range: '14d' });
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it.each(['success', 'failure'])('ignores a stale create %s without clearing the new account mutation', async outcome => {
    await createComponent();
    const value = { canonicalValue: 72, observedAtMs: todayStartMs, timezoneOffsetSeconds: 0 };
    const mutations = component as unknown as {
      createManualMeasurement(metricId: typeof HEALTH_METRIC_IDS.BodyWeight, measurement: typeof value): Promise<void>;
    };
    let finishOld!: () => void;
    let finishNew!: () => void;
    saveManualMeasurement.mockReturnValueOnce(new Promise((resolve, reject) => {
      finishOld = () => outcome === 'success' ? resolve({ sourceRecordId: 'old', revisionOrder: 1 })
        : reject(new Error('delayed failure'));
    })).mockReturnValueOnce(new Promise(resolve => {
      finishNew = () => resolve({ sourceRecordId: 'new', revisionOrder: 1 });
    }));
    const notice = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const oldRequest = mutations.createManualMeasurement(HEALTH_METRIC_IDS.BodyWeight, value);
    setCurrentUserID('user-2');
    fixture.detectChanges();
    await fixture.whenStable();
    const newRequest = mutations.createManualMeasurement(HEALTH_METRIC_IDS.BodyWeight, value);
    finishOld();
    await oldRequest;
    expect(component.manualMutationBusy()).toBe(true);
    expect(notice).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    expect(haptics.error).not.toHaveBeenCalled();
    finishNew();
    await newRequest;
    expect(component.manualMutationBusy()).toBe(false);
    expect(saveManualMeasurement.mock.calls.map(([, uid]) => uid)).toEqual(['user-1', 'user-2']);
  });

  it('reuses the same idempotency key when the user retries an ambiguous create failure', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    const retryAction = new Subject<void>();
    const snackBar = TestBed.inject(MatSnackBar);
    vi.spyOn(snackBar, 'open').mockReturnValue({
      onAction: () => retryAction.asObservable(),
    } as never);
    saveManualMeasurement
      .mockRejectedValueOnce(new Error('ambiguous response'))
      .mockResolvedValueOnce({ sourceRecordId: 'opaque', revisionOrder: 1 });
    const mutationId = '123e4567-e89b-42d3-a456-426614174000';
    const value = {
      canonicalValue: 72.4,
      observedAtMs: todayStartMs + 10_000,
      timezoneOffsetSeconds: 7_200,
    };

    await (component as unknown as {
      createManualMeasurement: (
        metricId: typeof HEALTH_METRIC_IDS.BodyWeight,
        measurement: typeof value,
        clientMutationId: string,
      ) => Promise<void>;
    }).createManualMeasurement(HEALTH_METRIC_IDS.BodyWeight, value, mutationId);
    expect(haptics.error).toHaveBeenCalledOnce();
    expect(haptics.success).not.toHaveBeenCalled();
    retryAction.next();

    await vi.waitFor(() => expect(saveManualMeasurement).toHaveBeenCalledTimes(2));
    expect(saveManualMeasurement.mock.calls.map(([request]) => request.clientMutationId))
      .toEqual([mutationId, mutationId]);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(haptics.success).toHaveBeenCalledOnce();
  });

  it('does not submit a manual measurement when the browser cannot create a secure UUID', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    vi.spyOn(TestBed.inject(BrowserCompatibilityService), 'createRandomUUID').mockReturnValue(null);
    const snackBar = TestBed.inject(MatSnackBar);
    const notice = vi.spyOn(snackBar, 'open');

    await (component as unknown as {
      createManualMeasurement: (
        metricId: typeof HEALTH_METRIC_IDS.BodyWeight,
        measurement: {
          canonicalValue: number;
          observedAtMs: number;
          timezoneOffsetSeconds: number;
        },
      ) => Promise<void>;
    }).createManualMeasurement(HEALTH_METRIC_IDS.BodyWeight, {
      canonicalValue: 72.4,
      observedAtMs: todayStartMs + 10_000,
      timezoneOffsetSeconds: 7_200,
    });

    expect(saveManualMeasurement).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      'This browser cannot create a secure measurement ID.',
      'Dismiss',
      { duration: 5000 },
    );
    expect(component.manualMutationBusy()).toBe(false);
  });

  it('offers manual creation and exposes edit/delete actions only for manual observations', async () => {
    const manualRecord = manualSourceRecord(HEALTH_METRIC_IDS.BodyWeight, 72.4, 'manual');
    await createComponent(metricId => {
      const records = metricId === HEALTH_METRIC_IDS.BodyWeight ? [manualRecord] : [];
      const result = projectLoadedHealthRange(records, [], {
        startDate: new Date(todayStartMs - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
        endDate: todayDate,
        metricIds: [metricId],
        includeSamples: false,
      }, { sourceRecordsComplete: true, samplesComplete: true });
      return Promise.resolve({
        result,
        limitReached: null,
        sourceRecordCount: records.length,
        sampleChunkCount: 0,
        samplePointCount: 0,
        serializedBytes: 500,
        hasMatchingSourceRecords: records.length > 0,
        hasSampleBackedMetric: false,
        providers: records.map(record => record.source.provider),
        sampleBackedProviders: [],
      });
    });

    component.selectMetric(HEALTH_METRIC_IDS.BodyWeight);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-add-measurement')?.textContent).toContain('Add measurement');
    expect(host.querySelector('[aria-label="Edit manual measurement"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Delete manual measurement"]')).toBeTruthy();
    expect(component.metricRows()[0]?.manualMeasurement).toMatchObject({
      expectedRevisionOrder: 4,
      metricId: HEALTH_METRIC_IDS.BodyWeight,
      canonicalValue: 72.4,
      timezoneOffsetSeconds: 7_200,
    });
  });

  it('updates and deletes only the selected manual record revision', async () => {
    await createComponent(metricId => Promise.resolve(rangeLoad(metricId, true)));
    component.selectMetric(HEALTH_METRIC_IDS.Vo2Max);
    await fixture.whenStable();
    const measurement: ManualHealthObservationEdit = {
      sourceRecordId: 'manual-record',
      expectedRevisionOrder: 42,
      metricId: HEALTH_METRIC_IDS.Vo2Max,
      canonicalValue: 51,
      observedAtMs: todayStartMs,
      timezoneOffsetSeconds: 7_200,
      vo2Context: 'running',
      vo2Method: 'lab_test',
    };

    await (component as unknown as {
      updateManualMeasurement: (
        current: ManualHealthObservationEdit,
        value: {
          canonicalValue: number;
          observedAtMs: number;
          timezoneOffsetSeconds: number;
          vo2Context: 'cycling';
          vo2Method: 'field_test';
        },
      ) => Promise<void>;
    }).updateManualMeasurement(measurement, {
      canonicalValue: 53,
      observedAtMs: todayStartMs + 20_000,
      timezoneOffsetSeconds: 7_200,
      vo2Context: 'cycling',
      vo2Method: 'field_test',
    });
    await (component as unknown as {
      removeManualMeasurement: (current: ManualHealthObservationEdit) => Promise<void>;
    }).removeManualMeasurement(measurement);

    expect(saveManualMeasurement).toHaveBeenCalledWith({
      mode: 'update',
      sourceRecordId: 'manual-record',
      expectedRevisionOrder: 42,
      metricId: HEALTH_METRIC_IDS.Vo2Max,
      canonicalValue: 53,
      observedAtMs: todayStartMs + 20_000,
      timezoneOffsetSeconds: 7_200,
      vo2Context: 'cycling',
      vo2Method: 'field_test',
    }, 'user-1');
    expect(deleteManualMeasurement).toHaveBeenCalledWith({
      sourceRecordId: 'manual-record',
      expectedRevisionOrder: 42,
    }, 'user-1');
    expect(haptics.success).toHaveBeenCalledTimes(2);
    expect(component.manualMutationBusy()).toBe(false);
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
    expect(host.querySelector('.health-sources-dot[data-tone="error"]')).toBeTruthy();
    component.openSources();
    expect(openBottomSheet.mock.calls[0][1].data.syncStatus).toBe('denied');
  });

  it('maps ready source recency to current, delayed, stale, and waiting source-sheet states', async () => {
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
    component.openSources();
    const options = openBottomSheet.mock.calls[0][1].data.providers;
    expect(options).toHaveLength(4);
    expect(options.find(option => option.provider === HEALTH_PROVIDERS.GarminAPI).sync.tone).toBe('current');
    expect(options.find(option => option.provider === HEALTH_PROVIDERS.SuuntoApp).sync.tone).toBe('delayed');
    expect(component.sourceAttention()).toBe('error');
  });

  it('removes the provider footer and its old import surface', async () => {
    await createComponent();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-sync-footer')).toBeNull();
    expect(host.querySelector('.health-mobile-view-options')).toBeNull();
    expect(host.textContent).not.toContain('Import history');
    expect('startHistoryImport' in component).toBe(false);
    expect(host.querySelector('.health-sources-button')).not.toBeNull();
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
    expect(text).toContain('Choose 1d, 14d, or 30d to view the detailed readings');
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

  it('explains a missing sample-only source even when another provider has visible summaries', async () => {
    await createComponent();
    loadMetricRange.mockImplementation((_uid: string, request: { metricId: HealthMetricId }) => Promise.resolve({
      ...rangeLoad(request.metricId, false, false),
      providers: [HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.COROSAPI, HEALTH_PROVIDERS.SuuntoApp],
      sampleBackedProviders: [HEALTH_PROVIDERS.SuuntoApp],
    }));
    component.selectMetric(HEALTH_METRIC_IDS.HeartRate);
    component.selectRange('1y');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.hasData()).toBe(true);
    expect(component.omittedSampleSourceNotice()).toContain('Suunto: detailed readings exist');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no daily summary is available');
    component.toggleProvider(HEALTH_PROVIDERS.GarminAPI);
    fixture.detectChanges();
    expect(component.omittedSampleSourceNotice()).toBeNull();
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
    expect(haptics.error).toHaveBeenCalledTimes(2);
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
