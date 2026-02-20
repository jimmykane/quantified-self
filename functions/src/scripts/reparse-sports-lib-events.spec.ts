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
