import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    readActivityHealthRange: vi.fn(),
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
    FUNCTIONS_MANIFEST: { queryActivityHealthRange: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./activity-query', () => ({
    ActivityHealthQueryValidationError: class MockValidationError extends Error {},
    readActivityHealthRange: hoisted.readActivityHealthRange,
}));

import { ActivityHealthQueryValidationError } from './activity-query';
import { queryActivityHealthRange } from './activity-callable';

const call = queryActivityHealthRange as never as (request: unknown) => Promise<unknown>;

describe('queryActivityHealthRange callable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.readActivityHealthRange.mockResolvedValue({ observations: [], complete: true });
    });

    it('requires authentication before App Check and storage access', async () => {
        await expect(call({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
        expect(hoisted.readActivityHealthRange).not.toHaveBeenCalled();
    });

    it('enforces App Check before storage access', async () => {
        hoisted.enforceAppCheck.mockImplementationOnce(() => {
            throw new Error('App Check verification failed.');
        });
        await expect(call({ auth: { uid: 'owner' }, data: {} })).rejects.toThrow('App Check');
        expect(hoisted.readActivityHealthRange).not.toHaveBeenCalled();
    });

    it('derives the query owner exclusively from authenticated context', async () => {
        const data = { metricId: 'body_weight', startTimeMs: START_MS, endTimeMs: END_MS };
        await call({ auth: { uid: 'owner' }, app: {}, data });
        expect(hoisted.readActivityHealthRange).toHaveBeenCalledWith('owner', data);
    });

    it('maps validation errors without logging the request', async () => {
        hoisted.readActivityHealthRange.mockRejectedValueOnce(new ActivityHealthQueryValidationError('bad range'));
        await expect(call({ auth: { uid: 'owner' }, app: {}, data: {} }))
            .rejects.toMatchObject({ code: 'invalid-argument', message: 'bad range' });
        expect(hoisted.loggerError).not.toHaveBeenCalled();
    });

    it('does not expose unexpected storage errors', async () => {
        hoisted.readActivityHealthRange.mockRejectedValueOnce(new Error('private storage detail'));
        await expect(call({ auth: { uid: 'owner' }, app: {}, data: {} }))
            .rejects.toMatchObject({ code: 'internal', message: 'Unable to query workout Health data.' });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[ActivityHealthQuery] Bounded workout Health query failed.',
            { errorName: 'Error' },
        );
    });
});

const START_MS = Date.UTC(2026, 0, 1);
const END_MS = Date.UTC(2026, 0, 31);
