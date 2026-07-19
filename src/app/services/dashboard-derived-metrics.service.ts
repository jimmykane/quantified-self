import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { combineLatest, from, Observable, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import type { DashboardFormPoint } from '../helpers/dashboard-form.helper';
import { buildDashboardFormPointsFromDailyLoads } from '../helpers/dashboard-form.helper';
import type {
  DashboardAcwrContext,
  DashboardEasyPercentContext,
  DashboardEfficiencyDelta4wContext,
  DashboardEfficiencyTrendContext,
  DashboardFreshnessForecastContext,
  DashboardFormNowContext,
  DashboardFormPlus7dContext,
  DashboardHardPercentContext,
  DashboardIntensityDistributionContext,
  DashboardMonotonyStrainContext,
  DashboardRampRateContext,
  DashboardTrainingSummaryContext,
  DashboardTrainingBuildComparisonContext,
  DashboardTrainingCapacityContext,
  DashboardTrainingSwimPerformanceContext,
} from '../helpers/dashboard-derived-metrics.helper';
import {
  resolveDashboardAcwrContext,
  resolveDashboardEasyPercentContext,
  resolveDashboardEfficiencyDelta4wContext,
  resolveDashboardEfficiencyTrendContext,
  resolveDashboardFreshnessForecastContext,
  resolveDashboardFormNowContext,
  resolveDashboardFormPlus7dContext,
  resolveDashboardHardPercentContext,
  resolveDashboardIntensityDistributionContext,
  resolveDashboardMonotonyStrainContext,
  resolveDashboardRampRateContext,
  resolveDashboardTrainingSummaryContext,
  resolveDashboardTrainingBuildComparisonContext,
  resolveDashboardTrainingCapacityContext,
  resolveDashboardTrainingSwimPerformanceContext,
} from '../helpers/dashboard-derived-metrics.helper';
import type { DashboardRecoveryNowContext } from '../helpers/dashboard-recovery-now.helper';
import { resolveDashboardPowerCurveMetricPayload } from '../helpers/dashboard-power-curve.helper';
import {
  resolveTrainingDurabilityMetricPayload,
  resolveTrainingExplanationMetricPayload,
  resolveTrainingReadinessMetricPayload,
} from '../helpers/training-derived-metrics.helper';
import type { DashboardDerivedMetricStatus } from '../helpers/derived-metric-status.helper';
import { AppFunctionsService } from './app.functions.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_METRICS_COLLECTION_ID,
  CALENDAR_SENSITIVE_DERIVED_METRIC_KINDS,
  getDerivedMetricDocId,
  type DerivedMetricKind,
  type DerivedPowerCurveMetricPayload,
  type DerivedTrainingDurabilityMetricPayload,
  type DerivedTrainingExplanationMetricPayload,
  type DerivedTrainingReadinessMetricPayload,
  type EnsureDerivedMetricsRequest,
  type EnsureDerivedMetricsResponse,
} from '@shared/derived-metrics';

