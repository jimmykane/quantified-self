import { inject, Injectable } from '@angular/core';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { combineLatest, defer, map, type Observable } from 'rxjs';
import { AppHealthService } from './app.health.service';
import { AppSleepService } from './app.sleep.service';
import { buildDashboardHrvContext, dashboardHrvWindows, type DashboardHrvContext } from '../helpers/dashboard-hrv-context.helper';
import type { AppDashboardSleepTrendRange } from '../models/app-user.interface';

/** Read-only adapter shared by the saved tile and chart picker. */
@Injectable({ providedIn: 'root' })
export class DashboardHrvService {
  private readonly health = inject(AppHealthService);
  private readonly sleep = inject(AppSleepService);

  watch(uid: string, range: AppDashboardSleepTrendRange = '14d', endMs = Date.now(), unitSettings: UserUnitSettingsInterface | null = null): Observable<DashboardHrvContext> {
    return defer(() => {
      const windows = dashboardHrvWindows(range, endMs);
      const request = { metricId: HEALTH_METRIC_IDS.HeartRateVariability, includeSamples: false };
      return combineLatest([
        this.health.loadMetricRange(uid, { ...request, startDate: windows.visible.startDate, endDate: windows.visible.endDate }),
        this.health.loadMetricRange(uid, { ...request, ...windows.history }),
        this.sleep.watchForDashboard(uid, windows.historyStartMs, windows.visible.endTimeMs),
      ]).pipe(map(([visible, history, sessions]) => {
        if (visible.limitReached || history.limitReached) throw new Error('HRV history is incomplete');
        return buildDashboardHrvContext(visible.result, history.result, sessions, windows.visible, unitSettings);
      }));
    });
  }
}
