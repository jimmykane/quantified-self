import { DashboardHrvService } from './dashboard-hrv.service';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, defer, finalize, map, merge, of, scan, shareReplay, startWith } from 'rxjs';
import { TileSettingsInterface } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
import { AppEventService } from './app.event.service';
import { AppRouteService } from './app.route.service';
import { AppSleepService } from './app.sleep.service';
import { DashboardDerivedMetricsService, type DashboardDerivedMetricsState } from './dashboard-derived-metrics.service';
import { dashboardPreviewIsManaged, dashboardPreviewSourceKeys, buildDashboardThumbnailPreview, dashboardPreviewMissingMetricKinds, DASHBOARD_PREVIEW_METRIC_CONTEXTS, buildDashboardPreviewSeed, DashboardChartPreview, DashboardPreviewInput, dashboardPreviewMetricKinds } from '../helpers/dashboard-chart-preview.helper';
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
  watchDerivedContexts(user: AppUserInterface, tiles: readonly TileSettingsInterface[], seed: DashboardPreviewInput): Observable<Partial<DashboardPreviewInput>> {
    const metricKinds = dashboardPreviewMissingMetricKinds(tiles, seed);
    if (!metricKinds.length) return of({});
    return this.derived.watch(user, { metricKinds, reportReadErrors: true }).pipe(scan((previous, state) => {
      const statuses = Object.fromEntries(metricKinds.map(kind => {
        const context = DASHBOARD_PREVIEW_METRIC_CONTEXTS[kind];
        const status = (context === 'formPoints' ? 'formStatus' : `${context}Status`) as keyof DashboardDerivedMetricsState;
        return [kind, state[status]];
      }));
      const updates = metricKinds.flatMap(kind => {
        const context = DASHBOARD_PREVIEW_METRIC_CONTEXTS[kind];
        const value = state[context];
        // Pending/failed snapshots can omit their payload. Keep the previous
        // values until a completed result (including an empty one) replaces them.
        return statuses[kind] === 'ready' || value != null && (!Array.isArray(value) || value.length)
          ? [[context, value]] : [];
      });
      return { derivedMetrics: { ...previous.derivedMetrics, ...Object.fromEntries(updates) }, previewMetricStatuses: statuses };
    }, {} as Partial<DashboardPreviewInput>));
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
      defer(() => this.watchDerivedContexts(user, tiles, seed))));
    const sourceTiles = new Map(tiles.filter(tile => !dashboardPreviewMetricKinds(tile).length)
      .map(tile => [dashboardPreviewSourceKeys(tile)[0], tile]));
    for (const [key, tile] of sourceTiles) {
      const input = buildDashboardPreviewSeed(tile, seed, now);
      const source$ = defer((): Observable<Partial<DashboardPreviewInput>> => {
        // Reused sources stay on the live dashboard seed. Copying them into this
        // patch would shadow later dashboard emissions for the whole browse session.
        if (key === 'hrv') return input.hrvTrend && !input.hrvTrend.loading && !input.hrvTrend.error
          ? of({})
          : this.hrv.watch(user.uid, '14d', now, user.settings.unitSettings).pipe(map(hrvTrend => ({ hrvTrend })));
        if (key === 'sleep') return input.sleepSessions?.length
          ? of({})
          : this.sleep.watchForDashboard(user.uid, now - 14 * 86400000, now).pipe(map(sleepSessions => ({
            sleepSessions, sleepTrendWindow: { startMs: now - 14 * 86400000, endMs: now },
          })));
        if (key === 'routes') return input.routePreviews?.length
          ? of({})
          : this.routes.watchRecentRoutePreviews(user, 50).pipe(map(routePreviews => ({ routePreviews })));
        const filters = normalizeDashboardTileEventFilters(tile['eventFilters']);
        const saved = seed.tiles.some(candidate => !seed.tileEventAnchorsByOrder?.[candidate.order]
          && normalizeDashboardTileEventFilters(candidate['eventFilters']).range === filters.range
          && seed.tileEventsByOrder?.[candidate.order] != null);
        if (saved || seed.previewEventsByRange?.[filters.range] != null) return of({});
        return this.watchEvents(user, filters, now).pipe(map(events => ({ previewEventsByRange: { [filters.range]: events } })));
      });
      streams$.push(withState([key], source$));
    }
    if (!streams$.length) return of({});
    return merge(...streams$).pipe(scan((all, patch) => ({ ...all, ...patch,
      previewStates: { ...all.previewStates, ...patch.previewStates },
      previewMetricStatuses: { ...all.previewMetricStatuses, ...patch.previewMetricStatuses },
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
    const input = { ...seed, hrvPreferredSource: user.settings.appSettings?.healthWorkspace?.highlightSources?.heart_rate_variability };
    const preview = buildDashboardThumbnailPreview(tile, input);
    if (preview.availability?.state === 'ready') return of(preview);
    const key = JSON.stringify([user.uid, dashboardPreviewSourceKeys(tile), user.settings.unitSettings]);
    let request$ = this.requests.get(key);
    if (!request$) {
      request$ = defer(() => this.watchLibraryContexts(user, [tile], input)).pipe(
        map(patch => ({ ...input, ...patch,
          derivedMetrics: { ...input.derivedMetrics, ...patch.derivedMetrics },
          previewMetricStatuses: { ...input.previewMetricStatuses, ...patch.previewMetricStatuses },
        })),
        finalize(() => this.requests.delete(key)), shareReplay({ bufferSize: 1, refCount: true }));
      this.requests.set(key, request$);
    }
    return request$.pipe(map(data => buildDashboardThumbnailPreview(tile, data)));
  }
}
