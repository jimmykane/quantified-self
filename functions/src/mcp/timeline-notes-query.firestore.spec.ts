import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentReference, FieldPath, Firestore, Query } from 'firebase-admin/firestore';
const { firestoreMock } = vi.hoisted(() => ({ firestoreMock: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: firestoreMock }));
import { firestoreTimelineNotesReads } from './timeline-notes.service';

// Exercise real SDK query construction without any network access or production data.
describe('MCP Timeline notes Firestore adapter', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['closed', 'ongoing'] as const)('uses the existing owner-scoped %s index and a narrow projection', async phase => {
    const db = new Firestore({ projectId: 'demo-notes-query' });
    firestoreMock.mockReturnValue(db);
    const where = vi.spyOn(Query.prototype, 'where');
    const orderBy = vi.spyOn(Query.prototype, 'orderBy');
    const select = vi.spyOn(Query.prototype, 'select');
    const limit = vi.spyOn(Query.prototype, 'limit');
    const startAfter = vi.spyOn(Query.prototype, 'startAfter');
    const set = vi.spyOn(DocumentReference.prototype, 'set');
    const collection = vi.spyOn(DocumentReference.prototype, 'collection');
    vi.spyOn(Query.prototype, 'get').mockResolvedValue({ docs: [] } as never);
    const position = { endDate: phase === 'closed' ? '2026-09-09' : null,
      startDate: '2025-01-01', id: 'a'.repeat(64) };
    await firestoreTimelineNotesReads.fetchPage('fixture-owner', { startDate: '2026-09-01', endDate: '2026-09-30' }, phase, 64, position);
    expect(collection.mock.instances[0].path).toBe('users/fixture-owner');
    expect(collection).toHaveBeenCalledWith('timelineNotes');
    expect(where.mock.calls).toEqual([
      ['startDate', '<=', '2026-09-30'], ['endDate', phase === 'closed' ? '>=' : '==', phase === 'closed' ? '2026-09-01' : null],
    ]);
    expect(orderBy.mock.calls).toEqual([['endDate'], ['startDate'], [FieldPath.documentId()]]);
    expect(select.mock.calls).toEqual([['category', 'title', 'details', 'startDate', 'endDate', 'timeZone',
      'revision', 'createdAtMs', 'updatedAtMs']]);
    expect(limit).toHaveBeenCalledWith(64);
    expect(startAfter).toHaveBeenCalledWith(position.endDate, position.startDate, position.id);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([[true, false, true], [false, false, false], [true, true, false]])(
    'requires an existing owner (%s) without an active deletion tombstone (%s)', async (exists, tombstone, expected) => {
      const db = new Firestore({ projectId: 'demo-notes-query' });
      firestoreMock.mockReturnValue(db);
      const getAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        { exists }, { exists: tombstone, data: () => ({}) },
      ] as never);
      expect(await firestoreTimelineNotesReads.activeOwner('fixture-owner')).toBe(expected);
      expect(getAll.mock.calls[0].map(ref => (ref as DocumentReference).path))
        .toEqual(['users/fixture-owner', 'userDeletionTombstones/fixture-owner']);
    },
  );
});
