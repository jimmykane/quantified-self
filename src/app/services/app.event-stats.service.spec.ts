import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore, collection, getCountFromServer } from 'app/firebase/firestore';
import { AppEventStatsService } from './app.event-stats.service';

const hoisted = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  getCountFromServerMock: vi.fn(),
}));

vi.mock('app/firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/firestore')>();
  class MockFirestore {}
  return {
    ...actual,
    Firestore: MockFirestore,
    collection: hoisted.collectionMock,
    getCountFromServer: hoisted.getCountFromServerMock,
  };
});

describe('AppEventStatsService', () => {
  let service: AppEventStatsService;

  beforeEach(() => {
    hoisted.collectionMock.mockReset();
    hoisted.getCountFromServerMock.mockReset();
    hoisted.collectionMock.mockImplementation((_firestore, ...segments: string[]) => ({
      path: segments.join('/'),
    }));
    hoisted.getCountFromServerMock.mockResolvedValue({ data: () => ({ count: 0 }) });

    TestBed.configureTestingModule({
      providers: [
        AppEventStatsService,
        { provide: Firestore, useValue: {} },
      ],
    });

    service = TestBed.inject(AppEventStatsService);
  });

  it('returns null without a user uid', async () => {
    const stats = await firstValueFrom(service.loadUserEventStats(null));

    expect(stats).toBeNull();
    expect(collection).not.toHaveBeenCalled();
    expect(getCountFromServer).not.toHaveBeenCalled();
  });

  it('counts current user event documents from Firestore aggregation', async () => {
    hoisted.getCountFromServerMock.mockResolvedValueOnce({ data: () => ({ count: 12 }) });

    const stats = await firstValueFrom(service.loadUserEventStats({ uid: 'user-1' }));

    expect(collection).toHaveBeenCalledWith(
      {},
      'users',
      'user-1',
      'events',
    );
    expect(getCountFromServer).toHaveBeenCalledWith({ path: 'users/user-1/events' });
    expect(stats).toEqual({ total: 12 });
  });

  it('normalizes malformed counts and suppresses read errors', async () => {
    hoisted.getCountFromServerMock.mockResolvedValueOnce({ data: () => ({ count: Number.NaN }) });

    const stats = await firstValueFrom(service.loadUserEventStats({ uid: 'user-1' }));

    expect(stats).toEqual({ total: 0 });

    hoisted.getCountFromServerMock.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(firstValueFrom(service.loadUserEventStats({ uid: 'user-1' }))).resolves.toBeNull();
  });
});
