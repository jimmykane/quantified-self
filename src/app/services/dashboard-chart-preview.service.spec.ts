import { DashboardHrvService } from './dashboard-hrv.service';
import { buildDashboardExamplePreview } from '../helpers/dashboard-chart-preview.helper';
import { dashboardHrvWindows } from '../helpers/dashboard-hrv-context.helper';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import { DashboardChartPreviewService } from './dashboard-chart-preview.service';
import { DashboardDerivedMetricsService, createDashboardDerivedMetricsMissingState } from './dashboard-derived-metrics.service';
import { AppEventService } from './app.event.service';
import { AppSleepService } from './app.sleep.service';
import { AppRouteService } from './app.route.service';
import { getDashboardChartCatalog } from '../helpers/dashboard-chart-catalog.helper';
import { AppUserInterface } from '../models/app-user.interface';
import { buildDashboardExampleEvents, buildDashboardExampleRoutes, buildDashboardThumbnailPreview, DashboardPreviewInput, DashboardChartPreview } from '../helpers/dashboard-chart-preview.helper';

describe('read-only chart preview data', () => {
 const events = { getEventsBy: vi.fn() }; const derived = { watch: vi.fn(), ensureForDashboard: vi.fn() };
 const hrv = { watch: vi.fn() };
 const sleep = { watchForDashboard: vi.fn() }; const routes = { watchRecentRoutePreviews: vi.fn() };
 const user = { uid: 'test-owner', settings: { unitSettings: { startOfTheWeek: 1 }, dashboardSettings: { tiles: [] } } } as unknown as AppUserInterface;
 beforeEach(() => {
  vi.clearAllMocks(); hrv.watch.mockReturnValue(of(null)); events.getEventsBy.mockReturnValue(of([])); derived.watch.mockReturnValue(of(createDashboardDerivedMetricsMissingState())); sleep.watchForDashboard.mockReturnValue(of([])); routes.watchRecentRoutePreviews.mockReturnValue(of([]));
  TestBed.configureTestingModule({ providers: [DashboardChartPreviewService, { provide: DashboardHrvService, useValue: hrv }, { provide: AppEventService, useValue: events }, { provide: DashboardDerivedMetricsService, useValue: derived }, { provide: AppSleepService, useValue: sleep }, { provide: AppRouteService, useValue: routes }] });
 });
 it('loads only missing deduplicated KPI snapshots and does not let them overwrite unrelated seeded contexts', () => {
  const service = TestBed.inject(DashboardChartPreviewService);
  const tiles = getDashboardChartCatalog().filter(entry => ['kpi-form-now', 'kpi-recovery-debt', 'kpi-training-balance'].includes(entry.definition.id)).map(entry => entry.tile);
  const state = createDashboardDerivedMetricsMissingState();
  state.formPlus7d = { value: 15, latestDayMs: 1, projectedDayMs: 2, trend8Weeks: [] };
  const cleanup = vi.fn();
  derived.watch.mockReturnValue(new Observable(subscriber => { subscriber.next(state); return cleanup; }));
  const seed = { tiles: [], derivedMetrics: { formNow: { value: -20, latestDayMs: 1, trend8Weeks: [] } } };
  let result;
  const subscription = service.watchDerivedContexts(user, tiles, seed).subscribe(value => result = value);
  const kinds = derived.watch.mock.calls[0][1].metricKinds;
  expect(new Set(kinds).size).toBe(kinds.length);
  expect(kinds).not.toContain('form_now');
  expect(kinds).toEqual(expect.arrayContaining(['freshness_forecast', 'form_plus_7d', 'intensity_distribution', 'easy_percent', 'hard_percent']));
  expect(result.derivedMetrics.formNow).toBeUndefined();
  expect(result.derivedMetrics.formPlus7d).toEqual(state.formPlus7d);
  subscription.unsubscribe(); expect(cleanup).toHaveBeenCalledOnce();
  expect(events.getEventsBy).not.toHaveBeenCalled(); expect(derived.ensureForDashboard).not.toHaveBeenCalled();
 });
 it('uses the picker’s shared KPI seed without starting a second detail subscription', () => {
  const entry = getDashboardChartCatalog().find(entry => entry.definition.id === 'kpi-acwr')!;
  let result: DashboardChartPreview;
  TestBed.inject(DashboardChartPreviewService).watch(user, entry.tile, { tiles: [], previewStates: { 'derived:acwr': 'loading' } }).subscribe(value => result = value);
  expect(result!.loading).toBe(true);
  expect(derived.watch).not.toHaveBeenCalled();
 });
 it('retains last available KPI values during updates and failures, but accepts a completed empty result', () => {
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'kpi-acwr')!.tile;
  const source$ = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
  derived.watch.mockReturnValue(source$);
  const values: DashboardChartPreview[] = [];
  const acwr = { ratio: 1.2, acuteLoad7: 120, chronicLoad28: 100, latestDayMs: Date.now(), trend8Weeks: [] };
  const subscription = TestBed.inject(DashboardChartPreviewService).watch(user, tile, {
   tiles: [], derivedMetrics: { acwr }, previewMetricStatuses: { acwr: 'stale' },
  }).subscribe(value => values.push(value));
  const state = createDashboardDerivedMetricsMissingState();
  state.acwrStatus = 'building';
  source$.next(state);
  expect(values.at(-1)).toMatchObject({ source: 'user', availability: { state: 'updating' }, tile: { acwr } });
  state.acwr = { ...acwr, ratio: 1.3 }; state.acwrStatus = 'ready';
  source$.next(state);
  state.acwr = null; state.acwrStatus = 'failed';
  source$.next(state);
  expect(values.at(-1)).toMatchObject({ source: 'user', availability: { state: 'error' }, tile: { acwr: { ratio: 1.3 } } });
  state.acwrStatus = 'ready';
  source$.next(state);
  expect(values.at(-1)).toMatchObject({ source: 'example', availability: { state: 'no-data' } });
  subscription.unsubscribe();
 });
 it('loads all non-KPI sources once, preserves incremental results and releases every read', () => {
  const subjects = [events.getEventsBy, sleep.watchForDashboard, routes.watchRecentRoutePreviews, hrv.watch, derived.watch]
    .map(mock => { const source$ = new Subject(); mock.mockReturnValue(source$); return source$; });
  const service = TestBed.inject(DashboardChartPreviewService);
  const tiles = getDashboardChartCatalog().filter(entry => entry.lane !== 'kpi').map(entry => entry.tile);
  let patch: Partial<DashboardPreviewInput>;
  const stream$ = service.watchLibraryContexts(user, tiles, { tiles: [], routePreviews: [] });
  expect(events.getEventsBy).not.toHaveBeenCalled();
  const subscription = stream$.subscribe(value => patch = value);
  expect(events.getEventsBy).toHaveBeenCalledOnce();
  expect(derived.watch).toHaveBeenCalledOnce();
  const kinds = derived.watch.mock.calls[0][1].metricKinds;
  expect(kinds).toEqual(expect.arrayContaining(['recovery_now', 'form', 'freshness_forecast', 'intensity_distribution', 'power_curve', 'efficiency_trend']));
  expect(new Set(kinds).size).toBe(kinds.length);
  expect(sleep.watchForDashboard).toHaveBeenCalledWith(user.uid, expect.any(Number), expect.any(Number));
  expect(hrv.watch).toHaveBeenCalledWith(user.uid, '14d', expect.any(Number), user.settings.unitSettings);
  expect(routes.watchRecentRoutePreviews).toHaveBeenCalledWith(user, 50);
  const accountEvents = buildDashboardExampleEvents(Date.now());
  subjects[0].next(accountEvents);
  const tile = tiles.find(tile => tile['dataType'] === 'Distance')!;
  const row = buildDashboardThumbnailPreview(tile, { tiles: [], ...patch });
  expect(row.source).toBe('user'); expect(row.loading).toBe(false);
  expect(patch!.previewStates?.sleep).toBe('loading');
  subjects[1].error(new Error('sleep unavailable'));
  expect(patch!.previewStates?.sleep).toBe('error');
  expect(patch!.previewEventsByRange?.['90d']).toEqual(accountEvents);
  const savedRoutes = buildDashboardExampleRoutes();
  subjects[2].next(savedRoutes);
  expect(patch!.routePreviews).toEqual(savedRoutes);
  expect(patch!.previewEventsByRange?.['90d']).toEqual(accountEvents);
  service.watch(user, tile, { tiles: [], ...patch }).subscribe(detail => expect(detail.source).toBe('user'));
  expect(events.getEventsBy).toHaveBeenCalledOnce();
  subscription.unsubscribe(); expect(subjects.every(source$ => !source$.observed)).toBe(true);
  expect(derived.ensureForDashboard).not.toHaveBeenCalled();
 });
 it('keeps event windows separate and applies each chart’s activity filter after the shared read', () => {
  const service = TestBed.inject(DashboardChartPreviewService);
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'custom-distance-columns')!.tile;
  const thirtyDays = { ...tile, eventFilters: { range: '30d', activityTypes: [] } };
  const accountEvents = buildDashboardExampleEvents(Date.now());
  events.getEventsBy.mockReturnValueOnce(of(accountEvents)).mockReturnValueOnce(of([]));
  let patch: Partial<DashboardPreviewInput>;
  service.watchLibraryContexts(user, [tile, thirtyDays], { tiles: [] }).subscribe(value => patch = value);
  expect(events.getEventsBy).toHaveBeenCalledTimes(2);
  expect(buildDashboardThumbnailPreview(tile, { tiles: [], ...patch }).source).toBe('user');
  expect(buildDashboardThumbnailPreview(thirtyDays, { tiles: [], ...patch }).source).toBe('example');
  const running = { ...tile, eventFilters: { range: '90d', activityTypes: ['Running'] } };
  const row = buildDashboardThumbnailPreview(running, { tiles: [], ...patch });
  let detail: DashboardChartPreview;
  service.watch(user, running, { tiles: [], ...patch }).subscribe(value => detail = value);
  expect(detail!.tile['data']).toEqual(row.tile['data']);
  expect(row.tile['data'].every(item => item.type === 'Running')).toBe(true);
  expect(events.getEventsBy).toHaveBeenCalledTimes(2);
 });
 it('does not reuse a 90-day library read when settings select another range', () => {
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'custom-distance-columns')!.tile;
  const changed = { ...tile, eventFilters: { range: '30d', activityTypes: [] } };
  TestBed.inject(DashboardChartPreviewService).watch(user, changed, { tiles: [],
    previewStates: { 'events:90d': 'ready' }, previewEventsByRange: { '90d': buildDashboardExampleEvents() },
  }).subscribe();
  expect(events.getEventsBy).toHaveBeenCalledOnce();
  const bounds = events.getEventsBy.mock.calls[0][1];
  expect(bounds[1].value - bounds[0].value).toBe(30 * 86400000);
 });
 it('does not repeat a known empty read on selection and keeps failures explicitly labeled', () => {
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-sleep')!.tile;
  let result: DashboardChartPreview;
  TestBed.inject(DashboardChartPreviewService).watch(user, tile, { tiles: [], previewStates: { sleep: 'error' } }).subscribe(value => result = value);
  expect(result!.source).toBe('example'); expect(result!.loading).toBe(false);
  expect(result!.availability?.label).toContain('Could not load'); expect(sleep.watchForDashboard).not.toHaveBeenCalled();
 });
 it('does nothing until subscribed, shares a bounded event query and releases its listener', () => {
  const cleanup = vi.fn(); events.getEventsBy.mockReturnValue(new Observable(subscriber => { subscriber.next(buildDashboardExampleEvents()); return cleanup; }));
  const service = TestBed.inject(DashboardChartPreviewService);
  const tiles = getDashboardChartCatalog().filter(entry => entry.definition.category === 'custom').slice(0,2);
  const first$ = service.watch(user, tiles[0].tile, { tiles: [] });
  expect(events.getEventsBy).not.toHaveBeenCalled();
  const a = first$.subscribe(); const b = service.watch(user, tiles[1].tile, { tiles: [] }).subscribe();
  expect(events.getEventsBy).toHaveBeenCalledTimes(1);
  const clauses = events.getEventsBy.mock.calls[0][1];
  expect(clauses[1].value - clauses[0].value).toBe(90*86400000);
  a.unsubscribe(); expect(cleanup).not.toHaveBeenCalled(); b.unsubscribe(); expect(cleanup).toHaveBeenCalledTimes(1);
 });
 it('uses existing derived context without an extra read and never requests a rebuild', () => {
  const entry = getDashboardChartCatalog().find(entry => entry.definition.id === 'kpi-acwr')!;
  const values: DashboardChartPreview[] = [];
  TestBed.inject(DashboardChartPreviewService).watch(user, entry.tile, { tiles: [], derivedMetrics: { acwr: { ratio: 1.2, acuteLoad7: 400, chronicLoad28: 330, latestDayMs: Date.now(), trend8Weeks: [] } } }).subscribe(value => values.push(value));
  expect(values.at(-1)?.source).toBe('user'); expect(derived.watch).not.toHaveBeenCalled(); expect(derived.ensureForDashboard).not.toHaveBeenCalled();
 });
 it('reuses the current event window but queries again for a navigated window', () => {
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'custom-distance-columns')!.tile;
  const seed = { tiles: [tile], tileEventsByOrder: { [tile.order]: buildDashboardExampleEvents() } };
  const service = TestBed.inject(DashboardChartPreviewService);
  service.watch(user, tile, seed).subscribe();
  expect(events.getEventsBy).not.toHaveBeenCalled();
  service.watch(user, tile, { ...seed, tileEventAnchorsByOrder: { [tile.order]: Date.now()-90*86400000 } }).subscribe();
  expect(events.getEventsBy).toHaveBeenCalledTimes(1);
 });
 it('loads HRV through the Health adapter and reuses only matching current data', () => {
  const tile = getDashboardChartCatalog().find(entry => entry.definition.id === 'curated-hrv')!.tile;
  const context = buildDashboardExamplePreview(tile).tile['hrvTrend'];
  context.window = dashboardHrvWindows().visible;
  hrv.watch.mockReturnValue(of(context));
  const service = TestBed.inject(DashboardChartPreviewService);
  let result: DashboardChartPreview;
  service.watch(user, tile, { tiles: [], hrvTrend: context }).subscribe(value => result = value);
  expect(result!.source).toBe('user'); expect(hrv.watch).not.toHaveBeenCalled();
  service.watch(user, tile, { tiles: [] }).subscribe(value => result = value);
  expect(hrv.watch).toHaveBeenCalledWith(user.uid, '14d', expect.any(Number), user.settings.unitSettings);
  expect(result!.tile['hrvTrend']).toEqual(context);
  expect(sleep.watchForDashboard).not.toHaveBeenCalled(); expect(events.getEventsBy).not.toHaveBeenCalled();
  hrv.watch.mockReturnValue(of({ ...context, charts: [] }));
  service.watch(user, tile, { tiles: [] }).subscribe(value => result = value);
  expect(result!.source).toBe('example');
 });
 it('labels failed and missing personal data as an example without mixing sources', () => {
  events.getEventsBy.mockReturnValue(throwError(() => new Error('offline')));
  const tile = getDashboardChartCatalog().find(entry => entry.definition.category === 'custom')!.tile;
  const values: DashboardChartPreview[] = [];
  TestBed.inject(DashboardChartPreviewService).watch(user, tile, { tiles: [] }).subscribe(value => values.push(value));
  expect(values[0].loading).toBe(true); expect(values.at(-1)?.source).toBe('example'); expect(values.at(-1)?.availability?.label).toContain('Could not load');
  expect(derived.ensureForDashboard).not.toHaveBeenCalled();
 });
});
