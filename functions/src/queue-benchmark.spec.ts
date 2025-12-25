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

    it('should process items in parallel and cache tokens', async () => {
        const itemCount = 20;
        const delayPerItem = 50; // ms
        const uniqueUsers = 2; // Only 2 users for 20 items

        // Create mock docs
        const docs = Array.from({ length: itemCount }).map((_, i) => ({
            id: `doc-${i}`,
            ref: { update: mockUpdate },
            data: () => ({
                userName: `user-${i % uniqueUsers}`, // Cycle through users
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

        // Mock token query
        const mockTokenGet = vi.fn().mockResolvedValue({
            size: 1,
            docs: [{
                id: 'token-doc',
                ref: { parent: { parent: { id: 'user-id' } } }
            }]
        });

        mockFirestore.collectionGroup.mockReturnValue({
            where: vi.fn().mockReturnValue({
                get: mockTokenGet
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

        console.log(`Benchmark with caching: ${duration}ms`);
        // With item delay of 50ms and 20 parallel items, it should take ~50-100ms
        expect(duration).toBeLessThan(500);

        // Verify that token fetch was only called for each unique user
        expect(mockTokenGet).toHaveBeenCalledTimes(uniqueUsers);
    });
});
