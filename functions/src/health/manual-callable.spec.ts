import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class MockHttpsError extends Error {
        constructor(public readonly code: string, message: string) {
            super(message);
        }
    },
    onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ error: hoisted.loggerError }));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        saveManualHealthMeasurement: { region: 'europe-west2' },
        deleteManualHealthMeasurement: { region: 'europe-west2' },
    },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./manual-measurements', () => ({
    saveManualHealthMeasurement: hoisted.save,
    deleteManualHealthMeasurement: hoisted.remove,
    ManualHealthValidationError: class ManualHealthValidationError extends Error {},
    ManualHealthMeasurementNotFoundError: class ManualHealthMeasurementNotFoundError extends Error {},
    ManualHealthRevisionConflictError: class ManualHealthRevisionConflictError extends Error {},
    ManualHealthWriteBlockedError: class ManualHealthWriteBlockedError extends Error {},
}));

import {
    ManualHealthRevisionConflictError,
    ManualHealthValidationError,
} from './manual-measurements';
import {
    deleteManualHealthMeasurementCallable,
    saveManualHealthMeasurementCallable,
} from './manual-callable';

const saveCall = saveManualHealthMeasurementCallable as never as (request: unknown) => Promise<unknown>;
const deleteCall = deleteManualHealthMeasurementCallable as never as (request: unknown) => Promise<unknown>;

describe('manual Health callables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.save.mockResolvedValue({ sourceRecordId: 'a'.repeat(64), revisionOrder: 1 });
        hoisted.remove.mockResolvedValue({ deleted: true });
    });

    it('requires auth and App Check before owner-scoped storage access', async () => {
        await expect(saveCall({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
        hoisted.enforceAppCheck.mockImplementationOnce(() => {
            throw new Error('App Check verification failed.');
        });
        await expect(deleteCall({ auth: { uid: 'owner' }, data: {} })).rejects.toThrow('App Check');
        expect(hoisted.remove).not.toHaveBeenCalled();
    });

    it('derives ownership only from the authenticated context', async () => {
        const data = { mode: 'create' };
        await saveCall({ auth: { uid: 'owner' }, app: {}, data });
        expect(hoisted.save).toHaveBeenCalledWith('owner', data);
    });

    it('maps validation and revision errors without logging request data', async () => {
        hoisted.save.mockRejectedValueOnce(new ManualHealthValidationError('bad value'));
        await expect(saveCall({ auth: { uid: 'owner' }, app: {}, data: {} }))
            .rejects.toMatchObject({ code: 'invalid-argument', message: 'bad value' });
        hoisted.remove.mockRejectedValueOnce(new ManualHealthRevisionConflictError());
        await expect(deleteCall({ auth: { uid: 'owner' }, app: {}, data: {} }))
            .rejects.toMatchObject({ code: 'aborted' });
        expect(hoisted.loggerError).not.toHaveBeenCalled();
    });

    it('hides unexpected backend details', async () => {
        hoisted.save.mockRejectedValueOnce(new Error('private path'));
        await expect(saveCall({ auth: { uid: 'owner' }, app: {}, data: {} }))
            .rejects.toMatchObject({ code: 'internal' });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[ManualHealth] Owner-scoped mutation failed.',
            { errorName: 'Error' },
        );
    });
});
