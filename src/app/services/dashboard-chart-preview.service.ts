import { DashboardHrvService } from './dashboard-hrv.service';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, defer, finalize, map, merge, of, scan, shareReplay, startWith } from 'rxjs';
import { TileChartSettingsInterface, TileSettingsInterface, TileTypes } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
import { AppEventService } from './app.event.service';
import { AppRouteService } from './app.route.service';
import { AppSleepService } from './app.sleep.service';
import { DashboardDerivedMetricsService } from './dashboard-derived-metrics.service';
import { buildDashboardTileViewModels } from '../helpers/dashboard-tile-view-model.helper';
import { dashboardPreviewIsManaged, dashboardPreviewSourceKeys, buildDashboardThumbnailPreview, dashboardPreviewMissingMetricKinds, DASHBOARD_PREVIEW_METRIC_CONTEXTS, buildDashboardExamplePreview, buildDashboardPreviewSeed, DashboardChartPreview, DashboardPreviewInput, dashboardPreviewHasData, dashboardPreviewMetricKinds } from '../helpers/dashboard-chart-preview.helper';
import { isDashboardSleepBackedChartType, isDashboardHrvTrendChartType } from '../helpers/dashboard-special-chart-types';
import { resolveDashboardTileEventWindow, normalizeDashboardTileEventFilters } from '../helpers/dashboard-tile-event-filters.helper';

/** Scoped to the open library. No ensure/rebuild or settings API is available here. */
@Injectable()
export class DashboardChartPreviewService {
  private readonly events = inject(AppEventService);
  private readonly routes = inject(AppRouteService);
  private readonly hrv = inject(DashboardHrvService);
  private readonly sleep = inject(AppSleepService);
  private readonly derived = inject(DashboardDerivedMetricsService);
  private readonly requests = new Map<string, Observable<DashboardPreviewInput>>();

  /** One subscription for missing derived dependencies, released when the picker closes. */
  watchDerivedContexts(user: AppUserInterface, tiles: readonly TileSettingsInterface[], seed: DashboardPreviewInput): Observable<DashboardPreviewInput['derivedMetrics']> {
    const metricKinds = dashboardPreviewMissingMetricKinds(tiles, seed);
    if (!metricKinds.length) return of({});
    return this.derived.watch(user, { metricKinds }).pipe(map(state => Object.fromEntries(metricKinds.map(kind => {
      const key = DASHBOARD_PREVIEW_METRIC_CONTEXTS[kind];
      return [key, state[key]];
    }))));
  }

  /** Read each source once for the open section, independently of filtering or selection. */
  watchLibraryContexts(user: AppUserInterface, tiles: readonly TileSettingsInterface[], seed: DashboardPreviewInput): Observable<Partial<DashboardPreviewInput>> {
    const now = Math.floor(Date.now() / 60000) * 60000;
    const streams$: Observable<Partial<DashboardPreviewInput>>[] = [];
    const kinds = [...new Set(tiles.flatMap(dashboardPreviewMetricKinds))];
    const withState = (keys: string[], source$: Observable<Partial<DashboardPreviewInput>>) => source$.pipe(
      map(data => ({ ...data, previewStates: Object.fromEntries(keys.map(key => [key,
        key === 'hrv' && data.hrvTrend?.loading ? 'loading' : key === 'hrv' && data.hrvTrend?.error ? 'error' : 'ready'])) } as Partial<DashboardPreviewInput>)),
      catchError(() => of({ previewStates: Object.fromEntries(keys.map(key => [key, 'error'])) } as Partial<DashboardPreviewInput>)),
      startWith({ previewStates: Object.fromEntries(keys.map(key => [key, 'loading'])) } as Partial<DashboardPreviewInput>),
    );
    if (kinds.length) streams$.push(withState(kinds.map(kind => `derived:${kind}`),
      defer(() => this.watchDerivedContexts(user, tiles, seed)).pipe(map(derivedMetrics => ({ derivedMetrics })))));
    const sourceTiles = new Map(tiles.filter(tile => !dashboardPreviewMetricKinds(tile).length)
      .map(tile => [dashboardPreviewSourceKeys(tile)[0], tile]));
    for (const [key, tile] of sourceTiles) {
      const input = buildDashboardPreviewSeed(tile, seed, now);
      const source$ = defer((): Observable<Partial<DashboardPreviewInput>> => {
        if (key === 'hrv') return input.hrvTrend && !input.hrvTrend.loading && !input.hrvTrend.error
          ? of({ hrvTrend: input.hrvTrend })
          : this.hrv.watch(user.uid, '14d', now, user.settings.unitSettings).pipe(map(hrvTrend => ({ hrvTrend })));
        if (key === 'sleep') return input.sleepSessions?.length
          ? of({ sleepSessions: input.sleepSessions, sleepTrendWindow: input.sleepTrendWindow })
          : this.sleep.watchForDashboard(user.uid, now - 14 * 86400000, now).pipe(map(sleepSessions => ({
            sleepSessions, sleepTrendWindow: { startMs: now - 14 * 86400000, endMs: now },
          })));
        if (key === 'routes') return input.routePreviews?.length
          ? of({ routePreviews: input.routePreviews })
          : this.routes.watchRecentRoutePreviews(user, 50).pipe(map(routePreviews => ({ routePreviews })));
        const filters = normalizeDashboardTileEventFilters(tile['eventFilters']);
        const saved = seed.tiles.some(candidate => !seed.tileEventAnchorsByOrder?.[candidate.order]
          && normalizeDashboardTileEventFilters(candidate['eventFilters']).range === filters.range
          && seed.tileEventsByOrder?.[candidate.order] != null);
        const events$ = saved || seed.previewEventsByRange?.[filters.range] != null ? of(input.events || [])
          : this.watchEvents(user, filters, now);
        return events$.pipe(map(events => ({ previewEventsByRange: { [filters.range]: events } })));
      });
      streams$.push(withState([key], source$));
    }
    if (!streams$.length) return of({});
    return merge(...streams$).pipe(scan((all, patch) => ({ ...all, ...patch,
      previewStates: { ...all.previewStates, ...patch.previewStates },
      previewEventsByRange: { ...all.previewEventsByRange, ...patch.previewEventsByRange },
    }), {} as Partial<DashboardPreviewInput>));
  }

