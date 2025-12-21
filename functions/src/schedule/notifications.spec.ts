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
        { Timestamp: { fromDate: (date: Date) => date } }
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

        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                size: 1,
                docs: mockSubs
            })
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
            template: expect.objectContaining({ name: 'subscription_expiring_soon' })
        }));
    });

    it('should queue emails for grace period ending', async () => {
        // Mock Subscriptions results (empty)
        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 0, docs: [] })
        });

        // Mock Users results
        const mockUsers = [
            {
                id: 'user2',
                data: () => ({ gracePeriodUntil: '2025-12-30T10:00:00Z' })
            }
        ];


        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn().mockResolvedValue({})
        };

        collectionSpy.mockImplementation((name) => {
            if (name === 'users') {
                return {
                    where: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({ size: 1, docs: mockUsers })
                };
            }
            if (name === 'mail') {
                return {
                    doc: vi.fn(() => mailDocRef)
                };
            }
            return { where: vi.fn().mockReturnThis(), get: vi.fn() };
        });

        await wrapped({});

        expect(collectionSpy).toHaveBeenCalledWith('users');
        expect(mailDocRef.set).toHaveBeenCalledWith(expect.objectContaining({
            toUids: ['user2'],
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
        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 1, docs: mockSubs })
        });

        // Mock Mail exists
        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: true }), // Exists!
            set: vi.fn()
        };
        collectionSpy.mockImplementation((name) => {
            if (name === 'users') return { where: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) };
            if (name === 'mail') return { doc: vi.fn(() => mailDocRef) };
            return {};
        });

        await wrapped({});

        expect(mailDocRef.set).not.toHaveBeenCalled();
    });
});
