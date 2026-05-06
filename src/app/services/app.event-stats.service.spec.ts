import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import {
  EVENT_STATS_COLLECTION_ID,
  EVENT_STATS_DOC_ID,
  EVENT_STATS_KIND,
  EVENT_STATS_SCHEMA_VERSION,
} from '@shared/event-stats';
import { AppEventStatsService } from './app.event-stats.service';

const hoisted = vi.hoisted(() => ({
  docMock: vi.fn(),
  docDataMock: vi.fn(),
}));

vi.mock('app/firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/firestore')>();
  class MockFirestore {}
  return {
    ...actual,
    Firestore: MockFirestore,
    doc: hoisted.docMock,
    docData: hoisted.docDataMock,
  };
});

describe('AppEventStatsService', () => {
  let service: AppEventStatsService;

  beforeEach(() => {
    hoisted.docMock.mockReset();
    hoisted.docDataMock.mockReset();
    hoisted.docMock.mockImplementation((_firestore, ...segments: string[]) => ({
      path: segments.join('/'),
    }));
    hoisted.docDataMock.mockReturnValue(of(undefined));

    TestBed.configureTestingModule({
      providers: [
        AppEventStatsService,
        { provide: Firestore, useValue: {} },
      ],
    });

    service = TestBed.inject(AppEventStatsService);
  });

  it('returns null without a user uid', async () => {
    const stats = await firstValueFrom(service.watchUserEventStats(null));

    expect(stats).toBeNull();
    expect(doc).not.toHaveBeenCalled();
    expect(docData).not.toHaveBeenCalled();
  });

  it('reads exact event stats after backfill', async () => {
    hoisted.docDataMock.mockReturnValueOnce(of({
      kind: EVENT_STATS_KIND,
      schemaVersion: EVENT_STATS_SCHEMA_VERSION,
      total: 12,
      standard: 10,
      benchmark: 2,
      backfilledAt: { seconds: 1, nanoseconds: 0 },
    }));

    const stats = await firstValueFrom(service.watchUserEventStats({ uid: 'user-1' }));

    expect(doc).toHaveBeenCalledWith(
      {},
      'users',
      'user-1',
      EVENT_STATS_COLLECTION_ID,
      EVENT_STATS_DOC_ID,
    );
    expect(stats).toEqual({
      total: 12,
      standard: 10,
      benchmark: 2,
      backfilled: true,
    });
  });

  it('hides stats until the backfill marker is present', async () => {
    hoisted.docDataMock.mockReturnValueOnce(of({
      kind: EVENT_STATS_KIND,
      schemaVersion: EVENT_STATS_SCHEMA_VERSION,
      total: 12,
      standard: 10,
      benchmark: 2,
    }));

    const stats = await firstValueFrom(service.watchUserEventStats({ uid: 'user-1' }));

    expect(stats).toBeNull();
  });

  it('normalizes malformed counts and suppresses read errors', async () => {
    hoisted.docDataMock.mockReturnValueOnce(of({
      kind: EVENT_STATS_KIND,
      schemaVersion: EVENT_STATS_SCHEMA_VERSION,
      total: '7',
      standard: -1,
      benchmark: Number.NaN,
      backfilledAt: true,
    }));

    const stats = await firstValueFrom(service.watchUserEventStats({ uid: 'user-1' }));

    expect(stats).toEqual({
      total: 0,
      standard: 0,
      benchmark: 0,
      backfilled: true,
    });

    hoisted.docDataMock.mockReturnValueOnce(throwError(() => new Error('permission-denied')));
    await expect(firstValueFrom(service.watchUserEventStats({ uid: 'user-1' }))).resolves.toBeNull();
  });
});
