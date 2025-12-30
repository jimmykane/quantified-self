
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

    const TARGET_PROVIDERS = ['phone', 'twitter.com'];

    do {
        const listUsersResult = await auth.listUsers(1000, nextPageToken);

        for (const user of listUsersResult.users) {
            const providers = user.providerData.map(p => p.providerId);

            // Check if user has ANY of the target providers
            const hasTargetProvider = user.providerData.some(p =>
                TARGET_PROVIDERS.includes(p.providerId)
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

        // Batch delete in chunks of 1000 (Firebase limit)
        const chunkSize = 1000;
        for (let i = 0; i < usersToDelete.length; i += chunkSize) {
            const chunk = usersToDelete.slice(i, i + chunkSize);
            try {
                const result = await auth.deleteUsers(chunk);
                console.log(`Only deleted ${result.successCount} users. Failed to delete ${result.failureCount} users.`);

                if (result.failureCount > 0) {
                    result.errors.forEach(err => {
                        console.error(`Failed to delete user ${err.index}: ${err.error.toJSON()}`);
                    });
                }
            } catch (error) {
                console.error('Error deleting users:', error);
            }
        }
        console.log('Deletion complete.');
    } else {
        console.log(`Dry run complete. Run with --force to delete these ${usersToDelete.length} users.`);
    }
}

// Only run if called directly
if (require.main === module) {
    run().catch(console.error);
}
