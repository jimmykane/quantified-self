import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from '../reparse/sports-lib-reparse.config';

const TARGET_SPORTS_LIB_VERSION = SPORTS_LIB_REPARSE_TARGET_VERSION;
const TARGET_SPORTS_LIB_VERSION_CODE = 9_001_004;

const hoisted = vi.hoisted(() => {
    const shouldEventBeReparsed = vi.fn();
    const hasPaidOrGraceAccess = vi.fn();
    const extractSourceFiles = vi.fn();
    const reparseEventFromOriginalFiles = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn();
    const resolveTargetSportsLibVersionCode = vi.fn();
    const sportsLibVersionToCode = vi.fn();
    const parseUIDAllowlist = vi.fn((input?: string) => {
        if (!input) return null;
        const values = input.split(',').map(v => v.trim()).filter(Boolean);
        return values.length ? new Set(values) : null;
    });
    const writeReparseStatus = vi.fn();
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
        includeFreeUsers: false,
        uidAllowlist: null as string[] | null,
    };

    const userEventsByUID = new Map<string, any[]>();
    const processingDocs: any[] = [];
    const processingDocDataByPath = new Map<string, Record<string, unknown>>();
    const eventRefsByPath = new Map<string, any>();
    const adminApps: any[] = [];

    let processingLimit = 200;
    let processingCursorCode: number | null = null;
    let processingCursorPath: string | null = null;
    let processingTargetCode: number | null = null;
    const resetProcessingCollectionState = () => {
        processingLimit = 200;
        processingCursorCode = null;
        processingCursorPath = null;
        processingTargetCode = null;
    };

    const collection = vi.fn((path: string) => {
        const match = path.match(/^users\/([^/]+)\/events$/);
        if (!match) {
            return {
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                startAfter: vi.fn().mockReturnThis(),
                get: vi.fn().mockResolvedValue({ docs: [] }),
            };
        }

        const uid = match[1];
        let limitValue = 200;
        let startAfterId: string | null = null;
        const q = {
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                limitValue = value;
                return q;
            }),
            startAfter: vi.fn((value: string) => {
                startAfterId = value;
                return q;
            }),
            get: vi.fn(async () => {
                const docs = userEventsByUID.get(uid) || [];
                const startIndex = startAfterId ? docs.findIndex(doc => doc.id === startAfterId) + 1 : 0;
                return { docs: docs.slice(startIndex, startIndex + limitValue) };
            }),
        };
        return q;
    });

    const collectionGroup = vi.fn((path: string) => {
        if (path !== 'processing') {
            throw new Error(`Unexpected collectionGroup path: ${path}`);
        }

        const q = {
            where: vi.fn((_field: string, _op: string, value: number) => {
                processingTargetCode = value;
                return q;
            }),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                processingLimit = value;
                return q;
            }),
            startAfter: vi.fn((code: number, docRef: { path?: string }) => {
                processingCursorCode = code;
                processingCursorPath = docRef?.path || null;
                return q;
            }),
            get: vi.fn(async () => ({
                docs: processingDocs
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
                        if (processingCursorCode === null || !processingCursorPath) {
                            return true;
                        }
                        const code = doc.data()?.sportsLibVersionCode;
                        if (code > processingCursorCode) {
                            return true;
                        }
                        if (code < processingCursorCode) {
                            return false;
                        }
                        return doc.ref.path > processingCursorPath;
                    })
                    .slice(0, processingLimit),
            })),
        };
        return q;
    });

    const firestoreDoc = vi.fn((path: string) => {
        if (eventRefsByPath.has(path)) {
            return eventRefsByPath.get(path);
        }
        const processingData = processingDocDataByPath.get(path);
        if (processingData) {
            return {
                path,
                get: vi.fn(async () => ({ exists: true, data: () => processingData })),
            };
        }
        return {
            path,
            get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
        };
    });
    const initializeApp = vi.fn();
    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');

    return {
        shouldEventBeReparsed,
        hasPaidOrGraceAccess,
        extractSourceFiles,
        reparseEventFromOriginalFiles,
        resolveTargetSportsLibVersion,
        resolveTargetSportsLibVersionCode,
        sportsLibVersionToCode,
        parseUIDAllowlist,
        writeReparseStatus,
        parseUidAndEventIdFromEventPath,
        runtimeDefaults,
        userEventsByUID,
        processingDocs,
        processingDocDataByPath,
        eventRefsByPath,
        adminApps,
        collection,
        collectionGroup,
        resetProcessingCollectionState,
        firestoreDoc,
        initializeApp,
        loggerInfo,
        loggerWarn,
        loggerError,
        serverTimestamp,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    shouldEventBeReparsed: hoisted.shouldEventBeReparsed,
    hasPaidOrGraceAccess: hoisted.hasPaidOrGraceAccess,
    extractSourceFiles: hoisted.extractSourceFiles,
    reparseEventFromOriginalFiles: hoisted.reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode: hoisted.resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode: hoisted.sportsLibVersionToCode,
    parseUIDAllowlist: hoisted.parseUIDAllowlist,
    writeReparseStatus: hoisted.writeReparseStatus,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
        collectionGroup: hoisted.collectionGroup,
        doc: hoisted.firestoreDoc,
    }));
    Object.assign(firestoreFn, {
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
        },
        FieldPath: {
            documentId: () => '__name__',
        },
    });

    return {
        apps: hoisted.adminApps,
        initializeApp: hoisted.initializeApp,
        firestore: firestoreFn,
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    warn: hoisted.loggerWarn,
    error: hoisted.loggerError,
}));

