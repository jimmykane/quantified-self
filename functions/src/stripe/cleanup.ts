import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import { getStripe } from './client';

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
