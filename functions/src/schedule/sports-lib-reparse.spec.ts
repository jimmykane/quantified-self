import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from '../reparse/sports-lib-reparse.config';

const TARGET_SPORTS_LIB_VERSION = SPORTS_LIB_REPARSE_TARGET_VERSION;
const TARGET_SPORTS_LIB_VERSION_CODE = 9_001_004;

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: any) => handler,
}));

const hoisted = vi.hoisted(() => {
    const shouldEventBeReparsed = vi.fn();
    const extractSourceFiles = vi.fn();
    const buildSportsLibReparseJobId = vi.fn();
    const writeReparseStatus = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn();
    const resolveTargetSportsLibVersionCode = vi.fn();
    const sportsLibVersionToCode = vi.fn();
    const parseUidAndEventIdFromEventPath = vi.fn((path: string) => {
        const parts = path.split('/');
        if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'events') {
            return null;
        }
        return { uid: parts[1], eventId: parts[3] };
    });
    const runtimeDefaults = {
        enabled: false,
        scanLimit: 200,
        enqueueLimit: 100,
        uidAllowlist: null as string[] | null,
    };

    const enqueueSportsLibReparseTask = vi.fn();
    const getExpireAtTimestamp = vi.fn(() => 'EXPIRE_TS');

    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();

    const checkpointSet = vi.fn().mockResolvedValue(undefined);
    const checkpointGet = vi.fn();

    const existingJobsById = new Map<string, Record<string, unknown>>();
    const jobSet = vi.fn().mockResolvedValue(undefined);

    const processingDocs: any[] = [];
    const userEventsByUID = new Map<string, any[]>();
    const eventRefsByPath = new Map<string, any>();

    let processingLimitValue = 100;
    let processingCursorCode: number | null = null;
    let processingCursorDocPath: string | null = null;
    let processingTargetCode: number | null = null;
    const resetProcessingQueryState = () => {
        processingLimitValue = 100;
        processingCursorCode = null;
        processingCursorDocPath = null;
        processingTargetCode = null;
    };

    const collectionGroup = vi.fn((path: string) => {
        if (path !== 'metaData') {
            throw new Error(`Unexpected collectionGroup path: ${path}`);
        }
        const q = {
            where: vi.fn((_field: string, _op: string, value: number) => {
                processingTargetCode = value;
                return q;
            }),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                processingLimitValue = value;
                return q;
            }),
            startAfter: vi.fn((code: number, docRef: { path?: string }) => {
                processingCursorCode = code;
                processingCursorDocPath = docRef?.path || null;
                return q;
            }),
            get: vi.fn(async () => {
                const docs = processingDocs
                    .filter((doc) => {
                        if (processingTargetCode === null) {
                            return true;
                        }
                        const code = doc.data()?.sportsLibVersionCode;
                        return typeof code === 'number' && code < processingTargetCode;
                    })
                    .sort((a, b) => {
                        const codeA = a.data()?.sportsLibVersionCode ?? 0;
                        const codeB = b.data()?.sportsLibVersionCode ?? 0;
                        if (codeA !== codeB) {
                            return codeA - codeB;
                        }
                        return a.ref.path.localeCompare(b.ref.path);
                    })
                    .filter((doc) => {
                        if (processingCursorCode === null || !processingCursorDocPath) {
                            return true;
                        }
                        const code = doc.data()?.sportsLibVersionCode;
                        if (code > processingCursorCode) {
                            return true;
                        }
                        if (code < processingCursorCode) {
                            return false;
                        }
                        return doc.ref.path > processingCursorDocPath;
                    })
                    .slice(0, processingLimitValue);

                return {
                    empty: docs.length === 0,
                    size: docs.length,
                    docs,
                };
            }),
        };
        return q;
    });

    const collection = vi.fn((path: string) => {
        if (path === 'sportsLibReparseJobs') {
            return {
                doc: vi.fn((jobId: string) => ({
                    get: vi.fn(async () => {
                        const existing = existingJobsById.get(jobId);
                        return {
                            exists: !!existing,
                            data: () => existing || {},
                        };
                    }),
                    set: vi.fn(async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
                        jobSet(jobId, payload, options);
                    }),
                })),
            };
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

        throw new Error(`Unexpected collection path: ${path}`);
    });

    const firestoreDoc = vi.fn((path: string) => {
        if (path === 'systemJobs/sportsLibReparse') {
            return { get: checkpointGet, set: checkpointSet };
        }
        return eventRefsByPath.get(path) || { path };
    });

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        shouldEventBeReparsed,
        extractSourceFiles,
        buildSportsLibReparseJobId,
        writeReparseStatus,
        resolveTargetSportsLibVersion,
        resolveTargetSportsLibVersionCode,
        sportsLibVersionToCode,
        parseUidAndEventIdFromEventPath,
        runtimeDefaults,
        enqueueSportsLibReparseTask,
        getExpireAtTimestamp,
        loggerInfo,
        loggerWarn,
        loggerError,
        checkpointSet,
        checkpointGet,
        existingJobsById,
        jobSet,
        processingDocs,
        userEventsByUID,
        eventRefsByPath,
        collection,
        collectionGroup,
        resetProcessingQueryState,
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
    extractSourceFiles: hoisted.extractSourceFiles,
    buildSportsLibReparseJobId: hoisted.buildSportsLibReparseJobId,
    writeReparseStatus: hoisted.writeReparseStatus,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode: hoisted.resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode: hoisted.sportsLibVersionToCode,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueSportsLibReparseTask: hoisted.enqueueSportsLibReparseTask,
}));

