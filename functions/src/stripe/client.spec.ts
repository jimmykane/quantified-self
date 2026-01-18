import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// 1. Mock the 'stripe' library before importing the module under test 
vi.mock('stripe', () => {
    return {
        default: class MockStripe {
            constructor(apiKey: string, config: any) {
                (this as any).apiKey = apiKey;
                (this as any).config = config;
            }
        }
    };
});

// Import after mocking
import { getStripe, setStripeInstanceForTesting } from './client';

describe('Stripe Client', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks(); // Clear mocks
        process.env = { ...originalEnv }; // Reset env vars
        // Reset singleton (important for isolation!)
        setStripeInstanceForTesting(undefined);
        // We also need to manually reset the lazily loaded module's internal state if we couldn't use setStripeInstanceForTesting, 
        // but luckily the module exports a setter specifically for this.
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should throw an error if no API key is provided', async () => {
        delete process.env.STRIPE_API_KEY;
        delete process.env.STRIPE_SECRET_KEY;

        await expect(getStripe()).rejects.toThrow('Stripe API Key is missing. Check environment variables.');
    });

    it('should initialize Stripe with STRIPE_API_KEY', async () => {
        process.env.STRIPE_API_KEY = 'sk_test_123';

        const stripe = await getStripe();
        expect(stripe).toBeDefined();
        // Since we blindly mocked the class, we can check properties if we exposed them 
        // or just rely on the fact that constructor didn't throw and returned our mock instance.
        expect((stripe as any).apiKey).toBe('sk_test_123');
        expect((stripe as any).config).toEqual({ apiVersion: '2024-04-10' });
    });

    it('should initialize Stripe with STRIPE_SECRET_KEY fallback', async () => {
        delete process.env.STRIPE_API_KEY;
        process.env.STRIPE_SECRET_KEY = 'sk_test_fallback';

        const stripe = await getStripe();
        expect((stripe as any).apiKey).toBe('sk_test_fallback');
    });

    it('should return a singleton instance', async () => {
        process.env.STRIPE_API_KEY = 'sk_test_singleton';

        const instance1 = await getStripe();
        const instance2 = await getStripe();

        expect(instance1).toBe(instance2);
        expect((instance1 as any).apiKey).toBe('sk_test_singleton');
    });

    it('should allow injecting a mock instance for testing', async () => {
        const mockInstance = { mock: true } as any;
        setStripeInstanceForTesting(mockInstance);

        const instance = await getStripe();
        expect(instance).toBe(mockInstance);

        // Should ignore env vars regarding missing key if instance is already set
        delete process.env.STRIPE_API_KEY;
        await expect(getStripe()).resolves.toBe(mockInstance);
    });
});
