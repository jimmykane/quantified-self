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
    const resolveTargetSportsLibVersion = vi.fn(() => '9.1.2');
    const parseUIDAllowlist = vi.fn((input?: string) => {
        if (!input) return null;
        const values = input.split(',').map(v => v.trim()).filter(Boolean);
        return values.length ? new Set(values) : null;
    });
    const parseUidAndEventIdFromEventPath = vi.fn((path: string) => {
        const parts = path.split('/');
        return { uid: parts[1], eventId: parts[3] };
    });
    const runtimeDefaults = {
        enabled: false,
        scanLimit: 200,
        enqueueLimit: 100,
        includeFreeUsers: false,
        uidAllowlist: null as string[] | null,
    };

    const enqueueSportsLibReparseTask = vi.fn();
    const getExpireAtTimestamp = vi.fn(() => 'EXPIRE_TS');

    const checkpointSet = vi.fn().mockResolvedValue(undefined);
    const checkpointGet = vi.fn();

    const jobSet = vi.fn().mockResolvedValue(undefined);
    const jobGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
    const jobsCollection = { doc: vi.fn(() => ({ get: jobGet, set: jobSet })) };

    const globalEventsDocs: any[] = [];
    const userEventsByUID = new Map<string, any[]>();

    const collection = vi.fn((path: string) => {
        if (path === 'sportsLibReparseJobs') {
            return jobsCollection;
        }

        const userEventsMatch = path.match(/^users\/([^/]+)\/events$/);
        if (userEventsMatch) {
            const uid = userEventsMatch[1];
            let cursorId: string | null = null;
            let limitValue = 100;
            const q = {
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn((value: number) => {
                    limitValue = value;
                    return q;
                }),
                startAfter: vi.fn((value: string) => {
                    cursorId = value;
                    return q;
                }),
                get: vi.fn(async () => {
                    const allDocs = userEventsByUID.get(uid) || [];
                    const cursorIndex = cursorId ? allDocs.findIndex(doc => doc.id === cursorId) + 1 : 0;
                    const docs = allDocs.slice(cursorIndex, cursorIndex + limitValue);
                    return {
                        empty: docs.length === 0,
                        size: docs.length,
                        docs,
                    };
                }),
            };
            return q;
        }

        return jobsCollection;
    });

    let globalCursorPath: string | null = null;
    let globalLimitValue = 100;
    const resetGlobalQueryState = () => {
        globalCursorPath = null;
        globalLimitValue = 100;
    };
    const collectionGroup = vi.fn(() => {
        const q = {
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                globalLimitValue = value;
                return q;
            }),
            startAfter: vi.fn((value: { path?: string }) => {
                globalCursorPath = value?.path || null;
                return q;
            }),
            get: vi.fn(async () => {
                const docs = globalEventsDocs
                    .filter(doc => !globalCursorPath || doc.ref.path > globalCursorPath)
                    .slice(0, globalLimitValue);
                return {
                    empty: docs.length === 0,
                    size: docs.length,
                    docs,
                };
            }),
        };
        return q;
    });

    const firestoreDoc = vi.fn((path: string) => {
        if (path === 'systemJobs/sportsLibReparse') {
            return { get: checkpointGet, set: checkpointSet };
        }
        return { path };
    });

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        shouldEventBeReparsed,
        hasPaidOrGraceAccess,
        extractSourceFiles,
        buildSportsLibReparseJobId,
        writeReparseStatus,
        resolveTargetSportsLibVersion,
        parseUIDAllowlist,
        parseUidAndEventIdFromEventPath,
        runtimeDefaults,
        enqueueSportsLibReparseTask,
        getExpireAtTimestamp,
        checkpointSet,
        checkpointGet,
        jobSet,
        jobGet,
        globalEventsDocs,
        userEventsByUID,
        collection,
        collectionGroup,
        resetGlobalQueryState,
        firestoreDoc,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_CHECKPOINT_PATH: 'systemJobs/sportsLibReparse',
    SPORTS_LIB_REPARSE_JOBS_COLLECTION: 'sportsLibReparseJobs',
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    SPORTS_LIB_REPARSE_STATUS_DOC_ID: 'reparseStatus',
    shouldEventBeReparsed: hoisted.shouldEventBeReparsed,
    hasPaidOrGraceAccess: hoisted.hasPaidOrGraceAccess,
    extractSourceFiles: hoisted.extractSourceFiles,
    buildSportsLibReparseJobId: hoisted.buildSportsLibReparseJobId,
    writeReparseStatus: hoisted.writeReparseStatus,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
    parseUIDAllowlist: hoisted.parseUIDAllowlist,
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
        },
    });

    return { firestore: firestoreFn };
});

import { scheduleSportsLibReparseScan } from './sports-lib-reparse';

function createEventDoc(uid: string, eventId: string, data: Record<string, unknown> = {}, reparseStatusData?: Record<string, unknown>): any {
    return {
        id: eventId,
        ref: {
            path: `users/${uid}/events/${eventId}`,
            collection: vi.fn(() => ({
                doc: vi.fn((docId: string) => {
                    if (docId === 'reparseStatus') {
                        return { get: vi.fn().mockResolvedValue({ data: () => reparseStatusData || {} }) };
                    }
                    return { get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }) };
                }),
            })),
        },
        data: () => data,
    };
}

