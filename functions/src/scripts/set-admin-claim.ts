
import * as admin from 'firebase-admin';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const uid = 'IjMQrlcqXYf6j4SZ3kDzX27MjNz2';

async function setAdminClaim() {
    try {
        await admin.auth().setCustomUserClaims(uid, { admin: true });
        console.log(`Successfully set admin claim for user: ${uid}`);

        // Verify
        const user = await admin.auth().getUser(uid);
        console.log('Current custom claims:', user.customClaims);
    } catch (error) {
        console.error('Error setting admin claim:', error);
    }
}

setAdminClaim();
