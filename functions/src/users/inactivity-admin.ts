import type { Auth } from 'firebase-admin/auth';
import { FieldPath, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { INACTIVITY_ADMIN_PAGE_SIZE, INACTIVITY_ADMIN_VIEWS, INACTIVITY_DELETION_LIMIT,
    INACTIVITY_MODES, INACTIVITY_WARNING_LIMIT, type InactivityAdminRequest, type InactivityAdminResponse } from '../../../shared/admin-inactivity';
import { INACTIVITY_COLLECTION, INACTIVITY_CONTROL, INACTIVITY_DAY_MS, inactivityMode, timestampMillis, warningAcceptedAt } from './inactivity-policy';

export function inactivityAdminRequest(value: unknown): InactivityAdminRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Choose an account view.');
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some(key => !['view', 'afterUid'].includes(key))
        || !INACTIVITY_ADMIN_VIEWS.includes(data.view as InactivityAdminRequest['view'])
        || (data.afterUid !== undefined && (typeof data.afterUid !== 'string' || !data.afterUid.length
            || data.afterUid.length > 128 || data.afterUid.includes('/') || ['.', '..'].includes(data.afterUid)))) {
        throw new HttpsError('invalid-argument', 'Invalid account view or cursor.');
    }
    return data as unknown as InactivityAdminRequest;
}
const count = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
const bounded = (value: unknown, maximum: number): boolean => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
const date = (snapshot: DocumentSnapshot, key: string) => timestampMillis(snapshot.get(key));

/** Privileged, bounded projection: Auth supplies current emails; private evidence, leases,
 * mail payloads and billing identities never enter the browser response. No writes. */
