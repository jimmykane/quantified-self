import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AppThemes, ServiceNames } from '@sports-alliance/sports-lib';
import {
  ACTIVITY_HEALTH_METRIC_IDS,
  ACTIVITY_HEALTH_INCOMPLETE_REASONS,
  isActivityHealthMetricId,
  type ActivityHealthObservation,
  type ActivityHealthRangeResult,
} from '@shared/activity-health';
import {
  HEALTH_METRIC_IDS,
  HEALTH_PROVIDERS,
  HEALTH_SYNC_STATUSES,
  HealthMetricId,
  HealthProvider,
  HealthSyncState,
  getHealthMetricDefinition,
} from '@shared/health';
import { ProviderPresentation, buildProviderPresentation } from '@shared/provider-presentation';
import {
  SLEEP_PROVIDERS,
  SLEEP_SYNC_STATUSES,
  SleepProvider,
  SleepSession,
  SleepSyncState,
} from '@shared/sleep';
import { SleepBackfillQueueResponse } from '@shared/sleep-backfill';
import { combineLatest, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AppUserService } from '../../services/app.user.service';
import {
  AppHealthService,
  HealthWorkspaceRangeLoad,
} from '../../services/app.health.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AppChartsModule } from '../../modules/app-charts.module';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { ServiceSourceIconComponent } from '../event-summary/service-source-icon/service-source-icon.component';
import { HealthMetricChartComponent } from './health-metric-chart.component';
import { HealthActivityQueryService } from './health-activity-query.service';
import {
  HealthPriorityCardView,
  HealthPrioritySummaryComponent,
} from './health-priority-summary.component';
import { HealthSourceObservationTableComponent } from './health-source-observation-table.component';
import {
  HEALTH_WORKSPACE_DEFAULT_RANGE,
  HEALTH_WORKSPACE_RANGES,
  HealthMetricCatalogGroup,
  HealthMetricWorkspaceView,
  HealthObservationTableRow,
  HealthPriorityRow,
  HealthSleepObservationRow,
  HealthWorkspaceMetricSelection,
  HealthWorkspaceRange,
  HealthWorkspaceRouteState,
  buildHealthMetricCatalogGroups,
  buildHealthMetricWorkspaceView,
  buildHealthPriorityRows,
  buildSleepObservationRows,
  buildSleepPriorityRows,
  filterHealthRangeResultByProviders,
  localCalendarDate,
  navigateHealthWorkspaceWindow,
  normalizeHealthWorkspaceMetric,
  normalizeHealthWorkspaceRange,
  providerLabel,
  resolveHealthWorkspaceWindow,
  selectActivityHealthObservations,
} from '../../helpers/health-workspace.helper';
import {
  buildDashboardSleepTrendContext,
  resolveSleepTrendDate,
} from '../../helpers/dashboard-sleep-chart.helper';
import { healthMetricIcon } from '../../helpers/health-metric-icon.helper';
import type { AppDashboardSleepTrendRange } from '../../models/app-user.interface';

type HealthLoadStatus = 'loading' | 'ready' | 'denied' | 'error';

interface HealthProviderView {
  provider: HealthProvider;
  label: string;
  presentation: ProviderPresentation | null;
}

interface HealthProviderFilterView extends HealthProviderView {
  selected: boolean;
}

interface HealthSyncStateView extends HealthProviderView {
  statusLabel: string;
  lastUpdateText: string;
  lastUpdateDateTime: string | null;
  tone: HealthSyncTone;
  historyImportActionLabel: string | null;
  historyImportStatusText: string | null;
  historyImportBusy: boolean;
  historyImportError: string | null;
}

type HealthSyncTone = 'current' | 'delayed' | 'stale' | 'error' | 'neutral';

interface QueuedHealthWorkspacePreferenceWrite {
  uid: string;
  metric: HealthWorkspaceMetricSelection;
  range: HealthWorkspaceRange;
  generation: number;
}

const RANGE_LABELS: Record<HealthWorkspaceRange, string> = {
  today: '1 day',
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
};

const HEALTH_SYNC_REFRESH_FIELDS = [
  'updatedAtMs',
  'lastSyncedAtMs',
  'lastObservedAtMs',
  'lastPollAtMs',
  'lastWebhookAtMs',
] as const;

