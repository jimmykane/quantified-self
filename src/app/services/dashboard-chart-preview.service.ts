import { inject, Injectable } from '@angular/core';
import { Observable, catchError, defer, finalize, map, of, shareReplay, startWith } from 'rxjs';
import { TileChartSettingsInterface, TileSettingsInterface, TileTypes } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
import { AppEventService } from './app.event.service';
import { AppRouteService } from './app.route.service';
import { AppSleepService } from './app.sleep.service';
import { DashboardDerivedMetricsService } from './dashboard-derived-metrics.service';
import { buildDashboardTileViewModels } from '../helpers/dashboard-tile-view-model.helper';
import { buildDashboardExamplePreview, buildDashboardPreviewSeed, DashboardChartPreview, DashboardPreviewInput, dashboardPreviewHasData, dashboardPreviewMetricKinds } from '../helpers/dashboard-chart-preview.helper';
import { DASHBOARD_SLEEP_TREND_CHART_TYPE } from '../helpers/dashboard-special-chart-types';
import { resolveDashboardTileEventWindow, normalizeDashboardTileEventFilters } from '../helpers/dashboard-tile-event-filters.helper';

/** Scoped to the open library. No ensure/rebuild or settings API is available here. */
@Injectable()
export class DashboardChartPreviewService {
  private readonly events = inject(AppEventService);
  private readonly routes = inject(AppRouteService);
  private readonly sleep = inject(AppSleepService);
  private readonly derived = inject(DashboardDerivedMetricsService);
  private readonly requests = new Map<string, Observable<DashboardPreviewInput>>();

  watch(user: AppUserInterface, tile: TileSettingsInterface, seed: DashboardPreviewInput): Observable<DashboardChartPreview> {
    const example = buildDashboardExamplePreview(tile);
    const input = buildDashboardPreviewSeed(tile, seed);
    const existing = buildDashboardTileViewModels(input)[0];
    if (dashboardPreviewHasData(existing, input)) return of({ ...example, tile: existing, source: 'user', note: '', calendarEvents: input.events || [], anchorMs: Date.now() });
    const kinds = dashboardPreviewMetricKinds(tile);
    const chartType = `${(tile as TileChartSettingsInterface).chartType}`;
    const filters = normalizeDashboardTileEventFilters(tile['eventFilters']);
    const now = Math.floor(Date.now()/60000)*60000;
    const window = resolveDashboardTileEventWindow(filters, user.settings.unitSettings?.startOfTheWeek, null, now);
    const key = JSON.stringify([user.uid, kinds, chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE ? 'sleep' : tile['mapSource'] === 'routes' ? 'routes' : kinds.length ? 'derived' : 'events', filters.range]);
    let request$ = this.requests.get(key);
    if (!request$) {
      request$ = defer((): Observable<DashboardPreviewInput> => {
        if (kinds.length) return this.derived.watch(user, { metricKinds: kinds }).pipe(map(state => ({ ...input, derivedMetrics: state })));
        if (chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE) return this.sleep.watchForDashboard(user.uid, now-14*86400000, now).pipe(map(sleepSessions => ({ ...input, sleepSessions, sleepTrendWindow: { startMs: now-14*86400000, endMs: now } })));
        if (tile.type === TileTypes.Map && tile['mapSource'] === 'routes') return this.routes.watchRecentRoutePreviews(user, 50).pipe(map(routePreviews => ({ ...input, routePreviews })));
        return this.events.getEventsBy(user, [...(window.startMs === null ? [] : [{ fieldPath: 'startDate', opStr: '>=', value: window.startMs }]), { fieldPath: 'startDate', opStr: '<=', value: window.endMs ?? now }], 'startDate', false, 0).pipe(map(events => ({ ...input, events: events.filter(event => !event.isMerge) })));
      }).pipe(finalize(() => this.requests.delete(key)), shareReplay({ bufferSize: 1, refCount: true }));
      this.requests.set(key, request$);
    }
    return request$.pipe(map(data => {
      const ownInput = { ...data, tiles: [tile], tileEventsByOrder: null };
      const vm = buildDashboardTileViewModels(ownInput)[0];
      return dashboardPreviewHasData(vm, ownInput)
        ? { ...example, tile: vm, source: 'user' as const, note: '', calendarEvents: data.events || [], anchorMs: now }
        : example;
    }), catchError(() => of({ ...example, note: 'Could not load your data. Showing an example.' })), startWith({ ...example, loading: true, note: 'Loading your preview…' })) as Observable<DashboardChartPreview>;
  }
}
