import { describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';

import { getUserDeletionGuardedDocumentsInTransaction, isUserDeletionTombstoneActive } from './user-deletion-guard';

describe('user deletion guard', () => {
    it('treats a tombstone with no expireAt as active', () => {
        expect(isUserDeletionTombstoneActive({}, Date.UTC(2026, 4, 6))).toBe(true);
    });

    it('treats future expireAt as active', () => {
        expect(isUserDeletionTombstoneActive({
            expireAt: { toMillis: () => Date.UTC(2026, 4, 7) },
        }, Date.UTC(2026, 4, 6))).toBe(true);
    });

    it('treats expired tombstones as inactive without deleting them', () => {
        const deleteSpy = vi.fn();
        expect(isUserDeletionTombstoneActive({
            expireAt: {
                toMillis: () => Date.UTC(2026, 4, 5),
                delete: deleteSpy,
            },
        }, Date.UTC(2026, 4, 6))).toBe(false);
        expect(deleteSpy).not.toHaveBeenCalled();
    });
});

describe('batched transaction deletion guard', () => {
    const db = { collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }) };
    const source = { path: 'users/owner/events/workout' };
    const snapshot = (exists: boolean, value?: unknown) => ({ exists, data: () => value });

    it.each([
        [true, undefined, false],
        [false, undefined, true],
        [true, {}, true],
        [true, { expireAt: Date.now() + 60_000 }, true],
        [true, { expireAt: 1 }, false],
    ])('keeps deletion policy for userExists=%s, tombstone=%j', async (exists, tombstone, shouldSkip) => {
        const saved = snapshot(true, { name: 'source' });
        const getAll = vi.fn().mockResolvedValue([snapshot(exists), snapshot(tombstone !== undefined, tombstone), saved]);
        const result = await getUserDeletionGuardedDocumentsInTransaction(db as unknown as Firestore, { getAll } as unknown as Transaction, 'owner', [source] as DocumentReference[]);
        expect(getAll).toHaveBeenCalledExactlyOnceWith({ path: 'users/owner' }, { path: 'userDeletionTombstones/owner' }, source);
        expect(result.guard.shouldSkip).toBe(shouldSkip);
        expect(result.snapshots).toEqual([saved]);
    });

    it('rereads both guard and sources on retry and propagates read failures', async () => {
        const getAll = vi.fn()
            .mockResolvedValueOnce([snapshot(true), snapshot(false), snapshot(true, { revision: 1 })])
            .mockResolvedValueOnce([snapshot(true), snapshot(true, {}), snapshot(true, { revision: 2 })])
            .mockRejectedValueOnce(new Error('read unavailable'));
        const read = () => getUserDeletionGuardedDocumentsInTransaction(db as unknown as Firestore, { getAll } as unknown as Transaction, 'owner', [source] as DocumentReference[]);
        expect((await read()).guard.shouldSkip).toBe(false);
        const retried = await read();
        expect(retried.guard.shouldSkip).toBe(true);
        expect(retried.snapshots[0].data()).toEqual({ revision: 2 });
        await expect(read()).rejects.toThrow('read unavailable');
        expect(getAll).toHaveBeenCalledTimes(3);
    });
});
