import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
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

    logger.info('Starting subscription notification check...');

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

    logger.info(`Found ${snapshot.size} subscriptions expiring between ${threeDaysFromNow.toISOString()} and ${fourDaysFromNow.toISOString()}`);



    for (const doc of snapshot.docs) {
        const sub = doc.data();
        const uid = doc.ref.parent.parent?.id;

        if (!uid) {
            logger.error(`Could not determine UID for subscription ${doc.id}`);
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
            logger.info(`Skipping existing expiring email for ${doc.id}`);
            continue;
        }

        await mailRef.set({
            toUids: [uid],
            from: 'Quantified Self <hello@quantified-self.io>',
            template: {
                name: 'subscription_expiring_soon',
                data: {
                    role: ROLE_DISPLAY_NAMES[sub.role] || sub.role,
                    expiration_date: expirationDate
                }
            }
        });
        logger.info(`Queued expiring email for user ${uid}`);
    }

    // -------------------------------------------------------------------------
    // 2. Grace Period Ending Soon (5 days out)
    // -------------------------------------------------------------------------
    const fiveDaysFromNow = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
    const sixDaysFromNow = new Date(now.getTime() + (6 * 24 * 60 * 60 * 1000));

    // Refactored to query 'system' subcollection group
    const systemSnapshot = await db.collectionGroup('system')
        .where('gracePeriodUntil', '>=', admin.firestore.Timestamp.fromDate(fiveDaysFromNow))
        .where('gracePeriodUntil', '<', admin.firestore.Timestamp.fromDate(sixDaysFromNow))
        .get();

    // Note: subscriptions.ts stores gracePeriodUntil as Timestamp now (fixed in refactor), 
    // but originally logic had ISO strings? 
    // Wait, in subscriptions.ts I see `gracePeriodUntil = admin.firestore.Timestamp.fromDate(...)`.
    // So the query above uses Timestamps which is correct.

    logger.info(`Found ${systemSnapshot.size} users with grace period ending between ${fiveDaysFromNow.toISOString()} and ${sixDaysFromNow.toISOString()}`);

    for (const doc of systemSnapshot.docs) {
        const systemData = doc.data();
        const uid = doc.ref.parent.parent?.id;

        if (!uid) {
            logger.warn(`Found orphan system doc ${doc.id} without parent user`);
            continue;
        }

        // Grace period until is a Timestamp
        const gracePeriodDate = (systemData.gracePeriodUntil as admin.firestore.Timestamp).toDate();
        const expirationDate = gracePeriodDate.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Use a safe ID safe for filenames
        const dateKey = gracePeriodDate.toISOString().replace(/[:.]/g, '-');
        const idempotencyKey = `grace_ending_${uid}_${dateKey}`;
        const mailRef = db.collection('mail').doc(idempotencyKey);

        const mailDoc = await mailRef.get();
        if (mailDoc.exists) {
            continue;
        }

        await mailRef.set({
            toUids: [uid],
            from: 'Quantified Self <hello@quantified-self.io>',
            template: {
                name: 'grace_period_ending',
                data: {
                    expiration_date: expirationDate
                }
            }
        });
        logger.info(`Queued grace period warning for user ${uid}`);
    }

    logger.info('Subscription notification check complete.');
});
