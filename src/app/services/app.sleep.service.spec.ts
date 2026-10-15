import { BrowserCompatibilityService } from './browser.compatibility.service';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, BehaviorSubject, throwError } from 'rxjs';
import { nightlyHealthAccountKey } from '@shared/nightly-hrv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  limit,
  orderBy,
  query,
  where,
  getDocsFromServer,
  startAfter,
} from 'app/firebase/firestore';
import { AppSleepService } from './app.sleep.service';
import { HrvHistoryService } from './hrv-history.service';

vi.mock('app/firebase/firestore', () => {
  class MockFirestore { }
  return {
    Firestore: MockFirestore,
    documentId: vi.fn(() => "__name__"),
    startAfter: vi.fn((...values) => ({type: "startAfter", values})),
    collection: vi.fn((_firestore, ...path: string[]) => ({ path })),
    collectionData: vi.fn(() => of([])),
    doc: vi.fn((_firestore, ...path: string[]) => ({ path })),
    docData: vi.fn(() => of(undefined)),
    limit: vi.fn((value: number) => ({ type: 'limit', value })),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({ collectionRef, constraints })),
    where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
    getDocsFromServer: vi.fn(),
  };
});

describe('AppSleepService', () => {
  let service: AppSleepService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectionData).mockReturnValue(of([]));
    vi.mocked(docData).mockReturnValue(of(undefined));
    TestBed.configureTestingModule({
      providers: [
        AppSleepService,
        { provide: Firestore, useValue: {} },
        { provide: BrowserCompatibilityService, useValue: { checkWebCryptoSupport: () => true } },
      ],
    });
    service = TestBed.inject(AppSleepService);
  });

  it('updates an existing sleep when matching nightly Health HRV arrives later', async () => {
    const start = Date.parse('2026-09-10T22:00:00Z'), end = start + 28800000;
    const health$ = new BehaviorSubject<unknown[]>([]);
    const accountKey = await nightlyHealthAccountKey('user-1', 'GarminAPI', 'provider-account');
    vi.mocked(collectionData).mockImplementation(q => {
      const path = (q as unknown as {collectionRef: {path: string[]}}).collectionRef.path;
      return path.at(-1) === 'healthSourceRecords' ? health$ : of([{id: 'sleep', userID: 'user-1', source: {provider: 'GarminAPI', providerUserId: 'provider-account'},
        sleepDate: '2026-09-11', startTimeMs: start, endTimeMs: end, durationSeconds: 28800, isNap: false}]);
    });
    const values: unknown[] = [];
    const sub = service.watchForDashboard('user-1', start, end).subscribe(sessions => values.push(sessions[0].vitals?.overnightHrvMs));
    await vi.waitFor(() => expect(values).toEqual([undefined]));
    health$.next([{id: 'hrv', userID: 'user-1', schemaVersion: 1, kind: 'interval_summary', source: {provider: 'GarminAPI', accountKey},
      calendarDate: '2026-09-11', startTimeMs: start, endTimeMs: end, metrics: [{kind: 'value', metricId: 'heart_rate_variability', valueType: 'number',
        aggregation: 'average', semanticVariant: 'overnight_rmssd', origin: 'provider_summary', recordingMethod: 'provider_calculated', normalizationStatus: 'canonical', canonical: {value: 44, unit: 'ms'}}]}]);
    await vi.waitFor(() => expect(values).toEqual([undefined, 44]));
    health$.next([]);
    await vi.waitFor(() => expect(values).toEqual([undefined, 44, undefined]));
    sub.unsubscribe();
  });

  it('pages bounded native summaries without starting optional HRV enrichment', async () => {
    const start = Date.parse('2026-09-01T00:00:00Z'), end = Date.parse('2026-10-15T00:00:00Z');
    const docs = Array.from({ length: 33 }, (_, i) => ({ id: `night-${i}`, data: () => ({
      startTimeMs: start + i * 1000, endTimeMs: start + i * 1000 + 800, source: { provider: 'GarminAPI' },
    }) }));
    vi.mocked(getDocsFromServer).mockResolvedValueOnce({ docs, size: 33 } as never)
      .mockResolvedValueOnce({ docs: docs.slice(32), size: 1 } as never);
    const loaded = await service.loadSummaryRange('owner', start, end, () => true);
    expect(loaded.complete).toBe(true); expect(loaded.sessions).toHaveLength(33);
    expect(limit).toHaveBeenCalledWith(33); expect(startAfter).toHaveBeenCalledWith(docs[31]);
    expect(collectionData).not.toHaveBeenCalled();
  });
  it('returns incomplete native summaries at the record budget, not an apparently complete result', async () => {
    const docs = Array.from({ length: 33 }, (_, i) => ({ id: `night-${i}`, data: () => ({ startTimeMs: 10, endTimeMs: 20 }) }));
    vi.mocked(getDocsFromServer).mockResolvedValue({ docs, size: 33 } as never);
    const loaded = await service.loadSummaryRange('owner', 1, 100, () => true);
    expect(loaded).toMatchObject({ complete: false, limitReached: 'records' });
    expect(loaded.sessions).toHaveLength(512); expect(getDocsFromServer).toHaveBeenCalledTimes(16);
  });
  it('fences paging and propagates failures rather than silently falling back', async () => {
    let current = true;
    vi.mocked(getDocsFromServer).mockImplementationOnce(async () => { current = false; return { docs: [], size: 0 } as never; });
    await expect(service.loadSummaryRange('owner', 1, 100, () => current)).rejects.toThrow('cancelled');
    vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
    await expect(service.loadSummaryRange('owner', 1, 100, () => true)).rejects.toThrow('offline');
    await expect(service.loadSummaryRange('owner', 1, 100 * 86_400_000, () => true)).rejects.toThrow('Invalid');
  });
  it('reports a byte-limited read without using partial evidence as complete', async () => {
    const docs = [{ id: 'large', data: () => ({ startTimeMs: 10, endTimeMs: 20, providerFields: { value: 'é'.repeat(4_200_000) } }) }];
    vi.mocked(getDocsFromServer).mockResolvedValueOnce({ docs, size: 1 } as never);
    expect(await service.loadSummaryRange('owner', 1, 100, () => true)).toMatchObject({ sessions: [], complete: false, limitReached: 'bytes' });
  });

  it('listens beyond the first Health page and disposes every page', async () => {
    const start = Date.parse('2026-09-10T22:00:00Z'), end = start + 28800000;
    const accountKey = await nightlyHealthAccountKey('user-1', 'GarminAPI', 'provider-account');
    const hrv = {id: 'z-matching', userID: 'user-1', schemaVersion: 1, kind: 'interval_summary',
      source: {provider: 'GarminAPI', accountKey}, calendarDate: '2026-09-11', startTimeMs: start, endTimeMs: end,
      metrics: [{kind: 'value', metricId: 'heart_rate_variability', valueType: 'number', aggregation: 'average',
        semanticVariant: 'overnight_rmssd', origin: 'provider_summary', recordingMethod: 'provider_calculated',
        normalizationStatus: 'canonical', canonical: {value: 44, unit: 'ms'}}]};
    const first$ = new BehaviorSubject([...Array.from({length: 32}, (_, i) => ({...hrv, id: `a-${i}`, source: {...hrv.source, accountKey: 'other-account'}})), hrv]);
    const second$ = new BehaviorSubject([hrv]);
    vi.mocked(collectionData).mockImplementation(rawQuery => {
      const q = rawQuery as unknown as {collectionRef: {path: string[]}; constraints: Array<{type: string}>};
      if (q.collectionRef.path.at(-1) !== 'healthSourceRecords') return of([{id: 'sleep', source: {provider: 'GarminAPI', providerUserId: 'provider-account'},
        sleepDate: '2026-09-11', startTimeMs: start, endTimeMs: end, durationSeconds: 28800, isNap: false}]);
      return q.constraints.some(c => c.type === 'startAfter') ? second$ : first$;
    });
    const values: unknown[] = [];
    const sub = service.watchForDashboard('user-1', start, end).subscribe(sessions => values.push(sessions[0].vitals?.overnightHrvMs));
    await vi.waitFor(() => expect(values).toEqual([44]));
    expect(limit).toHaveBeenCalledWith(33);
    expect(second$.observed).toBe(true);
    second$.next([]);
    await vi.waitFor(() => expect(values).toEqual([44, undefined]));
    sub.unsubscribe();
    expect(first$.observed).toBe(false);
    expect(second$.observed).toBe(false);
  });

  it('keeps native Sleep evidence if the optional Health read fails', async () => {
    const start = Date.parse('2026-09-10T22:00:00Z'), end = start + 28800000;
    vi.mocked(collectionData).mockImplementation(rawQuery => {
      const q = rawQuery as unknown as {collectionRef: {path: string[]}};
      return q.collectionRef.path.at(-1) === 'healthSourceRecords' ? throwError(() => new Error('offline'))
        : of([{id: 'sleep', source: {provider: 'GarminAPI', providerUserId: 'provider-account'}, sleepDate: '2026-09-11',
          startTimeMs: start, endTimeMs: end, durationSeconds: 28800, isNap: false, vitals: {averageHeartRateBpm: 50}}]);
    });
    const result = await firstValueFrom(service.watchForDashboard('user-1', start, end));
    expect(result[0].durationSeconds).toBe(28800);
    expect(result[0].vitals).toEqual({averageHeartRateBpm: 50});
  });

  it('matches native Sleep to its Health account for highlights without an extra Health read', async () => {
    const start = Date.parse('2026-09-10T22:00:00Z'), end = start + 28800000;
    const session = { id: 'sleep', userID: 'user-1', source: { provider: 'GarminAPI', providerUserId: 'provider-account' },
      sleepDate: '2026-09-11', startTimeMs: start, endTimeMs: end, durationSeconds: 28800, isNap: false,
      vitals: { overnightHrvMs: 33 } };
    vi.mocked(collectionData).mockReturnValue(of([session]));
    const result = await firstValueFrom(service.watchForDashboard('user-1', start, end));
    expect(result[0]).toMatchObject({
      healthAccountKey: await nightlyHealthAccountKey('user-1', 'GarminAPI', 'provider-account'),
      vitals: { overnightHrvMs: 33 },
    });
    expect(session).not.toHaveProperty('healthAccountKey');
    expect(collectionData).toHaveBeenCalledOnce();
  });

  it('returns an empty stream without a user id', async () => {
    await expect(firstValueFrom(service.watchForDashboard('', null, null))).resolves.toEqual([]);
    expect(collection).not.toHaveBeenCalled();
  });

  it('shares exact HRV history listeners, isolates owners and drops them after the last subscriber', () => {
    const records$ = new BehaviorSubject([]);
    vi.mocked(collectionData).mockReturnValue(records$);
    const history = TestBed.inject(HrvHistoryService);
    const first = history.watch('owner', '2026-07-01', '2026-09-11').subscribe();
    const second = history.watch('owner', '2026-07-01', '2026-09-11').subscribe();
    expect(collectionData).toHaveBeenCalledOnce();
    const other = history.watch('other', '2026-07-01', '2026-09-11').subscribe();
    expect(collectionData).toHaveBeenCalledTimes(2);
    first.unsubscribe(); second.unsubscribe(); other.unsubscribe();
    expect(records$.observed).toBe(false);
    const fresh = history.watch('owner', '2026-07-01', '2026-09-11').subscribe();
    expect(collectionData).toHaveBeenCalledTimes(3);
    fresh.unsubscribe();
  });

  it('rejects an overfull HRV page instead of projecting partial data', async () => {
    vi.mocked(collectionData).mockReturnValue(of(Array.from({ length: 34 }, () => ({}))));
    await expect(firstValueFrom(TestBed.inject(HrvHistoryService).watch('owner', '2026-07-01', '2026-09-11')))
      .rejects.toThrow('read limit');
  });

  it('returns false for sleep availability without a user id', async () => {
    await expect(firstValueFrom(service.watchHasAnySleepSession(''))).resolves.toBe(false);
    expect(collection).not.toHaveBeenCalled();
  });

  it('checks sleep availability with a one-document query', async () => {
    vi.mocked(collectionData).mockReturnValue(of([
      { id: 'sleep-1', startTimeMs: 1, endTimeMs: 2 },
    ] as any));

    await expect(firstValueFrom(service.watchHasAnySleepSession('user-1'))).resolves.toBe(true);

    expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'sleepSessions');
    expect(limit).toHaveBeenCalledWith(1);
    expect(query).toHaveBeenCalled();
    expect(where).not.toHaveBeenCalled();
    expect(orderBy).not.toHaveBeenCalled();
  });

  it('queries with an overnight buffer and filters sessions by overlap', async () => {
    const start = Date.UTC(2026, 0, 5);
    const end = Date.UTC(2026, 0, 6);
    vi.mocked(collectionData).mockReturnValue(of([
      { id: 'kept-day', startTimeMs: start + 1000, endTimeMs: start + 2000, source: { provider: 'GarminAPI' } },
      { id: 'kept-overnight', startTimeMs: start - (2 * 60 * 60 * 1000), endTimeMs: start + 1, source: { provider: 'SuuntoApp' } },
      { id: 'filtered-before', startTimeMs: start - (20 * 60 * 60 * 1000), endTimeMs: start - 1, source: { provider: 'COROSAPI' } },
    ] as any));

    const sessions = await firstValueFrom(service.watchForDashboard('user-1', start, end));

    expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'sleepSessions');
    expect(where).toHaveBeenCalledWith('startTimeMs', '>=', start - (18 * 60 * 60 * 1000));
    expect(where).toHaveBeenCalledWith('startTimeMs', '<=', end);
    expect(orderBy).toHaveBeenCalledWith('startTimeMs', 'desc');
    expect(limit).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    expect(sessions.map(session => session.id)).toEqual(['kept-overnight', 'kept-day']);
  });

  it('strictly rehydrates new-format sleep aggregates for dashboard consumers', async () => {
    const start = Date.UTC(2026, 0, 5);
    const end = start + (8 * 60 * 60 * 1000);
    vi.mocked(collectionData).mockReturnValue(of([{
      id: 'new-format',
      startTimeMs: start,
      endTimeMs: end,
      stageDurationsSeconds: {},
      source: { provider: 'GarminAPI' },
      sportsLibData: {
        schemaVersion: 1,
        metrics: {
          duration: { 'Sleep Duration': 28_800 },
          deepDuration: { 'Deep Sleep Duration': 3_600 },
          score: { 'Sleep Score': 90 },
          averageHrv: { 'Average Sleep HRV': 62 },
        },
      },
    }] as any));

    const sessions = await firstValueFrom(service.watchForDashboard('user-1', start, end));

    expect(sessions[0]).toMatchObject({
      durationSeconds: 28_800,
      stageDurationsSeconds: { deep: 3_600 },
      score: { value: 90 },
      vitals: { averageHrvMs: 62 },
    });
    expect(sessions[0]).not.toHaveProperty('sportsLibData');
  });

  it('does not cap explicit 90-day windows before client-side sorting and filtering', async () => {
    const end = Date.UTC(2026, 3, 30);
    const start = end - (90 * 24 * 60 * 60 * 1000);

    await firstValueFrom(service.watchForDashboard('user-1', start, end));

    expect(where).toHaveBeenCalledWith('startTimeMs', '>=', start - (18 * 60 * 60 * 1000));
    expect(where).toHaveBeenCalledWith('startTimeMs', '<=', end);
    expect(orderBy).toHaveBeenCalledWith('startTimeMs', 'desc');
    expect(limit).not.toHaveBeenCalled();
  });

  it('queries all sleep sessions without applying the fallback limit when start is zero', async () => {
    const end = Date.UTC(2026, 3, 30);
    vi.mocked(collectionData).mockReturnValue(of([
      { id: 'later', startTimeMs: Date.UTC(2026, 0, 2), endTimeMs: Date.UTC(2026, 0, 2, 7), source: { provider: 'SuuntoApp' } },
      { id: 'earlier', startTimeMs: Date.UTC(2026, 0, 1), endTimeMs: Date.UTC(2026, 0, 1, 7), source: { provider: 'SuuntoApp' } },
    ] as any));

    const sessions = await firstValueFrom(service.watchForDashboard('user-1', 0, end));

    expect(where).toHaveBeenCalledWith('startTimeMs', '>=', 0);
    expect(where).toHaveBeenCalledWith('startTimeMs', '<=', end);
    expect(orderBy).toHaveBeenCalledWith('startTimeMs', 'desc');
    expect(limit).not.toHaveBeenCalled();
    expect(sessions.map(session => session.id)).toEqual(['earlier', 'later']);
  });

  it('keeps the fallback query bounded when no explicit start is provided', async () => {
    const end = Date.UTC(2026, 3, 30);

    await firstValueFrom(service.watchForDashboard('user-1', null, end));

    expect(where).toHaveBeenCalledWith('startTimeMs', '>=', end - (90 * 24 * 60 * 60 * 1000) - (18 * 60 * 60 * 1000));
    expect(where).toHaveBeenCalledWith('startTimeMs', '<=', end);
    expect(orderBy).toHaveBeenCalledWith('startTimeMs', 'desc');
    expect(limit).toHaveBeenCalledWith(250);
  });

  it('watches a provider sleep sync state document', async () => {
    vi.mocked(docData).mockReturnValue(of({
      provider: 'SuuntoApp',
      status: 'ready',
      nextBackfillAllowedAtMs: 1_800_000_000_000,
      updatedAtMs: 1_700_000_000_000,
    } as any));

    const state = await firstValueFrom(service.watchSyncState('user-1', 'SuuntoApp'));

    expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'sleepSyncState', 'SuuntoApp');
    expect(docData).toHaveBeenCalledWith(expect.anything());
    expect(state?.nextBackfillAllowedAtMs).toBe(1_800_000_000_000);
  });

  it('uses server-confirmed snapshots when sync state controls import admission', async () => {
    await expect(firstValueFrom(service.watchSyncState('user-1', 'SuuntoApp', { waitForServer: true }))).resolves.toBeNull();
    expect(docData).toHaveBeenCalledWith(expect.anything(), { waitForServer: true });
  });
});
