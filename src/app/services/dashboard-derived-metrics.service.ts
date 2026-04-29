import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { combineLatest, from, Observable, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import type { DashboardFormPoint } from '../helpers/dashboard-form.helper';
import {
  buildDashboardFormPointsFromDailyLoads,
  extendDashboardFormPointsWithZeroLoadUntil,
  resolveDashboardFormLatestPoint,
} from '../helpers/dashboard-form.helper';
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
} from '../helpers/dashboard-derived-metrics.helper';
import type { DashboardRecoveryNowContext } from '../helpers/dashboard-recovery-now.helper';
import type { DashboardDerivedMetricStatus } from '../helpers/derived-metric-status.helper';
import { AppFunctionsService } from './app.functions.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_METRICS_COLLECTION_ID,
  getDerivedMetricDocId,
  type DerivedMetricKind,
  type DerivedMetricSnapshotStatus,
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
  | 'efficiencyTrend';

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
  | 'efficiencyTrendStatus';

interface DerivedMetricStateDescriptor {
  kind: DerivedMetricKind;
  contextKey: DerivedMetricStateContextKey;
  statusKey: DerivedMetricStateStatusKey;
  resolveContext: (snapshot: SnapshotRecord) => DashboardDerivedMetricsState[DerivedMetricStateContextKey];
}

const DASHBOARD_DERIVED_METRIC_KINDS = Object.values(DERIVED_METRIC_KINDS) as DerivedMetricKind[];

@Injectable({
  providedIn: 'root',
})
export class DashboardDerivedMetricsService {
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  private static readonly CTL_TIME_CONSTANT_DAYS = 42;
  private static readonly ATL_TIME_CONSTANT_DAYS = 7;
  private static readonly KPI_TREND_WEEKS = 8;
  private static readonly FORM_FORECAST_DAYS = 7;
  private static readonly ENSURE_COOLDOWN_MS = 30 * 1000;
  private static readonly HEALTHY_PROBE_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly ENSURE_FAILURE_NOTIFICATION_THRESHOLD = 2;
  private static readonly ENSURE_FAILURE_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;
  private static readonly STUCK_STALE_THRESHOLD_MS = 10 * 60 * 1000;
  private static readonly STUCK_BUILDING_THRESHOLD_MS = 15 * 60 * 1000;

