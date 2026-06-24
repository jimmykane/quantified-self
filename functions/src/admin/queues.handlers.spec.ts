import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
    getAdminRequest,
    getQueueStats,
    retrySportsLibReparseHeavyJob,
    mockCollection,
    mockDoc,
    mockEnqueueSportsLibReparseHeavyTask,
    mockGetAll,
    mockGetCloudTaskQueueDepthForQueue,
    mockRecursiveDelete,
    mockRunTransaction,
    mockTransactionGet,
    mockTransactionSet,
} from './test-utils/admin-test-harness';

function createUserDeletionGuardCollectionMock(collectionName: string) {
    if (collectionName === 'users' || collectionName === 'userDeletionTombstones') {
        return {
            doc: vi.fn((id: string) => ({ path: `${collectionName}/${id}` })),
        };
    }
    return null;
}

describe('getQueueStats Cloud Function', () => {
    let request: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            if (collectionName === 'derivedMetrics') {
                const docs = [
                    {
                        id: 'coordinator',
                        data: () => ({
                            entryType: 'coordinator',
                            status: 'failed',
                            generation: 3,
                            dirtyMetricKinds: ['form'],
                            lastError: 'Coordinator failed',
                            updatedAtMs: 1700000001000
                        }),
                        ref: { parent: { parent: { id: 'uid-default-failed' } } }
                    }
                ];
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs })
                    })
                };
            }

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 0,
                                docs: []
                            })
                        })
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 0,
                        docs: []
                    })
                };
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }

            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });
        mockDoc.mockReturnValue({
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                    targetSportsLibVersion: '9.1.4',
                    lastScanCount: 200,
                    lastEnqueuedCount: 100,
                    overrideCursorByUid: {
                        u1: 'e1',
                        u2: null
                    }
                })
            })
        });
        mockGetAll.mockResolvedValue([
            { exists: true, data: () => ({}) },
            { exists: false, data: () => undefined },
        ]);
        mockTransactionGet.mockImplementation(async (ref: any) => {
            if (typeof ref?.get === 'function') {
                return ref.get();
            }
            const path = `${ref?.path || ''}`;
            if (path.startsWith('users/')) {
                return { exists: true, data: () => ({}) };
            }
            if (path.startsWith('userDeletionTombstones/')) {
                return { exists: false, data: () => undefined };
            }
            return { exists: false, data: () => undefined };
        });
        mockTransactionSet.mockImplementation(async (ref: any, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
            if (typeof ref?.set === 'function') {
                return ref.set(payload, options);
            }
            return undefined;
        });
        mockRunTransaction.mockImplementation(async (callback: any) => callback({
            get: mockTransactionGet,
            set: mockTransactionSet,
        }));
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };
    });

    it('should return queue statistics including DLQ', async () => {
        const nowMs = Date.now();
        // Mock permissions
        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            // Mock implementation for query chains
            const mockQuery = {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }], // Mock for oldestPending
                    data: () => ({ count: 5 })
                })
            };

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 2,
                                docs: [
                                    { data: () => ({ context: 'NO_TOKEN_FOUND', originalCollection: 'suuntoAppWorkoutQueue', error: 'Token expired' }) },
                                    { data: () => ({ context: 'MAX_RETRY_REACHED', originalCollection: 'COROSAPIWorkoutQueue', error: 'Timeout' }) }
                                ]
                            })
                        })
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 2,
                        docs: [
                            { data: () => ({ context: 'NO_TOKEN_FOUND', originalCollection: 'suuntoAppWorkoutQueue', error: 'Token expired' }) },
                            { data: () => ({ context: 'MAX_RETRY_REACHED', originalCollection: 'COROSAPIWorkoutQueue', error: 'Timeout' }) }
                        ]
                    })
                };
                // Make where chainable
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }

            if (collectionName === 'derivedMetrics') {
                const docs = [
                    {
                        id: 'coordinator',
                        data: () => ({
                            entryType: 'coordinator',
                            status: 'queued',
                            generation: 7,
                            dirtyMetricKinds: ['form', 'recovery_now'],
                            lastError: '',
                            requestedAtMs: nowMs - (2 * 60 * 1000),
                            updatedAtMs: nowMs - (2 * 60 * 1000),
                        }),
                        ref: { parent: { parent: { id: 'uid-queued' } } }
                    },
                    {
                        id: 'coordinator',
                        data: () => ({
                            entryType: 'coordinator',
                            status: 'processing',
                            generation: 6,
                            dirtyMetricKinds: ['form'],
                            lastError: '',
                            startedAtMs: nowMs - (2 * 60 * 1000),
                            updatedAtMs: nowMs - (2 * 60 * 1000),
                        }),
                        ref: { parent: { parent: { id: 'uid-processing' } } }
                    },
                    {
                        id: 'coordinator',
                        data: () => ({
                            entryType: 'coordinator',
                            status: 'idle',
                            generation: 5,
                            dirtyMetricKinds: [],
                            lastError: '',
                            updatedAtMs: 1700000002000
                        }),
                        ref: { parent: { parent: { id: 'uid-idle' } } }
                    },
                    {
                        id: 'coordinator',
                        data: () => ({
                            entryType: 'coordinator',
                            status: 'failed',
                            generation: 4,
                            dirtyMetricKinds: ['form'],
                            lastError: 'Derived metrics failed',
                            updatedAtMs: 1700000001000
                        }),
                        ref: { parent: { parent: { id: 'uid-failed' } } }
                    }
                ];
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs })
                    })
                };
            }
            return mockQuery;
        });

        request.data = { includeAnalysis: true };
        const result = await (getQueueStats as any)(request);

        // Validation of Advanced Stats
        expect(result.advanced).toBeDefined();
        expect(result.dlq.total).toBe(5); // Mock count return
        expect(result.advanced.topErrors).toHaveLength(2);

        expect(result).toHaveProperty('pending');
        // Check totals from mocked count (5) * (3 providers * 1 queue per provider * 3 statuses)
        // pending: 5 count * 3 queues = 15
        expect(result.pending).toBe(15);
        expect(result.succeeded).toBe(15);
        expect(result.stuck).toBe(15);
        expect(result.providers).toHaveLength(3);

        // Check DLQ stats
        expect(result.dlq).toBeDefined();
        expect(result.dlq.total).toBe(5);
        expect(result.dlq.byContext).toEqual(expect.arrayContaining([
            { context: 'NO_TOKEN_FOUND', count: 1 },
            { context: 'MAX_RETRY_REACHED', count: 1 }
        ]));
        expect(result.dlq.byProvider).toEqual(expect.arrayContaining([
            { provider: 'suuntoAppWorkoutQueue', count: 1 },
            { provider: 'COROSAPIWorkoutQueue', count: 1 }
        ]));

        // Check Cloud Tasks stats
        expect(result.cloudTasks).toEqual({
            pending: 66,
            queues: {
                workout: {
                    queueId: 'processWorkoutTask',
                    pending: 42,
                },
                activitySync: {
                    queueId: 'processActivitySyncTask',
                    pending: 0,
                },
                routeDeliverySync: {
                    queueId: 'processRouteDeliverySyncTask',
                    pending: 0,
                },
                routeSync: {
                    queueId: 'processRouteSyncTask',
                    pending: 4,
                },
                sleepSync: {
                    queueId: 'processSleepSyncTask',
                    pending: 3,
                },
                sportsLibReparse: {
                    queueId: 'processSportsLibReparseTask',
                    pending: 8,
                },
                sportsLibReparseHeavy: {
                    queueId: 'processSportsLibReparseHeavyTask',
                    pending: 2,
                },
                sportsLibRouteReparse: {
                    queueId: 'processSportsLibRouteReparseTask',
                    pending: 1,
                },
                derivedMetrics: {
                    queueId: 'processDerivedMetricsTask',
                    pending: 6,
                },
            },
        });
        expect(result.routeReparse).toEqual(expect.objectContaining({
            queuePending: 1,
            targetSportsLibVersion: expect.any(String),
            jobs: expect.objectContaining({
                pending: expect.any(Number),
                processing: expect.any(Number),
                completed: expect.any(Number),
                skipped: expect.any(Number),
                failed: expect.any(Number),
            }),
            checkpoint: expect.objectContaining({
                cursorProcessingDocPath: null,
                cursorProcessingVersionCode: null,
                lastScanCount: expect.any(Number),
                lastEnqueuedCount: expect.any(Number),
                overrideUsersInProgress: expect.any(Number),
            }),
            recentFailures: expect.any(Array),
        }));
        expect(result.sleepSync).toEqual({
            pending: 5,
            succeeded: 5,
            providerDisabled: 5,
            stuck: 5,
            dead: 5,
            disabledProviders: ['COROS'],
            providers: [
                { provider: 'Garmin', pending: 5, succeeded: 5, providerDisabled: 5, stuck: 5, dead: 5 },
                { provider: 'Suunto', pending: 5, succeeded: 5, providerDisabled: 5, stuck: 5, dead: 5 },
                { provider: 'COROS', pending: 5, succeeded: 5, providerDisabled: 5, stuck: 5, dead: 5 },
            ],
            dlqByContext: expect.arrayContaining([
                { context: 'NO_TOKEN_FOUND', count: 1 },
                { context: 'MAX_RETRY_REACHED', count: 1 },
            ]),
            advanced: {
                throughput: 5,
                maxLagMs: expect.any(Number),
                retryHistogram: {
                    '0-3': 5,
                    '4-7': 5,
                    '8-9': 5,
                },
                topErrors: expect.arrayContaining([
                    { error: 'Token expired', count: 1 },
                    { error: 'Timeout', count: 1 },
                ]),
            },
        });
        expect(result.reparse).toEqual(expect.objectContaining({
            queuePending: 10,
            targetSportsLibVersion: '9.1.4',
            jobs: {
                total: 5,
                pending: 5,
                processing: 5,
                completed: 5,
                failed: 5,
            },
            checkpoint: expect.objectContaining({
                lastScanCount: 200,
                lastEnqueuedCount: 100,
                overrideUsersInProgress: 1,
            }),
        }));
        expect(result.derivedMetrics).toEqual({
            coordinators: {
                idle: 1,
                queued: 1,
                processing: 1,
                staleQueued: 0,
                staleProcessing: 0,
                failed: 1,
                total: 4,
            },
            recentFailures: [
                {
                    uid: 'uid-failed',
                    generation: 4,
                    dirtyMetricKinds: ['form'],
                    lastError: 'Derived metrics failed',
                    updatedAtMs: 1700000001000,
                }
            ],
        });
        expect(result.activitySync).toEqual({
            pending: 5,
            succeeded: 5,
            stuck: 5,
            dead: 5,
            dlqByContext: expect.arrayContaining([
                { context: 'NO_TOKEN_FOUND', count: 1 },
                { context: 'MAX_RETRY_REACHED', count: 1 },
            ]),
            advanced: {
                throughput: 5,
                maxLagMs: expect.any(Number),
                retryHistogram: {
                    '0-3': 5,
                    '4-7': 5,
                    '8-9': 5,
                },
                topErrors: expect.arrayContaining([
                    { error: 'Token expired', count: 1 },
                    { error: 'Timeout', count: 1 },
                ]),
            },
        });
    });

    it('excludes stale queued and processing coordinators from active counts', async () => {
        const nowMs = Date.now();
        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 0 }),
                }),
            });

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({
                            docs: [
                                {
                                    id: 'coordinator',
                                    data: () => ({
                                        entryType: 'coordinator',
                                        status: 'queued',
                                        generation: 3,
                                        dirtyMetricKinds: ['form'],
                                        requestedAtMs: nowMs - (20 * 60 * 1000),
                                        updatedAtMs: nowMs - (20 * 60 * 1000),
                                    }),
                                    ref: { parent: { parent: { id: 'uid-stale-queued' } } },
                                },
                                {
                                    id: 'coordinator',
                                    data: () => ({
                                        entryType: 'coordinator',
                                        status: 'processing',
                                        generation: 4,
                                        dirtyMetricKinds: ['recovery_now'],
                                        startedAtMs: nowMs - (20 * 60 * 1000),
                                        updatedAtMs: nowMs - (20 * 60 * 1000),
                                    }),
                                    ref: { parent: { parent: { id: 'uid-stale-processing' } } },
                                },
                                {
                                    id: 'coordinator',
                                    data: () => ({
                                        entryType: 'coordinator',
                                        status: 'failed',
                                        generation: 5,
                                        dirtyMetricKinds: ['form'],
                                        lastError: 'boom',
                                        updatedAtMs: 1700000001000,
                                    }),
                                    ref: { parent: { parent: { id: 'uid-failed' } } },
                                },
                            ],
                        }),
                    }),
                };
            }

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
                        }),
                    }),
                    get: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
                };
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }

            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: nowMs - 10000 }) }],
                    data: () => ({ count: 0 }),
                }),
            };
        });

        const result = await (getQueueStats as any)(request);
        expect(result.derivedMetrics.coordinators).toEqual({
            idle: 0,
            queued: 0,
            processing: 0,
            staleQueued: 1,
            staleProcessing: 1,
            failed: 1,
            total: 3,
        });
    });

    it('should handle single-queue Cloud Task depth error and return 0 for that queue', async () => {
        mockGetCloudTaskQueueDepthForQueue
            .mockResolvedValueOnce(42)
            .mockRejectedValueOnce(new Error('Queue depth error'))
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(8)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(6);
        const result = await (getQueueStats as any)(request);
        expect(result.cloudTasks).toEqual({
            pending: 69,
            queues: {
                workout: {
                    queueId: 'processWorkoutTask',
                    pending: 42,
                },
                activitySync: {
                    queueId: 'processActivitySyncTask',
                    pending: 0,
                },
                routeDeliverySync: {
                    queueId: 'processRouteDeliverySyncTask',
                    pending: 3,
                },
                routeSync: {
                    queueId: 'processRouteSyncTask',
                    pending: 8,
                },
                sleepSync: {
                    queueId: 'processSleepSyncTask',
                    pending: 2,
                },
                sportsLibReparse: {
                    queueId: 'processSportsLibReparseTask',
                    pending: 1,
                },
                sportsLibReparseHeavy: {
                    queueId: 'processSportsLibReparseHeavyTask',
                    pending: 6,
                },
                sportsLibRouteReparse: {
                    queueId: 'processSportsLibRouteReparseTask',
                    pending: 1,
                },
                derivedMetrics: {
                    queueId: 'processDerivedMetricsTask',
                    pending: 6,
                },
            },
        });
    });

    it('should return safe derived coordinator defaults when coordinator query fails', async () => {
        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockRejectedValue(new Error('Missing index'))
                    })
                };
            }

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 0,
                                docs: []
                            })
                        })
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 0,
                        docs: []
                    })
                };
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }

            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        const result = await (getQueueStats as any)(request);
        expect(result.cloudTasks.queues.derivedMetrics).toEqual({
            queueId: 'processDerivedMetricsTask',
            pending: 6,
        });
        expect(result.derivedMetrics).toEqual({
            coordinators: {
                idle: 0,
                queued: 0,
                processing: 0,
                staleQueued: 0,
                staleProcessing: 0,
                failed: 0,
                total: 0,
            },
            recentFailures: [],
        });
    });

    it('counts only successful activity-sync completions and throughput', async () => {
        const resolveActivitySyncCount = (filters: Array<{ field: string; op: string; value: unknown }>): number => {
            const has = (field: string, op: string, value?: unknown): boolean =>
                filters.some((filter) => filter.field === field && filter.op === op && (value === undefined || filter.value === value));

            if (has('successProcessedAt', '>')) {
                return 1;
            }
            if (has('resultStatus', '==', 'success')) {
                return 2;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 10)) {
                return 1;
            }
            if (has('processed', '==', false) && has('retryCount', '<', 4)) {
                return 3;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 4) && has('retryCount', '<', 8)) {
                return 1;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 8) && has('retryCount', '<', 10)) {
                return 0;
            }
            if (has('processed', '==', false) && has('retryCount', '<', 10)) {
                return 4;
            }

            return 0;
        };

        mockCollection.mockImplementation((collectionName: string) => {
            if (collectionName === 'activitySyncQueue') {
                const buildQuery = (filters: Array<{ field: string; op: string; value: unknown }>) => ({
                    where: vi.fn((field: string, op: string, value: unknown) => buildQuery([...filters, { field, op, value }])),
                    orderBy: vi.fn(() => buildQuery(filters)),
                    limit: vi.fn(() => buildQuery(filters)),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({ count: resolveActivitySyncCount(filters) }),
                        }),
                    })),
                    get: vi.fn().mockResolvedValue({
                        empty: false,
                        docs: [{ data: () => ({ dateCreated: Date.now() - 20000 }) }],
                    }),
                });

                return buildQuery([]);
            }

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs: [] })
                    })
                };
            }

            if (collectionName === 'failed_jobs') {
                const filters: Array<{ field: string; op: string; value: unknown }> = [];
                const failedJobsMock: any = {
                    where: vi.fn((field: string, op: string, value: unknown) => {
                        filters.push({ field, op, value });
                        return failedJobsMock;
                    }),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({
                                count: filters.some((f) => f.field === 'originalCollection' && f.value === 'activitySyncQueue') ? 2 : 5,
                            }),
                        }),
                    })),
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 0,
                                docs: [],
                            }),
                        }),
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 0,
                        docs: [],
                    }),
                };
                return failedJobsMock;
            }

            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });
            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.activitySync).toEqual(expect.objectContaining({
            pending: 4,
            succeeded: 2,
            stuck: 1,
            dead: 2,
            advanced: expect.objectContaining({
                throughput: 1,
                retryHistogram: {
                    '0-3': 3,
                    '4-7': 1,
                    '8-9': 0,
                },
            }),
        }));
    });

    it('counts route-sync success, skipped, retries, and throughput separately', async () => {
        const resolveRouteSyncCount = (filters: Array<{ field: string; op: string; value: unknown }>): number => {
            const has = (field: string, op: string, value?: unknown): boolean =>
                filters.some((filter) => filter.field === field && filter.op === op && (value === undefined || filter.value === value));

            if (has('processedAt', '>')) {
                return 3;
            }
            if (has('resultStatus', '==', 'success')) {
                return 2;
            }
            if (has('resultStatus', '==', 'skipped')) {
                return 5;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 10)) {
                return 1;
            }
            if (has('processed', '==', false) && has('retryCount', '<', 4)) {
                return 4;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 4) && has('retryCount', '<', 8)) {
                return 2;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 8) && has('retryCount', '<', 10)) {
                return 1;
            }
            if (has('processed', '==', false) && has('retryCount', '<', 10)) {
                return 7;
            }

            return 0;
        };

        mockCollection.mockImplementation((collectionName: string) => {
            if (collectionName === 'routeSyncQueue') {
                const buildQuery = (filters: Array<{ field: string; op: string; value: unknown }>) => ({
                    where: vi.fn((field: string, op: string, value: unknown) => buildQuery([...filters, { field, op, value }])),
                    orderBy: vi.fn(() => buildQuery(filters)),
                    limit: vi.fn(() => buildQuery(filters)),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({ count: resolveRouteSyncCount(filters) }),
                        }),
                    })),
                    get: vi.fn().mockResolvedValue({
                        empty: false,
                        docs: [{ data: () => ({ dateCreated: Date.now() - 15000 }) }],
                    }),
                });

                return buildQuery([]);
            }

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs: [] })
                    })
                };
            }

            if (collectionName === 'failed_jobs') {
                const filters: Array<{ field: string; op: string; value: unknown }> = [];
                const failedJobsMock: any = {
                    where: vi.fn((field: string, op: string, value: unknown) => {
                        filters.push({ field, op, value });
                        return failedJobsMock;
                    }),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({
                                count: filters.some((f) => f.field === 'originalCollection' && f.value === 'routeSyncQueue') ? 2 : 5,
                            }),
                        }),
                    })),
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 0,
                                docs: [],
                            }),
                        }),
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 0,
                        docs: [],
                    }),
                };
                return failedJobsMock;
            }

            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });
            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.routeSync).toEqual(expect.objectContaining({
            pending: 7,
            succeeded: 2,
            skipped: 5,
            stuck: 1,
            dead: 2,
            advanced: expect.objectContaining({
                throughput: 3,
                retryHistogram: {
                    '0-3': 4,
                    '4-7': 2,
                    '8-9': 1,
                },
            }),
        }));
    });

    it('counts route-delivery success, skipped, retries, and throughput separately', async () => {
        const resolveRouteDeliverySyncCount = (filters: Array<{ field: string; op: string; value: unknown }>): number => {
            const has = (field: string, op: string, value?: unknown): boolean =>
                filters.some((filter) => filter.field === field && filter.op === op && (value === undefined || filter.value === value));

            if (has('successProcessedAt', '>')) {
                return 4;
            }
            if (has('resultStatus', '==', 'success')) {
                return 6;
            }
            if (has('resultStatus', '==', 'skipped')) {
                return 3;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 10)) {
                return 2;
            }
            if (has('processed', '==', false) && has('retryCount', '<', 4)) {
                return 5;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 4) && has('retryCount', '<', 8)) {
                return 2;
            }
            if (has('processed', '==', false) && has('retryCount', '>=', 8) && has('retryCount', '<', 10)) {
                return 1;
            }
            if (has('processed', '==', false) && has('retryCount', '<', 10)) {
                return 8;
            }

            return 0;
        };

        mockCollection.mockImplementation((collectionName: string) => {
            if (collectionName === 'routeDeliverySyncQueue') {
                const buildQuery = (filters: Array<{ field: string; op: string; value: unknown }>) => ({
                    where: vi.fn((field: string, op: string, value: unknown) => buildQuery([...filters, { field, op, value }])),
                    orderBy: vi.fn(() => buildQuery(filters)),
                    limit: vi.fn(() => buildQuery(filters)),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({ count: resolveRouteDeliverySyncCount(filters) }),
                        }),
                    })),
                    get: vi.fn().mockResolvedValue({
                        empty: false,
                        docs: [{ data: () => ({ dateCreated: Date.now() - 20000 }) }],
                    }),
                });

                return buildQuery([]);
            }

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs: [] })
                    })
                };
            }

            if (collectionName === 'failed_jobs') {
                const filters: Array<{ field: string; op: string; value: unknown }> = [];
                const failedJobsMock: any = {
                    where: vi.fn((field: string, op: string, value: unknown) => {
                        filters.push({ field, op, value });
                        return failedJobsMock;
                    }),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({
                                count: filters.some((f) => f.field === 'originalCollection' && f.value === 'routeDeliverySyncQueue') ? 7 : 5,
                            }),
                        }),
                    })),
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 0,
                                docs: [],
                            }),
                        }),
                    }),
                    get: vi.fn().mockResolvedValue({
                        size: 0,
                        docs: [],
                    }),
                };
                return failedJobsMock;
            }

            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });
            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.routeDeliverySync).toEqual(expect.objectContaining({
            pending: 8,
            succeeded: 6,
            skipped: 3,
            stuck: 2,
            dead: 7,
            advanced: expect.objectContaining({
                throughput: 4,
                retryHistogram: {
                    '0-3': 5,
                    '4-7': 2,
                    '8-9': 1,
                },
            }),
        }));
    });

    it('keeps ingestion DLQ/top-errors isolated from activity-sync failures', async () => {
        type FailedJobDoc = {
            context: string;
            originalCollection: string;
            error: string;
            failedAt: number;
        };

        const failedJobsDocs: FailedJobDoc[] = [
            {
                context: 'NO_TOKEN_FOUND',
                originalCollection: 'suuntoAppWorkoutQueue',
                error: 'Token expired',
                failedAt: 20,
            },
            {
                context: 'ACTIVITY_SYNC_PERMANENT_FAILURE',
                originalCollection: 'activitySyncQueue',
                error: 'Sync auth failed',
                failedAt: 30,
            },
        ];

        const matchesFilters = (doc: FailedJobDoc, filters: Array<{ field: string; op: string; value: unknown }>) => (
            filters.every((filter) => {
                if (filter.op === '==') {
                    return (doc as Record<string, unknown>)[filter.field] === filter.value;
                }
                if (filter.op === 'in' && Array.isArray(filter.value)) {
                    return (filter.value as unknown[]).includes((doc as Record<string, unknown>)[filter.field]);
                }
                return true;
            })
        );

        mockCollection.mockImplementation((collectionName: string) => {
            const defaultCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            if (collectionName === 'failed_jobs') {
                const buildFailedJobsQuery = (
                    filters: Array<{ field: string; op: string; value: unknown }>,
                    limitCount?: number
                ) => ({
                    where: vi.fn((field: string, op: string, value: unknown) =>
                        buildFailedJobsQuery([...filters, { field, op, value }], limitCount)),
                    orderBy: vi.fn(() => buildFailedJobsQuery(filters, limitCount)),
                    limit: vi.fn((nextLimit: number) => buildFailedJobsQuery(filters, nextLimit)),
                    count: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            data: () => ({
                                count: failedJobsDocs.filter((doc) => matchesFilters(doc, filters)).length,
                            }),
                        }),
                    })),
                    get: vi.fn().mockResolvedValue({
                        size: failedJobsDocs.filter((doc) => matchesFilters(doc, filters)).length,
                        docs: failedJobsDocs
                            .filter((doc) => matchesFilters(doc, filters))
                            .sort((a, b) => b.failedAt - a.failedAt)
                            .slice(0, limitCount ?? failedJobsDocs.length)
                            .map((doc) => ({ data: () => doc })),
                    }),
                });

                return buildFailedJobsQuery([]);
            }

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs: [] })
                    })
                };
            }

            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: defaultCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        request.data = { includeAnalysis: true };
        const result = await (getQueueStats as any)(request);

        expect(result.dlq?.total).toBe(1);
        expect(result.dlq?.byProvider).toEqual(expect.arrayContaining([
            { provider: 'suuntoAppWorkoutQueue', count: 1 },
        ]));
        expect(result.dlq?.byProvider).not.toEqual(expect.arrayContaining([
            { provider: 'activitySyncQueue', count: 1 },
        ]));
        expect(result.advanced.topErrors).toEqual(expect.arrayContaining([
            { error: 'Token expired', count: 1 },
        ]));
        expect(result.advanced.topErrors).not.toEqual(expect.arrayContaining([
            { error: 'Sync auth failed', count: 1 },
        ]));

        expect(result.activitySync.advanced.topErrors).toEqual(expect.arrayContaining([
            { error: 'Sync auth failed', count: 1 },
        ]));
    });

    it('uses bounded ordered query for activity-sync DLQ preview', async () => {
        const whereOrderedGet = vi.fn().mockResolvedValue({
            size: 1,
            docs: [
                { data: () => ({ context: 'ACTIVITY_SYNC_PERMANENT_FAILURE', originalCollection: 'activitySyncQueue', error: 'timeout' }) }
            ]
        });
        const whereLimit = vi.fn().mockReturnValue({
            get: whereOrderedGet,
        });
        const whereOrderBy = vi.fn().mockReturnValue({
            limit: whereLimit,
        });
        const whereDirectGet = vi.fn().mockResolvedValue({
            size: 999,
            docs: [],
        });

        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy: whereOrderBy,
                    get: whereDirectGet,
                };
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs: [] })
                    })
                };
            }

            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        request.data = { includeAnalysis: true };
        await (getQueueStats as any)(request);

        expect(whereOrderBy).toHaveBeenCalledWith('failedAt', 'desc');
        expect(whereLimit).toHaveBeenCalledWith(50);
        expect(whereDirectGet).not.toHaveBeenCalled();
        expect(whereOrderedGet).toHaveBeenCalled();
    });

    it('uses bounded ordered query for route-sync DLQ preview', async () => {
        const orderedGet = vi.fn().mockResolvedValue({
            size: 1,
            docs: [
                { data: () => ({ context: 'ROUTE_PARSE_FAILED', originalCollection: 'routeSyncQueue', error: 'Bad GPX' }) }
            ]
        });
        const limit = vi.fn().mockReturnValue({
            get: orderedGet,
        });
        const orderBy = vi.fn().mockReturnValue({
            limit,
        });
        const directGet = vi.fn().mockResolvedValue({
            size: 999,
            docs: [],
        });

        mockCollection.mockImplementation((collectionName: string) => {
            const mockCount = vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    data: () => ({ count: 5 })
                })
            });

            if (collectionName === 'failed_jobs') {
                const failedJobsMock: any = {
                    count: mockCount,
                    orderBy,
                    get: directGet,
                };
                failedJobsMock.where = vi.fn().mockReturnValue(failedJobsMock);
                return failedJobsMock;
            }

            if (collectionName === 'derivedMetrics') {
                return {
                    where: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue({ docs: [] })
                    })
                };
            }

            return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                count: mockCount,
                get: vi.fn().mockResolvedValue({
                    empty: false,
                    docs: [{ data: () => ({ dateCreated: Date.now() - 10000 }) }],
                    data: () => ({ count: 5 })
                })
            };
        });

        request.data = { includeAnalysis: true };
        await (getQueueStats as any)(request);

        expect(orderBy).toHaveBeenCalledWith('failedAt', 'desc');
        expect(limit).toHaveBeenCalledWith(50);
        expect(directGet).not.toHaveBeenCalled();
        expect(orderedGet).toHaveBeenCalled();
    });

    it('should return only basic statistics when includeAnalysis is false', async () => {
        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.pending).toBeDefined();
        expect(result.dlq).toBeUndefined(); // Should be skipped
        expect(result.advanced.topErrors).toHaveLength(0); // Should be empty
        expect(result.activitySync.advanced.topErrors).toHaveLength(0); // Should be empty
        expect(result.activitySync.dlqByContext).toHaveLength(0); // Should be empty
        expect(result.routeSync.advanced.topErrors).toHaveLength(0); // Should be empty
        expect(result.routeSync.dlqByContext).toHaveLength(0); // Should be empty
    });

    it('should require authentication', async () => {
        request.auth = undefined;
        await expect((getQueueStats as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        const request = {
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' }
        } as unknown as CallableRequest<any>;
        await expect((getQueueStats as any)(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should retry failed reparse job on heavy queue', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ status: 'failed', uid: 'uid-1' }),
                        }),
                        set: jobSet,
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockEnqueueSportsLibReparseHeavyTask.mockResolvedValueOnce(true);

        const result = await (retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' }));

        expect(jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'manual_admin',
            lastError: 'mock-delete',
            terminalFailure: 'mock-delete',
            terminalFailureAt: 'mock-delete',
        }), { merge: true });
        expect(mockEnqueueSportsLibReparseHeavyTask).toHaveBeenCalledWith('job-1', {
            taskNameSuffix: expect.stringMatching(/^manual-\d+-[0-9a-f-]+$/),
        });
        expect(result).toEqual({
            success: true,
            jobId: 'job-1',
            taskCreated: true,
        });
    });

    it('should atomically reject duplicate heavy retry claims once the job is pending', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        const jobGet = vi.fn()
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ status: 'failed', uid: 'uid-1' }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ status: 'pending', uid: 'uid-1' }),
            });
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        get: jobGet,
                        set: jobSet,
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockEnqueueSportsLibReparseHeavyTask.mockResolvedValue(true);

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .resolves.toEqual({
                success: true,
                jobId: 'job-1',
                taskCreated: true,
            });
        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('must be failed before heavy retry');

        expect(jobSet).toHaveBeenCalledTimes(1);
        expect(mockEnqueueSportsLibReparseHeavyTask).toHaveBeenCalledTimes(1);
    });

    it('should delete claimed heavy retry job when deletion starts before enqueue', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        const jobRef = {
            path: 'sportsLibReparseJobs/job-1',
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ status: 'failed', uid: 'uid-1' }),
            }),
            set: jobSet,
        };
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => jobRef),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockGetAll.mockResolvedValue([
            { exists: true, data: () => ({}) },
            { exists: true, data: () => ({}) },
        ]);

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('User uid-1 is missing or deletion is in progress');

        expect(jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'manual_admin',
        }), { merge: true });
        expect(mockRecursiveDelete).toHaveBeenCalledWith(jobRef);
        expect(mockEnqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
    });

    it('should restore failed status when deletion guard cannot be read before enqueue', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        path: 'sportsLibReparseJobs/job-1',
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ status: 'failed', uid: 'uid-1' }),
                        }),
                        set: jobSet,
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockGetAll.mockRejectedValueOnce(new Error('guard unavailable'));

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('Could not verify user deletion state for uid-1');

        expect(jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'manual_admin',
        }), { merge: true });
        expect(jobSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
            status: 'failed',
            lastError: 'Could not verify user deletion state before enqueue: guard unavailable',
            enqueuedAt: 'mock-delete',
        }), { merge: true });
        expect(mockEnqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
    });

    it('should delete claimed heavy retry job when deletion starts after enqueue failure', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        const jobRef = {
            path: 'sportsLibReparseJobs/job-1',
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ status: 'failed', uid: 'uid-1' }),
            }),
            set: jobSet,
        };
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => jobRef),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockGetAll
            .mockResolvedValueOnce([
                { exists: true, data: () => ({}) },
                { exists: false, data: () => undefined },
            ])
            .mockResolvedValueOnce([
                { exists: true, data: () => ({}) },
                { exists: true, data: () => ({}) },
            ]);
        mockEnqueueSportsLibReparseHeavyTask.mockResolvedValueOnce(false);

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('User uid-1 is missing or deletion is in progress');

        expect(jobSet).toHaveBeenCalledTimes(1);
        expect(jobSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'manual_admin',
        }), { merge: true });
        expect(mockEnqueueSportsLibReparseHeavyTask).toHaveBeenCalledTimes(1);
        expect(mockRecursiveDelete).toHaveBeenCalledWith(jobRef);
    });

    it('should restore failed status when manual heavy retry task is not created', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ status: 'failed', uid: 'uid-1' }),
                        }),
                        set: jobSet,
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockEnqueueSportsLibReparseHeavyTask.mockResolvedValueOnce(false);

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('Manual heavy reparse retry task already exists');

        expect(jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'pending',
            processingTier: 'heavy',
            heavyReason: 'manual_admin',
        }), { merge: true });
        expect(jobSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
            status: 'failed',
            lastError: expect.stringContaining('Manual heavy reparse retry task already exists'),
            enqueuedAt: 'mock-delete',
            terminalFailure: 'mock-delete',
            terminalFailureAt: 'mock-delete',
        }), { merge: true });
    });

    it('should restore terminal marker when manual heavy retry enqueue fails for a terminal job', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({
                                status: 'failed',
                                uid: 'uid-1',
                                terminalFailure: true,
                                terminalFailureAt: 'terminal-ts',
                            }),
                        }),
                        set: jobSet,
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockEnqueueSportsLibReparseHeavyTask.mockResolvedValueOnce(false);

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('Manual heavy reparse retry task already exists');

        expect(jobSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: 'pending',
            terminalFailure: 'mock-delete',
            terminalFailureAt: 'mock-delete',
        }), { merge: true });
        expect(jobSet).toHaveBeenNthCalledWith(2, expect.objectContaining({
            status: 'failed',
            terminalFailure: true,
            terminalFailureAt: 'terminal-ts',
        }), { merge: true });
    });

    it('should not enqueue heavy retry when user is missing or deletion is in progress', async () => {
        const jobSet = vi.fn().mockResolvedValue(undefined);
        mockCollection.mockImplementation((collectionName: string) => {
            const guardCollection = createUserDeletionGuardCollectionMock(collectionName);
            if (guardCollection) {
                return guardCollection;
            }
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ status: 'failed', uid: 'deleted-user' }),
                        }),
                        set: jobSet,
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });
        mockTransactionGet.mockImplementation(async (ref: any) => {
            if (typeof ref?.get === 'function') {
                return ref.get();
            }
            const path = `${ref?.path || ''}`;
            if (path === 'users/deleted-user') {
                return { exists: false, data: () => undefined };
            }
            if (path === 'userDeletionTombstones/deleted-user') {
                return { exists: false, data: () => undefined };
            }
            return { exists: true, data: () => ({}) };
        });

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('User deleted-user is missing or deletion is in progress');

        expect(jobSet).not.toHaveBeenCalled();
        expect(mockEnqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
    });

    it('should reject heavy retry when job is not failed', async () => {
        mockCollection.mockImplementation((collectionName: string) => {
            if (collectionName === 'sportsLibReparseJobs') {
                return {
                    doc: vi.fn(() => ({
                        get: vi.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ status: 'processing' }),
                        }),
                        set: vi.fn(),
                    })),
                };
            }
            throw new Error(`Unexpected collection ${collectionName}`);
        });

        await expect((retrySportsLibReparseHeavyJob as any)(getAdminRequest({ jobId: 'job-1' })))
            .rejects.toThrow('must be failed before heavy retry');
        expect(mockEnqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
    });

    it('should require admin auth for heavy retry', async () => {
        const request = {
            data: { jobId: 'job-1' },
            auth: { uid: 'user1', token: { admin: false } },
            app: { appId: 'mock-app-id' },
        } as unknown as CallableRequest<any>;

        await expect((retrySportsLibReparseHeavyJob as any)(request))
            .rejects.toThrow('Only admins can call this function.');
        expect(mockEnqueueSportsLibReparseHeavyTask).not.toHaveBeenCalled();
    });
});
