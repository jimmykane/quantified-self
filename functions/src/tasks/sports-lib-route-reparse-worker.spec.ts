import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const mockJobGet = vi.fn();
    const mockJobSet = vi.fn();
    const mockRecursiveDelete = vi.fn();
    const mockReprocessRouteFromOriginalFile = vi.fn();
    const mockWriteRouteReparseStatus = vi.fn();
    const mockGetUserDeletionGuardState = vi.fn();
    const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const mockDelete = vi.fn(() => 'DELETE_FIELD');

    return {
        mockJobGet,
        mockJobSet,
        mockRecursiveDelete,
        mockReprocessRouteFromOriginalFile,
        mockWriteRouteReparseStatus,
        mockGetUserDeletionGuardState,
        mockServerTimestamp,
        mockDelete,
    };
});

vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: (_options: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => {
    const firestore = () => ({
        collection: (collectionName: string) => ({
            doc: (jobId: string) => ({
                path: `${collectionName}/${jobId}`,
                get: () => hoisted.mockJobGet(jobId),
                set: hoisted.mockJobSet,
            }),
        }),
        recursiveDelete: hoisted.mockRecursiveDelete,
    });
    (firestore as any).FieldValue = {
        serverTimestamp: hoisted.mockServerTimestamp,
        delete: hoisted.mockDelete,
    };
    return { firestore };
});

vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        processSportsLibRouteReparseTask: { name: 'processSportsLibRouteReparseTask', region: 'europe-west2' },
    },
}));

vi.mock('../shared/user-deletion-guard', () => {
    class MockUserDeletionGuardReadError extends Error {
        readonly name = 'UserDeletionGuardReadError';

        constructor(
            readonly uid: string,
            readonly phase: string,
            readonly originalError: unknown,
        ) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    }

    return {
        getUserDeletionGuardState: (...args: unknown[]) => hoisted.mockGetUserDeletionGuardState(...args),
        UserDeletionGuardReadError: MockUserDeletionGuardReadError,
    };
});

vi.mock('../reparse/sports-lib-route-reparse.service', () => ({
    SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION: 'sportsLibRouteReparseJobs',
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    assertRouteReparseRuntimeVersionMatchesTarget: vi.fn(),
    isRouteReparsePersistenceSkippedForUserDeletionError: vi.fn(() => false),
    isSportsLibRouteReparseTerminalFailureMessage: (message: string) => message.includes('does not match runtime'),
    resolveRouteReparseTargetSportsLibVersion: () => '16.0.2',
    writeRouteReparseStatus: (...args: unknown[]) => hoisted.mockWriteRouteReparseStatus(...args),
}));

vi.mock('../routes/reprocess-route', () => ({
    reprocessRouteFromOriginalFile: (...args: unknown[]) => hoisted.mockReprocessRouteFromOriginalFile(...args),
}));

import { processSportsLibRouteReparseTask } from './sports-lib-route-reparse-worker';

function makeJob(overrides: Record<string, unknown> = {}) {
    return {
        uid: 'user-1',
        routeId: 'route-1',
        routePath: 'users/user-1/routes/route-1',
        targetSportsLibVersion: '16.0.2',
        status: 'pending',
        attemptCount: 0,
        ...overrides,
    };
}

describe('processSportsLibRouteReparseTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mockGetUserDeletionGuardState.mockResolvedValue({
            shouldSkip: false,
            userExists: true,
            deletionInProgress: false,
        });
        hoisted.mockJobGet.mockResolvedValue({
            exists: true,
            data: () => makeJob(),
        });
        hoisted.mockReprocessRouteFromOriginalFile.mockResolvedValue({
            routeId: 'route-1',
            status: 'completed',
            sourceFilesCount: 1,
            routeCount: 1,
            waypointCount: 2,
            pointCount: 3,
        });
    });

    it('rejects missing jobId', async () => {
        await expect((processSportsLibRouteReparseTask as any)({ data: {} })).rejects.toThrow(
            'Missing jobId in sports-lib route reparse task payload.',
        );
    });

    it('skips missing jobs', async () => {
        hoisted.mockJobGet.mockResolvedValueOnce({ exists: false });

        await expect((processSportsLibRouteReparseTask as any)({ data: { jobId: 'missing-job' } })).resolves.toBeUndefined();

        expect(hoisted.mockReprocessRouteFromOriginalFile).not.toHaveBeenCalled();
        expect(hoisted.mockJobSet).not.toHaveBeenCalled();
    });

    it('reprocesses a route job and writes completed job/status state', async () => {
        await (processSportsLibRouteReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.mockReprocessRouteFromOriginalFile).toHaveBeenCalledWith('user-1', 'route-1');
        expect(hoisted.mockWriteRouteReparseStatus).toHaveBeenCalledWith(
            'user-1',
            'route-1',
            expect.objectContaining({
                status: 'completed',
                targetSportsLibVersion: '16.0.2',
            }),
        );
        expect(hoisted.mockJobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'processing',
            attemptCount: 1,
        }), { merge: true });
        expect(hoisted.mockJobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
        }), { merge: true });
    });

    it('marks no-original-file route jobs as skipped', async () => {
        hoisted.mockReprocessRouteFromOriginalFile.mockResolvedValueOnce({
            routeId: 'route-1',
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
            sourceFilesCount: 0,
            routeCount: 0,
            waypointCount: 0,
            pointCount: 0,
        });

        await (processSportsLibRouteReparseTask as any)({ data: { jobId: 'job-1' } });

        expect(hoisted.mockWriteRouteReparseStatus).toHaveBeenCalledWith(
            'user-1',
            'route-1',
            expect.objectContaining({
                status: 'skipped',
                reason: 'NO_ORIGINAL_FILES',
            }),
        );
        expect(hoisted.mockJobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'skipped',
        }), { merge: true });
    });
});
