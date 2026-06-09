import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const parseUIDAllowlist = vi.fn((input?: string) => {
        if (!input) return null;
        const values = input.split(',').map(value => value.trim()).filter(Boolean);
        return values.length ? new Set(values) : null;
    });
    const parseUidAndRouteIdFromRoutePath = vi.fn((path: string) => {
        const parts = path.split('/');
        if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'routes') {
            return null;
        }
        return { uid: parts[1], routeId: parts[3] };
    });
    const runtimeDefaults = {
        enabled: false,
        scanLimit: 200,
        enqueueLimit: 100,
        uidAllowlist: [] as string[],
    };
    const userRoutesByUID = new Map<string, any[]>();
    const globalRouteDocs: any[] = [];
    const adminApps: any[] = [];

    const collection = vi.fn((path: string) => {
        const match = path.match(/^users\/([^/]+)\/routes$/);
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
                const docs = userRoutesByUID.get(uid) || [];
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
        if (path !== 'routes') {
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
                docs: globalRouteDocs
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

    return {
        parseUIDAllowlist,
        parseUidAndRouteIdFromRoutePath,
        runtimeDefaults,
        userRoutesByUID,
        globalRouteDocs,
        adminApps,
        collection,
        collectionGroup,
        resetGlobalQueryState,
        firestoreDoc,
        initializeApp,
        loggerInfo,
        loggerWarn,
        loggerError,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    parseUIDAllowlist: hoisted.parseUIDAllowlist,
}));

vi.mock('../reparse/sports-lib-route-reparse.service', () => ({
    SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    parseUidAndRouteIdFromRoutePath: hoisted.parseUidAndRouteIdFromRoutePath,
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
        collectionGroup: hoisted.collectionGroup,
        doc: hoisted.firestoreDoc,
    }));
    Object.assign(firestoreFn, {
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

import {
    parseBackfillRouteProcessingEntityOptions,
    runBackfillRouteProcessingEntity,
} from './backfill-route-processing-entity';

function makeRouteDoc(
    uid: string,
    routeId: string,
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
        id: routeId,
        ref: {
            path: `users/${uid}/routes/${routeId}`,
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
                            path: `users/${uid}/routes/${routeId}/metaData/processing`,
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

describe('backfill-route-processing-entity script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userRoutesByUID.clear();
        hoisted.globalRouteDocs.length = 0;
        hoisted.adminApps.length = 0;
        hoisted.resetGlobalQueryState();
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.runtimeDefaults.uidAllowlist = [];
    });

    it('parses options with defaults and uid allowlists', () => {
        expect(parseBackfillRouteProcessingEntityOptions([])).toEqual({
            execute: false,
            uid: undefined,
            uids: undefined,
            limit: 200,
            startAfter: undefined,
            concurrency: 5,
        });
        expect(parseBackfillRouteProcessingEntityOptions([
            '--execute',
            '--uids',
            'u1,u2',
            '--limit',
            '10',
            '--concurrency',
            '99',
        ])).toEqual({
            execute: true,
            uid: undefined,
            uids: ['u1', 'u2'],
            limit: 10,
            startAfter: undefined,
            concurrency: 50,
        });
    });

    it('dry-runs missing route processing entity patches without writing', async () => {
        const routeDoc = makeRouteDoc('u1', 'r1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.globalRouteDocs.push(routeDoc);

        const summary = await runBackfillRouteProcessingEntity([]);

        expect(summary).toMatchObject({
            dryRun: true,
            scanned: 1,
            patched: 1,
            unchanged: 0,
            skippedMissing: 0,
            skippedInvalid: 0,
            failed: 0,
        });
        expect(routeDoc.processingSet).not.toHaveBeenCalled();
    });

    it('executes missing route processing entity patches', async () => {
        const routeDoc = makeRouteDoc('u1', 'r1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userRoutesByUID.set('u1', [routeDoc]);

        const summary = await runBackfillRouteProcessingEntity(['--execute', '--uid', 'u1']);

        expect(summary.patched).toBe(1);
        expect(routeDoc.processingSet).toHaveBeenCalledWith({
            processingEntity: 'route',
        }, { merge: true });
    });

    it('leaves route processing metadata unchanged when entity already exists', async () => {
        const routeDoc = makeRouteDoc('u1', 'r1', {
            exists: true,
            data: { processingEntity: 'route', sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.globalRouteDocs.push(routeDoc);

        const summary = await runBackfillRouteProcessingEntity(['--execute']);

        expect(summary.unchanged).toBe(1);
        expect(routeDoc.processingSet).not.toHaveBeenCalled();
    });

    it('skips missing processing metadata and unexpected existing entities', async () => {
        const missingDoc = makeRouteDoc('u1', 'missing', { exists: false });
        const invalidDoc = makeRouteDoc('u1', 'invalid', {
            exists: true,
            data: { processingEntity: 'event' },
        });
        hoisted.globalRouteDocs.push(missingDoc, invalidDoc);

        const summary = await runBackfillRouteProcessingEntity(['--execute']);

        expect(summary).toMatchObject({
            scanned: 2,
            patched: 0,
            unchanged: 0,
            skippedMissing: 1,
            skippedInvalid: 1,
            failed: 0,
        });
        expect(missingDoc.processingSet).not.toHaveBeenCalled();
        expect(invalidDoc.processingSet).not.toHaveBeenCalled();
    });
});
