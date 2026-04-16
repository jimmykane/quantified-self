import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    getAdminRequest,
    getQueueStats,
    mockCollection,
    mockDoc,
    mockGetCloudTaskQueueDepthForQueue,
} from './test-utils/admin-test-harness';

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
        request = {
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };
    });

    it('should return queue statistics including DLQ', async () => {
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
                            updatedAtMs: 1700000004000
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
                            updatedAtMs: 1700000003000
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
            pending: 56,
            queues: {
                workout: {
                    queueId: 'processWorkoutTask',
                    pending: 42,
                },
                activitySync: {
                    queueId: 'processActivitySyncTask',
                    pending: 0,
                },
                sportsLibReparse: {
                    queueId: 'processSportsLibReparseTask',
                    pending: 8,
                },
                derivedMetrics: {
                    queueId: 'processDerivedMetricsTask',
                    pending: 6,
                },
            },
        });
        expect(result.reparse).toEqual(expect.objectContaining({
            queuePending: 8,
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

    it('should handle single-queue Cloud Task depth error and return 0 for that queue', async () => {
        mockGetCloudTaskQueueDepthForQueue
            .mockResolvedValueOnce(42)
            .mockRejectedValueOnce(new Error('Queue depth error'))
            .mockResolvedValueOnce(8)
            .mockResolvedValueOnce(6);
        const result = await (getQueueStats as any)(request);
        expect(result.cloudTasks).toEqual({
            pending: 56,
            queues: {
                workout: {
                    queueId: 'processWorkoutTask',
                    pending: 42,
                },
                activitySync: {
                    queueId: 'processActivitySyncTask',
                    pending: 0,
                },
                sportsLibReparse: {
                    queueId: 'processSportsLibReparseTask',
                    pending: 8,
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
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            get: vi.fn().mockResolvedValue({
                                size: 0,
                                docs: []
                            })
                        })
                    }),
                    where: vi.fn().mockReturnValue({
                        orderBy: whereOrderBy,
                        count: mockCount,
                        get: whereDirectGet,
                    }),
                };
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

    it('should return only basic statistics when includeAnalysis is false', async () => {
        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.pending).toBeDefined();
        expect(result.dlq).toBeUndefined(); // Should be skipped
        expect(result.advanced.topErrors).toHaveLength(0); // Should be empty
        expect(result.activitySync.advanced.topErrors).toHaveLength(0); // Should be empty
        expect(result.activitySync.dlqByContext).toHaveLength(0); // Should be empty
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
});
