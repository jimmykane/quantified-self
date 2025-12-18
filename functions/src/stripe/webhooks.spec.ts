import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

// Define the mock constructEvent outside so it can be controlled in tests
const mockConstructEvent = vi.fn();

// Mock stripe module
vi.mock('stripe', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            webhooks: {
                constructEvent: mockConstructEvent,
            },
        })),
    };
});

// Import the function to test
import { handleStripeWebhook } from './webhooks';

describe('handleStripeWebhook', () => {
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();

        process.env.STRIPE_WEBHOOK_SECRET = 'test_secret';
        process.env.STRIPE_API_KEY = 'test_key';

        mockReq = {
            headers: {
                'stripe-signature': 'test_sig',
            },
            rawBody: Buffer.from('{"id": "evt_123"}'),
        };

        mockRes = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    it('should return 400 if signature is missing', async () => {
        mockReq.headers = {};
        await (handleStripeWebhook as any)(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.send).toHaveBeenCalledWith('Webhook Error: Missing signature or secret');
    });

    it('should return 400 if Stripe event construction fails', async () => {
        mockConstructEvent.mockImplementation(() => {
            throw new Error('Verification failed');
        });

        await (handleStripeWebhook as any)(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.send).toHaveBeenCalledWith('Webhook Error: Verification failed');
    });

    it('should handle customer.deleted and clear user data', async () => {
        const mockStripeId = 'cus_123';
        const mockEvent = {
            type: 'customer.deleted',
            data: {
                object: {
                    id: mockStripeId,
                },
            },
        };

        mockConstructEvent.mockReturnValue(mockEvent);

        const mockUserDoc = {
            id: 'user_123',
            ref: {
                update: vi.fn().mockResolvedValue(true),
            },
        };

        const mockGet = vi.fn().mockResolvedValue({
            empty: false,
            docs: [mockUserDoc],
        });

        // Use the admin singleton mock from test-setup
        const mockFirestore = admin.firestore();
        const collectionSpy = vi.spyOn(mockFirestore, 'collection').mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: mockGet,
        } as any);

        await (handleStripeWebhook as any)(mockReq, mockRes);

        expect(collectionSpy).toHaveBeenCalledWith('customers');
        expect(mockGet).toHaveBeenCalled();
        expect(mockUserDoc.ref.update).toHaveBeenCalledWith({
            stripeId: expect.anything(),
            stripeLink: expect.anything(),
        });
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle customer.deleted when user is not found', async () => {
        const mockStripeId = 'cus_456';
        const mockEvent = {
            type: 'customer.deleted',
            data: {
                object: {
                    id: mockStripeId,
                },
            },
        };

        mockConstructEvent.mockReturnValue(mockEvent);

        const mockGet = vi.fn().mockResolvedValue({
            empty: true,
        });

        const mockFirestore = admin.firestore();
        vi.spyOn(mockFirestore, 'collection').mockReturnValue({
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: mockGet,
        } as any);

        await (handleStripeWebhook as any)(mockReq, mockRes);

        expect(mockGet).toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 200 for unhandled event types', async () => {
        const mockEvent = {
            type: 'invoice.paid',
        };

        mockConstructEvent.mockReturnValue(mockEvent);

        await (handleStripeWebhook as any)(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.send).toHaveBeenCalledWith({ received: true });
    });
});
