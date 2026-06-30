import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const adminApps: any[] = [];
    const sourceFilesByBucket = new Map<string, string[]>();
    const targetObjectExistence = new Map<string, boolean>();
    const userEventsByUID = new Map<string, any[]>();
    const copyFailures = new Set<string>();
    const copyCalls: any[] = [];
    const loggerInfo = vi.fn();
    const loggerWarn = vi.fn();
    const loggerError = vi.fn();
    const initializeApp = vi.fn();

    const setSourceFiles = (bucketName: string, paths: string[]): void => {
        sourceFilesByBucket.set(bucketName, paths);
    };

    const setTargetExists = (bucketName: string, path: string, exists: boolean): void => {
        targetObjectExistence.set(`${bucketName}:${path}`, exists);
    };

    const makeStorageFile = (bucketName: string, name: string): any => ({
        name,
        bucket: { name: bucketName },
        exists: vi.fn(async () => [targetObjectExistence.get(`${bucketName}:${name}`) ?? false]),
        copy: vi.fn(async (targetFile: any) => {
            if (copyFailures.has(name)) {
                throw new Error(`copy failed for ${name}`);
            }
            copyCalls.push({
                sourceBucket: bucketName,
                sourcePath: name,
                targetBucket: targetFile.bucket.name,
                targetPath: targetFile.name,
            });
            targetObjectExistence.set(`${targetFile.bucket.name}:${targetFile.name}`, true);
        }),
    });

    const bucket = vi.fn((bucketName: string) => ({
        name: bucketName,
        getFiles: vi.fn(async (query: any) => {
            const allFiles = (sourceFilesByBucket.get(bucketName) || [])
                .filter(path => path.startsWith(query.prefix || ''));
            const startIndex = Number.parseInt(`${query.pageToken || '0'}`, 10);
            const pageSize = Number(query.maxResults || 500);
            const files = allFiles
                .slice(startIndex, startIndex + pageSize)
                .map(path => makeStorageFile(bucketName, path));
            const nextIndex = startIndex + files.length;
            const nextQuery = nextIndex < allFiles.length
                ? { ...query, pageToken: `${nextIndex}` }
                : null;
            return [files, nextQuery];
        }),
        file: vi.fn((path: string) => makeStorageFile(bucketName, path)),
    }));

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
                get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
            };
        }

        const uid = match[1];
        let limitValue = 500;
        let startAfterId: string | null = null;
        const query = {
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn((value: number) => {
                limitValue = value;
                return query;
            }),
            startAfter: vi.fn((doc: { id?: string } | string) => {
                startAfterId = typeof doc === 'string' ? doc : doc.id || null;
                return query;
            }),
            get: vi.fn(async () => {
                const docs = userEventsByUID.get(uid) || [];
                const startIndex = startAfterId
                    ? docs.findIndex(doc => doc.id === startAfterId) + 1
                    : 0;
                const pageDocs = docs.slice(startIndex, startIndex + limitValue);
                return {
                    empty: pageDocs.length === 0,
                    docs: pageDocs,
                };
            }),
        };
        return query;
    });

    return {
        adminApps,
        sourceFilesByBucket,
        targetObjectExistence,
        userEventsByUID,
        copyFailures,
        copyCalls,
        loggerInfo,
        loggerWarn,
        loggerError,
        initializeApp,
        setSourceFiles,
        setTargetExists,
        bucket,
        collection,
        makeEventDoc,
    };
});

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
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

import {
    parseStorageUsersBucketMigrationOptions,
    runStorageUsersBucketMigrationScript,
} from './migrate-storage-users-bucket';