  private watchEvents(user: AppUserInterface, filters: ReturnType<typeof normalizeDashboardTileEventFilters>, now: number) {
    const window = resolveDashboardTileEventWindow(filters, user.settings.unitSettings?.startOfTheWeek, null, now);
    return this.events.getEventsBy(user, [
      ...(window.startMs === null ? [] : [{ fieldPath: 'startDate', opStr: '>=' as const, value: window.startMs }]),
      { fieldPath: 'startDate', opStr: '<=' as const, value: window.endMs ?? now },
    ], 'startDate', false, 0).pipe(map(events => events.filter(event => !event.isMerge)));
  }

  watch(user: AppUserInterface, tile: TileSettingsInterface, seed: DashboardPreviewInput): Observable<DashboardChartPreview> {
    if (dashboardPreviewIsManaged(tile, seed)) return of(buildDashboardThumbnailPreview(tile, seed));
    const example = buildDashboardExamplePreview(tile);
    const input = { ...buildDashboardPreviewSeed(tile, seed), hrvPreferredSource: user.settings.appSettings?.healthWorkspace?.highlightSources?.heart_rate_variability };
    const existing = buildDashboardTileViewModels(input)[0];
    if (dashboardPreviewHasData(existing, input)) return of({ ...example, tile: existing, source: 'user', note: '', calendarEvents: input.events || [], anchorMs: Date.now() });
    const kinds = dashboardPreviewMetricKinds(tile);
    const chartType = `${(tile as TileChartSettingsInterface).chartType}`;
    const filters = normalizeDashboardTileEventFilters(tile['eventFilters']);
    const now = Math.floor(Date.now()/60000)*60000;
    const key = JSON.stringify([user.uid, kinds, isDashboardHrvTrendChartType(chartType) ? 'hrv' : isDashboardSleepBackedChartType(chartType) ? 'sleep' : tile['mapSource'] === 'routes' ? 'routes' : kinds.length ? 'derived' : 'events', filters.range]);
    let request$ = this.requests.get(key);
    if (!request$) {
      request$ = defer((): Observable<DashboardPreviewInput> => {
        if (kinds.length) return this.derived.watch(user, { metricKinds: kinds }).pipe(map(state => ({ ...input, derivedMetrics: { ...input.derivedMetrics, ...Object.fromEntries(kinds.map(kind => [DASHBOARD_PREVIEW_METRIC_CONTEXTS[kind], state[DASHBOARD_PREVIEW_METRIC_CONTEXTS[kind]]])) } })));
        if (isDashboardHrvTrendChartType(chartType)) return this.hrv.watch(user.uid, '14d', now, user.settings.unitSettings).pipe(map(hrvTrend => ({ ...input, hrvTrend })));
        if (isDashboardSleepBackedChartType(chartType)) return this.sleep.watchForDashboard(user.uid, now-14*86400000, now).pipe(map(sleepSessions => ({ ...input, sleepSessions, sleepTrendWindow: { startMs: now-14*86400000, endMs: now } })));
        if (tile.type === TileTypes.Map && tile['mapSource'] === 'routes') return this.routes.watchRecentRoutePreviews(user, 50).pipe(map(routePreviews => ({ ...input, routePreviews })));
        return this.watchEvents(user, filters, now).pipe(map(events => ({ ...input, events })));
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
