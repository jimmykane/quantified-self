import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
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
} from 'app/firebase/firestore';
import { AppSleepService } from './app.sleep.service';

vi.mock('app/firebase/firestore', () => {
  class MockFirestore { }
  return {
    Firestore: MockFirestore,
    collection: vi.fn((_firestore, ...path: string[]) => ({ path })),
    collectionData: vi.fn(() => of([])),
    doc: vi.fn((_firestore, ...path: string[]) => ({ path })),
    docData: vi.fn(() => of(undefined)),
    limit: vi.fn((value: number) => ({ type: 'limit', value })),
    orderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({ collectionRef, constraints })),
    where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
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
      ],
    });
    service = TestBed.inject(AppSleepService);
  });

  it('returns an empty stream without a user id', async () => {
    await expect(firstValueFrom(service.watchForDashboard('', null, null))).resolves.toEqual([]);
    expect(collection).not.toHaveBeenCalled();
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
    expect(state?.nextBackfillAllowedAtMs).toBe(1_800_000_000_000);
  });
});
