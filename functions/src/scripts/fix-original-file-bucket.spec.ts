import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const userEventsByUID = new Map<string, any[]>();
    const globalDocs: any[] = [];
    const adminApps: any[] = [];
    const objectExistence = new Map<string, boolean>();
    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();
    const initializeApp = vi.fn();
    const firestoreDoc = vi.fn((path: string) => ({ path }));

    const setObjectExists = (bucketName: string, path: string, exists: boolean): void => {
        objectExistence.set(`${bucketName}:${path}`, exists);
    };

    const makeEventDoc = (uid: string, eventId: string, data: Record<string, unknown> = {}): any => {
        const path = `users/${uid}/events/${eventId}`;
        return {
            id: eventId,
            ref: {
                path,
                set: vi.fn().mockResolvedValue(undefined),
            },
            data: () => data,
        };
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
        let limitValue = 1000;
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

    let globalLimit = 1000;
    let globalStartAfter: string | null = null;
    const resetGlobalCollectionState = (): void => {
        globalLimit = 1000;
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

    const bucket = vi.fn((bucketName: string) => ({
        file: (path: string) => ({
            exists: vi.fn(async () => [objectExistence.get(`${bucketName}:${path}`) ?? false]),
        }),
    }));

    return {
        userEventsByUID,
        globalDocs,
        adminApps,
        objectExistence,
        loggerInfo,
        loggerWarn,
        loggerError,
        initializeApp,
        firestoreDoc,
        collection,
        collectionGroup,
        resetGlobalCollectionState,
        bucket,
        setObjectExists,
        makeEventDoc,
    };
});

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
        storage: vi.fn(() => ({
            bucket: hoisted.bucket,
        })),
    };
});

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    warn: hoisted.loggerWarn,
    error: hoisted.loggerError,
}));

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    parseUIDAllowlist: (input?: string) => {
        if (!input) {
            return null;
        }
        const values = input.split(',').map(v => v.trim()).filter(Boolean);
        return values.length > 0 ? new Set(values) : null;
    },
}));

import {
    parseFixBucketScriptOptions,
    runFixOriginalFileBucketScript,
} from './fix-original-file-bucket';

describe('fix-original-file-bucket script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.userEventsByUID.clear();
        hoisted.globalDocs.length = 0;
        hoisted.adminApps.length = 0;
        hoisted.objectExistence.clear();
        hoisted.resetGlobalCollectionState();
    });

    it('parseFixBucketScriptOptions should parse equals-style args', () => {
        const options = parseFixBucketScriptOptions([
            '--execute',
            '--uid=u1',
            '--uids=u2,u3',
            '--limit=50',
            '--start-after=users/u1/events/e1',
            '--wrong-bucket=a.appspot.com',
            '--target-bucket=bucket-b',
            '--skip-target-check',
        ]);

        expect(options.execute).toBe(true);
        expect(options.uid).toBe('u1');
        expect(options.uids).toBeUndefined();
        expect(options.limit).toBe(50);
        expect(options.startAfter).toBe('users/u1/events/e1');
        expect(options.wrongBucket).toBe('a.appspot.com');
        expect(options.targetBucket).toBe('bucket-b');
        expect(options.verifyTargetObjectExists).toBe(false);
    });

    it('dry-run should detect affected docs without writing', async () => {
        hoisted.globalDocs.push(hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' },
            originalFiles: [{ path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' }],
        }));
        hoisted.setObjectExists('quantified-self-io', 'users/u1/events/e1/original.fit', true);

        const summary = await runFixOriginalFileBucketScript([]);

        expect(summary.dryRun).toBe(true);
        expect(summary.scanned).toBe(1);
        expect(summary.affected).toBe(1);
        expect(summary.eligibleForUpdate).toBe(1);
        expect(summary.updated).toBe(0);
        expect(hoisted.globalDocs[0].ref.set).not.toHaveBeenCalled();
    });

    it('execute should rewrite metadata bucket when target object exists', async () => {
        const doc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' },
            originalFiles: [
                { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' },
                { path: 'users/u1/events/e1/original_1.fit', bucket: 'quantified-self-io' },
            ],
        });
        hoisted.globalDocs.push(doc);
        hoisted.setObjectExists('quantified-self-io', 'users/u1/events/e1/original.fit', true);

        const summary = await runFixOriginalFileBucketScript(['--execute']);

        expect(summary.updated).toBe(1);
        expect(summary.failed).toBe(0);
        expect(summary.skippedMissingTargetObject).toBe(0);
        expect(doc.ref.set).toHaveBeenCalledWith({
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io' },
            originalFiles: [
                { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io' },
                { path: 'users/u1/events/e1/original_1.fit', bucket: 'quantified-self-io' },
            ],
        }, { merge: true });
    });

    it('execute should skip when target object is missing', async () => {
        const doc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' },
            originalFiles: [{ path: 'users/u1/events/e1/original.fit', bucket: 'quantified-self-io.appspot.com' }],
        });
        hoisted.globalDocs.push(doc);
        hoisted.setObjectExists('quantified-self-io', 'users/u1/events/e1/original.fit', false);

        const summary = await runFixOriginalFileBucketScript(['--execute']);

        expect(summary.updated).toBe(0);
        expect(summary.skippedMissingTargetObject).toBe(1);
        expect(doc.ref.set).not.toHaveBeenCalled();
    });
});
