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
const mockRef = { update: mockUpdate };

vi.mock('firebase-admin', () => {
    const mockFirestore = {
        collectionGroup: vi.fn(),
        collection: vi.fn()
    };
    return {
        firestore: Object.assign(vi.fn(() => mockFirestore), {
            collectionGroup: mockFirestore.collectionGroup,
            collection: mockFirestore.collection
        })
    };
});

// Mock dependencies
vi.mock('./tokens', () => ({
    getTokenData: vi.fn()
}));

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

vi.mock('./utils', () => ({
    generateIDFromParts: vi.fn(() => 'id123'),
    setEvent: vi.fn(() => Promise.resolve())
}));

import { parseWorkoutQueueItemForServiceName } from './queue';
import { getTokenData } from './tokens';
import * as requestHelper from './request-helper';

describe('Queue Integration Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should increment retryCount by 1 (grace period) if no tokens are found', async () => {
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

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            retryCount: 1,
            errors: expect.arrayContaining([
                expect.objectContaining({ error: 'No tokens found' })
            ])
        }));
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
