import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';
import { REFRESHED_EMAIL_TEMPLATE_CATALOG } from '../email/template-catalog';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

dotenv.config({ path: resolve(__dirname, '../../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../../service-account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
});

const MAIL_COLLECTION = 'mail';

async function sendTestEmails(targetEmail: string): Promise<void> {
    if (!targetEmail) {
        throw new Error('Usage: npm run test-emails -- target@example.com');
    }

    const previewCases = REFRESHED_EMAIL_TEMPLATE_CATALOG.flatMap(template =>
        template.previewCases.map(preview => ({ template, preview }))
    );
    logger.info(`Queueing ${previewCases.length} refreshed-template smoke tests for ${targetEmail}.`);

    const db = admin.firestore();
    const batch = db.batch();

    for (const { template, preview } of previewCases) {
        const isFounderNote = template.id === 'registration_welcome';
        const docRef = db.collection(MAIL_COLLECTION).doc();
        batch.set(docRef, {
            to: targetEmail,
            from: isFounderNote ? FOUNDER_EMAIL_FROM : TRANSACTIONAL_EMAIL_FROM,
            replyTo: isFounderNote ? FOUNDER_EMAIL_REPLY_TO : TRANSACTIONAL_EMAIL_REPLY_TO,
            template: {
                name: template.id,
                data: preview.data,
            },
            expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
        });
        logger.info(`Queued ${template.id} (${preview.name})`);
    }

    await batch.commit();
    logger.info('All refreshed-template smoke tests were queued. development_update was excluded.');
}

const targetEmail = process.argv.slice(2)[0];
sendTestEmails(targetEmail).catch(error => {
    logger.error('Failed to queue refreshed-template smoke tests.', error);
    process.exitCode = 1;
});
