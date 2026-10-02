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
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import { getStripe } from './client';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import type Stripe from 'stripe';

const USER_DELETION_TOMBSTONES_COLLECTION = 'userDeletionTombstones';

const getTimestampMillis = (value: unknown): number | null => {
    if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis();
    }

    return null;
};

const hasActiveDeletionMarker = async (
    deletionMarkerRef: admin.firestore.DocumentReference,
    uid: string,
    logContext: string
): Promise<boolean> => {
    const markerDoc = await deletionMarkerRef.get();
    if (!markerDoc.exists) {
        return false;
    }

    const expireAtMs = getTimestampMillis(markerDoc.data()?.expireAt);
    if (expireAtMs !== null && expireAtMs <= Date.now()) {
        try {
            await deletionMarkerRef.delete();
            logger.info(`[${logContext}] Removed expired user deletion marker for ${uid}.`);
        } catch (error) {
            logger.warn(`[${logContext}] Failed to remove expired user deletion marker for ${uid}. Continuing.`, error);
        }
        return false;
    }

    logger.warn(`[${logContext}] User ${uid} is marked for deletion. Skipping claim reconciliation.`);
    return true;
};

/**
 * Result of attempting to recover a bound customer or link one by verified email.
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
 * Recovers the caller's server-bound Stripe customer, or searches by verified email,
 * then links an eligible active subscription and sets appropriate claims.
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
 * 1. Retrieve the server-bound customer ID, or search by a verified server Auth email
 * 2. Check active subscriptions and reject conflicting UID metadata
 * 3. If a role can be resolved:
 *    - Atomically check existing ownership and link Firestore `customers/{uid}`
 *    - Update Stripe metadata for the same UID
 *    - Set `stripeRole` custom claim on Firebase Auth user
 *
 * ## Role Resolution Priority
 * 1. Purchased product's `metadata.firebaseRole` (the extension's authority)
 * 2. Purchased product's legacy `metadata.role`
 * Subscription metadata is supplied by checkout clients and cannot grant access.
 *
 * @param uid - Firebase user ID to link the customer to
 * @param user - Server Auth record (verified email and existing claims)
 * @returns Promise resolving to LinkResult indicating success and the linked role
 *
 * @internal This is a helper function, not directly exported
 */