export interface DashboardDerivedMetricsState {
  formPoints: DashboardFormPoint[] | null;
  recoveryNow: DashboardRecoveryNowContext | null;
  acwr: DashboardAcwrContext | null;
  rampRate: DashboardRampRateContext | null;
  monotonyStrain: DashboardMonotonyStrainContext | null;
  formNow: DashboardFormNowContext | null;
  formPlus7d: DashboardFormPlus7dContext | null;
  easyPercent: DashboardEasyPercentContext | null;
  hardPercent: DashboardHardPercentContext | null;
  efficiencyDelta4w: DashboardEfficiencyDelta4wContext | null;
  freshnessForecast: DashboardFreshnessForecastContext | null;
  intensityDistribution: DashboardIntensityDistributionContext | null;
  efficiencyTrend: DashboardEfficiencyTrendContext | null;
  trainingSummary: DashboardTrainingSummaryContext | null;
  trainingBuildComparison: DashboardTrainingBuildComparisonContext | null;
  trainingCapacity: DashboardTrainingCapacityContext | null;
  trainingExplanation: DerivedTrainingExplanationMetricPayload | null;
  trainingDurability: DerivedTrainingDurabilityMetricPayload | null;
  trainingReadiness: DerivedTrainingReadinessMetricPayload | null;
  powerCurve: DerivedPowerCurveMetricPayload | null;
  trainingSwimPerformance: DashboardTrainingSwimPerformanceContext | null;
  formStatus: DashboardDerivedMetricStatus;
  recoveryNowStatus: DashboardDerivedMetricStatus;
  acwrStatus: DashboardDerivedMetricStatus;
  rampRateStatus: DashboardDerivedMetricStatus;
  monotonyStrainStatus: DashboardDerivedMetricStatus;
  formNowStatus: DashboardDerivedMetricStatus;
  formPlus7dStatus: DashboardDerivedMetricStatus;
  easyPercentStatus: DashboardDerivedMetricStatus;
  hardPercentStatus: DashboardDerivedMetricStatus;
  efficiencyDelta4wStatus: DashboardDerivedMetricStatus;
  freshnessForecastStatus: DashboardDerivedMetricStatus;
  intensityDistributionStatus: DashboardDerivedMetricStatus;
  efficiencyTrendStatus: DashboardDerivedMetricStatus;
  trainingSummaryStatus: DashboardDerivedMetricStatus;
  trainingBuildComparisonStatus: DashboardDerivedMetricStatus;
  trainingCapacityStatus: DashboardDerivedMetricStatus;
  trainingExplanationStatus: DashboardDerivedMetricStatus;
  trainingDurabilityStatus: DashboardDerivedMetricStatus;
  trainingReadinessStatus: DashboardDerivedMetricStatus;
  powerCurveStatus: DashboardDerivedMetricStatus;
  trainingSwimPerformanceStatus: DashboardDerivedMetricStatus;
}

export function createDashboardDerivedMetricsMissingState(): DashboardDerivedMetricsState {
  return {
    formPoints: null,
    recoveryNow: null,
    acwr: null,
    rampRate: null,
    monotonyStrain: null,
    formNow: null,
    formPlus7d: null,
    easyPercent: null,
    hardPercent: null,
    efficiencyDelta4w: null,
    freshnessForecast: null,
    intensityDistribution: null,
    efficiencyTrend: null,
    trainingSummary: null,
    trainingBuildComparison: null,
    trainingCapacity: null,
    trainingExplanation: null,
    trainingDurability: null,
    trainingReadiness: null,
    powerCurve: null,
    trainingSwimPerformance: null,
    formStatus: 'missing',
    recoveryNowStatus: 'missing',
    acwrStatus: 'missing',
    rampRateStatus: 'missing',
    monotonyStrainStatus: 'missing',
    formNowStatus: 'missing',
    formPlus7dStatus: 'missing',
    easyPercentStatus: 'missing',
    hardPercentStatus: 'missing',
    efficiencyDelta4wStatus: 'missing',
    freshnessForecastStatus: 'missing',
    intensityDistributionStatus: 'missing',
    efficiencyTrendStatus: 'missing',
    trainingSummaryStatus: 'missing',
    trainingBuildComparisonStatus: 'missing',
    trainingCapacityStatus: 'missing',
    trainingExplanationStatus: 'missing',
    trainingDurabilityStatus: 'missing',
    trainingReadinessStatus: 'missing',
    powerCurveStatus: 'missing',
    trainingSwimPerformanceStatus: 'missing',
  };
}

type UserUIDCarrier = { uid?: string | null } | null | undefined;
type SnapshotRecord = Record<string, unknown> | undefined;

type DerivedMetricStateContextKey =
  | 'formPoints'
  | 'recoveryNow'
  | 'acwr'
  | 'rampRate'
  | 'monotonyStrain'
  | 'formNow'
  | 'formPlus7d'
  | 'easyPercent'
  | 'hardPercent'
  | 'efficiencyDelta4w'
  | 'freshnessForecast'
  | 'intensityDistribution'
  | 'efficiencyTrend'
  | 'trainingSummary'
  | 'trainingBuildComparison'
  | 'trainingCapacity'
  | 'trainingExplanation'
  | 'trainingDurability'
  | 'trainingReadiness'
  | 'powerCurve'
  | 'trainingSwimPerformance';

