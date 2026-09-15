import { inject, Injectable } from '@angular/core';
import { defer, filter, merge, Observable, of, scan, switchMap } from 'rxjs';
import { isActivityHealthMetricId } from '@shared/activity-health';
import { HEALTH_METRIC_IDS, HEALTH_SLEEP_REFERENCE_METRIC_IDS } from '@shared/health';
import { HealthMetricQueryService } from './health-metric-query.service';
import { localCalendarDate, resolveHealthWorkspaceWindow } from '../helpers/health-workspace.helper';
import type { AppDashboardHealthMetricSettings } from '../models/app-user.interface';
import type { DashboardHealthEvidence } from '../helpers/dashboard-health-context.helper';
@Injectable({ providedIn: 'root' })
export class DashboardHealthService {
    private readonly queries = inject(HealthMetricQueryService);
    isOwner(uid: string): boolean { return this.queries.isOwner(uid); }
    invalidate(uid: string): void { this.queries.invalidate(uid); }
    watch(uid: string, settings: AppDashboardHealthMetricSettings, endDate = localCalendarDate(Date.now()), priority = 10, onLoading?: () => void) {
        return defer(() => merge(of(uid), this.queries.invalidated$.pipe(filter(owner => owner === uid))).pipe(switchMap(() => new Observable<DashboardHealthEvidence>(subscriber => {
            onLoading?.();
            const controller = new AbortController();
            void this.load(uid, settings, endDate, priority, controller.signal).then(value => { subscriber.next(value); subscriber.complete(); }, error => subscriber.error(error));
            return () => controller.abort();
        })), scan((previous: DashboardHealthEvidence | null, current: DashboardHealthEvidence) => {
            if (!previous) return current;
            // A failed refresh is not an empty period. Retain only the failed source's
            // last completed result; this subscription owns one metric and window.
            const retained: DashboardHealthEvidence = { ...current, staleSources: [] };
            const keep = <K extends 'health' | 'history' | 'activities' | 'sessions'>(key: K, label: string): void => {
                if (current.errors.includes(label) && previous[key] != null
                    && (!previous.errors.includes(label) || previous.staleSources?.includes(label))) {
                    retained[key] = previous[key];
                    retained.staleSources.push(label);
                }
            };
            keep('health', 'Health readings');
            keep('history', 'Personal range history');
            keep('activities', 'Workout readings');
            keep('sessions', 'Sleep readings');
            return retained;
        }, null)));
    }
    private async load(uid: string, settings: AppDashboardHealthMetricSettings, endDate: string, priority: number, signal: AbortSignal): Promise<DashboardHealthEvidence> {
        if (!this.queries.isOwner(uid))
            throw new Error('Health data is only available to its owner.');
        const window = resolveHealthWorkspaceWindow({ metric: settings.metric, range: settings.range, endDate });
        const hrv = settings.metric === HEALTH_METRIC_IDS.HeartRateVariability;
        const previousStart = new Date(Date.parse(window.startDate) - 60 * 86400000).toISOString().slice(0, 10);
        const previousEnd = new Date(Date.parse(window.startDate) - 86400000).toISOString().slice(0, 10);
        const sleepStart = hrv ? resolveHealthWorkspaceWindow({ metric: settings.metric, range: 'today', endDate: previousStart }).startTimeMs : window.startTimeMs;
        // Health observations may reference Sleep fields (including HR, oxygen and respiration).
        const needsSleep = settings.metric === 'sleep' || Object.values(HEALTH_SLEEP_REFERENCE_METRIC_IDS).some(metrics => (metrics as readonly string[]).includes(settings.metric));
        const [health, history, activities, sessions] = await Promise.allSettled([
            settings.metric === 'sleep' ? Promise.resolve(null) : this.queries.loadMetricRange(uid, { metricId: settings.metric, startDate: window.startDate, endDate: window.endDate, includeSamples: window.includeSamples }, priority, signal),
            hrv ? this.queries.loadMetricRange(uid, { metricId: HEALTH_METRIC_IDS.HeartRateVariability, startDate: previousStart, endDate: previousEnd, includeSamples: false }, priority, signal) : Promise.resolve(null),
            settings.metric !== 'sleep' && isActivityHealthMetricId(settings.metric) ? this.queries.loadActivityRange(uid, { metricId: settings.metric, startTimeMs: window.startTimeMs, endTimeMs: window.endTimeMs }, priority, signal) : Promise.resolve(null),
            needsSleep ? this.queries.loadSleepRange(uid, sleepStart, window.endTimeMs, priority, signal) : Promise.resolve([]),
        ]);
        if (!this.queries.isOwner(uid))
            throw new Error('Health account changed.');
        return { window, health: health.status === 'fulfilled' ? health.value : null, history: history.status === 'fulfilled' ? history.value : null,
            activities: activities.status === 'fulfilled' ? activities.value : null, sessions: sessions.status === 'fulfilled' ? sessions.value : [],
            errors: [[health, 'Health readings'], [history, 'Personal range history'], [activities, 'Workout readings'], [sessions, 'Sleep readings']]
                .flatMap(([outcome, label]) => typeof outcome !== 'string' && outcome.status === 'rejected' ? [label as string] : []),
        };
    }
}
