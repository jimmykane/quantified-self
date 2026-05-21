import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';
import fft from 'firebase-functions-test'; // Default import
import { checkSubscriptionNotifications } from './notifications';

const testEnv = fft();

// Mocks
const collectionGroupSpy = vi.fn();
const collectionSpy = vi.fn();
const batchSpy = vi.fn();

// Firestore Mock Implementation
const mockFirestore = {
    collectionGroup: collectionGroupSpy,
    collection: collectionSpy,
    batch: batchSpy,
};

vi.mock('firebase-admin', () => ({
    initializeApp: vi.fn(),
    firestore: Object.assign(
        vi.fn(() => mockFirestore),
        {
            Timestamp: {
                fromDate: (date: Date) => ({
                    toDate: () => date,
                    toMillis: () => date.getTime(),
                    toISOString: () => date.toISOString()
                })
            }
        }
    )
}));

describe('checkSubscriptionNotifications', () => {
    let wrapped: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Wrap the cloud function to make it callable
        wrapped = testEnv.wrap(checkSubscriptionNotifications);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        testEnv.cleanup();
    });

    it('should queue emails for expiring subscriptions', async () => {
        // Mock Subscriptions results
        const mockSubs = [
            {
                id: 'sub1',
                data: () => ({ status: 'active', role: 'basic', current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 1234567890 } }),
                ref: { parent: { parent: { id: 'user1' } } }
            }
        ];

        collectionGroupSpy.mockImplementation((collectionName) => {
            if (collectionName === 'subscriptions') {
                return {
                    where: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({
                        size: 1,
                        docs: mockSubs
                    })
                };
            }
            // Fallback for other collection groups (like system)
            return { where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) };
        });

        // Mock Mail collection check (not exists)
        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn().mockResolvedValue({})
        };
        collectionSpy.mockReturnValue({ // Default for 'mail' or 'users'
            doc: vi.fn(() => mailDocRef),
            where: vi.fn().mockReturnThis(), // For query chains
            get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) // Default empty for users query
        });

        // Invoke function
        await wrapped({});

        expect(collectionGroupSpy).toHaveBeenCalledWith('subscriptions');
        expect(mailDocRef.set).toHaveBeenCalledWith(expect.objectContaining({
            toUids: ['user1'],
            template: expect.objectContaining({ name: 'subscription_expiring_soon' }),
            expireAt: expect.any(Object)
        }));
    });

    it('should not query grace periods or queue grace period warning emails', async () => {
        collectionGroupSpy.mockImplementation((collectionName) => {
            if (collectionName === 'subscriptions') {
                return { where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) };
            }
            if (collectionName === 'system') {
                throw new Error('Grace period notifications should not query system docs');
            }
            return { where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) };
        });

        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn().mockResolvedValue({})
        };

        collectionSpy.mockImplementation((name) => {
            if (name === 'mail') {
                return {
                    doc: vi.fn(() => mailDocRef)
                };
            }
            return { where: vi.fn().mockReturnThis(), get: vi.fn() };
        });

        await wrapped({});

        expect(collectionGroupSpy).not.toHaveBeenCalledWith('system');
        expect(mailDocRef.set).not.toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({ name: 'grace_period_ending' })
        }));
    });

    it('should idempotent skip if mail document exists', async () => {
        // Mock Subscriptions (1 found)
        const mockSubs = [
            {
                id: 'sub1',
                data: () => ({ status: 'active', role: 'basic', current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 12345 } }),
                ref: { parent: { parent: { id: 'user1' } } }
            }
        ];
        collectionGroupSpy.mockImplementation((collectionName) => {
            if (collectionName === 'subscriptions') {
                return {
                    where: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({ size: 1, docs: mockSubs })
                };
            }
            return { where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) };
        });

        // Mock Mail exists
        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: true }), // Exists!
            set: vi.fn()
        };
        collectionSpy.mockImplementation((name) => {
            if (name === 'mail') return { doc: vi.fn(() => mailDocRef) };
            return {};
        });

        await wrapped({});

        expect(mailDocRef.set).not.toHaveBeenCalled();
    });
});
