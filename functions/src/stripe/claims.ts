/**
 * @fileoverview Stripe Claims Management Module
 *
 * Manages the synchronization between Stripe subscription states and Firebase Auth
 * custom claims. This module is critical for implementing role-based access control
 * (RBAC) based on the user's subscription tier.
 *
 * ## Core Concepts
 * - **Custom Claims**: Firebase Auth allows attaching metadata (claims) to users that
 *   can be read on both client and server. This module sets `stripeRole` claims.
 * - **Subscription Roles**: Subscription tiers (e.g., 'free', 'basic', 'pro') are
 *   stored as `role` in subscription metadata and propagated to custom claims.
 * - **Customer Linking**: Associates Stripe customer IDs with Firebase user UIDs
 *   to enable subscription lookups.
 *
 * ## Exported Functions
 * - `restoreUserClaims` - Callable function for users to refresh their claims
 * - `reconcileClaims` - Core logic to sync subscription state to claims
 * - `linkExistingStripeCustomer` - Links pre-existing Stripe customers to Firebase users
 *
 * ## Data Flow
 * ```
 * Stripe Customer → Firestore customers/{uid} → reconcileClaims() → Firebase Auth Claims
 *                          ↓
 *                   subscriptions/{id}
 * ```
 *
 * @module stripe/claims
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import { getStripe } from './client';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

/**
 * Result of attempting to find and link a Stripe customer by email.
 *
 * @property found - Whether a Stripe customer with an active subscription was found
 * @property role - The subscription role (e.g., 'basic', 'pro') if found
 * @property customerId - The Stripe customer ID (e.g., 'cus_xxx') if found
 */
interface LinkResult {
    found: boolean;
    role?: string;
    customerId?: string;
}

/**
 * Searches Stripe for a customer with the given email that has an active subscription,
 * then links that customer to the Firebase user and sets appropriate claims.
 *
 * This is a shared helper used by both `reconcileClaims` (as a fallback) and
 * `linkExistingStripeCustomer` (as the primary lookup method).
 *
 * ## Use Cases
 * 1. **Account Migration**: User had a Stripe subscription before Firebase Auth account existed
 * 2. **Email Matching**: User signed up with the same email used for a previous subscription
 * 3. **Claims Recovery**: User's custom claims were cleared but subscription still exists in Stripe
 *
 * ## Process Flow
 * 1. Search Stripe for customers matching the email (handles duplicates, up to 10 results)
 * 2. For each customer found, check for active subscriptions
 * 3. If active subscription found:
 *    - Link customer ID to Firestore `customers/{uid}` document
 *    - Extract role from subscription or product metadata
 *    - Set `stripeRole` custom claim on Firebase Auth user
 *
 * ## Role Resolution Priority
 * 1. `subscription.metadata.role`
 * 2. `subscription.metadata.firebaseRole`
 * 3. `product.metadata.role`
 * 4. `product.metadata.firebaseRole`
 *
 * @param uid - Firebase user ID to link the customer to
 * @param email - Email address to search for in Stripe
 * @param user - Firebase Auth user record (used to preserve existing claims)
 * @returns Promise resolving to LinkResult indicating success and the linked role
 *
 * @internal This is a helper function, not directly exported
 */
