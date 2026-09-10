import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { DashboardChartPreviewService } from './dashboard-chart-preview.service';
import { DashboardDerivedMetricsService, createDashboardDerivedMetricsMissingState } from './dashboard-derived-metrics.service';
import { AppEventService } from './app.event.service';
import { AppSleepService } from './app.sleep.service';
import { AppRouteService } from './app.route.service';
import { getDashboardChartCatalog } from '../helpers/dashboard-chart-catalog.helper';
import { AppUserInterface } from '../models/app-user.interface';
import { buildDashboardExampleEvents, DashboardChartPreview } from '../helpers/dashboard-chart-preview.helper';

describe('read-only chart preview data', () => {
 const events = { getEventsBy: vi.fn() }; const derived = { watch: vi.fn(), ensureForDashboard: vi.fn() };
 const sleep = { watchForDashboard: vi.fn() }; const routes = { watchRecentRoutePreviews: vi.fn() };
 const user = { uid: 'test-owner', settings: { unitSettings: { startOfTheWeek: 1 }, dashboardSettings: { tiles: [] } } } as unknown as AppUserInterface;
 beforeEach(() => {
  vi.clearAllMocks(); events.getEventsBy.mockReturnValue(of([])); derived.watch.mockReturnValue(of(createDashboardDerivedMetricsMissingState())); sleep.watchForDashboard.mockReturnValue(of([])); routes.watchRecentRoutePreviews.mockReturnValue(of([]));
  TestBed.configureTestingModule({ providers: [DashboardChartPreviewService, { provide: AppEventService, useValue: events }, { provide: DashboardDerivedMetricsService, useValue: derived }, { provide: AppSleepService, useValue: sleep }, { provide: AppRouteService, useValue: routes }] });
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
 it('labels failed and missing personal data as an example without mixing sources', () => {
  events.getEventsBy.mockReturnValue(throwError(() => new Error('offline')));
  const tile = getDashboardChartCatalog().find(entry => entry.definition.category === 'custom')!.tile;
  const values: DashboardChartPreview[] = [];
  TestBed.inject(DashboardChartPreviewService).watch(user, tile, { tiles: [] }).subscribe(value => values.push(value));
  expect(values[0].loading).toBe(true); expect(values.at(-1)?.source).toBe('example'); expect(values.at(-1)?.note).toContain('Could not load');
  expect(derived.ensureForDashboard).not.toHaveBeenCalled();
 });
});