type DerivedMetricStateStatusKey =
  | 'formStatus'
  | 'recoveryNowStatus'
  | 'acwrStatus'
  | 'rampRateStatus'
  | 'monotonyStrainStatus'
  | 'formNowStatus'
  | 'formPlus7dStatus'
  | 'easyPercentStatus'
  | 'hardPercentStatus'
  | 'efficiencyDelta4wStatus'
  | 'freshnessForecastStatus'
  | 'intensityDistributionStatus'
  | 'efficiencyTrendStatus'
  | 'trainingSummaryStatus'
  | 'trainingBuildComparisonStatus'
  | 'trainingCapacityStatus'
  | 'trainingExplanationStatus'
  | 'trainingDurabilityStatus'
  | 'trainingReadinessStatus'
  | 'powerCurveStatus'
  | 'trainingSwimPerformanceStatus';

interface DerivedMetricStateDescriptor {
  kind: DerivedMetricKind;
  contextKey: DerivedMetricStateContextKey;
  statusKey: DerivedMetricStateStatusKey;
  resolveContext: (snapshot: SnapshotRecord) => DashboardDerivedMetricsState[DerivedMetricStateContextKey];
}

const ALL_DERIVED_METRIC_KINDS = Object.values(DERIVED_METRIC_KINDS) as DerivedMetricKind[];

// These are curated Training-only insights. Keep them out of the dashboard's
// subscriptions and freshness probes so opening a dashboard neither creates a
// hidden dependency nor queues an otherwise unnecessary rebuild.
const DASHBOARD_DERIVED_METRIC_KINDS = ALL_DERIVED_METRIC_KINDS.filter(
  kind => kind !== DERIVED_METRIC_KINDS.TrainingBuildComparison
    && kind !== DERIVED_METRIC_KINDS.TrainingCapacity
    && kind !== DERIVED_METRIC_KINDS.TrainingExplanation
    && kind !== DERIVED_METRIC_KINDS.TrainingDurability
    && kind !== DERIVED_METRIC_KINDS.TrainingReadiness
    && kind !== DERIVED_METRIC_KINDS.TrainingSwimPerformance,
);

export function getDefaultDashboardDerivedMetricKinds(): DerivedMetricKind[] {
  return [...DASHBOARD_DERIVED_METRIC_KINDS];
}

export const TRAINING_WORKSPACE_DERIVED_METRIC_KINDS = [...ALL_DERIVED_METRIC_KINDS];

export interface DashboardDerivedMetricsScopeOptions {
  metricKinds?: readonly DerivedMetricKind[];
}

@Injectable({
  providedIn: 'root',
})
export class DashboardDerivedMetricsService {
  private static readonly ENSURE_COOLDOWN_MS = 30 * 1000;
  private static readonly HEALTHY_PROBE_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly ENSURE_FAILURE_NOTIFICATION_THRESHOLD = 2;
  private static readonly ENSURE_FAILURE_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly STUCK_STALE_THRESHOLD_MS = 10 * 60 * 1000;
  private static readonly STUCK_BUILDING_THRESHOLD_MS = 15 * 60 * 1000;

