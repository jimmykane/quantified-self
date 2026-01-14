/**
 * Local runner script for Garmin Token Migration
 * Run with: npx ts-node src/garmin/run-migration-local.ts
 */
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { migrateUserToken } from './migrate-tokens';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './constants';

dotenv.config();

// Initialize Firebase Admin (adjust credential if valid default not present)
if (admin.apps.length === 0) {
    admin.initializeApp();
}

async function runLocalMigration() {
    console.log('Starting local migration...');

    // Safety check for LIMIT
    const limit = 50;

    const snapshot = await admin.firestore()
        .collection(GARMIN_API_TOKENS_COLLECTION_NAME)
        .where('accessToken', '!=', null) // Target legacy docs
        .limit(limit)
        .get();

    console.log(`Found ${snapshot.size} potential candidates for migration.`);

    let successCount = 0;
    let failCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        // Skip if serviceName mismatch (safety)
        if (data.serviceName && data.serviceName !== 'GarminAPI') continue;

        console.log(`Migrating user ${doc.id}...`);

        try {
            const success = await migrateUserToken(doc.id, data);
            if (success) {
                console.log(`✅ Success: ${doc.id}`);
                successCount++;
            } else {
                console.log(`❌ Failed: ${doc.id}`);
                failCount++;
            }
        } catch (error) {
            console.error(`💥 Error processing ${doc.id}:`, error);
            failCount++;
        }
    }

    console.log('Migration Complete.');
    console.log(`Processed: ${snapshot.size}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);
}

runLocalMigration().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
