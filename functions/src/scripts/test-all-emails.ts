
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

const serviceAccount = require('../../service-account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
});

const MAIL_COLLECTION = 'mail';

interface EmailTestConfig {
    templateName: string;
    data: any;
}

const EMAIL_TESTS: EmailTestConfig[] = [
    {
        templateName: 'welcome_email',
        data: { role: 'pro' }
    },
    {
        templateName: 'subscription_upgrade',
        data: { new_role: 'pro' }
    },
    {
        templateName: 'subscription_downgrade',
        data: { new_role: 'free', limit: '10' }
    },
    {
        templateName: 'subscription_cancellation',
        data: { role: 'pro' }
    },
    {
        templateName: 'subscription_expiring_soon',
        data: { role: 'pro', expiration_date: 'December 31, 2025' }
    },
    {
        templateName: 'grace_period_ending',
        data: { expiration_date: 'January 30, 2026' }
    }
];

async function sendTestEmails(targetEmail: string) {
    if (!targetEmail) {
        console.error('Please provide an email address as an argument.');
        console.error('Usage: npm run test-emails -- target@example.com');
        process.exit(1);
    }

    console.log(`Queueing 6 test emails for: ${targetEmail}...`);

    const db = admin.firestore();
    const batch = db.batch();

    for (const test of EMAIL_TESTS) {
        const docRef = db.collection(MAIL_COLLECTION).doc();
        batch.set(docRef, {
            to: targetEmail,
            from: 'Quantified Self <hello@quantified-self.io>',
            template: {
                name: test.templateName,
                data: test.data
            },
            sent: false // Flag for extension to pick up (though usually it watches for creation)
        });
        console.log(`Queued: ${test.templateName}`);
    }

    await batch.commit();
    console.log('✅ All test emails have been queued in the "mail" collection.');
}

// Get email from command line args
const args = process.argv.slice(2);
const email = args[0];

sendTestEmails(email).catch(console.error);
