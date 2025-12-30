
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Exported for testing, but requires DB injection
export async function migrateUser(userDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot, database: admin.firestore.Firestore) {
    const uid = userDoc.id;
    const data = userDoc.data() || {};
    console.log(`[${uid}] DEBUG: Document Keys:`, Object.keys(data));

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

    // 3. Write Phase
    const writeBatch = database.batch();
    let writesQueued = false;

    if (hasSystemData) {
        console.log(`[${uid}] Found System Data:`, Object.keys(systemData));
        const systemRef = database.doc(`users/${uid}/system/status`);
        writeBatch.set(systemRef, systemData, { merge: true });
        writesQueued = true;
    }

    if (hasLegalData) {
        console.log(`[${uid}] Found Legal Data:`, Object.keys(legalData));
        const legalRef = database.doc(`users/${uid}/legal/agreements`);
        writeBatch.set(legalRef, legalData, { merge: true });
        writesQueued = true;
    }

    if (data.settings) {
        console.log(`[${uid}] Found Settings Data`);
        const settingsRef = database.doc(`users/${uid}/config/settings`);
        writeBatch.set(settingsRef, data.settings, { merge: true });
        writesQueued = true;
    }

    if (writesQueued) {
        await writeBatch.commit();
        console.log(`[${uid}] writes committed successfully.`);
    } else {
        console.log(`[${uid}] No data to migrate.`);
    }

    // 4. Verification & Delete Phase
    // In a real script, 'await writeBatch.commit()' throwing guarantees writes failed.
    // If we are here, writes succeeded.

    const deleteBatch = database.batch();
    const cleanupData: any = {};
    let deletesQueued = false;

    [...systemFields, ...legalFields, 'settings'].forEach(field => {
        if (data[field] !== undefined) {
            cleanupData[field] = admin.firestore.FieldValue.delete();
            deletesQueued = true;
        }
    });

    if (deletesQueued) {
        const userRef = userDoc.ref;
        deleteBatch.update(userRef, cleanupData);
        await deleteBatch.commit();
        console.log(`[${uid}] cleanup (deletion) committed successfully.`);
    }
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
