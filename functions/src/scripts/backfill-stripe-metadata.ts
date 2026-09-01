import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { STRIPE_API_VERSION } from '../stripe/client';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../../extensions/firestore-stripe-payments.env') });

const stripeKey = process.env.STRIPE_API_KEY;
if (!stripeKey) {
    console.error('ERROR: STRIPE_API_KEY is missing from environment variables.');
    process.exit(1);
}

// Keep operational scripts on the same API contract as custom Functions.
const stripe = new Stripe(stripeKey, {
    apiVersion: STRIPE_API_VERSION,
});

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });
}

const db = admin.firestore();

async function backfillMetadata() {
    console.log('🚀 Starting Stripe Metadata Backfill...');

    try {
        // 1. Get all users from Firestore
        console.log('Fetching users from Firestore...');
        const usersSnapshot = await db.collection('users').get();

        if (usersSnapshot.empty) {
            console.log('No users found in Firestore.');
            return;
        }

        console.log(`Found ${usersSnapshot.size} users. Processing...`);

        let updatedCount = 0;
        let skippedCount = 0;
        let notFoundInStripeCount = 0;
        let errorCount = 0;

        for (const doc of usersSnapshot.docs) {
            const userData = doc.data();
            const uid = doc.id;
            const email = userData.email;

            if (!email) {
                console.log(`[SKIP] User ${uid} has no email.`);
                skippedCount++;
                continue;
            }

            try {
                // 2. Search for Customer in Stripe by email
                const customers = await stripe.customers.list({
                    email: email,
                    limit: 1,
                });

                if (customers.data.length === 0) {
                    console.log(`[MISSING] No Stripe customer found for email: ${email} (UID: ${uid})`);
                    notFoundInStripeCount++;
                    continue;
                }

                const customer = customers.data[0];
                const currentMetadata = customer.metadata || {};

                // 3. Check if metadata needs update
                if (currentMetadata['firebaseUID'] === uid) {
                    // Metadata is already correct
                    // console.log(`[OK] Customer ${customer.id} already has correct UID.`);
                    skippedCount++;
                } else {
                    // 4. Update Metadata
                    console.log(`[UPDATE] Updating match: ${email} | Stripe: ${customer.id} | UID: ${uid}`);
                    if (currentMetadata['firebaseUID']) {
                        console.log(`   > Overwriting existing (mismatched) UID: ${currentMetadata['firebaseUID']}`);
                    }

                    await stripe.customers.update(customer.id, {
                        metadata: {
                            ...currentMetadata,
                            firebaseUID: uid,
                        },
                    });
                    updatedCount++;
                }

            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[ERROR] Processing user ${email}:`, message);
                errorCount++;
            }
        }

        console.log('\n-----------------------------------');
        console.log('✅ Backfill Complete');
        console.log(`Updated: ${updatedCount}`);
        console.log(`Skipped (Already Correct): ${skippedCount}`);
        console.log(`Not Found in Stripe: ${notFoundInStripeCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log('-----------------------------------');

    } catch (error) {
        console.error('Fatal error during backfill:', error);
    }
}

// Run the script
backfillMetadata()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
