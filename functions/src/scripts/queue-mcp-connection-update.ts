import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';
import pLimit from 'p-limit';
import {
    FOUNDER_EMAIL_FROM,
    FOUNDER_EMAIL_REPLY_TO,
} from '../email/config';
import {
    MANUAL_CAMPAIGN_EMAIL_TEMPLATE_CATALOG,
    MCP_CONNECTION_UPDATE_TEMPLATE_ID,
} from '../email/template-catalog';
import { createLocalEmailTemplateRenderer } from '../email/template-renderer';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../admin/shared/subscription.constants';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

const CAMPAIGN_ID = 'mcp_connection_update_2026_08';
const MAIL_COLLECTION = 'mail';
const USER_DELETION_TOMBSTONES_COLLECTION = 'userDeletionTombstones';
const PRODUCTION_PROJECT_ID = 'quantified-self-io';
const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates');
const MAX_AUTH_LOOKUP_BATCH_SIZE = 100;
const MAX_FIRESTORE_LOOKUP_BATCH_SIZE = 100;

type PaidRole = 'basic' | 'pro';

interface QueueOptions {
    projectId: string;
    dryRun: boolean;
    expectedRecipientCount?: number;
    concurrency: number;
}

interface ActiveSubscriptionRecord {
    uid: string;
    role: PaidRole;
}

interface CampaignRecipient {
    uid: string;
    role: PaidRole;
    email: string;
    firstName: string;
}

interface RecipientResolution {
    recipients: CampaignRecipient[];
    subscriptionOwners: number;
    skippedMissingOrDisabledAuth: number;
    skippedMissingUserDocument: number;
    skippedDeletionMarked: number;
    basicCount: number;
    proCount: number;
}

interface CampaignMailDocument {
    to: string;
    toUids: string[];
    from: string;
    replyTo: string;
    message: {
        subject: string;
        html: string;
        text: string;
    };
    campaign: {
        id: string;
        templateId: string;
        role: PaidRole;
        queuedAt: admin.firestore.FieldValue;
    };
    expireAt: admin.firestore.Timestamp;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new Error(`Invalid boolean value '${value}'. Expected true or false.`);
}

function parsePositiveInteger(value: string | undefined, optionName: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!/^\d+$/.test(value)) {
        throw new Error(`Invalid --${optionName} value '${value}'. Expected a non-negative integer.`);
    }
    return Number.parseInt(value, 10);
}

function getSingleOptionValue(args: readonly string[], optionName: string): string | undefined {
    const prefix = `--${optionName}=`;
    const matches = args.filter(argument => argument.startsWith(prefix));
    if (matches.length > 1) {
        throw new Error(`--${optionName} may be provided only once.`);
    }
    return matches[0]?.slice(prefix.length);
}

export function parseQueueOptions(args: readonly string[]): QueueOptions {
    const supportedPrefixes = [
        '--project=',
        '--dry-run=',
        '--expected-recipients=',
        '--concurrency=',
    ];
    if (args.some(argument => !supportedPrefixes.some(prefix => argument.startsWith(prefix)))) {
        throw new Error(
            'Usage: npm run queue-mcp-connection-update -- --project=quantified-self-io [--dry-run=false --expected-recipients=COUNT] [--concurrency=1..20]',
        );
    }

    const projectId = getSingleOptionValue(args, 'project')?.trim();
    const dryRun = parseBoolean(getSingleOptionValue(args, 'dry-run'), true);
    const expectedRecipientCount = parsePositiveInteger(
        getSingleOptionValue(args, 'expected-recipients'),
        'expected-recipients',
    );
    const concurrency = parsePositiveInteger(getSingleOptionValue(args, 'concurrency'), 'concurrency') ?? 10;

    if (!projectId || concurrency < 1 || concurrency > 20) {
        throw new Error(
            'Usage: npm run queue-mcp-connection-update -- --project=quantified-self-io [--dry-run=false --expected-recipients=COUNT] [--concurrency=1..20]',
        );
    }
    if (!dryRun && projectId !== PRODUCTION_PROJECT_ID) {
        throw new Error(`Refusing to queue this campaign outside ${PRODUCTION_PROJECT_ID}.`);
    }
    if (!dryRun && expectedRecipientCount === undefined) {
        throw new Error('--expected-recipients is required when --dry-run=false. Run dry-run first.');
    }

    return {
        projectId,
        dryRun,
        ...(expectedRecipientCount === undefined ? {} : { expectedRecipientCount }),
        concurrency,
    };
}

