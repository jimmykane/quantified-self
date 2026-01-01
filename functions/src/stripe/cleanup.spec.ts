import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallableRequest } from 'firebase-functions/v2/https';


// Mock dependencies using vi.hoisted to avoid ReferenceError
const mocks = vi.hoisted(() => {
    const retrieve = vi.fn();

    // Firestore mocks
    const update = vi.fn().mockResolvedValue({});
    const get = vi.fn(); // will be configured per test
    const docFn = vi.fn().mockReturnValue({ get, update });
    const collection = vi.fn().mockReturnValue({ doc: docFn });
    const firestore = vi.fn().mockReturnValue({ collection });

    // Logger mock
    const logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    };

    return {
        retrieve,
        update,
        get,
        doc: docFn,
        collection,
        firestore,
        logger
    };
});

vi.mock('firebase-functions/logger', () => mocks.logger);

vi.mock('firebase-admin', async () => {
    return {
        firestore: Object.assign(mocks.firestore, {
            FieldValue: {
                delete: vi.fn().mockReturnValue('DELETE_FIELD_SENTINEL')
            }
        }),
        initializeApp: vi.fn()
    };
});

const mockRequest = {
    auth: {
        uid: 'test-user-uid'
    }
} as CallableRequest;

// Assuming process.env is handled by environment or set here
process.env.STRIPE_API_KEY = 'sk_test_fake';

import { cleanupStripeCustomer, setStripeInstanceForTesting } from './cleanup';

// Mock https onCall wrapping
vi.mock('firebase-functions/v2/https', () => {
    return {
        onCall: (opts: any, handler: any) => handler,
        HttpsError: class extends Error {
            code: string;
            constructor(code: string, message: string) {
                super(message);
                this.code = code;
            }
        } // Mock imports needs real exports if possible or mocked ones
    };
});

describe('cleanupStripeCustomer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.retrieve.mockReset();
        mocks.update.mockReset();
        // Reset default behaviors
        mocks.update.mockResolvedValue({});

        // Inject mock stripe instance
        setStripeInstanceForTesting({
            customers: {
                retrieve: mocks.retrieve
            }
        });
    });

    // Debug test case removed

    it('should throw if unauthenticated', async () => {
        const handler = cleanupStripeCustomer as unknown as (req: Partial<CallableRequest>) => Promise<unknown>;
        await expect(handler({})).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should return error if no customer record found in Firestore', async () => {
        mocks.get.mockResolvedValueOnce({ exists: false });
        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };
        expect(result.success).toBe(false);
        expect(result.message).toContain('No customer record');
    });

    it('should return success if no stripeId in Firestore', async () => {
        mocks.get.mockResolvedValueOnce({
            exists: true,
            data: () => ({}) // No stripeId
        });
        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };
        expect(result.success).toBe(true);
        expect(result.message).toContain('No Stripe ID');
    });

    it('should verify customer exists (Active) and NOT delete', async () => {
        // Mock Firestore finding the ID
        mocks.get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ stripeId: 'cus_test123' })
        });

        mocks.retrieve.mockResolvedValue({ id: 'cus_test123', deleted: false });

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };

        expect(mocks.retrieve).toHaveBeenCalledWith('cus_test123');
        expect(mocks.update).not.toHaveBeenCalled();
        expect(result.cleaned).toBe(false);
    });

    it('should delete stripeId if Stripe returns deleted: true', async () => {
        // Mock Firestore finding the ID
        mocks.get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ stripeId: 'cus_test123' })
        });

        mocks.retrieve.mockResolvedValue({ id: 'cus_test123', deleted: true });

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;
        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };

        expect(mocks.update).toHaveBeenCalledWith({
            stripeId: 'DELETE_FIELD_SENTINEL',
            stripeLink: 'DELETE_FIELD_SENTINEL'
        });
        expect(result.cleaned).toBe(true);
    });

    it('should delete stripeId if Stripe throws resource_missing', async () => {
        // Mock Firestore finding the ID
        mocks.get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ stripeId: 'cus_test123' })
        });

        const error = Object.assign(new Error('No such customer'), { code: 'resource_missing' });
        mocks.retrieve.mockRejectedValue(error);

        const handler = cleanupStripeCustomer as unknown as (req: CallableRequest) => Promise<any>;

        const result = await handler(mockRequest) as { success: boolean; message?: string; cleaned?: boolean };
        expect(result.cleaned).toBe(true);
        expect(mocks.update).toHaveBeenCalled();
    });
});
