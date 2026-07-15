import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) {
            super(message);
        }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));

const hoisted = vi.hoisted(() => {
    const transactionSet = vi.fn();
    const runTransaction = vi.fn(async (callback: (transaction: unknown) => unknown) => callback({
        set: transactionSet,
    }));
    const doc = vi.fn((path: string) => ({ path }));
    const firestore = Object.assign(vi.fn(() => ({ doc, runTransaction })), {
        FieldValue: { delete: vi.fn(() => ({ __delete__: true })) },
    });
    return {
        transactionSet,
        runTransaction,
        doc,
        firestore,
        enforceAppCheck: vi.fn(),
        getUserDeletionGuardState: vi.fn(),
        getUserDeletionGuardStateInTransaction: vi.fn(),
    };
});

vi.mock('firebase-admin', () => ({ firestore: hoisted.firestore }));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: { setTrainingVisibleDisciplines: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
}));

import {
    parseTrainingVisibleDisciplinesRequest,
    setTrainingVisibleDisciplines,
} from './set-training-visible-disciplines';

describe('setTrainingVisibleDisciplines', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({ shouldSkip: false });
    });

    it('requires authentication before accepting a settings write', async () => {
        await expect((setTrainingVisibleDisciplines as any)({ data: {} })).rejects.toMatchObject({
            code: 'unauthenticated',
        });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
    });

    it('stops before Firestore access when App Check verification fails', async () => {
        hoisted.enforceAppCheck.mockImplementationOnce(() => {
            throw new Error('App Check verification failed.');
        });

        await expect((setTrainingVisibleDisciplines as any)({
            auth: { uid: 'user-1' }, app: null, data: { visibleDisciplines: ['running'] },
        })).rejects.toThrow('App Check verification failed');
        expect(hoisted.firestore).not.toHaveBeenCalled();
    });

    it('canonicalizes and stores a non-empty explicit selection', async () => {
        const result = await (setTrainingVisibleDisciplines as any)({
            auth: { uid: 'user-1' },
            app: { appId: 'app-check' },
            data: { visibleDisciplines: ['swimming', 'cycling', 'running'] },
        });

        expect(hoisted.enforceAppCheck).toHaveBeenCalled();
        expect(hoisted.doc).toHaveBeenCalledWith('users/user-1/config/settings');
        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            { path: 'users/user-1/config/settings' },
            { trainingSettings: { visibleDisciplines: ['running', 'cycling', 'swimming'] } },
            { merge: true },
        );
        expect(result).toEqual({ accepted: true, visibleDisciplines: ['running', 'cycling', 'swimming'] });
    });

    it('deletes only the visibility field when automatic mode is restored', async () => {
        const result = await (setTrainingVisibleDisciplines as any)({
            auth: { uid: 'user-1' },
            app: { appId: 'app-check' },
            data: { visibleDisciplines: null },
        });

        expect(hoisted.transactionSet).toHaveBeenCalledWith(
            { path: 'users/user-1/config/settings' },
            { trainingSettings: { visibleDisciplines: { __delete__: true } } },
            { merge: true },
        );
        expect(result).toEqual({ accepted: true, visibleDisciplines: null });
    });

    it('rejects missing, empty, duplicate, and unsupported selections', () => {
        expect(() => parseTrainingVisibleDisciplinesRequest({})).toThrow('visibleDisciplines is required');
        expect(() => parseTrainingVisibleDisciplinesRequest({ visibleDisciplines: [] })).toThrow('one or more');
        expect(() => parseTrainingVisibleDisciplinesRequest({ visibleDisciplines: 'cycling' })).toThrow('supported');
        expect(() => parseTrainingVisibleDisciplinesRequest({
            visibleDisciplines: ['running', 'running'],
        })).toThrow('unique');
        expect(() => parseTrainingVisibleDisciplinesRequest({
            visibleDisciplines: ['rowing'],
        })).toThrow('supported');
    });

    it('checks deletion state before and inside the transaction', async () => {
        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: true });
        await expect((setTrainingVisibleDisciplines as any)({
            auth: { uid: 'user-1' }, app: {}, data: { visibleDisciplines: ['running'] },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(hoisted.runTransaction).not.toHaveBeenCalled();

        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({ shouldSkip: false });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({ shouldSkip: true });
        await expect((setTrainingVisibleDisciplines as any)({
            auth: { uid: 'user-1' }, app: {}, data: { visibleDisciplines: ['cycling'] },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(hoisted.transactionSet).not.toHaveBeenCalled();
    });
});