const HEALTH_SYNC_CURRENT_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const HEALTH_SYNC_DELAYED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-health-workspace',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    AppChartsModule,
    PageHeaderComponent,
    ServiceSourceIconComponent,
    HealthMetricChartComponent,
    HealthPrioritySummaryComponent,
    HealthSourceObservationTableComponent,
  ],
  templateUrl: './health-workspace.component.html',
  styleUrls: ['./health-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthWorkspaceComponent {
  private readonly userService = inject(AppUserService);
  private readonly userSettingsService = inject(AppUserSettingsQueryService);
  private readonly healthService = inject(AppHealthService);
  private readonly activityHealthService = inject(HealthActivityQueryService);
  private readonly sleepService = inject(AppSleepService);
  private readonly themeService = inject(AppThemeService);
  private readonly signedInUserID = computed(() => this.userService.user()?.uid || null);
  readonly unitSettings = this.userSettingsService.unitSettings;
  private readonly todayDate = localCalendarDate();
  private selectedLoadGeneration = 0;
  private priorityLoadGeneration = 0;
  private metricAvailabilityGeneration = 0;
  private latestSyncStates = new Map<HealthProvider, HealthSyncState>();
  private hasSeenSyncStateSnapshot = false;
  private workspacePreferenceUserID: string | null = null;
  private metricPreferenceTouched = false;
  private rangePreferenceTouched = false;
  private preferenceWriteGeneration = 0;
  private preferenceWriteInFlight = false;
  private queuedPreferenceWrite: QueuedHealthWorkspacePreferenceWrite | null = null;
  private historyImportRequestGeneration = 0;

  readonly ranges = HEALTH_WORKSPACE_RANGES.map(range => ({
    range,
    label: RANGE_LABELS[range],
    buttonLabel: range === 'today' ? '1d' : range,
  }));
  readonly healthMetricIcon = healthMetricIcon;
  private readonly completeMetricCatalogGroups: readonly HealthMetricCatalogGroup[] = buildHealthMetricCatalogGroups();
  readonly selectedMetric = signal<HealthWorkspaceMetricSelection>(HEALTH_METRIC_IDS.RestingHeartRate);
  readonly selectedRange = signal<HealthWorkspaceRange>(HEALTH_WORKSPACE_DEFAULT_RANGE);
  readonly selectedEndDate = signal(this.todayDate);
  readonly routeState = computed<HealthWorkspaceRouteState>(() => ({
    metric: this.selectedMetric(),
    range: this.selectedRange(),
    endDate: this.selectedEndDate(),
  }));
  readonly isSavingPreferences = signal(false);
  readonly preferencesSaveFailed = signal(false);
  readonly selectedWindow = computed(() => resolveHealthWorkspaceWindow(this.routeState(), this.todayDate));
  readonly selectedHealthLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly selectedHealthStatus = signal<HealthLoadStatus>('loading');
  readonly selectedActivityHealthResult = signal<ActivityHealthRangeResult | null>(null);
  readonly selectedActivityHealthStatus = signal<HealthLoadStatus>('ready');
  readonly selectedSleepSessions = signal<SleepSession[]>([]);
  readonly selectedSleepStatus = signal<HealthLoadStatus>('loading');
  readonly prioritySleepSessions = signal<SleepSession[]>([]);
  readonly prioritySleepStatus = signal<HealthLoadStatus>('loading');
  readonly priorityHeartRateLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly priorityHeartRateStatus = signal<HealthLoadStatus>('loading');
  readonly priorityHrvLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly priorityHrvStatus = signal<HealthLoadStatus>('loading');
  readonly syncStates = signal<HealthSyncState[]>([]);
  readonly syncStatesStatus = signal<HealthLoadStatus>('loading');
  readonly sleepSyncStates = signal<Partial<Record<SleepProvider, SleepSyncState | null>>>({});
  readonly sleepSyncStateResolved = signal<Partial<Record<SleepProvider, boolean>>>({});
  readonly historyImportProvider = signal<HealthProvider | null>(null);
  readonly historyImportErrors = signal<Partial<Record<HealthProvider, string>>>({});
  readonly selectedProviders = signal<HealthProvider[]>([]);
  readonly refreshRevision = signal(0);
  readonly availableHealthMetricIds = signal<readonly HealthMetricId[] | null>(null);
  readonly healthMetricAvailabilityStatus = signal<HealthLoadStatus>('loading');
  readonly hasAnySleepSession = signal<boolean | null>(null);
  readonly sleepMetricAvailabilityStatus = signal<HealthLoadStatus>('loading');
  readonly isDarkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);

  readonly healthMetricFilteringActive = computed(() => this.healthMetricAvailabilityStatus() === 'ready');
  readonly sleepMetricFilteringActive = computed(() => this.sleepMetricAvailabilityStatus() === 'ready');
  readonly availabilityChecksSettled = computed(() =>
    this.healthMetricAvailabilityStatus() !== 'loading'
    && this.sleepMetricAvailabilityStatus() !== 'loading');
  readonly metricCatalogGroups = computed<readonly HealthMetricCatalogGroup[]>(() => {
    if (!this.healthMetricFilteringActive()) {
      return this.completeMetricCatalogGroups;
    }
    return buildHealthMetricCatalogGroups(this.availableHealthMetricIds() || []);
  });
  readonly showSleepMetric = computed(() =>
    !this.sleepMetricFilteringActive() || this.hasAnySleepSession() === true);
  readonly availableMetricSelections = computed<readonly HealthWorkspaceMetricSelection[]>(() => [
    ...(this.showSleepMetric() ? ['sleep' as const] : []),
    ...this.metricCatalogGroups().flatMap(group => group.metrics.map(metric => metric.id)),
  ]);
  readonly hasAvailableMetricSelections = computed(() => this.availableMetricSelections().length > 0);
  readonly metricAvailabilityNotice = computed(() => {
    const healthStatus = this.healthMetricAvailabilityStatus();
    const sleepStatus = this.sleepMetricAvailabilityStatus();
    if (healthStatus !== 'error' && healthStatus !== 'denied'
      && sleepStatus !== 'error' && sleepStatus !== 'denied') {
      return null;
    }
    return 'Some metric availability could not be verified. Unverified entries remain visible so valid data is not hidden.';
  });

  readonly selectedMetricDefinition = computed(() => {
    const metric = this.routeState().metric;
    return metric === 'sleep' ? null : getHealthMetricDefinition(metric);
  });
  readonly detailTitle = computed(() => this.routeState().metric === 'sleep'
    ? 'Sleep'
    : this.selectedMetricDefinition()?.label || 'Resting heart rate');
  readonly detailSubtitle = computed(() => this.routeState().range === 'today'
    ? this.selectedWindow().label
    : `${this.selectedWindow().label} · ${RANGE_LABELS[this.routeState().range]}`);
  readonly selectedIsSleep = computed(() => this.routeState().metric === 'sleep');
  readonly effectiveProviderFilters = computed(() => {
    const available = new Set(this.availableProviders());
    const selected = this.selectedProviders().filter(provider => available.has(provider));
    return selected.length ? selected : [];
  });
  readonly windowedSleepSessions = computed(() => {
    const window = this.selectedWindow();
    return this.selectedSleepSessions().filter(session => {
      const sleepDate = resolveSleepTrendDate(session);
      return sleepDate !== null && sleepDate >= window.startDate && sleepDate <= window.endDate;
    });
  });
  readonly filteredSleepSessions = computed(() => {
    const selected = this.effectiveProviderFilters();
    return selected.length
      ? this.windowedSleepSessions().filter(session => selected.includes(session.source.provider as HealthProvider))
      : this.windowedSleepSessions();
  });
  readonly filteredHealthResult = computed(() => {
    const result = this.selectedHealthLoad()?.result;
    return result ? filterHealthRangeResultByProviders(result, this.effectiveProviderFilters()) : null;
  });
  readonly filteredActivityHealthObservations = computed<ActivityHealthObservation[]>(() => {
    const metric = this.routeState().metric;
    const healthResult = this.filteredHealthResult();
    const activityResult = this.selectedActivityHealthResult();
    if (!isActivityHealthMetricId(metric) || !healthResult || !activityResult) {
      return [];
    }
    return selectActivityHealthObservations(
      metric,
      healthResult,
      activityResult.observations,
      this.effectiveProviderFilters(),
    );
  });
  readonly metricView = computed<HealthMetricWorkspaceView>(() => {
    const result = this.filteredHealthResult();
    return result
      ? buildHealthMetricWorkspaceView(
        result,
        this.filteredSleepSessions(),
        this.filteredActivityHealthObservations(),
        this.unitSettings(),
      )
      : emptyMetricView();
  });
  readonly sleepTrend = computed(() => buildDashboardSleepTrendContext(this.filteredSleepSessions(), {
    sleepWindow: {
      range: healthRangeToSleepRange(this.routeState().range),
      startMs: this.selectedWindow().startTimeMs,
      endMs: this.selectedWindow().endTimeMs,
    },
  }));
  readonly sleepChartRange = computed<AppDashboardSleepTrendRange>(() =>
    healthRangeToSleepRange(this.routeState().range) || '14d');
  readonly sleepRows = computed<HealthSleepObservationRow[]>(() =>
    buildSleepObservationRows(this.filteredSleepSessions(), this.unitSettings()));
  readonly availableProviders = computed<HealthProvider[]>(() => {
    const loadedResult = this.selectedHealthLoad()?.result;
    const providers = this.selectedIsSleep()
      ? this.windowedSleepSessions().map(session => session.source.provider as HealthProvider)
      : [
        ...(this.selectedHealthLoad()?.providers || []),
        ...(loadedResult?.observations.map(item => item.provider) || []),
        ...(loadedResult?.sampleChunks.map(item => item.provider) || []),
        ...(this.selectedActivityHealthResult()?.observations.map(item => item.provider) || []),
      ];
    return [...new Set(providers)].sort((left, right) => providerLabel(left).localeCompare(providerLabel(right)));
  });
  readonly providerFilterOptions = computed<HealthProviderFilterView[]>(() => {
    const selected = this.effectiveProviderFilters();
    return this.availableProviders().map(provider => ({
      ...providerView(provider),
      selected: selected.length === 0 || selected.includes(provider),
    }));
  });
  readonly allProvidersSelected = computed(() => this.effectiveProviderFilters().length === 0);
  readonly selectedStatus = computed(() => {
    if (this.selectedIsSleep()) {
      return this.selectedSleepStatus();
    }
    const healthStatus = this.selectedHealthStatus();
    const metric = this.routeState().metric;
    if (!isActivityHealthMetricId(metric)) {
      return healthStatus;
    }
    const activityStatus = this.selectedActivityHealthStatus();
    if (healthStatus === 'loading' || activityStatus === 'loading') {
      return 'loading';
    }
    if (healthStatus === 'denied' || healthStatus === 'error') {
      return healthStatus;
    }
    if ((activityStatus === 'denied' || activityStatus === 'error')
      && !hasHealthResultValues(this.filteredHealthResult())) {
      return activityStatus;
    }
    return healthStatus;
  });
  readonly isLoading = computed(() => this.selectedStatus() === 'loading');
  readonly isDenied = computed(() => this.selectedStatus() === 'denied');
  readonly hasLoadError = computed(() => this.selectedStatus() === 'error');
  readonly hasData = computed(() => this.selectedIsSleep()
    ? this.filteredSleepSessions().length > 0
    : this.metricView().series.length > 0);
  readonly isEmpty = computed(() => this.selectedStatus() === 'ready' && !this.hasData());
  readonly sampleOnlyLongRange = computed(() => !this.selectedIsSleep()
    && !this.selectedWindow().includeSamples
    && this.selectedHealthLoad()?.sampleBackedProviders.some(provider => {
      const selectedProviders = this.effectiveProviderFilters();
      return selectedProviders.length === 0 || selectedProviders.includes(provider);
    }) === true
    && this.metricView().series.length === 0);
  readonly incompleteNotice = computed(() => {
    const loaded = this.selectedHealthLoad();
    const reasons: string[] = [];
    if (loaded?.limitReached) {
      reasons.push({
        source_records: '2,048 source records',
        sample_chunks: '256 sample chunks',
        sample_points: '100,000 sample points',
        serialized_bytes: '16 MiB of serialized data',
      }[loaded.limitReached]);
    }
    const activityResult = this.selectedActivityHealthResult();
    if (activityEvidenceCanAffectView(this.routeState().metric, this.filteredHealthResult())
      && activityResult?.complete === false
      && activityResult.incompleteReason) {
      reasons.push(activityResult.incompleteReason === ACTIVITY_HEALTH_INCOMPLETE_REASONS.CandidateLimit
        ? '2,048 workout candidates'
        : '1 MiB projected workout result');
    }
    if (!reasons.length) {
      return null;
    }
    return `Incomplete result: this load stopped at the ${reasons.join(' and ')} safety ${reasons.length === 1 ? 'limit' : 'limits'}. Choose a shorter or older window to inspect the remaining data.`;
  });
  readonly activitySourceNotice = computed(() => {
    const metric = this.routeState().metric;
    const status = this.selectedActivityHealthStatus();
    if (!isActivityHealthMetricId(metric)
      || !activityEvidenceCanAffectView(metric, this.filteredHealthResult())
      || (status !== 'error' && status !== 'denied')
      || this.selectedStatus() !== 'ready') {
      return null;
    }
    return 'Workout-backed observations could not be loaded. Provider Health measurements are shown, but this view may be incomplete.';
  });
  readonly workoutMetricNotice = computed(() => {
    const metric = this.routeState().metric;
    if (!this.filteredActivityHealthObservations().length) {
      return null;
    }
    if (metric === HEALTH_METRIC_IDS.BodyWeight) {
      return 'Workout Weight is profile context embedded in an imported workout, not a weigh-in. It is shown only because no Health Weight measurement exists in this filtered window.';
    }
    if (metric === HEALTH_METRIC_IDS.Vo2Max) {
      return 'Workout VO₂ max is separate evidence grouped by source and discipline. It is never combined with provider Health or manual VO₂ max.';
    }
    return null;
  });
  readonly revisionNotice = computed(() => {
    const count = this.selectedHealthLoad()?.result.pageInfo.sampleRevisionMismatchCount || 0;
    return count > 0
      ? `${count.toLocaleString()} superseded sample ${count === 1 ? 'chunk was' : 'chunks were'} excluded. The loaded sample aggregate is incomplete.`
      : null;
  });
  readonly partialCoverageNotice = computed(() => {
    const coverage = this.filteredHealthResult()?.coverage || [];
    const missingDays = coverage.reduce((total, item) => total + item.missingDays, 0);
    const partialDays = coverage.reduce((total, item) => total + item.partialDays, 0);
    const unknownDays = coverage.reduce((total, item) => total + item.unknownDays, 0);
    if (missingDays === 0 && partialDays === 0 && unknownDays === 0) {
      return null;
    }
    return `Coverage is incomplete for this view: ${missingDays.toLocaleString()} missing, ${partialDays.toLocaleString()} partial, and ${unknownDays.toLocaleString()} unknown source-days.`;
  });
  readonly metricRows = computed<HealthObservationTableRow[]>(() => this.metricView().rows);
  readonly tableTruncationText = computed(() => {
    const view = this.metricView();
    return view.totalRowCount > view.rows.length
      ? `Showing the newest ${view.rows.length.toLocaleString()} of ${view.totalRowCount.toLocaleString()} source observations.`
      : null;
  });
  readonly priorityCards = computed<HealthPriorityCardView[]>(() => {
    const healthAvailabilityIsKnown = this.healthMetricFilteringActive();
    const sleepAvailabilityIsKnown = this.sleepMetricFilteringActive();
    const available = new Set(this.availableMetricSelections());
    return [
      priorityCard(
        'sleep',
        'Sleep',
        healthMetricIcon('sleep'),
        'sleep',
        buildSleepPriorityRows(this.prioritySleepSessions(), this.unitSettings()),
        this.prioritySleepStatus(),
        'No Sleep sessions in the last 30 days.',
        !sleepAvailabilityIsKnown || available.has('sleep'),
      ),
      priorityCard(
        'heart_rate',
        'Heart rate',
        healthMetricIcon(HEALTH_METRIC_IDS.HeartRate),
        HEALTH_METRIC_IDS.HeartRate,
        buildHealthPriorityRows(
          this.priorityHeartRateLoad()?.result,
          this.prioritySleepSessions(),
          this.unitSettings(),
        ),
        this.priorityHeartRateStatus(),
        'No Heart rate summaries in the last 30 days.',
        !healthAvailabilityIsKnown || available.has(HEALTH_METRIC_IDS.HeartRate),
      ),
      priorityCard(
        'heart_rate_variability',
        'HRV',
        healthMetricIcon(HEALTH_METRIC_IDS.HeartRateVariability),
        HEALTH_METRIC_IDS.HeartRateVariability,
        buildHealthPriorityRows(
          this.priorityHrvLoad()?.result,
          this.prioritySleepSessions(),
          this.unitSettings(),
        ),
        this.priorityHrvStatus(),
        'No HRV summaries in the last 30 days.',
        !healthAvailabilityIsKnown || available.has(HEALTH_METRIC_IDS.HeartRateVariability),
      ),
    ];
  });
  readonly syncStateViews = computed<HealthSyncStateView[]>(() => this.syncStates()
    .map(state => {
      const sleepProvider = healthProviderSleepProvider(state.provider);
      return syncStateView(state, {
        sleepSyncState: sleepProvider ? this.sleepSyncStates()[sleepProvider] || null : null,
        sleepSyncStateResolved: sleepProvider ? this.sleepSyncStateResolved()[sleepProvider] === true : false,
        hasProAccess: this.userService.hasProAccessSignal(),
        busy: this.historyImportProvider() === state.provider,
        error: this.historyImportErrors()[state.provider] || null,
      });
    })
    .sort((left, right) => left.label.localeCompare(right.label)));

  constructor() {
    effect(() => {
      const user = this.userService.user();
      const uid = `${user?.uid || ''}`.trim() || null;
      const savedRange = normalizeHealthWorkspaceRange(
        user?.settings?.appSettings?.healthWorkspace?.range,
      );
      const savedMetric = normalizeHealthWorkspaceMetric(
        user?.settings?.appSettings?.healthWorkspace?.metric,
      );
      if (uid === this.workspacePreferenceUserID) {
        if (!this.metricPreferenceTouched) {
          this.selectedMetric.set(savedMetric);
        }
        if (!this.rangePreferenceTouched) {
          this.selectedRange.set(savedRange);
        }
        return;
      }
      this.workspacePreferenceUserID = uid;
      this.metricPreferenceTouched = false;
      this.rangePreferenceTouched = false;
      this.preferenceWriteGeneration += 1;
      this.queuedPreferenceWrite = null;
      this.isSavingPreferences.set(false);
      this.preferencesSaveFailed.set(false);
      this.selectedMetric.set(savedMetric);
      this.selectedEndDate.set(this.todayDate);
      this.selectedRange.set(savedRange);
    });

    effect(onCleanup => {
      const uid = this.signedInUserID();
      let subscription: Subscription | null = null;
      this.hasAnySleepSession.set(null);
      this.sleepMetricAvailabilityStatus.set(uid ? 'loading' : 'ready');
      if (uid) {
        subscription = this.sleepService.watchHasAnySleepSession(uid).subscribe({
          next: hasSession => {
            this.hasAnySleepSession.set(hasSession);
            this.sleepMetricAvailabilityStatus.set('ready');
          },
          error: error => {
            this.hasAnySleepSession.set(null);
            this.sleepMetricAvailabilityStatus.set(loadErrorStatus(error));
          },
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });

    effect(onCleanup => {
      const uid = this.signedInUserID();
      let subscription: Subscription | null = null;
      this.sleepSyncStates.set({});
      this.sleepSyncStateResolved.set({});
      this.historyImportRequestGeneration += 1;
      this.historyImportProvider.set(null);
      this.historyImportErrors.set({});
      if (uid) {
        const providers = [
          SLEEP_PROVIDERS.GarminAPI,
          SLEEP_PROVIDERS.SuuntoApp,
          SLEEP_PROVIDERS.COROSAPI,
        ] as const;
        subscription = combineLatest(providers.map(provider => this.sleepService
          .watchSyncState(uid, provider)
          .pipe(
            map(state => ({ state, resolved: true })),
            catchError(() => of({ state: null, resolved: false })),
          )))
          .subscribe(results => {
            this.sleepSyncStates.set(Object.fromEntries(
              providers.map((provider, index) => [provider, results[index].state]),
            ));
            this.sleepSyncStateResolved.set(Object.fromEntries(
              providers.map((provider, index) => [provider, results[index].resolved]),
            ));
          });
      }
      onCleanup(() => {
        subscription?.unsubscribe();
        this.historyImportRequestGeneration += 1;
      });
    });

    effect(() => {
      const uid = this.signedInUserID();
      this.refreshRevision();
      const generation = ++this.metricAvailabilityGeneration;
      this.availableHealthMetricIds.set(uid ? null : []);
      this.healthMetricAvailabilityStatus.set(uid ? 'loading' : 'ready');
      if (!uid) {
        return;
      }
      void this.healthService.loadAvailableMetricIds(uid).then(metricIds => {
        if (generation !== this.metricAvailabilityGeneration) {
          return;
        }
        this.availableHealthMetricIds.set([...new Set([
          ...metricIds,
          ...ACTIVITY_HEALTH_METRIC_IDS,
        ])]);
        this.healthMetricAvailabilityStatus.set('ready');
      }).catch(error => {
        if (generation !== this.metricAvailabilityGeneration) {
          return;
        }
        this.availableHealthMetricIds.set(null);
        this.healthMetricAvailabilityStatus.set(loadErrorStatus(error));
      });
    });

    effect(() => {
      if (!this.availabilityChecksSettled()) {
        return;
      }
      const selections = this.availableMetricSelections();
      if (selections.includes(this.selectedMetric())) {
        return;
      }
      const priorityFallbacks: readonly HealthWorkspaceMetricSelection[] = [
        'sleep',
        HEALTH_METRIC_IDS.HeartRate,
        HEALTH_METRIC_IDS.HeartRateVariability,
        HEALTH_METRIC_IDS.RestingHeartRate,
      ];
      const fallback = priorityFallbacks.find(metric => selections.includes(metric)) || selections[0];
      if (fallback) {
        this.selectedMetric.set(fallback);
      }
    });

    effect(onCleanup => {
      const uid = this.userService.user()?.uid || null;
      const window = this.selectedWindow();
      let subscription: Subscription | null = null;
      this.selectedSleepSessions.set([]);
      this.selectedSleepStatus.set('loading');
      if (uid) {
        subscription = this.sleepService.watchForDashboard(uid, window.startTimeMs, window.endTimeMs).subscribe({
          next: sessions => {
            this.selectedSleepSessions.set(sessions);
            this.selectedSleepStatus.set('ready');
          },
          error: error => this.selectedSleepStatus.set(loadErrorStatus(error)),
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });

    effect(() => {
      const uid = this.userService.user()?.uid || null;
      const window = this.selectedWindow();
      const metric = this.routeState().metric;
      this.refreshRevision();
      const generation = ++this.selectedLoadGeneration;
      this.selectedHealthLoad.set(null);
      this.selectedActivityHealthResult.set(null);
      if (!uid || metric === 'sleep') {
        this.selectedHealthStatus.set(metric === 'sleep' ? 'ready' : 'loading');
        this.selectedActivityHealthStatus.set('ready');
        return;
      }
      this.selectedHealthStatus.set('loading');
      const healthLoad = this.healthService.loadMetricRange(uid, {
        startDate: window.startDate,
        endDate: window.endDate,
        metricId: metric,
        includeSamples: window.includeSamples,
      });
      const activityLoad = isActivityHealthMetricId(metric)
        ? this.activityHealthService.loadRange({
          metricId: metric,
          startTimeMs: window.startTimeMs,
          endTimeMs: window.endTimeMs,
        })
        : Promise.resolve(null);
      this.selectedActivityHealthStatus.set(isActivityHealthMetricId(metric) ? 'loading' : 'ready');
      void Promise.allSettled([healthLoad, activityLoad]).then(([healthOutcome, activityOutcome]) => {
        if (generation !== this.selectedLoadGeneration) {
          return;
        }
        if (healthOutcome.status === 'fulfilled') {
          this.selectedHealthLoad.set(healthOutcome.value);
          this.selectedHealthStatus.set('ready');
        } else {
          this.selectedHealthStatus.set(loadErrorStatus(healthOutcome.reason));
        }
        if (!isActivityHealthMetricId(metric)) {
          this.selectedActivityHealthStatus.set('ready');
        } else if (activityOutcome.status === 'fulfilled' && activityOutcome.value) {
          this.selectedActivityHealthResult.set(activityOutcome.value);
          this.selectedActivityHealthStatus.set('ready');
        } else {
          this.selectedActivityHealthStatus.set(loadErrorStatus(
            activityOutcome.status === 'rejected' ? activityOutcome.reason : null,
          ));
        }
      });
    });

    effect(onCleanup => {
      const uid = this.userService.user()?.uid || null;
      let subscription: Subscription | null = null;
      this.prioritySleepSessions.set([]);
      this.prioritySleepStatus.set('loading');
      if (uid) {
        const endMs = (Date.parse(`${this.todayDate}T00:00:00.000Z`) + (24 * 60 * 60 * 1000)) - 1;
        const startMs = endMs - (30 * 24 * 60 * 60 * 1000) + 1;
        subscription = this.sleepService.watchForDashboard(uid, startMs, endMs).subscribe({
          next: sessions => {
            this.prioritySleepSessions.set(sessions);
            this.prioritySleepStatus.set('ready');
          },
          error: error => this.prioritySleepStatus.set(loadErrorStatus(error)),
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });

    effect(() => {
      const uid = this.userService.user()?.uid || null;
      this.refreshRevision();
      const generation = ++this.priorityLoadGeneration;
      this.priorityHeartRateLoad.set(null);
      this.priorityHrvLoad.set(null);
      this.priorityHeartRateStatus.set('loading');
      this.priorityHrvStatus.set('loading');
      if (!uid) {
        return;
      }
      const endMs = Date.parse(`${this.todayDate}T00:00:00.000Z`);
      const startDate = new Date(endMs - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      void this.loadPriorityMetric(uid, HEALTH_METRIC_IDS.HeartRate, startDate, generation);
      void this.loadPriorityMetric(uid, HEALTH_METRIC_IDS.HeartRateVariability, startDate, generation);
    });

    effect(onCleanup => {
      const uid = this.userService.user()?.uid || null;
      let subscription: Subscription | null = null;
      this.syncStates.set([]);
      this.syncStatesStatus.set(uid ? 'loading' : 'ready');
      this.latestSyncStates = new Map<HealthProvider, HealthSyncState>();
      this.hasSeenSyncStateSnapshot = false;
      if (uid) {
        subscription = this.healthService.watchSyncStates(uid).subscribe({
          next: states => {
            this.syncStates.set(states);
            this.syncStatesStatus.set('ready');
            const providerAdvanced = states.some(state =>
              syncStateAdvanced(state, this.latestSyncStates.get(state.provider)));
            if (this.hasSeenSyncStateSnapshot && providerAdvanced) {
              this.refreshRevision.update(value => value + 1);
            }
            this.latestSyncStates = new Map(states.map(state => [state.provider, { ...state }]));
            this.hasSeenSyncStateSnapshot = true;
          },
          error: error => {
            this.syncStates.set([]);
            this.syncStatesStatus.set(loadErrorStatus(error));
          },
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });
  }

  selectPriorityMetric(metric: HealthWorkspaceMetricSelection): void {
    this.selectAndSaveMetric(metric);
  }

  selectMetric(metric: HealthWorkspaceMetricSelection): void {
    this.selectAndSaveMetric(metric);
  }

  selectRange(range: HealthWorkspaceRange): void {
    const normalizedRange = normalizeHealthWorkspaceRange(range);
    if (normalizedRange === this.selectedRange() && !this.preferencesSaveFailed()) {
      return;
    }
    this.rangePreferenceTouched = true;
    this.selectedRange.set(normalizedRange);
    this.queueWorkspacePreferenceWrite();
  }

  navigateWindow(direction: 'older' | 'newer'): void {
    if (direction === 'newer' && !this.selectedWindow().canNavigateNewer) {
      return;
    }
    this.selectedEndDate.set(
      navigateHealthWorkspaceWindow(this.routeState(), direction, this.todayDate).endDate,
    );
  }

  jumpToToday(): void {
    if (!this.selectedWindow().canNavigateNewer) {
      return;
    }
    this.selectedEndDate.set(this.todayDate);
  }

  retryPreferenceSave(): void {
    this.metricPreferenceTouched = true;
    this.rangePreferenceTouched = true;
    this.queueWorkspacePreferenceWrite();
  }

  showAllProviders(): void {
    this.selectedProviders.set([]);
  }

  toggleProvider(provider: HealthProvider): void {
    const available = this.availableProviders();
    const current = this.effectiveProviderFilters();
    if (!current.length) {
      this.selectedProviders.set([provider]);
      return;
    }
    const next = current.includes(provider)
      ? current.filter(item => item !== provider)
      : [...current, provider];
    this.selectedProviders.set(next.length === 0 || next.length === available.length ? [] : next);
  }

  async startHistoryImport(provider: HealthProvider): Promise<void> {
    const sleepProvider = healthProviderSleepProvider(provider);
    const sourceView = this.syncStateViews().find(state => state.provider === provider);
    const requestedForUserID = `${this.signedInUserID() || ''}`.trim();
    if (
      !sleepProvider
      || !requestedForUserID
      || !sourceView?.historyImportActionLabel
      || this.historyImportProvider()
      || !this.userService.hasProAccessSignal()
    ) {
      return;
    }

    const requestGeneration = ++this.historyImportRequestGeneration;
    this.historyImportProvider.set(provider);
    this.historyImportErrors.update(errors => ({ ...errors, [provider]: undefined }));
    try {
      const result = await this.requestHistoryImport(sleepProvider);
      if (
        this.historyImportRequestGeneration !== requestGeneration
        || this.signedInUserID() !== requestedForUserID
      ) {
        return;
      }
      const queuedAtMs = Date.now();
      this.sleepSyncStates.update(states => ({
        ...states,
        [sleepProvider]: {
          ...(states[sleepProvider] || {
            provider: sleepProvider,
            status: SLEEP_SYNC_STATUSES.Ready,
            updatedAtMs: queuedAtMs,
          }),
          status: SLEEP_SYNC_STATUSES.Ready,
          lastBackfillQueuedAtMs: queuedAtMs,
          lastBackfillStartMs: new Date(result.startDate).getTime(),
          lastBackfillEndMs: new Date(result.endDate).getTime(),
          lastBackfillQueueItems: result.queued,
          nextBackfillAllowedAtMs: result.nextAllowedAtMs,
          healthBackfillStatus: sleepProvider === SLEEP_PROVIDERS.GarminAPI
            && Number(result.healthQueued) > 0
            ? 'queued'
            : null,
          lastError: null,
          updatedAtMs: queuedAtMs,
        },
      }));
    } catch {
      if (
        this.historyImportRequestGeneration !== requestGeneration
        || this.signedInUserID() !== requestedForUserID
      ) {
        return;
      }
      this.historyImportErrors.update(errors => ({
        ...errors,
        [provider]: 'History import could not be started.',
      }));
    } finally {
      if (this.historyImportRequestGeneration === requestGeneration) {
        this.historyImportProvider.set(null);
      }
    }
  }

  private async loadPriorityMetric(
    uid: string,
    metricId: HealthMetricId,
    startDate: string,
    generation: number,
  ): Promise<void> {
    try {
      const result = await this.healthService.loadMetricRange(uid, {
        startDate,
        endDate: this.todayDate,
        metricId,
        includeSamples: true,
      });
      if (generation !== this.priorityLoadGeneration) {
        return;
      }
      if (metricId === HEALTH_METRIC_IDS.HeartRate) {
        this.priorityHeartRateLoad.set(result);
        this.priorityHeartRateStatus.set('ready');
      } else {
        this.priorityHrvLoad.set(result);
        this.priorityHrvStatus.set('ready');
      }
    } catch (error) {
      if (generation !== this.priorityLoadGeneration) {
        return;
      }
      if (metricId === HEALTH_METRIC_IDS.HeartRate) {
        this.priorityHeartRateStatus.set(loadErrorStatus(error));
      } else {
        this.priorityHrvStatus.set(loadErrorStatus(error));
      }
    }
  }

  private requestHistoryImport(provider: SleepProvider): Promise<SleepBackfillQueueResponse> {
    switch (provider) {
      case SLEEP_PROVIDERS.GarminAPI:
        return this.userService.backfillGarminHealthForCurrentUser();
      case SLEEP_PROVIDERS.SuuntoApp:
        return this.userService.backfillSuuntoSleepForCurrentUser();
      case SLEEP_PROVIDERS.COROSAPI:
        return this.userService.backfillCorosSleepForCurrentUser();
    }
  }

  private selectAndSaveMetric(metric: HealthWorkspaceMetricSelection): void {
    const normalizedMetric = normalizeHealthWorkspaceMetric(metric);
    if (normalizedMetric === this.selectedMetric() && !this.preferencesSaveFailed()) {
      return;
    }
    this.metricPreferenceTouched = true;
    this.selectedMetric.set(normalizedMetric);
    this.queueWorkspacePreferenceWrite();
  }

  private queueWorkspacePreferenceWrite(): void {
    const uid = `${this.userService.user()?.uid || ''}`.trim();
    this.preferencesSaveFailed.set(false);
    if (!uid) {
      return;
    }
    this.queuedPreferenceWrite = {
      uid,
      metric: this.selectedMetric(),
      range: this.selectedRange(),
      generation: this.preferenceWriteGeneration,
    };
    this.isSavingPreferences.set(true);
    void this.flushWorkspacePreferenceWrites();
  }

  private async flushWorkspacePreferenceWrites(): Promise<void> {
    if (this.preferenceWriteInFlight) {
      return;
    }
    this.preferenceWriteInFlight = true;
    while (this.queuedPreferenceWrite) {
      const write = this.queuedPreferenceWrite;
      this.queuedPreferenceWrite = null;
      if (write.generation !== this.preferenceWriteGeneration || write.uid !== this.workspacePreferenceUserID) {
        continue;
      }
      try {
        await this.userSettingsService.updateHealthWorkspacePreferences(write.uid, {
          metric: write.metric,
          range: write.range,
        });
      } catch {
        if (
          write.generation === this.preferenceWriteGeneration
          && write.uid === this.workspacePreferenceUserID
          && this.queuedPreferenceWrite === null
        ) {
          this.preferencesSaveFailed.set(true);
        }
      }
    }
    this.preferenceWriteInFlight = false;
    this.isSavingPreferences.set(false);
  }
}

function emptyMetricView(): HealthMetricWorkspaceView {
  return {
    series: [],
    rows: [],
    totalRowCount: 0,
    hasCanonicalSeries: false,
    hasNativeOnlySeries: false,
    conflictCount: 0,
    providers: [],
  };
}

function hasHealthResultValues(result: ReturnType<HealthWorkspaceComponent['filteredHealthResult']>): boolean {
  return !!result && (result.observations.length > 0 || result.sampleChunks.length > 0);
}

function activityEvidenceCanAffectView(
  metric: HealthWorkspaceMetricSelection,
  result: ReturnType<HealthWorkspaceComponent['filteredHealthResult']>,
): boolean {
  return metric === HEALTH_METRIC_IDS.Vo2Max
    || (metric === HEALTH_METRIC_IDS.BodyWeight && !hasHealthResultValues(result));
}

function healthRangeToSleepRange(range: HealthWorkspaceRange): AppDashboardSleepTrendRange | null {
  return range === 'today' ? null : range;
}

function providerView(provider: HealthProvider): HealthProviderView {
  const serviceName = healthProviderServiceName(provider);
  return {
    provider,
    label: providerLabel(provider),
    presentation: serviceName ? buildProviderPresentation({ serviceName, mode: 'source' }) : null,
  };
}

function healthProviderServiceName(provider: HealthProvider): ServiceNames | null {
  // Health storage IDs intentionally differ from sports-lib's display enum values.
  switch (provider) {
    case HEALTH_PROVIDERS.GarminAPI: return ServiceNames.GarminAPI;
    case HEALTH_PROVIDERS.SuuntoApp: return ServiceNames.SuuntoApp;
    case HEALTH_PROVIDERS.COROSAPI: return ServiceNames.COROSAPI;
    case HEALTH_PROVIDERS.WahooAPI: return ServiceNames.WahooAPI;
    case HEALTH_PROVIDERS.QuantifiedSelf: return null;
  }
}

function priorityCard(
  id: HealthPriorityCardView['id'],
  label: string,
  icon: string,
  metric: HealthWorkspaceMetricSelection,
  rows: readonly HealthPriorityRow[],
  status: HealthLoadStatus,
  emptyText: string,
  available: boolean,
): HealthPriorityCardView {
  return {
    id,
    label,
    icon,
    metric,
    rows,
    available,
    loading: status === 'loading',
    error: status === 'error' || status === 'denied',
    emptyText,
  };
}

interface HealthHistoryImportViewOptions {
  sleepSyncState: SleepSyncState | null;
  sleepSyncStateResolved: boolean;
  hasProAccess: boolean;
  busy: boolean;
  error: string | null;
}

function syncStateView(
  state: HealthSyncState,
  historyOptions: HealthHistoryImportViewOptions,
  nowMs = Date.now(),
): HealthSyncStateView {
  const provider = providerView(state.provider);
  const candidateLastUpdateAtMs = Math.max(
    0,
    Number(state.lastSyncedAtMs) || 0,
    Number(state.lastObservedAtMs) || 0,
    Number(state.lastPollAtMs) || 0,
    Number(state.lastWebhookAtMs) || 0,
  );
  const lastUpdateAtMs = Number.isFinite(candidateLastUpdateAtMs) && candidateLastUpdateAtMs > 0
    ? candidateLastUpdateAtMs
    : null;
  const lastUpdateText = lastUpdateAtMs === null
    ? 'No update yet'
    : new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(lastUpdateAtMs));
  const baseView = {
    ...provider,
    lastUpdateText,
    lastUpdateDateTime: lastUpdateAtMs === null ? null : new Date(lastUpdateAtMs).toISOString(),
    ...healthHistoryImportView(state, historyOptions, nowMs),
  };
  switch (state.status) {
    case HEALTH_SYNC_STATUSES.Ready: {
      const recency = healthSyncRecency(lastUpdateAtMs, nowMs);
      return { ...baseView, statusLabel: recency.statusLabel, tone: recency.tone };
    }
    case HEALTH_SYNC_STATUSES.PermissionMissing:
      return { ...baseView, statusLabel: 'Permission needed', tone: 'error' };
    case HEALTH_SYNC_STATUSES.ReconnectRequired:
      return { ...baseView, statusLabel: 'Reconnect required', tone: 'error' };
    case HEALTH_SYNC_STATUSES.Failed:
      return { ...baseView, statusLabel: 'Sync failed', tone: 'error' };
    case HEALTH_SYNC_STATUSES.Unsupported:
      return { ...baseView, statusLabel: 'Not supported', tone: 'neutral' };
    case HEALTH_SYNC_STATUSES.Disconnected:
      return { ...baseView, statusLabel: 'Disconnected', tone: 'neutral' };
  }
}

function healthHistoryImportView(
  state: HealthSyncState,
  options: HealthHistoryImportViewOptions,
  nowMs: number,
): Pick<HealthSyncStateView,
  'historyImportActionLabel' | 'historyImportStatusText' | 'historyImportBusy' | 'historyImportError'> {
  const emptyView = {
    historyImportActionLabel: null,
    historyImportStatusText: null,
    historyImportBusy: false,
    historyImportError: null,
  };
  if (
    !healthProviderSleepProvider(state.provider)
    || state.status !== HEALTH_SYNC_STATUSES.Ready
    || !options.sleepSyncStateResolved
    || !options.hasProAccess
  ) {
    return emptyView;
  }
  if (options.busy) {
    return {
      ...emptyView,
      historyImportActionLabel: 'Starting…',
      historyImportStatusText: 'Starting history import',
      historyImportBusy: true,
    };
  }

  const syncState = options.sleepSyncState;
  const healthStatus = syncState?.healthBackfillStatus || null;
  if (syncState?.status === SLEEP_SYNC_STATUSES.PermissionMissing) {
    return {
      ...emptyView,
      historyImportStatusText: 'History permission needed',
      historyImportError: options.error,
    };
  }
  if (healthStatus === 'queued' || healthStatus === 'running') {
    return {
      ...emptyView,
      historyImportStatusText: healthStatus === 'queued' ? 'History queued' : 'History importing',
    };
  }

  const hasBackfillAttempt = positiveTimestamp(syncState?.lastBackfillStartMs)
    || positiveTimestamp(syncState?.lastBackfillEndMs)
    || (syncState?.lastBackfillQueueItems !== null && syncState?.lastBackfillQueueItems !== undefined)
    || healthStatus !== null;
  const providerBackfillFailed = syncState?.status === SLEEP_SYNC_STATUSES.Failed
    && syncState.lastBackfillQueuedAtMs === null
    && hasBackfillAttempt;
  const retryableFailure = healthStatus === 'failed'
    || providerBackfillFailed
    || options.error !== null;
  if (syncState?.status === SLEEP_SYNC_STATUSES.Failed && !retryableFailure) {
    return emptyView;
  }
  const hasBackfillHistory = positiveTimestamp(syncState?.lastBackfillQueuedAtMs)
    || positiveTimestamp(syncState?.lastBackfillStartMs)
    || positiveTimestamp(syncState?.lastBackfillEndMs)
    || healthStatus === 'complete'
    || healthStatus === 'skipped';
  if (hasBackfillHistory && !retryableFailure) {
    return emptyView;
  }

  const nextAllowedAtMs = Number(syncState?.nextBackfillAllowedAtMs);
  if (Number.isFinite(nextAllowedAtMs) && nextAllowedAtMs > nowMs) {
    return {
      ...emptyView,
      historyImportStatusText: `History available ${new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      }).format(new Date(nextAllowedAtMs))}`,
      historyImportError: options.error,
    };
  }
  return {
    ...emptyView,
    historyImportActionLabel: retryableFailure ? 'Retry import' : 'Import history',
    historyImportError: options.error,
  };
}

function positiveTimestamp(value: unknown): boolean {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0;
}

function healthProviderSleepProvider(provider: HealthProvider): SleepProvider | null {
  switch (provider) {
    case HEALTH_PROVIDERS.GarminAPI: return SLEEP_PROVIDERS.GarminAPI;
    case HEALTH_PROVIDERS.SuuntoApp: return SLEEP_PROVIDERS.SuuntoApp;
    case HEALTH_PROVIDERS.COROSAPI: return SLEEP_PROVIDERS.COROSAPI;
    case HEALTH_PROVIDERS.WahooAPI:
    case HEALTH_PROVIDERS.QuantifiedSelf:
      return null;
  }
}

function healthSyncRecency(
  lastUpdateAtMs: number | null,
  nowMs: number,
): Pick<HealthSyncStateView, 'statusLabel' | 'tone'> {
  if (lastUpdateAtMs === null) {
    return { statusLabel: 'Waiting', tone: 'neutral' };
  }
  const ageMs = Math.max(0, nowMs - lastUpdateAtMs);
  if (ageMs <= HEALTH_SYNC_CURRENT_MAX_AGE_MS) {
    return { statusLabel: 'Current', tone: 'current' };
  }
  if (ageMs <= HEALTH_SYNC_DELAYED_MAX_AGE_MS) {
    return { statusLabel: 'Delayed', tone: 'delayed' };
  }
  return { statusLabel: 'Stale', tone: 'stale' };
}

function loadErrorStatus(error: unknown): HealthLoadStatus {
  const code = `${(error as { code?: unknown } | null)?.code || ''}`.toLowerCase();
  return code.includes('permission-denied') || code.includes('permission_denied') ? 'denied' : 'error';
}

function syncStateAdvanced(current: HealthSyncState, previous: HealthSyncState | undefined): boolean {
  return !previous || HEALTH_SYNC_REFRESH_FIELDS.some(field =>
    Number(current[field] || 0) > Number(previous[field] || 0));
}
