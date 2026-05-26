import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const capturedTaskOptions: unknown[] = [];
    const reparseEventFromOriginalFiles = vi.fn();
    const writeReparseStatus = vi.fn();
    const isReparsePersistenceSkippedForUserDeletionError = vi.fn((error: unknown) =>
        error instanceof Error && error.name === 'EventWriteSkippedForDeletedUserError');
    const resolveTargetSportsLibVersion = vi.fn(() => '9.0.99');
    const getSportsLibReparseEventDurationMs = vi.fn(() => null);
    const isSportsLibReparseDurationHeavy = vi.fn((durationMs: number | null | undefined) =>
        typeof durationMs === 'number' && durationMs > 32 * 60 * 60 * 1000);
    const enqueueSportsLibReparseHeavyTask = vi.fn().mockResolvedValue(true);
    const getUserDeletionGuardState = vi.fn().mockResolvedValue({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    });
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
    const eventDocGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
    const doc = vi.fn(() => ({ get: eventDocGet }));

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        capturedTaskOptions,
        reparseEventFromOriginalFiles,
        writeReparseStatus,
        isReparsePersistenceSkippedForUserDeletionError,
        resolveTargetSportsLibVersion,
        getSportsLibReparseEventDurationMs,
        isSportsLibReparseDurationHeavy,
        enqueueSportsLibReparseHeavyTask,
        getUserDeletionGuardState,
        runtimeDefaults,
        jobGet,
        jobSet,
        collection,
        eventDocGet,
        doc,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: (opts: unknown, handler: any) => {
        hoisted.capturedTaskOptions.push(opts);
        return handler;
    },
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_HEAVY_REASONS: { Duration: 'duration_gt_32h', ManualAdmin: 'manual_admin' },
    SPORTS_LIB_REPARSE_JOBS_COLLECTION: 'sportsLibReparseJobs',
    SPORTS_LIB_REPARSE_PROCESSING_TIERS: { Normal: 'normal', Heavy: 'heavy' },
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    getSportsLibReparseEventDurationMs: hoisted.getSportsLibReparseEventDurationMs,
    isSportsLibReparseDurationHeavy: hoisted.isSportsLibReparseDurationHeavy,
    reparseEventFromOriginalFiles: hoisted.reparseEventFromOriginalFiles,
    isReparsePersistenceSkippedForUserDeletionError: hoisted.isReparsePersistenceSkippedForUserDeletionError,
    writeReparseStatus: hoisted.writeReparseStatus,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueSportsLibReparseHeavyTask: hoisted.enqueueSportsLibReparseHeavyTask,
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        readonly name = 'UserDeletionGuardReadError';
        constructor(uid: string, phase: string, originalError: unknown) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
            this.cause = originalError;
        }
    },
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
        doc: hoisted.doc,
    }));
    Object.assign(firestoreFn, {
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
            delete: hoisted.deleteField,
        },
    });
    return { firestore: firestoreFn };
});

import { processSportsLibReparseHeavyTask, processSportsLibReparseTask } from './sports-lib-reparse-worker';