  private firestore = inject(Firestore);
  private functionsService = inject(AppFunctionsService);
  private snackBar = inject(MatSnackBar);
  private ensureInFlightByUID = new Set<string>();
  private ensureLastRequestedAtByUID = new Map<string, number>();
  private ensureFailureCountByUID = new Map<string, number>();
  private ensureLastFailureNotifiedAtByUID = new Map<string, number>();
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
    };
  private readonly metricDescriptors: readonly DerivedMetricStateDescriptor[] = DASHBOARD_DERIVED_METRIC_KINDS
    .map((kind) => ({
      kind,
      ...this.metricDescriptorByKind[kind],
    }));

  private buildMissingState(): DashboardDerivedMetricsState {
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
    };
  }

  watch(user: UserUIDCarrier): Observable<DashboardDerivedMetricsState> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return of(this.buildMissingState());
    }
    const snapshotStreams = this.metricDescriptors
      .map(descriptor => this.watchMetricSnapshot(uid, descriptor.kind));
    return combineLatest(snapshotStreams).pipe(
      map((snapshots) => {
        const nextState = this.buildMissingState();
        const mutableState = nextState as unknown as Record<
          DerivedMetricStateStatusKey | DerivedMetricStateContextKey,
          unknown
        >;
        snapshots.forEach((snapshot, index) => {
          const descriptor = this.metricDescriptors[index];
          mutableState[descriptor.statusKey] = this.resolveSnapshotStatus(snapshot);
          mutableState[descriptor.contextKey] = descriptor.resolveContext(snapshot);
        });
        this.applyCanonicalFormDerivedContexts(nextState);
        return nextState;
      }),
    );
  }

  ensureForDashboard(
    user: UserUIDCarrier,
    state: DashboardDerivedMetricsState,
    options?: { force?: boolean },
  ): void {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return;
    }

    const staleOrMissingMetricKinds = this.metricDescriptors
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
      : [...DASHBOARD_DERIVED_METRIC_KINDS];
    const requestCooldownMs = staleOrMissingMetricKinds.length
      ? DashboardDerivedMetricsService.ENSURE_COOLDOWN_MS
      : DashboardDerivedMetricsService.HEALTHY_PROBE_COOLDOWN_MS;

    const nowMs = Date.now();
    const lastRequestedAtMs = this.ensureLastRequestedAtByUID.get(uid) || 0;
    const shouldRespectCooldown = options?.force !== true;
    if (
      this.ensureInFlightByUID.has(uid)
      || (
        shouldRespectCooldown
        && (nowMs - lastRequestedAtMs) < requestCooldownMs
      )
    ) {
      return;
    }

    this.ensureInFlightByUID.add(uid);
    this.ensureLastRequestedAtByUID.set(uid, nowMs);

    const request: EnsureDerivedMetricsRequest = {
      metricKinds: requestedMetricKinds,
    };

    from(this.functionsService.call<EnsureDerivedMetricsRequest, EnsureDerivedMetricsResponse>('ensureDerivedMetrics', request))
      .pipe(
        tap((response) => {
          if (response?.data?.accepted === false) {
            throw new Error('ensureDerivedMetrics request was not accepted');
          }
          this.resetEnsureFailureState(uid);
        }),
        catchError((error) => {
          this.handleEnsureFailure(uid, user, state, error);
          return of(null);
        }),
        finalize(() => {
          this.ensureInFlightByUID.delete(uid);
        }),
      )
      .subscribe();
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

  private resolveSnapshotStatus(snapshot: Record<string, unknown> | undefined): DashboardDerivedMetricStatus {
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

    if (this.isStuckPendingStatus(status, updatedAtMs)) {
      return 'failed';
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

  private applyCanonicalFormDerivedContexts(state: DashboardDerivedMetricsState): void {
    const formPoints = Array.isArray(state.formPoints) ? state.formPoints : [];
    if (!formPoints.length) {
      return;
    }

    const pointsUntilToday = extendDashboardFormPointsWithZeroLoadUntil(formPoints, Date.now());
    if (!pointsUntilToday.length) {
      return;
    }

    state.formNow = this.buildFormNowContextFromPoints(pointsUntilToday);
    state.formPlus7d = this.buildFormPlus7dContextFromPoints(pointsUntilToday);
    state.freshnessForecast = this.buildFreshnessForecastContextFromPoints(pointsUntilToday);
  }

  private buildFormNowContextFromPoints(points: readonly DashboardFormPoint[]): DashboardFormNowContext | null {
    const latestPoint = resolveDashboardFormLatestPoint(points);
    if (!latestPoint) {
      return null;
    }
    return {
      latestDayMs: latestPoint.time,
      value: this.toRoundedNumber(latestPoint.formSameDay, 4),
      trend8Weeks: this.buildWeeklyTrendFromFormPoints(points, (point) => point.formSameDay),
    };
  }

  private buildFormPlus7dContextFromPoints(points: readonly DashboardFormPoint[]): DashboardFormPlus7dContext | null {
    const latestPoint = resolveDashboardFormLatestPoint(points);
    if (!latestPoint) {
      return null;
    }
    return {
      latestDayMs: latestPoint.time,
      projectedDayMs: latestPoint.time + (7 * DashboardDerivedMetricsService.DAY_MS),
      value: this.toRoundedNumber(
        this.projectSameDayFormWithZeroLoad(latestPoint.ctl, latestPoint.atl, 7),
        4,
      ),
      trend8Weeks: this.buildWeeklyTrendFromFormPoints(points, (point) => (
        this.projectSameDayFormWithZeroLoad(point.ctl, point.atl, 7)
      )),
    };
  }

  private buildFreshnessForecastContextFromPoints(points: readonly DashboardFormPoint[]): DashboardFreshnessForecastContext | null {
    const latestPoint = resolveDashboardFormLatestPoint(points);
    if (!latestPoint) {
      return null;
    }

    const forecastPoints: DashboardFreshnessForecastContext['points'] = [
      {
        dayMs: latestPoint.time,
        trainingStressScore: this.toRoundedNumber(latestPoint.trainingStressScore, 4) || 0,
        ctl: this.toRoundedNumber(latestPoint.ctl, 4),
        atl: this.toRoundedNumber(latestPoint.atl, 4),
        formSameDay: this.toRoundedNumber(latestPoint.formSameDay, 4),
        formPriorDay: latestPoint.formPriorDay === null
          ? null
          : this.toRoundedNumber(latestPoint.formPriorDay, 4),
        isForecast: false,
      },
    ];

    let previousCtl = latestPoint.ctl;
    let previousAtl = latestPoint.atl;
    for (let dayOffset = 1; dayOffset <= DashboardDerivedMetricsService.FORM_FORECAST_DAYS; dayOffset += 1) {
      const load = 0;
      const ctl = previousCtl + ((load - previousCtl) / DashboardDerivedMetricsService.CTL_TIME_CONSTANT_DAYS);
      const atl = previousAtl + ((load - previousAtl) / DashboardDerivedMetricsService.ATL_TIME_CONSTANT_DAYS);
      forecastPoints.push({
        dayMs: latestPoint.time + (dayOffset * DashboardDerivedMetricsService.DAY_MS),
        trainingStressScore: 0,
        ctl: this.toRoundedNumber(ctl, 4),
        atl: this.toRoundedNumber(atl, 4),
        formSameDay: this.toRoundedNumber(ctl - atl, 4),
        formPriorDay: this.toRoundedNumber(previousCtl - previousAtl, 4),
        isForecast: true,
      });
      previousCtl = ctl;
      previousAtl = atl;
    }

    return {
      generatedAtMs: Date.now(),
      points: forecastPoints,
    };
  }

  private buildWeeklyTrendFromFormPoints(
    points: readonly DashboardFormPoint[],
    valueSelector: (point: DashboardFormPoint) => number | null,
  ): DashboardFormNowContext['trend8Weeks'] {
    const trendByWeek = new Map<number, { time: number; value: number | null }>();
    points.forEach((point) => {
      const weekStartMs = this.resolveUtcWeekStartMs(point.time);
      const rawValue = valueSelector(point);
      trendByWeek.set(weekStartMs, {
        time: weekStartMs,
        value: Number.isFinite(rawValue as number)
          ? this.toRoundedNumber(rawValue as number, 4)
          : null,
      });
    });
    return [...trendByWeek.values()]
      .sort((left, right) => left.time - right.time)
      .slice(-DashboardDerivedMetricsService.KPI_TREND_WEEKS);
  }

  private resolveUtcWeekStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    const dayIndexMondayFirst = (date.getUTCDay() + 6) % 7;
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - dayIndexMondayFirst,
    );
  }

  private projectSameDayFormWithZeroLoad(
    ctl: number,
    atl: number,
    projectionDays: number,
  ): number {
    if (!Number.isFinite(ctl) || !Number.isFinite(atl) || projectionDays <= 0) {
      return Number.isFinite(ctl) && Number.isFinite(atl) ? (ctl - atl) : 0;
    }
    let previousCtl = ctl;
    let previousAtl = atl;
    let projectedSameDayForm = previousCtl - previousAtl;
    for (let dayOffset = 1; dayOffset <= projectionDays; dayOffset += 1) {
      const nextCtl = previousCtl + ((0 - previousCtl) / DashboardDerivedMetricsService.CTL_TIME_CONSTANT_DAYS);
      const nextAtl = previousAtl + ((0 - previousAtl) / DashboardDerivedMetricsService.ATL_TIME_CONSTANT_DAYS);
      projectedSameDayForm = nextCtl - nextAtl;
      previousCtl = nextCtl;
      previousAtl = nextAtl;
    }
    return projectedSameDayForm;
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

  private toRoundedNumber(value: number, precision = 4): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
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

  private resetEnsureFailureState(uid: string): void {
    this.ensureFailureCountByUID.delete(uid);
    this.ensureLastFailureNotifiedAtByUID.delete(uid);
  }

  private handleEnsureFailure(
    uid: string,
    user: UserUIDCarrier,
    state: DashboardDerivedMetricsState,
    _error: unknown,
  ): void {
    const nextFailureCount = (this.ensureFailureCountByUID.get(uid) || 0) + 1;
    this.ensureFailureCountByUID.set(uid, nextFailureCount);

    if (nextFailureCount < DashboardDerivedMetricsService.ENSURE_FAILURE_NOTIFICATION_THRESHOLD) {
      return;
    }

    const nowMs = Date.now();
    const lastNotifiedAtMs = this.ensureLastFailureNotifiedAtByUID.get(uid) || 0;
    if ((nowMs - lastNotifiedAtMs) < DashboardDerivedMetricsService.ENSURE_FAILURE_NOTIFICATION_COOLDOWN_MS) {
      return;
    }

    this.ensureLastFailureNotifiedAtByUID.set(uid, nowMs);
    const snackBarRef = this.snackBar.open(
      'Could not refresh dashboard derived metrics. Showing last known values.',
      'Retry',
      { duration: 7000 },
    );
    snackBarRef.onAction().subscribe(() => {
      this.ensureForDashboard(user, state, { force: true });
    });
  }
}