export async function readInactivityAdmin(db: Firestore, auth: Pick<Auth, 'getUsers'>,
    request: InactivityAdminRequest, now = Date.now()): Promise<InactivityAdminResponse> {
    const pending = request.view === 'pending-deletion';
    let query = pending
        ? db.collection('userDeletionTombstones').where('source', '==', 'inactivity').where('cleanupStatus', '==', 'pending')
        : db.collectionGroup(INACTIVITY_COLLECTION).where('state', '==', request.view);
    query = query.orderBy(FieldPath.documentId()).limit(INACTIVITY_ADMIN_PAGE_SIZE + 1);
    if (request.afterUid) query = query.startAfter(pending ? request.afterUid : `users/${request.afterUid}/${INACTIVITY_COLLECTION}/state`);
    const [config, page] = await Promise.all([db.doc(INACTIVITY_CONTROL).get(), query.get()]);
    const selected = page.docs.slice(0, INACTIVITY_ADMIN_PAGE_SIZE).map(doc => {
        const uid = pending ? doc.id : doc.ref.parent.parent?.id;
        if (!uid || !pending && (doc.ref.path !== `users/${uid}/${INACTIVITY_COLLECTION}/state` || doc.get('uid') !== uid))
            throw new Error('invalid_inactivity_owner');
        return { uid, doc };
    });
    const identities = selected.length ? await auth.getUsers(selected.map(({ uid }) => ({ uid }))) : { users: [] };
    const users = new Map(identities.users.map(user => [user.uid, user]));
    const accounts = await Promise.all(selected.map(async ({ uid, doc }) => {
        const user = users.get(uid);
        const queuedAt = date(doc, 'queuedAt');
        let detail = request.view === 'cancelled' ? 'Notice cancelled after eligibility changed.'
            : request.view === 'warned' ? 'Notice accepted; eligibility is checked again before deletion.' : 'Awaiting confirmed warning delivery.';
        if (pending) {
            const created = date(doc, 'createdAt');
            detail = created === null || created + INACTIVITY_DAY_MS < now ? 'Deletion needs operator review.' : 'Deletion initiated; background cleanup is pending.';
            if (doc.get('authDeleteStatus') === 'prepared') detail = created === null || created + INACTIVITY_DAY_MS < now
                ? 'Deletion prepared but not attempted; operator review required.' : 'Deletion prepared; awaiting Auth deletion.';
        } else if ((date(doc, 'expireAt') ?? 0) <= now) detail = 'Evidence expired; a new warning is required.';
        else if (request.view === 'queued') {
            const mailId = doc.get('mailId');
            const mail = typeof mailId === 'string' && /^inactivity_[A-Za-z0-9-]+$/.test(mailId) ? await db.doc(`mail/${mailId}`).get() : null;
            if (user?.email && queuedAt !== null && warningAcceptedAt(mail?.data() ?? {}, uid, doc.get('generation'), user.email, queuedAt, now) !== null)
                detail = 'Warning accepted; awaiting the next daily check.';
            else if (!mail?.exists || ['ERROR', 'SUCCESS'].includes(mail.get('delivery.state')) || queuedAt === null || queuedAt + INACTIVITY_DAY_MS < now)
                detail = 'Warning delivery unconfirmed; deletion is blocked.';
        }
        return { uid, email: user?.email ?? null, authPresent: !!user, queuedAt, acceptedAt: date(doc, 'acceptedAt'),
            deleteAfter: date(doc, 'deleteAfter'), requestedAt: pending ? date(doc, 'createdAt') : null, detail };
    }));
    const warningDailyLimit = config.get('warningDailyLimit') === undefined ? INACTIVITY_WARNING_LIMIT : config.get('warningDailyLimit');
    const deletionDailyLimit = config.get('deletionDailyLimit') === undefined ? INACTIVITY_DELETION_LIMIT : config.get('deletionDailyLimit');
    const revision = config.get('settingsRevision') === undefined ? 0 : config.get('settingsRevision');
    const lastRunFinishedAt = timestampMillis(config.get('lastRun.finishedAt'));
    const lastRunOutcome = config.get('lastRun.outcome');
    const last = (key: string) => count(config.get(`lastRun.${key}`));
    const today = new Date(now).toISOString().slice(0, 10);
    const lastDoc = page.docs[INACTIVITY_ADMIN_PAGE_SIZE - 1];
    return {
        settings: { mode: inactivityMode(config.get('mode')), warningDailyLimit: bounded(warningDailyLimit, INACTIVITY_WARNING_LIMIT) ? warningDailyLimit : 0,
            deletionDailyLimit: bounded(deletionDailyLimit, INACTIVITY_DELETION_LIMIT) ? deletionDailyLimit : 0, revision: count(revision) },
        settingsValid: (config.get('mode') === undefined || INACTIVITY_MODES.includes(config.get('mode')))
            && bounded(warningDailyLimit, INACTIVITY_WARNING_LIMIT) && bounded(deletionDailyLimit, INACTIVITY_DELETION_LIMIT) && bounded(revision, Number.MAX_SAFE_INTEGER - 1),
        running: (date(config, 'leaseUntil') ?? 0) > now,
        lastStartedAt: date(config, 'lastStartedAt'), lastFinishedAt: date(config, 'lastFinishedAt'), lastScanCompletedAt: date(config, 'lastScanCompletedAt'),
        budgetDay: today, warningsReserved: config.get('budgetDay') === today ? count(config.get('warnings')) : 0,
        deletionsReserved: config.get('budgetDay') === today ? count(config.get('deletions')) : 0,
        lastRun: lastRunFinishedAt !== null && ['completed', 'failed'].includes(lastRunOutcome) ? {
            finishedAt: lastRunFinishedAt, outcome: lastRunOutcome, queued: last('counts.queued'), accepted: last('counts.accepted'),
            deletionRequested: last('counts.deletion_requested'), blocked: last('counts.blocked'), failed: last('counts.failed'),
            noticeUnconfirmed: last('counts.notice_unconfirmed'), overdue: last('overdue'), reviewRequired: last('reviewRequired'), capped: config.get('lastRun.capped') === true,
        } : null,
        accounts, nextUid: page.size > INACTIVITY_ADMIN_PAGE_SIZE ? (pending ? lastDoc.id : lastDoc.ref.parent.parent!.id) : null,
    };
}
