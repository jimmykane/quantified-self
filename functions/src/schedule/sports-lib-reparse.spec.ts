import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: any) => handler,
}));

const hoisted = vi.hoisted(() => {
    const shouldEventBeReparsed = vi.fn();
    const hasPaidOrGraceAccess = vi.fn();
    const extractSourceFiles = vi.fn();
    const buildSportsLibReparseJobId = vi.fn();
    const writeReparseStatus = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn(() => '9.0.99');
    const parseUidAndEventIdFromEventPath = vi.fn((path: string) => {
        const parts = path.split('/');
        return { uid: parts[1], eventId: parts[3] };
    });

    const enqueueSportsLibReparseTask = vi.fn();
    const getExpireAtTimestamp = vi.fn(() => 'EXPIRE_TS');

    const checkpointSet = vi.fn().mockResolvedValue(undefined);
    const checkpointGet = vi.fn().mockResolvedValue({ data: () => ({ cursorEventPath: null }) });

    const jobSet = vi.fn().mockResolvedValue(undefined);
    const jobGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
    const jobDoc = { get: jobGet, set: jobSet };
    const jobsCollection = { doc: vi.fn(() => jobDoc) };

    const mockEventsDocs: any[] = [];
    const eventsQuery = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn(async () => ({
            empty: mockEventsDocs.length === 0,
            size: mockEventsDocs.length,
            docs: mockEventsDocs,
        })),
    };

    const firestoreDoc = vi.fn((path: string) => {
        if (path === 'systemJobs/sportsLibReparse') {
            return { get: checkpointGet, set: checkpointSet };
        }
        return { path };
    });

    const collection = vi.fn((name: string) => {
        if (name === 'sportsLibReparseJobs') {
            return jobsCollection;
        }
        return jobsCollection;
    });

    const collectionGroup = vi.fn(() => eventsQuery);
    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        shouldEventBeReparsed,
        hasPaidOrGraceAccess,
        extractSourceFiles,
        buildSportsLibReparseJobId,
        writeReparseStatus,
        resolveTargetSportsLibVersion,
        parseUidAndEventIdFromEventPath,
        enqueueSportsLibReparseTask,
        getExpireAtTimestamp,
        checkpointSet,
        checkpointGet,
        jobSet,
        jobGet,
        mockEventsDocs,
        eventsQuery,
        firestoreDoc,
        collection,
        collectionGroup,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_CHECKPOINT_PATH: 'systemJobs/sportsLibReparse',
    SPORTS_LIB_REPARSE_JOBS_COLLECTION: 'sportsLibReparseJobs',
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    SPORTS_LIB_REPARSE_STATUS_DOC_ID: 'reparseStatus',
    shouldEventBeReparsed: hoisted.shouldEventBeReparsed,
    hasPaidOrGraceAccess: hoisted.hasPaidOrGraceAccess,
    extractSourceFiles: hoisted.extractSourceFiles,
    buildSportsLibReparseJobId: hoisted.buildSportsLibReparseJobId,
    writeReparseStatus: hoisted.writeReparseStatus,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueSportsLibReparseTask: hoisted.enqueueSportsLibReparseTask,
}));

vi.mock('../shared/ttl-config', () => ({
    TTL_CONFIG: { SPORTS_LIB_REPARSE_JOBS_IN_DAYS: 30 },
    getExpireAtTimestamp: hoisted.getExpireAtTimestamp,
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collectionGroup: hoisted.collectionGroup,
        collection: hoisted.collection,
        doc: hoisted.firestoreDoc,
    }));
    Object.assign(firestoreFn, {
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
            delete: hoisted.deleteField,
        },
        FieldPath: {
            documentId: () => '__name__',
        }
    });

    return { firestore: firestoreFn };
});

import { scheduleSportsLibReparseScan } from './sports-lib-reparse';

function createEventDoc(path: string, data: Record<string, unknown> = {}): any {
    return {
        ref: {
            path,
            collection: vi.fn(() => ({
                doc: vi.fn((docId: string) => {
                    if (docId === 'processing') {
                        return {
                            get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                        };
                    }
                    if (docId === 'reparseStatus') {
                        return {
                            get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                        };
                    }
                    return {
                        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                    };
                }),
            })),
        },
        data: () => data,
    };
}

describe('scheduleSportsLibReparseScan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mockEventsDocs.length = 0;
        process.env.SPORTS_LIB_REPARSE_ENABLED = 'true';
        process.env.SPORTS_LIB_REPARSE_SCAN_LIMIT = '200';
        process.env.SPORTS_LIB_REPARSE_ENQUEUE_LIMIT = '100';
        hoisted.shouldEventBeReparsed.mockResolvedValue(true);
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(true);
        hoisted.extractSourceFiles.mockReturnValue([{ path: 'users/u1/events/e1/original.fit' }]);
        hoisted.buildSportsLibReparseJobId.mockReturnValue('job-1');
    });

    it('should short-circuit when runtime flag is disabled', async () => {
        process.env.SPORTS_LIB_REPARSE_ENABLED = 'false';
        await (scheduleSportsLibReparseScan as any)({});
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('should enqueue candidate jobs for eligible users', async () => {
        hoisted.mockEventsDocs.push(createEventDoc('users/u1/events/e1', { originalFile: { path: 'x.fit' } }));

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'u1',
            eventId: 'e1',
            status: 'pending',
            targetSportsLibVersion: '9.0.99',
        }), { merge: true });
    });

    it('should mark events without source metadata as skipped', async () => {
        hoisted.mockEventsDocs.push(createEventDoc('users/u1/events/e1', {}));
        hoisted.extractSourceFiles.mockReturnValue([]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should write checkpoint summary at the end of a pass', async () => {
        hoisted.mockEventsDocs.push(createEventDoc('users/u1/events/e1', { originalFile: { path: 'x.fit' } }));

        await (scheduleSportsLibReparseScan as any)({});

        const lastCheckpointSetCall = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1];
        expect(lastCheckpointSetCall[0]).toEqual(expect.objectContaining({
            cursorEventPath: null,
            lastScanCount: 1,
            lastEnqueuedCount: 1,
            targetSportsLibVersion: '9.0.99',
        }));
    });
});
