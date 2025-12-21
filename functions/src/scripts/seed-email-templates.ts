
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Firebase Admin
// Assumes this is run locally with GOOGLE_APPLICATION_CREDENTIALS or similar auth
// or inside a function environment.
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const TEMPLATES_COLLECTION = 'email_templates';
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

const TEMPLATE_SUBJECTS: { [key: string]: string } = {
    'subscription_upgrade': "You've upgraded to {{new_role}}!",
    'subscription_downgrade': "Subscription Update: You are now on {{new_role}}",
    'subscription_cancellation': "Subscription Cancellation Confirmed",
    'subscription_expiring_soon': "Action Required: Your subscription is ending soon",
    'welcome_email': "Welcome to Quantified Self Pro!"
};

async function seedTemplates() {
    console.log(`Seeding templates from ${TEMPLATES_DIR} to collection '${TEMPLATES_COLLECTION}'...`);

    // Check if directory exists
    if (!fs.existsSync(TEMPLATES_DIR)) {
        console.error(`Templates directory not found: ${TEMPLATES_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(TEMPLATES_DIR);

    for (const file of files) {
        if (file.endsWith('.hbs')) {
            const templateName = path.basename(file, '.hbs');
            const subject = TEMPLATE_SUBJECTS[templateName] || 'Notification from Quantified Self';

            const htmlContent = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');

            console.log(`Uploading template: ${templateName}`);

            try {
                await admin.firestore().collection(TEMPLATES_COLLECTION).doc(templateName).set({
                    subject: subject,
                    html: htmlContent
                });
                console.log(`✅ Successfully uploaded ${templateName}`);
            } catch (error) {
                console.error(`❌ Failed to upload ${templateName}:`, error);
            }
        }
    }

    console.log('Seeding complete.');
}

seedTemplates().catch(console.error);
