import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { combineLatest, from, Observable, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import type { DashboardFormPoint } from '../helpers/dashboard-form.helper';
import { buildDashboardFormPointsFromDailyLoads } from '../helpers/dashboard-form.helper';
import type {
  DashboardAcwrContext,
  DashboardEfficiencyTrendContext,
  DashboardFreshnessForecastContext,
  DashboardIntensityDistributionContext,
  DashboardMonotonyStrainContext,
  DashboardRampRateContext,
} from '../helpers/dashboard-derived-metrics.helper';
import {
  resolveDashboardAcwrContext,
  resolveDashboardEfficiencyTrendContext,
  resolveDashboardFreshnessForecastContext,
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
  freshnessForecast: DashboardFreshnessForecastContext | null;
  intensityDistribution: DashboardIntensityDistributionContext | null;
  efficiencyTrend: DashboardEfficiencyTrendContext | null;
  formStatus: DashboardDerivedMetricStatus;
  recoveryNowStatus: DashboardDerivedMetricStatus;
  acwrStatus: DashboardDerivedMetricStatus;
  rampRateStatus: DashboardDerivedMetricStatus;
  monotonyStrainStatus: DashboardDerivedMetricStatus;
  freshnessForecastStatus: DashboardDerivedMetricStatus;
  intensityDistributionStatus: DashboardDerivedMetricStatus;
  efficiencyTrendStatus: DashboardDerivedMetricStatus;
}

type UserUIDCarrier = { uid?: string | null } | null | undefined;
type SnapshotRecord = Record<string, unknown> | undefined;
type DerivedEnsureCandidate = { kind: typeof DERIVED_METRIC_KINDS[keyof typeof DERIVED_METRIC_KINDS]; status: DashboardDerivedMetricStatus };

@Injectable({
  providedIn: 'root',
})
export class DashboardDerivedMetricsService {
  private static readonly ENSURE_COOLDOWN_MS = 30 * 1000;
  private static readonly ENSURE_FAILURE_NOTIFICATION_THRESHOLD = 2;
  private static readonly ENSURE_FAILURE_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;

  private firestore = inject(Firestore);
  private functionsService = inject(AppFunctionsService);
  private snackBar = inject(MatSnackBar);
  private ensureInFlightByUID = new Set<string>();
  private ensureLastRequestedAtByUID = new Map<string, number>();
  private ensureFailureCountByUID = new Map<string, number>();
  private ensureLastFailureNotifiedAtByUID = new Map<string, number>();

  watch(user: UserUIDCarrier): Observable<DashboardDerivedMetricsState> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return of({
        formPoints: null,
        recoveryNow: null,
        acwr: null,
        rampRate: null,
        monotonyStrain: null,
        freshnessForecast: null,
        intensityDistribution: null,
        efficiencyTrend: null,
        formStatus: 'missing',
        recoveryNowStatus: 'missing',
        acwrStatus: 'missing',
        rampRateStatus: 'missing',
        monotonyStrainStatus: 'missing',
        freshnessForecastStatus: 'missing',
        intensityDistributionStatus: 'missing',
        efficiencyTrendStatus: 'missing',
      });
    }

    const formDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form));
    const recoveryDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow));
    const acwrDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.Acwr));
    const rampRateDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.RampRate));
    const monotonyStrainDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.MonotonyStrain));
    const freshnessForecastDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.FreshnessForecast));
    const intensityDistributionDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.IntensityDistribution));
    const efficiencyTrendDocRef = doc(this.firestore, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.EfficiencyTrend));

    return combineLatest([
      (docData(formDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(recoveryDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(acwrDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(rampRateDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(monotonyStrainDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(freshnessForecastDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(intensityDistributionDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(efficiencyTrendDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
    ]).pipe(
      map(([
        formSnapshot,
        recoverySnapshot,
        acwrSnapshot,
        rampRateSnapshot,
        monotonyStrainSnapshot,
        freshnessForecastSnapshot,
        intensityDistributionSnapshot,
        efficiencyTrendSnapshot,
      ]) => ({
        formStatus: this.resolveSnapshotStatus(formSnapshot),
        recoveryNowStatus: this.resolveSnapshotStatus(recoverySnapshot),
        acwrStatus: this.resolveSnapshotStatus(acwrSnapshot),
        rampRateStatus: this.resolveSnapshotStatus(rampRateSnapshot),
        monotonyStrainStatus: this.resolveSnapshotStatus(monotonyStrainSnapshot),
        freshnessForecastStatus: this.resolveSnapshotStatus(freshnessForecastSnapshot),
        intensityDistributionStatus: this.resolveSnapshotStatus(intensityDistributionSnapshot),
        efficiencyTrendStatus: this.resolveSnapshotStatus(efficiencyTrendSnapshot),
        formPoints: this.resolveFormPoints(formSnapshot),
        recoveryNow: this.resolveRecoveryNowContext(recoverySnapshot),
        acwr: resolveDashboardAcwrContext(this.resolveSnapshotPayload(acwrSnapshot)),
        rampRate: resolveDashboardRampRateContext(this.resolveSnapshotPayload(rampRateSnapshot)),
        monotonyStrain: resolveDashboardMonotonyStrainContext(this.resolveSnapshotPayload(monotonyStrainSnapshot)),
        freshnessForecast: resolveDashboardFreshnessForecastContext(this.resolveSnapshotPayload(freshnessForecastSnapshot)),
        intensityDistribution: resolveDashboardIntensityDistributionContext(this.resolveSnapshotPayload(intensityDistributionSnapshot)),
        efficiencyTrend: resolveDashboardEfficiencyTrendContext(this.resolveSnapshotPayload(efficiencyTrendSnapshot)),
      })),
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

    const ensureCandidates: DerivedEnsureCandidate[] = [
      { kind: DERIVED_METRIC_KINDS.Form, status: state.formStatus },
      { kind: DERIVED_METRIC_KINDS.RecoveryNow, status: state.recoveryNowStatus },
      { kind: DERIVED_METRIC_KINDS.Acwr, status: state.acwrStatus },
      { kind: DERIVED_METRIC_KINDS.RampRate, status: state.rampRateStatus },
      { kind: DERIVED_METRIC_KINDS.MonotonyStrain, status: state.monotonyStrainStatus },
      { kind: DERIVED_METRIC_KINDS.FreshnessForecast, status: state.freshnessForecastStatus },
      { kind: DERIVED_METRIC_KINDS.IntensityDistribution, status: state.intensityDistributionStatus },
      { kind: DERIVED_METRIC_KINDS.EfficiencyTrend, status: state.efficiencyTrendStatus },
    ];
    const requestedMetricKinds = ensureCandidates
      .filter(candidate => candidate.status === 'missing' || candidate.status === 'failed' || candidate.status === 'stale')
      .map(candidate => candidate.kind);
    if (!requestedMetricKinds.length) {
      this.resetEnsureFailureState(uid);
      return;
    }

    const nowMs = Date.now();
    const lastRequestedAtMs = this.ensureLastRequestedAtByUID.get(uid) || 0;
    const shouldRespectCooldown = options?.force !== true;
    if (
      this.ensureInFlightByUID.has(uid)
      || (
        shouldRespectCooldown
        && (nowMs - lastRequestedAtMs) < DashboardDerivedMetricsService.ENSURE_COOLDOWN_MS
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

    return status;
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
