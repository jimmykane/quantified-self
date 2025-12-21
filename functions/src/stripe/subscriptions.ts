import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { reconcileClaims } from './claims';
import { checkAndSendSubscriptionEmails } from './email-triggers';
import { GRACE_PERIOD_DAYS } from '../shared/limits';

/**
 * Triggered whenever a subscription document is created or updated.
 * Ensures the user's custom claims are in sync and manages the grace period.
 */
export const onSubscriptionUpdated = onDocumentWritten({
    document: 'customers/{uid}/subscriptions/{subscriptionId}',
    region: 'europe-west3'
}, async (event) => {
    const uid = event.params.uid;

    console.log(`[onSubscriptionUpdated] Change detected for user ${uid}. Reconciling claims...`);

    try {
        await reconcileClaims(uid);

        // If the role is now 'free' (no active sub found in reconcileClaims), 
        // find if they WERE pro/basic and set the grace period.
        // Actually, reconcileClaims throws NOT_FOUND if no active sub.
        // Let's refine the logic here.

        // If we are here, at least one sub was written. 
        // If the NEW state is that no ACTIVE sub exists, we set gracePeriodUntil.

        const subscriptionsRef = admin.firestore().collection(`customers/${uid}/subscriptions`);
        const activeSnapshot = await subscriptionsRef
            .where('status', 'in', ['active', 'trialing'])
            .limit(1)
            .get();

        if (activeSnapshot.empty) {
            console.log(`[onSubscriptionUpdated] No active subscriptions for ${uid}. Checking for previous paid state...`);

            // Check if user already has a grace period set to avoid overwriting or extending it unfairly
            const userDoc = await admin.firestore().doc(`users/${uid}`).get();
            const userData = userDoc.data();

            // If they don't have a grace period yet, set it to 30 days from now
            if (!userData?.gracePeriodUntil) {
                const gracePeriodUntil = admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
                );
                console.log(`[onSubscriptionUpdated] Setting gracePeriodUntil: ${gracePeriodUntil.toDate().toISOString()} for user ${uid}`);
                await admin.firestore().doc(`users/${uid}`).set({
                    gracePeriodUntil,
                    lastDowngradedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        } else {
            // User has an active sub. Clear grace period if it exists.
            console.log(`[onSubscriptionUpdated] Active subscription found. Clearing grace period for ${uid}.`);
            await admin.firestore().doc(`users/${uid}`).update({
                gracePeriodUntil: admin.firestore.FieldValue.delete(),
                lastDowngradedAt: admin.firestore.FieldValue.delete()
            }).catch(() => { }); // Ignore error if field doesn't exist

            // Reconcile claims immediately since they are active
            await reconcileClaims(uid);
        }

        // Check for email triggers (Welcome, Upgrade, Downgrade, Cancellation)
        // using the specific change that triggered this event.
        if (event.data) {
            await checkAndSendSubscriptionEmails(
                uid,
                event.params.subscriptionId,
                event.data.before.data(),
                event.data.after.data(),
                event.id
            );
        }

    } catch (e: any) {
        if (e.code === 'not-found' || e.message?.includes('No active subscription found')) {
            // Expected if user has no active subs. Set grace period as above.
            // Duplicate logic partially but for safety...
            const userDoc = await admin.firestore().doc(`users/${uid}`).get();
            if (!userDoc.data()?.gracePeriodUntil) {
                const gracePeriodUntil = admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
                );
                await admin.firestore().doc(`users/${uid}`).set({ gracePeriodUntil }, { merge: true });
            }
            await admin.auth().setCustomUserClaims(uid, { stripeRole: 'free' });
            return;
        }
        console.error(`[onSubscriptionUpdated] Error for user ${uid}:`, e);
    }
});
