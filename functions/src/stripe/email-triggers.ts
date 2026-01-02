import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ROLE_HIERARCHY } from '../shared/pricing';
import { MAIL_TTL_DAYS } from '../shared/constants';
import { DocumentData } from 'firebase-admin/firestore';


// Helper to format date
const formatDate = (timestamp: admin.firestore.Timestamp): string => {
    return timestamp.toDate().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
};

const ROLE_DISPLAY_NAMES: { [key: string]: string } = {
    'free': 'Free',
    'basic': 'Basic',
    'pro': 'Pro'
};

/**
 * Checks for subscription changes and queues appropriate emails.
 */
export async function checkAndSendSubscriptionEmails(
    uid: string,
    subscriptionId: string,
    before: DocumentData | undefined,
    after: DocumentData | undefined,
    eventId: string
): Promise<void> {

    // 1. Welcome Email
    // Trigger: New active/trialing subscription.
    // Condition: No 'before' state (creation) OR 'before' state was NOT active/trialing, AND 'after' IS active/trialing.
    const isNowActive = after && ['active', 'trialing'].includes(after.status);
    const wasActive = before && ['active', 'trialing'].includes(before.status);

    if (isNowActive && !wasActive && after.role) {
        // Welcome Email Logic
        const mailDocId = `welcome_email_${subscriptionId}`;
        const mailRef = admin.firestore().collection('mail').doc(mailDocId);
        const mailDoc = await mailRef.get();

        if (!mailDoc.exists) {
            const userRecord = await admin.auth().getUser(uid);
            if (userRecord.email) {
                logger.info(`[checkAndSendSubscriptionEmails] Queuing welcome email for user ${uid}, subscription ${subscriptionId}`);
                await mailRef.set({
                    to: userRecord.email,
                    from: 'Quantified Self <hello@quantified-self.io>',
                    template: {
                        name: 'welcome_email',
                        data: {
                            role: after.role,
                        },
                    },
                    expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + MAIL_TTL_DAYS * 24 * 60 * 60 * 1000)),
                });
            }
        }
    }

    // Ensure we have both before and after for comparison logic below
    if (!before || !after) return;

    // 2. Upgrade / Downgrade Logic
    const oldRole = before.role;
    const newRole = after.role;

    if (oldRole && newRole && oldRole !== newRole) {
        const oldLevel = ROLE_HIERARCHY[oldRole as keyof typeof ROLE_HIERARCHY] || 0;
        const newLevel = ROLE_HIERARCHY[newRole as keyof typeof ROLE_HIERARCHY] || 0;

        const userRecord = await admin.auth().getUser(uid);
        if (!userRecord.email) return;

        if (newLevel > oldLevel) {
            // Upgrade
            const mailId = `upgrade_${eventId}`;
            const mailRef = admin.firestore().collection('mail').doc(mailId);
            const exists = (await mailRef.get()).exists;
            if (!exists) {
                logger.info(`[checkAndSendSubscriptionEmails] Queuing UPGRADE email for user ${uid}`);
                await mailRef.set({
                    to: userRecord.email,
                    from: 'Quantified Self <hello@quantified-self.io>',
                    template: {
                        name: 'subscription_upgrade',
                        data: {
                            new_role: ROLE_DISPLAY_NAMES[newRole] || newRole,
                            old_role: ROLE_DISPLAY_NAMES[oldRole] || oldRole,
                        }
                    },
                    expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + MAIL_TTL_DAYS * 24 * 60 * 60 * 1000)),
                });
            }
        } else if (newLevel < oldLevel) {
            // Downgrade
            const mailId = `downgrade_${eventId}`;
            const mailRef = admin.firestore().collection('mail').doc(mailId);
            const exists = (await mailRef.get()).exists;
            if (!exists) {
                logger.info(`[checkAndSendSubscriptionEmails] Queuing DOWNGRADE email for user ${uid}`);
                await mailRef.set({
                    to: userRecord.email,
                    from: 'Quantified Self <hello@quantified-self.io>',
                    template: {
                        name: 'subscription_downgrade',
                        data: {
                            new_role: ROLE_DISPLAY_NAMES[newRole] || newRole,
                            old_role: ROLE_DISPLAY_NAMES[oldRole] || oldRole,
                            limit: (newRole === 'basic') ? '100' : '10', // Basic=100, Free=10
                        }
                    },
                    expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + MAIL_TTL_DAYS * 24 * 60 * 60 * 1000)),
                });
            }
        }
    }

    // 3. Cancellation Logic
    // Trigger: cancel_at_period_end goes from false -> true
    if (!before.cancel_at_period_end && after.cancel_at_period_end) {
        const currentPeriodEnd = after.current_period_end;
        if (currentPeriodEnd) {
            // We use subscriptionId + timestamp to allow for re-cancellation warnings if they renew and cancel again later (different period end)
            // or just to avoid spamming if they toggle it quickly? 
            // Ideally triggering on the *change* is enough, but using period_end helps uniqueness if they renew/cancel multiple times.
            const mailId = `cancellation_${subscriptionId}_${currentPeriodEnd.seconds}`;

            const mailRef = admin.firestore().collection('mail').doc(mailId);
            const exists = (await mailRef.get()).exists;

            if (!exists) {
                const userRecord = await admin.auth().getUser(uid);
                if (userRecord.email) {
                    logger.info(`[checkAndSendSubscriptionEmails] Queuing CANCELLATION email for user ${uid}`);
                    await mailRef.set({
                        to: userRecord.email,
                        from: 'Quantified Self <hello@quantified-self.io>',
                        template: {
                            name: 'subscription_cancellation',
                            data: {
                                role: ROLE_DISPLAY_NAMES[after.role] || after.role,
                                expiration_date: formatDate(currentPeriodEnd),
                            }
                        },
                        expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + MAIL_TTL_DAYS * 24 * 60 * 60 * 1000)),
                    });
                }
            }
        }
    }
}
