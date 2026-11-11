import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { defer, interval, map, Subscription } from 'rxjs';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metric-kinds';
import type { AppUserInterface } from '../models/app-user.interface';
import { DashboardTodayDataService } from './dashboard-today-data.service';
import { DashboardDerivedMetricsService, createDashboardDerivedMetricsMissingState } from './dashboard-derived-metrics.service';
import { AppSleepService } from './app.sleep.service';
import { AppUserService } from './app.user.service';
import { buildDashboardTodayAvailability, type TodayAvailabilitySnapshots } from '../helpers/dashboard-today-availability.helper';
import { DASHBOARD_TODAY_METRICS, defaultDashboardTodaySettings } from '../helpers/dashboard-today-settings.helper';
import { buildDashboardSleepTrendContext } from '../helpers/dashboard-sleep-chart.helper';
import { buildDashboardReadinessSleepQueryWindow } from '../helpers/dashboard-training-insights.helper';
import { formatActivityCalendarDateParam } from '../helpers/activity-calendar.helper';
import type { SleepSession } from '@shared/sleep';

/** Read-only evidence for the open Today editor; never ensures snapshots or generates a suggestion. */
@Injectable()
export class DashboardTodayAvailabilityService {
  private readonly optional = inject(DashboardTodayDataService);
  private readonly derived = inject(DashboardDerivedMetricsService);
  private readonly sleep = inject(AppSleepService);
  private readonly users = inject(AppUserService);
  private readonly requestedUid = signal<string | null>(null);
  private readonly snapshot = signal<TodayAvailabilitySnapshots | null>(null);
  private readonly nights = signal<SleepSession[]>([]);
  private readonly sleepStatus = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly sleepTrend = computed(() => buildDashboardSleepTrendContext(this.nights()));
  private readonly now = toSignal(interval(60_000).pipe(map(() => Date.now())), { initialValue: Date.now() });
  private readonly allMetrics = { ...defaultDashboardTodaySettings(), metrics: DASHBOARD_TODAY_METRICS.map(row => row.id) };
  private readonly ownerUid = computed(() => {
    const uid = this.requestedUid();
    return uid && uid === this.users.user()?.uid ? uid : null;
  });
  // Health source pins and units can change in another view while the editor is open.
  private readonly current = computed(() => this.ownerUid() ? this.users.user() : null);
  readonly availability = computed(() => buildDashboardTodayAvailability({
    metrics: this.ownerUid() ? this.optional.metrics() : {},
    derived: this.ownerUid() ? this.snapshot() : null,
    sleep: this.ownerUid() ? this.sleepTrend() : null,
    sleepStatus: this.ownerUid() ? this.sleepStatus() : 'loading', nowMs: this.now(),
  }));
  constructor() {
    effect(onCleanup => {
      const uid = this.ownerUid();
      this.snapshot.set(null); this.nights.set([]); this.sleepStatus.set('loading');
      if (!uid) return;
      const subscriptions = new Subscription();
      subscriptions.add(defer(() => this.derived.watch({ uid }, {
        metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.RampRate, DERIVED_METRIC_KINDS.RecoveryNow],
        reportReadErrors: true,
      })).subscribe({
        next: state => { if (this.ownerUid() === uid) this.snapshot.set(state); },
        error: () => {
          if (this.ownerUid() === uid) this.snapshot.set({ ...createDashboardDerivedMetricsMissingState(),
            formStatus: 'failed', formNowStatus: 'failed', rampRateStatus: 'failed', recoveryNowStatus: 'failed' });
        },
      }));
      const window = buildDashboardReadinessSleepQueryWindow();
      subscriptions.add(defer(() => this.sleep.watchForDashboard(uid, window.startMs, window.endMs)).subscribe({
        next: nights => { if (this.ownerUid() === uid) { this.nights.set(nights); this.sleepStatus.set('ready'); } },
        error: () => { if (this.ownerUid() === uid) { this.nights.set([]); this.sleepStatus.set('error'); } },
      }));
      onCleanup(() => subscriptions.unsubscribe());
    });
    effect(() => this.optional.connect(this.current(), this.allMetrics, formatActivityCalendarDateParam(new Date(this.now()))));
  }
  connect(user: AppUserInterface): void { this.requestedUid.set(user.uid); }
}