  private firestore = inject(Firestore);
  private functionsService = inject(AppFunctionsService);
  private snackBar = inject(MatSnackBar);
  private ensureInFlightByScopeKey = new Set<string>();
  private ensureLastRequestedAtByScopeKey = new Map<string, number>();
  private ensureFailureCountByScopeKey = new Map<string, number>();
  private ensureLastFailureNotifiedAtByScopeKey = new Map<string, number>();
  // Frontend derived-metric registry:
  // each metric kind is wired once for status + context parsing.
  private readonly metricDescriptorByKind: Record<
    DerivedMetricKind,
    Omit<DerivedMetricStateDescriptor, 'kind'>
  > = {
      [DERIVED_METRIC_KINDS.Form]: {
        contextKey: 'formPoints',
        statusKey: 'formStatus',
        resolveContext: (snapshot) => this.resolveFormPoints(snapshot),
      },
      [DERIVED_METRIC_KINDS.RecoveryNow]: {
        contextKey: 'recoveryNow',
        statusKey: 'recoveryNowStatus',
        resolveContext: (snapshot) => this.resolveRecoveryNowContext(snapshot),
      },
      [DERIVED_METRIC_KINDS.Acwr]: {
        contextKey: 'acwr',
        statusKey: 'acwrStatus',
        resolveContext: (snapshot) => resolveDashboardAcwrContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.RampRate]: {
        contextKey: 'rampRate',
        statusKey: 'rampRateStatus',
        resolveContext: (snapshot) => resolveDashboardRampRateContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.MonotonyStrain]: {
        contextKey: 'monotonyStrain',
        statusKey: 'monotonyStrainStatus',
        resolveContext: (snapshot) => resolveDashboardMonotonyStrainContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.FormNow]: {
        contextKey: 'formNow',
        statusKey: 'formNowStatus',
        resolveContext: (snapshot) => resolveDashboardFormNowContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.FormPlus7d]: {
        contextKey: 'formPlus7d',
        statusKey: 'formPlus7dStatus',
        resolveContext: (snapshot) => resolveDashboardFormPlus7dContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.EasyPercent]: {
        contextKey: 'easyPercent',
        statusKey: 'easyPercentStatus',
        resolveContext: (snapshot) => resolveDashboardEasyPercentContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.HardPercent]: {
        contextKey: 'hardPercent',
        statusKey: 'hardPercentStatus',
        resolveContext: (snapshot) => resolveDashboardHardPercentContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.EfficiencyDelta4w]: {
        contextKey: 'efficiencyDelta4w',
        statusKey: 'efficiencyDelta4wStatus',
        resolveContext: (snapshot) => resolveDashboardEfficiencyDelta4wContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.FreshnessForecast]: {
        contextKey: 'freshnessForecast',
        statusKey: 'freshnessForecastStatus',
        resolveContext: (snapshot) => resolveDashboardFreshnessForecastContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.IntensityDistribution]: {
        contextKey: 'intensityDistribution',
        statusKey: 'intensityDistributionStatus',
        resolveContext: (snapshot) => resolveDashboardIntensityDistributionContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.EfficiencyTrend]: {
        contextKey: 'efficiencyTrend',
        statusKey: 'efficiencyTrendStatus',
        resolveContext: (snapshot) => resolveDashboardEfficiencyTrendContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingSummary]: {
        contextKey: 'trainingSummary',
        statusKey: 'trainingSummaryStatus',
        resolveContext: (snapshot) => resolveDashboardTrainingSummaryContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingBuildComparison]: {
        contextKey: 'trainingBuildComparison',
        statusKey: 'trainingBuildComparisonStatus',
        resolveContext: (snapshot) => resolveDashboardTrainingBuildComparisonContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingCapacity]: {
        contextKey: 'trainingCapacity',
        statusKey: 'trainingCapacityStatus',
        resolveContext: (snapshot) => resolveDashboardTrainingCapacityContext(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingExplanation]: {
        contextKey: 'trainingExplanation',
        statusKey: 'trainingExplanationStatus',
        resolveContext: (snapshot) => resolveTrainingExplanationMetricPayload(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingDurability]: {
        contextKey: 'trainingDurability',
        statusKey: 'trainingDurabilityStatus',
        resolveContext: (snapshot) => resolveTrainingDurabilityMetricPayload(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingReadiness]: {
        contextKey: 'trainingReadiness',
        statusKey: 'trainingReadinessStatus',
        resolveContext: (snapshot) => resolveTrainingReadinessMetricPayload(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.PowerCurve]: {
        contextKey: 'powerCurve',
        statusKey: 'powerCurveStatus',
        resolveContext: (snapshot) => resolveDashboardPowerCurveMetricPayload(this.resolveSnapshotPayload(snapshot)),
      },
      [DERIVED_METRIC_KINDS.TrainingSwimPerformance]: {
        contextKey: 'trainingSwimPerformance',
        statusKey: 'trainingSwimPerformanceStatus',
        resolveContext: (snapshot) => resolveDashboardTrainingSwimPerformanceContext(this.resolveSnapshotPayload(snapshot)),
      },
    };
  watch(
    user: UserUIDCarrier,
    options?: DashboardDerivedMetricsScopeOptions,
  ): Observable<DashboardDerivedMetricsState> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return of(createDashboardDerivedMetricsMissingState());
    }
    const metricDescriptors = this.resolveMetricDescriptors(options?.metricKinds);
    const snapshotStreams = metricDescriptors
      .map(descriptor => this.watchMetricSnapshot(uid, descriptor.kind));
    return combineLatest(snapshotStreams).pipe(
      map((snapshots) => {
        const nextState = createDashboardDerivedMetricsMissingState();
        const mutableState = nextState as unknown as Record<
          DerivedMetricStateStatusKey | DerivedMetricStateContextKey,
          unknown
        >;
        snapshots.forEach((snapshot, index) => {
          const descriptor = metricDescriptors[index];
          mutableState[descriptor.statusKey] = this.resolveSnapshotStatus(descriptor.kind, snapshot);
          mutableState[descriptor.contextKey] = descriptor.resolveContext(snapshot);
        });
        return nextState;
      }),
    );
  }

  ensureForDashboard(
    user: UserUIDCarrier,
    state: DashboardDerivedMetricsState,
    options?: { force?: boolean } & DashboardDerivedMetricsScopeOptions,
  ): void {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return;
    }

    const metricDescriptors = this.resolveMetricDescriptors(options?.metricKinds);
    const scopeMetricKinds = metricDescriptors.map(descriptor => descriptor.kind);
    const scopeKey = this.resolveEnsureScopeKey(uid, scopeMetricKinds);
    const staleOrMissingMetricKinds = metricDescriptors
      .filter((descriptor) => {
        const status = state[descriptor.statusKey];
        return status === 'missing' || status === 'failed' || status === 'stale';
      })
      .map(descriptor => descriptor.kind);
    // Even when tiles currently look "ready", always send a lightweight freshness probe.
    // Backend compares latest event shape/timestamps to derived snapshots and only requeues
    // when stale/failure conditions are detected.
    const requestedMetricKinds = staleOrMissingMetricKinds.length
      ? staleOrMissingMetricKinds
      : metricDescriptors.map(descriptor => descriptor.kind);
    const requestCooldownMs = staleOrMissingMetricKinds.length
      ? DashboardDerivedMetricsService.ENSURE_COOLDOWN_MS
      : DashboardDerivedMetricsService.HEALTHY_PROBE_COOLDOWN_MS;

    const nowMs = Date.now();
    const lastRequestedAtMs = this.ensureLastRequestedAtByScopeKey.get(scopeKey) || 0;
    const shouldRespectCooldown = options?.force !== true;
    if (
      this.ensureInFlightByScopeKey.has(scopeKey)
      || (
        shouldRespectCooldown
        && (nowMs - lastRequestedAtMs) < requestCooldownMs
      )
    ) {
      return;
    }

    this.ensureInFlightByScopeKey.add(scopeKey);
    this.ensureLastRequestedAtByScopeKey.set(scopeKey, nowMs);

    const request: EnsureDerivedMetricsRequest = {
      metricKinds: requestedMetricKinds,
    };

    from(this.functionsService.call<EnsureDerivedMetricsRequest, EnsureDerivedMetricsResponse>('ensureDerivedMetrics', request))
      .pipe(
        tap((response) => {
          if (response?.data?.accepted === false) {
            throw new Error('ensureDerivedMetrics request was not accepted');
          }
          this.resetEnsureFailureState(scopeKey);
        }),
        catchError((error) => {
          this.handleEnsureFailure(scopeKey, user, state, scopeMetricKinds, error);
          return of(null);
        }),
        finalize(() => {
          this.ensureInFlightByScopeKey.delete(scopeKey);
        }),
      )
      .subscribe();
  }

  private resolveMetricDescriptors(
    requestedMetricKinds: readonly DerivedMetricKind[] | undefined,
  ): readonly DerivedMetricStateDescriptor[] {
    const metricKinds = requestedMetricKinds?.length
      ? requestedMetricKinds
      : DASHBOARD_DERIVED_METRIC_KINDS;
    const seen = new Set<DerivedMetricKind>();
    return metricKinds.flatMap((kind) => {
      if (seen.has(kind)) {
        return [];
      }
      const descriptor = this.metricDescriptorByKind[kind];
      if (!descriptor) {
        return [];
      }
      seen.add(kind);
      return [{ kind, ...descriptor }];
    });
  }

  private resolveEnsureScopeKey(uid: string, metricKinds: readonly DerivedMetricKind[]): string {
    return `${uid}:${[...metricKinds].sort().join(',')}`;
  }

  private watchMetricSnapshot(uid: string, metricKind: DerivedMetricKind): Observable<SnapshotRecord> {
    const metricDocRef = doc(
      this.firestore,
      'users',
      uid,
      DERIVED_METRICS_COLLECTION_ID,
      getDerivedMetricDocId(metricKind),
    );
    return (docData(metricDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
      catchError(() => of(undefined)),
    );
  }

  private resolveSnapshotStatus(
    metricKind: DerivedMetricKind,
    snapshot: Record<string, unknown> | undefined,
  ): DashboardDerivedMetricStatus {
    const status = `${snapshot?.status || ''}` as DashboardDerivedMetricStatus;
    if (
      status !== 'ready'
      && status !== 'building'
      && status !== 'failed'
      && status !== 'stale'
      && status !== 'queued'
      && status !== 'processing'
    ) {
      return 'missing';
    }

    const schemaVersion = this.toFiniteNumber(snapshot?.schemaVersion);
    const updatedAtMs = this.toFiniteNumber(snapshot?.updatedAtMs);
    // Self-heal old snapshot documents by requeueing ensureDerivedMetrics when schema is behind.
    if (
      status === 'ready'
      && (
        schemaVersion === null
        || schemaVersion < DERIVED_METRIC_SCHEMA_VERSION
      )
    ) {
      return 'stale';
    }

    // A ready snapshot with an unsupported Power Curve payload must be rebuilt.
    // Otherwise the chart would silently present an empty state even though its
    // document claims to be healthy.
    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.PowerCurve
      && !resolveDashboardPowerCurveMetricPayload(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.TrainingBuildComparison
      && !resolveDashboardTrainingBuildComparisonContext(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.TrainingCapacity
      && !resolveDashboardTrainingCapacityContext(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.TrainingExplanation
      && !resolveTrainingExplanationMetricPayload(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.TrainingDurability
      && !resolveTrainingDurabilityMetricPayload(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.TrainingReadiness
      && !resolveTrainingReadinessMetricPayload(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (
      status === 'ready'
      && metricKind === DERIVED_METRIC_KINDS.TrainingSwimPerformance
      && !resolveDashboardTrainingSwimPerformanceContext(this.resolveSnapshotPayload(snapshot))
    ) {
      return 'stale';
    }

    if (this.isStuckPendingStatus(status, updatedAtMs)) {
      return 'failed';
    }

    if (
      status === 'ready'
      && this.isCalendarSensitiveMetricKind(metricKind)
    ) {
      const asOfDayMs = this.resolveSnapshotAsOfDayMs(snapshot);
      const todayUtcDayMs = this.resolveUtcDayStartMs(Date.now());
      if (!Number.isFinite(asOfDayMs) || (asOfDayMs as number) < todayUtcDayMs) {
        return 'stale';
      }
    }

    return status;
  }

  private isStuckPendingStatus(
    status: DashboardDerivedMetricStatus,
    updatedAtMs: number | null,
  ): boolean {
    if (!Number.isFinite(updatedAtMs)) {
      return false;
    }
    const ageMs = Date.now() - (updatedAtMs as number);
    if (status === 'stale') {
      return ageMs >= DashboardDerivedMetricsService.STUCK_STALE_THRESHOLD_MS;
    }
    if (status === 'building' || status === 'queued' || status === 'processing') {
      return ageMs >= DashboardDerivedMetricsService.STUCK_BUILDING_THRESHOLD_MS;
    }
    return false;
  }

  private resolveSnapshotPayload(snapshot: SnapshotRecord): unknown {
    const payload = snapshot?.payload;
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    return payload;
  }

  private resolveSnapshotAsOfDayMs(snapshot: SnapshotRecord): number | null {
    const payload = snapshot?.payload;
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    return this.toFiniteNumber((payload as Record<string, unknown>).asOfDayMs);
  }

  private resolveUtcDayStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  private isCalendarSensitiveMetricKind(metricKind: DerivedMetricKind): boolean {
    return CALENDAR_SENSITIVE_DERIVED_METRIC_KINDS.includes(metricKind);
  }

  private resolveFormPoints(snapshot: Record<string, unknown> | undefined): DashboardFormPoint[] | null {
    const payload = snapshot?.payload as { dailyLoads?: unknown } | undefined;
    const dailyLoads = Array.isArray(payload?.dailyLoads)
      ? payload?.dailyLoads
      : null;
    if (!dailyLoads) {
      return null;
    }
    return buildDashboardFormPointsFromDailyLoads(dailyLoads);
  }

  private resolveRecoveryNowContext(snapshot: Record<string, unknown> | undefined): DashboardRecoveryNowContext | null {
    const payload = snapshot?.payload as {
      totalSeconds?: unknown;
      endTimeMs?: unknown;
      segments?: unknown;
      latestWorkoutSeconds?: unknown;
      latestWorkoutEndTimeMs?: unknown;
      maxSupportedRecoverySeconds?: unknown;
    } | undefined;
    if (!payload) {
      return null;
    }

    const totalSeconds = this.toFiniteNonNegativeNumber(payload.totalSeconds);
    const endTimeMs = this.toFiniteNumber(payload.endTimeMs);
    if (totalSeconds === null || endTimeMs === null) {
      return null;
    }

    const segments = Array.isArray(payload.segments)
      ? payload.segments
        .map((segment) => {
          const segmentObject = (segment && typeof segment === 'object') ? segment as Record<string, unknown> : {};
          const segmentTotalSeconds = this.toFinitePositiveNumber(segmentObject.totalSeconds);
          const segmentEndTimeMs = this.toFiniteNumber(segmentObject.endTimeMs);
          if (segmentTotalSeconds === null || segmentEndTimeMs === null) {
            return null;
          }
          return {
            totalSeconds: segmentTotalSeconds,
            endTimeMs: segmentEndTimeMs,
          };
        })
        .filter((segment): segment is { totalSeconds: number; endTimeMs: number } => !!segment)
      : [];
    const latestWorkoutSeconds = this.toFinitePositiveNumber(payload.latestWorkoutSeconds);
    const latestWorkoutEndTimeMs = this.toFiniteNumber(payload.latestWorkoutEndTimeMs);
    const maxSupportedRecoverySeconds = this.toFinitePositiveNumber(payload.maxSupportedRecoverySeconds);

    return {
      totalSeconds,
      endTimeMs,
      ...(segments.length ? { segments } : {}),
      ...(latestWorkoutSeconds !== null ? { latestWorkoutSeconds } : {}),
      ...(latestWorkoutEndTimeMs !== null ? { latestWorkoutEndTimeMs } : {}),
      ...(maxSupportedRecoverySeconds !== null ? { maxSupportedRecoverySeconds } : {}),
    };
  }

  private toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  private toFinitePositiveNumber(value: unknown): number | null {
    const numericValue = this.toFiniteNumber(value);
    if (numericValue === null || numericValue <= 0) {
      return null;
    }
    return numericValue;
  }

  private toFiniteNonNegativeNumber(value: unknown): number | null {
    const numericValue = this.toFiniteNumber(value);
    if (numericValue === null || numericValue < 0) {
      return null;
    }
    return numericValue;
  }

  private resetEnsureFailureState(scopeKey: string): void {
    this.ensureFailureCountByScopeKey.delete(scopeKey);
    this.ensureLastFailureNotifiedAtByScopeKey.delete(scopeKey);
  }

  private handleEnsureFailure(
    scopeKey: string,
    user: UserUIDCarrier,
    state: DashboardDerivedMetricsState,
    scopeMetricKinds: readonly DerivedMetricKind[],
    _error: unknown,
  ): void {
    const nextFailureCount = (this.ensureFailureCountByScopeKey.get(scopeKey) || 0) + 1;
    this.ensureFailureCountByScopeKey.set(scopeKey, nextFailureCount);

    if (nextFailureCount < DashboardDerivedMetricsService.ENSURE_FAILURE_NOTIFICATION_THRESHOLD) {
      return;
    }

    const nowMs = Date.now();
    const lastNotifiedAtMs = this.ensureLastFailureNotifiedAtByScopeKey.get(scopeKey) || 0;
    if ((nowMs - lastNotifiedAtMs) < DashboardDerivedMetricsService.ENSURE_FAILURE_NOTIFICATION_COOLDOWN_MS) {
      return;
    }

    this.ensureLastFailureNotifiedAtByScopeKey.set(scopeKey, nowMs);
    const surfaceLabel = scopeMetricKinds.includes(DERIVED_METRIC_KINDS.TrainingBuildComparison)
      ? 'training insights'
      : 'dashboard derived metrics';
    const snackBarRef = this.snackBar.open(
      `Could not refresh ${surfaceLabel}. Showing last known values.`,
      'Retry',
      { duration: 7000 },
    );
    snackBarRef.onAction().subscribe(() => {
      this.ensureForDashboard(user, state, {
        force: true,
        metricKinds: scopeMetricKinds,
      });
    });
  }
}
