/**
 * @fileoverview Stripe Client Module
 *
 * Provides a singleton Stripe client instance for use across all Stripe-related
 * Cloud Functions. Uses lazy initialization to minimize cold start latency for
 * functions that don't require Stripe API access.
 *
 * ## Architecture
 * - **Singleton Pattern**: A single Stripe instance is shared across all function invocations
 * - **Lazy Loading**: The Stripe SDK is only imported and initialized on first use
 * - **Dynamic Import**: Uses `await import('stripe')` to defer loading until needed
 *
 * ## Environment Variables
 * The client looks for the Stripe API key in the following order:
 * 1. `STRIPE_API_KEY` - Primary environment variable (set via `.env` or Secret Manager)
 * 2. `STRIPE_SECRET_KEY` - Fallback for alternative naming conventions
 *
 * ## Usage
 * ```typescript
 * import { getStripe } from './client';
 *
 * const stripe = await getStripe();
 * const customer = await stripe.customers.retrieve('cus_xxx');
 * ```
 *
 * @module stripe/client
 */

import type Stripe from 'stripe';

/**
 * Cached Stripe client instance.
 * Initialized lazily on first call to `getStripe()`.
 * @internal
 */
let stripeInstance: Stripe | undefined;

/**
 * Returns a configured Stripe client instance.
 *
 * This function implements lazy initialization - the Stripe SDK is only loaded
 * and the client is only created on the first invocation. Subsequent calls
 * return the cached instance, avoiding repeated initialization overhead.
 *
 * ## Cold Start Optimization
 * By deferring the Stripe SDK import until it's actually needed, functions that
 * don't use Stripe (like health checks or non-payment endpoints) avoid the
 * ~100-200ms overhead of loading the Stripe SDK.
 *
 * ## API Version
 * Currently configured to use Stripe API version `2024-04-10`. The version is
 * cast to `any` to avoid TypeScript strict version checking which may cause
 * issues when the types package is out of sync with the desired version.
 *
 * @returns A Promise resolving to the initialized Stripe client
 * @throws Error if neither `STRIPE_API_KEY` nor `STRIPE_SECRET_KEY` environment variable is set
 *
 * @example
 * ```typescript
 * const stripe = await getStripe();
 * const customers = await stripe.customers.list({ limit: 10 });
 * ```
 */
export async function getStripe() {
    if (!stripeInstance) {
        // Use the secret from environment or parameter store
        // Note: The extension usually stores it in specific secrets, but for shared usage
        // we might rely on process.env.STRIPE_API_KEY if available, or fetch it.
        // The standard extension installation puts the key in `firestore-stripe-payments-STRIPE_API_KEY`
        // which helper libraries might not auto-pick up unless we use the `stripe` package directly.
        // Let's try to load it from the defineSecret or fallback to standard env vars.

        // For simplicity and matching typical setups, we assume STRIPE_API_KEY is available 
        // via `process.env` if set in .env files or via Secret Manager if bound.
        // If your project uses the extension, the key is strictly inside the secret.

        // We will try to instantiate with the key.
        const stripeKey = process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
            throw new Error('Stripe API Key is missing. Check environment variables.');
        }

        const { default: Stripe } = await import('stripe');

        stripeInstance = new Stripe(stripeKey, {
            apiVersion: '2024-04-10' as any, // Cast to any to avoid strict version mismatch in some envs
        });
    }
    return stripeInstance as Stripe;
}

/**
 * Injects a mock Stripe instance for unit testing.
 *
 * This function allows test code to replace the Stripe client with a mock
 * implementation, enabling isolated testing of Stripe-dependent functions
 * without making actual API calls.
 *
 * ## Usage in Tests
 * ```typescript
 * import { setStripeInstanceForTesting } from './client';
 *
 * beforeEach(() => {
 *     const mockStripe = {
 *         customers: {
 *             retrieve: jest.fn().mockResolvedValue({ id: 'cus_test' }),
 *         },
 *     };
 *     setStripeInstanceForTesting(mockStripe);
 * });
 *
 * afterEach(() => {
 *     setStripeInstanceForTesting(undefined); // Reset for other tests
 * });
 * ```
 *
 * @param instance - The mock Stripe instance to use, or `undefined` to reset
 * @internal This function is intended for testing purposes only
 */
export function setStripeInstanceForTesting(instance: unknown) {
    stripeInstance = instance as Stripe;
}
