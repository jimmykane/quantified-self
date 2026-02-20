import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: (_opts: unknown, handler: any) => handler,
}));

const hoisted = vi.hoisted(() => {
    const hasPaidOrGraceAccess = vi.fn();
    const reparseEventFromOriginalFiles = vi.fn();
    const writeReparseStatus = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn(() => '9.0.99');

    const jobGet = vi.fn();
    const jobSet = vi.fn().mockResolvedValue(undefined);
    const jobDoc = { get: jobGet, set: jobSet };
    const collection = vi.fn(() => ({ doc: vi.fn(() => jobDoc) }));

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        hasPaidOrGraceAccess,
        reparseEventFromOriginalFiles,
        writeReparseStatus,
        resolveTargetSportsLibVersion,
        jobGet,
        jobSet,
        collection,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_JOBS_COLLECTION: 'sportsLibReparseJobs',
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    hasPaidOrGraceAccess: hoisted.hasPaidOrGraceAccess,
    reparseEventFromOriginalFiles: hoisted.reparseEventFromOriginalFiles,
    writeReparseStatus: hoisted.writeReparseStatus,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
    }));
    Object.assign(firestoreFn, {
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
            delete: hoisted.deleteField,
        },
    });
    return { firestore: firestoreFn };
});

import { processSportsLibReparseTask } from './sports-lib-reparse-worker';

describe('processSportsLibReparseTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS;
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(true);
        hoisted.reparseEventFromOriginalFiles.mockResolvedValue({
            status: 'completed',
            sourceFilesCount: 1,
            parsedActivitiesCount: 1,
            staleActivitiesDeleted: 0,
        });
    });

    it('should skip when job is already completed', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'completed',
                attemptCount: 1,
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.jobSet).not.toHaveBeenCalled();
    });

    it('should process and complete job successfully', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.hasPaidOrGraceAccess).toHaveBeenCalledWith('u1');
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', {
            targetSportsLibVersion: '9.0.99',
        });
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'completed',
            targetSportsLibVersion: '9.0.99',
        }));
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
        }), { merge: true });
    });

    it('should mark failed and rethrow on errors', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });
        hoisted.reparseEventFromOriginalFiles.mockRejectedValue(new Error('parse failed'));

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } })).rejects.toThrow('parse failed');

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            lastError: 'parse failed',
        }));
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            lastError: 'parse failed',
        }), { merge: true });
    });

    it('should fail with access denied when include-free-users flag is disabled', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } })).rejects.toThrow('USER_NO_PAID_ACCESS');
        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            reason: 'USER_NO_PAID_ACCESS',
            lastError: 'USER_NO_PAID_ACCESS',
        }));
    });

    it('should include free users when include-free-users flag is enabled', async () => {
        process.env.SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS = 'true';
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.hasPaidOrGraceAccess).not.toHaveBeenCalled();
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', {
            targetSportsLibVersion: '9.0.99',
        });
    });
});
