import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';
import { HealthMetricQueryService } from './health-metric-query.service';
import { DashboardDerivedMetricsService } from './dashboard-derived-metrics.service';
import { buildHealthMetricWorkspaceView, type HealthWorkspaceSeries, type HealthWorkspaceSleepSession } from '../helpers/health-workspace.helper';
import type { CalendarDayHealthEvidence } from '../helpers/calendar-day-health.helper';
import { buildDashboardReadinessSleepQueryWindow } from '../helpers/dashboard-training-insights.helper';

@Injectable({ providedIn: 'root' })
export class CalendarDayHealthService {
  private readonly queries = inject(HealthMetricQueryService);
  private readonly derived = inject(DashboardDerivedMetricsService);

  async load(uid: string, dateKey: string, nowMs: number, signal: AbortSignal): Promise<CalendarDayHealthEvidence> {
    if (!this.queries.isOwner(uid)) throw new Error('Calendar health data is owner-only.');
    const date = new Date(`${dateKey}T00:00:00`);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(dateKey.slice(0, 4))
      || date.getMonth() + 1 !== Number(dateKey.slice(5, 7)) || date.getDate() !== Number(dateKey.slice(8, 10))) {
      throw new Error('Invalid calendar date.');
    }
    const today = new Date(nowMs);
    const isToday = date.toDateString() === today.toDateString();
    const todaySleepWindow = buildDashboardReadinessSleepQueryWindow(nowMs);
    const sleepStart = isToday ? todaySleepWindow.startMs : date.getTime() - 86400000;
    const sleepEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const derivedKinds = isToday
      ? [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.RampRate, DERIVED_METRIC_KINDS.RecoveryNow]
      : [DERIVED_METRIC_KINDS.TrainingReadiness];
    const [sleepResult, hrvResult, derivedResult] = await Promise.allSettled([
      this.queries.loadSleepRange(uid, sleepStart, isToday ? todaySleepWindow.endMs : sleepEnd, 30, signal),
      this.queries.loadMetricRange(uid, {
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        startDate: dateKey, endDate: dateKey, includeSamples: false,
      }, 30, signal),
      firstValueFrom(this.derived.watch({ uid }, { metricKinds: derivedKinds }).pipe(
        takeUntil(fromEvent(signal, 'abort')),
      )),
    ]);
    if (signal.aborted || !this.queries.isOwner(uid)) throw new Error('Calendar health read cancelled.');
    const sessions: HealthWorkspaceSleepSession[] = sleepResult.status === 'fulfilled' ? sleepResult.value : [];
    let hrvSeries: HealthWorkspaceSeries[] = [];
    if (hrvResult.status === 'fulfilled') {
      hrvSeries = buildHealthMetricWorkspaceView(hrvResult.value.result, sessions).series;
    }
    return {
      sessions, hrvSeries,
      derived: derivedResult.status === 'fulfilled' ? derivedResult.value : null,
      sleepError: sleepResult.status === 'rejected',
      hrvError: hrvResult.status === 'rejected',
      derivedError: derivedResult.status === 'rejected',
    };
  }
}
