const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
// Expects GOOGLE_APPLICATION_CREDENTIALS or PROJECT_ID
const projectId = process.env.PROJECT_ID || process.env.GCLOUD_PROJECT;
if (!admin.apps.length) {
    if (projectId) {
        admin.initializeApp({ projectId });
    } else {
        admin.initializeApp();
    }
}

const db = admin.firestore();
const auth = admin.auth();

const DRY_RUN = process.argv.includes('--dry-run');

async function processUser(user) {
    const uid = user.uid;
    const email = user.email || 'no-email';

    // Query Active Subscriptions
    const snapshot = await db.collection(`customers/${uid}/subscriptions`)
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    let targetRole = null;
    let source = 'None';

    if (!snapshot.empty) {
        const subData = snapshot.docs[0].data();

        // Priority: firebaseRole -> role -> premium logic
        if (subData.firebaseRole) {
            targetRole = subData.firebaseRole;
            source = 'firebaseRole';
        } else if (subData.role) {
            targetRole = subData.role;
            source = 'role';
            if (targetRole === 'premium') {
                targetRole = 'pro';
                source = 'role(premium->pro translated)';
            }
        }
    }

    // Current Claims
    const currentClaims = user.customClaims || {};
    const currentRole = currentClaims.stripeRole;

    if ((currentRole || null) !== (targetRole || null)) {
        const action = targetRole ? `SET to ${targetRole}` : 'CLEAR';
        if (DRY_RUN) {
            console.log(`[DRY RUN] User ${email} (${uid}): Current=${currentRole}, New=${targetRole} (Source: ${source}). Action: ${action}`);
        } else {
            console.log(`User ${email} (${uid}): Updating... Current=${currentRole}, New=${targetRole} (Source: ${source})`);
            if (targetRole) {
                await auth.setCustomUserClaims(uid, { ...currentClaims, stripeRole: targetRole });
            } else {
                // Remove stripeRole
                const newClaims = { ...currentClaims };
                delete newClaims.stripeRole;
                await auth.setCustomUserClaims(uid, newClaims);
            }
        }
    } else {
        // console.log(`User ${email} (${uid}): In sync (${currentRole}).`);
    }
}

async function listAllUsers(nextPageToken) {
    // List batch of users, 1000 at a time.
    const listUsersResult = await auth.listUsers(1000, nextPageToken);

    for (const user of listUsersResult.users) {
        await processUser(user);
    }

    if (listUsersResult.pageToken) {
        await listAllUsers(listUsersResult.pageToken);
    }
}

async function main() {
    const emailArg = process.argv.find(arg => arg.startsWith('--email='));
    const targetEmail = emailArg ? emailArg.split('=')[1] : null;

    console.log(`Starting Claim Refresh Script (Dry Run: ${DRY_RUN})`);

    try {
        if (targetEmail) {
            console.log(`Processing single user: ${targetEmail}`);
            try {
                const user = await auth.getUserByEmail(targetEmail);
                await processUser(user);
            } catch (error) {
                console.error(`Error fetching user ${targetEmail}:`, error.message);
            }
        } else {
            // Process all users
            await listAllUsers();
        }
        console.log('Done.');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
