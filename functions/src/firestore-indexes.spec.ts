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
    it('keeps Wahoo token cleanup and duplicate-account queries deployable', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).toContainEqual({
            collectionGroup: 'tokens',
            queryScope: 'COLLECTION_GROUP',
            fields: [
                {
                    fieldPath: 'wahooUserID',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'serviceName',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'ASCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
    });

    it('keeps Wahoo pending-disconnect retries deployable', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).toContainEqual({
            collectionGroup: 'wahooAPIAccessTokens',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'disconnectManualReviewRequired',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'disconnectState',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'disconnectNextAttemptAt',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'ASCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
    });

    it('keeps scoped dashboard Power Curve auto-tile eligibility query deployable', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).toContainEqual({
            collectionGroup: 'events',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'stats.`Activity Types`',
                    arrayConfig: 'CONTAINS',
                },
                {
                    fieldPath: 'stats.PowerCurve',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'ASCENDING',
                },
            ],
            density: 'SPARSE_ALL',
        });
    });

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

    it('keeps dashboard route preview recency query deployable', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).toContainEqual({
            collectionGroup: 'routes',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'previewReady',
                    order: 'ASCENDING',
                },
                {
                    fieldPath: 'importedAt',
                    order: 'DESCENDING',
                },
                {
                    fieldPath: '__name__',
                    order: 'DESCENDING',
                },
            ],
            density: 'SPARSE_ALL',
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
