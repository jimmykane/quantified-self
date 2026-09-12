import { inject, Injectable } from '@angular/core';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS, type HealthSourceRecord } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import { assertNightlyHrvRecordBudget, enrichSleepWithNightlyHrv, nightlyHrvDateRange } from '@shared/nightly-hrv';
import { combineLatest, defer, finalize, of, shareReplay, switchMap, type Observable } from 'rxjs';
import { HrvHistoryService } from './hrv-history.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppSleepService } from './app.sleep.service';
import { buildDashboardHrvContext, dashboardHrvWindows, type DashboardHrvContext } from '../helpers/dashboard-hrv-context.helper';
import type { AppDashboardSleepTrendRange } from '../models/app-user.interface';

/** Read-only adapter shared by the saved tile and chart picker. */
@Injectable({ providedIn: 'root' })
export class DashboardHrvService {
  private readonly history = inject(HrvHistoryService);
  private readonly sleep = inject(AppSleepService);
  private readonly compatibility = inject(BrowserCompatibilityService);
  private readonly requests = new Map<string, Observable<DashboardHrvContext>>();

  watch(uid: string, range: AppDashboardSleepTrendRange = '14d', endMs = Date.now(), unitSettings: UserUnitSettingsInterface | null = null): Observable<DashboardHrvContext> {
    return defer(() => {
      const windows = dashboardHrvWindows(range, endMs);
      const key = JSON.stringify([uid, windows.visible.startDate, windows.visible.endDate, unitSettings]);
      let request$ = this.requests.get(key);
      if (!request$) {
        request$ = combineLatest([
          this.history.watch(uid, windows.history.startDate, windows.visible.endDate),
          this.sleep.watchSessions(uid, windows.historyStartMs, windows.visible.endTimeMs),
        ]).pipe(
          switchMap(([records, sessions]) => {
            // A boundary-crossing sleep can carry a provider date outside the chart
            // window. Read only that extra context if enrichment actually needs it.
            const missing = this.compatibility.checkWebCryptoSupport() ? nightlyHrvDateRange(sessions) : null;
            const sources: Observable<HealthSourceRecord[]>[] = [of(records)];
            if (missing && missing.startDate < windows.history.startDate) {
              sources.push(this.history.watch(uid, missing.startDate, adjacentDate(windows.history.startDate, -1)));
            }
            if (missing && missing.endDate > windows.visible.endDate) {
              sources.push(this.history.watch(uid, adjacentDate(windows.visible.endDate, 1), missing.endDate));
            }
            return combineLatest(sources).pipe(switchMap(async pages => {
              const allRecords = pages.flat();
              assertNightlyHrvRecordBudget(allRecords);
              const enriched = missing ? await enrichSleepWithNightlyHrv(uid, sessions, allRecords) : sessions;
              const project = (window: { startDate: string; endDate: string }) => projectLoadedHealthRange(records, [], {
                ...window, metricIds: [HEALTH_METRIC_IDS.HeartRateVariability], includeSamples: false,
              }, { sourceRecordsComplete: true, samplesComplete: true });
              return buildDashboardHrvContext(project(windows.visible), project(windows.history), enriched, windows.visible, unitSettings);
            }));
          }),
          finalize(() => this.requests.delete(key)),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
        this.requests.set(key, request$);
      }
      return request$;
    });
  }
}

function adjacentDate(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}
