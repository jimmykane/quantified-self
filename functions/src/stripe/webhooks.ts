import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import Stripe from 'stripe';

/**
 * Handle Stripe webhook events.
 * Currently handles:
 * - customer.deleted: Clears stale stripeId from Firestore
 */
import { PRICE_TO_PLAN } from '../shared/pricing';

/**
 * Handle Stripe webhook events.
 * Currently handles:
 * - customer.deleted: Clears stale stripeId from Firestore
 * - customer.subscription.created/updated: Enforce role mapping from PRICE_TO_PLAN
 */
export const handleStripeWebhook = onRequest({
    region: 'europe-west3', // Align with existing extension location
    secrets: ['firestore-stripe-payments-STRIPE_WEBHOOK_SECRET', 'firestore-stripe-payments-STRIPE_API_KEY']
}, async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
        logger.error('Missing Stripe signature or webhook secret');
        res.status(400).send('Webhook Error: Missing signature or secret');
        return;
    }

    // Initialize Stripe
    const stripe = new Stripe(process.env.STRIPE_API_KEY!, {
        apiVersion: '2023-10-16' as any, // Use as any to avoid type mismatches with different versions
    });

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig as string, webhookSecret);
    } catch (err: any) {
        logger.error(`Webhook Error: ${err.message}`);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // Handle the event
    if (event.type === 'customer.deleted') {
        const customer = event.data.object;
        const stripeId = customer.id;

        logger.info(`Received customer.deleted for Stripe ID: ${stripeId}`);

        // Find the user with this stripeId
        const usersSnapshot = await admin.firestore()
            .collection('customers')
            .where('stripeId', '==', stripeId)
            .limit(1)
            .get();

        if (!usersSnapshot.empty) {
            const userDoc = usersSnapshot.docs[0];
            await userDoc.ref.update({
                stripeId: admin.firestore.FieldValue.delete(),
                stripeLink: admin.firestore.FieldValue.delete()
            });
            logger.info(`Successfully cleared stale Stripe data for user: ${userDoc.id}`);
        } else {
            logger.info(`No user found with Stripe ID: ${stripeId}`);
        }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

        logger.info(`Processing subscription event ${event.type} for customer ${stripeCustomerId}`);

        // Find matches in PRICE_TO_PLAN
        let mappedRole: string | null = null;
        if (subscription.items && subscription.items.data.length > 0) {
            const priceId = subscription.items.data[0].price.id;
            mappedRole = PRICE_TO_PLAN[priceId];
            logger.info(`Subscription price ID: ${priceId} -> Mapped Role: ${mappedRole}`);
        }

        if (mappedRole) {
            // Find the user
            const usersSnapshot = await admin.firestore()
                .collection('customers')
                .where('stripeId', '==', stripeCustomerId)
                .limit(1)
                .get();

            if (!usersSnapshot.empty) {
                const uid = usersSnapshot.docs[0].id;
                // Set claims
                await admin.auth().setCustomUserClaims(uid, { stripeRole: mappedRole });
                logger.info(`Enforced custom claims for user ${uid}: stripeRole=${mappedRole}`);
            } else {
                logger.warn(`No user found for Stripe Customer ${stripeCustomerId} to set claims.`);
            }
        }
    }

    res.status(200).send({ received: true });
});
