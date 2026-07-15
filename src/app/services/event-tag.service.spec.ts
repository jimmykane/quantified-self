import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { Firestore, deleteField, doc, runTransaction } from 'app/firebase/firestore';

import { EventTagService } from './event-tag.service';

vi.mock('app/firebase/firestore', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    deleteField: vi.fn(() => 'DELETE_FIELD'),
    doc: vi.fn((...pathParts: unknown[]) => ({ pathParts })),
    runTransaction: vi.fn(),
  };
});

describe('EventTagService', () => {
  let service: EventTagService;
  let transactionUpdate: ReturnType<typeof vi.fn>;
  let documents: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    documents = {};
    transactionUpdate = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_firestore, callback: any) => callback({
      get: vi.fn(async (ref: { pathParts: unknown[] }) => {
        const eventID = `${ref.pathParts.at(-1)}`;
        return {
          exists: () => !!documents[eventID],
          data: () => documents[eventID],
        };
      }),
      update: transactionUpdate,
    }));

    TestBed.configureTestingModule({
      providers: [
        EventTagService,
        { provide: Firestore, useValue: {} },
      ],
    });
    service = TestBed.inject(EventTagService);
  });

  it('saves normalized tags to the shared tags field', async () => {
    const event = { getID: () => 'event-1', tags: [], benchmarkReviewTags: ['legacy'] } as any;
    documents = { 'event-1': { tags: [], benchmarkReviewTags: ['legacy'] } };

    await expect(service.saveTags(
      { uid: 'user-1' } as any,
      event,
      [' race ', 'Race'],
      [],
    )).resolves.toEqual(['race']);

    expect(transactionUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { tags: ['race'], benchmarkReviewTags: 'DELETE_FIELD' },
    );
    expect(event.tags).toEqual(['race']);
    expect(event.benchmarkReviewTags).toBeUndefined();
    expect(deleteField).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale single-event editor without overwriting newer tags', async () => {
    const event = { getID: () => 'event-1', tags: ['Original'] } as any;
    documents = { 'event-1': { tags: ['Concurrent'] } };

    await expect(service.saveTags(
      { uid: 'user-1' } as any,
      event,
      ['Updated'],
      ['Original'],
    )).rejects.toThrow('Tags changed elsewhere');

    expect(transactionUpdate).not.toHaveBeenCalled();
    expect(event.tags).toEqual(['Original']);
  });

  it('applies removals before additions using fresh transaction data and legacy fallback', async () => {
    documents = {
      'event-1': { tags: ['Race', '2026'] },
      'event-2': { benchmarkReviewTags: ['Race', 'Firmware'] },
    };

    const result = await service.applyBulkChanges(
      { uid: 'user-1' } as any,
      ['event-1', 'event-2'],
      { add: ['Long run'], remove: ['race'] },
    );

    expect(result).toEqual({
      'event-1': ['2026', 'Long run'],
      'event-2': ['Firmware', 'Long run'],
    });
    expect(transactionUpdate).toHaveBeenCalledTimes(2);
    expect(transactionUpdate.mock.calls.map(call => call[1])).toEqual([
      { tags: ['2026', 'Long run'], benchmarkReviewTags: 'DELETE_FIELD' },
      { tags: ['Firmware', 'Long run'], benchmarkReviewTags: 'DELETE_FIELD' },
    ]);
    expect(deleteField).toHaveBeenCalledTimes(2);
  });

  it('rejects the whole transaction when any event would exceed the tag limit', async () => {
    documents = {
      'event-1': { tags: ['one'] },
      'event-2': { tags: Array.from({ length: 10 }, (_value, index) => `tag-${index}`) },
    };

    await expect(service.applyBulkChanges(
      { uid: 'user-1' } as any,
      ['event-1', 'event-2'],
      { add: ['overflow'], remove: [] },
    )).rejects.toThrow('would exceed 10 tags');
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it('rejects missing events and selections above the bulk limit', async () => {
    await expect(service.applyBulkChanges(
      { uid: 'user-1' } as any,
      ['missing'],
      { add: ['tag'], remove: [] },
    )).rejects.toThrow('no longer exist');

    await expect(service.applyBulkChanges(
      { uid: 'user-1' } as any,
      Array.from({ length: 251 }, (_value, index) => `event-${index}`),
      { add: ['tag'], remove: [] },
    )).rejects.toThrow('up to 250 events');
    expect(doc).toHaveBeenCalledTimes(1);
  });
});
