import { inject, Injectable } from '@angular/core';
import { catchError, combineLatest, defer, from, fromEvent, map, of, takeUntil, throwError, type Observable } from 'rxjs';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';
import { projectLoadedHealthRange } from '@shared/health-query';
import { HealthMetricQueryService } from './health-metric-query.service';
import { DashboardDerivedMetricsService } from './dashboard-derived-metrics.service';
import { buildHealthMetricWorkspaceView, type HealthWorkspaceSeries, type HealthWorkspaceSleepSession } from '../helpers/health-workspace.helper';
import type { CalendarDayHealthEvidence } from '../helpers/calendar-day-health.helper';
import { buildDashboardReadinessSleepQueryWindow } from '../helpers/dashboard-training-insights.helper';

@Injectable({ providedIn: 'root' })
export class CalendarDayHealthService {
  private readonly queries = inject(HealthMetricQueryService);
  private readonly derived = inject(DashboardDerivedMetricsService);

  watch(uid: string, dateKey: string, nowMs: number, signal: AbortSignal): Observable<CalendarDayHealthEvidence> {
    if (!this.queries.isOwner(uid)) return throwError(() => new Error('Calendar health data is owner-only.'));
    const date = new Date(`${dateKey}T00:00:00`);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(dateKey.slice(0, 4))
      || date.getMonth() + 1 !== Number(dateKey.slice(5, 7)) || date.getDate() !== Number(dateKey.slice(8, 10))) {
      return throwError(() => new Error('Invalid calendar date.'));
    }
    const today = new Date(nowMs);
    const isToday = date.toDateString() === today.toDateString();
    const todaySleepWindow = buildDashboardReadinessSleepQueryWindow(nowMs);
    const sleepStart = isToday ? todaySleepWindow.startMs
      : new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime();
    const sleepEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const derivedKinds = isToday
      ? [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.RampRate, DERIVED_METRIC_KINDS.RecoveryNow]
      : [DERIVED_METRIC_KINDS.TrainingReadiness];
    const health$ = defer(() => from(Promise.allSettled([
      this.queries.loadSleepRange(uid, sleepStart, isToday ? todaySleepWindow.endMs : sleepEnd, 30, signal),
      this.queries.loadMetricRange(uid, {
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        startDate: dateKey, endDate: dateKey, includeSamples: true,
      }, 30, signal),
    ]))).pipe(map(([sleepResult, hrvResult]) => {
      const sessions: HealthWorkspaceSleepSession[] = sleepResult.status === 'fulfilled' ? sleepResult.value : [];
      let hrvSeries: HealthWorkspaceSeries[] = [];
      if (hrvResult.status === 'fulfilled') {
        hrvSeries = buildHealthMetricWorkspaceView(hrvResult.value.result, sessions).series;
      } else if (sessions.length) {
        // A Health read failure should not discard HRV recorded in an available Sleep session.
        const sleepOnly = projectLoadedHealthRange([], [], {
          startDate: dateKey, endDate: dateKey, metricIds: [HEALTH_METRIC_IDS.HeartRateVariability],
        }, { sourceRecordsComplete: true, samplesComplete: true }, nowMs);
        hrvSeries = buildHealthMetricWorkspaceView(sleepOnly, sessions).series;
      }
      return {
        sessions, hrvSeries,
        sleepError: sleepResult.status === 'rejected',
        hrvError: hrvResult.status === 'rejected',
      };
    }));
    const derived$ = defer(() => this.derived.watch({ uid }, { metricKinds: derivedKinds, reportReadErrors: true })).pipe(
      map(derived => ({ derived, readFailed: false })),
      catchError(() => of({ derived: null, readFailed: true })),
    );
    return combineLatest([health$, derived$]).pipe(
      takeUntil(fromEvent(signal, 'abort')),
      map(([health, { derived, readFailed }]) => {
        if (signal.aborted || !this.queries.isOwner(uid)) throw new Error('Calendar health read cancelled.');
        return {
          ...health, derived,
          readinessError: readFailed || (isToday
            ? derived?.formStatus === 'failed' || derived?.formNowStatus === 'failed' || derived?.rampRateStatus === 'failed'
            : derived?.trainingReadinessStatus === 'failed'),
          recoveryError: readFailed || (isToday && derived?.recoveryNowStatus === 'failed'),
        };
      }),
    );
  }
}