describe('scheduleSportsLibReparseScan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.globalEventsDocs.length = 0;
        hoisted.userEventsByUID.clear();
        hoisted.resetGlobalQueryState();
        hoisted.runtimeDefaults.enabled = true;
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.enqueueLimit = 100;
        hoisted.runtimeDefaults.uidAllowlist = null;
        hoisted.runtimeDefaults.includeFreeUsers = false;
        hoisted.checkpointGet.mockResolvedValue({ data: () => ({ cursorEventPath: null }) });
        hoisted.jobGet.mockResolvedValue({ exists: false, data: () => ({}) });
        hoisted.shouldEventBeReparsed.mockResolvedValue(true);
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(true);
        hoisted.extractSourceFiles.mockReturnValue([{ path: 'users/u1/events/e1/original.fit' }]);
        hoisted.buildSportsLibReparseJobId.mockReturnValue('job-1');
    });

    it('should short-circuit when runtime flag is disabled', async () => {
        hoisted.runtimeDefaults.enabled = false;
        await (scheduleSportsLibReparseScan as any)({});
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('should enqueue candidate jobs in global mode', async () => {
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'u1',
            eventId: 'e1',
            status: 'pending',
            targetSportsLibVersion: '9.1.2',
        }), { merge: true });
    });

    it('should apply cursor startAfter in global mode', async () => {
        hoisted.runtimeDefaults.scanLimit = 1;
        hoisted.checkpointGet.mockResolvedValue({ data: () => ({ cursorEventPath: 'users/u1/events/e1' }) });
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }));

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.cursorEventPath).toBe('users/u1/events/e2');
    });

    it('should mark pass complete when global scan returns no events', async () => {
        hoisted.globalEventsDocs.length = 0;

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.cursorEventPath).toBeNull();
        expect(finalCheckpointPayload.lastPassCompletedAt).toBe('SERVER_TIMESTAMP');
        expect(finalCheckpointPayload.lastScanCount).toBe(0);
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(0);
    });

    it('should mark missing-source events as skipped', async () => {
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', {}));
        hoisted.extractSourceFiles.mockReturnValue([]);
        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should skip event processing when candidate check returns false', async () => {
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.shouldEventBeReparsed.mockResolvedValue(false);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.extractSourceFiles).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should skip enqueue when existing job is already pending', async () => {
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.jobGet.mockResolvedValue({ exists: true, data: () => ({ status: 'pending' }) });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.jobSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should stop enqueueing once enqueue limit is reached', async () => {
        hoisted.runtimeDefaults.enqueueLimit = 1;
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);
        hoisted.globalEventsDocs.push(
            createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            createEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledTimes(1);
    });

    it('should re-enqueue when existing job is failed', async () => {
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.jobGet.mockResolvedValue({
            exists: true,
            data: () => ({ status: 'failed', attemptCount: 3, createdAt: 'old-created' }),
        });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.jobSet).toHaveBeenCalledWith(expect.objectContaining({
            attemptCount: 3,
            status: 'pending',
        }), { merge: true });
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
    });

    it('should mark job as failed when task enqueue fails', async () => {
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.enqueueSportsLibReparseTask.mockRejectedValueOnce(new Error('enqueue-failed'));

        await expect((scheduleSportsLibReparseScan as any)({})).rejects.toThrow('enqueue-failed');

        expect(hoisted.jobSet).toHaveBeenLastCalledWith(expect.objectContaining({
            status: 'failed',
            lastError: 'enqueue-failed',
        }), { merge: true });
    });

    it('should skip events already marked NO_ORIGINAL_FILES for the same target', async () => {
        hoisted.globalEventsDocs.push(createEventDoc(
            'u1',
            'e1',
            { originalFile: { path: 'x.fit' } },
            { status: 'skipped', reason: 'NO_ORIGINAL_FILES', targetSportsLibVersion: '9.1.2' },
        ));

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.extractSourceFiles).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should process only allowlisted users in override mode', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [createEventDoc('u2', 'e2', { originalFile: { path: 'y.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
        expect(hoisted.hasPaidOrGraceAccess).toHaveBeenCalledWith('u1');
        expect(hoisted.hasPaidOrGraceAccess).not.toHaveBeenCalledWith('u2');
    });

    it('should carry previous cursor for unscanned allowlisted UIDs when scan cap is exhausted', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1', 'u2'];
        hoisted.runtimeDefaults.scanLimit = 1;
        hoisted.checkpointGet.mockResolvedValue({ data: () => ({ overrideCursorByUid: { u2: 'prev-u2' } }) });
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [createEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: 'e1', u2: 'prev-u2' });
        expect(hoisted.hasPaidOrGraceAccess).toHaveBeenCalledWith('u1');
        expect(hoisted.hasPaidOrGraceAccess).not.toHaveBeenCalledWith('u2');
        expect(finalCheckpointPayload.lastPassCompletedAt).toBeUndefined();
    });

    it('should progress per-UID override cursor when page is full', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.runtimeDefaults.scanLimit = 1;
        hoisted.userEventsByUID.set('u1', [
            createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            createEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }),
        ]);

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: 'e1' });
        expect(finalCheckpointPayload.lastPassCompletedAt).toBeUndefined();
    });

    it('should reset per-UID override cursor when UID scan finishes', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.checkpointGet.mockResolvedValue({ data: () => ({ overrideCursorByUid: { u1: 'e1' } }) });
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } })]);
        hoisted.runtimeDefaults.scanLimit = 10;

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: null });
        expect(finalCheckpointPayload.lastPassCompletedAt).toBe('SERVER_TIMESTAMP');
    });

    it('should reset per-UID cursor to null when allowlisted UID has no events in current page', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.checkpointGet.mockResolvedValue({ data: () => ({ overrideCursorByUid: { u1: 'stale-cursor' } }) });
        hoisted.userEventsByUID.set('u1', []);

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: null });
    });

    it('should enforce eligibility in override mode', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should include free users when include-free-users flag is enabled', async () => {
        hoisted.runtimeDefaults.includeFreeUsers = true;
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);
        hoisted.globalEventsDocs.push(createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.hasPaidOrGraceAccess).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
    });
});
