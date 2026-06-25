import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FirestoreIndexField {
    arrayConfig?: string;
    fieldPath?: string;
    order?: string;
    queryScope?: string;
}

interface FirestoreCompositeIndex {
    collectionGroup: string;
    density?: string;
    fields: FirestoreIndexField[];
    queryScope: string;
}

interface FirestoreFieldOverride {
    collectionGroup: string;
    fieldPath: string;
    indexes?: FirestoreIndexField[];
    ttl?: boolean;
}

interface FirestoreIndexesConfig {
    fieldOverrides: FirestoreFieldOverride[];
    indexes: FirestoreCompositeIndex[];
}

function loadFirestoreIndexes(): FirestoreIndexesConfig {
    const firestoreIndexesPath = resolve(__dirname, '../../firestore.indexes.json');
    return JSON.parse(readFileSync(firestoreIndexesPath, 'utf8')) as FirestoreIndexesConfig;
}

describe('firestore indexes', () => {
    it('keeps route reparse job failure query and TTL config deployable', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).toContainEqual({
            collectionGroup: 'sportsLibRouteReparseJobs',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'status',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'updatedAt',
                    order: 'DESCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'DESCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'sportsLibRouteReparseJobs',
            fieldPath: 'expireAt',
            ttl: true,
            indexes: [
                {
                    order: 'ASCENDING',
                    queryScope: 'COLLECTION',
                },
                {
                    order: 'DESCENDING',
                    queryScope: 'COLLECTION',
                },
                {
                    arrayConfig: 'CONTAINS',
                    queryScope: 'COLLECTION',
                },
            ],
        });
    });

    it('keeps route delivery sync queue dispatcher/admin query indexes and TTL config deployable', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).toContainEqual({
            collectionGroup: 'routeDeliverySyncQueue',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'processed',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'dateCreated',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'ASCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
        expect(config.indexes).toContainEqual({
            collectionGroup: 'routeDeliverySyncQueue',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'processed',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'retryCount',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'ASCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
        expect(config.indexes).toContainEqual({
            collectionGroup: 'routeDeliverySyncQueue',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'resultStatus',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'successProcessedAt',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'ASCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'routeDeliverySyncQueue',
            fieldPath: 'expireAt',
            ttl: true,
            indexes: [
                {
                    order: 'ASCENDING',
                    queryScope: 'COLLECTION',
                },
                {
                    order: 'DESCENDING',
                    queryScope: 'COLLECTION',
                },
                {
                    arrayConfig: 'CONTAINS',
                    queryScope: 'COLLECTION',
                },
            ],
        });
    });
});
