import { TimelineNotesWorkspaceComponent } from '../timeline-notes/timeline-notes-workspace.component';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
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
  type HealthRangeResult,
  HealthSyncState,
  getHealthMetricDefinition,
} from '@shared/health';
import { ProviderPresentation, buildProviderPresentation } from '@shared/provider-presentation';
import { SleepSession } from '@shared/sleep';
import { manualHealthEntryMetric, type ManualHealthMetricId } from '@shared/manual-health';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { AppUserService } from '../../services/app.user.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../helpers/echarts-tooltip-interaction.helper';
import {
  AppHealthService,
  HealthWorkspaceRangeLoad,
} from '../../services/app.health.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AppHealthHighlightId, AppHealthHighlightSources } from '../../models/app-user.interface';
import { normalizeHealthHighlightSources } from '../../helpers/health-highlight-preferences.helper';
import { AppChartsModule } from '../../modules/app-charts.module';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { HealthMetricChartComponent } from './health-metric-chart.component';
import { HealthActivityQueryService } from './health-activity-query.service';
import {
  HealthPriorityChartWindow,
  HealthPriorityCardView,
  HealthPrioritySummaryComponent,
  HealthHighlightSourceSelection,
} from './health-priority-summary.component';
import { HealthSourceObservationTableComponent } from './health-source-observation-table.component';
import {
  HealthSourcesBottomSheetComponent,
  type HealthSourcesData,
  type HealthSourcesResult,
  type HealthSourceSyncView,
  type HealthWorkspaceSourceOption,
} from './health-sources-bottom-sheet.component';
import {
  ManualHealthMeasurementDialogComponent,
  type ManualHealthMeasurementDialogResult,
  type ManualHealthMeasurementDialogValue,
} from './manual-health-measurement-dialog.component';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import {
  HEALTH_WORKSPACE_DEFAULT_RANGE,
  HEALTH_WORKSPACE_RANGES,
  HEALTH_HRV_PERSONAL_RANGE_SEMANTIC_VARIANTS,
  HealthMetricCatalogGroup,
  HealthMetricWorkspaceView,
  HealthObservationTableRow,
  ManualHealthObservationEdit,
  HealthPriorityRow,
  buildHealthHrvPersonalRangeStatus,
  HealthSleepObservationRow,
  HealthWorkspaceMetricSelection,
  HealthWorkspaceRange,
  HealthWorkspaceRouteState,
  HealthWorkspaceSeries,
  buildHealthMetricCatalogGroups,
  buildHealthMetricWorkspaceView,
  buildSleepObservationRows,
  buildSleepPriorityRows,
  filterHealthRangeResultByProviders,
  localCalendarDate,
  navigateHealthWorkspaceWindow,
  normalizeHealthWorkspaceMetric,
  normalizeHealthWorkspaceRange,
  providerLabel,
  resolveHealthWorkspaceWindow,
  isSleepHrvSemanticVariant,
  selectActivityHealthObservations,
  selectWorkoutWeightContextFallback,
  selectHealthPriorityTrendSeries,
  selectTodayHeartRateHighlightSeries,
  sleepSessionHasHrv,
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

interface HealthSyncStateView extends HealthProviderView, HealthSourceSyncView {}

type HealthSyncTone = HealthSourceSyncView['tone'];

interface QueuedHealthWorkspacePreferenceWrite {
  uid: string;
  metric: HealthWorkspaceMetricSelection;
  range: HealthWorkspaceRange;
  generation: number;
  highlightSources?: AppHealthHighlightSources;
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
const DAY_MS = 24 * 60 * 60 * 1000;
// The earliest date in the 14-day trend needs its own complete 60-day baseline.
const PRIORITY_HRV_HISTORY_DAYS = 60 + 14 - 1;
const SELECTED_HRV_CONTEXT_DAYS = 60;

@Component({
  selector: 'app-health-workspace',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    AppChartsModule,
    PageHeaderComponent,
    TimelineNotesWorkspaceComponent,
    HealthMetricChartComponent,
    HealthPrioritySummaryComponent,
    HealthSourceObservationTableComponent,
  ],
  templateUrl: './health-workspace.component.html',
  styleUrls: ['./health-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthWorkspaceComponent {
  protected readonly haptics = inject(AppHapticsService);
  readonly mobileTapFeedbackOptions = DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS;
  private readonly userService = inject(AppUserService);
  private readonly userSettingsService = inject(AppUserSettingsQueryService);
  private readonly healthService = inject(AppHealthService);
  private readonly activityHealthService = inject(HealthActivityQueryService);
  private readonly sleepService = inject(AppSleepService);
  private readonly themeService = inject(AppThemeService);
  private readonly dialog = inject(MatDialog);
  private readonly bottomSheet = inject(MatBottomSheet);
  private sourcesRef: MatBottomSheetRef<HealthSourcesBottomSheetComponent, HealthSourcesResult> | null = null;
  readonly sourcesOpen = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private manualDialogRef: MatDialogRef<unknown> | null = null;
  private manualAccountGeneration = 0;
  private readonly snackBar = inject(MatSnackBar);
  private readonly browserCompatibilityService = inject(BrowserCompatibilityService);
  private readonly signedInUserID = computed(() => this.userService.user()?.uid || null);
  readonly unitSettings = this.userSettingsService.unitSettings;
  // Re-evaluate on interaction: a workspace left open overnight must be able
  // to reveal a newly saved measurement in the new day's window.
  private get todayDate(): string { return localCalendarDate(); }
  private selectedLoadGeneration = 0;
  private selectedHrvContextLoadGeneration = 0;
  private priorityLoadGeneration = 0;
  private priorityHealthUserID: string | null = null;
  private metricAvailabilityGeneration = 0;
  private latestSyncStates = new Map<HealthProvider, HealthSyncState>();
  private hasSeenSyncStateSnapshot = false;
  private workspacePreferenceUserID: string | null = null;
  private metricPreferenceTouched = false;
  private rangePreferenceTouched = false;
  private readonly highlightPreferencesTouched = new Set<AppHealthHighlightId>();
  private preferenceWriteGeneration = 0;
  private preferenceWriteInFlight = false;
  private queuedPreferenceWrite: QueuedHealthWorkspacePreferenceWrite | null = null;

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
  readonly preferredHighlightSources = signal<AppHealthHighlightSources>({});
  readonly selectedWindow = computed(() => resolveHealthWorkspaceWindow(this.routeState(), this.todayDate));
  readonly priorityWindow = resolveHealthWorkspaceWindow({
    metric: HEALTH_METRIC_IDS.HeartRate,
    range: '30d',
    endDate: this.todayDate,
  }, this.todayDate);
  readonly priorityHeartRateWindow = resolveHealthWorkspaceWindow({
    metric: HEALTH_METRIC_IDS.HeartRate,
    range: 'today',
    endDate: this.todayDate,
  }, this.todayDate);
  readonly priorityHrvWindow: HealthPriorityChartWindow & { startDate: string; endDate: string } = {
    ...resolveHealthWorkspaceWindow({
      metric: HEALTH_METRIC_IDS.HeartRateVariability,
      range: '14d',
      endDate: this.todayDate,
    }, this.todayDate),
    label: '14-day trend',
  };
  readonly priorityHrvHistoryStartDate = new Date(
    Date.parse(`${this.priorityHrvWindow.endDate}T00:00:00.000Z`) - ((PRIORITY_HRV_HISTORY_DAYS - 1) * DAY_MS),
  ).toISOString().slice(0, 10);
  readonly selectedHealthLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly selectedHrvContextHealthLoad = signal<HealthWorkspaceRangeLoad | null>(null);
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
  readonly selectedProviders = signal<HealthProvider[]>([]);
  private readonly sourceInventory = signal<{ uid: string | null; providers: HealthProvider[] }>({ uid: null, providers: [] });
  readonly refreshRevision = signal(0);
  readonly manualMutationBusy = signal(false);
  readonly availableHealthMetricIds = signal<readonly HealthMetricId[] | null>(null);
  readonly healthMetricAvailabilityStatus = signal<HealthLoadStatus>('loading');
  readonly hasAnySleepSession = signal<boolean | null>(null);
  readonly sleepMetricAvailabilityStatus = signal<HealthLoadStatus>('loading');
  readonly priorityRecentSleepSessions = computed(() => this.prioritySleepSessions().filter(session =>
    session.endTimeMs >= this.priorityWindow.startTimeMs
    && session.endTimeMs <= this.priorityWindow.endTimeMs));
  readonly priorityHrvTrendSeries = computed(() => selectHealthPriorityTrendSeries(
    this.priorityHrvLoad()?.result,
    this.prioritySleepSessions(),
    this.unitSettings(),
    {
      startTimeMs: this.priorityHrvWindow.startTimeMs,
      endTimeMs: this.priorityHrvWindow.endTimeMs,
      minimumPointCount: 3,
      semanticVariants: HEALTH_HRV_PERSONAL_RANGE_SEMANTIC_VARIANTS,
      semanticVariantPriority: HEALTH_HRV_PERSONAL_RANGE_SEMANTIC_VARIANTS,
    },
  ));
  readonly priorityHrvChartStatuses = computed(() => {
    const result = this.priorityHrvLoad()?.result;
    if (!result) {
      return {};
    }
    const fullSeriesById = new Map(buildHealthMetricWorkspaceView(
      result,
      this.prioritySleepSessions(),
      [],
      this.unitSettings(),
    ).series.map(series => [series.id, series]));
    return Object.fromEntries(this.priorityHrvTrendSeries().flatMap(series => {
      const status = buildHealthHrvPersonalRangeStatus(
        fullSeriesById.get(series.id) || series,
        this.priorityHrvWindow.endTimeMs,
        this.unitSettings(),
        series.points.map(point => point.timestampMs),
      );
      return status ? [[series.id, status]] : [];
    }));
  });
  readonly isDarkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);

  readonly healthMetricFilteringActive = computed(() => this.healthMetricAvailabilityStatus() === 'ready');
  readonly sleepMetricFilteringActive = computed(() => this.sleepMetricAvailabilityStatus() === 'ready');
  readonly hasLoadedSleepHrv = computed(() => [
    ...this.selectedSleepSessions(),
    ...this.prioritySleepSessions(),
  ].some(sleepSessionHasHrv));
  readonly sleepHrvAvailabilityStatus = computed<HealthLoadStatus>(() => {
    if (this.hasLoadedSleepHrv()) {
      return 'ready';
    }
    const statuses = [this.selectedSleepStatus(), this.prioritySleepStatus()];
    if (statuses.every(status => status === 'ready')) {
      return 'ready';
    }
    if (statuses.some(status => status === 'loading')) {
      return 'loading';
    }
    return statuses.some(status => status === 'denied') ? 'denied' : 'error';
  });
  readonly availabilityChecksSettled = computed(() =>
    this.healthMetricAvailabilityStatus() !== 'loading'
    && this.sleepMetricAvailabilityStatus() !== 'loading'
    && this.sleepHrvAvailabilityStatus() !== 'loading');
  readonly metricCatalogGroups = computed<readonly HealthMetricCatalogGroup[]>(() => {
    if (!this.healthMetricFilteringActive()) {
      return this.completeMetricCatalogGroups;
    }
    const availableMetricIds = new Set(this.availableHealthMetricIds() || []);
    if (this.sleepHrvAvailabilityStatus() !== 'ready' || this.hasLoadedSleepHrv()) {
      availableMetricIds.add(HEALTH_METRIC_IDS.HeartRateVariability);
    }
    return buildHealthMetricCatalogGroups([...availableMetricIds]);
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
    const sleepHrvStatus = this.sleepHrvAvailabilityStatus();
    if (healthStatus !== 'error' && healthStatus !== 'denied'
      && sleepStatus !== 'error' && sleepStatus !== 'denied'
      && sleepHrvStatus !== 'error' && sleepHrvStatus !== 'denied') {
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
  // A workspace selection is not broadened when a metric/window lacks that source.
  readonly effectiveProviderFilters = computed(() => this.selectedProviders());
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
  readonly selectedHrvContextWindow = computed(() => {
    const visibleStartDayMs = Date.parse(`${this.selectedWindow().startDate}T00:00:00.000Z`);
    return {
      startDate: new Date(visibleStartDayMs - (SELECTED_HRV_CONTEXT_DAYS * DAY_MS)).toISOString().slice(0, 10),
      endDate: new Date(visibleStartDayMs - DAY_MS).toISOString().slice(0, 10),
    };
  });
  readonly selectedHrvChartStatuses = computed(() => {
    if (this.routeState().metric !== HEALTH_METRIC_IDS.HeartRateVariability) {
      return {};
    }
    const visibleSeries = this.metricView().series;
    const visibleResult = this.filteredHealthResult();
    if (!visibleResult || visibleSeries.length === 0) {
      return {};
    }
    const selectedProviders = this.effectiveProviderFilters();
    const historyResult = this.selectedHrvContextHealthLoad()?.result;
    const filteredHistoryResult = historyResult
      ? filterHealthRangeResultByProviders(historyResult, selectedProviders)
      : null;
    const historySleepSessions = selectedProviders.length
      ? this.selectedSleepSessions().filter(session =>
        selectedProviders.includes(session.source.provider as HealthProvider))
      : this.selectedSleepSessions();
    const fullSeries = [
      ...buildHealthMetricWorkspaceView(
        visibleResult,
        historySleepSessions,
        [],
        this.unitSettings(),
      ).series,
      ...buildHealthMetricWorkspaceView(
        filteredHistoryResult || sleepOnlyHrvContextResult(
          visibleResult,
          this.selectedHrvContextWindow(),
        ),
        historySleepSessions,
        [],
        this.unitSettings(),
      ).series,
    ];
    const fullSeriesById = new Map<string, HealthWorkspaceSeries>();
    for (const series of fullSeries) {
      const current = fullSeriesById.get(series.id);
      fullSeriesById.set(series.id, current
        ? { ...current, points: mergeHealthSeriesPoints(current.points, series.points) }
        : series);
    }
    return Object.fromEntries(visibleSeries.flatMap(series => {
      const status = buildHealthHrvPersonalRangeStatus(
        fullSeriesById.get(series.id) || series,
        this.selectedWindow().endTimeMs,
        this.unitSettings(),
        series.points.map(point => point.timestampMs),
      );
      return status ? [[series.id, status]] : [];
    }));
  });
  readonly selectedManualMetric = computed<ManualHealthMetricId | null>(() => {
    return manualHealthEntryMetric(this.routeState().metric);
  });
  readonly workoutWeightFallback = computed(() => {
    const result = this.filteredHealthResult();
    const activityResult = this.selectedActivityHealthResult();
    if (this.routeState().metric !== HEALTH_METRIC_IDS.BodyWeight || !result || !activityResult) {
      return null;
    }
    return selectWorkoutWeightContextFallback(
      result,
      activityResult.observations,
      this.effectiveProviderFilters(),
      this.unitSettings(),
    );
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
    const selectedMetric = this.routeState().metric;
    const providers = this.selectedIsSleep()
      ? this.windowedSleepSessions().map(session => session.source.provider as HealthProvider)
      : [
        ...(this.selectedHealthLoad()?.providers || []),
        ...(loadedResult?.observations.map(item => item.provider) || []),
        ...(loadedResult?.sampleChunks.map(item => item.provider) || []),
        ...(this.selectedActivityHealthResult()?.observations.map(item => item.provider) || []),
        ...(selectedMetric === HEALTH_METRIC_IDS.HeartRateVariability
          ? this.windowedSleepSessions()
            .filter(sleepSessionHasHrv)
            .map(session => session.source.provider as HealthProvider)
          : []),
      ];
    return [...new Set(providers)].sort((left, right) => providerLabel(left).localeCompare(providerLabel(right)));
  });
  readonly workspaceSourceOptions = computed<HealthWorkspaceSourceOption[]>(() => {
    const inventory = this.sourceInventory();
    const selected = this.selectedProviders();
    const known = inventory.uid === this.signedInUserID() ? inventory.providers : [];
    const statuses = new Map(this.syncStateViews().map(state => [state.provider, state]));
    const inView = new Set(this.availableProviders());
    return [...new Set([...known, ...selected])].map(provider => ({
      ...providerView(provider),
      selected: selected.length === 0 || selected.includes(provider),
      sync: statuses.get(provider) || null,
      hasDataInView: this.isLoading() ? null : inView.has(provider),
    })).sort((left, right) => left.label.localeCompare(right.label));
  });
  readonly allProvidersSelected = computed(() => this.effectiveProviderFilters().length === 0);
  readonly sourcesButtonLabel = computed(() => this.selectedProviders().length ? `Sources · ${this.selectedProviders().length}` : 'Sources');
  readonly sourceAttention = computed(() => {
    if (this.syncStatesStatus() === 'error' || this.syncStatesStatus() === 'denied'
      || this.syncStateViews().some(state => state.tone === 'error' || state.tone === 'stale')) return 'error';
    return this.syncStateViews().some(state => state.tone === 'delayed') ? 'delayed' : null;
  });
  readonly sourcesAriaLabel = computed(() => {
    const selection = this.selectedProviders().length ? this.selectedProviders().map(providerLabel).join(', ') : 'All sources';
    return `Health sources: ${selection}${this.sourceAttention() ? '. Check source status' : ''}`;
  });
  readonly rangeButtonLabel = computed(() => this.selectedRange() === 'today' ? '1d' : this.selectedRange());
  readonly rangeAriaLabel = computed(() => `Health range: ${RANGE_LABELS[this.selectedRange()]}`);
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
  readonly omittedSampleSourceNotice = computed(() => {
    if (this.selectedIsSleep() || this.selectedWindow().includeSamples
      || this.selectedStatus() !== 'ready' || !this.hasData()) return null;
    const shownProviders = new Set(this.metricView().series.map(series => series.provider));
    const filters = this.effectiveProviderFilters();
    const omitted = (this.selectedHealthLoad()?.sampleBackedProviders || [])
      .filter(provider => (!filters.length || filters.includes(provider)) && !shownProviders.has(provider));
    return omitted.length
      ? `${omitted.map(providerLabel).join(', ')}: detailed readings exist, but no daily summary is available in this view. Select 30 days or less to see those readings.`
      : null;
  });
  readonly heartRateReadingNotice = computed(() => {
    if (this.routeState().metric !== HEALTH_METRIC_IDS.HeartRate
      || this.selectedStatus() !== 'ready' || !this.hasData()) return null;
    const series = this.metricView().series;
    const messages: string[] = [];
    if (series.some(item => item.semanticVariant === 'rolling_7_day_average')) {
      messages.push('7-day average is the provider’s rolling value, not the average of your selected date range.');
    }
    if (series.some(item => item.semanticVariant.startsWith('qs_daily_'))) {
      messages.push('Calculated by QS uses only the readings recorded on each day; gaps remain gaps.');
      if (series.some(item => ['qs_daily_interval_low', 'qs_daily_interval_high'].includes(item.semanticVariant))) {
        messages.push('Lowest and highest interval averages are not the day’s true heart-rate extremes.');
      }
    } else if (series.some(item => ['activity_interval_average', 'daily_15_second'].includes(item.semanticVariant))) {
      messages.push('Throughout the day charts show individual recorded intervals, not daily averages.');
    }
    return messages.join(' ') || null;
  });
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
      return 'Workout Weight is profile context embedded in an imported workout, not a weigh-in. It is shown only for sources without a Health Weight measurement in this filtered window.';
    }
    if (metric === HEALTH_METRIC_IDS.Vo2Max) {
      return 'Workout VO₂ max is separate evidence grouped by source and discipline. It is never combined with provider Health or manual VO₂ max.';
    }
    return null;
  });
  readonly sleepHrvNotice = computed(() => {
    if (this.routeState().metric !== HEALTH_METRIC_IDS.HeartRateVariability
      || !this.metricView().series.some(series => isSleepHrvSemanticVariant(series.semanticVariant))) {
      return null;
    }
    return 'Sleep HRV is read from normalized Sleep sessions and shown as its own labeled series. It is never averaged with standalone HRV.';
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
        buildSleepPriorityRows(this.priorityRecentSleepSessions(), this.unitSettings()),
        [],
        this.prioritySleepStatus(),
        'No Sleep sessions in the last 30 days.',
        !sleepAvailabilityIsKnown || available.has('sleep'),
      ),
      priorityCard(
        'heart_rate',
        'Today’s heart rate',
        healthMetricIcon(HEALTH_METRIC_IDS.HeartRate),
        HEALTH_METRIC_IDS.HeartRate,
        [],
        selectTodayHeartRateHighlightSeries(
          this.priorityHeartRateLoad()?.result,
          this.priorityHeartRateWindow,
          this.unitSettings(),
        ),
        this.priorityHeartRateStatus(),
        'No recorded heart rate today.',
        !healthAvailabilityIsKnown || available.has(HEALTH_METRIC_IDS.HeartRate),
        this.priorityHeartRateWindow,
      ),
      priorityCard(
        'heart_rate_variability',
        'HRV',
        healthMetricIcon(HEALTH_METRIC_IDS.HeartRateVariability),
        HEALTH_METRIC_IDS.HeartRateVariability,
        [],
        this.priorityHrvTrendSeries(),
        this.priorityHrvStatus(),
        'No HRV trend in the last 14 days.',
        !healthAvailabilityIsKnown || available.has(HEALTH_METRIC_IDS.HeartRateVariability),
        this.priorityHrvWindow,
        this.priorityHrvChartStatuses(),
      ),
    ];
  });
  readonly visiblePriorityCards = computed<HealthPriorityCardView[]>(() => this.priorityCards().map(card => {
    const selected = this.selectedProviders();
    return selected.length ? {
      ...card,
      rows: card.rows.filter(row => selected.includes(row.provider)),
      chartSeries: card.chartSeries.filter(series => selected.includes(series.provider)),
    } : card;
  }).filter(card =>
    card.id === 'heart_rate_variability' || card.id === 'heart_rate'
      ? card.chartSeries.length > 0
      : card.loading || card.error || card.rows.length > 0 || card.chartSeries.length > 0));
  readonly syncStateViews = computed<HealthSyncStateView[]>(() => this.syncStates()
    .map(state => syncStateView(state))
    .sort((left, right) => left.label.localeCompare(right.label)));

  constructor() {
    effect(onCleanup => {
      this.signedInUserID();
      this.routeState();
      onCleanup(() => {
        const ref = this.sourcesRef;
        this.sourcesRef = null;
        this.sourcesOpen.set(false);
        ref?.dismiss();
      });
    });
    effect(onCleanup => {
      this.signedInUserID();
      onCleanup(() => {
        // Auth changes and component teardown invalidate dialogs and pending UI work.
        this.manualAccountGeneration += 1;
        this.manualDialogRef?.close();
        this.manualDialogRef = null;
        this.manualMutationBusy.set(false);
      });
    });
    effect(() => {
      const user = this.userService.user();
      const uid = `${user?.uid || ''}`.trim() || null;
      const savedRange = normalizeHealthWorkspaceRange(
        user?.settings?.appSettings?.healthWorkspace?.range,
      );
      const savedMetric = normalizeHealthWorkspaceMetric(
        user?.settings?.appSettings?.healthWorkspace?.metric,
      );
      const savedHighlightSources = normalizeHealthHighlightSources(
        user?.settings?.appSettings?.healthWorkspace?.highlightSources,
      );
      if (uid === this.workspacePreferenceUserID) {
        if (!this.metricPreferenceTouched) {
          this.selectedMetric.set(savedMetric);
        }
        if (!this.rangePreferenceTouched) {
          this.selectedRange.set(savedRange);
        }
        const current = untracked(this.preferredHighlightSources);
        for (const id of this.highlightPreferencesTouched) savedHighlightSources[id] = current[id];
        this.preferredHighlightSources.set(savedHighlightSources);
        return;
      }
      this.workspacePreferenceUserID = uid;
      this.sourceInventory.set({ uid, providers: [] });
      this.selectedProviders.set([]);
      this.metricPreferenceTouched = false;
      this.rangePreferenceTouched = false;
      this.highlightPreferencesTouched.clear();
      this.preferredHighlightSources.set(savedHighlightSources);
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
      const uid = this.signedInUserID();
      const window = this.selectedWindow();
      const metric = this.routeState().metric;
      let subscription: Subscription | null = null;
      this.selectedSleepSessions.set([]);
      this.selectedSleepStatus.set('loading');
      if (uid) {
        const historyStartTimeMs = metric === HEALTH_METRIC_IDS.HeartRateVariability
          ? resolveHealthWorkspaceWindow({
            metric,
            range: 'today',
            endDate: this.selectedHrvContextWindow().startDate,
          }, this.todayDate).startTimeMs
          : window.startTimeMs;
        subscription = this.sleepService.watchForDashboard(uid, historyStartTimeMs, window.endTimeMs).subscribe({
          next: sessions => {
            this.rememberProviders(uid, sessions.map(session => session.source.provider as HealthProvider));
            this.selectedSleepSessions.set(sessions);
            this.selectedSleepStatus.set('ready');
          },
          error: error => this.selectedSleepStatus.set(loadErrorStatus(error)),
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });

    effect(() => {
      const uid = this.signedInUserID();
      const metric = this.routeState().metric;
      const contextWindow = this.selectedHrvContextWindow();
      this.refreshRevision();
      const generation = ++this.selectedHrvContextLoadGeneration;
      this.selectedHrvContextHealthLoad.set(null);
      if (!uid || metric !== HEALTH_METRIC_IDS.HeartRateVariability) {
        return;
      }
      void this.healthService.loadMetricRange(uid, {
        ...contextWindow,
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        includeSamples: false,
      }).then(load => {
        if (generation === this.selectedHrvContextLoadGeneration) {
          this.selectedHrvContextHealthLoad.set(load);
        }
      }).catch(() => {
        // The visible range remains usable; it will show a building-baseline
        // state when older context cannot be loaded.
      });
    });

    effect(() => {
      const uid = this.signedInUserID();
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
          this.rememberHealthProviders(uid, healthOutcome.value);
          this.selectedHealthLoad.set(healthOutcome.value);
          this.selectedHealthStatus.set('ready');
        } else {
          this.selectedHealthStatus.set(loadErrorStatus(healthOutcome.reason));
        }
        if (!isActivityHealthMetricId(metric)) {
          this.selectedActivityHealthStatus.set('ready');
        } else if (activityOutcome.status === 'fulfilled' && activityOutcome.value) {
          this.rememberProviders(uid, activityOutcome.value.observations.map(item => item.provider));
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
      const uid = this.signedInUserID();
      let subscription: Subscription | null = null;
      this.prioritySleepSessions.set([]);
      this.prioritySleepStatus.set('loading');
      if (uid) {
        const endMs = (Date.parse(`${this.todayDate}T00:00:00.000Z`) + (24 * 60 * 60 * 1000)) - 1;
        const startMs = endMs - (PRIORITY_HRV_HISTORY_DAYS * DAY_MS) + 1;
        subscription = this.sleepService.watchForDashboard(uid, startMs, endMs).subscribe({
          next: sessions => {
            this.rememberProviders(uid, sessions.map(session => session.source.provider as HealthProvider));
            this.prioritySleepSessions.set(sessions);
            this.prioritySleepStatus.set('ready');
          },
          error: error => this.prioritySleepStatus.set(loadErrorStatus(error)),
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });

    effect(() => {
      const uid = this.signedInUserID();
      this.refreshRevision();
      const generation = ++this.priorityLoadGeneration;
      const userChanged = uid !== this.priorityHealthUserID;
      const currentHeartRateLoad = untracked(this.priorityHeartRateLoad);
      const currentHrvLoad = untracked(this.priorityHrvLoad);
      this.priorityHealthUserID = uid;
      if (userChanged) {
        this.priorityHeartRateLoad.set(null);
        this.priorityHrvLoad.set(null);
      }
      if (!currentHeartRateLoad || userChanged) {
        this.priorityHeartRateStatus.set('loading');
      }
      if (!currentHrvLoad || userChanged) {
        this.priorityHrvStatus.set('loading');
      }
      if (!uid) {
        return;
      }
      // Provider calendar dates can differ from the viewer's local day. Read
      // the adjacent dates too, then clip actual sample timestamps to today.
      const todayMs = Date.parse(this.todayDate);
      void this.loadPriorityMetric(uid, HEALTH_METRIC_IDS.HeartRate,
        new Date(todayMs - DAY_MS).toISOString().slice(0, 10), generation, true,
        new Date(todayMs + DAY_MS).toISOString().slice(0, 10));
      void this.loadPriorityMetric(
        uid,
        HEALTH_METRIC_IDS.HeartRateVariability,
        this.priorityHrvHistoryStartDate,
        generation,
        false,
      );
    });

    effect(onCleanup => {
      const uid = this.signedInUserID();
      let subscription: Subscription | null = null;
      this.syncStates.set([]);
      this.syncStatesStatus.set(uid ? 'loading' : 'ready');
      this.latestSyncStates = new Map<HealthProvider, HealthSyncState>();
      this.hasSeenSyncStateSnapshot = false;
      if (uid) {
        subscription = this.healthService.watchSyncStates(uid).subscribe({
          next: states => {
            this.rememberProviders(uid, states.map(state => state.provider));
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
    this.selectMetric(metric);
  }

  selectMetric(metric: HealthWorkspaceMetricSelection): void {
    if (normalizeHealthWorkspaceMetric(metric) !== this.selectedMetric() || this.preferencesSaveFailed()) {
      this.haptics.selection();
    }
    this.selectAndSaveMetric(metric);
  }

  selectRange(range: HealthWorkspaceRange): void {
    const normalizedRange = normalizeHealthWorkspaceRange(range);
    if (normalizedRange === this.selectedRange() && !this.preferencesSaveFailed()) {
      return;
    }
    this.haptics.selection();
    this.rangePreferenceTouched = true;
    this.selectedRange.set(normalizedRange);
    this.queueWorkspacePreferenceWrite();
  }

  navigateWindow(direction: 'older' | 'newer'): void {
    if (direction === 'newer' && !this.selectedWindow().canNavigateNewer) {
      return;
    }
    this.haptics.selection();
    this.selectedEndDate.set(
      navigateHealthWorkspaceWindow(this.routeState(), direction, this.todayDate).endDate,
    );
  }

  jumpToToday(): void {
    if (!this.selectedWindow().canNavigateNewer) {
      return;
    }
    this.haptics.selection();
    this.selectedEndDate.set(this.todayDate);
  }

  retryPreferenceSave(): void {
    this.haptics.selection();
    this.metricPreferenceTouched = true;
    this.rangePreferenceTouched = true;
    this.queueWorkspacePreferenceWrite();
  }

  selectHighlightSource({ cardId, sourceKey }: HealthHighlightSourceSelection): void {
    const card = this.visiblePriorityCards().find(item => item.id === cardId);
    const sources = card?.chartSeries.length ? card.chartSeries : card?.rows;
    if (!this.signedInUserID() || !card || card.loading || card.error
      || !sources?.some(source => source.sourceSelectionKey === sourceKey)
      || this.preferredHighlightSources()[cardId] === sourceKey) return;
    this.haptics.selection();
    this.highlightPreferencesTouched.add(cardId);
    this.preferredHighlightSources.update(current => ({ ...current, [cardId]: sourceKey }));
    this.queueWorkspacePreferenceWrite();
  }

  showAllProviders(): void {
    if (this.effectiveProviderFilters().length) this.haptics.selection();
    this.selectedProviders.set([]);
  }

  toggleProvider(provider: HealthProvider): void {
    const available = this.workspaceSourceOptions().map(option => option.provider);
    if (!available.includes(provider)) return;
    this.haptics.selection();
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

  openSources(): void {
    const uid = this.signedInUserID();
    if (!uid || this.sourcesRef) return;
    const requested = this.routeState();
    const data: HealthSourcesData = {
      providers: this.workspaceSourceOptions(),
      syncStatus: this.syncStatesStatus(),
    };
    this.haptics.selection();
    const ref = this.bottomSheet.open<HealthSourcesBottomSheetComponent, HealthSourcesData, HealthSourcesResult>(
      HealthSourcesBottomSheetComponent,
      { data, ariaLabel: 'Health sources', autoFocus: 'first-tabbable', restoreFocus: true },
    );
    this.sourcesRef = ref;
    this.sourcesOpen.set(true);
    ref.afterDismissed().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (this.sourcesRef !== ref) return;
      this.sourcesRef = null;
      this.sourcesOpen.set(false);
      const current = this.routeState();
      if (!result || uid !== this.signedInUserID() || current.metric !== requested.metric
        || current.range !== requested.range || current.endDate !== requested.endDate || result.providers === null) return;
      const available = new Set(data.providers.map(option => option.provider));
      // Validate against the opened draft, not a metric's changing page of data.
      if (result.providers.some(provider => !available.has(provider))) return;
      const nextProviders = [...new Set(result.providers)];
      const previous = this.selectedProviders();
      const sourcesChanged = nextProviders.length !== previous.length || nextProviders.some(provider => !previous.includes(provider));
      if (!sourcesChanged) return;
      this.haptics.selection();
      this.selectedProviders.set(nextProviders);
    });
  }

  private rememberHealthProviders(uid: string, load: HealthWorkspaceRangeLoad): void {
    this.rememberProviders(uid, [
      ...load.providers,
      ...load.result.observations.map(item => item.provider),
      ...load.result.sampleChunks.map(item => item.provider),
    ]);
  }

  private rememberProviders(uid: string, providers: readonly HealthProvider[]): void {
    if (uid !== this.signedInUserID() || !providers.length) return;
    this.sourceInventory.update(current => ({
      uid,
      providers: [...new Set([...(current.uid === uid ? current.providers : []), ...providers])],
    }));
  }

  openManualMeasurement(): void {
    const metricId = this.selectedManualMetric() ?? HEALTH_METRIC_IDS.BodyWeight;
    const requestedForUserID = this.signedInUserID();
    if (!requestedForUserID || this.manualMutationBusy() || this.manualDialogRef) return;
    this.haptics.selection();
    const dialogRef = this.dialog.open(ManualHealthMeasurementDialogComponent, {
      width: 'min(520px, calc(100vw - 24px))',
      maxWidth: '100vw',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      data: { metricId, unitSettings: this.unitSettings() },
    });
    this.handleManualDialogResult<ManualHealthMeasurementDialogResult>(dialogRef, result => {
      const { metricId: chosenMetric, ...value } = result;
      void this.createManualMeasurement(chosenMetric, value, undefined, requestedForUserID);
    });
  }

  async editManualMeasurement(measurement: ManualHealthObservationEdit): Promise<void> {
    const requestedForUserID = this.signedInUserID();
    if (!requestedForUserID || this.manualMutationBusy() || this.manualDialogRef) return;
    this.haptics.selection();
    const generation = this.manualAccountGeneration;
    let existing: ManualHealthMeasurementDialogValue = measurement;
    if (measurement.metricId === HEALTH_METRIC_IDS.BloodPressureSystolic) {
      this.manualMutationBusy.set(true);
      try {
        existing = await this.healthService.loadManualBloodPressure(
          requestedForUserID, measurement.sourceRecordId, measurement.expectedRevisionOrder,
        );
        if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      } catch {
        if (this.isCurrentManualAccount(requestedForUserID, generation)) {
          this.haptics.error();
          this.snackBar.open('Measurement changed or could not be loaded. Refresh and try again.', 'Dismiss', { duration: 5000 });
          this.refreshRevision.update(current => current + 1);
        }
        return;
      } finally {
        if (this.isCurrentManualAccount(requestedForUserID, generation)) this.manualMutationBusy.set(false);
      }
    }
    const dialogRef = this.dialog.open(ManualHealthMeasurementDialogComponent, {
      width: 'min(520px, calc(100vw - 24px))',
      maxWidth: '100vw',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      data: {
        metricId: measurement.metricId,
        unitSettings: this.unitSettings(),
        existing,
      },
    });
    this.handleManualDialogResult<ManualHealthMeasurementDialogResult>(dialogRef, result => {
      const { metricId, ...value } = result;
      if (metricId !== measurement.metricId) return;
      void this.updateManualMeasurement(measurement, value, requestedForUserID);
    });
  }

  deleteManualMeasurement(measurement: ManualHealthObservationEdit): void {
    const requestedForUserID = this.signedInUserID();
    if (!requestedForUserID || this.manualMutationBusy() || this.manualDialogRef) return;
    this.haptics.selection();
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: 'min(440px, calc(100vw - 24px))',
      data: {
        title: 'Delete manual measurement?',
        message: measurement.metricId === HEALTH_METRIC_IDS.BloodPressureSystolic
          ? 'This deletes both blood-pressure readings and any pulse saved with them. This action cannot be undone.'
          : 'This removes this measurement and any references to it. This action cannot be undone.',
        confirmLabel: 'Delete',
        confirmColor: 'warn',
      },
    });
    this.handleManualDialogResult(dialogRef, () => {
      void this.removeManualMeasurement(measurement, requestedForUserID);
    });
  }

  private handleManualDialogResult<T>(dialogRef: MatDialogRef<unknown, T>, onResult: (value: T) => void): void {
    const generation = this.manualAccountGeneration;
    this.manualDialogRef = dialogRef;
    dialogRef.afterClosed().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (this.manualDialogRef === dialogRef) this.manualDialogRef = null;
      if (result && generation === this.manualAccountGeneration) onResult(result);
    });
  }

  private isCurrentManualAccount(uid: string | null, generation = this.manualAccountGeneration): boolean {
    return !!uid && uid === this.signedInUserID()
      && generation === this.manualAccountGeneration && !this.destroyRef.destroyed;
  }

  private async loadPriorityMetric(
    uid: string,
    metricId: HealthMetricId,
    startDate: string,
    generation: number,
    includeSamples: boolean,
    endDate = this.todayDate,
  ): Promise<void> {
    try {
      const result = await this.healthService.loadMetricRange(uid, {
        startDate,
        endDate,
        metricId,
        includeSamples,
      });
      if (generation !== this.priorityLoadGeneration) {
        return;
      }
      this.rememberHealthProviders(uid, result);
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
        if (!this.priorityHeartRateLoad()) {
          this.priorityHeartRateStatus.set(loadErrorStatus(error));
        }
      } else {
        if (!this.priorityHrvLoad()) {
          this.priorityHrvStatus.set(loadErrorStatus(error));
        }
      }
    }
  }

  private async createManualMeasurement(
    metricId: ManualHealthMetricId,
    value: ManualHealthMeasurementDialogValue,
    clientMutationId?: string,
    requestedForUserID = this.signedInUserID(),
  ): Promise<void> {
    if (!this.isCurrentManualAccount(requestedForUserID) || this.manualMutationBusy()) return;
    const generation = this.manualAccountGeneration;
    const resolvedMutationId = clientMutationId ?? this.browserCompatibilityService.createRandomUUID();
    if (!resolvedMutationId) {
      this.haptics.error();
      this.snackBar.open('This browser cannot create a secure measurement ID.', 'Dismiss', { duration: 5000 });
      return;
    }
    this.manualMutationBusy.set(true);
    try {
      await this.healthService.saveManualMeasurement({
        mode: 'create',
        clientMutationId: resolvedMutationId,
        metricId,
        ...value,
      }, requestedForUserID);
      if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      this.revealManualMeasurement(metricId, value);
      this.haptics.success();
      this.snackBar.open('Measurement added', undefined, { duration: 2500 });
    } catch {
      if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      this.haptics.error();
      const retryNotice = this.snackBar.open(
        'Measurement could not be added.',
        'Retry',
        { duration: 7000 },
      );
      retryNotice.onAction().pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        if (this.isCurrentManualAccount(requestedForUserID, generation) && !this.manualMutationBusy()) {
          this.haptics.selection();
          void this.createManualMeasurement(metricId, value, resolvedMutationId, requestedForUserID);
        }
      });
    } finally {
      if (this.isCurrentManualAccount(requestedForUserID, generation)) this.manualMutationBusy.set(false);
    }
  }

  private async updateManualMeasurement(
    measurement: ManualHealthObservationEdit,
    value: ManualHealthMeasurementDialogValue,
    requestedForUserID = this.signedInUserID(),
  ): Promise<void> {
    if (!this.isCurrentManualAccount(requestedForUserID) || this.manualMutationBusy()) return;
    const generation = this.manualAccountGeneration;
    this.manualMutationBusy.set(true);
    try {
      await this.healthService.saveManualMeasurement({
        mode: 'update',
        sourceRecordId: measurement.sourceRecordId,
        expectedRevisionOrder: measurement.expectedRevisionOrder,
        metricId: measurement.metricId,
        ...value,
      }, requestedForUserID);
      if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      this.revealManualMeasurement(measurement.metricId, value);
      this.haptics.success();
      this.snackBar.open('Measurement updated', undefined, { duration: 2500 });
    } catch {
      if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      this.haptics.error();
      this.snackBar.open('Measurement changed or could not be updated. Refresh and try again.', 'Dismiss', {
        duration: 5000,
      });
    } finally {
      if (this.isCurrentManualAccount(requestedForUserID, generation)) this.manualMutationBusy.set(false);
    }
  }

  private async removeManualMeasurement(
    measurement: ManualHealthObservationEdit,
    requestedForUserID = this.signedInUserID(),
  ): Promise<void> {
    if (!this.isCurrentManualAccount(requestedForUserID) || this.manualMutationBusy()) return;
    const generation = this.manualAccountGeneration;
    this.manualMutationBusy.set(true);
    try {
      await this.healthService.deleteManualMeasurement({
        sourceRecordId: measurement.sourceRecordId,
        expectedRevisionOrder: measurement.expectedRevisionOrder,
      }, requestedForUserID);
      if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      this.refreshRevision.update(current => current + 1);
      void this.refreshAvailableHealthMetrics();
      this.haptics.success();
      this.snackBar.open('Measurement deleted', undefined, { duration: 2500 });
    } catch {
      if (!this.isCurrentManualAccount(requestedForUserID, generation)) return;
      this.haptics.error();
      this.snackBar.open('Measurement changed or could not be deleted. Refresh and try again.', 'Dismiss', {
        duration: 5000,
      });
    } finally {
      if (this.isCurrentManualAccount(requestedForUserID, generation)) this.manualMutationBusy.set(false);
    }
  }

  private revealManualMeasurement(metricId: ManualHealthMetricId, value: ManualHealthMeasurementDialogValue): void {
    const metricIdsAdded: HealthMetricId[] = metricId === HEALTH_METRIC_IDS.BloodPressureSystolic
      ? [metricId, HEALTH_METRIC_IDS.BloodPressureDiastolic, ...(value.pulseValue !== undefined ? [HEALTH_METRIC_IDS.PulseRate] : [])]
      : [metricId];
    this.availableHealthMetricIds.update(metricIds => metricIds
      ? [...new Set([...metricIds, ...metricIdsAdded])]
      : metricIds);
    const date = new Date(value.observedAtMs + value.timezoneOffsetSeconds * 1_000).toISOString().slice(0, 10);
    const window = this.selectedWindow();
    // The saved instant is server-validated, but its original offset can put
    // its indexed calendar date ahead of the viewer's current local date.
    if (date < window.startDate || date > window.endDate) this.selectedEndDate.set(date);
    this.selectedProviders.set([]);
    this.selectAndSaveMetric(metricId);
    this.refreshRevision.update(current => current + 1);
  }

  private async refreshAvailableHealthMetrics(): Promise<void> {
    const uid = this.signedInUserID();
    if (!uid) return;
    const generation = ++this.metricAvailabilityGeneration;
    try {
      const metricIds = await this.healthService.loadAvailableMetricIds(uid);
      if (generation === this.metricAvailabilityGeneration) {
        // Keep the existing workout-only entry points after deletion as well as
        // initial discovery; manual entry no longer provides a catalog exception.
        this.availableHealthMetricIds.set([...new Set([...metricIds, ...ACTIVITY_HEALTH_METRIC_IDS])]);
      }
    } catch {
      // Preserve the current catalog after a successful deletion; the range
      // reload is authoritative for the selected metric.
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
      ...(this.highlightPreferencesTouched.size ? {
        highlightSources: Object.fromEntries([...this.highlightPreferencesTouched]
          .map(id => [id, this.preferredHighlightSources()[id]])),
      } : {}),
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
          ...(write.highlightSources ? { highlightSources: write.highlightSources } : {}),
        });
      } catch {
        if (
          write.generation === this.preferenceWriteGeneration
          && write.uid === this.workspacePreferenceUserID
          && this.queuedPreferenceWrite === null
        ) {
          this.preferencesSaveFailed.set(true);
          this.haptics.error();
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

function mergeHealthSeriesPoints(
  left: readonly HealthWorkspaceSeries['points'][number][],
  right: readonly HealthWorkspaceSeries['points'][number][],
): HealthWorkspaceSeries['points'] {
  const points = new Map<string, HealthWorkspaceSeries['points'][number]>();
  for (const point of [...left, ...right]) {
    points.set(`${point.timestampMs}:${point.calendarDate}`, point);
  }
  return [...points.values()].sort((a, b) => a.timestampMs - b.timestampMs);
}

function sleepOnlyHrvContextResult(
  visibleResult: HealthRangeResult,
  contextWindow: { startDate: string; endDate: string },
): HealthRangeResult {
  return {
    ...visibleResult,
    query: {
      ...visibleResult.query,
      ...contextWindow,
      includeSamples: false,
    },
    observations: [],
    sampleChunks: [],
    dailySummaries: [],
    discovery: [],
    coverage: [],
    freshness: [],
    conflicts: [],
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
  chartSeries: readonly HealthWorkspaceSeries[],
  status: HealthLoadStatus,
  emptyText: string,
  available: boolean,
  chartWindow?: HealthPriorityChartWindow,
  chartStatuses?: HealthPriorityCardView['chartStatuses'],
): HealthPriorityCardView {
  return {
    id,
    label,
    icon,
    metric,
    rows,
    chartSeries,
    chartWindow,
    chartStatuses,
    available,
    loading: status === 'loading',
    error: status === 'error' || status === 'denied',
    emptyText,
  };
}

function syncStateView(
  state: HealthSyncState,
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
  };
  const withStatus = (statusLabel: string, tone: HealthSyncTone): HealthSyncStateView => ({
    ...baseView,
    statusLabel,
    statusTooltip: healthSyncStatusTooltip(statusLabel, tone),
    tone,
  });
  switch (state.status) {
    case HEALTH_SYNC_STATUSES.Ready: {
      const recency = healthSyncRecency(lastUpdateAtMs, nowMs);
      return withStatus(recency.statusLabel, recency.tone);
    }
    case HEALTH_SYNC_STATUSES.PermissionMissing:
      return withStatus('Permission needed', 'error');
    case HEALTH_SYNC_STATUSES.ReconnectRequired:
      return withStatus('Reconnect required', 'error');
    case HEALTH_SYNC_STATUSES.Failed:
      return withStatus('Sync failed', 'error');
    case HEALTH_SYNC_STATUSES.Unsupported:
      return withStatus('Not supported', 'neutral');
    case HEALTH_SYNC_STATUSES.Disconnected:
      return withStatus('Disconnected', 'neutral');
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

function healthSyncStatusTooltip(statusLabel: string, tone: HealthSyncTone): string {
  switch (tone) {
    case 'current':
      return 'Current: the latest source update arrived within the last 36 hours.';
    case 'delayed':
      return 'Delayed: the latest source update is between 36 hours and 7 days old.';
    case 'stale':
      return 'Stale: no source update has arrived for more than 7 days.';
    case 'error':
      return `${statusLabel}: this source needs attention in Connectivity.`;
    case 'neutral':
      switch (statusLabel) {
        case 'Waiting':
          return 'Waiting: no Health update has arrived yet.';
        case 'Not supported':
          return 'Not supported: this provider does not supply Health data.';
        case 'Disconnected':
          return 'Disconnected: this provider is not connected.';
        default:
          return `${statusLabel}: no recent Health update is available.`;
      }
  }
}

function loadErrorStatus(error: unknown): HealthLoadStatus {
  const code = `${(error as { code?: unknown } | null)?.code || ''}`.toLowerCase();
  return code.includes('permission-denied') || code.includes('permission_denied') ? 'denied' : 'error';
}

function syncStateAdvanced(current: HealthSyncState, previous: HealthSyncState | undefined): boolean {
  return !previous || HEALTH_SYNC_REFRESH_FIELDS.some(field =>
    Number(current[field] || 0) > Number(previous[field] || 0));
}
