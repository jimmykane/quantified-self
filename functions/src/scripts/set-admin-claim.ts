import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const uid = process.argv[2];

if (!uid) {
    logger.error('Usage: npx ts-node src/scripts/set-admin-claim.ts <uid>');
    process.exit(1);
}

async function setAdminClaim() {
    try {
        // Fetch existing claims to avoid overwriting them
        const user = await admin.auth().getUser(uid);
        const existingClaims = user.customClaims || {};

        await admin.auth().setCustomUserClaims(uid, {
            ...existingClaims,
            admin: true
        });
        logger.info(`Successfully set admin claim for user: ${uid}`);

        // Verify
        const updatedUser = await admin.auth().getUser(uid);
        logger.info(`Current custom claims for ${uid}:`, updatedUser.customClaims);
    } catch (error) {
        logger.error(`Error setting admin claim for ${uid}:`, error);
    }
}

setAdminClaim();
