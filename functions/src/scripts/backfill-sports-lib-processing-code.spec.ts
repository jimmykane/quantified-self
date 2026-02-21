import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const parseUIDAllowlist = vi.fn((input?: string) => {
        if (!input) return null;
        const values = input.split(',').map(v => v.trim()).filter(Boolean);
        return values.length ? new Set(values) : null;
    });
    const parseUidAndEventIdFromEventPath = vi.fn((path: string) => {
        const parts = path.split('/');
        if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'events') {
            return null;
        }
        return { uid: parts[1], eventId: parts[3] };
    });
    const sportsLibVersionToCode = vi.fn((version: string) => {
        if (version === '0.0.0') return 0;
        if (version === '9.0.0') return 9_000_000;
        if (version === '9.1.4') return 9_001_004;
        throw new Error(`Invalid sports-lib version "${version}"`);
    });
    const runtimeDefaults = {
        enabled: false,
        scanLimit: 200,
        enqueueLimit: 100,
        includeFreeUsers: false,
        uidAllowlist: null as string[] | null,
    };

    const userEventsByUID = new Map<string, any[]>();
    const globalEventDocs: any[] = [];
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
    const resetGlobalQueryState = () => {
        globalLimit = 200;
        globalStartAfter = null;
    };
    const collectionGroup = vi.fn((path: string) => {
        if (path !== 'events') {
            throw new Error(`Unexpected collectionGroup path: ${path}`);
        }
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
                docs: globalEventDocs
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
        parseUIDAllowlist,
        parseUidAndEventIdFromEventPath,
        sportsLibVersionToCode,
        runtimeDefaults,
        userEventsByUID,
        globalEventDocs,
        adminApps,
        collection,
        collectionGroup,
        resetGlobalQueryState,
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
    parseUIDAllowlist: hoisted.parseUIDAllowlist,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
    sportsLibVersionToCode: hoisted.sportsLibVersionToCode,
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

import { parseBackfillOptions, runBackfillSportsLibProcessingCode } from './backfill-sports-lib-processing-code';

function makeEventDoc(
    uid: string,
    eventId: string,
    processingState: {
        exists: boolean;
        data?: Record<string, unknown>;
    },
): any {
    const processingSet = vi.fn().mockResolvedValue(undefined);
    const processingGet = vi.fn(async () => ({
        exists: processingState.exists,
        data: () => processingState.data || {},
    }));

    return {
        id: eventId,
        ref: {
            path: `users/${uid}/events/${eventId}`,
            collection: vi.fn((name: string) => {
                if (name !== 'metaData') {
                    return { doc: vi.fn() };
                }
                return {
                    doc: vi.fn((docId: string) => {
                        if (docId !== 'processing') {
                            throw new Error(`Unexpected metadata doc id: ${docId}`);
                        }
                        return {
                            path: `users/${uid}/events/${eventId}/metaData/processing`,
                            get: processingGet,
                            set: processingSet,
                        };
                    }),
                };
            }),
        },
        processingSet,
    };
}

describe('backfill-sports-lib-processing-code script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userEventsByUID.clear();
        hoisted.globalEventDocs.length = 0;
        hoisted.adminApps.length = 0;
        hoisted.resetGlobalQueryState();
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.uidAllowlist = null;
    });

    it('parseBackfillOptions should default to dry-run', () => {
        const options = parseBackfillOptions([]);
        expect(options.execute).toBe(false);
        expect(options.limit).toBe(200);
    });

    it('parseBackfillOptions should apply precedence --uid > --uids > constant allowlist', () => {
        hoisted.runtimeDefaults.uidAllowlist = ['constant1', 'constant2'];

        const withUid = parseBackfillOptions(['--uid', 'single', '--uids', 'cli1,cli2']);
        expect(withUid.uid).toBe('single');
        expect(withUid.uids).toBeUndefined();

        const withUids = parseBackfillOptions(['--uids', 'cli1,cli2']);
        expect(withUids.uids).toEqual(['cli1', 'cli2']);

        const withConstant = parseBackfillOptions([]);
        expect(withConstant.uids).toEqual(['constant1', 'constant2']);
    });

    it('should create missing processing metadata with sentinel version in execute mode', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', { exists: false });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runBackfillSportsLibProcessingCode(['--execute', '--uid', 'u1']);
        expect(summary.created).toBe(1);
        expect(summary.failed).toBe(0);
        expect(eventDoc.processingSet).toHaveBeenCalledWith(expect.objectContaining({
            sportsLibVersion: '0.0.0',
            sportsLibVersionCode: 0,
            processedAt: 'SERVER_TIMESTAMP',
        }), { merge: true });
    });

    it('should patch missing sportsLibVersionCode when processing version is valid', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '9.0.0' },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runBackfillSportsLibProcessingCode(['--execute', '--uid', 'u1']);
        expect(summary.patched).toBe(1);
        expect(summary.skippedInvalid).toBe(0);
        expect(eventDoc.processingSet).toHaveBeenCalledWith({
            sportsLibVersionCode: 9_000_000,
        }, { merge: true });
    });

    it('should skip invalid sportsLibVersion values without aborting run', async () => {
        const invalidDoc = makeEventDoc('u1', 'invalid', {
            exists: true,
            data: { sportsLibVersion: 'unknown' },
        });
        const validDoc = makeEventDoc('u1', 'valid', {
            exists: true,
            data: { sportsLibVersion: '9.0.0' },
        });
        hoisted.userEventsByUID.set('u1', [invalidDoc, validDoc]);

        const summary = await runBackfillSportsLibProcessingCode(['--execute', '--uid', 'u1']);
        expect(summary.skippedInvalid).toBe(1);
        expect(summary.patched).toBe(1);
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[sports-lib-processing-backfill] Invalid processing metadata. Could not parse sportsLibVersion.',
            expect.objectContaining({
                processingDocPath: 'users/u1/events/invalid/metaData/processing',
            }),
        );
    });

    it('should not write documents in dry-run mode', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', { exists: false });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runBackfillSportsLibProcessingCode(['--uid', 'u1']);
        expect(summary.dryRun).toBe(true);
        expect(summary.created).toBe(1);
        expect(eventDoc.processingSet).not.toHaveBeenCalled();
    });
});
