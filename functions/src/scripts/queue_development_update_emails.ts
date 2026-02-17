import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

// Initialize Firebase Admin
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const CSV_FILE_PATH = path.join(__dirname, '../../users_export.csv');
const MAIL_COLLECTION = 'mail'; // As per extensions/firestore-send-email.env
const TRACKING_COLLECTION = 'development_update_email_tracking';
const TEMPLATE_NAME = 'development_update';

interface CsvUser {
    email: string;
    firstName: string;
    lastName: string;
    originalIndex: number;
}

interface ScriptOptions {
    batchSize: number;
    startAt: number;
    dryRun: boolean;
    runId: string;
}

function getArgValue(args: string[], key: string): string | undefined {
    const prefix = `--${key}=`;
    const arg = args.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number, label: string): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(`Invalid --${label} value: "${value}"`);
    }
    return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Invalid boolean value "${value}" (expected true or false)`);
}

function parseOptions(args: string[]): ScriptOptions {
    const batchSize = parsePositiveInt(getArgValue(args, 'batch-size'), 10, 'batch-size');
    const startAt = parsePositiveInt(getArgValue(args, 'start-at'), 0, 'start-at');
    const dryRun = parseBoolean(getArgValue(args, 'dry-run'), true);
    const runId = getArgValue(args, 'run-id') || `dev-update-${new Date().toISOString()}`;

    if (batchSize === 0) {
        throw new Error('Invalid --batch-size value: must be greater than 0');
    }

    return {
        batchSize,
        startAt,
        dryRun,
        runId
    };
}

function parseCsvUsers(fileContent: string): CsvUser[] {
    const lines = fileContent.split('\n');
    const header = lines.shift();
    console.log(`Header: ${header}`);

    const users: CsvUser[] = [];

    lines.forEach((line, index) => {
        if (!line.trim()) return;

        // Parse line: "email","FirstName","LastName"
        const match = line.match(/^"([^"]*)","([^"]*)","([^"]*)"/);
        if (!match) {
            console.warn(`Skipping invalid line: ${line}`);
            return;
        }

        const email = match[1]?.trim();
        const firstName = match[2]?.trim() ?? '';
        const lastName = match[3]?.trim() ?? '';

        if (!email) {
            console.warn(`Skipping missing email: ${line}`);
            return;
        }

        users.push({
            email,
            firstName,
            lastName,
            originalIndex: index
        });
    });

    return users;
}

function getTrackingDocId(email: string): string {
    return encodeURIComponent(email.trim().toLowerCase());
}

async function wasAlreadyQueued(
    db: admin.firestore.Firestore,
    email: string
): Promise<boolean> {
    const trackingDocId = getTrackingDocId(email);
    const trackingRef = db.collection(TRACKING_COLLECTION).doc(trackingDocId);
    const snapshot = await trackingRef.get();
    return snapshot.exists;
}

async function queueSingleEmail(
    db: admin.firestore.Firestore,
    user: CsvUser,
    runId: string
): Promise<'queued' | 'already-queued'> {
    const trackingDocId = getTrackingDocId(user.email);
    const trackingRef = db.collection(TRACKING_COLLECTION).doc(trackingDocId);
    const mailRef = db.collection(MAIL_COLLECTION).doc();

    const result = await db.runTransaction(async (transaction) => {
        const existingTracking = await transaction.get(trackingRef);
        if (existingTracking.exists) {
            return 'already-queued' as const;
        }

        transaction.set(mailRef, {
            to: user.email,
            template: {
                name: TEMPLATE_NAME,
                data: {
                    first_name: user.firstName,
                    last_name: user.lastName
                }
            },
            expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS)
        });

        transaction.set(trackingRef, {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            template: TEMPLATE_NAME,
            runId,
            queuedAt: admin.firestore.FieldValue.serverTimestamp(),
            mailDocumentId: mailRef.id
        });

        return 'queued' as const;
    });

    return result;
}

async function queueEmails() {
    const options = parseOptions(process.argv.slice(2));

    console.log(`Reading CSV from ${CSV_FILE_PATH}...`);
    console.log(
        `Options: batchSize=${options.batchSize}, startAt=${options.startAt}, dryRun=${options.dryRun}, runId=${options.runId}`
    );

    if (!fs.existsSync(CSV_FILE_PATH)) {
        console.error('CSV file not found!');
        process.exit(1);
    }

    const fileContent = fs.readFileSync(CSV_FILE_PATH, 'utf8');
    const users = parseCsvUsers(fileContent);

    if (options.startAt >= users.length) {
        console.log(`No users to process. startAt=${options.startAt} is beyond user count ${users.length}.`);
        return;
    }

    const limit = pLimit(20);
    const db = admin.firestore();
    const candidates = users.slice(options.startAt);

    const selectedUsers: CsvUser[] = [];
    let alreadyQueuedBeforeSelection = 0;

    for (const user of candidates) {
        if (selectedUsers.length >= options.batchSize) break;
        const alreadyQueued = await wasAlreadyQueued(db, user.email);
        if (alreadyQueued) {
            alreadyQueuedBeforeSelection++;
            continue;
        }
        selectedUsers.push(user);
    }

    if (selectedUsers.length === 0) {
        console.log('No unsent users found for the requested window.');
        console.log(
            `Summary: totalCsvUsers=${users.length}, startAt=${options.startAt}, alreadyQueuedInWindow=${alreadyQueuedBeforeSelection}`
        );
        return;
    }

    console.log('\nSelected recipients for this run:');
    selectedUsers.forEach((user, index) => {
        const fullName = `${user.firstName} ${user.lastName}`.trim();
        const namePart = fullName ? ` (${fullName})` : '';
        console.log(
            `${index + 1}. ${user.email}${namePart} [csvIndex=${user.originalIndex}] ` +
            `-> template data: first_name="${user.firstName}", last_name="${user.lastName}"`
        );
    });

    let queuedNow = 0;
    let skippedBecauseRace = 0;
    let failed = 0;

    const tasks = selectedUsers.map((user) => limit(async () => {
        if (options.dryRun) {
            console.log(
                `[DRY RUN] Would queue email to: ${user.email} (${user.firstName} ${user.lastName}) [csvIndex=${user.originalIndex}]`
            );
            return;
        }

        try {
            const status = await queueSingleEmail(db, user, options.runId);
            if (status === 'queued') {
                queuedNow++;
            } else {
                skippedBecauseRace++;
            }
        } catch (error) {
            failed++;
            console.error(`Failed to queue email for ${user.email}:`, error);
        }
    }));

    await Promise.all(tasks);

    const nextSuggestedStartAt = options.startAt + selectedUsers.length;
    console.log('\nRun summary:');
    console.log(`- totalCsvUsers: ${users.length}`);
    console.log(`- startAt: ${options.startAt}`);
    console.log(`- selectedForBatch: ${selectedUsers.length}`);
    console.log(`- alreadyQueuedDuringSelection: ${alreadyQueuedBeforeSelection}`);
    console.log(`- dryRun: ${options.dryRun}`);
    console.log(`- queuedNow: ${options.dryRun ? 0 : queuedNow}`);
    console.log(`- skippedBecauseAlreadyQueuedInTransaction: ${options.dryRun ? 0 : skippedBecauseRace}`);
    console.log(`- failed: ${options.dryRun ? 0 : failed}`);
    console.log(`- nextSuggestedStartAt: ${nextSuggestedStartAt}`);

    if (options.dryRun) {
        console.log('Dry run completed. Use --dry-run=false to perform writes.');
    }
}

queueEmails().catch(console.error);
