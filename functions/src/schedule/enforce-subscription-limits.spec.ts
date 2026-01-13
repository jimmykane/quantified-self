import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted for top-level access
const {
    mockSetCustomUserClaims,
    mockRecursiveDelete,
    mockFirestoreInstance,
    mockAuthInstance
} = vi.hoisted(() => {
    const auth = {
        setCustomUserClaims: vi.fn().mockResolvedValue(undefined)
    };
    const fs: any = {
        collection: vi.fn(),
        doc: vi.fn(),
        recursiveDelete: vi.fn().mockResolvedValue(undefined),
    };
    fs.Timestamp = {
        now: () => ({
            toMillis: () => Date.now(),
            toDate: () => new Date(),
            toISOString: () => new Date().toISOString()
        }),
        fromDate: (d: Date) => ({
            toDate: () => d,
            toMillis: () => d.getTime(),
            toISOString: () => d.toISOString()
        })
    };
    fs.FieldValue = {
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        delete: () => 'DELETE_SENTINEL'
    };
    return {
        mockSetCustomUserClaims: auth.setCustomUserClaims,
        mockAuthInstance: auth,
        mockRecursiveDelete: fs.recursiveDelete,
        mockFirestoreInstance: fs
    };
});

// Mock firebase-admin
vi.mock('firebase-admin', () => {
    const authMock = vi.fn(() => mockAuthInstance);
    const firestoreMock = vi.fn(() => mockFirestoreInstance);

    // Attach static properties to the firestore function if needed
    Object.assign(firestoreMock, mockFirestoreInstance);

    return {
        auth: authMock,
        firestore: firestoreMock
    };
});

// Mock firebase-functions
vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (opts: any, handler: any) => handler
}));

// Import AFTER mocks
import { enforceSubscriptionLimits } from './enforce-subscription-limits';
import * as OAuth2 from '../OAuth2';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

describe('enforceSubscriptionLimits', () => {
    let deauthorizeServiceSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        deauthorizeServiceSpy = vi.spyOn(OAuth2, 'deauthorizeServiceForUser').mockResolvedValue(undefined);

        // Reset mock implementations
        mockFirestoreInstance.collection.mockImplementation(() => mockQuery([]));
        mockFirestoreInstance.doc.mockImplementation(() => mockDoc({}));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper to create mock query results
    const mockQuery = (docs: any[], count = 0) => ({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
            empty: docs.length === 0,
            docs: docs,
            forEach: (cb: any) => docs.forEach(cb),
            data: () => ({ count })
        }),
        count: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ data: () => ({ count }) })
        })
    });

    // Helper to create mock documents
    const mockDoc = (data = {}) => ({
        get: vi.fn().mockResolvedValue({
            exists: Object.keys(data).length > 0,
            data: () => data
        }),
        set: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        ref: { id: 'mockId' }
    });

    it('should skip if no users are found in any token collection', async () => {
        mockFirestoreInstance.collection.mockReturnValue(mockQuery([]));

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockFirestoreInstance.doc).not.toHaveBeenCalled();

    });

    it('should skip cleanup if user is within grace period', async () => {
        const futureDate = new Date(Date.now() + 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            return mockQuery([]);
        });

        // Mock system doc fetch for grace period
        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(futureDate) });
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});


        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it('should initialize grace period if missing (Fail-safe)', async () => {
        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            return mockQuery([]);
        });

        const systemDocSetSpy = vi.fn().mockResolvedValue({});
        const systemDocMock = {
            get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            set: systemDocSetSpy,
            ref: { id: 'status' }
        };

        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return systemDocMock;
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        expect(mockFirestoreInstance.doc).toHaveBeenCalledWith('users/user1/system/status');
        expect(systemDocSetSpy).toHaveBeenCalledWith(expect.objectContaining({
            gracePeriodUntil: expect.anything(),
            lastDowngradedAt: 'SERVER_TIMESTAMP'
        }), { merge: true });


    });

    it('should disconnect and prune if grace period expired', async () => {
        const pastDate = new Date(Date.now() - 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path.includes('subscriptions')) return mockQuery([]); // No active pros
            if (path.includes('events')) {
                // Return 2 events to delete (12 total, limit 10)
                const docs = [
                    { id: 'event1', ref: { id: 'event1' } },
                    { id: 'event2', ref: { id: 'event2' } }
                ];
                return mockQuery(docs, 12);
            }
            return mockQuery([]);
        });

        // Mock system doc fetch for grace period
        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Verify disconnection
        // Expect deauthorizeServiceForUser to be called for Suunto, COROS, and Garmin
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.SuuntoApp);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.COROSAPI);
        expect(deauthorizeServiceSpy).toHaveBeenCalledWith('user1', ServiceNames.GarminAPI);

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user1', { stripeRole: 'free' });

        // Verify pruning (12 - 10 = 2 excess)
        expect(mockRecursiveDelete).toHaveBeenCalledTimes(2);
    });

    it('should NOT prune if count is within limits', async () => {
        const pastDate = new Date(Date.now() - 100000);

        mockFirestoreInstance.collection.mockImplementation((path: string) => {
            if (path === GARMIN_API_TOKENS_COLLECTION_NAME) return mockQuery([{ id: 'user1' }]);
            if (path.includes('subscriptions')) return mockQuery([]); // No active pros
            if (path.includes('events')) {
                // Return exactly 10 events (Limit is 10)
                return mockQuery([], 10);
            }
            return mockQuery([]);
        });

        // Mock system doc fetch for grace period
        mockFirestoreInstance.doc.mockImplementation((path: string) => {
            if (path === 'users/user1/system/status') return mockDoc({ gracePeriodUntil: admin.firestore.Timestamp.fromDate(pastDate) });
            return mockDoc({});
        });

        const wrapped = enforceSubscriptionLimits as any;
        await wrapped({});

        // Verify pruning does NOT happen
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
    });
});
