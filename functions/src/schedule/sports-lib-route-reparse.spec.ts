import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const mockRuntimeDefaults = {
        enabled: false,
        scanLimit: 10,
        enqueueLimit: 10,
        uidAllowlist: [] as string[],
    };
    const mockCheckpointGet = vi.fn();
    const mockCheckpointSet = vi.fn();
    const mockProcessingQueryGet = vi.fn();
    const mockCollectionGroupWhere = vi.fn();
    const mockRouteQueryGet = vi.fn();
    const mockRouteDocGet = vi.fn();
    const mockRouteStatusGet = vi.fn();
    const mockJobGet = vi.fn();
    const mockJobSet = vi.fn();
    const mockEnqueueRouteTask = vi.fn();
    const mockShouldRouteBeReparsed = vi.fn();
    const mockExtractPrimaryRouteSourceFile = vi.fn();
    const mockWriteRouteReparseStatus = vi.fn();
    const mockGetUserDeletionGuardState = vi.fn();
    const mockRecursiveDelete = vi.fn();
    const mockServerTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const mockDelete = vi.fn(() => 'DELETE_FIELD');

    return {
        mockRuntimeDefaults,
        mockCheckpointGet,
        mockCheckpointSet,
        mockProcessingQueryGet,
        mockCollectionGroupWhere,
        mockRouteQueryGet,
        mockRouteDocGet,
        mockRouteStatusGet,
        mockJobGet,
        mockJobSet,
        mockEnqueueRouteTask,
        mockShouldRouteBeReparsed,
        mockExtractPrimaryRouteSourceFile,
        mockWriteRouteReparseStatus,
        mockGetUserDeletionGuardState,
        mockRecursiveDelete,
        mockServerTimestamp,
        mockDelete,
    };
});

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_options: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

function makeRouteDoc(path = 'users/user-1/routes/route-1', data: Record<string, unknown> = {}) {
    const ref = {
        path,
        collection: () => ({
            doc: () => ({
                get: hoisted.mockRouteStatusGet,
            }),
        }),
    };
    return {
        id: path.split('/').pop(),
        ref,
        data: () => ({
            originalFiles: [{ path: 'users/user-1/routes/route-1/source.gpx' }],
            ...data,
        }),
    };
}

function makeProcessingDoc(
    routePath = 'users/user-1/routes/route-1',
    data: Record<string, unknown> = {
        processingEntity: 'route',
        sportsLibVersion: '16.0.1',
        sportsLibVersionCode: 16_000_001,
    },
) {
    return {
        ref: {
            path: `${routePath}/metaData/processing`,
        },
        data: () => data,
    };
}

vi.mock('firebase-admin', () => {
    const firestore = () => ({
        doc: (path: string) => {
            if (path === 'systemJobs/sportsLibRouteReparse') {
                return {
                    path,
                    get: hoisted.mockCheckpointGet,
                    set: hoisted.mockCheckpointSet,
                };
            }
            return {
                path,
                get: () => hoisted.mockRouteDocGet(path),
                collection: () => ({
                    doc: () => ({
                        get: hoisted.mockRouteStatusGet,
                    }),
                }),
            };
        },
        collectionGroup: (collectionName: string) => ({
            where: vi.fn(function where(...args: unknown[]) {
                hoisted.mockCollectionGroupWhere(...args);
                return this;
            }),
            orderBy: vi.fn(function orderBy() {
                return this;
            }),
            limit: vi.fn(function limit() {
                return this;
            }),
            startAfter: vi.fn(function startAfter() {
                return this;
            }),
            get: () => collectionName === 'metaData'
                ? hoisted.mockProcessingQueryGet()
                : collectionName === 'routes'
                ? hoisted.mockRouteQueryGet()
                : Promise.resolve({ empty: true, size: 0, docs: [] }),
        }),
        collection: (collectionPath: string) => {
            if (collectionPath === 'sportsLibRouteReparseJobs') {
                return {
                    doc: (jobId: string) => ({
                        path: `${collectionPath}/${jobId}`,
                        get: () => hoisted.mockJobGet(jobId),
                        set: hoisted.mockJobSet,
                    }),
                };
            }
            return {
                orderBy: vi.fn(function orderBy() {
                    return this;
                }),
                limit: vi.fn(function limit() {
                    return this;
                }),
                startAfter: vi.fn(function startAfter() {
                    return this;
                }),
                get: hoisted.mockRouteQueryGet,
            };
        },
        recursiveDelete: hoisted.mockRecursiveDelete,
    });
    (firestore as any).FieldValue = {
        serverTimestamp: hoisted.mockServerTimestamp,
        delete: hoisted.mockDelete,
    };
    (firestore as any).FieldPath = {
        documentId: () => '__name__',
    };
    return { firestore };
});

vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        scheduleSportsLibRouteReparseScan: { name: 'scheduleSportsLibRouteReparseScan', region: 'europe-west2' },
    },
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueSportsLibRouteReparseTask: (...args: unknown[]) => hoisted.mockEnqueueRouteTask(...args),
}));

vi.mock('../shared/ttl-config', () => ({
    TTL_CONFIG: {
        SPORTS_LIB_REPARSE_JOBS_IN_DAYS: 30,
    },
    getExpireAtTimestamp: () => 'EXPIRE_AT',
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
    SPORTS_LIB_ROUTE_REPARSE_CHECKPOINT_PATH: 'systemJobs/sportsLibRouteReparse',
    SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION: 'sportsLibRouteReparseJobs',
    SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS: hoisted.mockRuntimeDefaults,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    SPORTS_LIB_REPARSE_STATUS_DOC_ID: 'reparseStatus',
    buildSportsLibRouteReparseJobId: () => 'route-job-1',
    extractPrimaryRouteSourceFile: (...args: unknown[]) => hoisted.mockExtractPrimaryRouteSourceFile(...args),
    isRouteReparsePersistenceSkippedForUserDeletionError: vi.fn(() => false),
    isSportsLibRouteReparseTerminalFailureMessage: vi.fn(() => false),
    parseUidAndRouteIdFromRoutePath: (path: string) => {
        const parts = path.split('/');
        return parts.length === 4 && parts[0] === 'users' && parts[2] === 'routes'
            ? { uid: parts[1], routeId: parts[3] }
            : null;
    },
    resolveRouteReparseTargetSportsLibVersion: () => '16.0.2',
    resolveRouteReparseTargetSportsLibVersionCode: () => 16_000_002,
    shouldRouteBeReparsed: (...args: unknown[]) => hoisted.mockShouldRouteBeReparsed(...args),
    writeRouteReparseStatus: (...args: unknown[]) => hoisted.mockWriteRouteReparseStatus(...args),
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    sportsLibVersionToCode: (version: string) => {
        const [major, minor, patch] = version.split('.').map(part => Number(part));
        return (major * 1_000_000) + (minor * 1_000) + patch;
    },
}));

import { scheduleSportsLibRouteReparseScan } from './sports-lib-route-reparse';

