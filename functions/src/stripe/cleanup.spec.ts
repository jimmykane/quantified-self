import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';

// Hoisted mocks for firebase-admin
const { mockFirestore, mockCollection, mockDocRef, mockDocSnap, mockFieldValue } = vi.hoisted(() => {
    const mockSnap = {
        exists: true,
        data: vi.fn()
    };
    const mockRef = {
        get: vi.fn(),
        update: vi.fn()
    };
    const mockCol = vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue(mockRef)
    });
    const firestoreFn = vi.fn().mockReturnValue({ collection: mockCol });
    const mockVal = {
        delete: vi.fn().mockReturnValue('DELETE_SENTINEL')
    };
    const firestore = Object.assign(firestoreFn, {
        FieldValue: mockVal
    });

    return {
        mockFirestore: firestore,
        mockCollection: mockCol,
        mockDocRef: mockRef,
        mockDocSnap: mockSnap,
        mockFieldValue: mockVal
    };
});

vi.mock('firebase-admin', () => ({
    firestore: mockFirestore,
    auth: () => ({})
}));

vi.mock('firebase-functions/v2/https', () => ({
    onCall: (opts: any, handler: any) => handler, // Unwrap handler
    HttpsError: class extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    }
}));

// Mock Stripe Client
const { mockStripeInstance, mockStripeRetrieve } = vi.hoisted(() => {
    const retrieve = vi.fn();
    return {
        mockStripeRetrieve: retrieve,
        mockStripeInstance: {
            customers: { retrieve }
        }
    };
});

vi.mock('./client', () => ({
    getStripe: vi.fn().mockResolvedValue(mockStripeInstance)
}));

const mockRequest = {
    auth: {
        uid: 'test-user-uid'
    },
    app: { appId: 'test-app-id' } // Mock App Check
} as CallableRequest;

// Assuming process.env is handled by environment or set here
process.env.STRIPE_API_KEY = 'sk_test_fake';

import { cleanupStripeCustomer } from './cleanup';

describe('cleanupStripeCustomer', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset default behaviors
        mockDocRef.get.mockResolvedValue(mockDocSnap);
        mockDocRef.update.mockResolvedValue({});
        mockDocSnap.data.mockReturnValue({});
        mockDocSnap.exists = true;

        mockStripeRetrieve.mockReset();
    });

    it('should throw if unauthenticated', async () => {
        const handler = cleanupStripeCustomer as unknown as (req: Partial<CallableRequest>) => Promise<unknown>;
        await expect(handler({ app: { appId: 'test' } })).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw if failed-precondition (no app check)', async () => {
        const handler = cleanupStripeCustomer as unknown as (req: Partial<CallableRequest>) => Promise<unknown>;
        await expect(handler({ auth: { uid: 'test' } })).rejects.toThrow('The function must be called from an App Check verified app.');
    });

    it('should return error if no customer record found in Firestore', async () => {
        // Mock get to return exists: false
        mockDocRef.get.mockResolvedValueOnce({ exists: false });

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };

        expect(result.success).toBe(false);
        expect(result.message).toContain('No customer record');
    });

    it('should return success if no stripeId in Firestore', async () => {
        // Mock data to return empty object (no stripeId)
        mockDocSnap.data.mockReturnValue({});

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };

        expect(result.success).toBe(true);
        expect(result.message).toContain('No Stripe ID');
    });

    it('should verify customer exists (Active) and NOT delete', async () => {
        // Mock Firestore finding the ID
        mockDocSnap.data.mockReturnValue({ stripeId: 'cus_test123' });

        mockStripeRetrieve.mockResolvedValue({ id: 'cus_test123', deleted: false });

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };

        expect(mockStripeRetrieve).toHaveBeenCalledWith('cus_test123');
        expect(mockDocRef.update).not.toHaveBeenCalled();
        expect(result.cleaned).toBe(false);
    });

    it('should delete stripeId if Stripe returns deleted: true', async () => {
        // Mock Firestore finding the ID
        mockDocSnap.data.mockReturnValue({ stripeId: 'cus_test123' });

        mockStripeRetrieve.mockResolvedValue({ id: 'cus_test123', deleted: true });

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };

        expect(mockDocRef.update).toHaveBeenCalledWith({
            stripeId: 'DELETE_SENTINEL',
            stripeLink: 'DELETE_SENTINEL'
        });
        expect(result.cleaned).toBe(true);
    });

    it('should delete stripeId if Stripe throws resource_missing', async () => {
        // Mock Firestore finding the ID
        mockDocSnap.data.mockReturnValue({ stripeId: 'cus_test123' });

        const error = Object.assign(new Error('No such customer'), { code: 'resource_missing' });
        mockStripeRetrieve.mockRejectedValue(error);

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;

        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };
        expect(result.cleaned).toBe(true);
        expect(mockDocRef.update).toHaveBeenCalled();
    });
    it('should throw HttpsError internal if Stripe verify fails with generic error', async () => {
        // Mock Firestore finding the ID
        mockDocSnap.data.mockReturnValue({ stripeId: 'cus_test123' });

        mockStripeRetrieve.mockRejectedValue(new Error('Network Error'));

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        await expect(handler(mockRequest)).rejects.toThrow('Failed to verify Stripe customer.');
    });

    it('should wrap non-HttpsError in internal HttpsError', async () => {
        // Mock Firestore throwing generic error
        mockDocRef.get.mockRejectedValue(new Error('DB Connection Failed'));

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;

        await expect(handler(mockRequest)).rejects.toThrow('Cleanup process failed.');
    });
});
