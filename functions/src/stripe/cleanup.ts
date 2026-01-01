import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import type Stripe from 'stripe';

// Lazy load Stripe to avoid cold start penalties if not needed
let stripeInstance: Stripe | undefined;

async function getStripe() {
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

export const cleanupStripeCustomer = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    minInstances: 0,
    maxInstances: 10,
    // secrets: ['STRIPE_API_KEY'] // Using process.env from .env file instead
}, async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const userRef = db.collection('customers').doc(uid);

    try {
        // 2. Get current Stripe ID
        const docSnap = await userRef.get();
        if (!docSnap.exists) {
            return { success: false, message: 'No customer record found.' };
        }

        const data = docSnap.data();
        const stripeId = data?.stripeId;

        if (!stripeId) {
            return { success: true, message: 'No Stripe ID to cleanup.' };
        }

        // 3. Check Stripe API
        const stripe = await getStripe();
        let customerDeleted = false;

        try {
            const customer = await stripe.customers.retrieve(stripeId);
            if (customer.deleted) {
                customerDeleted = true;
                logger.info(`Stripe customer ${stripeId} for user ${uid} is marked as deleted.`);
            }
        } catch (error) {
            // "resource_missing" means the ID doesn't exist at all
            if ((error as any).code === 'resource_missing') {
                customerDeleted = true;
                logger.info(`Stripe customer ${stripeId} for user ${uid} does not exist.`);
            } else {
                logger.error('Error retrieving Stripe customer:', error);
                throw new HttpsError('internal', 'Failed to verify Stripe customer.');
            }
        }

        // 4. Cleanup if deleted
        if (customerDeleted) {
            await userRef.update({
                stripeId: admin.firestore.FieldValue.delete(),
                stripeLink: admin.firestore.FieldValue.delete()
            });
            logger.info(`Successfully cleaned up stale Stripe ID for user ${uid}.`);
            return { success: true, cleaned: true };
        }

        return { success: true, cleaned: false, message: 'Customer exists and is active.' };

    } catch (error) {
        logger.error('cleanupStripeCustomer error:', error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'Cleanup process failed.');
    }
});
