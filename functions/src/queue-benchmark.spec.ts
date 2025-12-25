import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

// 1. Mock utils FIRST
vi.mock('./utils', () => ({
    generateIDFromParts: () => 'mock-id',
    setEvent: vi.fn().mockResolvedValue(undefined),
    UsageLimitExceededError: class extends Error { },
}));

// 2. Mock external deps
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn().mockResolvedValue({
                getID: () => 'event-id',
                name: 'test-event',
                startDate: new Date(),
                setID: function () { return this; },
                toJSON: () => ({}),
                getActivities: () => [],
            }),
        },
    };
});

// 3. Mock internal deps
const { mockGetTokenData, mockGet, mockUpdate, mockFirestore } = vi.hoisted(() => ({
    mockGetTokenData: vi.fn(),
    mockGet: vi.fn(),
    mockUpdate: vi.fn(),
    mockFirestore: {
        collection: vi.fn(),
        collectionGroup: vi.fn(),
        bulkWriter: vi.fn(() => ({
            update: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
        })),
    }
}));

vi.mock('firebase-admin', () => ({
    default: { firestore: () => mockFirestore },
    firestore: () => mockFirestore,
}));

vi.mock('./tokens', () => ({
    getTokenData: mockGetTokenData,
}));

vi.mock('./history', () => ({
    getServiceWorkoutQueueName: () => 'test-queue',
}));

// Mock request-helper to avoid network calls
vi.mock('./request-helper', () => ({
    default: { get: vi.fn().mockResolvedValue(new ArrayBuffer(8)) },
    get: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
}));

import { parseQueueItems } from './queue';

describe('Queue Processing Benchmark', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should process items in parallel', async () => {
        const itemCount = 20;
        const delayPerItem = 50; // ms

        // Create mock docs
        const docs = Array.from({ length: itemCount }).map((_, i) => ({
            id: `doc-${i}`,
            ref: { update: mockUpdate },
            data: () => ({
                userName: `user-${i}`,
                workoutID: `workout-${i}`,
                retryCount: 0
            })
        }));

        // Mock Firestore query
        const mockQuery = {
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                size: itemCount,
                docs: docs
            })
        };
        mockFirestore.collection.mockReturnValue(mockQuery);

        // Mock token query (used inside parseWorkoutQueueItemForServiceName)
        mockFirestore.collectionGroup.mockReturnValue({
            where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                    size: 1,
                    docs: [{
                        id: 'token-doc',
                        ref: { parent: { parent: { id: 'user-id' } } }
                    }]
                })
            })
        });

        // Mock getTokenData to be slow
        mockGetTokenData.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, delayPerItem));
            return { accessToken: 'fake-token' };
        });

        console.time('Benchmark');
        const start = Date.now();
        await parseQueueItems(ServiceNames.SuuntoApp);
        const end = Date.now();
        const duration = end - start;
        console.timeEnd('Benchmark');

        console.log(`Processed ${itemCount} items in ${duration}ms (Delay per item: ${delayPerItem}ms)`);

        // If sequential: 20 * 50 = 1000ms minimum
        // If parallel (limit > 1): significantly less

        // Assertions will depend on implementation
        // For now, we just want to see the time.
        // Once optimized, we expect duration < (itemCount * delayPerItem / 2)
    });
});
