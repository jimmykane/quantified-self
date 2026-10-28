import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentReference, Firestore } from 'firebase-admin/firestore';

const { firestoreMock } = vi.hoisted(() => ({ firestoreMock: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: firestoreMock }));

import {
  firestoreActivityTagReads,
  MCP_ACTIVITY_TAG_EVENT_FIELDS,
} from './activity-tags.service';

describe('MCP activity-tag Firestore adapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads only tag fields from exact owner-scoped parent events', async () => {
    const db = new Firestore({ projectId: 'demo-activity-tag-query' });
    firestoreMock.mockReturnValue(db);
    const set = vi.spyOn(DocumentReference.prototype, 'set');
    const getAll = vi.spyOn(db, 'getAll').mockImplementation(async (...arguments_) => {
      const references = arguments_.slice(0, -1) as DocumentReference[];
      return references.map(reference => ({
        exists: true,
        id: reference.id,
        data: () => ({
          tags: ['Race'],
          name: 'private-name-canary',
          description: 'private-description-canary',
          creator: 'private-device-canary',
        }),
      })) as never;
    });

    const result = await firestoreActivityTagReads.fetchEvents(
      'fixture-owner',
      ['event-1', 'event-2'],
    );

    expect(getAll.mock.calls[0].slice(0, -1).map(reference => (
      reference as DocumentReference
    ).path)).toEqual([
      'users/fixture-owner/events/event-1',
      'users/fixture-owner/events/event-2',
    ]);
    expect(getAll.mock.calls[0].at(-1)).toEqual({
      fieldMask: [...MCP_ACTIVITY_TAG_EVENT_FIELDS],
    });
    expect(result.map(document => document.id)).toEqual(['event-1', 'event-2']);
    expect(set).not.toHaveBeenCalled();
  });

  it('skips missing parent events and avoids an empty Firestore read', async () => {
    const db = new Firestore({ projectId: 'demo-activity-tag-query' });
    firestoreMock.mockReturnValue(db);
    const getAll = vi.spyOn(db, 'getAll').mockResolvedValue([
      { exists: false, id: 'event-1' },
    ] as never);

    await expect(firestoreActivityTagReads.fetchEvents(
      'fixture-owner',
      ['event-1'],
    )).resolves.toEqual([]);
    await expect(firestoreActivityTagReads.fetchEvents(
      'fixture-owner',
      [],
    )).resolves.toEqual([]);
    expect(getAll).toHaveBeenCalledOnce();
  });
});