vi.mock('../shared/ttl-config', () => ({
    TTL_CONFIG: { SPORTS_LIB_REPARSE_JOBS_IN_DAYS: 30 },
    getExpireAtTimestamp: hoisted.getExpireAtTimestamp,
}));

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    warn: hoisted.loggerWarn,
    error: hoisted.loggerError,
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

function createEventRef(
    uid: string,
    eventId: string,
    eventData: Record<string, unknown> = {},
    reparseStatusData?: Record<string, unknown>,
): any {
    const path = `users/${uid}/events/${eventId}`;
    const ref = {
        path,
        get: vi.fn(async () => ({
            exists: true,
            data: () => eventData,
        })),
        collection: vi.fn((collectionName: string) => {
            if (collectionName !== 'metaData') {
                return { doc: vi.fn(() => ({ get: vi.fn() })) };
            }
            return {
                doc: vi.fn((docId: string) => {
                    if (docId === 'reparseStatus') {
                        return {
                            get: vi.fn(async () => ({ data: () => reparseStatusData || {} })),
                        };
                    }
                    return {
                        get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
                    };
                }),
            };
        }),
    };
    hoisted.eventRefsByPath.set(path, ref);
    return ref;
}

function createEventDoc(
    uid: string,
    eventId: string,
    eventData: Record<string, unknown> = {},
    reparseStatusData?: Record<string, unknown>,
): any {
    const ref = createEventRef(uid, eventId, eventData, reparseStatusData);
    return {
        id: eventId,
        ref,
        data: () => eventData,
    };
}

function createProcessingDoc(eventRef: any, data: Record<string, unknown>): any {
    return {
        ref: {
            path: `${eventRef.path}/metaData/processing`,
            parent: {
                parent: eventRef,
            },
        },
        data: () => data,
    };
}

