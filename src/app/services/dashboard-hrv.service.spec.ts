import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';
import { projectLoadedHealthRange } from '@shared/health-query';
import type { HealthSourceRecord } from '@shared/health';
import type { SleepSession } from '@shared/sleep';
import { enrichSleepWithNightlyHrv, nightlyHealthAccountKey } from '@shared/nightly-hrv';
import { AppSleepService } from './app.sleep.service';
import { HrvHistoryService } from './hrv-history.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { DashboardHrvService } from './dashboard-hrv.service';
import { buildDashboardHrvContext, dashboardHrvWindows } from '../helpers/dashboard-hrv-context.helper';

describe('read-only dashboard HRV data', () => {
  const history = { watch: vi.fn() };
  const sleep = { watchSessions: vi.fn(), watchForDashboard: vi.fn() };
  const end = new Date(2026, 8, 10, 12).getTime();
  let records: HealthSourceRecord[];
  let sessions: SleepSession[];
  beforeEach(async () => {
    vi.clearAllMocks();
    const accountKey = await nightlyHealthAccountKey('owner', 'GarminAPI', 'source');
    sessions = Array.from({ length: 74 }, (_, index) => {
      const endTimeMs = end - index * 86_400_000;
      return { id: `sleep-${index}`, userID: 'owner', source: { provider: 'GarminAPI' as const, providerUserId: 'source', sourceSessionKey: `night-${index}` },
        sleepDate: new Date(endTimeMs).toISOString().slice(0, 10), startTimeMs: endTimeMs - 8 * 3_600_000, endTimeMs,
        durationSeconds: 8 * 3_600, isNap: false, stages: [], stageDurationsSeconds: {}, createdAtMs: endTimeMs, updatedAtMs: endTimeMs };
    });
    records = sessions.map((session, index): HealthSourceRecord => ({
      schemaVersion: 1, id: `hrv-${index}`, userID: 'owner', kind: 'interval_summary',
      calendarDate: session.sleepDate, startTimeMs: session.startTimeMs, endTimeMs: session.endTimeMs,
      source: { provider: 'GarminAPI', accountKey, sourceRecordType: 'overnight', sourceRecordKey: `hrv-${index}`,
        revision: { order: 1, token: 'one', digest: 'test' }, receivedAtMs: end },
      metricIds: ['heart_rate_variability'], metrics: [{ kind: 'value', metricId: 'heart_rate_variability', valueType: 'number',
        aggregation: 'average', semanticVariant: 'overnight_rmssd', origin: 'provider_summary', recordingMethod: 'provider_calculated',
        normalizationStatus: 'canonical', quality: { status: 'valid' }, native: { metric: 'hrv', value: 40 + index % 11, unit: 'ms' },
        canonical: { value: 40 + index % 11, unit: 'ms' } }],
      coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: end, updatedAtMs: end,
    }));
    history.watch.mockReturnValue(of(records));
    sleep.watchSessions.mockReturnValue(of(sessions));
    TestBed.configureTestingModule({ providers: [
      { provide: HrvHistoryService, useValue: history }, { provide: AppSleepService, useValue: sleep },
      { provide: BrowserCompatibilityService, useValue: { checkWebCryptoSupport: () => true } },
    ] });
  });
  it('starts one Health read and one native Sleep read, including the 60-day baseline for a year view', async () => {
    const stream$ = TestBed.inject(DashboardHrvService).watch('owner', '1y', end);
    expect(history.watch).not.toHaveBeenCalled();
    const context = await firstValueFrom(stream$);
    expect(history.watch.mock.calls).toEqual([['owner', '2025-07-13', '2026-09-10']]);
    expect(sleep.watchSessions).toHaveBeenCalledOnce();
    expect(sleep.watchSessions.mock.calls[0][2]).toBe(context.window.endTimeMs);
    expect(sleep.watchForDashboard).not.toHaveBeenCalled();
    expect(context.charts.length).toBeGreaterThan(0);
  });
  it('preserves Health source models, enrichment, values and the historical personal range', async () => {
    const windows = dashboardHrvWindows('14d', end);
    const project = (window: { startDate: string; endDate: string }) => projectLoadedHealthRange(records, [], {
      ...window, metricIds: ['heart_rate_variability'], includeSamples: false,
    }, { sourceRecordsComplete: true, samplesComplete: true });
    const previous = buildDashboardHrvContext(project(windows.visible), project(windows.history),
      await enrichSleepWithNightlyHrv('owner', sessions, records), windows.visible);
    const context = await firstValueFrom(TestBed.inject(DashboardHrvService).watch('owner', '14d', end));
    expect(context).toEqual(previous);
    expect(context.charts.every(chart => chart.model.series.points.length === 14)).toBe(true);
    expect(context.charts.some(chart => chart.status?.normalRange)).toBe(true);
  });
  it('shares concurrent tile/preview requests and releases both live sources with the final consumer', () => {
    const health$ = new BehaviorSubject(records);
    const sleep$ = new BehaviorSubject(sessions);
    history.watch.mockReturnValue(health$); sleep.watchSessions.mockReturnValue(sleep$);
    const service = TestBed.inject(DashboardHrvService);
    const first = service.watch('owner', '14d', end).subscribe();
    const second = service.watch('owner', '14d', end).subscribe();
    expect(history.watch).toHaveBeenCalledOnce(); expect(sleep.watchSessions).toHaveBeenCalledOnce();
    first.unsubscribe(); expect(health$.observed).toBe(true);
    second.unsubscribe(); expect(health$.observed).toBe(false); expect(sleep$.observed).toBe(false);
    const reopened = service.watch('owner', '14d', end).subscribe();
    expect(history.watch).toHaveBeenCalledTimes(2);
    reopened.unsubscribe();
  });
  it('reads only extra provider dates for boundary-crossing nights without duplicating the main history', async () => {
    const windows = dashboardHrvWindows('14d', end);
    const night = { ...sessions[0], sleepDate: '2026-09-11' };
    const boundaryRecord = { ...records[0], calendarDate: night.sleepDate };
    history.watch.mockImplementation((_uid, _start, last) => of(last === night.sleepDate ? [boundaryRecord] : []));
    sleep.watchSessions.mockReturnValue(of([night]));
    const context = await firstValueFrom(TestBed.inject(DashboardHrvService).watch('owner', '14d', end));
    expect(history.watch.mock.calls).toEqual([
      ['owner', windows.history.startDate, windows.visible.endDate],
      ['owner', '2026-09-11', '2026-09-11'],
    ]);
    const project = (window: { startDate: string; endDate: string }) => projectLoadedHealthRange([], [], {
      ...window, metricIds: ['heart_rate_variability'], includeSamples: false,
    }, { sourceRecordsComplete: true, samplesComplete: true });
    const enriched = await enrichSleepWithNightlyHrv('owner', [night], [boundaryRecord]);
    expect(enriched[0].vitals?.overnightHrvMs).toBe(40);
    expect(context).toEqual(buildDashboardHrvContext(project(windows.visible), project(windows.history), enriched, windows.visible));
  });
  it('waits for complete initial sources and tracks later Health updates and removals', async () => {
    const health$ = new Subject<HealthSourceRecord[]>();
    const sleep$ = new Subject<SleepSession[]>();
    history.watch.mockReturnValue(health$); sleep.watchSessions.mockReturnValue(sleep$);
    const next = vi.fn();
    const sub = TestBed.inject(DashboardHrvService).watch('owner', '14d', end).subscribe(next);
    health$.next(records); expect(next).not.toHaveBeenCalled();
    sleep$.next([]);
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(next.mock.calls[0][0].charts[0].model.series.points).toHaveLength(14);
    health$.next([]);
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(2));
    expect(next.mock.calls[1][0].charts).toEqual([]);
    sub.unsubscribe();
  });
  it('propagates incomplete history and permits a fresh retry without a cached error', async () => {
    history.watch.mockReturnValueOnce(throwError(() => new Error('HRV history exceeds the read limit.')));
    const service = TestBed.inject(DashboardHrvService);
    await expect(firstValueFrom(service.watch('owner', '14d', end))).rejects.toThrow('read limit');
    await expect(firstValueFrom(service.watch('owner', '14d', end))).resolves.toMatchObject({ loading: false, error: false });
    expect(history.watch).toHaveBeenCalledTimes(2);
  });
  it('keeps different owners and windows in separate requests', () => {
    history.watch.mockReturnValue(new Subject()); sleep.watchSessions.mockReturnValue(new Subject());
    const service = TestBed.inject(DashboardHrvService);
    const subs = [service.watch('owner', '14d', end), service.watch('other-owner', '14d', end), service.watch('owner', '30d', end)].map(stream$ => stream$.subscribe());
    expect(history.watch).toHaveBeenCalledTimes(3);
    subs.forEach(sub => sub.unsubscribe());
  });
});
