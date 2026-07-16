import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { DocumentData } from 'firebase-admin/firestore';
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
} from '../shared/user-deletion-guard';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import {
    EMAIL_LINKS,
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
} from './config';

function isAuthUserNotFound(error: unknown): boolean {
    const authError = error as { code?: string; errorInfo?: { code?: string } };
    return authError.code === 'auth/user-not-found'
        || authError.errorInfo?.code === 'auth/user-not-found';
}

function firstNameFromDisplayName(displayName?: string): string {
    return `${displayName || ''}`.trim().split(/\s+/)[0] || '';
}

export async function queueRegistrationWelcomeEmail(
    uid: string,
    before: DocumentData | undefined,
    after: DocumentData | undefined,
): Promise<void> {
    if (before?.onboardingCompleted === true || after?.onboardingCompleted !== true) {
        return;
    }

    const firestore = admin.firestore();
    const deletionGuard = await getUserDeletionGuardState(firestore, uid);
    if (deletionGuard.shouldSkip) {
        logger.info('[registration-welcome] Skipping welcome because the user is missing or being deleted.', {
            uid,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
        });
        return;
    }

    let userRecord: admin.auth.UserRecord;
    try {
        userRecord = await admin.auth().getUser(uid);
    } catch (error) {
        if (isAuthUserNotFound(error)) {
            logger.info('[registration-welcome] Skipping welcome because the Auth user no longer exists.', { uid });
            return;
        }
        throw error;
    }

    if (!userRecord.email) {
        logger.info('[registration-welcome] Skipping welcome because the Auth user has no email.', { uid });
        return;
    }

    const mailRef = firestore.collection('mail').doc(`registration_welcome_${uid}`);
    const lifecycleRef = firestore.doc(`users/${uid}/system/emailLifecycle`);
    const result = await firestore.runTransaction(async transaction => {
        const latestDeletionGuard = await getUserDeletionGuardStateInTransaction(
            firestore,
            transaction,
            uid,
        );
        if (latestDeletionGuard.shouldSkip) {
            return 'skip-deleted-user' as const;
        }

        const [lifecycleDoc, mailDoc] = await Promise.all([
            transaction.get(lifecycleRef),
            transaction.get(mailRef),
        ]);
        if (lifecycleDoc.exists) {
            return 'already-queued' as const;
        }

        transaction.create(lifecycleRef, {
            registrationWelcomeQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (mailDoc.exists) {
            return 'already-queued' as const;
        }

        transaction.create(mailRef, {
            to: userRecord.email,
            from: FOUNDER_EMAIL_FROM,
            replyTo: FOUNDER_EMAIL_REPLY_TO,
            template: {
                name: 'registration_welcome',
                data: {
                    first_name: firstNameFromDisplayName(userRecord.displayName),
                    product_url: EMAIL_LINKS.product,
                },
            },
            expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
        });
        return 'queued' as const;
    });

    if (result === 'skip-deleted-user') {
        logger.info('[registration-welcome] Skipping welcome because the user disappeared or deletion started before queueing.', { uid });
        return;
    }

    if (result === 'already-queued') {
        logger.info('[registration-welcome] Founder welcome was already queued.', { uid });
        return;
    }

    if (result === 'queued') {
        logger.info('[registration-welcome] Queued founder welcome.', { uid });
    }
}

export const sendRegistrationWelcomeEmail = onDocumentWritten({
    document: 'users/{uid}',
    region: 'europe-west3',
    retry: true,
}, async (event) => {
    await queueRegistrationWelcomeEmail(
        `${event.params.uid || ''}`,
        event.data?.before.data(),
        event.data?.after.data(),
    );
});
