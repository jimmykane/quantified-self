import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted to avoid initialization errors
const { mockReconcileClaims, mockCheckAndSendEmails } = vi.hoisted(() => ({
    mockReconcileClaims: vi.fn(),
    mockCheckAndSendEmails: vi.fn()
}));

vi.mock('./claims', () => ({
    reconcileClaims: mockReconcileClaims
}));

vi.mock('./email-triggers', () => ({
    checkAndSendSubscriptionEmails: mockCheckAndSendEmails
}));

// Mock firebase-functions BEFORE imports
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (opts: any, handler: any) => handler
}));

const testEnv = { cleanup: () => { } };

// Import AFTER mocks
import { onSubscriptionUpdated } from './subscriptions';

describe('onSubscriptionUpdated', () => {
    let firestoreSpy: any;
    let collectionSpy: any;
    let docSpy: any;
    let setSpy: any;
    let updateSpy: any;
    let getSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        setSpy = vi.fn().mockResolvedValue({} as any);
        updateSpy = vi.fn().mockResolvedValue({} as any);
        getSpy = vi.fn();

        docSpy = vi.fn().mockReturnValue({
            get: getSpy,
            set: setSpy,
            update: updateSpy
        });

        const mockQuery = (docs: any[]) => ({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
                empty: docs.length === 0,
                docs: docs
            })
        });

        collectionSpy = vi.fn().mockImplementation((path: string) => {
            if (path.includes('subscriptions')) return mockQuery([]);
            return mockQuery([]);
        });

        firestoreSpy = vi.spyOn(admin, 'firestore').mockReturnValue({
            collection: collectionSpy,
            doc: docSpy,
        } as any);

        (admin.firestore as any).Timestamp = {
            fromDate: (date: Date) => ({ toDate: () => date }),
            now: () => ({ toMillis: () => Date.now() })
        };
        (admin.firestore as any).FieldValue = {
            delete: () => 'DELETE_SENTINEL',
            serverTimestamp: () => 'SERVER_TIMESTAMP'
        };
    });

    it('should set gracePeriodUntil if no active subscriptions and not already set', async () => {
        const uid = 'user123';
        const event = {
            params: { uid, subscriptionId: 'sub456' }
        } as any;

        // Mock reconcileClaims result
        mockReconcileClaims.mockResolvedValue({ role: 'free' });

        // Mock no active subscriptions
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true })
        });

        // Mock user doc (no grace period yet)
        getSpy.mockResolvedValue({
            exists: true,
            data: () => ({})
        });

        await onSubscriptionUpdated(event);

        expect(mockReconcileClaims).toHaveBeenCalledWith(uid);
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
            gracePeriodUntil: expect.anything(),
            lastDowngradedAt: 'SERVER_TIMESTAMP'
        }), { merge: true });
    });

    it('should NOT set gracePeriodUntil if already set', async () => {
        const uid = 'user123';
        const event = {
            params: { uid, subscriptionId: 'sub456' }
        } as any;

        mockReconcileClaims.mockResolvedValue({ role: 'free' });

        // No active subs
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true })
        });

        // User ALREADY has grace period
        getSpy.mockResolvedValue({
            exists: true,
            data: () => ({ gracePeriodUntil: new Date() })
        });

        await onSubscriptionUpdated(event);

        expect(setSpy).not.toHaveBeenCalled();
    });

    it('should clear gracePeriodUntil if active subscription is found', async () => {
        const uid = 'user123';
        const event = {
            params: { uid, subscriptionId: 'sub456' }
        } as any;

        mockReconcileClaims.mockResolvedValue({ role: 'pro' });

        // ACTIVE sub found
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: false })
        });

        await onSubscriptionUpdated(event);

        expect(updateSpy).toHaveBeenCalledWith({
            gracePeriodUntil: 'DELETE_SENTINEL',
            lastDowngradedAt: 'DELETE_SENTINEL'
        });

        // Should call reconcileClaims again to be sure
        expect(mockReconcileClaims).toHaveBeenCalledTimes(2);
    });

    // --------------------------------------------------------------------------------
    // Email Trigger Tests
    // --------------------------------------------------------------------------------
    it('should call checkAndSendSubscriptionEmails with correct data', async () => {
        const uid = 'user_email_test';
        const subId = 'sub_active_1';
        const beforeData = { role: 'basic' };
        const afterData = { role: 'pro' };

        const event = {
            id: 'evt123',
            params: { uid, subscriptionId: subId },
            data: {
                before: { data: () => beforeData },
                after: { data: () => afterData }
            }
        } as any;

        mockReconcileClaims.mockResolvedValue({ role: 'pro' });

        // Mock active sub found (standard flow)
        collectionSpy.mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: false })
        });

        await onSubscriptionUpdated(event);

        expect(mockCheckAndSendEmails).toHaveBeenCalledWith(
            uid,
            subId,
            beforeData,
            afterData,
            'evt123'
        );
    });
});