import { parseScriptOptions, runSportsLibReparseScript } from './reparse-sports-lib-events';

function createEventRef(uid: string, eventId: string, eventData: Record<string, unknown> = {}): any {
    const path = `users/${uid}/events/${eventId}`;
    const ref = {
        path,
        get: vi.fn(async () => ({ exists: true, data: () => eventData })),
    };
    hoisted.eventRefsByPath.set(path, ref);
    return ref;
}

function makeEventDoc(uid: string, eventId: string, data: Record<string, unknown> = {}): any {
    const ref = createEventRef(uid, eventId, data);
    return {
        id: eventId,
        ref,
        data: () => data,
    };
}

function createProcessingDoc(eventRef: any, data: Record<string, unknown>): any {
    const path = `${eventRef.path}/metaData/processing`;
    hoisted.processingDocDataByPath.set(path, data);
    return {
        ref: {
            path,
            parent: {
                parent: eventRef,
            },
        },
        data: () => data,
    };
}

describe('reparse-sports-lib-events script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userEventsByUID.clear();
        hoisted.processingDocs.length = 0;
        hoisted.processingDocDataByPath.clear();
        hoisted.eventRefsByPath.clear();
        hoisted.adminApps.length = 0;
        hoisted.resetProcessingCollectionState();

        hoisted.runtimeDefaults.enabled = false;
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.enqueueLimit = 100;
        hoisted.runtimeDefaults.includeFreeUsers = false;
        hoisted.runtimeDefaults.uidAllowlist = null;
        hoisted.resolveTargetSportsLibVersion.mockReturnValue(TARGET_SPORTS_LIB_VERSION);
        hoisted.resolveTargetSportsLibVersionCode.mockReturnValue(TARGET_SPORTS_LIB_VERSION_CODE);
        hoisted.sportsLibVersionToCode.mockImplementation((version: string) => {
            if (version === '9.0.0') return 9_000_000;
            if (version === '9.0.1') return 9_000_001;
            if (version === TARGET_SPORTS_LIB_VERSION) return TARGET_SPORTS_LIB_VERSION_CODE;
            throw new Error(`Invalid sports-lib version "${version}"`);
        });

        hoisted.shouldEventBeReparsed.mockResolvedValue(true);
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(true);
        hoisted.extractSourceFiles.mockReturnValue([{ path: 'users/u1/events/e1/original.fit' }]);
        hoisted.reparseEventFromOriginalFiles.mockResolvedValue({
            status: 'completed',
            sourceFilesCount: 1,
            parsedActivitiesCount: 1,
            staleActivitiesDeleted: 0,
        });
    });

    it('parseScriptOptions should default to dry-run', () => {
        const options = parseScriptOptions([]);
        expect(options.execute).toBe(false);
        expect(options.limit).toBe(200);
        expect(options.includeFreeUsers).toBe(false);
    });

    it('parseScriptOptions should parse --key=value style args', () => {
        const options = parseScriptOptions([
            '--uid=u1',
            '--uids=u2,u3',
            '--limit=75',
            '--start-after=users/u1/events/e1',
        ]);
        expect(options.uid).toBe('u1');
        expect(options.uids).toBeUndefined();
        expect(options.limit).toBe(75);
        expect(options.startAfter).toBe('users/u1/events/e1');
    });

    it('parseScriptOptions should fallback to default limit when limit is invalid', () => {
        const withZero = parseScriptOptions(['--limit', '0']);
        const withText = parseScriptOptions(['--limit', 'abc']);
        expect(withZero.limit).toBe(200);
        expect(withText.limit).toBe(200);
    });

    it('parseScriptOptions should apply precedence --uid > --uids > constant allowlist', () => {
        hoisted.runtimeDefaults.uidAllowlist = ['constant1', 'constant2'];

        const withUid = parseScriptOptions(['--uid', 'single', '--uids', 'cli1,cli2']);
        expect(withUid.uid).toBe('single');
        expect(withUid.uids).toBeUndefined();

        const withUids = parseScriptOptions(['--uids', 'cli1,cli2']);
        expect(withUids.uid).toBeUndefined();
        expect(withUids.uids).toEqual(['cli1', 'cli2']);

        const withConstant = parseScriptOptions([]);
        expect(withConstant.uids).toEqual(['constant1', 'constant2']);
    });

    it('single UID mode should stay scoped and use candidate evaluation', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript(['--uid', 'u1', '--execute']);
        expect(summary.completed).toBe(1);
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
        expect(hoisted.shouldEventBeReparsed).toHaveBeenCalledTimes(1);
    });

    it('single UID mode should respect --start-after', async () => {
        hoisted.userEventsByUID.set('u1', [
            makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            makeEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }),
        ]);

        const summary = await runSportsLibReparseScript(['--uid', 'u1', '--start-after', 'e1']);
        expect(summary.scanned).toBe(1);
        expect(summary.candidates).toBe(1);
    });

    it('multi-UID mode should ignore --start-after and respect global limit', async () => {
        hoisted.userEventsByUID.set('u1', [
            makeEventDoc('u1', 'a1', { originalFile: { path: 'x.fit' } }),
            makeEventDoc('u1', 'a2', { originalFile: { path: 'x.fit' } }),
        ]);
        hoisted.userEventsByUID.set('u2', [
            makeEventDoc('u2', 'b1', { originalFile: { path: 'x.fit' } }),
            makeEventDoc('u2', 'b2', { originalFile: { path: 'x.fit' } }),
        ]);

        const summary = await runSportsLibReparseScript([
            '--uids',
            'u1,u2',
            '--limit',
            '3',
            '--start-after',
            'ignored',
        ]);
        expect(summary.scanned).toBe(3);
        expect(summary.candidates).toBe(3);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith('[sports-lib-reparse-script] Ignoring --start-after in multi-UID mode.');
    });

    it('scoped mode should skip docs whose path is not parseable as users/{uid}/events/{eventId}', async () => {
        hoisted.userEventsByUID.set('u1', [{
            id: 'bad',
            ref: { path: 'bad/path' },
            data: () => ({ originalFile: { path: 'x.fit' } }),
        }]);

        const summary = await runSportsLibReparseScript(['--uid', 'u1']);
        expect(summary.scanned).toBe(1);
        expect(summary.candidates).toBe(0);
        expect(hoisted.shouldEventBeReparsed).not.toHaveBeenCalled();
    });

    it('scoped mode should skip event when shouldEventBeReparsed throws', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.shouldEventBeReparsed.mockRejectedValueOnce(new Error('bad processing metadata'));

        const summary = await runSportsLibReparseScript(['--uid', 'u1']);
        expect(summary.scanned).toBe(1);
        expect(summary.candidates).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Invalid processing metadata; skipping event.',
            expect.objectContaining({
                eventPath: 'users/u1/events/e1',
            }),
        );
    });

    it('scoped mode should skip event when shouldEventBeReparsed returns false', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.shouldEventBeReparsed.mockResolvedValueOnce(false);

        const summary = await runSportsLibReparseScript(['--uid', 'u1']);
        expect(summary.scanned).toBe(1);
        expect(summary.candidates).toBe(0);
    });

    it('global mode should discover candidates from processing metadata query', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(1);
        expect(hoisted.collectionGroup).toHaveBeenCalledWith('processing');
        expect(hoisted.shouldEventBeReparsed).not.toHaveBeenCalled();
    });

    it('global mode should support --start-after event path by converting to processing path', async () => {
        const eventRefOne = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        const eventRefTwo = createEventRef('u1', 'e2', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(eventRefOne, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 9_000_000 }),
            createProcessingDoc(eventRefTwo, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 9_000_000 }),
        );

        const summary = await runSportsLibReparseScript(['--execute', '--start-after', eventRefOne.path, '--limit', '10']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(1);
    });

    it('global mode should accept --start-after as processing path directly', async () => {
        const eventRefOne = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        const eventRefTwo = createEventRef('u1', 'e2', { originalFile: { path: 'x.fit' } });
        const processingOne = createProcessingDoc(eventRefOne, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 9_000_000 });
        const processingTwo = createProcessingDoc(eventRefTwo, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 9_000_000 });
        hoisted.processingDocs.push(processingOne, processingTwo);

        const summary = await runSportsLibReparseScript([
            '--execute',
            '--start-after',
            `${eventRefOne.path}/metaData/processing`,
            '--limit',
            '10',
        ]);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(1);
    });

    it('global mode should warn when --start-after is not event path or processing path', async () => {
        await runSportsLibReparseScript(['--start-after', 'invalid-start-after']);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Ignoring --start-after. Expected event path or processing metadata path.',
            expect.objectContaining({ startAfter: 'invalid-start-after' }),
        );
    });

    it('global mode should warn when --start-after processing doc does not exist', async () => {
        await runSportsLibReparseScript(['--start-after', 'users/u1/events/e1/metaData/processing']);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Ignoring --start-after because processing doc was not found.',
            expect.objectContaining({ processingStartAfterPath: 'users/u1/events/e1/metaData/processing' }),
        );
    });

    it('global mode should warn when --start-after processing doc has invalid version code', async () => {
        hoisted.processingDocDataByPath.set('users/u1/events/e1/metaData/processing', {
            sportsLibVersionCode: 'bad-code',
        });
        await runSportsLibReparseScript(['--start-after', 'users/u1/events/e1/metaData/processing']);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Ignoring --start-after because processing metadata has invalid sportsLibVersionCode.',
            expect.objectContaining({ processingStartAfterPath: 'users/u1/events/e1/metaData/processing' }),
        );
    });

    it('should skip malformed processing metadata in global mode and continue', async () => {
        const invalidRef = createEventRef('u1', 'bad', { originalFile: { path: 'x.fit' } });
        const validRef = createEventRef('u1', 'good', { originalFile: { path: 'y.fit' } });
        hoisted.processingDocs.push(
            createProcessingDoc(invalidRef, { sportsLibVersion: '9.0.0', sportsLibVersionCode: 123 }),
            createProcessingDoc(validRef, { sportsLibVersion: '9.0.1', sportsLibVersionCode: 9_000_001 }),
        );

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(2);
        expect(summary.completed).toBe(1);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Mismatched processing metadata version/code; skipping doc.',
            expect.objectContaining({
                processingDocPath: `${invalidRef.path}/metaData/processing`,
            }),
        );
    });

    it('global mode should skip invalid processing doc shape and continue', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: 123,
            sportsLibVersionCode: 1,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Invalid processing metadata; skipping doc.',
            expect.objectContaining({
                processingDocPath: `${eventRef.path}/metaData/processing`,
            }),
        );
    });

    it('global mode should skip when semver conversion throws and continue', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: 'unknown',
            sportsLibVersionCode: 1,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Invalid processing metadata; skipping doc.',
            expect.objectContaining({
                processingDocPath: `${eventRef.path}/metaData/processing`,
            }),
        );
    });

    it('global mode should skip processing docs without parent event reference', async () => {
        hoisted.processingDocs.push({
            ref: {
                path: 'users/u1/events/e1/metaData/processing',
                parent: { parent: null },
            },
            data: () => ({
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Could not resolve parent event from processing metadata path.',
            expect.objectContaining({ processingDocPath: 'users/u1/events/e1/metaData/processing' }),
        );
    });

    it('global mode should skip processing docs whose parent path cannot be parsed', async () => {
        const invalidEventRef = {
            path: 'invalid/path',
            get: vi.fn(async () => ({ exists: true, data: () => ({ originalFile: { path: 'x.fit' } }) })),
        };
        hoisted.processingDocs.push({
            ref: {
                path: 'invalid/path/metaData/processing',
                parent: { parent: invalidEventRef },
            },
            data: () => ({
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Could not parse UID/eventID from processing metadata parent path.',
            expect.objectContaining({ eventPath: 'invalid/path' }),
        );
    });

    it('global mode should skip stale processing docs when parent event is missing', async () => {
        const missingEventRef = {
            path: 'users/u1/events/missing',
            get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
        };
        hoisted.processingDocs.push({
            ref: {
                path: 'users/u1/events/missing/metaData/processing',
                parent: { parent: missingEventRef },
            },
            data: () => ({
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Skipping stale processing metadata because parent event is missing.',
            expect.objectContaining({ eventPath: 'users/u1/events/missing' }),
        );
    });

    it('should skip events with no source files and write skipped status in execute mode', async () => {
        const eventRef = createEventRef('u1', 'e1', {});
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.extractSourceFiles.mockReturnValue([]);

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.skippedNoSourceFiles).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
    });

    it('should count skippedNoAccess when include-free-users is disabled', async () => {
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.skippedNoAccess).toBe(1);
        expect(summary.candidates).toBe(0);
    });

    it('should handle execute path when reparse returns skipped because no original files', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.reparseEventFromOriginalFiles.mockResolvedValueOnce({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
            sourceFilesCount: 0,
            parsedActivitiesCount: 0,
            staleActivitiesDeleted: 0,
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.skippedNoSourceFiles).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
    });

    it('should handle execute path when reparse throws and include firestore index URL in logs', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.reparseEventFromOriginalFiles.mockRejectedValueOnce(new Error(
            'Missing index. Create: https://console.firebase.google.com/project/test/firestore/indexes?create_composite=abc',
        ));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.failed).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            reason: 'REPARSE_FAILED',
        }));
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Reparse failed',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                firestoreIndexUrl: 'https://console.firebase.google.com/project/test/firestore/indexes?create_composite=abc',
            }),
        );
    });

    it('should include free users when include-free-users flag is enabled', async () => {
        hoisted.runtimeDefaults.includeFreeUsers = true;
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.completed).toBe(1);
        expect(hoisted.hasPaidOrGraceAccess).not.toHaveBeenCalled();
    });

    it('should not initialize firebase app when one already exists', async () => {
        hoisted.adminApps.push({ name: 'existing-app' });
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        await runSportsLibReparseScript([]);
        expect(hoisted.initializeApp).not.toHaveBeenCalled();
    });
});
