import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from '../reparse/sports-lib-reparse.config';

const TARGET_SPORTS_LIB_VERSION = SPORTS_LIB_REPARSE_TARGET_VERSION;
const TARGET_SPORTS_LIB_VERSION_CODE = 13_000_000;

const hoisted = vi.hoisted(() => {
    const shouldEventBeReparsed = vi.fn();
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
    const isReparsePersistenceSkippedForUserDeletionError = vi.fn((error: unknown) =>
        error instanceof Error && error.name === 'EventWriteSkippedForDeletedUserError');
    const isSportsLibReparseTerminalFailureMessage = vi.fn((errorMessage: string) =>
        errorMessage.startsWith('[sports-lib-reparse] Reparse target sports-lib version ')
        || /^Event .* was not found for user .*$/.test(errorMessage));
    const getUserDeletionGuardState = vi.fn().mockResolvedValue({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    });
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

    const userEventsByUID = new Map<string, any[]>();
    const processingDocs: any[] = [];
    const processingDocDataByPath = new Map<string, Record<string, unknown>>();
    const eventRefsByPath = new Map<string, any>();
    const adminApps: any[] = [];

    let processingLimit = 200;
    let processingCursorCode: number | null = null;
    let processingCursorPath: string | null = null;
    let processingEntityFilter: string | null = null;
    let processingTargetCode: number | null = null;
    const resetProcessingCollectionState = () => {
        processingLimit = 200;
        processingCursorCode = null;
        processingCursorPath = null;
        processingEntityFilter = null;
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
        if (path !== 'metaData') {
            throw new Error(`Unexpected collectionGroup path: ${path}`);
        }

        const q = {
            where: vi.fn((field: string, op: string, value: string | number) => {
                if (field === 'processingEntity' && op === '==') {
                    processingEntityFilter = `${value}`;
                    return q;
                }
                if (field === 'sportsLibVersionCode' && op === '<' && typeof value === 'number') {
                    processingTargetCode = value;
                    return q;
                }
                throw new Error(`Unexpected collectionGroup where: ${field} ${op} ${value}`);
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
                        if (processingEntityFilter === null) {
                            return true;
                        }
                        return doc.data()?.processingEntity === processingEntityFilter;
                    })
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
    const firestoreSettings = vi.fn();
    const initializeApp = vi.fn();
    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');
    const deleteField = vi.fn(() => 'DELETE_FIELD');

    return {
        shouldEventBeReparsed,
        extractSourceFiles,
        reparseEventFromOriginalFiles,
        resolveTargetSportsLibVersion,
        resolveTargetSportsLibVersionCode,
        sportsLibVersionToCode,
        parseUIDAllowlist,
        writeReparseStatus,
        isReparsePersistenceSkippedForUserDeletionError,
        isSportsLibReparseTerminalFailureMessage,
        getUserDeletionGuardState,
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
        firestoreSettings,
        initializeApp,
        loggerInfo,
        loggerWarn,
        loggerError,
        serverTimestamp,
        deleteField,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    shouldEventBeReparsed: hoisted.shouldEventBeReparsed,
    extractSourceFiles: hoisted.extractSourceFiles,
    reparseEventFromOriginalFiles: hoisted.reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode: hoisted.resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode: hoisted.sportsLibVersionToCode,
    parseUIDAllowlist: hoisted.parseUIDAllowlist,
    writeReparseStatus: hoisted.writeReparseStatus,
    isReparsePersistenceSkippedForUserDeletionError: hoisted.isReparsePersistenceSkippedForUserDeletionError,
    isSportsLibReparseTerminalFailureMessage: hoisted.isSportsLibReparseTerminalFailureMessage,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
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
        collectionGroup: hoisted.collectionGroup,
        doc: hoisted.firestoreDoc,
        settings: hoisted.firestoreSettings,
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
    const processingData = {
        processingEntity: 'event',
        ...data,
    };
    hoisted.processingDocDataByPath.set(path, processingData);
    return {
        ref: {
            path,
            parent: {
                parent: eventRef,
            },
        },
        data: () => processingData,
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
        hoisted.runtimeDefaults.uidAllowlist = null;
        hoisted.resolveTargetSportsLibVersion.mockReturnValue(TARGET_SPORTS_LIB_VERSION);
        hoisted.resolveTargetSportsLibVersionCode.mockReturnValue(TARGET_SPORTS_LIB_VERSION_CODE);
        hoisted.isSportsLibReparseTerminalFailureMessage.mockImplementation((errorMessage: string) =>
            errorMessage.startsWith('[sports-lib-reparse] Reparse target sports-lib version ')
            || /^Event .* was not found for user .*$/.test(errorMessage));
        hoisted.sportsLibVersionToCode.mockImplementation((version: string) => {
            if (version === '9.0.0') return 9_000_000;
            if (version === '9.0.1') return 9_000_001;
            if (version === TARGET_SPORTS_LIB_VERSION) return TARGET_SPORTS_LIB_VERSION_CODE;
            throw new Error(`Invalid sports-lib version "${version}"`);
        });

        hoisted.shouldEventBeReparsed.mockResolvedValue(true);
        hoisted.extractSourceFiles.mockReturnValue([{ path: 'users/u1/events/e1/original.fit' }]);
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

    it('parseScriptOptions should default to dry-run', () => {
        const options = parseScriptOptions([]);
        expect(options.execute).toBe(false);
        expect(options.limit).toBe(200);
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
        expect(summary.parsedEvents).toBe(1);
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
        expect(hoisted.shouldEventBeReparsed).toHaveBeenCalledTimes(1);
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Progress',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                outcome: 'completed',
                parsedEvents: 1,
            }),
        );
    });

    it('should configure Firestore to ignore undefined properties before scanning', async () => {
        await runSportsLibReparseScript([]);
        expect(hoisted.firestoreSettings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
    });

    it('single UID mode should support --uid=<uid> and --limit=<n> in execution path', async () => {
        hoisted.userEventsByUID.set('u1', [
            makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            makeEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }),
        ]);

        const summary = await runSportsLibReparseScript(['--uid=u1', '--limit=1', '--execute']);
        expect(summary.scanned).toBe(1);
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
        expect(hoisted.collectionGroup).toHaveBeenCalledWith('metaData');
        expect(hoisted.collectionGroup.mock.results[0].value.where).toHaveBeenCalledWith('processingEntity', '==', 'event');
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

    it('global mode should warn when --start-after is a route processing metadata path', async () => {
        await runSportsLibReparseScript(['--start-after', 'users/u1/routes/r1/metaData/processing']);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Ignoring --start-after. Expected event path or processing metadata path.',
            expect.objectContaining({ startAfter: 'users/u1/routes/r1/metaData/processing' }),
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
                processingEntity: 'event',
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

    it('global mode should skip non-processing metadata docs', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push({
            ref: {
                path: `${eventRef.path}/metaData/custom`,
                parent: { parent: eventRef },
            },
            data: () => ({
                processingEntity: 'event',
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(summary.candidates).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Skipping metadata doc outside event processing path.',
            expect.objectContaining({ processingDocPath: `${eventRef.path}/metaData/custom` }),
        );
    });

    it('global mode should skip route processing metadata docs', async () => {
        hoisted.processingDocs.push({
            ref: {
                path: 'users/u1/routes/r1/metaData/processing',
                parent: {
                    parent: {
                        path: 'users/u1/routes/r1',
                        get: vi.fn(async () => ({ exists: true, data: () => ({ originalFile: { path: 'route.gpx' } }) })),
                    },
                },
            },
            data: () => ({
                processingEntity: 'route',
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(0);
        expect(summary.completed).toBe(0);
        expect(summary.candidates).toBe(0);
        expect(hoisted.loggerWarn).not.toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Skipping metadata doc outside event processing path.',
            expect.objectContaining({ processingDocPath: 'users/u1/routes/r1/metaData/processing' }),
        );
    });

    it('global mode should skip processing docs whose path is not an event processing path', async () => {
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
                processingEntity: 'event',
                sportsLibVersion: '9.0.0',
                sportsLibVersionCode: 9_000_000,
            }),
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.scanned).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Skipping metadata doc outside event processing path.',
            expect.objectContaining({ processingDocPath: 'invalid/path/metaData/processing' }),
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
                processingEntity: 'event',
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
            terminalFailure: 'DELETE_FIELD',
            terminalFailureAt: 'DELETE_FIELD',
        }));
    });

    it('should not fail when guarded missing-source status write skips for account deletion', async () => {
        const deletionSkipError = new Error('Skipping event write for deleted user.');
        deletionSkipError.name = 'EventWriteSkippedForDeletedUserError';
        const eventRef = createEventRef('u1', 'e1', {});
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.extractSourceFiles.mockReturnValue([]);
        hoisted.writeReparseStatus.mockRejectedValueOnce(deletionSkipError);

        const summary = await runSportsLibReparseScript(['--execute']);

        expect(summary.skippedNoSourceFiles).toBe(1);
        expect(summary.failed).toBe(0);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
            terminalFailure: 'DELETE_FIELD',
            terminalFailureAt: 'DELETE_FIELD',
        }));
    });

    it('should keep skippedNoAccess at zero', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.skippedNoAccess).toBe(0);
        expect(summary.candidates).toBe(1);
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
            terminalFailure: 'DELETE_FIELD',
            terminalFailureAt: 'DELETE_FIELD',
        }));
    });

    it('should clear terminal marker when execute path completes successfully', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);

        expect(summary.completed).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'completed',
            terminalFailure: 'DELETE_FIELD',
            terminalFailureAt: 'DELETE_FIELD',
        }));
    });

    it('should skip execute parsing when account deletion is active before execution', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        const summary = await runSportsLibReparseScript(['--execute']);

        expect(summary.candidates).toBe(1);
        expect(summary.parsedEvents).toBe(0);
        expect(summary.failed).toBe(0);
        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
    });

    it('should not count account-deletion persistence skips as reparse failures', async () => {
        const deletionSkipError = new Error('Skipping event write for deleted user.');
        deletionSkipError.name = 'EventWriteSkippedForDeletedUserError';
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.reparseEventFromOriginalFiles.mockRejectedValueOnce(deletionSkipError);

        const summary = await runSportsLibReparseScript(['--execute']);

        expect(summary.parsedEvents).toBe(1);
        expect(summary.failed).toBe(0);
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Progress',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                outcome: 'skipped_user_deletion',
            }),
        );
    });

    it('should pass a deletion guard before persisting reparsed data', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
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
        hoisted.reparseEventFromOriginalFiles.mockImplementationOnce(async (_uid, _eventId, options) => {
            await options.beforePersist();
            return {
                status: 'completed',
                sourceFilesCount: 1,
                parsedActivitiesCount: 1,
                staleActivitiesDeleted: 0,
            };
        });

        const summary = await runSportsLibReparseScript(['--execute']);

        expect(summary.parsedEvents).toBe(1);
        expect(summary.completed).toBe(0);
        expect(summary.failed).toBe(0);
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Progress',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                outcome: 'skipped_user_deletion',
            }),
        );
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
        expect(summary.parsedEvents).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            reason: 'REPARSE_FAILED',
            terminalFailure: 'DELETE_FIELD',
            terminalFailureAt: 'DELETE_FIELD',
        }));
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Progress',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                outcome: 'failed',
                parsedEvents: 1,
            }),
        );
        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Reparse failed',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                firestoreIndexUrl: 'https://console.firebase.google.com/project/test/firestore/indexes?create_composite=abc',
            }),
        );
    });

    it('should mark terminal failures from execute path', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));
        hoisted.reparseEventFromOriginalFiles.mockRejectedValueOnce(new Error('Event e1 was not found for user u1'));

        const summary = await runSportsLibReparseScript(['--execute']);

        expect(summary.failed).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            reason: 'REPARSE_FAILED',
            lastError: 'Event e1 was not found for user u1',
            terminalFailure: true,
            terminalFailureAt: 'SERVER_TIMESTAMP',
        }));
    });

    it('should process candidates without entitlement filtering', async () => {
        const eventRef = createEventRef('u1', 'e1', { originalFile: { path: 'x.fit' } });
        hoisted.processingDocs.push(createProcessingDoc(eventRef, {
            sportsLibVersion: '9.0.0',
            sportsLibVersionCode: 9_000_000,
        }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.completed).toBe(1);
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            mode: 'reimport',
            targetSportsLibVersion: TARGET_SPORTS_LIB_VERSION,
            beforePersist: expect.any(Function),
        }));
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
