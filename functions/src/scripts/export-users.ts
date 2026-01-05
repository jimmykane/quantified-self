import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

interface UserExport {
    email: string;
    firstName: string;
    lastName: string;
}

async function exportUsers() {
    const allUsers: UserExport[] = [];
    let nextPageToken: string | undefined;

    console.log('Starting user export...');

    try {
        do {
            const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);

            listUsersResult.users.forEach((userRecord) => {
                if (userRecord.email) {
                    const displayName = userRecord.displayName || '';
                    // Split the name by spaces
                    const nameParts = displayName.trim().split(/\s+/);

                    let firstName = 'Unknown';
                    let lastName = '';

                    if (displayName) {
                        // First part is first name
                        firstName = nameParts.shift() || 'Unknown';
                        // Join the rest as last name
                        lastName = nameParts.join(' ');
                    }

                    allUsers.push({
                        email: userRecord.email,
                        firstName: firstName,
                        lastName: lastName
                    });
                }
            });

            nextPageToken = listUsersResult.pageToken;
            process.stdout.write(`\rFetched ${allUsers.length} users...`);
        } while (nextPageToken);

        console.log('\nFinished fetching users.');

        const csvContent = [
            'Email,FirstName,LastName',
            ...allUsers.map(u => `"${u.email}","${u.firstName}","${u.lastName}"`)
        ].join('\n');

        const outputPath = path.join(process.cwd(), 'users_export.csv');
        fs.writeFileSync(outputPath, csvContent);

        console.log(`Successfully exported ${allUsers.length} users to ${outputPath}`);
        process.exit(0);

    } catch (error) {
        console.error('Error exporting users:', error);
        process.exit(1);
    }
}

exportUsers();
