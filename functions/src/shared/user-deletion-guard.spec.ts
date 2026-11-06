import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';

import { getUserDeletionGuardedDocumentsInTransaction, isUserDeletionTombstoneActive, UserDeletionGuardReadError } from './user-deletion-guard';

describe('deletion guard read diagnostics', () => {
    beforeEach(() => vi.mocked(logger.warn).mockReset());

    it.each([
        [10, 'aborted'], [14, 'unavailable'], [4, 'deadline-exceeded'],
        ['9', 'failed-precondition'], ['firestore/permission-denied', 'permission-denied'],
        ['RESOURCE_EXHAUSTED', 'resource-exhausted'],
        ['private-code', 'unknown'], [99, 'unknown'], [-1, 'unknown'], [NaN, 'unknown'],
    ])('retains retry semantics and logs only the native code for %s', (code, expected) => {
        const original = Object.assign(new Error('private payload, token and document path'), {
            code, details: 'private-health-data', metadata: { authorization: 'private-secret' },
        });
        const error = new UserDeletionGuardReadError('private-user', 'private-phase', original);
        expect(error).toMatchObject({ name: 'UserDeletionGuardReadError', code: 'unavailable', statusCode: 503,
            uid: 'private-user', phase: 'private-phase', originalError: original });
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[UserDeletionGuard] Firestore guard read failed', {
            firestoreCode: expected,
        });
        expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/private|payload|token|path|metadata/);
    });

    it('handles a missing native code and failed logger without replacing the guard error', () => {
        vi.mocked(logger.warn).mockImplementationOnce(() => { throw new Error('logger unavailable'); });
        const original = new Error('read failed');
        expect(new UserDeletionGuardReadError('owner', 'phase', original).originalError).toBe(original);
        expect(logger.warn).toHaveBeenCalledWith('[UserDeletionGuard] Firestore guard read failed', { firestoreCode: 'unknown' });
    });
});

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
