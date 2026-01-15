import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';

// Mock firebase-functions
vi.mock('firebase-functions', () => ({
    config: () => ({
        suuntoapp: { subscription_key: 'test-key' }
    }),
    region: () => ({
        runWith: () => ({
            pubsub: { schedule: () => ({ onRun: () => { } }) }
        })
    })
}));

// Setup Firestore Mocks
const mockUpdate = vi.fn(() => Promise.resolve());
const mockRef = { update: mockUpdate, parent: { id: 'some-collection' } };

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => {
    const mockFirestore = {
        collectionGroup: vi.fn(),
        collection: vi.fn(() => ({
            doc: vi.fn(() => ({
                get: vi.fn(),
                set: vi.fn(),
                delete: vi.fn(),
                update: vi.fn(),
            })),
            where: vi.fn().mockReturnThis(),
            get: vi.fn(),
        })),
        batch: vi.fn(() => ({
            set: vi.fn(),
            delete: vi.fn(),
            commit: vi.fn().mockResolvedValue(undefined),
        })),
    };
    const mockTimestamp = {
        fromDate: vi.fn((date) => ({ toDate: () => date })),
        now: vi.fn(() => ({ toDate: () => new Date() })),
    };
    const firestoreFunc = vi.fn(() => mockFirestore);
    (firestoreFunc as any).collectionGroup = mockFirestore.collectionGroup;
    (firestoreFunc as any).collection = mockFirestore.collection;
    (firestoreFunc as any).batch = mockFirestore.batch;
    (firestoreFunc as any).Timestamp = mockTimestamp;

    return {
        firestore: firestoreFunc
    };
});

// Mock dependencies
// Mock dependencies
const {
    mockMoveToDeadLetterQueue,
    mockGetTokenData,
} = vi.hoisted(() => ({
    mockMoveToDeadLetterQueue: vi.fn(),
    mockGetTokenData: vi.fn(),
}));

vi.mock('./tokens', () => ({
    getTokenData: mockGetTokenData,
}));

vi.mock('./queue-utils', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        moveToDeadLetterQueue: mockMoveToDeadLetterQueue,
    };
});

vi.mock('./request-helper', () => ({
    get: vi.fn()
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn(() => ({
                startDate: new Date(),
                getID: () => 'event-123'
            }))
        }
    };
});

vi.mock('./utils', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        generateIDFromParts: vi.fn(() => 'id123'),
        setEvent: vi.fn(() => Promise.resolve())
    };
});

import { parseWorkoutQueueItemForServiceName } from './queue';
import { getTokenData } from './tokens';
import * as requestHelper from './request-helper';

describe('Queue Integration Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should move to Dead Letter Queue (fail fast) if no tokens are found', async () => {
        const { moveToDeadLetterQueue } = await import('./queue-utils');

        (admin.firestore().collectionGroup as any).mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 0, docs: [] })
        });

        const queueItem = {
            id: 'item-123',
            retryCount: 0,
            ref: mockRef
        };

        await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, queueItem as any);

        expect(moveToDeadLetterQueue).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'item-123' }),
            expect.any(Error),
            undefined, // bulkWriter is not passed
            'NO_TOKEN_FOUND'
        );
    });

    it('should exit early and mark as processed on the first successful import', async () => {
        // Mock 2 tokens
        (admin.firestore().collectionGroup as any).mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                size: 2,
                docs: [
                    { id: 'token-1', ref: { parent: { parent: { id: 'user-1' } } }, data: () => ({}) },
                    { id: 'token-2', ref: { parent: { parent: { id: 'user-1' } } }, data: () => ({}) }
                ]
            })
        });

        // First token succeeds
        (getTokenData as any).mockResolvedValueOnce({ accessToken: 'valid-1' });
        (requestHelper.get as any).mockResolvedValueOnce(Buffer.from('fake-fit-data'));

        const queueItem = {
            id: 'item-123',
            retryCount: 0,
            ref: mockRef,
            userName: 'test-user'
        };

        await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, queueItem as any);

        // Verification
        expect(getTokenData).toHaveBeenCalledTimes(1); // Should only try the first token
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processed: true
        }));
    });

    it('should try subsequent tokens if the first one fails to refresh', async () => {
        // Mock 2 tokens
        (admin.firestore().collectionGroup as any).mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                size: 2,
                docs: [
                    { id: 'token-1', ref: { parent: { parent: { id: 'user-1' } } }, data: () => ({}) },
                    { id: 'token-2', ref: { parent: { parent: { id: 'user-1' } } }, data: () => ({}) }
                ]
            })
        });

        // First token refresh fails
        (getTokenData as any).mockRejectedValueOnce(new Error('Refresh failed'));
        // Second token succeeds
        (getTokenData as any).mockResolvedValueOnce({ accessToken: 'valid-2' });
        (requestHelper.get as any).mockResolvedValueOnce(Buffer.from('fake-fit-data'));

        const queueItem = {
            id: 'item-123',
            retryCount: 0,
            ref: mockRef,
            userName: 'test-user'
        };

        await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, queueItem as any);

        // Verification
        expect(getTokenData).toHaveBeenCalledTimes(2); // Should try both
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processed: true
        }));
    });

    it('should increment retry count if all tokens fail', async () => {
        // Mock 1 token
        (admin.firestore().collectionGroup as any).mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                size: 1,
                docs: [{ id: 'token-1', ref: { parent: { parent: { id: 'user-1' } } }, data: () => ({}) }]
            })
        });

        // All tokens fail
        (getTokenData as any).mockRejectedValue(new Error('All Refresh failed'));

        const queueItem = {
            id: 'item-123',
            retryCount: 0,
            ref: mockRef,
            userName: 'test-user'
        };

        await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, queueItem as any);

        // Verification
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            retryCount: 1,
            errors: expect.arrayContaining([
                expect.objectContaining({ error: 'All token processing attempts failed' })
            ])
        }));
    });
});
