import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Firestore,
  collection,
  collectionData,
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
      { id: 'kept-overnight', startTimeMs: start - (2 * 60 * 60 * 1000), endTimeMs: start + 1, source: { provider: 'SuuntoApp' } },
      { id: 'kept-day', startTimeMs: start + 1000, endTimeMs: start + 2000, source: { provider: 'GarminAPI' } },
      { id: 'filtered-before', startTimeMs: start - (20 * 60 * 60 * 1000), endTimeMs: start - 1, source: { provider: 'COROSAPI' } },
    ] as any));

    const sessions = await firstValueFrom(service.watchForDashboard('user-1', start, end));

    expect(collection).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1', 'sleepSessions');
    expect(where).toHaveBeenCalledWith('startTimeMs', '>=', start - (18 * 60 * 60 * 1000));
    expect(where).toHaveBeenCalledWith('startTimeMs', '<=', end);
    expect(orderBy).toHaveBeenCalledWith('startTimeMs', 'asc');
    expect(limit).toHaveBeenCalledWith(250);
    expect(query).toHaveBeenCalled();
    expect(sessions.map(session => session.id)).toEqual(['kept-overnight', 'kept-day']);
  });
});
