import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import Stripe from 'stripe';

/**
 * Handle Stripe webhook events.
 * Currently handles:
 * - customer.deleted: Clears stale stripeId from Firestore
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
    }

    res.status(200).send({ received: true });
});
