import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
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
    };
    const userEventsByUID = new Map<string, any[]>();
    const globalEventDocs: any[] = [];
    const adminApps: any[] = [];
    const resumeCheckpointPath = 'temp_collection/temp_doc_eventProcessingEntityBackfill';
    let resumeCheckpointData: Record<string, unknown> | undefined;
    const resumeCheckpointSet = vi.fn(async (payload: Record<string, unknown>) => {
        resumeCheckpointData = {
            ...(resumeCheckpointData || {}),
            ...payload,
        };
    });
    const getUserDeletionGuardStateInTransaction = vi.fn(async () => ({
        userExists: true,
        deletionInProgress: false,
        shouldSkip: false,
    }));

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

    const firestoreDoc = vi.fn((path: string) => ({
        path,
        get: vi.fn(async () => {
            if (path === resumeCheckpointPath) {
                return {
                    data: () => resumeCheckpointData,
                };
            }
            return {
                exists: true,
                data: () => ({}),
            };
        }),
        set: path === resumeCheckpointPath ? resumeCheckpointSet : vi.fn(async () => undefined),
    }));
    const runTransaction = vi.fn(async (callback: (transaction: any) => Promise<unknown>) => {
        const transaction = {
            get: vi.fn(async (ref: { get?: () => Promise<unknown> }) => {
                if (typeof ref.get === 'function') {
                    return ref.get();
                }
                return { exists: true, data: () => ({}) };
            }),
            set: vi.fn((ref: { set?: (payload: unknown, options?: unknown) => Promise<unknown> }, payload: unknown, options?: unknown) => {
                if (typeof ref.set === 'function') {
                    return ref.set(payload, options);
                }
                return undefined;
            }),
        };
        return callback(transaction);
    });
    const initializeApp = vi.fn();
    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();
    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');

    return {
        parseUidAndEventIdFromEventPath,
        runtimeDefaults,
        userEventsByUID,
        globalEventDocs,
        adminApps,
        collection,
        collectionGroup,
        resetGlobalQueryState,
        firestoreDoc,
        runTransaction,
        getUserDeletionGuardStateInTransaction,
        initializeApp,
        loggerInfo,
        loggerWarn,
        loggerError,
        serverTimestamp,
        resumeCheckpointPath,
        getResumeCheckpointData: () => resumeCheckpointData,
        setResumeCheckpointData: (value: Record<string, unknown> | undefined) => {
            resumeCheckpointData = value;
        },
        resumeCheckpointSet,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS: hoisted.runtimeDefaults,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
}));

vi.mock('../shared/processing-metadata.interface', () => ({
    EVENT_PROCESSING_ENTITY: 'event',
}));

