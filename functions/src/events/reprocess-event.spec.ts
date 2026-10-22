import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const mockGet = vi.fn();
    const mockDoc = vi.fn(() => ({ get: mockGet }));
    const mockReparseEventFromOriginalFiles = vi.fn();
    const mockUpdateActivityAscent = vi.fn();
    const mockUpdateActivityElevation = vi.fn();
    let onCallOptions: unknown = null;

    return {
        mockGet,
        mockDoc,
        mockReparseEventFromOriginalFiles,
        mockUpdateActivityAscent,
        mockUpdateActivityElevation,
        getOnCallOptions: () => onCallOptions,
        setOnCallOptions: (options: unknown) => {
            onCallOptions = options;
        },
    };
});

vi.mock('firebase-functions/v2/https', () => ({
    onCall: (options: unknown, handler: unknown) => {
        hoisted.setOnCallOptions(options);
        return handler;
    },
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
vi.mock('./activity-ascent.service', () => ({
    updateActivityElevation: (...args: unknown[]) => hoisted.mockUpdateActivityElevation(...args),
    updateActivityAscent: (...args: unknown[]) => hoisted.mockUpdateActivityAscent(...args),
}));

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

    it('should register with reparse runtime limits', () => {
        expect(hoisted.getOnCallOptions()).toMatchObject({
            memory: '4GiB',
            cpu: 2,
            concurrency: 1,
            timeoutSeconds: 3600,
            maxInstances: 20,
        });
    });

    it('should reject unauthenticated requests', async () => {
        await expect(reprocessEvent({
            auth: null,
            app: { appId: 'app-id' },
            data: { eventId: 'e1', mode: 'reimport' },
        } as any)).rejects.toMatchObject({ code: 'unauthenticated' });
    });
    it('routes an owner-bound ascent correction through its strict service without reparsing files', async () => {
        const edit = { activityId: 'leg', ascent: 75, expectedSourceFingerprint: 'a'.repeat(64), expectedCorrection: null };
        const saved = { activityId: 'leg', ascent: 75, eventAscent: 275, correction: { value: 75, sourceValue: 100 } };
        hoisted.mockUpdateActivityAscent.mockResolvedValueOnce(saved);
        const result = await reprocessEvent({ auth: { uid: 'u1' }, app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'correct_ascent', expectedOwner: 'u1', edit } } as any);
        expect(hoisted.mockUpdateActivityAscent).toHaveBeenCalledWith('u1', 'event-1', edit);
        expect(hoisted.mockReparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(result).toEqual({ eventId: 'event-1', mode: 'correct_ascent', status: 'completed', ascent: saved });
    });
    it('rejects an owner change and unexpected ascent-call fields', async () => {
        const request = { auth: { uid: 'u1' }, app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'correct_ascent', expectedOwner: 'other', edit: {} } };
        await expect(reprocessEvent(request as any)).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(reprocessEvent({ ...request, data: { ...request.data, expectedOwner: 'u1', stats: {} } } as any))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(hoisted.mockUpdateActivityAscent).not.toHaveBeenCalled();
    });

    it('routes descent through the owner-bound elevation service and rejects expanded requests', async () => {
        const edit = { activityId: 'leg', metric: 'descent', value: 75, expectedSourceFingerprint: 'a'.repeat(64), expectedCorrection: null };
        const saved = { activityId: 'leg', metric: 'descent', value: 75, eventValue: 75, correction: { value: 75, sourceValue: 100 } };
        const request = { auth: { uid: 'u1' }, app: { appId: 'app-id' },
            data: { eventId: 'event-1', mode: 'correct_elevation', expectedOwner: 'u1', edit } };
        hoisted.mockUpdateActivityElevation.mockResolvedValueOnce(saved);
        expect(await reprocessEvent(request as any)).toEqual({ eventId: 'event-1', mode: 'correct_elevation', status: 'completed', elevation: saved });
        expect(hoisted.mockUpdateActivityElevation).toHaveBeenCalledWith('u1', 'event-1', edit);
        await expect(reprocessEvent({ ...request, data: { ...request.data, expectedOwner: 'other' } } as any))
            .rejects.toMatchObject({ code: 'permission-denied' });
        await expect(reprocessEvent({ ...request, data: { ...request.data, stats: {} } } as any))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(hoisted.mockUpdateActivityElevation).toHaveBeenCalledOnce();
        expect(hoisted.mockReparseEventFromOriginalFiles).not.toHaveBeenCalled();
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

    it('returns a skip reason without exposing private source classification metadata', async () => {
        hoisted.mockReparseEventFromOriginalFiles.mockResolvedValue({ status: 'skipped', reason: 'ROUTE_SOURCE',
            sourceFilesCount: 1, parsedActivitiesCount: 0, staleActivitiesDeleted: 0,
            nonActivitySources: { sources: [{ path: 'private-path', md5: 'private-checksum' }] } });
        const result = await reprocessEvent({ auth: { uid: 'u1' }, app: { appId: 'app-id' },
            data: { eventId: 'e1', mode: 'reimport' } } as any);
        expect(result).toMatchObject({ status: 'skipped', reason: 'ROUTE_SOURCE' });
        expect(result).not.toHaveProperty('nonActivitySources');
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
