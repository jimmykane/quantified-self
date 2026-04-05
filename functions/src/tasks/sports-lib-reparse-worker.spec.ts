import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: (_opts: unknown, handler: any) => handler,
}));

const hoisted = vi.hoisted(() => {
    const reparseEventFromOriginalFiles = vi.fn();
    const writeReparseStatus = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn(() => '9.0.99');
    const runtimeDefaults = {
        enabled: false,
        scanLimit: 200,
        enqueueLimit: 100,
        uidAllowlist: null as string[] | null,
    };

    const jobGet = vi.fn();
    const jobSet = vi.fn().mockResolvedValue(undefined);
    const jobDoc = { get: jobGet, set: jobSet };
    const collection = vi.fn(() => ({ doc: vi.fn(() => jobDoc) }));

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        reparseEventFromOriginalFiles,
        writeReparseStatus,
        resolveTargetSportsLibVersion,
        runtimeDefaults,
        jobGet,
        jobSet,
        collection,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_JOBS_COLLECTION: 'sportsLibReparseJobs',
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
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
        hoisted.runtimeDefaults.enabled = false;
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.enqueueLimit = 100;
        hoisted.runtimeDefaults.uidAllowlist = null;
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

    it('should throw when jobId is missing from task payload', async () => {
        await expect((processSportsLibReparseTask as any)({ data: {} })).rejects.toThrow(
            'Missing jobId in sports-lib reparse task payload.',
        );
        expect(hoisted.jobGet).not.toHaveBeenCalled();
        expect(hoisted.jobSet).not.toHaveBeenCalled();
    });

    it('should skip when job document does not exist', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: false,
            data: () => ({}),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'missing-job' } });

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

        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', {
            mode: 'reimport',
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

    it('should fallback to resolved target version when job targetSportsLibVersion is missing', async () => {
        hoisted.resolveTargetSportsLibVersion.mockReturnValue('9.1.4');
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 2,
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', {
            mode: 'reimport',
            targetSportsLibVersion: '9.1.4',
        });
    });

    it('should persist skipped status when strict reparse returns NO_ORIGINAL_FILES', async () => {
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
        hoisted.reparseEventFromOriginalFiles.mockResolvedValue({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
            sourceFilesCount: 0,
            parsedActivitiesCount: 0,
            staleActivitiesDeleted: 0,
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
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

    it('should mark failed and suppress retry on target/runtime version mismatch', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '11.0.2',
            }),
        });
        hoisted.reparseEventFromOriginalFiles.mockRejectedValue(new Error(
            '[sports-lib-reparse] Reparse target sports-lib version "11.0.2" does not match runtime sports-lib version "11.0.3"',
        ));

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } })).resolves.toBeUndefined();

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            lastError: '[sports-lib-reparse] Reparse target sports-lib version "11.0.2" does not match runtime sports-lib version "11.0.3"',
        }));
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            lastError: '[sports-lib-reparse] Reparse target sports-lib version "11.0.2" does not match runtime sports-lib version "11.0.3"',
        }), { merge: true });
    });

    it('should mark failed and suppress retry when event is missing', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '11.0.3',
            }),
        });
        hoisted.reparseEventFromOriginalFiles.mockRejectedValue(new Error(
            'Event e1 was not found for user u1',
        ));

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } })).resolves.toBeUndefined();

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            lastError: 'Event e1 was not found for user u1',
        }));
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            lastError: 'Event e1 was not found for user u1',
        }), { merge: true });
    });

    it('should process users without entitlement gating', async () => {
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

        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', {
            mode: 'reimport',
            targetSportsLibVersion: '9.0.99',
        });
    });
});