function chooseHigherPaidRole(current: PaidRole | undefined, candidate: PaidRole): PaidRole {
    return current === 'pro' || candidate === 'pro' ? 'pro' : 'basic';
}

export function deduplicateActivePaidSubscriptions(
    subscriptions: readonly ActiveSubscriptionRecord[],
): Map<string, PaidRole> {
    const rolesByUid = new Map<string, PaidRole>();
    for (const subscription of subscriptions) {
        rolesByUid.set(
            subscription.uid,
            chooseHigherPaidRole(rolesByUid.get(subscription.uid), subscription.role),
        );
    }
    return rolesByUid;
}

function firstNameFromDisplayName(displayName: string | undefined): string {
    const firstName = displayName?.trim().split(/\s+/, 1)[0] ?? '';
    return firstName.slice(0, 80);
}

function getTimestampMillis(value: unknown): number | null {
    if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis();
    }
    return null;
}

function hasActiveDeletionMarker(snapshot: admin.firestore.DocumentSnapshot, nowMs: number): boolean {
    if (!snapshot.exists) {
        return false;
    }
    const expiresAtMs = getTimestampMillis(snapshot.data()?.expireAt);
    return expiresAtMs === null || expiresAtMs > nowMs;
}

function splitIntoBatches<T>(values: readonly T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let start = 0; start < values.length; start += batchSize) {
        batches.push(values.slice(start, start + batchSize));
    }
    return batches;
}

async function loadAuthUsersByUid(
    auth: admin.auth.Auth,
    uids: readonly string[],
): Promise<Map<string, admin.auth.UserRecord>> {
    const usersByUid = new Map<string, admin.auth.UserRecord>();
    for (const batch of splitIntoBatches(uids, MAX_AUTH_LOOKUP_BATCH_SIZE)) {
        const result = await auth.getUsers(batch.map(uid => ({ uid })));
        for (const user of result.users) {
            usersByUid.set(user.uid, user);
        }
    }
    return usersByUid;
}

async function loadUserStateByUid(
    db: admin.firestore.Firestore,
    uids: readonly string[],
): Promise<Map<string, { userExists: boolean; deletionMarked: boolean }>> {
    const states = new Map<string, { userExists: boolean; deletionMarked: boolean }>();
    const nowMs = Date.now();
    for (const batch of splitIntoBatches(uids, MAX_FIRESTORE_LOOKUP_BATCH_SIZE)) {
        const refs = batch.flatMap(uid => [
            db.collection('users').doc(uid),
            db.collection(USER_DELETION_TOMBSTONES_COLLECTION).doc(uid),
        ]);
        const snapshots = await db.getAll(...refs);
        batch.forEach((uid, index) => {
            const userSnapshot = snapshots[index * 2];
            const deletionSnapshot = snapshots[index * 2 + 1];
            states.set(uid, {
                userExists: userSnapshot?.exists === true,
                deletionMarked: deletionSnapshot ? hasActiveDeletionMarker(deletionSnapshot, nowMs) : false,
            });
        });
    }
    return states;
}

async function resolveRecipients(
    db: admin.firestore.Firestore,
    auth: admin.auth.Auth,
): Promise<RecipientResolution> {
    const subscriptions = await db.collectionGroup('subscriptions')
        .where('status', 'in', [...ACTIVE_SUBSCRIPTION_STATUSES])
        .select('role')
        .get();
    const activeSubscriptions: ActiveSubscriptionRecord[] = [];
    for (const subscription of subscriptions.docs) {
        const uid = subscription.ref.parent.parent?.id;
        const role = subscription.get('role');
        if (!uid || (role !== 'basic' && role !== 'pro')) {
            continue;
        }
        activeSubscriptions.push({ uid, role });
    }

    const rolesByUid = deduplicateActivePaidSubscriptions(activeSubscriptions);
    const uids = [...rolesByUid.keys()];
    const [authUsersByUid, userStatesByUid] = await Promise.all([
        loadAuthUsersByUid(auth, uids),
        loadUserStateByUid(db, uids),
    ]);

    const recipients: CampaignRecipient[] = [];
    let skippedMissingOrDisabledAuth = 0;
    let skippedMissingUserDocument = 0;
    let skippedDeletionMarked = 0;
    let basicCount = 0;
    let proCount = 0;

    for (const uid of uids) {
        const user = authUsersByUid.get(uid);
        if (!user?.email || user.disabled) {
            skippedMissingOrDisabledAuth++;
            continue;
        }
        const userState = userStatesByUid.get(uid);
        if (!userState?.userExists) {
            skippedMissingUserDocument++;
            continue;
        }
        if (userState.deletionMarked) {
            skippedDeletionMarked++;
            continue;
        }
        const role = rolesByUid.get(uid)!;
        recipients.push({
            uid,
            role,
            email: user.email,
            firstName: firstNameFromDisplayName(user.displayName),
        });
        if (role === 'basic') {
            basicCount++;
        } else {
            proCount++;
        }
    }

    return {
        recipients,
        subscriptionOwners: rolesByUid.size,
        skippedMissingOrDisabledAuth,
        skippedMissingUserDocument,
        skippedDeletionMarked,
        basicCount,
        proCount,
    };
}

