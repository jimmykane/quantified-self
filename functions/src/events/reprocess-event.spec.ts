import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const mockGet = vi.fn();
    const mockDoc = vi.fn(() => ({ get: mockGet }));
    const mockReparseEventFromOriginalFiles = vi.fn();

    return {
        mockGet,
        mockDoc,
        mockReparseEventFromOriginalFiles,
    };
});

vi.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: unknown, handler: unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

vi.mock('firebase-admin', () => ({
    firestore: () => ({
        doc: hoisted.mockDoc,
    }),
}));

vi.mock('../utils', () => ({
    ALLOWED_CORS_ORIGINS: [],
    enforceAppCheck: (request: { app?: unknown }) => {
        if (!request.app) {
            throw new Error('App Check verification failed.');
        }
    },
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    reparseEventFromOriginalFiles: (...args: unknown[]) => hoisted.mockReparseEventFromOriginalFiles(...args),
}));

import { reprocessEvent } from './reprocess-event';

describe('reprocessEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mockGet.mockResolvedValue({ exists: true });
        hoisted.mockReparseEventFromOriginalFiles.mockResolvedValue({
            status: 'completed',
            sourceFilesCount: 1,
            parsedActivitiesCount: 1,
            staleActivitiesDeleted: 0,
        });
    });

    it('should reject unauthenticated requests', async () => {
        await expect(reprocessEvent({
            auth: null,
            app: { appId: 'app-id' },
            data: { eventId: 'e1', mode: 'reimport' },
        } as any)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('should reject requests without app check', async () => {
        await expect(reprocessEvent({
            auth: { uid: 'u1' },
            app: undefined,
            data: { eventId: 'e1', mode: 'reimport' },
        } as any)).rejects.toThrow('App Check verification failed.');
    });

    it('should validate input', async () => {
        await expect(reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: '', mode: 'reimport' },
        } as any)).rejects.toMatchObject({ code: 'invalid-argument' });

        await expect(reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: 'e1', mode: 'invalid' },
        } as any)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('should enforce ownership by reading user-scoped event path', async () => {
        hoisted.mockGet.mockResolvedValueOnce({ exists: false });

        await expect(reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'reimport' },
        } as any)).rejects.toMatchObject({ code: 'not-found' });

        expect(hoisted.mockDoc).toHaveBeenCalledWith('users/u1/events/event-1');
        expect(hoisted.mockReparseEventFromOriginalFiles).not.toHaveBeenCalled();
    });

    it('should process reimport mode', async () => {
        const result = await reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'reimport' },
        } as any);

        expect(hoisted.mockReparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'event-1', { mode: 'reimport' });
        expect(result).toEqual({
            eventId: 'event-1',
            mode: 'reimport',
            status: 'completed',
            reason: undefined,
            sourceFilesCount: 1,
            parsedActivitiesCount: 1,
            staleActivitiesDeleted: 0,
        });
    });

    it('should return staleActivitiesDeleted count from reparse response', async () => {
        hoisted.mockReparseEventFromOriginalFiles.mockResolvedValueOnce({
            status: 'completed',
            sourceFilesCount: 1,
            parsedActivitiesCount: 2,
            staleActivitiesDeleted: 3,
        });

        const result = await reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'reimport' },
        } as any);

        expect(result.staleActivitiesDeleted).toBe(3);
    });

    it('should process regenerate mode with regenerate-specific reparse mode', async () => {
        const result = await reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: 'event-2', mode: 'regenerate' },
        } as any);

        expect(hoisted.mockReparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'event-2', { mode: 'regenerate' });
        expect(result.mode).toBe('regenerate');
    });

    it('should convert reparse failures to internal HttpsError', async () => {
        hoisted.mockReparseEventFromOriginalFiles.mockRejectedValueOnce(new Error('parse failed'));

        await expect(reprocessEvent({
            auth: { uid: 'u1' },
            app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'reimport' },
        } as any)).rejects.toMatchObject({ code: 'internal' });
    });
});