describe('processSportsLibReparseTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.runtimeDefaults.enabled = false;
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.enqueueLimit = 100;
        hoisted.runtimeDefaults.uidAllowlist = null;
        hoisted.eventDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
        hoisted.getSportsLibReparseEventDurationMs.mockReturnValue(null);
        hoisted.isSportsLibReparseDurationHeavy.mockImplementation((durationMs: number | null | undefined) =>
            typeof durationMs === 'number' && durationMs > 32 * 60 * 60 * 1000);
        hoisted.enqueueSportsLibReparseHeavyTask.mockResolvedValue(true);
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.reparseEventFromOriginalFiles.mockResolvedValue({
            status: 'completed',
            sourceFilesCount: 1,
            parsedActivitiesCount: 1,
            staleActivitiesDeleted: 0,
        });
    });

    it('should register with reparse runtime limits', () => {
        expect(hoisted.capturedTaskOptions[0]).toMatchObject({
            memory: '1GiB',
            cpu: 2,
            concurrency: 1,
            timeoutSeconds: 1800,
        });
        expect(hoisted.capturedTaskOptions[0]).not.toHaveProperty('maxInstances');
    });

    it('should register heavy worker with capped heavy runtime limits and retry config', () => {
        expect(hoisted.capturedTaskOptions[1]).toMatchObject({
            memory: '8GiB',
            cpu: 2,
            concurrency: 1,
            maxInstances: 1,
            timeoutSeconds: 1800,
            retryConfig: expect.objectContaining({
                maxAttempts: 2,
            }),
            rateLimits: {
                maxConcurrentDispatches: 1,
                maxDispatchesPerSecond: 1,
            },
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

        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            mode: 'reimport',
            targetSportsLibVersion: '9.0.99',
            beforePersist: expect.any(Function),
        }));
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'completed',
            targetSportsLibVersion: '9.0.99',
        }));
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
        }), { merge: true });
    });

    it('should no-op before reparse writes when the user is missing or deletion is active', async () => {
        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({
            userExists: false,
            deletionInProgress: false,
            shouldSkip: true,
        });
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'deleted-user',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.jobSet).not.toHaveBeenCalled();
    });

    it('should no-op before persisting reparsed event data when deletion starts mid-run', async () => {
        hoisted.getUserDeletionGuardState
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            })
            .mockResolvedValueOnce({
                userExists: false,
                deletionInProgress: false,
                shouldSkip: true,
            });
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'deleted-user',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });
        hoisted.reparseEventFromOriginalFiles.mockImplementation(async (_uid, _eventId, options) => {
            await options.beforePersist();
            return {
                status: 'completed',
                sourceFilesCount: 1,
                parsedActivitiesCount: 1,
                staleActivitiesDeleted: 0,
            };
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.jobSet).toHaveBeenCalledTimes(1);
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'processing',
        }), { merge: true });
    });

    it('should mark job failed before rethrowing deletion guard read errors during reparse', async () => {
        hoisted.getUserDeletionGuardState
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            })
            .mockRejectedValueOnce(new Error('guard read failed'));
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
        hoisted.reparseEventFromOriginalFiles.mockImplementation(async (_uid, _eventId, options) => {
            await options.beforePersist();
            return {
                status: 'completed',
                sourceFilesCount: 1,
                parsedActivitiesCount: 1,
                staleActivitiesDeleted: 0,
            };
        });

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } }))
            .rejects.toThrow('Could not read deletion guard for user u1 during sports_lib_reparse_worker.');

        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'processing',
        }), { merge: true });
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
            status: 'failed',
            lastError: 'Could not read deletion guard for user u1 during sports_lib_reparse_worker.',
        }), { merge: true });
    });

    it('should no-op before writing reparse status when deletion starts after parsing', async () => {
        hoisted.getUserDeletionGuardState
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            })
            .mockResolvedValueOnce({
                userExists: false,
                deletionInProgress: false,
                shouldSkip: true,
            });
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'deleted-user',
                eventId: 'e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.jobSet).toHaveBeenCalledTimes(1);
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'processing',
        }), { merge: true });
    });

    it('should requeue duration-heavy jobs to the heavy worker without parsing on normal worker', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                eventPath: 'users/u1/events/e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
                eventDurationMs: 33 * 60 * 60 * 1000,
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseHeavyTask).toHaveBeenCalledWith('job-1');
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'duration_gt_32h',
            eventDurationMs: 33 * 60 * 60 * 1000,
        }), { merge: true });
    });

    it('should leave duration-heavy jobs pending when the heavy task already exists', async () => {
        hoisted.enqueueSportsLibReparseHeavyTask.mockResolvedValueOnce(false);
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                eventPath: 'users/u1/events/e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
                eventDurationMs: 33 * 60 * 60 * 1000,
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseHeavyTask).toHaveBeenCalledWith('job-1');
        expect(hoisted.jobSet).toHaveBeenCalledTimes(1);
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'duration_gt_32h',
            eventDurationMs: 33 * 60 * 60 * 1000,
        }), { merge: true });
    });

    it('should no-op before heavy requeue writes when deletion starts after the start check', async () => {
        hoisted.getUserDeletionGuardState
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            })
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'deleting-user',
                eventId: 'e1',
                eventPath: 'users/deleting-user/events/e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
                eventDurationMs: 33 * 60 * 60 * 1000,
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
        expect(hoisted.jobSet).not.toHaveBeenCalled();
    });

    it('should mark job failed when the deletion guard cannot be read before heavy requeue', async () => {
        hoisted.getUserDeletionGuardState
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            })
            .mockRejectedValueOnce(new Error('guard read failed'));
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                eventPath: 'users/u1/events/e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
                eventDurationMs: 33 * 60 * 60 * 1000,
            }),
        });

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } }))
            .rejects.toThrow('Could not read deletion guard for user u1 during sports_lib_reparse_worker.');

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            lastError: 'Could not read deletion guard for user u1 during sports_lib_reparse_worker.',
        }), { merge: true });
    });

    it('should skip jobs already marked heavy when a normal retry task fires', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                eventPath: 'users/u1/events/e1',
                status: 'pending',
                processingTier: 'heavy',
                heavyReason: 'manual_admin',
                attemptCount: 1,
                targetSportsLibVersion: '9.0.99',
            }),
        });

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
        expect(hoisted.jobSet).not.toHaveBeenCalled();
    });

    it('should process duration-heavy jobs on the heavy worker', async () => {
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({
                uid: 'u1',
                eventId: 'e1',
                eventPath: 'users/u1/events/e1',
                status: 'pending',
                attemptCount: 0,
                targetSportsLibVersion: '9.0.99',
                eventDurationMs: 33 * 60 * 60 * 1000,
            }),
        });

        await (processSportsLibReparseHeavyTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.enqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            mode: 'reimport',
            targetSportsLibVersion: '9.0.99',
            beforePersist: expect.any(Function),
        }));
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'processing',
            processingTier: 'heavy',
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

        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            mode: 'reimport',
            targetSportsLibVersion: '9.1.4',
            beforePersist: expect.any(Function),
        }));
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

    it('should stop without completing when guarded completed status write skips for account deletion', async () => {
        const deletionSkipError = new Error('Skipping event write for deleted user.');
        deletionSkipError.name = 'EventWriteSkippedForDeletedUserError';
        hoisted.writeReparseStatus.mockRejectedValueOnce(deletionSkipError);
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

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'completed',
        }));
        expect(hoisted.jobSet).toHaveBeenCalledTimes(1);
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'processing',
        }), { merge: true });
    });

    it('should mark failed before rethrowing deletion guard read errors from failure status writes', async () => {
        const guardReadError = new Error('Could not read deletion guard for user u1 during sports_lib_reparse_status.');
        guardReadError.name = 'UserDeletionGuardReadError';
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
        hoisted.writeReparseStatus.mockRejectedValueOnce(guardReadError);

        await expect((processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } }))
            .rejects.toThrow('Could not read deletion guard for user u1 during sports_lib_reparse_status.');

        expect(hoisted.jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'processing',
        }), { merge: true });
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
            status: 'failed',
            lastError: 'Could not read deletion guard for user u1 during sports_lib_reparse_status.',
        }), { merge: true });
    });

    it('should mark job completed without failure status write when deletion starts after reparse failure', async () => {
        hoisted.getUserDeletionGuardState
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            })
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
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

        await (processSportsLibReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.jobSet).toHaveBeenCalledTimes(1);
        expect(hoisted.jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'processing',
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

        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            mode: 'reimport',
            targetSportsLibVersion: '9.0.99',
            beforePersist: expect.any(Function),
        }));
    });
});
