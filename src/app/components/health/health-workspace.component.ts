import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AppThemes, ServiceNames } from '@sports-alliance/sports-lib';
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
import { SleepSession } from '@shared/sleep';
import { Subscription } from 'rxjs';
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
  normalizeHealthWorkspaceRange,
  providerLabel,
  resolveHealthWorkspaceWindow,
} from '../../helpers/health-workspace.helper';
import { buildDashboardSleepTrendContext } from '../../helpers/dashboard-sleep-chart.helper';

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
  message: string;
  actionRequired: boolean;
  error: boolean;
}

interface QueuedHealthRangeWrite {
  uid: string;
  range: HealthWorkspaceRange;
  generation: number;
}

const RANGE_LABELS: Record<HealthWorkspaceRange, string> = {
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
};

@Component({
  selector: 'app-health-workspace',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
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
  private readonly sleepService = inject(AppSleepService);
  private readonly themeService = inject(AppThemeService);
  private readonly todayDate = localCalendarDate();
  private selectedLoadGeneration = 0;
  private priorityLoadGeneration = 0;
  private latestSyncStateTimestamp: number | null = null;
  private rangePreferenceUserID: string | null = null;
  private rangePreferenceTouched = false;
  private rangeWriteGeneration = 0;
  private rangeWriteInFlight = false;
  private queuedRangeWrite: QueuedHealthRangeWrite | null = null;

  readonly ranges = HEALTH_WORKSPACE_RANGES.map(range => ({ range, label: RANGE_LABELS[range] }));
  readonly metricCatalogGroups: readonly HealthMetricCatalogGroup[] = buildHealthMetricCatalogGroups();
  readonly selectedMetric = signal<HealthWorkspaceMetricSelection>(HEALTH_METRIC_IDS.RestingHeartRate);
  readonly selectedRange = signal<HealthWorkspaceRange>(HEALTH_WORKSPACE_DEFAULT_RANGE);
  readonly selectedEndDate = signal(this.todayDate);
  readonly routeState = computed<HealthWorkspaceRouteState>(() => ({
    metric: this.selectedMetric(),
    range: this.selectedRange(),
    endDate: this.selectedEndDate(),
  }));
  readonly isSavingRange = signal(false);
  readonly rangeSaveFailed = signal(false);
  readonly selectedWindow = computed(() => resolveHealthWorkspaceWindow(this.routeState(), this.todayDate));
  readonly selectedHealthLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly selectedHealthStatus = signal<HealthLoadStatus>('loading');
  readonly selectedSleepSessions = signal<SleepSession[]>([]);
  readonly selectedSleepStatus = signal<HealthLoadStatus>('loading');
  readonly prioritySleepSessions = signal<SleepSession[]>([]);
  readonly prioritySleepStatus = signal<HealthLoadStatus>('loading');
  readonly priorityHeartRateLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly priorityHeartRateStatus = signal<HealthLoadStatus>('loading');
  readonly priorityHrvLoad = signal<HealthWorkspaceRangeLoad | null>(null);
  readonly priorityHrvStatus = signal<HealthLoadStatus>('loading');
  readonly syncStates = signal<HealthSyncState[]>([]);
  readonly selectedProviders = signal<HealthProvider[]>([]);
  readonly refreshRevision = signal(0);
  readonly isDarkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);

  readonly selectedMetricDefinition = computed(() => {
    const metric = this.routeState().metric;
    return metric === 'sleep' ? null : getHealthMetricDefinition(metric);
  });
  readonly detailTitle = computed(() => this.routeState().metric === 'sleep'
    ? 'Sleep'
    : this.selectedMetricDefinition()?.label || 'Resting heart rate');
  readonly detailSubtitle = computed(() => `${this.selectedWindow().label} · ${RANGE_LABELS[this.routeState().range]}`);
  readonly selectedIsSleep = computed(() => this.routeState().metric === 'sleep');
  readonly effectiveProviderFilters = computed(() => {
    const available = new Set(this.availableProviders());
    const selected = this.selectedProviders().filter(provider => available.has(provider));
    return selected.length ? selected : [];
  });
  readonly filteredSleepSessions = computed(() => {
    const selected = this.effectiveProviderFilters();
    return selected.length
      ? this.selectedSleepSessions().filter(session => selected.includes(session.source.provider as HealthProvider))
      : this.selectedSleepSessions();
  });
  readonly filteredHealthResult = computed(() => {
    const result = this.selectedHealthLoad()?.result;
    return result ? filterHealthRangeResultByProviders(result, this.effectiveProviderFilters()) : null;
  });
  readonly metricView = computed<HealthMetricWorkspaceView>(() => {
    const result = this.filteredHealthResult();
    return result ? buildHealthMetricWorkspaceView(result, this.filteredSleepSessions()) : emptyMetricView();
  });
  readonly sleepTrend = computed(() => buildDashboardSleepTrendContext(this.filteredSleepSessions(), {
    sleepWindow: {
      range: this.routeState().range,
      startMs: this.selectedWindow().startTimeMs,
      endMs: this.selectedWindow().endTimeMs,
    },
  }));
  readonly sleepRows = computed<HealthSleepObservationRow[]>(() => buildSleepObservationRows(this.filteredSleepSessions()));
  readonly availableProviders = computed<HealthProvider[]>(() => {
    const loadedResult = this.selectedHealthLoad()?.result;
    const providers = this.selectedIsSleep()
      ? this.selectedSleepSessions().map(session => session.source.provider as HealthProvider)
      : [
        ...(loadedResult?.observations.map(item => item.provider) || []),
        ...(loadedResult?.sampleChunks.map(item => item.provider) || []),
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
  readonly selectedStatus = computed(() => this.selectedIsSleep()
    ? this.selectedSleepStatus()
    : this.selectedHealthStatus());
  readonly isLoading = computed(() => this.selectedStatus() === 'loading');
  readonly isDenied = computed(() => this.selectedStatus() === 'denied');
  readonly hasLoadError = computed(() => this.selectedStatus() === 'error');
  readonly hasData = computed(() => this.selectedIsSleep()
    ? this.filteredSleepSessions().length > 0
    : this.metricView().series.length > 0);
  readonly isEmpty = computed(() => this.selectedStatus() === 'ready' && !this.hasData());
  readonly sampleOnlyLongRange = computed(() => !this.selectedIsSleep()
    && !this.selectedWindow().includeSamples
    && this.selectedHealthLoad()?.hasSampleBackedMetric === true
    && this.metricView().series.length === 0);
  readonly incompleteNotice = computed(() => {
    const loaded = this.selectedHealthLoad();
    if (!loaded?.limitReached) {
      return null;
    }
    const reason = {
      source_records: '2,048 source records',
      sample_chunks: '256 sample chunks',
      sample_points: '100,000 sample points',
      serialized_bytes: '16 MiB of serialized data',
    }[loaded.limitReached];
    return `Incomplete result: this load stopped at the ${reason} safety limit. Choose a shorter or older window to inspect the remaining data.`;
  });
  readonly revisionNotice = computed(() => {
    const count = this.selectedHealthLoad()?.result.pageInfo.sampleRevisionMismatchCount || 0;
    return count > 0
      ? `${count.toLocaleString()} superseded sample ${count === 1 ? 'chunk was' : 'chunks were'} excluded. The visible sample aggregate is incomplete.`
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
  readonly priorityCards = computed<HealthPriorityCardView[]>(() => [
    priorityCard(
      'sleep',
      'Sleep',
      'bedtime',
      'sleep',
      buildSleepPriorityRows(this.prioritySleepSessions()),
      this.prioritySleepStatus(),
      'No Sleep sessions in the last 30 days.',
    ),
    priorityCard(
      'heart_rate',
      'Heart rate',
      'favorite',
      HEALTH_METRIC_IDS.HeartRate,
      buildHealthPriorityRows(this.priorityHeartRateLoad()?.result, this.prioritySleepSessions()),
      this.priorityHeartRateStatus(),
      'No Heart rate summaries in the last 30 days.',
    ),
    priorityCard(
      'heart_rate_variability',
      'HRV',
      'ecg_heart',
      HEALTH_METRIC_IDS.HeartRateVariability,
      buildHealthPriorityRows(this.priorityHrvLoad()?.result, this.prioritySleepSessions()),
      this.priorityHrvStatus(),
      'No HRV summaries in the last 30 days.',
    ),
  ]);
  readonly syncStateViews = computed<HealthSyncStateView[]>(() => this.syncStates()
    .map(state => syncStateView(state))
    .sort((left, right) => left.label.localeCompare(right.label)));

  constructor() {
    effect(() => {
      const user = this.userService.user();
      const uid = `${user?.uid || ''}`.trim() || null;
      const savedRange = normalizeHealthWorkspaceRange(
        user?.settings?.appSettings?.healthWorkspace?.range,
      );
      if (uid === this.rangePreferenceUserID) {
        if (!this.rangePreferenceTouched) {
          this.selectedRange.set(savedRange);
        }
        return;
      }
      this.rangePreferenceUserID = uid;
      this.rangePreferenceTouched = false;
      this.rangeWriteGeneration += 1;
      this.queuedRangeWrite = null;
      this.isSavingRange.set(false);
      this.rangeSaveFailed.set(false);
      this.selectedMetric.set(HEALTH_METRIC_IDS.RestingHeartRate);
      this.selectedEndDate.set(this.todayDate);
      this.selectedRange.set(savedRange);
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
      if (!uid || metric === 'sleep') {
        this.selectedHealthStatus.set(metric === 'sleep' ? 'ready' : 'loading');
        return;
      }
      this.selectedHealthStatus.set('loading');
      void this.healthService.loadMetricRange(uid, {
        startDate: window.startDate,
        endDate: window.endDate,
        metricId: metric,
        includeSamples: window.includeSamples,
      }).then(result => {
        if (generation !== this.selectedLoadGeneration) {
          return;
        }
        this.selectedHealthLoad.set(result);
        this.selectedHealthStatus.set('ready');
      }).catch(error => {
        if (generation === this.selectedLoadGeneration) {
          this.selectedHealthStatus.set(loadErrorStatus(error));
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
      this.latestSyncStateTimestamp = null;
      if (uid) {
        subscription = this.healthService.watchSyncStates(uid).subscribe({
          next: states => {
            this.syncStates.set(states);
            const newest = Math.max(0, ...states.map(state => Number(state.updatedAtMs) || 0));
            if (this.latestSyncStateTimestamp !== null && newest > this.latestSyncStateTimestamp) {
              this.refreshRevision.update(value => value + 1);
            }
            this.latestSyncStateTimestamp = newest;
          },
        });
      }
      onCleanup(() => subscription?.unsubscribe());
    });
  }

  selectPriorityMetric(metric: HealthWorkspaceMetricSelection): void {
    this.selectedMetric.set(metric);
  }

  selectMetric(metric: HealthWorkspaceMetricSelection): void {
    this.selectedMetric.set(metric);
  }

  selectRange(range: HealthWorkspaceRange): void {
    const normalizedRange = normalizeHealthWorkspaceRange(range);
    if (normalizedRange === this.selectedRange() && !this.rangeSaveFailed()) {
      return;
    }
    this.rangePreferenceTouched = true;
    this.selectedRange.set(normalizedRange);
    this.queueRangePreferenceWrite(normalizedRange);
  }

  navigateWindow(direction: 'older' | 'newer'): void {
    if (direction === 'newer' && !this.selectedWindow().canNavigateNewer) {
      return;
    }
    this.selectedEndDate.set(
      navigateHealthWorkspaceWindow(this.routeState(), direction, this.todayDate).endDate,
    );
  }

  retryRangeSave(): void {
    this.rangePreferenceTouched = true;
    this.queueRangePreferenceWrite(this.selectedRange());
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
        includeSamples: false,
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

  private queueRangePreferenceWrite(range: HealthWorkspaceRange): void {
    const uid = `${this.userService.user()?.uid || ''}`.trim();
    this.rangeSaveFailed.set(false);
    if (!uid) {
      return;
    }
    this.queuedRangeWrite = {
      uid,
      range,
      generation: this.rangeWriteGeneration,
    };
    this.isSavingRange.set(true);
    void this.flushRangePreferenceWrites();
  }

  private async flushRangePreferenceWrites(): Promise<void> {
    if (this.rangeWriteInFlight) {
      return;
    }
    this.rangeWriteInFlight = true;
    while (this.queuedRangeWrite) {
      const write = this.queuedRangeWrite;
      this.queuedRangeWrite = null;
      if (write.generation !== this.rangeWriteGeneration || write.uid !== this.rangePreferenceUserID) {
        continue;
      }
      try {
        await this.userSettingsService.updateHealthWorkspaceRange(write.uid, write.range);
      } catch {
        if (
          write.generation === this.rangeWriteGeneration
          && write.uid === this.rangePreferenceUserID
          && this.queuedRangeWrite === null
        ) {
          this.rangeSaveFailed.set(true);
        }
      }
    }
    this.rangeWriteInFlight = false;
    this.isSavingRange.set(false);
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
): HealthPriorityCardView {
  return {
    id,
    label,
    icon,
    metric,
    rows: rows.map(row => ({ ...row, presentation: providerView(row.provider).presentation })),
    loading: status === 'loading',
    error: status === 'error' || status === 'denied',
    emptyText,
  };
}

function syncStateView(state: HealthSyncState): HealthSyncStateView {
  const provider = providerView(state.provider);
  const lastSyncMs = Number(state.lastSyncedAtMs || state.lastObservedAtMs || state.lastPollAtMs || state.lastWebhookAtMs);
  const lastSyncText = Number.isFinite(lastSyncMs) && lastSyncMs > 0
    ? `Last update ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(lastSyncMs))}.`
    : 'No completed Health update reported yet.';
  switch (state.status) {
    case HEALTH_SYNC_STATUSES.Ready:
      return { ...provider, statusLabel: 'Ready', message: lastSyncText, actionRequired: false, error: false };
    case HEALTH_SYNC_STATUSES.PermissionMissing:
      return { ...provider, statusLabel: 'Permission needed', message: 'Grant Health permissions in Connectivity, then reconnect if requested.', actionRequired: true, error: true };
    case HEALTH_SYNC_STATUSES.ReconnectRequired:
      return { ...provider, statusLabel: 'Reconnect required', message: 'Reconnect this service in Connectivity to resume Health sync.', actionRequired: true, error: true };
    case HEALTH_SYNC_STATUSES.Failed:
      return { ...provider, statusLabel: 'Sync failed', message: 'The latest Health sync failed. Review the connection in Connectivity.', actionRequired: true, error: true };
    case HEALTH_SYNC_STATUSES.Unsupported:
      return { ...provider, statusLabel: 'Not supported', message: 'This connected service does not currently provide Health metrics here.', actionRequired: false, error: false };
    case HEALTH_SYNC_STATUSES.Disconnected:
      return { ...provider, statusLabel: 'Disconnected', message: 'Connect this service in Connectivity to import supported Health data.', actionRequired: true, error: false };
  }
}

function loadErrorStatus(error: unknown): HealthLoadStatus {
  const code = `${(error as { code?: unknown } | null)?.code || ''}`.toLowerCase();
  return code.includes('permission-denied') || code.includes('permission_denied') ? 'denied' : 'error';
}