async function findAndLinkStripeCustomerByEmail(
    uid: string,
    email: string,
    user: admin.auth.UserRecord
): Promise<LinkResult> {
    const db = admin.firestore();
    const stripe = await getStripe();

    // Search for existing customers with this email
    const customers = await stripe.customers.search({
        query: `email:'${email}'`,
        limit: 10 // Get multiple in case there are duplicates
    });

    if (customers.data.length === 0) {
        logger.info(`[findAndLinkStripeCustomerByEmail] No Stripe customer found for email ${email}`);
        return { found: false };
    }

    // Find a customer with an active subscription
    for (const customer of customers.data) {
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1
        });

        if (subscriptions.data.length > 0) {
            const sub = subscriptions.data[0];
            logger.info(`[findAndLinkStripeCustomerByEmail] Found subscription ${sub.id} for customer ${customer.id}`);

            // Link this customer to the Firebase user and sync basic details immediately
            await db.collection('customers').doc(uid).set({
                stripeId: customer.id,
                stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`,
                email: customer.email,
                name: customer.name ?? undefined,
                phone: customer.phone ?? undefined
            }, { merge: true });

            // Update Stripe Customer metadata with new Firebase UID
            await stripe.customers.update(customer.id, {
                metadata: {
                    linkedAt: Date.now().toString(),
                    linkedToUid: uid,
                    firebaseUID: uid // Ensure this matches the new user
                }
            });
            logger.info(`[findAndLinkStripeCustomerByEmail] Updated Stripe customer ${customer.id} metadata.firebaseUID to ${uid}`);

            // Trigger a subscription.updated webhook by updating subscription metadata
            // Also update the firebaseUID in the subscription metadata to match the new user
            // This causes the extension to sync the subscription to the new user's Firestore path
            await stripe.subscriptions.update(sub.id, {
                metadata: {
                    linkedAt: Date.now().toString(),
                    linkedToUid: uid,
                    firebaseUID: uid // Ensure this matches the new user
                }
            });
            logger.info(`[findAndLinkStripeCustomerByEmail] Triggered subscription.updated webhook for ${sub.id}`);

            // Determine the role from subscription or product metadata
            let role = sub.metadata?.role || sub.metadata?.firebaseRole;

            if (!role) {
                // Fetch product to get role
                const priceItem = sub.items.data[0];
                if (priceItem?.price?.product) {
                    const productId = typeof priceItem.price.product === 'string'
                        ? priceItem.price.product
                        : priceItem.price.product.id;

                    const product = await stripe.products.retrieve(productId);
                    role = product.metadata?.role || product.metadata?.firebaseRole;
                }
            }

            if (role) {
                // Set claims
                const existingClaims = user.customClaims || {};
                await admin.auth().setCustomUserClaims(uid, {
                    ...existingClaims,
                    stripeRole: role
                });

                logger.info(`[findAndLinkStripeCustomerByEmail] Linked customer ${customer.id} to user ${uid} with role ${role}`);
                return { found: true, role, customerId: customer.id };
            }
        }
    }

    logger.info(`[findAndLinkStripeCustomerByEmail] No active subscription found for email ${email}`);
    return { found: false };
}


/**
 * Cloud Function: restoreUserClaims
 *
 * Allows authenticated users to refresh their Firebase Auth custom claims based on
 * their current Stripe subscription status. This is typically called after:
 * - Logging in on a new device
 * - Claims expiring or being cleared
 * - Subscription changes not reflected in the UI
 *
 * ## Authentication
 * - **Required**: Must be called by an authenticated Firebase user
 * - The function uses the caller's UID to look up their subscription
 *
 * ## Return Values
 * - `{ success: true, role: 'pro' }` - Claims successfully restored with the given role
 *
 * ## Error Handling
 * - Throws `HttpsError('unauthenticated')` if not authenticated
 * - Throws `HttpsError('not-found')` if no active subscription exists
 * - Throws `HttpsError('internal')` for unexpected errors
 *
 * @see reconcileClaims - The underlying function that performs the claim sync
 */
export const restoreUserClaims = onCall({
    region: FUNCTIONS_MANIFEST.restoreUserClaims.region,
    cors: ALLOWED_CORS_ORIGINS
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    if (!request.app) {
        throw new HttpsError('failed-precondition', 'The function must be called from an App Check verified app.');
    }

    try {
        const { role } = await reconcileClaims(request.auth.uid);
        return { success: true, role };
    } catch (error: unknown) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', (error as Error).message || 'Failed to reconcile claims');
    }
});

/**
 * Reconciles the user's Stripe subscription status with their Firebase Auth custom claims.
 *
 * This is the core function that ensures a user's `stripeRole` claim accurately reflects
 * their subscription status. It's called by:
 * - `restoreUserClaims` callable function
 * - `onSubscriptionUpdated` Firestore trigger
 *
 * ## Lookup Strategy
 * 1. **Primary**: Query Firestore `customers/{uid}/subscriptions` for active/trialing subscriptions
 * 2. **Fallback**: If no local subscription, search Stripe API by user's email address
 *
 * ## Claim Preservation
 * When setting the `stripeRole` claim, existing custom claims are preserved. Only the
 * `stripeRole` property is updated, leaving other claims intact.
 *
 * ## Process Flow
 * ```
 * Firestore Query → Found? → Extract role → Set claims
 *       ↓ (empty)
 * Stripe Email Search → Found? → Link customer → Set claims
 *       ↓ (not found)
 * Throw 'not-found' error
 * ```
 *
 * @param uid - Firebase user ID to reconcile claims for
 * @returns Promise resolving to `{ role: string }` with the user's subscription role
 *
 * @throws HttpsError('not-found') - No active subscription found in Firestore or Stripe
 * @throws HttpsError('failed-precondition') - Subscription exists but has no role defined
 *
 * @example
 * ```typescript
 * try {
 *     const { role } = await reconcileClaims('user123');
 *     console.log(`User has role: ${role}`);
 * } catch (e) {
 *     if (e.code === 'not-found') {
 *         console.log('User has no active subscription');
 *     }
 * }
 * ```
 */
export async function reconcileClaims(uid: string): Promise<{ role: string }> {
    const db = admin.firestore();
    const subscriptionsRef = db.collection(`customers/${uid}/subscriptions`);

    // Check for any active or trialing subscription
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        // Fallback: Check if the user exists in Stripe by email
        logger.info(`[reconcileClaims] No local subscription found for ${uid}. Checking Stripe by email...`);

        const user = await admin.auth().getUser(uid);
        if (user.email) {
            const result = await findAndLinkStripeCustomerByEmail(uid, user.email, user);
            if (result.found && result.role) {
                return { role: result.role };
            }
        }

        throw new HttpsError('not-found', 'No active subscription found.');
    }

    const subData = snapshot.docs[0].data();
    const role = subData.role;

    logger.info(`[reconcileClaims] Metadata check - role: ${subData.role}`);

    if (!role) {
        throw new HttpsError('failed-precondition', 'Subscription found but no role defined in document.');
    }

    // Set custom user claims
    logger.info(`[reconcileClaims] Setting claims for user ${uid} to role: ${role}`);
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};

    await admin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        stripeRole: role
    });

    // Semantic update: Signal that claims have been updated so the client can refresh
    await db.doc(`users/${uid}/system/status`).set({
        claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { role };
}

/**
 * Cloud Function: linkExistingStripeCustomer
 *
 * Checks if the authenticated user has an existing Stripe customer (by email) with an
 * active subscription. If found, links that customer to the Firebase user and sets
 * their custom claims.
 *
 * ## Purpose
 * This function prevents duplicate subscriptions by checking if a user already has a
 * Stripe subscription before they go through the checkout flow. Common scenarios:
 * - User previously subscribed via a different authentication method
 * - User deleted and recreated their Firebase account
 * - User's email was added to a subscription by an admin
 *
 * ## When to Call
 * - **Before checkout**: Call this before redirecting to Stripe Checkout
 * - **On login**: Optionally call after user logs in to restore subscription access
 *
 * ## Authentication
 * - **Required**: Must be called by an authenticated Firebase user
 * - Requires the user to have an email address on their Firebase account
 *
 * ## Return Values
 * - `{ linked: true, role: 'pro' }` - Found and linked an existing subscription
 * - `{ linked: false }` - No existing subscription found, safe to proceed with checkout
 *
 * ## Error Handling
 * - Throws `HttpsError('unauthenticated')` if not authenticated
 * - Throws `HttpsError('internal')` for Stripe API or other unexpected errors
 *
 * @see findAndLinkStripeCustomerByEmail - The underlying helper that performs the lookup
 */
export const linkExistingStripeCustomer = onCall({
    region: FUNCTIONS_MANIFEST.linkExistingStripeCustomer.region,
    cors: ALLOWED_CORS_ORIGINS
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    if (!request.app) {
        throw new HttpsError('failed-precondition', 'The function must be called from an App Check verified app.');
    }

    const uid = request.auth.uid;

    try {
        const user = await admin.auth().getUser(uid);
        if (!user.email) {
            logger.info(`[linkExistingStripeCustomer] User ${uid} has no email, cannot search Stripe.`);
            return { linked: false };
        }

        const result = await findAndLinkStripeCustomerByEmail(uid, user.email, user);

        if (result.found && result.role) {
            return { linked: true, role: result.role };
        }

        return { linked: false };
    } catch (error: unknown) {
        logger.error('[linkExistingStripeCustomer] Error:', error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', (error as Error).message || 'Failed to check for existing subscription');
    }
});
