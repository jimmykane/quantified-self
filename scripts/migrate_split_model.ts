
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

    if (!hasSystemData && !hasLegalData) {
        console.log(`Skipping user ${uid} (no fields to migrate)`);
        return;
    }

    const batch = db.batch();

    // 3. Write System Data
    if (hasSystemData) {
        const systemRef = db.doc(`users/${uid}/system/status`);
        batch.set(systemRef, systemData, { merge: true });
    }

    // 4. Write Legal Data
    if (hasLegalData) {
        const legalRef = db.doc(`users/${uid}/legal/agreements`);
        batch.set(legalRef, legalData, { merge: true });
    }

    // 5. Cleanup Main Doc
    const cleanupData: any = {};
    [...systemFields, ...legalFields].forEach(field => {
        if (data[field] !== undefined) {
            cleanupData[field] = admin.firestore.FieldValue.delete();
        }
    });

    const userRef = userDoc.ref;
    batch.update(userRef, cleanupData);

    await batch.commit();
    console.log(`Migrated user ${uid}`);
}

async function run() {
    console.log('Starting Split Model Migration...');
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.size} users to process.`);

    let count = 0;
    for (const doc of usersSnapshot.docs) {
        await migrateUser(doc);
        count++;
        if (count % 100 === 0) console.log(`Processed ${count} users...`);
    }

    console.log('Migration Complete.');
}

run().catch(console.error);
