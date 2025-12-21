
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

// Reusing the same ROLE_DISPLAY_NAMES map or importing simple map if needed
const ROLE_DISPLAY_NAMES: { [key: string]: string } = {
    'free': 'Free',
    'basic': 'Basic',
    'pro': 'Pro'
};

export const checkSubscriptionNotifications = onSchedule('every 24 hours', async (event) => {
    const db = admin.firestore();
    const now = new Date();

    console.log('Starting subscription notification check...');

    // -------------------------------------------------------------------------
    // 1. Subscription Expiring Soon (3 days out)
    // -------------------------------------------------------------------------
    const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    const fourDaysFromNow = new Date(now.getTime() + (4 * 24 * 60 * 60 * 1000));

    // Firestore timestamp serialization of active intent
    const snapshot = await db.collectionGroup('subscriptions')
        .where('status', '==', 'active')
        .where('cancel_at_period_end', '==', true)
        .where('current_period_end', '>=', admin.firestore.Timestamp.fromDate(threeDaysFromNow))
        .where('current_period_end', '<', admin.firestore.Timestamp.fromDate(fourDaysFromNow))
        .get();

    console.log(`Found ${snapshot.size} subscriptions expiring between ${threeDaysFromNow.toISOString()} and ${fourDaysFromNow.toISOString()}`);



    for (const doc of snapshot.docs) {
        const sub = doc.data();
        const uid = doc.ref.parent.parent?.id;

        if (!uid) {
            console.error(`Could not determine UID for subscription ${doc.id}`);
            continue;
        }

        const expirationDate = sub.current_period_end.toDate().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        const idempotencyKey = `expiring_${doc.id}_${sub.current_period_end.seconds}`;
        const mailRef = db.collection('mail').doc(idempotencyKey);

        // Optimistic check: create only if not exists
        // Since we are batching, we can use create() which fails if doc exists, 
        // but we want to avoid batch failure. Ideally we check existence or use separate transactions.
        // For simplicity in a scheduled job, we'll check existence first (slower but safer for batch)
        // OR better: use runTransaction or just create singular writes if volume is low.
        // Given the scale, singular writes for notifications are fine to start, or we can just try/catch the create.

        // Actually, the extensions work by listening to 'mail' collection.
        // We can just set() with merge: true? No, we want unique triggers.
        // Let's check existence to be clean.
        const mailDoc = await mailRef.get();
        if (mailDoc.exists) {
            console.log(`Skipping existing expiring email for ${doc.id}`);
            continue;
        }

        await mailRef.set({
            toUids: [uid],
            template: {
                name: 'subscription_expiring_soon',
                data: {
                    role: ROLE_DISPLAY_NAMES[sub.role] || sub.role,
                    expiration_date: expirationDate
                }
            }
        });
        console.log(`Queued expiring email for user ${uid}`);
    }

    // -------------------------------------------------------------------------
    // 2. Grace Period Ending Soon (5 days out)
    // -------------------------------------------------------------------------
    const fiveDaysFromNow = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
    const sixDaysFromNow = new Date(now.getTime() + (6 * 24 * 60 * 60 * 1000));

    // We need to query USERS directly for gracePeriodUntil
    const usersSnapshot = await db.collection('users')
        .where('gracePeriodUntil', '>=', fiveDaysFromNow.toISOString()) // stored as ISO string in logic
        .where('gracePeriodUntil', '<', sixDaysFromNow.toISOString())
        .get();

    // Wait, in `subscriptions.ts`, gracePeriodUntil is set as `new Date().toISOString()`.
    // So string comparison works.

    console.log(`Found ${usersSnapshot.size} users with grace period ending between ${fiveDaysFromNow.toISOString()} and ${sixDaysFromNow.toISOString()}`);

    for (const doc of usersSnapshot.docs) {
        const user = doc.data();
        const uid = doc.id;

        // Double check they don't have an active subscription now?
        // If they resubscribed, `gracePeriodUntil` should have been cleared (handled in onSubscriptionUpdated).
        // But just in case, we can rely on the fact it exists.

        const expirationDate = new Date(user.gracePeriodUntil).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Use a safe ID safe for filenames
        const dateKey = user.gracePeriodUntil.replace(/[:.]/g, '-');
        const idempotencyKey = `grace_ending_${uid}_${dateKey}`;
        const mailRef = db.collection('mail').doc(idempotencyKey);

        const mailDoc = await mailRef.get();
        if (mailDoc.exists) {
            continue;
        }

        await mailRef.set({
            toUids: [uid],
            template: {
                name: 'grace_period_ending',
                data: {
                    expiration_date: expirationDate
                }
            }
        });
        console.log(`Queued grace period warning for user ${uid}`);
    }

    console.log('Subscription notification check complete.');
});