describe('scheduleSportsLibRouteReparseScan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mockRuntimeDefaults.enabled = false;
        hoisted.mockRuntimeDefaults.scanLimit = 10;
        hoisted.mockRuntimeDefaults.enqueueLimit = 10;
        hoisted.mockRuntimeDefaults.uidAllowlist = [];
        hoisted.mockCheckpointGet.mockResolvedValue({ data: () => ({}) });
        hoisted.mockCheckpointSet.mockResolvedValue(undefined);
        hoisted.mockProcessingQueryGet.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [makeProcessingDoc()],
        });
        hoisted.mockRouteQueryGet.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [makeRouteDoc()],
        });
        hoisted.mockRouteDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                originalFiles: [{ path: 'users/user-1/routes/route-1/source.gpx' }],
            }),
        });
        hoisted.mockRouteStatusGet.mockResolvedValue({ data: () => undefined });
        hoisted.mockJobGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.mockJobSet.mockResolvedValue(undefined);
        hoisted.mockEnqueueRouteTask.mockResolvedValue(true);
        hoisted.mockShouldRouteBeReparsed.mockResolvedValue(true);
        hoisted.mockExtractPrimaryRouteSourceFile.mockReturnValue({ path: 'users/user-1/routes/route-1/source.gpx' });
        hoisted.mockWriteRouteReparseStatus.mockResolvedValue(undefined);
        hoisted.mockGetUserDeletionGuardState.mockResolvedValue({
            shouldSkip: false,
            userExists: true,
            deletionInProgress: false,
        });
    });

    it('does nothing when disabled', async () => {
        await (scheduleSportsLibRouteReparseScan as any)({});

        expect(hoisted.mockProcessingQueryGet).not.toHaveBeenCalled();
        expect(hoisted.mockRouteQueryGet).not.toHaveBeenCalled();
        expect(hoisted.mockEnqueueRouteTask).not.toHaveBeenCalled();
    });

    it('enqueues stale route processing metadata when enabled', async () => {
        hoisted.mockRuntimeDefaults.enabled = true;

        await (scheduleSportsLibRouteReparseScan as any)({});

        expect(hoisted.mockProcessingQueryGet).toHaveBeenCalled();
        expect(hoisted.mockCollectionGroupWhere).toHaveBeenCalledWith('processingEntity', '==', 'route');
        expect(hoisted.mockCollectionGroupWhere).toHaveBeenCalledWith('sportsLibVersionCode', '<', 16_000_002);
        expect(hoisted.mockRouteDocGet).toHaveBeenCalledWith('users/user-1/routes/route-1');
        expect(hoisted.mockShouldRouteBeReparsed).not.toHaveBeenCalled();
        expect(hoisted.mockJobSet).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'user-1',
            routeId: 'route-1',
            status: 'pending',
            targetSportsLibVersion: '16.0.2',
        }), { merge: true });
        expect(hoisted.mockEnqueueRouteTask).toHaveBeenCalledWith('route-job-1');
        expect(hoisted.mockCheckpointSet).toHaveBeenLastCalledWith(expect.objectContaining({
            cursorProcessingDocPath: null,
            cursorProcessingVersionCode: null,
            lastScanCount: 1,
            lastEnqueuedCount: 1,
            targetSportsLibVersion: '16.0.2',
        }), { merge: true });
    });

    it('skips non-route processing metadata from the global metadata scan', async () => {
        hoisted.mockRuntimeDefaults.enabled = true;
        hoisted.mockProcessingQueryGet.mockResolvedValue({
            empty: false,
            size: 1,
            docs: [makeProcessingDoc('users/user-1/events/event-1')],
        });

        await (scheduleSportsLibRouteReparseScan as any)({});

        expect(hoisted.mockRouteDocGet).not.toHaveBeenCalled();
        expect(hoisted.mockJobSet).not.toHaveBeenCalled();
        expect(hoisted.mockEnqueueRouteTask).not.toHaveBeenCalled();
        expect(hoisted.mockCheckpointSet).toHaveBeenLastCalledWith(expect.objectContaining({
            cursorProcessingDocPath: null,
            cursorProcessingVersionCode: null,
            lastScanCount: 1,
            lastEnqueuedCount: 0,
        }), { merge: true });
    });

    it('keeps direct route scans for uid allowlist overrides', async () => {
        hoisted.mockRuntimeDefaults.enabled = true;
        hoisted.mockRuntimeDefaults.uidAllowlist = ['user-1'];

        await (scheduleSportsLibRouteReparseScan as any)({});

        expect(hoisted.mockProcessingQueryGet).not.toHaveBeenCalled();
        expect(hoisted.mockRouteQueryGet).toHaveBeenCalled();
        expect(hoisted.mockShouldRouteBeReparsed).toHaveBeenCalled();
        expect(hoisted.mockJobSet).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'user-1',
            routeId: 'route-1',
            status: 'pending',
        }), { merge: true });
    });
});
