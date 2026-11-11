import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  LOCALE_ID,
  inject,
  signal,
} from '@angular/core';
import { Subscription, defer, fromEvent } from 'rxjs';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';
import type {
  AppUserInterface,
  AppDashboardTodaySettings,
} from '../models/app-user.interface';
import { ActivityCalendarService } from './activity-calendar.service';
import { HealthMetricQueryService } from './health-metric-query.service';
import { AppUserService } from './app.user.service';
import { dashboardTodayDependencies } from '../helpers/dashboard-today-settings.helper';
import {
  buildTodayActivityMetrics,
  TODAY_ACTIVITY_METRICS,
  type DashboardTodayMetricValues,
} from '../helpers/dashboard-today-metrics.helper';
import { selectLatestHealthReading } from '../helpers/health-latest-reading.helper';
import { getDateTimeFormatter } from '../helpers/date-time-format.helper';

import { buildCalendarActivityRow, type CalendarActivityRow } from '../helpers/calendar-activity-row.helper';

export interface TodayRecordedActivities {
  ownerUid: string | null;
  date: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  rows: CalendarActivityRow[];
  complete: boolean;
}
const emptyActivities = (): TodayRecordedActivities => ({ ownerUid: null, date: null, status: 'idle', rows: [], complete: false });

/** One activity listener and bounded cached Health reads for the optional Today metrics. */
@Injectable()
export class DashboardTodayDataService {
  private readonly calendar = inject(ActivityCalendarService);
  private readonly health = inject(HealthMetricQueryService);
  private readonly users = inject(AppUserService);
  private readonly document = inject(DOCUMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroy = inject(DestroyRef);
  readonly metrics = signal<DashboardTodayMetricValues>({});
  readonly activities = signal<TodayRecordedActivities>(emptyActivities());
  private key = '';
  private generation = 0;
  private activity?: Subscription;
  private healthAbort?: AbortController;
  private current: {
    user: AppUserInterface;
    settings: AppDashboardTodaySettings;
    date: string;
  } | null = null;
  constructor() {
    const invalidation = this.health.invalidated$.subscribe((uid) => {
      if (this.current?.user.uid === uid) this.refreshHealth();
    });
    const visibility = fromEvent(this.document, 'visibilitychange').subscribe(
      () => {
        if (this.document.visibilityState === 'visible') this.refreshHealth();
      }
    );
    this.destroy.onDestroy(() => {
      this.generation++;
      this.activity?.unsubscribe();
      this.healthAbort?.abort();
      invalidation.unsubscribe();
      visibility.unsubscribe();
    });
  }
  connect(
    user: AppUserInterface | null,
    settings: AppDashboardTodaySettings,
    date: string
  ): void {
    const activeUid = this.users.user()?.uid;
    const key = JSON.stringify([
      activeUid,
      user?.uid,
      settings.recordedActivities === true,
      settings.metrics
        .filter(
          (id) =>
            TODAY_ACTIVITY_METRICS.includes(id) ||
            id === 'weight' ||
            id === 'steps'
        )
        .sort(),
      date,
      user?.settings?.unitSettings,
      user?.settings?.summariesSettings,
      user?.settings?.appSettings?.healthWorkspace?.metricSources,
    ]);
    if (key === this.key) return;
    this.key = key;
    this.generation++;
    this.activity?.unsubscribe();
    this.healthAbort?.abort();
    this.metrics.set({});
    this.activities.set(emptyActivities());
    this.current =
      user && user.uid === activeUid && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? { user, settings, date }
        : null;
    if (!this.current) return;
    if (dashboardTodayDependencies(settings).activities) this.watchActivities();
    this.refreshHealth();
  }

  /** Explicit retry affects only the activity query, leaving Health reads alone. */
  retryActivities(): boolean {
    const state = this.activities();
    if (!this.current || !this.valid(this.generation) || !dashboardTodayDependencies(this.current.settings).activities
      || !(state.status === 'error' || (state.status === 'ready' && !state.complete))) return false;
    this.watchActivities();
    return true;
  }

  private watchActivities(): void {
    const { user, settings, date } = this.current;
    const version = this.generation;
    const start = new Date(`${date}T00:00:00`), end = new Date(start);
    end.setDate(end.getDate() + 1);
    this.activity?.unsubscribe();
    this.activities.set({ ownerUid: user.uid, date, status: 'loading', rows: [], complete: false });
    this.patch(Object.fromEntries(TODAY_ACTIVITY_METRICS.map(id => [id,
      { value: '—', detail: 'Loading activities…', status: 'loading' },
    ])));
    this.activity = defer(() => this.calendar.watchSummaryEvents(user, {
      startMs: start.getTime(), endExclusiveMs: end.getTime(),
    })).subscribe({
      next: result => {
        if (!this.valid(version)) return;
        this.patch(buildTodayActivityMetrics(result.events, result.complete, user.settings.unitSettings,
          user.settings.summariesSettings, this.locale, settings.metrics));
        this.activities.set({ ownerUid: user.uid, date, status: 'ready', complete: result.complete,
          rows: settings.recordedActivities ? [...new Map(result.events.map(event => [event.getID(), event])).values()]
            .map(event => buildCalendarActivityRow(event, user.uid)) : [],
        });
      },
      error: () => {
        if (!this.valid(version)) return;
        this.activities.set({ ownerUid: user.uid, date, status: 'error', rows: [], complete: false });
        this.patch(Object.fromEntries(TODAY_ACTIVITY_METRICS.map(id => [id,
          { value: '—', detail: 'Unable to load activities', status: 'error' },
        ])));
      },
    });
  }
  private patch(values: DashboardTodayMetricValues) {
    this.metrics.update((current) => ({ ...current, ...values }));
  }
  private valid(version: number) {
    return (
      version === this.generation &&
      this.current?.user.uid === this.users.user()?.uid &&
      !this.destroy.destroyed
    );
  }
  private refreshHealth(): void {
    const scope = this.current;
    if (
      !scope ||
      this.document.visibilityState === 'hidden' ||
      this.users.user()?.uid !== scope.user.uid
    )
      return;
    this.healthAbort?.abort();
    this.healthAbort = new AbortController();
    const signal = this.healthAbort.signal,
      version = this.generation;
    for (const id of ['weight', 'steps'] as const) {
      if (!scope.settings.metrics.includes(id)) continue;
      const preferred =
        scope.user.settings.appSettings?.healthWorkspace?.metricSources?.[
          id === 'weight' ? 'body_weight' : 'steps'
        ] ?? null;
      this.patch({
        [id]: {
          value: '—',
          detail: id === 'weight' ? 'Loading weight…' : 'Loading steps…',
          status: 'loading',
        },
      });
      const request =
        id === 'weight'
          ? this.health.loadLatestMeasurement(scope.user.uid, preferred, signal)
          : this.health
              .loadMetricRange(
                scope.user.uid,
                {
                  metricId: HEALTH_METRIC_IDS.Steps,
                  startDate: scope.date,
                  endDate: scope.date,
                  includeSamples: false,
                },
                10,
                signal
              )
              .then((value) => ({
                results: [value.result],
                complete: !value.limitReached,
              }));
      void request
        .then((value) => {
          if (signal.aborted || !this.valid(version)) return;
          const selected = selectLatestHealthReading(value.results, preferred);
          const display = selected
            ? formatCanonicalHealthMetricSportsLibValue(
                id === 'weight'
                  ? HEALTH_METRIC_IDS.BodyWeight
                  : HEALTH_METRIC_IDS.Steps,
                selected.point.value,
                scope.user.settings.unitSettings
              )
            : null;
          const date = selected
            ? getDateTimeFormatter(this.locale, {
                dateStyle: 'medium',
                timeZone: id === 'steps' ? 'UTC' : undefined,
              }).format(
                // Daily totals belong to a calendar day; their interval end can be the next day.
                id === 'steps'
                  ? Date.parse(`${selected.point.calendarDate}T12:00:00Z`)
                  : selected.point.timestampMs
              )
            : '';
          this.patch({
            [id]: {
              hasData: selected !== null && selected !== undefined,
              value: display
                ? [display.value, display.unit].filter(Boolean).join(' ')
                : '—',
              detail: selected
                ? `${selected.series.sourceLabel} · ${date}${value.complete ? '' : ' · Some history is unavailable'}`
                : !value.complete
                  ? 'Some readings are unavailable'
                  : preferred
                    ? id === 'weight'
                      ? 'No weigh-in recorded for the selected source'
                      : 'No step count recorded for the selected source today'
                    : id === 'weight'
                      ? 'No weigh-in recorded'
                      : 'No steps recorded today',
              status: !value.complete ? 'error' : selected ? 'ready' : 'empty',
            },
          });
        })
        .catch(() => {
          if (!signal.aborted && this.valid(version))
            this.patch({
              [id]: {
                value: '—',
                detail:
                  id === 'weight'
                    ? 'Unable to load weight'
                    : 'Unable to load steps',
                status: 'error',
              },
            });
        });
    }
  }
}
