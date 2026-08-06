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
 * The client reads `STRIPE_SECRET_KEY`, which deployed Functions receive only
 * when their declaration binds the matching Secret Manager parameter.
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
 * @throws Error if `STRIPE_SECRET_KEY` is not available to the invocation
 *
 * @example
 * ```typescript
 * const stripe = await getStripe();
 * const customers = await stripe.customers.list({ limit: 10 });
 * ```
 */
export async function getStripe() {
    if (!stripeInstance) {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
            throw new Error('STRIPE_SECRET_KEY is unavailable to this Function invocation.');
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
