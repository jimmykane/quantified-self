import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// 1. Mock the 'stripe' library before importing the module under test 
vi.mock('stripe', () => {
    return {
        default: class MockStripe {
            readonly apiKey: string;
            readonly config: { apiVersion: string };

            constructor(apiKey: string, config: { apiVersion: string }) {
                this.apiKey = apiKey;
                this.config = config;
            }
        }
    };
});

// Import after mocking
import {
    getAdminBillingStripe,
    getStripe,
    setAdminBillingStripeInstanceForTesting,
    setStripeInstanceForTesting,
    STRIPE_API_VERSION,
} from './client';

interface MockStripeClientShape {
    apiKey: string;
    config: { apiVersion: string };
}

function asMockStripeClient(value: unknown): MockStripeClientShape {
    return value as MockStripeClientShape;
}

describe('Stripe Client', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks(); // Clear mocks
        process.env = { ...originalEnv }; // Reset env vars
        // Reset singleton (important for isolation!)
        setStripeInstanceForTesting(undefined);
        setAdminBillingStripeInstanceForTesting(undefined);
        // We also need to manually reset the lazily loaded module's internal state if we couldn't use setStripeInstanceForTesting, 
        // but luckily the module exports a setter specifically for this.
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should throw an error if no API key is provided', async () => {
        delete process.env.STRIPE_SECRET_KEY;

        await expect(getStripe()).rejects.toThrow('STRIPE_SECRET_KEY is unavailable to this Function invocation.');
    });

    it('should initialize Stripe with the bound STRIPE_SECRET_KEY', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_123';

        const stripe = await getStripe();
        expect(stripe).toBeDefined();
        // Since we blindly mocked the class, we can check properties if we exposed them 
        // or just rely on the fact that constructor didn't throw and returned our mock instance.
        expect(asMockStripeClient(stripe).apiKey).toBe('sk_test_123');
        expect(asMockStripeClient(stripe).config).toEqual({ apiVersion: STRIPE_API_VERSION });
    });

    it('should return a singleton instance', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_singleton';

        const instance1 = await getStripe();
        const instance2 = await getStripe();

        expect(instance1).toBe(instance2);
        expect(asMockStripeClient(instance1).apiKey).toBe('sk_test_singleton');
    });

    it('should allow injecting a mock instance for testing', async () => {
        const mockInstance = { mock: true } as unknown as Awaited<ReturnType<typeof getStripe>>;
        setStripeInstanceForTesting(mockInstance);

        const instance = await getStripe();
        expect(instance).toBe(mockInstance);

        // Should ignore env vars regarding missing key if instance is already set
        delete process.env.STRIPE_SECRET_KEY;
        await expect(getStripe()).resolves.toBe(mockInstance);
    });

    it('should initialize an independent admin client with the restricted billing key', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_general';
        process.env.STRIPE_ADMIN_BILLING_KEY = 'rk_test_admin_billing';

        const generalClient = await getStripe();
        const adminClient = await getAdminBillingStripe();

        expect(adminClient).not.toBe(generalClient);
        expect(asMockStripeClient(adminClient).apiKey).toBe('rk_test_admin_billing');
        expect(asMockStripeClient(adminClient).config).toEqual({ apiVersion: STRIPE_API_VERSION });
    });

    it('should fail closed when the restricted admin billing key is not bound', async () => {
        delete process.env.STRIPE_ADMIN_BILLING_KEY;

        await expect(getAdminBillingStripe()).rejects.toThrow(
            'STRIPE_ADMIN_BILLING_KEY is unavailable to this Function invocation.'
        );
    });
});