export function buildCampaignMailDocument(recipient: CampaignRecipient): CampaignMailDocument {
    const template = MANUAL_CAMPAIGN_EMAIL_TEMPLATE_CATALOG.find(
        entry => entry.id === MCP_CONNECTION_UPDATE_TEMPLATE_ID,
    );
    if (!template) {
        throw new Error(`Missing ${MCP_CONNECTION_UPDATE_TEMPLATE_ID} template.`);
    }
    const message = createLocalEmailTemplateRenderer(TEMPLATE_ROOT).render(template, {
        first_name: recipient.firstName,
        mcp_settings_url: 'https://quantified-self.io/services?serviceName=mcp&utm_source=mcp_connection_update_email&utm_medium=email&utm_campaign=mcp_connection_update&utm_content=connection_settings',
    });

    return {
        to: recipient.email,
        toUids: [recipient.uid],
        from: FOUNDER_EMAIL_FROM,
        replyTo: FOUNDER_EMAIL_REPLY_TO,
        message,
        campaign: {
            id: CAMPAIGN_ID,
            templateId: MCP_CONNECTION_UPDATE_TEMPLATE_ID,
            role: recipient.role,
            queuedAt: FieldValue.serverTimestamp(),
        },
        expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
    };
}

function campaignMailDocumentId(uid: string): string {
    return `${CAMPAIGN_ID}_${Buffer.from(uid).toString('base64url')}`;
}

async function queueRecipient(
    db: admin.firestore.Firestore,
    recipient: CampaignRecipient,
): Promise<'queued' | 'already-queued'> {
    const mailRef = db.collection(MAIL_COLLECTION).doc(campaignMailDocumentId(recipient.uid));
    return db.runTransaction(async transaction => {
        const existing = await transaction.get(mailRef);
        if (existing.exists) {
            return 'already-queued';
        }
        transaction.create(mailRef, buildCampaignMailDocument(recipient));
        return 'queued';
    });
}

export async function queueMcpConnectionUpdate(options: QueueOptions): Promise<void> {
    if (admin.apps.length === 0) {
        admin.initializeApp({
            projectId: options.projectId,
            databaseURL: `https://${options.projectId}.firebaseio.com`,
        });
    }
    const db = admin.firestore();
    const resolution = await resolveRecipients(db, admin.auth());
    const summary = {
        campaignId: CAMPAIGN_ID,
        subscriptionOwners: resolution.subscriptionOwners,
        eligibleRecipients: resolution.recipients.length,
        basicRecipients: resolution.basicCount,
        proRecipients: resolution.proCount,
        skippedMissingOrDisabledAuth: resolution.skippedMissingOrDisabledAuth,
        skippedMissingUserDocument: resolution.skippedMissingUserDocument,
        skippedDeletionMarked: resolution.skippedDeletionMarked,
        dryRun: options.dryRun,
    };
    console.log(JSON.stringify(summary));

    if (options.dryRun) {
        return;
    }
    if (options.expectedRecipientCount !== resolution.recipients.length) {
        throw new Error(
            `Recipient count changed from expected ${options.expectedRecipientCount} to ${resolution.recipients.length}. Refusing to queue mail.`,
        );
    }

    const limit = pLimit(options.concurrency);
    const results = await Promise.all(resolution.recipients.map(recipient => limit(
        () => queueRecipient(db, recipient),
    )));
    const queued = results.filter(result => result === 'queued').length;
    const alreadyQueued = results.length - queued;
    console.log(JSON.stringify({ campaignId: CAMPAIGN_ID, queued, alreadyQueued }));
}

if (require.main === module) {
    try {
        queueMcpConnectionUpdate(parseQueueOptions(process.argv.slice(2))).catch(error => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