vi.mock('../shared/user-deletion-guard', () => ({
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error { },
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
        collectionGroup: hoisted.collectionGroup,
        doc: hoisted.firestoreDoc,
        runTransaction: hoisted.runTransaction,
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

import {
    parseBackfillEventProcessingEntityOptions,
    runBackfillEventProcessingEntity,
    shouldFailBackfillEventProcessingEntityRun,
} from './backfill-event-processing-entity';

function makeEventDoc(
    uid: string,
    eventId: string,
    processingState: {
        exists: boolean;
        data?: Record<string, unknown>;
        eventExists?: boolean;
    },
): any {
    const processingSet = vi.fn().mockResolvedValue(undefined);
    const processingGet = vi.fn(async () => ({
        exists: processingState.exists,
        data: () => processingState.data || {},
    }));
    const eventGet = vi.fn(async () => ({
        exists: processingState.eventExists !== false,
        data: () => ({}),
    }));

    return {
        id: eventId,
        ref: {
            path: `users/${uid}/events/${eventId}`,
            get: eventGet,
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
        eventGet,
    };
}

describe('backfill-event-processing-entity script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userEventsByUID.clear();
        hoisted.globalEventDocs.length = 0;
        hoisted.adminApps.length = 0;
        hoisted.resetGlobalQueryState();
        hoisted.runtimeDefaults.scanLimit = 200;
        hoisted.setResumeCheckpointData(undefined);
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
    });

    it('parses options with defaults and single uid scope', () => {
        expect(parseBackfillEventProcessingEntityOptions([])).toEqual({
            execute: false,
            uid: undefined,
            limit: 200,
            startAfter: undefined,
            concurrency: 5,
            resume: false,
        });
        expect(parseBackfillEventProcessingEntityOptions([
            '--execute',
            '--uid',
            'u1',
            '--limit',
            '10',
            '--concurrency',
            '99',
        ])).toEqual({
            execute: true,
            uid: 'u1',
            limit: 10,
            startAfter: undefined,
            concurrency: 50,
            resume: false,
        });
        expect(parseBackfillEventProcessingEntityOptions(['--resume']).resume).toBe(true);
    });

    it('rejects multi-uid scope because resume checkpoints are single-cursor only', () => {
        expect(() => parseBackfillEventProcessingEntityOptions(['--uids', 'u1,u2']))
            .toThrow('--uids');
        expect(() => parseBackfillEventProcessingEntityOptions(['--uids=u1,u2']))
            .toThrow('--uids');
    });

    it('fails CLI execute runs when per-event failures were counted', () => {
        expect(shouldFailBackfillEventProcessingEntityRun({
            dryRun: true,
            failed: 1,
        })).toBe(false);
        expect(shouldFailBackfillEventProcessingEntityRun({
            dryRun: false,
            failed: 0,
        })).toBe(false);
        expect(shouldFailBackfillEventProcessingEntityRun({
            dryRun: false,
            failed: 1,
        })).toBe(true);
    });

    it('dry-runs missing event processing entity patches without writing', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.globalEventDocs.push(eventDoc);

        const summary = await runBackfillEventProcessingEntity([]);

        expect(summary).toMatchObject({
            dryRun: true,
            scanned: 1,
            patched: 1,
            unchanged: 0,
            skippedMissing: 0,
            skippedInvalid: 0,
            failed: 0,
        });
        expect(eventDoc.processingSet).not.toHaveBeenCalled();
    });

    it('executes missing event processing entity patches', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runBackfillEventProcessingEntity(['--execute', '--uid', 'u1']);

        expect(summary.patched).toBe(1);
        expect(eventDoc.processingSet).toHaveBeenCalledWith({
            processingEntity: 'event',
        }, { merge: true });
        expect(hoisted.runTransaction).toHaveBeenCalledTimes(1);
        expect(hoisted.getUserDeletionGuardStateInTransaction).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'u1',
        );
    });

    it('leaves event processing metadata unchanged when entity already exists', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { processingEntity: 'event', sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.globalEventDocs.push(eventDoc);

        const summary = await runBackfillEventProcessingEntity(['--execute']);

        expect(summary.unchanged).toBe(1);
        expect(eventDoc.processingSet).not.toHaveBeenCalled();
    });

    it('skips missing processing metadata and unexpected existing entities', async () => {
        const missingDoc = makeEventDoc('u1', 'missing', { exists: false });
        const invalidDoc = makeEventDoc('u1', 'invalid', {
            exists: true,
            data: { processingEntity: 'route' },
        });
        hoisted.globalEventDocs.push(missingDoc, invalidDoc);

        const summary = await runBackfillEventProcessingEntity(['--execute']);

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

    it('skips execute writes when user deletion guard is active', async () => {
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });
        const eventDoc = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runBackfillEventProcessingEntity(['--execute', '--uid', 'u1']);

        expect(summary).toMatchObject({
            scanned: 1,
            patched: 0,
            skippedUserDeletion: 1,
            failed: 0,
        });
        expect(eventDoc.eventGet).not.toHaveBeenCalled();
        expect(eventDoc.processingSet).not.toHaveBeenCalled();
    });

    it('skips execute writes when the event disappeared before transaction write', async () => {
        const eventDoc = makeEventDoc('u1', 'e1', {
            eventExists: false,
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runBackfillEventProcessingEntity(['--execute', '--uid', 'u1']);

        expect(summary).toMatchObject({
            scanned: 1,
            patched: 0,
            skippedEventMissing: 1,
            failed: 0,
        });
        expect(eventDoc.eventGet).toHaveBeenCalled();
        expect(eventDoc.processingSet).not.toHaveBeenCalled();
    });

    it('resumes from checkpoint and updates checkpoint when --resume execute is enabled', async () => {
        hoisted.setResumeCheckpointData({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e1',
        });
        const docOne = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        const docTwo = makeEventDoc('u1', 'e2', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [docOne, docTwo]);

        const summary = await runBackfillEventProcessingEntity(['--execute', '--uid', 'u1', '--resume']);

        expect(summary.scanned).toBe(1);
        expect(hoisted.resumeCheckpointSet).toHaveBeenCalledWith(expect.objectContaining({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e2',
            updatedAt: 'SERVER_TIMESTAMP',
        }), { merge: true });
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[event-processing-entity-backfill] Resuming from checkpoint.',
            expect.objectContaining({
                checkpointPath: hoisted.resumeCheckpointPath,
                scopeKey: 'uid:u1',
                startAfter: 'users/u1/events/e1',
            }),
        );
    });

    it('does not advance the checkpoint during resume dry-run', async () => {
        hoisted.setResumeCheckpointData({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e1',
        });
        const docOne = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        const docTwo = makeEventDoc('u1', 'e2', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [docOne, docTwo]);

        const summary = await runBackfillEventProcessingEntity(['--uid', 'u1', '--resume']);

        expect(summary.scanned).toBe(1);
        expect(hoisted.resumeCheckpointSet).not.toHaveBeenCalled();
        expect(hoisted.getResumeCheckpointData()).toMatchObject({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e1',
        });
    });

    it('does not clear the checkpoint when resume execute finds no more events', async () => {
        hoisted.setResumeCheckpointData({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e2',
        });
        const docOne = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        const docTwo = makeEventDoc('u1', 'e2', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [docOne, docTwo]);

        const summary = await runBackfillEventProcessingEntity(['--execute', '--uid', 'u1', '--resume']);

        expect(summary.scanned).toBe(0);
        expect(hoisted.resumeCheckpointSet).not.toHaveBeenCalled();
        expect(hoisted.getResumeCheckpointData()).toMatchObject({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e2',
        });
        expect(hoisted.loggerInfo).toHaveBeenCalledWith(
            '[event-processing-entity-backfill] No events found; resume checkpoint unchanged.',
            expect.objectContaining({
                checkpointPath: hoisted.resumeCheckpointPath,
                scopeKey: 'uid:u1',
            }),
        );
    });

    it('does not advance the checkpoint when a resume execute batch has failures', async () => {
        hoisted.getUserDeletionGuardStateInTransaction.mockRejectedValueOnce(new Error('guard unavailable'));
        hoisted.setResumeCheckpointData({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e0',
        });
        const docOne = makeEventDoc('u1', 'e1', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        const docTwo = makeEventDoc('u1', 'e2', {
            exists: true,
            data: { sportsLibVersion: '16.0.1', sportsLibVersionCode: 16_000_001 },
        });
        hoisted.userEventsByUID.set('u1', [docOne, docTwo]);

        const summary = await runBackfillEventProcessingEntity([
            '--execute',
            '--uid',
            'u1',
            '--resume',
            '--concurrency',
            '1',
        ]);

        expect(summary).toMatchObject({
            scanned: 2,
            patched: 1,
            failed: 1,
        });
        expect(hoisted.resumeCheckpointSet).not.toHaveBeenCalled();
        expect(hoisted.getResumeCheckpointData()).toMatchObject({
            scopeKey: 'uid:u1',
            lastEventPath: 'users/u1/events/e0',
        });
        expect(hoisted.loggerWarn).toHaveBeenCalledWith(
            '[event-processing-entity-backfill] Resume checkpoint not advanced because the batch had failures.',
            expect.objectContaining({
                checkpointPath: hoisted.resumeCheckpointPath,
                scopeKey: 'uid:u1',
                lastEventPath: 'users/u1/events/e2',
                failed: 1,
            }),
        );
    });
});
