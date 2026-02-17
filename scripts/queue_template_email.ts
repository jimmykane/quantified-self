import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const MAIL_COLLECTION = 'mail';
const DEFAULT_FROM = 'Quantified Self <hello@quantified-self.io>';

function getArgValue(args: string[], key: string): string | undefined {
    const prefix = `--${key}=`;
    const item = args.find((arg) => arg.startsWith(prefix));
    return item ? item.slice(prefix.length) : undefined;
}

function printUsage(): void {
    console.log('Usage: npx ts-node scripts/queue_template_email.ts --email=target@example.com --template=development_update [--data=\'{"first_name":"Jimmy"}\'] [--from="Quantified Self <hello@quantified-self.io>"] [--force]');
    console.log('Default mode is DRY RUN. Add --force to actually queue the email.');
}

function parseDataJson(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            throw new Error('Data must be a JSON object');
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        throw new Error(`Invalid --data JSON: ${(error as Error).message}`);
    }
}

function getServiceAccountPath(): string {
    const candidates = [
        path.resolve(__dirname, '../functions/service-account.json'),
        path.resolve(__dirname, '../quantified-self-io-firebase-adminsdk.json')
    ];

    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
        throw new Error('No service account file found. Expected functions/service-account.json or quantified-self-io-firebase-adminsdk.json');
    }
    return found;
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);
    const email = getArgValue(args, 'email');
    const template = getArgValue(args, 'template');
    const data = parseDataJson(getArgValue(args, 'data'));
    const from = getArgValue(args, 'from') || DEFAULT_FROM;
    const force = args.includes('--force');

    if (!email || !template) {
        printUsage();
        process.exit(1);
    }

    const payload = {
        to: email,
        from,
        template: {
            name: template,
            data
        },
        sent: false
    };

    if (!force) {
        console.log('[DRY RUN] Email was not queued. Add --force to queue it.');
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    if (!admin.apps.length) {
        const serviceAccountPath = getServiceAccountPath();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const serviceAccount = require(serviceAccountPath);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
        });
    }

    const db = admin.firestore();
    await db.collection(MAIL_COLLECTION).add(payload);
    console.log(`Queued template "${template}" to "${email}" in "${MAIL_COLLECTION}" collection.`);
}

run().catch((error) => {
    console.error('Failed to queue template email:', error);
    process.exit(1);
});
