import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fft from 'firebase-functions-test'; // Default import
import { checkSubscriptionNotifications } from './notifications';

const testEnv = fft();

// Mocks
const collectionGroupSpy = vi.fn();
const collectionSpy = vi.fn();
const batchSpy = vi.fn();
const docSpy = vi.fn();
const runTransactionSpy = vi.fn();
const getUserDeletionGuardStateInTransaction = vi.hoisted(() => vi.fn());

// Firestore Mock Implementation
const mockFirestore = {
    collectionGroup: collectionGroupSpy,
    collection: collectionSpy,
    batch: batchSpy,
    doc: docSpy,
    runTransaction: runTransactionSpy,
};

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction,
}));

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
    let activeSubscriptionDocs: Array<{ id: string; data: () => Record<string, unknown> }>;

    const createSubscriptionDoc = (
        data: Record<string, unknown>,
        currentData: Record<string, unknown> | undefined = data,
        id = 'sub1',
    ) => {
        const currentSnapshot = {
            id,
            data: () => currentData || {},
        };
        if (currentData && ['active', 'trialing'].includes(`${currentData.status || ''}`)) {
            activeSubscriptionDocs.push(currentSnapshot);
        }

        const activeQuery = {
            get: vi.fn().mockImplementation(async () => ({
                empty: activeSubscriptionDocs.length === 0,
                docs: activeSubscriptionDocs,
            })),
        };
        return {
            id,
            data: () => data,
            ref: {
                parent: {
                    parent: { id: 'user1' },
                    where: vi.fn(() => activeQuery),
                },
                get: vi.fn().mockResolvedValue({
                    exists: currentData !== undefined,
                    data: () => currentData,
                }),
            },
        };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        activeSubscriptionDocs = [];
        getUserDeletionGuardStateInTransaction.mockResolvedValue({
            shouldSkip: false,
            userExists: true,
            deletionInProgress: false,
        });
        runTransactionSpy.mockImplementation(async (handler: (transaction: unknown) => Promise<unknown>) => handler({
            get: (ref: { get: () => Promise<unknown> }) => ref.get(),
            set: (ref: { set: (data: unknown, options?: unknown) => unknown }, data: unknown, options?: unknown) => (
                options === undefined ? ref.set(data) : ref.set(data, options)
            ),
        }));
        // Wrap the cloud function to make it callable
        wrapped = testEnv.wrap(checkSubscriptionNotifications);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        testEnv.cleanup();
    });

    it('should queue emails for expiring subscriptions', async () => {
        // Mock Subscriptions results
        const mockSubs = [createSubscriptionDoc({
            status: 'active',
            role: 'basic',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 1234567890 },
        })];

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
        const systemStatusRef = {
            set: vi.fn().mockResolvedValue({})
        };
        docSpy.mockReturnValue(systemStatusRef);
        collectionSpy.mockReturnValue({ // Default for 'mail' or 'users'
            doc: vi.fn(() => mailDocRef),
            where: vi.fn().mockReturnThis(), // For query chains
            get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) // Default empty for users query
        });

        // Invoke function
        await wrapped({});

        expect(collectionGroupSpy).toHaveBeenCalledWith('subscriptions');
        expect(docSpy).toHaveBeenCalledWith('users/user1/system/status');
        expect(systemStatusRef.set).toHaveBeenCalledWith({
            scheduledGracePeriodUntil: expect.any(Object)
        }, { merge: true });
        expect(systemStatusRef.set.mock.calls[0][0].scheduledGracePeriodUntil.toDate()).toEqual(
            new Date('2026-01-24T00:00:00.000Z')
        );
        expect(mailDocRef.set).toHaveBeenCalledWith(expect.objectContaining({
            toUids: ['user1'],
            from: 'Quantified Self <hello@quantified-self.io>',
            replyTo: 'support@quantified-self.io',
            template: {
                name: 'subscription_expiring_soon',
                data: expect.objectContaining({
                    role: 'Basic',
                    expiration_date: '25 December 2025',
                    grace_period_end: '24 January 2026',
                    free_activity_description: 'Up to 100 activities',
                    free_route_description: 'Up to 10 saved routes',
                    free_ai_insights_description: '20 AI Insights requests per calendar month',
                    device_sync_will_end: false,
                    membership_url: 'https://quantified-self.io/pricing'
                })
            },
            expireAt: expect.any(Object)
        }));
    });

    it('should include ending trials in the expiring reminder lifecycle', async () => {
        const trialSubscription = createSubscriptionDoc({
            status: 'trialing',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 1234567890 },
        });
        const whereSpy = vi.fn().mockReturnThis();
        collectionGroupSpy.mockReturnValue({
            where: whereSpy,
            get: vi.fn().mockResolvedValue({ size: 1, docs: [trialSubscription] }),
        });
        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn().mockResolvedValue({}),
        };
        const systemStatusRef = { set: vi.fn().mockResolvedValue({}) };
        collectionSpy.mockReturnValue({ doc: vi.fn(() => mailDocRef) });
        docSpy.mockReturnValue(systemStatusRef);

        await wrapped({});

        expect(whereSpy).toHaveBeenCalledWith('status', 'in', ['active', 'trialing']);
        expect(mailDocRef.set).toHaveBeenCalledWith(expect.objectContaining({
            template: expect.objectContaining({
                name: 'subscription_expiring_soon',
            }),
        }));
    });

    it('should not queue a reminder or deadline while another subscription continues', async () => {
        const expiringSubscription = createSubscriptionDoc({
            status: 'active',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 1234567890 },
        });
        createSubscriptionDoc({
            status: 'active',
            role: 'basic',
            cancel_at_period_end: false,
            current_period_end: { toDate: () => new Date('2026-01-25'), seconds: 1234567999 },
        }, undefined, 'sub2');
        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 1, docs: [expiringSubscription] }),
        });
        const mailDocRef = { get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn() };
        const systemStatusRef = { set: vi.fn() };
        collectionSpy.mockReturnValue({ doc: vi.fn(() => mailDocRef) });
        docSpy.mockReturnValue(systemStatusRef);

        await wrapped({});

        expect(mailDocRef.set).not.toHaveBeenCalled();
        expect(systemStatusRef.set).not.toHaveBeenCalled();
    });

    it('should not use an earlier ending subscription as the user-wide deadline', async () => {
        const earlierSubscription = createSubscriptionDoc({
            status: 'active',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 1234567890 },
        });
        createSubscriptionDoc({
            status: 'active',
            role: 'basic',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2026-01-25'), seconds: 1234567999 },
        }, undefined, 'sub2');
        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 1, docs: [earlierSubscription] }),
        });
        const mailDocRef = { get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn() };
        const systemStatusRef = { set: vi.fn() };
        collectionSpy.mockReturnValue({ doc: vi.fn(() => mailDocRef) });
        docSpy.mockReturnValue(systemStatusRef);

        await wrapped({});

        expect(mailDocRef.set).not.toHaveBeenCalled();
        expect(systemStatusRef.set).not.toHaveBeenCalled();
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
        const mockSubs = [createSubscriptionDoc({
            status: 'active',
            role: 'basic',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 12345 },
        })];
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
        const systemStatusRef = {
            set: vi.fn().mockResolvedValue({})
        };
        docSpy.mockReturnValue(systemStatusRef);
        collectionSpy.mockImplementation((name) => {
            if (name === 'mail') return { doc: vi.fn(() => mailDocRef) };
            return {};
        });

        await wrapped({});

        expect(mailDocRef.set).not.toHaveBeenCalled();
        expect(systemStatusRef.set).toHaveBeenCalledWith({
            scheduledGracePeriodUntil: expect.any(Object)
        }, { merge: true });
    });

    it('should skip queue and deadline writes when the user is missing or being deleted', async () => {
        const mockSubs = [createSubscriptionDoc({
            status: 'active',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 12345 },
        })];
        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 1, docs: mockSubs })
        });
        getUserDeletionGuardStateInTransaction.mockResolvedValue({
            shouldSkip: true,
            userExists: false,
            deletionInProgress: true,
        });
        const mailDocRef = { get: vi.fn(), set: vi.fn() };
        const systemStatusRef = { set: vi.fn() };
        collectionSpy.mockReturnValue({ doc: vi.fn(() => mailDocRef) });
        docSpy.mockReturnValue(systemStatusRef);

        await wrapped({});

        expect(mailDocRef.set).not.toHaveBeenCalled();
        expect(systemStatusRef.set).not.toHaveBeenCalled();
    });

    it('should skip a stale query result when cancellation was revoked before the transaction', async () => {
        const queriedData = {
            status: 'active',
            role: 'pro',
            cancel_at_period_end: true,
            current_period_end: { toDate: () => new Date('2025-12-25'), seconds: 12345 },
        };
        const currentData = {
            ...queriedData,
            cancel_at_period_end: false,
        };
        const mockSubs = [createSubscriptionDoc(queriedData, currentData)];
        collectionGroupSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ size: 1, docs: mockSubs }),
        });
        const mailDocRef = {
            get: vi.fn().mockResolvedValue({ exists: false }),
            set: vi.fn(),
        };
        const systemStatusRef = { set: vi.fn() };
        collectionSpy.mockReturnValue({ doc: vi.fn(() => mailDocRef) });
        docSpy.mockReturnValue(systemStatusRef);

        await wrapped({});

        expect(mockSubs[0].ref.get).toHaveBeenCalled();
        expect(mailDocRef.set).not.toHaveBeenCalled();
        expect(systemStatusRef.set).not.toHaveBeenCalled();
    });
});