describe('migrate-storage-users-bucket script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.adminApps.length = 0;
        hoisted.sourceFilesByBucket.clear();
        hoisted.targetObjectExistence.clear();
        hoisted.userEventsByUID.clear();
        hoisted.copyFailures.clear();
        hoisted.copyCalls.length = 0;
    });

    it('parseStorageUsersBucketMigrationOptions should parse dry-run defaults and scoped args', () => {
        const options = parseStorageUsersBucketMigrationOptions([
            '--source-bucket=gs://source-bucket/users',
            '--target-bucket=target-bucket',
            '--uid=u1',
            '--page-size=50',
            '--event-page-size=25',
            '--max-objects=10',
            '--overwrite',
            '--skip-firestore',
        ]);

        expect(options.execute).toBe(false);
        expect(options.sourceBucket).toBe('source-bucket');
        expect(options.targetBucket).toBe('target-bucket');
        expect(options.prefix).toBe('users/');
        expect(options.uid).toBe('u1');
        expect(options.uids).toBeUndefined();
        expect(options.pageSize).toBe(50);
        expect(options.eventPageSize).toBe(25);
        expect(options.maxObjects).toBe(10);
        expect(options.overwrite).toBe(true);
        expect(options.patchFirestore).toBe(false);
    });

    it('dry-run should list source users and affected events without copying or patching', async () => {
        hoisted.setSourceFiles('source-bucket', [
            'users/u1/events/e1/original.fit',
            'users/u2/events/e2/original.fit',
        ]);
        const eventDoc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'source-bucket' },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runStorageUsersBucketMigrationScript([
            '--source-bucket=source-bucket',
            '--target-bucket=target-bucket',
        ]);

        expect(summary.dryRun).toBe(true);
        expect(summary.scannedObjects).toBe(2);
        expect(summary.usersWithSourceObjects).toBe(2);
        expect(summary.userIDs).toEqual(['u1', 'u2']);
        expect(summary.copiedObjects).toBe(0);
        expect(summary.firestoreUsersScanned).toBe(2);
        expect(summary.firestoreEventsAffected).toBe(1);
        expect(summary.firestoreEventsEligible).toBe(1);
        expect(summary.firestoreEventsPatched).toBe(0);
        expect(hoisted.copyCalls).toEqual([]);
        expect(eventDoc.ref.set).not.toHaveBeenCalled();
    });

    it('execute should copy source objects and patch event metadata to the target bucket', async () => {
        hoisted.setSourceFiles('source-bucket', [
            'users/u1/events/e1/original.fit',
        ]);
        const eventDoc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'source-bucket' },
            originalFiles: [
                { path: 'users/u1/events/e1/original.fit', bucket: 'source-bucket' },
                { path: 'users/u1/events/e1/other.fit', bucket: 'target-bucket' },
            ],
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runStorageUsersBucketMigrationScript([
            '--execute',
            '--source-bucket=source-bucket',
            '--target-bucket=target-bucket',
        ]);

        expect(summary.copiedObjects).toBe(1);
        expect(summary.failedObjects).toBe(0);
        expect(summary.firestoreEventsPatched).toBe(1);
        expect(hoisted.copyCalls).toEqual([{
            sourceBucket: 'source-bucket',
            sourcePath: 'users/u1/events/e1/original.fit',
            targetBucket: 'target-bucket',
            targetPath: 'users/u1/events/e1/original.fit',
        }]);
        expect(eventDoc.ref.set).toHaveBeenCalledWith({
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'target-bucket' },
            originalFiles: [
                { path: 'users/u1/events/e1/original.fit', bucket: 'target-bucket' },
                { path: 'users/u1/events/e1/other.fit', bucket: 'target-bucket' },
            ],
        }, { merge: true });
    });

    it('execute should skip copying existing target objects but still patch matching metadata', async () => {
        hoisted.setSourceFiles('source-bucket', [
            'users/u1/events/e1/original.fit',
        ]);
        hoisted.setTargetExists('target-bucket', 'users/u1/events/e1/original.fit', true);
        const eventDoc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'source-bucket' },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runStorageUsersBucketMigrationScript([
            '--execute',
            '--source-bucket=source-bucket',
            '--target-bucket=target-bucket',
        ]);

        expect(summary.skippedExistingObjects).toBe(1);
        expect(summary.copiedObjects).toBe(0);
        expect(summary.firestoreEventsPatched).toBe(1);
        expect(hoisted.copyCalls).toEqual([]);
        expect(eventDoc.ref.set).toHaveBeenCalledWith({
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'target-bucket' },
        }, { merge: true });
    });

    it('execute should not patch Firestore metadata when copying the source object fails', async () => {
        hoisted.setSourceFiles('source-bucket', [
            'users/u1/events/e1/original.fit',
        ]);
        hoisted.copyFailures.add('users/u1/events/e1/original.fit');
        const eventDoc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/original.fit', bucket: 'source-bucket' },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runStorageUsersBucketMigrationScript([
            '--execute',
            '--source-bucket=source-bucket',
            '--target-bucket=target-bucket',
        ]);

        expect(summary.failedObjects).toBe(1);
        expect(summary.firestoreEventsAffected).toBe(1);
        expect(summary.firestoreEventsSkippedMissingTarget).toBe(1);
        expect(summary.firestoreEventsPatched).toBe(0);
        expect(eventDoc.ref.set).not.toHaveBeenCalled();
    });

    it('dry-run should report metadata that cannot be patched because no target object exists', async () => {
        const eventDoc = hoisted.makeEventDoc('u1', 'e1', {
            originalFile: { path: 'users/u1/events/e1/missing.fit', bucket: 'source-bucket' },
        });
        hoisted.userEventsByUID.set('u1', [eventDoc]);

        const summary = await runStorageUsersBucketMigrationScript([
            '--source-bucket=source-bucket',
            '--target-bucket=target-bucket',
            '--uid=u1',
        ]);

        expect(summary.scannedObjects).toBe(0);
        expect(summary.firestoreEventsAffected).toBe(1);
        expect(summary.firestoreEventsEligible).toBe(0);
        expect(summary.firestoreEventsSkippedMissingTarget).toBe(1);
        expect(eventDoc.ref.set).not.toHaveBeenCalled();
    });
});
