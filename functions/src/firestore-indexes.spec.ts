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
    it('keeps exactly the Wahoo indexes required by token lookup, disconnect retry, queue operations, and TTL', () => {
        const config = loadFirestoreIndexes();

        const wahooIndexes = config.indexes.filter(index => (
            index.collectionGroup.startsWith('wahooAPI')
            || index.fields.some(field => field.fieldPath === 'wahooUserID')
        ));
        expect(wahooIndexes).toHaveLength(6);
        expect(wahooIndexes).toEqual(expect.arrayContaining([
            {
                collectionGroup: 'tokens',
                queryScope: 'COLLECTION_GROUP',
                fields: [
                    { fieldPath: 'wahooUserID', order: 'ASCENDING' },
                    { fieldPath: 'serviceName', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'ASCENDING' },
                ],
                density: 'SPARSE_ALL',
            },
            {
                collectionGroup: 'wahooAPIAccessTokens',
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'disconnectManualReviewRequired', order: 'ASCENDING' },
                    { fieldPath: 'disconnectState', order: 'ASCENDING' },
                    { fieldPath: 'disconnectNextAttemptAt', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'ASCENDING' },
                ],
                density: 'SPARSE_ALL',
            },
            {
                collectionGroup: 'wahooAPIWorkoutQueue',
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'dispatchedToCloudTask', order: 'ASCENDING' },
                    { fieldPath: 'processed', order: 'ASCENDING' },
                    { fieldPath: 'retryCount', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'ASCENDING' },
                ],
                density: 'SPARSE_ALL',
            },
            {
                collectionGroup: 'wahooAPIWorkoutQueue',
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'processed', order: 'ASCENDING' },
                    { fieldPath: 'dateCreated', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'ASCENDING' },
                ],
                density: 'SPARSE_ALL',
            },
            {
                collectionGroup: 'wahooAPIWorkoutQueue',
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'processed', order: 'ASCENDING' },
                    { fieldPath: 'processedAt', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'ASCENDING' },
                ],
                density: 'SPARSE_ALL',
            },
            {
                collectionGroup: 'wahooAPIWorkoutQueue',
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'processed', order: 'ASCENDING' },
                    { fieldPath: 'retryCount', order: 'ASCENDING' },
                    { fieldPath: '__name__', order: 'ASCENDING' },
                ],
                density: 'SPARSE_ALL',
            },
        ]));
        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'wahooAPIWorkoutQueue',
            fieldPath: 'expireAt',
            ttl: true,
            indexes: [],
        });
        expect(config.fieldOverrides).not.toContainEqual(expect.objectContaining({
            collectionGroup: 'tokens',
            fieldPath: 'wahooUserID',
        }));
        expect(config.indexes.some(index => index.collectionGroup === 'wahooAPIUserMappings')).toBe(false);
        expect(config.fieldOverrides.some(index => index.collectionGroup === 'wahooAPIUserMappings')).toBe(false);
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

    it('does not retain the retired AI Insights activity-type date index', () => {
        const config = loadFirestoreIndexes();

        expect(config.indexes).not.toContainEqual({
            collectionGroup: 'events',
            queryScope: 'COLLECTION',
            fields: [
                {
                    fieldPath: 'stats.`Activity Types`',
                    arrayConfig: 'CONTAINS',
                },
                {
                    fieldPath: 'startDate',
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
            indexes: [],
        });
    });

    it('keeps MCP OAuth TTL fields deployable without unnecessary automatic indexes', () => {
        const config = loadFirestoreIndexes();

        for (const collectionGroup of [
            'mcpOAuthAuthorizationRequests',
            'mcpOAuthAuthorizationCodes',
            'mcpOAuthAccessTokens',
            'mcpOAuthRefreshTokens',
            'mcpOAuthRateLimits',
            'mcpConnections',
        ]) {
            expect(config.fieldOverrides).toContainEqual({
                collectionGroup,
                fieldPath: 'expireAt',
                ttl: true,
                indexes: [],
            });
        }
    });

    it('keeps private Assistant conversations short-lived and unindexed', () => {
        const config = loadFirestoreIndexes();

        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'assistantConversations',
            fieldPath: 'expireAt',
            ttl: true,
            indexes: [],
        });
        for (const fieldPath of [
            'version',
            'conversationId',
            'messages',
            'pendingTurn',
            'createdAt',
            'updatedAt',
        ]) {
            expect(config.fieldOverrides).toContainEqual({
                collectionGroup: 'assistantConversations',
                fieldPath,
                ttl: false,
                indexes: [],
            });
        }
    });

    it('indexes only the Assistant usage field used by an ordered admin fallback', () => {
        const config = loadFirestoreIndexes();

        for (const fieldPath of [
            'version',
            'role',
            'limit',
            'periodStart',
            'periodKind',
            'successfulRequestCount',
            'reservationMap',
            'lastSuccessfulRequestAt',
            'updatedAt',
        ]) {
            expect(config.fieldOverrides).toContainEqual({
                collectionGroup: 'aiInsightsUsage',
                fieldPath,
                ttl: false,
                indexes: [],
            });
        }

        expect(config.fieldOverrides).not.toContainEqual(expect.objectContaining({
            collectionGroup: 'aiInsightsUsage',
            fieldPath: 'periodEnd',
        }));
    });

    it('keeps the cleanup TTL active while retired prompt-repair records drain', () => {
        const config = loadFirestoreIndexes();

        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'aiInsightsPromptRepairs',
            fieldPath: 'expireAt',
            ttl: true,
            indexes: [],
        });
    });

    it('keeps event merge operation TTL deployable without an automatic index', () => {
        const config = loadFirestoreIndexes();

        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'eventMergeOperations',
            fieldPath: 'expireAt',
            ttl: true,
            indexes: [],
        });
    });

    it('exempts every TTL-only expiration field from automatic indexing', () => {
        const config = loadFirestoreIndexes();

        for (const fieldOverride of config.fieldOverrides.filter(field => field.ttl === true)) {
            expect(fieldOverride.fieldPath).toBe('expireAt');
            expect(fieldOverride.indexes).toEqual([]);
        }
    });

    it('does not index MCP connection status because listing filters it in memory', () => {
        const config = loadFirestoreIndexes();

        expect(config.fieldOverrides).toContainEqual({
            collectionGroup: 'mcpConnections',
            fieldPath: 'status',
            ttl: false,
            indexes: [],
        });
    });

    it('does not index internal MCP grant-coordination fields that are read only by document ID', () => {
        const config = loadFirestoreIndexes();
        const unindexedFields = [
            ['mcpOAuthAuthorizationCodes', 'clientName'],
            ['mcpOAuthAuthorizationCodes', 'redirectHost'],
            ['mcpConnections', 'audience'],
            ['mcpConnections', 'grantId'],
            ['mcpConnections', 'supersedesLegacy'],
            ['mcpConnections', 'pendingAuthorizationCodeHash'],
            ['mcpConnections', 'pendingAuthorizationApprovedAtMs'],
            ['mcpConnections', 'pendingAuthorizationExpiresAtMs'],
            ['mcpOAuthAccessTokens', 'grantId'],
        ];

        for (const [collectionGroup, fieldPath] of unindexedFields) {
            expect(config.fieldOverrides).toContainEqual({
                collectionGroup,
                fieldPath,
                ttl: false,
                indexes: [],
            });
        }
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
            indexes: [],
        });
    });
});
