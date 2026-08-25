import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthQueryValidationError } from '../../../shared/health-query';

const hoisted = vi.hoisted(() => ({
    enforceAppCheck: vi.fn(),
    readHealthRange: vi.fn(),
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
vi.mock('firebase-functions/logger', () => ({
    error: hoisted.loggerError,
}));
vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: { queryHealthRange: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({ enforceAppCheck: hoisted.enforceAppCheck }));
vi.mock('./query', () => ({ readHealthRange: hoisted.readHealthRange }));

import { queryHealthRange } from './callable';

describe('queryHealthRange callable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.readHealthRange.mockResolvedValue({ observations: [] });
    });

    it('requires authentication before App Check or Firestore access', async () => {
        await expect((queryHealthRange as never as (request: unknown) => Promise<unknown>)({ data: {} }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
        expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
        expect(hoisted.readHealthRange).not.toHaveBeenCalled();
    });

    it('enforces App Check before querying health data', async () => {
        hoisted.enforceAppCheck.mockImplementationOnce(() => {
            throw new Error('App Check verification failed.');
        });
        await expect((queryHealthRange as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' },
            data: {},
        })).rejects.toThrow('App Check verification failed');
        expect(hoisted.readHealthRange).not.toHaveBeenCalled();
    });

    it('derives ownership exclusively from the authenticated UID', async () => {
        const data = { startDate: '2026-01-01', endDate: '2026-01-02', userID: 'attacker-user' };
        await (queryHealthRange as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'owner-user' },
            app: { appId: 'app-check' },
            data,
        });

        expect(hoisted.readHealthRange).toHaveBeenCalledWith('owner-user', data);
    });

    it('maps bounded-query validation failures to invalid-argument', async () => {
        hoisted.readHealthRange.mockRejectedValueOnce(new HealthQueryValidationError('range is too large'));
        await expect((queryHealthRange as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' }, app: {}, data: {},
        })).rejects.toMatchObject({ code: 'invalid-argument', message: 'range is too large' });
        expect(hoisted.loggerError).not.toHaveBeenCalled();
    });

    it('does not expose unexpected storage errors', async () => {
        hoisted.readHealthRange.mockRejectedValueOnce(new Error('sensitive Firestore detail'));
        await expect((queryHealthRange as never as (request: unknown) => Promise<unknown>)({
            auth: { uid: 'user-1' }, app: {}, data: {},
        })).rejects.toMatchObject({ code: 'internal', message: 'Unable to query health data.' });
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[HealthQuery] Bounded health query failed.',
            { errorName: 'Error' },
        );
    });
});
