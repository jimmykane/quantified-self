
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Exported for testing, but requires DB injection
export async function migrateUser(userDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot, database: admin.firestore.Firestore) {
    const uid = userDoc.id;
    const data = userDoc.data() || {};

    // 1. Identify System Fields
    const systemFields = ['gracePeriodUntil', 'lastDowngradedAt', 'stripeRole', 'isPro'];
    const systemData: any = {};
    let hasSystemData = false;

    // 2. Identify Legal Fields
    const legalFields = [
        'acceptedPrivacyPolicy',
        'acceptedDataPolicy',
        'acceptedTrackingPolicy',
        'acceptedDiagnosticsPolicy',
        'acceptedTos'
    ];
    const legalData: any = {};
    let hasLegalData = false;

    // Extract Data
    systemFields.forEach(field => {
        if (data[field] !== undefined) {
            systemData[field] = data[field];
            hasSystemData = true;
        }
    });

    legalFields.forEach(field => {
        if (data[field] !== undefined) {
            legalData[field] = data[field];
            hasLegalData = true;
        }
    });

    if (!hasSystemData && !hasLegalData && !data.settings) {
        console.log(`Skipping user ${uid} (no fields to migrate)`);
        return;
    }

    const batch = database.batch();

    // 3. Write System Data
    if (hasSystemData) {
        const systemRef = database.doc(`users/${uid}/system/status`);
        batch.set(systemRef, systemData, { merge: true });
    }

    // 4. Write Legal Data
    if (hasLegalData) {
        const legalRef = database.doc(`users/${uid}/legal/agreements`);
        batch.set(legalRef, legalData, { merge: true });
    }

    // 5. Write Settings Data
    if (data.settings) {
        const settingsRef = database.doc(`users/${uid}/config/settings`);
        batch.set(settingsRef, data.settings, { merge: true });
    }

    // 5. Cleanup Main Doc
    const cleanupData: any = {};
    [...systemFields, ...legalFields, 'settings'].forEach(field => {
        if (data[field] !== undefined) {
            cleanupData[field] = admin.firestore.FieldValue.delete();
        }
    });

    const userRef = userDoc.ref;
    batch.update(userRef, cleanupData);

    await batch.commit();
    console.log(`Migrated user ${uid}`);
}

async function run(db: admin.firestore.Firestore) {
    console.log('Starting Split Model Migration...');

    // Parse arguments
    const args = process.argv.slice(2);
    const userIdArgIndex = args.indexOf('--userId');
    const targetUserId = userIdArgIndex !== -1 ? args[userIdArgIndex + 1] : null;

    if (targetUserId) {
        console.log(`Targeting specific user: ${targetUserId}`);
        const userDoc = await db.collection('users').doc(targetUserId).get();
        if (!userDoc.exists) {
            console.error(`User ${targetUserId} not found.`);
            process.exit(1);
        }
        await migrateUser(userDoc, db);
    } else {
        console.log('Targeting ALL users.');
        const usersSnapshot = await db.collection('users').get();
        console.log(`Found ${usersSnapshot.size} users to process.`);

        let count = 0;
        for (const doc of usersSnapshot.docs) {
            await migrateUser(doc, db);
            count++;
            if (count % 100 === 0) console.log(`Processed ${count} users...`);
        }
    }

    console.log('Migration Complete.');
}

// Only run if called directly
if (require.main === module) {
    // Initialize Firebase Admin (assumes GOOGLE_APPLICATION_CREDENTIALS or emulator)
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    const db = getFirestore();
    run(db).catch(console.error);
}
