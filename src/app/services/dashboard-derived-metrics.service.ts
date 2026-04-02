import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { combineLatest, from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import type { DashboardFormPoint } from '../helpers/dashboard-form.helper';
import { buildDashboardFormPointsFromDailyLoads } from '../helpers/dashboard-form.helper';
import type { DashboardRecoveryNowContext } from '../helpers/dashboard-recovery-now.helper';
import { AppFunctionsService } from './app.functions.service';
import {
  DERIVED_METRIC_KINDS,
  getDerivedMetricDocId,
  type DerivedMetricSnapshotStatus,
  type EnsureDerivedMetricsRequest,
} from '@shared/derived-metrics';

export interface DashboardDerivedMetricsState {
  formPoints: DashboardFormPoint[] | null;
  recoveryNow: DashboardRecoveryNowContext | null;
  formStatus: DerivedMetricSnapshotStatus | 'missing';
  recoveryNowStatus: DerivedMetricSnapshotStatus | 'missing';
}

type UserUIDCarrier = { uid?: string | null } | null | undefined;

@Injectable({
  providedIn: 'root',
})
export class DashboardDerivedMetricsService {
  private static readonly ENSURE_COOLDOWN_MS = 30 * 1000;

  private firestore = inject(Firestore);
  private functionsService = inject(AppFunctionsService);
  private ensureInFlightByUID = new Set<string>();
  private ensureLastRequestedAtByUID = new Map<string, number>();

  watch(user: UserUIDCarrier): Observable<DashboardDerivedMetricsState> {
    const uid = `${user?.uid || ''}`.trim();
    if (!uid) {
      return of({
        formPoints: null,
        recoveryNow: null,
        formStatus: 'missing',
        recoveryNowStatus: 'missing',
      });
    }

    const formDocRef = doc(this.firestore, 'users', uid, 'meta', getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form));
    const recoveryDocRef = doc(this.firestore, 'users', uid, 'meta', getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow));

    return combineLatest([
      (docData(formDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
      (docData(recoveryDocRef) as Observable<Record<string, unknown> | undefined>).pipe(
        catchError(() => of(undefined)),
      ),
    ]).pipe(
      map(([formSnapshot, recoverySnapshot]) => ({
        formStatus: this.resolveSnapshotStatus(formSnapshot),
        recoveryNowStatus: this.resolveSnapshotStatus(recoverySnapshot),
        formPoints: this.resolveFormPoints(formSnapshot),
        recoveryNow: this.resolveRecoveryNowContext(recoverySnapshot),
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

    const shouldEnsureForm = state.formStatus === 'missing' || state.formStatus === 'failed' || state.formStatus === 'stale';
    const shouldEnsureRecovery = state.recoveryNowStatus === 'missing' || state.recoveryNowStatus === 'failed' || state.recoveryNowStatus === 'stale';
    if (!shouldEnsureForm && !shouldEnsureRecovery) {
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
      metricKinds: [
        ...(shouldEnsureForm ? [DERIVED_METRIC_KINDS.Form] : []),
        ...(shouldEnsureRecovery ? [DERIVED_METRIC_KINDS.RecoveryNow] : []),
      ],
    };

    from(this.functionsService.call<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', request))
      .pipe(
        catchError(() => of(null)),
      )
      .subscribe({
        complete: () => {
          this.ensureInFlightByUID.delete(uid);
        },
        error: () => {
          this.ensureInFlightByUID.delete(uid);
        },
      });
  }

  private resolveSnapshotStatus(snapshot: Record<string, unknown> | undefined): DerivedMetricSnapshotStatus | 'missing' {
    const status = `${snapshot?.status || ''}` as DerivedMetricSnapshotStatus;
    return status === 'ready' || status === 'building' || status === 'failed' || status === 'stale'
      ? status
      : 'missing';
  }

  private resolveFormPoints(snapshot: Record<string, unknown> | undefined): DashboardFormPoint[] | null {
    const payload = snapshot?.payload as { dailyLoads?: unknown } | undefined;
    const dailyLoads = Array.isArray(payload?.dailyLoads)
      ? payload?.dailyLoads as Array<[number, number]>
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
    } | undefined;
    if (!payload) {
      return null;
    }

    const totalSeconds = this.toFinitePositiveNumber(payload.totalSeconds);
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

    return {
      totalSeconds,
      endTimeMs,
      ...(segments.length ? { segments } : {}),
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
}
