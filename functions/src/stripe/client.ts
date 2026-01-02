import type Stripe from 'stripe';

// Lazy load Stripe to avoid cold start penalties if not needed
let stripeInstance: Stripe | undefined;

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

// Helper for testing to inject mock
export function setStripeInstanceForTesting(instance: unknown) {
    stripeInstance = instance as Stripe;
}
