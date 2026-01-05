import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize with your service account
const serviceAccountPath = path.resolve(__dirname, '../quantified-self-io-firebase-adminsdk.json');
try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.error(`Error loading service account from ${serviceAccountPath}:`, error);
    process.exit(1);
}

const db = admin.firestore();

async function countCollection(collectionRef: admin.firestore.CollectionReference, path: string) {
    try {
        // 1. Count documents in this collection
        const countSnapshot = await collectionRef.count().get();
        const count = countSnapshot.data().count;

        console.log(`[Collection] ${path}: ${count} docs`);

        // 2. If you want to find subcollections, you must read the document references
        // Only if there are documents, otherwise it's empty
        if (count > 0) {
            // Using listDocuments is better than .get() as it doesn't download full data
            const documents = await collectionRef.listDocuments();

            // Limit to first 100 documents to search for subcollections to avoid massive reads on huge collections
            // if we assume subcollection structure is uniform.
            // If schema is non-uniform (some docs have subcols, others don't), we might miss some.
            // For a "search", we might want to check them all, but be careful.
            // Let's stick to checking all for completeness, but warn user.

            // Optimization: Process in chunks
            const chunkSize = 50;
            for (let i = 0; i < documents.length; i += chunkSize) {
                const chunk = documents.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (doc) => {
                    const subcollections = await doc.listCollections();
                    for (const subcol of subcollections) {
                        await countCollection(subcol, subcol.path);
                    }
                }));
            }
        }
    } catch (error) {
        console.error(`Error processing collection ${path}:`, error);
    }
}

async function start() {
    console.log('Starting full database scan...');
    console.log('This recursively lists all collections and counts documents.');

    try {
        const rootCollections = await db.listCollections();

        for (const col of rootCollections) {
            await countCollection(col, col.id);
        }
        console.log('Scan complete.');
    } catch (error) {
        console.error('Error in main scan:', error);
    }
}

start();
