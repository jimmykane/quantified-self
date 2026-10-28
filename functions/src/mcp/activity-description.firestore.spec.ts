import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentReference, FieldPath, Firestore, Query } from 'firebase-admin/firestore';
const { firestoreMock } = vi.hoisted(() => ({ firestoreMock: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: firestoreMock }));
import { firestoreActivityDescriptionReads } from './activity-description.service';

// Exercise real SDK query construction without network access or user data.
describe('MCP activity description Firestore adapter', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['activities', 'events'] as const)('selects only the authorized %s field under the owner', async collectionName => {
    const db = new Firestore({ projectId: 'demo-description-query' });
    firestoreMock.mockReturnValue(db);
    const where = vi.spyOn(Query.prototype, 'where');
    const select = vi.spyOn(Query.prototype, 'select');
    const limit = vi.spyOn(Query.prototype, 'limit');
    const set = vi.spyOn(DocumentReference.prototype, 'set');
    const collection = vi.spyOn(DocumentReference.prototype, 'collection');
    vi.spyOn(Query.prototype, 'get').mockResolvedValue({ docs: [] } as never);
    const read = collectionName === 'activities' ? firestoreActivityDescriptionReads.fetchActivity
      : firestoreActivityDescriptionReads.fetchEvent;
    expect(await read('fixture-owner', 'fixture-document')).toBeNull();
    expect(collection.mock.instances[0].path).toBe('users/fixture-owner');
    expect(collection).toHaveBeenCalledWith(collectionName);
    expect(where.mock.calls).toEqual([[FieldPath.documentId(), '==', 'fixture-document']]);
    expect(select.mock.calls).toEqual([[collectionName === 'activities' ? 'eventID' : 'description']]);
    expect(limit).toHaveBeenCalledWith(1);
    expect(set).not.toHaveBeenCalled();
  });
  it.each([[true, false, true], [false, false, false], [true, true, false]])(
    'requires an existing owner (%s) without a deletion tombstone (%s)', async (exists, tombstone, expected) => {
      const db = new Firestore({ projectId: 'demo-description-query' });
      firestoreMock.mockReturnValue(db);
      const getAll = vi.spyOn(db, 'getAll').mockResolvedValue([
        { exists }, { exists: tombstone, data: () => ({}) },
      ] as never);
      expect(await firestoreActivityDescriptionReads.activeOwner('fixture-owner')).toBe(expected);
      expect(getAll.mock.calls[0].map(ref => (ref as DocumentReference).path))
        .toEqual(['users/fixture-owner', 'userDeletionTombstones/fixture-owner']);
    });
});