async function findAndLinkStripeCustomer(
    uid: string,
    user: admin.auth.UserRecord
): Promise<LinkResult> {
    const db = admin.firestore();
    const customerRef = db.collection('customers').doc(uid);
    // This binding is server-owned: clients cannot write customers/{uid}.stripeId.
    const stripeId = (await customerRef.get()).data()?.stripeId;
    const boundStripeId = typeof stripeId === 'string' && stripeId ? stripeId : undefined;
    const email = user.email;

    // Existing UID ownership does not depend on email. Only acquiring a customer
    // through email matching requires Firebase to have verified the mailbox.
    if (!boundStripeId && (!email || user.emailVerified !== true)) {
        logger.info(`[findAndLinkStripeCustomer] Skipping email recovery for unverified user ${uid}`);
        return { found: false };
    }

    const stripe = await getStripe();
    const belongsToAnotherUser = (metadata?: Record<string, string>): boolean =>
        [metadata?.firebaseUID, metadata?.linkedToUid].some(owner => !!owner && owner !== uid);

    let customers: Stripe.Customer[];
    if (boundStripeId) {
        try {
            const customer = await stripe.customers.retrieve(boundStripeId);
            if (customer.deleted) {
                return { found: false };
            }
            customers = [customer];
        } catch (error) {
            if ((error as { code?: unknown } | null)?.code === 'resource_missing') {
                return { found: false };
            }
            throw error;
        }
    } else {
        const result = await stripe.customers.search({
            query: `email:'${email}'`,
            limit: 10 // Get multiple in case there are duplicates
        });
        customers = result.data;
    }

    if (customers.length === 0) {
        logger.info(`[findAndLinkStripeCustomer] No Stripe customer found for email ${email}`);
        return { found: false };
    }

    // Find a customer with an active subscription
    for (const customer of customers) {
        const matchesCaller = boundStripeId
            ? customer.id === boundStripeId
            : !!email && customer.email?.toLowerCase() === email.toLowerCase();
        if (!matchesCaller || belongsToAnotherUser(customer.metadata)) {
            continue;
        }

        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1
        });

        if (subscriptions.data.length > 0) {
            const sub = subscriptions.data[0];
            if (belongsToAnotherUser(sub.metadata)) {
                continue;
            }
            logger.info(`[findAndLinkStripeCustomer] Found subscription ${sub.id} for customer ${customer.id}`);

            // Checkout clients supply subscription metadata. Resolve access from the
            // purchased product before changing ownership, matching the extension.
            const priceItem = sub.items.data[0];
            if (!priceItem?.price?.product) {
                continue;
            }
            const productId = typeof priceItem.price.product === 'string'
                ? priceItem.price.product
                : priceItem.price.product.id;
            const product = await stripe.products.retrieve(productId);
            const role = product.metadata?.firebaseRole || product.metadata?.role;
            if (role !== 'free' && role !== 'basic' && role !== 'pro') {
                continue;
            }

            // Checking and writing in one transaction prevents competing recovery requests
            // from binding the same customer to different UIDs. Never transfer an existing owner.
            const ownersQuery = db.collection('customers').where('stripeId', '==', customer.id);
            const linked = await db.runTransaction(async transaction => {
                const [currentCustomer, owners, deletionGuard] = await Promise.all([
                    transaction.get(customerRef),
                    transaction.get(ownersQuery),
                    getUserDeletionGuardStateInTransaction(db, transaction, uid)
                ]);
                const currentStripeId = currentCustomer.data()?.stripeId;
                if (deletionGuard.shouldSkip
                    || (boundStripeId && currentStripeId !== boundStripeId)
                    || (currentStripeId && currentStripeId !== customer.id)
                    || owners.docs.some(owner => owner.id !== uid)) {
                    return false;
                }

                transaction.set(customerRef, {
                    stripeId: customer.id,
                    stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`,
                    email: customer.email,
                    name: customer.name ?? undefined,
                    phone: customer.phone ?? undefined
                }, { merge: true });
                return true;
            });
            if (!linked) {
                continue;
            }

            // Update Stripe Customer metadata with new Firebase UID
            await stripe.customers.update(customer.id, {
                metadata: {
                    linkedAt: Date.now().toString(),
                    linkedToUid: uid,
                    firebaseUID: uid // Ensure this matches the new user
                }
            });
            logger.info(`[findAndLinkStripeCustomer] Updated Stripe customer ${customer.id} metadata.firebaseUID to ${uid}`);

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
            logger.info(`[findAndLinkStripeCustomer] Triggered subscription.updated webhook for ${sub.id}`);

            const existingClaims = user.customClaims || {};
            await admin.auth().setCustomUserClaims(uid, {
                ...existingClaims,
                stripeRole: role
            });

            logger.info(`[findAndLinkStripeCustomer] Linked customer ${customer.id} to user ${uid} with role ${role}`);
            return { found: true, role, customerId: customer.id };
        }
    }

    logger.info(`[findAndLinkStripeCustomer] No recoverable active subscription found for user ${uid}`);
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
    secrets: FUNCTION_SECRET_BINDINGS.restoreUserClaims,
    cors: ALLOWED_CORS_ORIGINS
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

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
 * 2. **Fallback**: Retrieve the server-bound Stripe customer, or search by verified email
 *
 * ## Claim Preservation
 * When setting the `stripeRole` claim, existing custom claims are preserved. Only the
 * `stripeRole` property is updated, leaving other claims intact.
 *
 * ## Process Flow
 * ```
 * Firestore Query → Found? → Extract role → Set claims
 *       ↓ (empty)
 * Stripe Bound ID / Verified Email → Found? → Link customer → Set claims
 *       ↓ (not found)
 * Set role to 'free' and preserve applicable grace claims
 * ```
 *
 * @param uid - Firebase user ID to reconcile claims for
 * @returns Promise resolving to `{ role: string }` with the user's subscription role
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
    const userDocRef = db.doc(`users/${uid}`);
    const deletionMarkerRef = db.collection(USER_DELETION_TOMBSTONES_COLLECTION).doc(uid);
    const subscriptionsRef = db.collection(`customers/${uid}/subscriptions`);
    const systemStatusRef = db.doc(`users/${uid}/system/status`);

    let role = 'free';
    let hasUserDocument = false;

    if (await hasActiveDeletionMarker(deletionMarkerRef, uid, 'reconcileClaims')) {
        return { role };
    }

    try {
        const userDoc = await userDocRef.get();
        hasUserDocument = userDoc.exists;
    } catch (error) {
        logger.error(`[reconcileClaims] Failed to load users/${uid} root document.`, error);
        throw error;
    }

    if (!hasUserDocument) {
        logger.error(`[reconcileClaims] users/${uid} is missing. Skipping users/${uid}/system/status reads/writes to avoid orphan recreation.`, {
            uid,
            guard: 'missing-user-root'
        });
    }

    // Check for any active or trialing subscription
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (!snapshot.empty) {
        const subData = snapshot.docs[0].data();
        role = subData.role || 'free';
        logger.info(`[reconcileClaims] Local subscription found for ${uid}. Role: ${role}`);
    } else {
        // Fallback: Recover the server-bound customer, or match a verified email.
        logger.info(`[reconcileClaims] No local subscription found for ${uid}. Checking Stripe...`);

        if (await hasActiveDeletionMarker(deletionMarkerRef, uid, 'reconcileClaims')) {
            return { role };
        }

        const user = await admin.auth().getUser(uid);
        const result = await findAndLinkStripeCustomer(uid, user);
        if (result.found && result.role) {
            role = result.role;
        }
    }

    // Set custom user claims
    logger.info(`[reconcileClaims] Updating claims for user ${uid}. Final role: ${role}`);

    if (await hasActiveDeletionMarker(deletionMarkerRef, uid, 'reconcileClaims')) {
        return { role };
    }

    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};

    let gracePeriodUntil: number | undefined;
    if (hasUserDocument) {
        try {
            // Check for grace period in system status
            const systemDoc = await systemStatusRef.get();
            const systemData = systemDoc.data();
            gracePeriodUntil = systemData?.gracePeriodUntil ? Math.floor(systemData.gracePeriodUntil.toMillis()) : undefined;
        } catch (error) {
            logger.error(`[reconcileClaims] Failed to read users/${uid}/system/status while reconciling claims.`, error);
            throw error;
        }
    }

    const newClaims = {
        ...existingClaims,
        stripeRole: role,
    };

    if (gracePeriodUntil) {
        (newClaims as any).gracePeriodUntil = gracePeriodUntil;
    } else {
        delete (newClaims as any).gracePeriodUntil;
    }

    await admin.auth().setCustomUserClaims(uid, newClaims);

    if (hasUserDocument) {
        try {
            // Semantic update: signal that claims have been updated so the client can refresh,
            // but avoid recreating users/{uid}/system/status once account deletion has started.
            const didWriteClaimsUpdateSignal = await db.runTransaction(async (transaction) => {
                const [latestDeletionMarkerDoc, latestUserDoc] = await Promise.all([
                    transaction.get(deletionMarkerRef),
                    transaction.get(userDocRef)
                ]);

                if (!latestUserDoc.exists) {
                    return false;
                }

                if (latestDeletionMarkerDoc.exists) {
                    const expireAtMs = getTimestampMillis(latestDeletionMarkerDoc.data()?.expireAt);
                    if (expireAtMs !== null && expireAtMs <= Date.now()) {
                        transaction.delete(deletionMarkerRef);
                    } else {
                        return false;
                    }
                }

                transaction.set(systemStatusRef, {
                    claimsUpdatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                return true;
            });

            if (!didWriteClaimsUpdateSignal) {
                logger.info(`[reconcileClaims] Skipping users/${uid}/system/status.claimsUpdatedAt because deletion is in progress or the user root is missing.`);
            }
        } catch (error) {
            logger.error(`[reconcileClaims] Failed to write users/${uid}/system/status.claimsUpdatedAt.`, error);
            throw error;
        }
    }

    return { role };
}

/**
 * Cloud Function: linkExistingStripeCustomer
 *
 * Checks if the authenticated user has a bound Stripe customer or a verified email match with an
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
 * - Email-based acquisition requires a verified email on the Firebase account
 *
 * ## Return Values
 * - `{ linked: true, role: 'pro' }` - Found and linked an existing subscription
 * - `{ linked: false }` - No existing subscription found, safe to proceed with checkout
 *
 * ## Error Handling
 * - Throws `HttpsError('unauthenticated')` if not authenticated
 * - Throws `HttpsError('internal')` for Stripe API or other unexpected errors
 *
 * @see findAndLinkStripeCustomer - The underlying helper that performs the lookup
 */
export const linkExistingStripeCustomer = onCall({
    region: FUNCTIONS_MANIFEST.linkExistingStripeCustomer.region,
    secrets: FUNCTION_SECRET_BINDINGS.linkExistingStripeCustomer,
    cors: ALLOWED_CORS_ORIGINS,
    memory: '512MiB',
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const uid = request.auth.uid;

    try {
        const user = await admin.auth().getUser(uid);
        const result = await findAndLinkStripeCustomer(uid, user);

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
