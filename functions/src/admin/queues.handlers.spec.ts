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
    });

    it('should handle single-queue Cloud Task depth error and return 0 for that queue', async () => {
        mockGetCloudTaskQueueDepthForQueue
            .mockResolvedValueOnce(42)
            .mockRejectedValueOnce(new Error('Queue depth error'))
            .mockResolvedValueOnce(6);
        const result = await (getQueueStats as any)(request);
        expect(result.cloudTasks).toEqual({
            pending: 48,
            queues: {
                workout: {
                    queueId: 'processWorkoutTask',
                    pending: 42,
                },
                sportsLibReparse: {
                    queueId: 'processSportsLibReparseTask',
                    pending: 0,
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

    it('should return only basic statistics when includeAnalysis is false', async () => {
        request.data = { includeAnalysis: false };
        const result = await (getQueueStats as any)(request);

        expect(result.pending).toBeDefined();
        expect(result.dlq).toBeUndefined(); // Should be skipped
        expect(result.advanced.topErrors).toHaveLength(0); // Should be empty
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
