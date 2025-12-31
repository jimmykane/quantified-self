
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const auth = admin.auth();

async function run() {
    console.log('Starting User Cleanup Script...');

    const args = process.argv.slice(2);
    const forceDelete = args.includes('--force');

    if (!forceDelete) {
        console.warn('⚠️  DRY RUN MODE. Use --force to actually delete users.');
    } else {
        console.warn('🚨  DELETION MODE ENABLED. USERS WILL BE PERMANENTLY DELETED.');
        // Add a small delay for safety and chance to cancel
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    let nextPageToken;
    let usersToDelete: string[] = [];
    let count = 0;

    const providersArg = args.find(arg => arg.startsWith('--providers='));
    const targetProviders = providersArg ? providersArg.split('=')[1].split(',') : [];

    if (targetProviders.length > 0) {
        console.log(`Filtering for providers: ${targetProviders.join(', ')}`);
    } else {
        console.log('Targeting ALL providers.');
    }

    do {
        const listUsersResult = await auth.listUsers(1000, nextPageToken);

        for (const user of listUsersResult.users) {
            const providers = user.providerData.map(p => p.providerId);

            // Check if user has ANY of the target providers (or if no target specified, match all)
            const hasTargetProvider = targetProviders.length === 0 || user.providerData.some(p =>
                targetProviders.includes(p.providerId)
            );

            if (hasTargetProvider) {
                console.log(`[MATCH] User ${user.uid} (${user.email || user.phoneNumber}) - Providers: [${providers.join(', ')}]`);
                usersToDelete.push(user.uid);
            }
        }

        nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    console.log(`\nFound ${usersToDelete.length} users matching criteria.`);

    if (usersToDelete.length === 0) {
        console.log('No users found to delete.');
        return;
    }

    if (forceDelete) {
        console.log(`Deleting ${usersToDelete.length} users...`);

        console.log(`Deleting ${usersToDelete.length} users one by one to ensure 'onDelete' triggers/Extensions fire...`);

        let deletedCount = 0;
        let failedCount = 0;
        const CONCURRENCY_LIMIT = 5; // Delete 5 at a time to respect rate limits while being faster than serial

        for (let i = 0; i < usersToDelete.length; i += CONCURRENCY_LIMIT) {
            const chunk = usersToDelete.slice(i, i + CONCURRENCY_LIMIT);

            await Promise.all(chunk.map(async (uid) => {
                try {
                    await auth.deleteUser(uid);
                    deletedCount++;
                    process.stdout.write('.'); // Minimal progress indicator
                } catch (error) {
                    failedCount++;
                    console.error(`\nFailed to delete user ${uid}:`, error);
                }
            }));

            // Optional: slight pause to be gentle on the API if needed, but 5 concurrent is usually fine
        }

        console.log(`\n\nDeletion complete.`);
        console.log(`Successfully deleted: ${deletedCount}`);
        console.log(`Failed to delete: ${failedCount}`);
        console.log('Deletion complete.');
    } else {
        console.log(`Dry run complete. Run with --force to delete these ${usersToDelete.length} users.`);
    }
}

// Only run if called directly
if (require.main === module) {
    run().catch(console.error);
}