describe('scheduleSportsLibReparseScan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.processingDocs.length = 0;
        hoisted.userEventsByUID.clear();
        hoisted.eventRefsByPath.clear();
        hoisted.existingJobsById.clear();
        hoisted.resetProcessingQueryState();

        hoisted.runtimeDefaults.enabled = true;
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.enqueueLimit = 100;
        hoisted.runtimeDefaults.uidAllowlist = null;

        hoisted.resolveTargetSportsLibVersion.mockReturnValue(TARGET_SPORTS_LIB_VERSION);
        hoisted.resolveTargetSportsLibVersionCode.mockReturnValue(TARGET_SPORTS_LIB_VERSION_CODE);
        hoisted.sportsLibVersionToCode.mockImplementation((version: string) => {
            if (version === '9.0.0') return 9_000_000;
            if (version === '9.0.1') return 9_000_001;
            if (version === TARGET_SPORTS_LIB_VERSION) return TARGET_SPORTS_LIB_VERSION_CODE;
            throw new Error(`Invalid sports-lib version "${version}"`);
        });
        hoisted.checkpointGet.mockResolvedValue({ data: () => ({ cursorProcessingDocPath: null, cursorProcessingVersionCode: null }) });
        hoisted.buildSportsLibReparseJobId.mockReturnValue('job-1');
        hoisted.shouldEventBeReparsed.mockResolvedValue(true);
        hoisted.extractSourceFiles.mockReturnValue([{ path: 'users/u1/events/e1/original.fit' }]);
        hoisted.enqueueSportsLibReparseTask.mockResolvedValue(true);
    });

    it('should short-circuit when runtime flag is disabled', async () => {
        hoisted.runtimeDefaults.enabled = false;
        await (scheduleSportsLibReparseScan as any)({});
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('should enqueue candidate jobs from processing metadata collectionGroup in global mode', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.collectionGroup).toHaveBeenCalledWith('metaData');
        expect(hoisted.shouldEventBeReparsed).not.toHaveBeenCalled();
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
    });

    it('should spread enqueue schedule delays across multiple sequential override enqueues', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.runtimeDefaults.enqueueLimit = 2;
        hoisted.buildSportsLibReparseJobId
            .mockReturnValueOnce('job-e1')
            .mockReturnValueOnce('job-e2');
        hoisted.userEventsByUID.set('u1', [
            createEventDoc('u1', 'e1', { originalFile: { path: 'first.fit' } }),
            createEventDoc('u1', 'e2', { originalFile: { path: 'second.fit' } }),
        ]);

        await (scheduleSportsLibReparseScan as any)({});

        const firstCallArgs = hoisted.enqueueSportsLibReparseTask.mock.calls[0];
        const secondCallArgs = hoisted.enqueueSportsLibReparseTask.mock.calls[1];
        expect(firstCallArgs).toEqual(['job-e1']);
        expect(secondCallArgs[0]).toBe('job-e2');
        expect(secondCallArgs[1]).toBeGreaterThanOrEqual(2);
        expect(secondCallArgs[1]).toBeLessThanOrEqual(10);
    });

    it('should use the same bounded dynamic enqueue delay in global mode', async () => {
        hoisted.runtimeDefaults.uidAllowlist = null;
        hoisted.runtimeDefaults.enqueueLimit = 2;
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);

        const eventRefOne = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        const eventRefTwo = createEventRef('u1', 'e2', { originalFile: { path: 'y.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(eventRefOne, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(eventRefTwo, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        const firstCallArgs = hoisted.enqueueSportsLibReparseTask.mock.calls[0];
        const secondCallArgs = hoisted.enqueueSportsLibReparseTask.mock.calls[1];
        expect(firstCallArgs).toEqual(['job-e1']);
        expect(secondCallArgs[0]).toBe('job-e2');
        expect(secondCallArgs[1]).toBeGreaterThanOrEqual(2);
        expect(secondCallArgs[1]).toBeLessThanOrEqual(10);
    });

    it('should apply tuple cursor startAfter in global mode', async () => {
        hoisted.runtimeDefaults.scanLimit = 1;
        const eventRefOne = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        const eventRefTwo = createEventRef('u1', 'e2', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(eventRefOne, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 9_000_000 }),
            createProcessingDoc(eventRefTwo, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 9_000_000 }),
        );
        hoisted.checkpointGet.mockResolvedValue({
            data: () => ({
                cursorProcessingDocPath: `${eventRefOne.path}/metaData/processing`,
                cursorProcessingVersionCode: 9_000_000,
            }),
        });

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.cursorProcessingDocPath).toBe(`${eventRefTwo.path}/metaData/processing`);
        expect(finalCheckpointPayload.cursorProcessingVersionCode).toBe(9_000_000);
    });

    it('should mark pass complete when processing scan returns no docs', async () => {
        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.cursorProcessingDocPath).toBeNull();
        expect(finalCheckpointPayload.cursorProcessingVersionCode).toBeNull();
        expect(finalCheckpointPayload.lastPassCompletedAt).toBe('SERVER_TIMESTAMP');
        expect(finalCheckpointPayload.lastScanCount).toBe(0);
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(0);
    });

    it('should skip malformed processing metadata and continue scanning', async () => {
        const malformedRef = createEventRef('u1', 'bad', { originalFile: { path: 'x.fit' } });
        const validRef = createEventRef('u1', 'good', { originalFile: { path: 'y.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(malformedRef, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 123 }),
            createProcessingDoc(validRef, { sportsLibVersion: '9.0.1', sportsLibVersionCode: 9_000_001 }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Mismatched processing metadata version/code; skipping doc.',
            expect.objectContaining({
                processingDocPath: `${malformedRef.path}/metaData/processing`,
            }),
        );
    });

    it('should process only allowlisted users in override mode', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [createEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
        expect(hoisted.shouldEventBeReparsed).toHaveBeenCalledTimes(1);
    });

    it('should skip override candidate when shouldEventBeReparsed returns false', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.shouldEventBeReparsed.mockResolvedValueOnce(false);
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should skip override candidate when shouldEventBeReparsed throws non-Error value', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.shouldEventBeReparsed.mockRejectedValueOnce('broken-metadata');
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Invalid processing metadata; skipping event candidate.',
            expect.objectContaining({
                eventPath: 'users/u1/events/e1',
                error: 'broken-metadata',
            }),
        );
    });

    it('should skip override candidate when event path cannot be parsed', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.userEventsByUID.set('u1', [{
            id: 'bad',
            ref: { path: 'bad/path', collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn() })) })) },
            data: () => ({ originalFile: { path: 'x.fit' } }),
        }]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should skip override candidate when reparseStatus already marked NO_ORIGINAL_FILES for current target', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.userEventsByUID.set('u1', [createEventDoc(
            'u1',
            'e1',
            { originalFile: { path: 'x.fit' } },
            {
                status: 'skipped',
                reason: 'NO_ORIGINAL_FILES',
                targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
            },
        )]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should requeue failed existing jobs and preserve createdAt from existing record', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.existingJobsById.set('job-1', {
            status: 'failed',
            createdAt: 'EXISTING_CREATED_AT',
            attemptCount: 5,
        });
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        const pendingWriteCall = hoisted.jobSet.mock.calls.find((call: any[]) => call[0] === 'job-1');
        expect(pendingWriteCall?.[1]).toEqual(expect.objectContaining({
            createdAt: 'EXISTING_CREATED_AT',
            attemptCount: 5,
        }));
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
    });

    it('should keep previous override cursor when enqueue limit is already reached at UID loop start', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.runtimeDefaults.enqueueLimit = 0;
        hoisted.checkpointGet.mockResolvedValue({
            data: () => ({
                overrideCursorByUid: {
                    u1: 'existing-cursor',
                },
            }),
        });

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: 'existing-cursor' });
    });

    it('should keep previous override cursor when no remaining scan budget is left', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1', 'u2'];
        hoisted.runtimeDefaults.scanLimit = 1;
        hoisted.checkpointGet.mockResolvedValue({
            data: () => ({
                overrideCursorByUid: {
                    u1: 'cursor-u1',
                    u2: 'cursor-u2',
                },
            }),
        });
        hoisted.userEventsByUID.set('u1', [createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [createEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } })]);

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({
            u1: 'e1',
            u2: 'cursor-u2',
        });
    });

    it('should apply override per-UID startAfter cursor when present', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.checkpointGet.mockResolvedValue({
            data: () => ({
                overrideCursorByUid: {
                    u1: 'e1',
                },
            }),
        });
        hoisted.userEventsByUID.set('u1', [
            createEventDoc('u1', 'e1', { originalFile: { path: 'first.fit' } }),
            createEventDoc('u1', 'e2', { originalFile: { path: 'second.fit' } }),
        ]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.shouldEventBeReparsed).toHaveBeenCalledTimes(1);
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
    });

    it('should set override cursor to null when user page is empty', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: null });
    });

    it('should store last processed override cursor when page is full and enqueue limit is not reached', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.runtimeDefaults.scanLimit = 2;
        hoisted.userEventsByUID.set('u1', [
            createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            createEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }),
        ]);

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: 'e2' });
    });

    it('should preserve previous override cursor when enqueue limit is hit before processing any event in a page', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1'];
        hoisted.runtimeDefaults.enqueueLimit = 0;
        hoisted.checkpointGet.mockResolvedValue({
            data: () => ({
                overrideCursorByUid: {
                    u1: 'cursor-before-page',
                },
            }),
        });
        hoisted.userEventsByUID.set('u1', [
            createEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
        ]);

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.overrideCursorByUid).toEqual({ u1: 'cursor-before-page' });
    });

    it('should mark missing-source events as skipped', async () => {
        const eventRef = createEventRef('u1', 'e1', {});
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.extractSourceFiles.mockReturnValue([]);

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should skip enqueue when existing job is pending', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.existingJobsById.set('job-1', { status: 'pending' });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should enqueue candidates without entitlement filtering', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-1');
    });

    it('should skip defensively when returned processing doc has version code at-or-above target', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        const processingDoc = createProcessingDoc(eventRef, {
            sportsLibVersion: TARGET_SPORTS_LIB_VERSION,
            sportsLibVersionCode: TARGET_SPORTS_LIB_VERSION_CODE,
        });

        hoisted.collectionGroup.mockImplementationOnce((path: string) => {
            if (path !== 'metaData') {
                throw new Error(`Unexpected collectionGroup path: ${path}`);
            }
            const q: any = {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                startAfter: vi.fn().mockReturnThis(),
                get: vi.fn(async () => ({
                    empty: false,
                    size: 1,
                    docs: [processingDoc],
                })),
            };
            return q;
        });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.lastScanCount).toBe(1);
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(0);
    });

    it('should skip non-processing metadata docs from global candidate query', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push({
            ref: {
                path: `${eventRef.path}/metaData/customMetadataDoc`,
                parent: {
                    parent: eventRef,
                },
            },
            data: () => ({
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Skipping non-processing metadata doc from candidate query.',
            expect.objectContaining({
                processingDocPath: `${eventRef.path}/metaData/customMetadataDoc`,
            }),
        );
    });

    it('should skip global processing docs when semver conversion throws', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: 'bad-version',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.sportsLibVersionToCode.mockImplementationOnce(() => {
            throw new Error('bad semver');
        });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Invalid processing metadata; skipping doc.',
            expect.objectContaining({
                sportsLibVersion: 'bad-version',
                error: 'bad semver',
            }),
        );
    });

    it('should skip global processing docs when parent event reference is missing', async () => {
        hoisted.processingDocs.push({
            ref: {
                path: 'users/u1/events/e1/metaData/processing',
                parent: {
                    parent: null,
                },
            },
            data: () => ({
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Could not resolve parent event from processing metadata path.',
            expect.objectContaining({
                processingDocPath: 'users/u1/events/e1/metaData/processing',
            }),
        );
    });

    it('should skip stale processing docs whose parent event no longer exists', async () => {
        const staleEventRef = createEventRef('u1', 'deleted', { originalFile: { path: 'x.fit' } });
        staleEventRef.get = vi.fn(async () => ({ exists: false, data: () => ({}) }));
        hoisted.processingDocs.push(createProcessingDoc(staleEventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse] Skipping stale processing metadata because parent event is missing.',
            expect.objectContaining({
                processingDocPath: `${staleEventRef.path}/metaData/processing`,
                eventPath: staleEventRef.path,
            }),
        );
    });

    it('should log and rethrow processing metadata candidate failures', async () => {
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);

        const successEventRef = createEventRef('u1', 'e1', { originalFile: { path: 'success.fit' } });
        const failingEventRef = createEventRef('u1', 'e2', { originalFile: { path: 'broken.fit' } });
        failingEventRef.get = vi.fn(async () => {
            throw new Error('candidate-failed');
        });

        hoisted.processingDocs.push(
            createProcessingDoc(successEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(failingEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        );

        await expect((scheduleSportsLibReparseScan as any)({})).rejects.toThrow('candidate-failed');
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[sports-lib-reparse] Failed to process candidate from processing metadata scan.',
            expect.objectContaining({
                processingDocPath: `${failingEventRef.path}/metaData/processing`,
                eventPath: failingEventRef.path,
                error: 'candidate-failed',
            }),
        );
    });

    it('should mark job as failed when task enqueue fails', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.enqueueSportsLibReparseTask.mockRejectedValueOnce(new Error('enqueue-failed'));

        await expect((scheduleSportsLibReparseScan as any)({})).rejects.toThrow('enqueue-failed');
        expect(hoisted.jobSet).toHaveBeenCalledWith(
            'job-1',
            expect.objectContaining({
                status: 'failed',
                lastError: 'enqueue-failed',
            }),
            { merge: true },
        );
    });

    it('should not advance processing cursor past docs skipped due enqueue limit cap', async () => {
        hoisted.runtimeDefaults.scanLimit = 2;
        hoisted.runtimeDefaults.enqueueLimit = 1;
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);

        const firstEventRef = createEventRef('u1', 'e1', { originalFile: { path: 'first.fit' } });
        const secondEventRef = createEventRef('u1', 'e2', { originalFile: { path: 'second.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(firstEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(secondEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledTimes(1);
        expect(finalCheckpointPayload.cursorProcessingDocPath).toBe(`${firstEventRef.path}/metaData/processing`);
        expect(finalCheckpointPayload.lastScanCount).toBe(1);
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(1);
    });

    it('should not count already-existing Cloud Tasks against enqueue limit', async () => {
        hoisted.runtimeDefaults.scanLimit = 2;
        hoisted.runtimeDefaults.enqueueLimit = 1;
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);
        hoisted.enqueueSportsLibReparseTask
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        const firstEventRef = createEventRef('u1', 'e1', { originalFile: { path: 'first.fit' } });
        const secondEventRef = createEventRef('u1', 'e2', { originalFile: { path: 'second.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(firstEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(secondEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledTimes(2);
        expect(finalCheckpointPayload.cursorProcessingDocPath).toBe(`${secondEventRef.path}/metaData/processing`);
        expect(finalCheckpointPayload.lastScanCount).toBe(2);
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(1);
    });

    it('should persist resumable cursor tuple when full malformed processing page is scanned', async () => {
        hoisted.runtimeDefaults.scanLimit = 2;
        hoisted.runtimeDefaults.enqueueLimit = 100;

        const malformedOneRef = createEventRef('u1', 'bad1', { originalFile: { path: 'bad1.fit' } });
        const malformedTwoRef = createEventRef('u1', 'bad2', { originalFile: { path: 'bad2.fit' } });
        const validLaterRef = createEventRef('u1', 'good3', { originalFile: { path: 'good3.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(malformedOneRef, {
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(malformedTwoRef, {
                sportsLibVersionCode: 9_000_001,
            }),
            createProcessingDoc(validLaterRef, {
                sportsLibVersion: '9.0.2',
                sportsLibVersionCode: 9_000_002,
            }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.cursorProcessingDocPath).toBe(`${malformedTwoRef.path}/metaData/processing`);
        expect(finalCheckpointPayload.cursorProcessingVersionCode).toBe(9_000_001);
        expect(finalCheckpointPayload.lastPassCompletedAt).toBeUndefined();
        expect(hoisted.enqueueSportsLibReparseTask).not.toHaveBeenCalled();
    });

    it('should release reserved enqueue slot when global candidate parent event path is invalid', async () => {
        hoisted.runtimeDefaults.scanLimit = 2;
        hoisted.runtimeDefaults.enqueueLimit = 1;
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);

        const invalidEventRef = {
            path: 'invalid/root',
            get: vi.fn(async () => ({
                exists: true,
                data: () => ({ originalFile: { path: 'invalid.fit' } }),
            })),
        };
        const validEventRef = createEventRef('u1', 'e1', { originalFile: { path: 'valid.fit' } });

        hoisted.processingDocs.push(
            createProcessingDoc(invalidEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(validEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenCalledWith('job-e1');
        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(1);
    });

    it('should reuse released reservation for subsequent valid global candidates after invalid path', async () => {
        hoisted.runtimeDefaults.scanLimit = 3;
        hoisted.runtimeDefaults.enqueueLimit = 2;
        hoisted.buildSportsLibReparseJobId.mockImplementation((_uid: string, eventId: string) => `job-${eventId}`);

        const invalidEventRef = {
            path: 'invalid/root',
            get: vi.fn(async () => ({
                exists: true,
                data: () => ({ originalFile: { path: 'invalid.fit' } }),
            })),
        };
        const validEventRefOne = createEventRef('u1', 'e1', { originalFile: { path: 'valid-1.fit' } });
        const validEventRefTwo = createEventRef('u1', 'e2', { originalFile: { path: 'valid-2.fit' } });

        hoisted.processingDocs.push(
            createProcessingDoc(invalidEventRef, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(validEventRefOne, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
            createProcessingDoc(validEventRefTwo, {
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        );

        await (scheduleSportsLibReparseScan as any)({});

        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenNthCalledWith(1, 'job-e1');
        expect(hoisted.enqueueSportsLibReparseTask).toHaveBeenNthCalledWith(2, 'job-e2', expect.any(Number));
        const finalCheckpointPayload = hoisted.checkpointSet.mock.calls[hoisted.checkpointSet.mock.calls.length - 1][0];
        expect(finalCheckpointPayload.lastEnqueuedCount).toBe(2);
    });
});
