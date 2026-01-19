/**
 * @fileoverview Stripe Cleanup Module
 *
 * Provides functions for cleaning up stale or orphaned Stripe data from Firestore.
 * This module helps maintain data consistency between the Stripe API and the local
 * Firestore database.
 *
 * ## Use Cases
 * - **Stale Customer References**: When a Stripe customer is deleted externally
 * - **Data Sync Issues**: When webhook events are missed or fail to process
 * - **Account Recovery**: When users need to re-link their Stripe account
 *
 * ## Related Collections
 * - `customers/{uid}` - Contains `stripeId` and `stripeLink` fields
 * - `customers/{uid}/subscriptions/{id}` - Subscription documents (managed by extension)
 *
 * @module stripe/cleanup
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { enforceAppCheck } from '../utils';
import { getStripe } from './client';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

/**
 * Cloud Function: cleanupStripeCustomer
 *
 * Cleans up stale or orphaned Stripe customer references from Firestore.
 *
 * This function is designed to handle scenarios where a Stripe customer has been
 * deleted from Stripe (either manually via the Stripe Dashboard, via API, or through
 * Stripe's automatic cleanup processes) but the reference to that customer still
 * exists in the Firestore `customers` collection. This can happen when:
 *   - A customer is deleted directly in Stripe without updating Firestore
 *   - Stripe deletes a customer due to fraud detection or policy violations
 *   - Data synchronization issues between Stripe webhooks and Firestore
 *
 * ## Authentication
 * - **Required**: The caller must be authenticated via Firebase Auth
 * - The function uses the authenticated user's UID to look up their customer record
 * - Throws `unauthenticated` error if called without valid authentication
 *
 * ## Process Flow
 * 1. **Authentication Check**: Validates that the request is from an authenticated user
 * 2. **Firestore Lookup**: Retrieves the customer document from `customers/{uid}`
 * 3. **Stripe Verification**: Calls Stripe API to check if the customer still exists
 * 4. **Cleanup (if needed)**: Removes `stripeId` and `stripeLink` fields if customer
 *    is deleted in Stripe
 *
 * ## Return Values
 * - `{ success: false, message: 'No customer record found.' }` - No Firestore document exists
 * - `{ success: true, message: 'No Stripe ID to cleanup.' }` - Document exists but has no stripeId
 * - `{ success: true, cleaned: true }` - Stale Stripe ID was found and removed
 * - `{ success: true, cleaned: false, message: 'Customer exists and is active.' }` - Customer is valid
 *
 * ## Error Handling
 * - Throws `HttpsError('unauthenticated')` if not authenticated
 * - Throws `HttpsError('internal')` if Stripe API call fails (except for resource_missing)
 * - Throws `HttpsError('internal')` for any other unexpected errors
 *
 * @see {@link https://stripe.com/docs/api/customers/retrieve} Stripe Customer Retrieve API
 */
export const cleanupStripeCustomer = onCall({

    region: FUNCTIONS_MANIFEST.cleanupStripeCustomer.region,
    cors: true,
    minInstances: 0,
    maxInstances: 10,
    // secrets: ['STRIPE_API_KEY'] // Using process.env from .env file instead
}, async (request) => {
    // 1. Auth Check
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

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
