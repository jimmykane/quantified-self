import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { newEmailDeliveryFields } from '../email/queue-metadata';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { TRANSACTIONAL_EMAIL_FROM, TRANSACTIONAL_EMAIL_REPLY_TO } from '../email/config';

export function pendingAccountDeletionMarker(source: 'deleteSelf' | 'inactivity') {
    return {
        createdAt: FieldValue.serverTimestamp(), source, cleanupStatus: 'pending',
        // Unfinished deletion must never lose its writer fence to TTL.
        expireAt: FieldValue.delete(), completedAt: FieldValue.delete(),
    };
}

/** Internal only: the caller MUST establish the durable deletion fence first.
 * Individual Auth deletion delivers the existing cleanupUserAccounts event.
 * An uncertain Auth failure retains that fence; this helper never retries it.
 */
export async function deleteAuthAccountAndNotify(uid: string, userEmail: string | undefined,
    auth = admin.auth(), db = admin.firestore()): Promise<void> {
    // Delete Auth User (idempotent if already deleted)
    try {
        await auth.deleteUser(uid);
        logger.info(`Successfully deleted user auth: ${uid} `);
    } catch (deleteError) {
        if ((deleteError as { code?: string; errorInfo?: { code?: string } })?.code === 'auth/user-not-found'
                || (deleteError as { errorInfo?: { code?: string } })?.errorInfo?.code === 'auth/user-not-found') {
            logger.warn(`User ${uid} was already deleted in auth. Treating deletion as successful.`, deleteError);
        } else {
            // A failed Auth RPC may have committed before its response was lost.
            // Retain the fence; retrying deleteSelf is safe and remains permitted.
            throw deleteError;
        }
    }

    if (userEmail) {
        try {
            await db.collection('mail').doc(`account_deleted_confirmation_${uid}`).set({
                ...newEmailDeliveryFields(),
                to: userEmail,
                uid,
                from: TRANSACTIONAL_EMAIL_FROM,
                replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
                template: {
                    name: 'account_deleted_confirmation',
                    data: {
                        support_email: TRANSACTIONAL_EMAIL_REPLY_TO,
                    }
                },
                expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
            });
            logger.info(`Queued account deletion confirmation email for user: ${uid}`);
        } catch (mailError) {
            logger.error(`Failed to queue account deletion confirmation email for user: ${uid}`, mailError);
        }
    } else {
        logger.info(`No email found for deleted user ${uid}. Skipping account deletion confirmation email.`);
    }
}
