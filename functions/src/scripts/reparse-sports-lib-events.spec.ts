import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const shouldEventBeReparsed = vi.fn();
    const hasPaidOrGraceAccess = vi.fn();
    const extractSourceFiles = vi.fn();
    const reparseEventFromOriginalFiles = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn(() => '9.1.2');
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
    const globalDocs: any[] = [];
    const adminApps: any[] = [];

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

    let globalLimit = 200;
    let globalStartAfter: string | null = null;
    const resetGlobalCollectionState = () => {
        globalLimit = 200;
        globalStartAfter = null;
    };
    const collectionGroup = vi.fn(() => {
        const q = {
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                globalLimit = value;
                return q;
            }),
            startAfter: vi.fn((value: { path?: string }) => {
                globalStartAfter = value?.path || null;
                return q;
            }),
            get: vi.fn(async () => ({
                docs: globalDocs
                    .filter(doc => !globalStartAfter || doc.ref.path > globalStartAfter)
                    .slice(0, globalLimit),
            })),
        };
        return q;
    });

    const firestoreDoc = vi.fn((path: string) => ({ path }));
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
        parseUIDAllowlist,
        writeReparseStatus,
        parseUidAndEventIdFromEventPath,
        runtimeDefaults,
        userEventsByUID,
        globalDocs,
        adminApps,
        collection,
        collectionGroup,
        resetGlobalCollectionState,
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

function makeEventDoc(uid: string, eventId: string, data: Record<string, unknown> = {}): any {
    return {
        id: eventId,
        ref: { path: `users/${uid}/events/${eventId}` },
        data: () => data,
    };
}

