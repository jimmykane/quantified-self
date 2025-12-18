const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const projectId = process.env.PROJECT_ID;
if (!projectId) {
    console.error('Error: PROJECT_ID environment variable is required.');
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: projectId
    });
}
const db = admin.firestore();

// Import Code from Functions (Compiled)
// We assume this script is run from the root, so paths are relative to root
const FUNCTIONS_LIB_PATH = path.join(__dirname, '../functions/lib');

let deauthorizeServiceForUser;
let deauthorizeGarminHealthAPIForUser;
let ServiceNames;

try {
    const oauth2 = require(path.join(FUNCTIONS_LIB_PATH, 'OAuth2'));
    deauthorizeServiceForUser = oauth2.deauthorizeServiceForUser;

    // We need ServiceNames enum/object. 
    // It is usually imported from @sports-alliance/sports-lib in the source, 
    // but in compiled JS it might be needed. 
    // Let's rely on string constants if we can't find the lib easily, 
    // or try to require the dependency if it's installed in functions/node_modules.
    // However, the compiled code in OAuth2.js likely uses the enum values (strings).
    // Let's define them manually to be safe and avoid complex require paths for external modules.
    ServiceNames = {
        SuuntoApp: 'SuuntoApp',
        COROSAPI: 'COROSAPI',
        GarminHealthAPI: 'GarminHealthAPI'
    };

    const garminWrapper = require(path.join(FUNCTIONS_LIB_PATH, 'garmin/auth/wrapper'));
    deauthorizeGarminHealthAPIForUser = garminWrapper.deauthorizeGarminHealthAPIForUser;

} catch (e) {
    console.error('Error loading function libraries. Make sure "npm run build" was executed in "functions/" directory.');
    console.error(e);
    process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

async function processCollection(collectionName, serviceName, deauthFn) {
    console.log(`\nScanning collection: ${collectionName} for Service: ${serviceName || 'Garmin'}...`);
    const snapshot = await db.collection(collectionName).get();

    if (snapshot.empty) {
        console.log(`  No users found in ${collectionName}.`);
        return;
    }

    console.log(`  Found ${snapshot.size} users with tokens.`);

    for (const doc of snapshot.docs) {
        const uid = doc.id;
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would deauthorize user ${uid} from ${serviceName || 'Garmin'}`);
        } else {
            console.log(`  Deauthorizing user ${uid} from ${serviceName || 'Garmin'}...`);
            try {
                if (serviceName) {
                    await deauthFn(uid, serviceName);
                } else {
                    await deauthFn(uid); // Garmin doesn't take serviceName
                }
                console.log(`  ✓ Success: ${uid}`);
            } catch (e) {
                console.error(`  ✗ Failed: ${uid} - ${e.message}`);
            }
        }
    }
}

async function main() {
    console.log(`Starting Deauthorization Script (Dry Run: ${DRY_RUN})`);

    // Suunto
    await processCollection('suuntoAppAccessTokens', ServiceNames.SuuntoApp, deauthorizeServiceForUser);

    // COROS
    await processCollection('COROSAPIAccessTokens', ServiceNames.COROSAPI, deauthorizeServiceForUser);

    // Garmin
    await processCollection('garminHealthAPITokens', null, deauthorizeGarminHealthAPIForUser);

    console.log('\nDeauthorization phase complete.');
}

main().catch(e => {
    console.error('Unhandled error:', e);
    process.exit(1);
});