describe('reparse-sports-lib-events script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userEventsByUID.clear();
        hoisted.globalDocs.length = 0;
        hoisted.adminApps.length = 0;
        hoisted.resetGlobalCollectionState();
        hoisted.runtimeDefaults.enabled = false;
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.enqueueLimit = 100;
        hoisted.runtimeDefaults.includeFreeUsers = false;
        hoisted.runtimeDefaults.uidAllowlist = null;

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

    it('parseScriptOptions should parse limit and start-after values', () => {
        const options = parseScriptOptions(['--limit', '50', '--start-after', 'users/u1/events/e1']);
        expect(options.limit).toBe(50);
        expect(options.startAfter).toBe('users/u1/events/e1');
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

    it('parseScriptOptions should fallback to default limit when value is invalid', () => {
        const options = parseScriptOptions(['--limit', 'not-a-number']);
        expect(options.limit).toBe(200);
    });

    it('parseScriptOptions should read include-free-users env flag', () => {
        hoisted.runtimeDefaults.includeFreeUsers = true;
        const options = parseScriptOptions([]);
        expect(options.includeFreeUsers).toBe(true);
    });

    it('parseScriptOptions should apply precedence --uid > --uids > constant allowlist', () => {
        hoisted.runtimeDefaults.uidAllowlist = ['constant1', 'constant2'];

        const withUid = parseScriptOptions(['--uid', 'single', '--uids', 'cli1,cli2']);
        expect(withUid.uid).toBe('single');
        expect(withUid.uids).toBeUndefined();

        const withUids = parseScriptOptions(['--uids', 'cli1,cli2']);
        expect(withUids.uid).toBeUndefined();
        expect(withUids.uids).toEqual(['cli1', 'cli2']);

        const withEnv = parseScriptOptions([]);
        expect(withEnv.uids).toEqual(['constant1', 'constant2']);
    });

    it('single UID dry-run should not write', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript(['--uid', 'u1']);
        expect(summary.dryRun).toBe(true);
        expect(summary.candidates).toBe(1);
        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
    });

    it('single UID dry-run should support equals-style uid args', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.globalDocs.push(makeEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } }));

        const summary = await runSportsLibReparseScript(['--uid=u1', '--limit=10']);
        expect(summary.scanned).toBe(1);
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('multi-UID dry-run should iterate allowlisted users only', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [makeEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript(['--uids', 'u1,u2', '--start-after', 'ignored']);
        expect(summary.scanned).toBe(2);
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('should use constant UID allowlist when no CLI UID flags are provided', async () => {
        hoisted.runtimeDefaults.uidAllowlist = ['u1', 'u2'];
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [makeEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript([]);
        expect(summary.scanned).toBe(2);
        expect(hoisted.collectionGroup).not.toHaveBeenCalled();
    });

    it('should use single-UID start-after cursor in user scoped mode', async () => {
        hoisted.userEventsByUID.set('u1', [
            makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            makeEventDoc('u1', 'e2', { originalFile: { path: 'x.fit' } }),
        ]);

        const summary = await runSportsLibReparseScript(['--uid', 'u1', '--start-after', 'e1', '--limit', '5']);
        expect(summary.scanned).toBe(1);
    });

    it('should use collectionGroup mode when no UID filters are provided', async () => {
        hoisted.globalDocs.push(
            makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }),
            makeEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } }),
        );

        const summary = await runSportsLibReparseScript(['--limit', '1', '--start-after', 'users/u1/events/e1']);
        expect(hoisted.collectionGroup).toHaveBeenCalled();
        expect(summary.scanned).toBe(1);
    });

    it('should skip docs whose path cannot be parsed as user events', async () => {
        hoisted.globalDocs.push({
            id: 'invalid',
            ref: { path: 'users/u1/activities/a1' },
            data: () => ({ originalFile: { path: 'x.fit' } }),
        } as any);

        const summary = await runSportsLibReparseScript([]);
        expect(summary.scanned).toBe(1);
        expect(summary.candidates).toBe(0);
    });

    it('should skip events that do not require reparse', async () => {
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.shouldEventBeReparsed.mockResolvedValue(false);

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.candidates).toBe(0);
        expect(summary.completed).toBe(0);
    });

    it('multi-UID execute mode should process events', async () => {
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);
        hoisted.userEventsByUID.set('u2', [makeEventDoc('u2', 'e2', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript(['--execute', '--uids', 'u1,u2']);
        expect(summary.dryRun).toBe(false);
        expect(summary.completed).toBe(2);
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', { targetSportsLibVersion: '9.1.2' });
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u2', 'e2', { targetSportsLibVersion: '9.1.2' });
    });

    it('should write skipped status when execute mode finds no source files', async () => {
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', {}));
        hoisted.extractSourceFiles.mockReturnValue([]);

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.skippedNoSourceFiles).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
            targetSportsLibVersion: '9.1.2',
        }));
    });

    it('should write completed status in execute mode when reparse succeeds', async () => {
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.completed).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'completed',
            targetSportsLibVersion: '9.1.2',
            lastError: '',
        }));
    });

    it('should write skipped status when reparse returns NO_ORIGINAL_FILES in execute mode', async () => {
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.reparseEventFromOriginalFiles.mockResolvedValue({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
            sourceFilesCount: 0,
            parsedActivitiesCount: 0,
            staleActivitiesDeleted: 0,
        });

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.skippedNoSourceFiles).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
    });

    it('should write failed status when reparse throws in execute mode', async () => {
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.reparseEventFromOriginalFiles.mockRejectedValue(new Error('boom'));

        const summary = await runSportsLibReparseScript(['--execute']);
        expect(summary.failed).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'failed',
            reason: 'REPARSE_FAILED',
            lastError: 'boom',
        }));
    });

    it('should log firestore index url when present in reparse error', async () => {
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));
        hoisted.reparseEventFromOriginalFiles.mockRejectedValue(new Error(
            'FAILED_PRECONDITION: index missing https://console.firebase.google.com/v1/r/project/quantified-self-io/firestore/indexes?create_composite=abc',
        ));

        await runSportsLibReparseScript(['--execute']);

        expect(hoisted.loggerError).toHaveBeenCalledWith(
            '[sports-lib-reparse-script] Reparse failed',
            expect.objectContaining({
                uid: 'u1',
                eventId: 'e1',
                firestoreIndexUrl: 'https://console.firebase.google.com/v1/r/project/quantified-self-io/firestore/indexes?create_composite=abc',
            }),
        );
    });

    it('should skip allowlisted users without paid access', async () => {
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript(['--execute', '--uids', 'u1']);
        expect(summary.skippedNoAccess).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
    });

    it('should include free users when include-free-users flag is enabled', async () => {
        hoisted.runtimeDefaults.includeFreeUsers = true;
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(false);
        hoisted.userEventsByUID.set('u1', [makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } })]);

        const summary = await runSportsLibReparseScript(['--execute', '--uids', 'u1']);
        expect(hoisted.hasPaidOrGraceAccess).not.toHaveBeenCalled();
        expect(summary.skippedNoAccess).toBe(0);
        expect(summary.completed).toBe(1);
    });

    it('should not initialize firebase app when one already exists', async () => {
        hoisted.adminApps.push({ name: 'existing-app' });
        hoisted.globalDocs.push(makeEventDoc('u1', 'e1', { originalFile: { path: 'x.fit' } }));

        await runSportsLibReparseScript([]);
        expect(hoisted.initializeApp).not.toHaveBeenCalled();
    });
});
