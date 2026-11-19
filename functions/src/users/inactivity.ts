import { randomUUID } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { INACTIVITY_DELETION_LIMIT, INACTIVITY_WARNING_LIMIT } from '../../../shared/admin-inactivity';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { acquireBillingLease, releaseBillingLease, type BillingLease } from '../stripe/billing/service';
import { BillingContention } from '../stripe/billing/model';
import { newEmailDeliveryFields } from '../email/queue-metadata';
import { formatEmailDateTime, TRANSACTIONAL_EMAIL_FROM, TRANSACTIONAL_EMAIL_REPLY_TO } from '../email/config';
import { TTL_CONFIG } from '../shared/ttl-config';
import { deleteAuthAccountAndNotify, pendingAccountDeletionMarker } from './initiate-deletion';
import { dryRunDraft, recordDryRunPage } from './inactivity-dry-run';
import { readInactivityBilling, stripeAllowsInactivity, type InactivityBilling } from './inactivity-billing';
import { INACTIVITY_BUDGET_MS, INACTIVITY_COLLECTION, INACTIVITY_CONTINUATION, INACTIVITY_CONTROL, INACTIVITY_DAY_MS,
    INACTIVITY_NOTICE_MS, INACTIVITY_PAGE_SIZE, INACTIVITY_REMINDER_MS, INACTIVITY_TEMPLATE, INACTIVITY_REMINDER_TEMPLATE,
    acceptedNoticeDeadline, finalReminderDue, inactiveIdentity, inactivityMode, timestampMillis, warningAcceptedAt,
    type InactiveIdentity, type InactivityMode } from './inactivity-policy';

export interface InactivityContext { db: Firestore; auth: Auth; stripe: () => Promise<Stripe>; now?: () => number }
export interface InactivityRun { token: string; mode: InactivityMode; revision?: number }
interface InactivityProcessOptions { discoveryOnly?: boolean; reminderFor?: string }
export type InactivityOutcome = 'skipped' | 'eligible' | 'queued' | 'accepted' | 'cancelled' | 'waiting'
    | 'blocked' | 'notice_unconfirmed' | 'capped' | 'contended' | 'deletion_requested' | 'review_required' | 'failed';
const clock = (ctx: InactivityContext) => ctx.now?.() ?? Date.now();
export const inactivityRef = (db: Firestore, uid: string) => db.doc(`users/${uid}/${INACTIVITY_COLLECTION}/state`);
const activeEpisode = (data?: DocumentData) => data?.state === 'queued' || data?.state === 'warned';
const currentEvidence = (data: DocumentData | undefined, now: number) => (timestampMillis(data?.expireAt) ?? 0) > now;
const expiry = (time: number) => Timestamp.fromMillis(time + TTL_CONFIG.MAIL_IN_DAYS * INACTIVITY_DAY_MS);

// A sweep selects work due at its start. A late check on the preceding day
// must not put the reminder opening or the deletion deadline beyond that cutoff.
function nextNoticeCheck(now: number, deadline: number): Timestamp {
    const opens = deadline - INACTIVITY_REMINDER_MS;
    const next = opens > now ? opens : deadline;
    return Timestamp.fromMillis(next > now ? Math.min(next, now + INACTIVITY_DAY_MS) : now + INACTIVITY_DAY_MS);
}

function matchesRun(config: DocumentSnapshot, run: InactivityRun): boolean {
    return config.get('leaseToken') === run.token && inactivityMode(config.get('mode')) === run.mode
        && (run.revision === undefined || (config.get('settingsRevision') ?? 0) === run.revision);
}
function leaseActive(config: DocumentSnapshot, now: number): boolean {
    return (timestampMillis(config.get('leaseUntil')) ?? 0) > now;
}
async function validRun(ctx: InactivityContext, tx: Transaction, run: InactivityRun): Promise<DocumentSnapshot | null> {
    const config = await tx.get(ctx.db.doc(INACTIVITY_CONTROL));
    return matchesRun(config, run) && leaseActive(config, clock(ctx)) ? config : null;
}
function consumeBudget(tx: Transaction, config: DocumentSnapshot, kind: 'warnings' | 'deletions', now: number): boolean {
    const maximum = kind === 'warnings' ? INACTIVITY_WARNING_LIMIT : INACTIVITY_DELETION_LIMIT;
    const configured = config.get(kind === 'warnings' ? 'warningDailyLimit' : 'deletionDailyLimit');
    const limit = configured === undefined ? maximum : configured;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > maximum) throw new Error('invalid_inactivity_limit');
    const day = new Date(now).toISOString().slice(0, 10);
    const sameDay = config.get('budgetDay') === day;
    const used = sameDay ? (config.get(kind) ?? 0) : 0;
    if (!Number.isSafeInteger(used) || used < 0) throw new Error('invalid_inactivity_budget');
    if (used >= limit) {
        // Later continuation batches can replace lastRun even though this day's allowance still blocks work.
        const revision = config.get('settingsRevision') ?? 0;
        const mode = config.get('mode');
        if (config.get('lastDailyLimit.day') !== day || config.get('lastDailyLimit.revision') !== revision
            || config.get('lastDailyLimit.mode') !== mode) {
            tx.update(config.ref, { lastDailyLimit: { day, revision, mode } });
        }
        return false;
    }
    tx.update(config.ref, { budgetDay: day, ...(!sameDay ? { warnings: 0, deletions: 0 } : {}), [kind]: used + 1 });
    return true;
}
async function leaseValid(tx: Transaction, lease: BillingLease, now: number): Promise<boolean> {
    const current = await tx.get(lease.ref);
    return current.get('token') === lease.token && timestampMillis(current.get('until'))! > now;
}

/** No writes for missing/deleting accounts; cancelled state contains no recipient address. */
async function updateEpisode(ctx: InactivityContext, uid: string, generation: string, run: InactivityRun,
    patch: DocumentData): Promise<boolean> {
    return ctx.db.runTransaction(async tx => {
        const [guard, config, episode] = await Promise.all([
            getUserDeletionGuardStateInTransaction(ctx.db, tx, uid, clock(ctx)), validRun(ctx, tx, run), tx.get(inactivityRef(ctx.db, uid)),
        ]);
        if (guard.shouldSkip || !config || episode.get('generation') !== generation || !activeEpisode(episode.data())) return false;
        tx.update(episode.ref, patch);
        return true;
    });
}
const cancellation = () => ({ state: 'cancelled', nextCheckAt: FieldValue.delete(), cancelledAt: FieldValue.serverTimestamp() });

/** Remove only our unattempted fence. Auth deletion/cleanup can never have been started by
 * this episode at this point; a competing deleteSelf/cleanup changes the marker and wins. */
async function abandonPreparedDeletion(ctx: InactivityContext, uid: string, generation: string): Promise<void> {
    await ctx.db.runTransaction(async tx => {
        const marker = await tx.get(ctx.db.doc(`userDeletionTombstones/${uid}`));
        const episode = await tx.get(inactivityRef(ctx.db, uid));
        const user = await tx.get(ctx.db.doc(`users/${uid}`));
        if (marker.get('source') !== 'inactivity' || marker.get('inactivityGeneration') !== generation
            || marker.get('authDeleteStatus') !== 'prepared' || marker.get('cleanupAttemptId')
            || marker.get('cleanupStatus') !== 'pending') return;
        // Prepared-only marker is a leaf: checkpoint children require cleanupAttemptId,
        // whose transactional write conflicts with this read. Never delete a cleanup tree.
        tx.delete(marker.ref);
        if (user.exists && episode.get('generation') === generation) tx.update(episode.ref, cancellation());
    });
}

async function prepareMutation(ctx: InactivityContext, uid: string, run: InactivityRun, lease: BillingLease,
    billing: InactivityBilling, identity: InactiveIdentity, previous: DocumentSnapshot,
    mutation: 'warning' | 'reminder' | 'deletion'): Promise<InactivityOutcome> {
    const deleting = mutation === 'deletion';
    const reminding = mutation === 'reminder';
    const generation = mutation === 'warning' ? randomUUID() : previous.get('generation') as string;
    const mailRef = ctx.db.collection('mail').doc(`inactivity_${reminding ? 'reminder_' : ''}${generation}`);
    return ctx.db.runTransaction(async tx => {
        const [guard, config, current, currentBilling, ownsLease, marker] = await Promise.all([
            getUserDeletionGuardStateInTransaction(ctx.db, tx, uid, clock(ctx)), validRun(ctx, tx, run),
            tx.get(inactivityRef(ctx.db, uid)), readInactivityBilling(ctx.db, uid, clock(ctx), tx), leaseValid(tx, lease, clock(ctx)),
            tx.get(ctx.db.doc(`userDeletionTombstones/${uid}`)),
        ]);
        if (guard.shouldSkip || !config || !ownsLease || marker.exists || !currentBilling.eligible
            || currentBilling.revision !== billing.revision
            || (current.exists !== previous.exists)
            || (current.exists && !current.updateTime!.isEqual(previous.updateTime!))) return 'skipped';
        // Guard reads or a transaction retry can cross UTC midnight. Charge the
        // current attempt's day and use that same time for its persisted timestamps.
        const now = clock(ctx);
        const episode = current.data();
        const deadline = episode ? acceptedNoticeDeadline(episode, now) : null;
        if (deleting && (run.mode !== 'enforce' || episode?.state !== 'warned' || !currentEvidence(episode, now)
            || deadline === null || deadline > now)) return 'blocked';
        if (reminding && !finalReminderDue(episode, now)) return 'skipped';
        if (!consumeBudget(tx, config, deleting ? 'deletions' : 'warnings', now)) {
            // Yield the due position so newer receipts can be observed. Reminders
            // become eligible again when the UTC warning allowance resets.
            if (reminding || deleting) {
                const nextDay = (Math.floor(now / INACTIVITY_DAY_MS) + 1) * INACTIVITY_DAY_MS;
                const retry = reminding ? Math.min(deadline!, nextDay) : now + INACTIVITY_DAY_MS;
                tx.update(current.ref, { nextCheckAt: Timestamp.fromMillis(retry) });
            }
            return 'capped';
        }
        if (deleting) {
            tx.set(marker.ref, { ...pendingAccountDeletionMarker('inactivity'), inactivityGeneration: generation, authDeleteStatus: 'prepared' }, { merge: true });
            tx.update(current.ref, { state: 'deletion_requested', requestedAt: Timestamp.fromMillis(now), nextCheckAt: FieldValue.delete() });
            return 'deletion_requested';
        }
        if (reminding) tx.update(current.ref, { reminderMailId: mailRef.id, reminderQueuedAt: Timestamp.fromMillis(now),
            nextCheckAt: nextNoticeCheck(now, deadline!) });
        else tx.set(inactivityRef(ctx.db, uid), { uid, generation, state: 'queued', activityAt: identity.activityAt,
            authCreatedAt: identity.createdAt, emailHash: identity.emailHash, billingRevision: billing.revision,
            mailId: mailRef.id, queuedAt: Timestamp.fromMillis(now), nextCheckAt: Timestamp.fromMillis(now + INACTIVITY_DAY_MS), expireAt: expiry(now) });
        tx.create(mailRef, { ...newEmailDeliveryFields(), uid, to: identity.email,
            from: TRANSACTIONAL_EMAIL_FROM, replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
            template: { name: reminding ? INACTIVITY_REMINDER_TEMPLATE : INACTIVITY_TEMPLATE,
                data: { login_url: 'https://quantified-self.io/login', support_email: TRANSACTIONAL_EMAIL_REPLY_TO,
                    ...(reminding ? { deletion_deadline: formatEmailDateTime(new Date(deadline!)) } : {}) } },
            inactivity: { generation }, expireAt: expiry(now) });
        return 'queued';
    });
}

export async function processInactiveAccount(ctx: InactivityContext, uid: string, run: InactivityRun,
    options: InactivityProcessOptions = {}): Promise<InactivityOutcome> {
    if (run.mode === 'off') return 'skipped';
    const episodeRef = inactivityRef(ctx.db, uid);
    const previous = await episodeRef.get();
    const episode = previous.data();
    if (options.reminderFor !== undefined && (episode?.generation !== options.reminderFor || !finalReminderDue(episode, clock(ctx)))) return 'skipped';
    if (episode?.state === 'deletion_requested') return 'review_required'; // Never repeat an uncertain destructive call.
    // Existing notices belong to the due lane. Revisiting them during Auth discovery
    // could exhaust its time/budget and hide new candidates behind capped deletions.
    if (options.discoveryOnly && activeEpisode(episode)) return 'skipped';
    const identity = inactiveIdentity(await ctx.auth.getUser(uid), clock(ctx));
    const local = await readInactivityBilling(ctx.db, uid, clock(ctx));
    const deadline = episode?.state === 'warned' ? acceptedNoticeDeadline(episode, clock(ctx)) : null;
    const changed = !identity || !local.eligible || (episode?.state === 'warned' && deadline === null)
        || activeEpisode(episode) && (!currentEvidence(episode, clock(ctx)) ||
        identity.activityAt !== episode!.activityAt || identity.createdAt !== episode!.authCreatedAt
        || identity.emailHash !== episode!.emailHash || local.revision !== episode!.billingRevision);
    if (changed) {
        if (run.mode !== 'dry-run' && activeEpisode(episode)
            && await updateEpisode(ctx, uid, episode!.generation, run, cancellation())) return 'cancelled';
        return identity && !local.eligible ? 'blocked' : 'skipped';
    }
    if (episode?.state === 'queued') {
        const mailRef = ctx.db.collection('mail').doc(episode.mailId);
        const mail = await mailRef.get();
        const queued = timestampMillis(episode.queuedAt);
        const accepted = queued === null ? null : warningAcceptedAt(mail.data() ?? {}, uid, episode.generation, identity.email, queued, clock(ctx));
        if (run.mode === 'dry-run') return accepted === null ? 'blocked' : 'eligible';
        if (accepted === null) {
            await updateEpisode(ctx, uid, episode.generation, run, { nextCheckAt: Timestamp.fromMillis(clock(ctx) + INACTIVITY_DAY_MS) });
            return ['ERROR', 'SUCCESS'].includes(mail.get('delivery.state')) || !mail.exists
                || queued === null || clock(ctx) - queued > INACTIVITY_DAY_MS ? 'notice_unconfirmed' : 'waiting';
        }
        return ctx.db.runTransaction(async tx => {
            const [guard, config, current, latestMail] = await Promise.all([
                getUserDeletionGuardStateInTransaction(ctx.db, tx, uid, clock(ctx)), validRun(ctx, tx, run), tx.get(episodeRef), tx.get(mailRef),
            ]);
            if (guard.shouldSkip || !config || !current.updateTime?.isEqual(previous.updateTime!) || current.get('state') !== 'queued'
                || !currentEvidence(current.data(), clock(ctx))
                || warningAcceptedAt(latestMail.data() ?? {}, uid, episode.generation, identity.email, queued!, clock(ctx)) !== accepted) return 'skipped';
            const now = clock(ctx);
            const deadline = accepted + INACTIVITY_NOTICE_MS;
            const inReminderWindow = deadline - INACTIVITY_REMINDER_MS <= now && now < deadline;
            tx.update(episodeRef, { state: 'warned', acceptedAt: Timestamp.fromMillis(accepted), deleteAfter: Timestamp.fromMillis(deadline),
                nextCheckAt: inReminderWindow ? Timestamp.fromMillis(now) : nextNoticeCheck(now, deadline), expireAt: expiry(now) });
            return 'accepted';
        });
    }
    const warned = episode?.state === 'warned';
    const reminding = finalReminderDue(episode, clock(ctx));
    if (options.reminderFor !== undefined && !reminding) return 'skipped';
    if (warned && !reminding && (deadline! > clock(ctx) || run.mode === 'warnings-only')) {
        if (run.mode !== 'dry-run') await updateEpisode(ctx, uid, episode.generation, run, { nextCheckAt: nextNoticeCheck(clock(ctx), deadline!) });
        return 'waiting';
    }
    const lease = await acquireBillingLease(ctx.db, `customer:${uid}`, clock(ctx));
    try {
        // Refresh after acquiring the same lease used by native checkout/portal/webhook workers.
        const billing = await readInactivityBilling(ctx.db, uid, clock(ctx));
        if (!billing.eligible || billing.revision !== local.revision
            || !await stripeAllowsInactivity(await ctx.stripe(), uid, identity.email, billing.customerId, warned ? timestampMillis(episode.queuedAt)! : undefined)) {
            if (run.mode !== 'dry-run' && activeEpisode(episode)) await updateEpisode(ctx, uid, episode!.generation, run, cancellation());
            return 'blocked';
        }
        if (run.mode === 'dry-run') return 'eligible';
        const fresh = inactiveIdentity(await ctx.auth.getUser(uid), clock(ctx));
        if (!fresh || fresh.activityAt !== identity.activityAt || fresh.emailHash !== identity.emailHash || fresh.createdAt !== identity.createdAt) {
            if (activeEpisode(episode)) await updateEpisode(ctx, uid, episode!.generation, run, cancellation());
            return 'cancelled';
        }
        const result = await prepareMutation(ctx, uid, run, lease, billing, identity, previous,
            reminding ? 'reminder' : warned ? 'deletion' : 'warning');
        if (result !== 'deletion_requested') return result;
        // Fence first, then one final Auth observation. A return before the RPC cancels
        // only our unattempted fence; an RPC error is ambiguous and needs operator review.
        const last = inactiveIdentity(await ctx.auth.getUser(uid), clock(ctx));
        const attempted = last && last.activityAt === identity.activityAt && last.emailHash === identity.emailHash && last.createdAt === identity.createdAt
            && await ctx.db.runTransaction(async tx => {
                const [config, marker, ownsLease, finalBilling, current] = await Promise.all([
                    validRun(ctx, tx, run), tx.get(ctx.db.doc(`userDeletionTombstones/${uid}`)), leaseValid(tx, lease, clock(ctx)),
                    readInactivityBilling(ctx.db, uid, clock(ctx), tx), tx.get(episodeRef),
                ]);
                if (!config || !ownsLease || !finalBilling.eligible || finalBilling.revision !== billing.revision
                    || marker.get('source') !== 'inactivity' || marker.get('inactivityGeneration') !== episode!.generation
                    || marker.get('authDeleteStatus') !== 'prepared' || marker.get('cleanupAttemptId')
                    || !currentEvidence(current.data(), clock(ctx))
                    || acceptedNoticeDeadline(current.data() ?? {}, clock(ctx)) !== deadline
                    || timestampMillis(current.get('queuedAt')) !== timestampMillis(episode!.queuedAt)
                    || timestampMillis(current.get('acceptedAt')) !== timestampMillis(episode!.acceptedAt)
                    || current.get('generation') !== episode!.generation || current.get('state') !== 'deletion_requested') return false;
                tx.update(marker.ref, { authDeleteStatus: 'attempted', authDeleteAttemptedAt: Timestamp.fromMillis(clock(ctx)) });
                return true;
            });
        if (!attempted) {
            await abandonPreparedDeletion(ctx, uid, episode!.generation);
            return 'cancelled';
        }
        await deleteAuthAccountAndNotify(uid, identity.email, ctx.auth, ctx.db);
        return 'deletion_requested';
    } finally {
        await releaseBillingLease(ctx.db, lease);
    }
}

export interface InactivitySummary {
    mode: InactivityMode;
    outcome: 'off' | 'contended' | 'stale' | 'completed' | 'failed';
    counts: Partial<Record<InactivityOutcome, number>>;
    scanned: number;
    capped: boolean;
    overdue: number;
    reviewRequired: number;
    scanAgeMs: number;
    continuationAgeMs?: number;
    continuationStalled?: true;
}
interface DueWork {
    cutoff: Timestamp;
    after: { at: Timestamp; path: string } | null;
    reminder?: { uid: string; generation: string };
}
interface RemainingWork {
    due: DueWork | null;
    authPageSize: number | null;
}
interface InactivityContinuation extends RemainingWork {
    id: string;
    mode: InactivityMode;
    revision: number;
    retryingSameWork?: true;
}
export async function runInactivitySweep(ctx: InactivityContext, continuationId?: string): Promise<InactivitySummary> {
    const start = clock(ctx);
    const configRef = ctx.db.doc(INACTIVITY_CONTROL);
    const continuationRef = ctx.db.doc(INACTIVITY_CONTINUATION);
    const token = randomUUID();
    const acquired = await ctx.db.runTransaction(async tx => {
        const [config, pending] = await tx.getAll(configRef, continuationRef);
        const mode = inactivityMode(config.get('mode'));
        const revision = config.get('settingsRevision') ?? 0;
        const ticket = pending.data() as InactivityContinuation | undefined;
        let work: RemainingWork = { due: { cutoff: Timestamp.fromMillis(start), after: null }, authPageSize: INACTIVITY_PAGE_SIZE };
        if (continuationId !== undefined) {
            if (!ticket || ticket.id !== continuationId) return { mode, status: 'stale' as const };
            if (ticket.mode !== mode || ticket.revision !== revision) {
                tx.delete(continuationRef);
                return { mode, status: 'stale' as const };
            }
            work = ticket;
        }
        if (mode === 'off') {
            // The private request is a leaf. All cursor and reminder data lives in this one document.
            if (pending.exists) tx.delete(continuationRef);
            return { mode, status: 'off' as const };
        }
        if (leaseActive(config, start)) return { mode, status: 'contended' as const };
        // Consuming the single-use ticket and claiming the shared lease are one operation.
        // An old delivery or a redelivery after a worker failure cannot start another sweep.
        if (pending.exists) tx.delete(continuationRef);
        const priorStart = timestampMillis(config.get('scanStartedAt'));
        const completedAt = timestampMillis(config.get('lastScanCompletedAt'));
        const draft = work.authPageSize !== null && mode === 'dry-run' ? dryRunDraft(config) : undefined;
        const restart = draft !== undefined && draft.id !== config.get('dryRunDraft.id');
        const scanStartedAt = !restart && priorStart !== null && (completedAt === null || priorStart > completedAt) ? priorStart : start;
        tx.set(configRef, { leaseToken: token, leaseUntil: Timestamp.fromMillis(start + 540_000), lastStartedAt: Timestamp.fromMillis(start),
            ...(work.authPageSize !== null ? { scanStartedAt: Timestamp.fromMillis(scanStartedAt),
                dryRunDraft: draft ?? FieldValue.delete() } : {}),
            ...(restart ? { scanCursor: FieldValue.delete() } : {}),
        }, { merge: true });
        return { mode, status: 'started' as const, cursor: restart ? undefined : config.get('scanCursor') as string | undefined,
            scanStartedAt, draft, work, revision, retryingSameWork: continuationId !== undefined && ticket?.retryingSameWork === true,
            continuationAgeMs: ticket?.mode === mode && ticket.revision === revision && pending.createTime
                ? Math.max(0, start - pending.createTime.toMillis()) : undefined };
    });
    const summary: InactivitySummary = { mode: acquired.mode, outcome: acquired.status === 'started' ? 'completed' : acquired.status,
        counts: {}, scanned: 0, capped: false, overdue: 0, reviewRequired: 0, scanAgeMs: Math.max(0, start - (acquired.scanStartedAt ?? start)) };
    if (acquired.status !== 'started') return summary;
    if (acquired.continuationAgeMs !== undefined) summary.continuationAgeMs = acquired.continuationAgeMs;
    const run = { token, mode: acquired.mode, revision: acquired.revision };
    const process = async (uid: string, options: InactivityProcessOptions = {}) => {
        let outcome: InactivityOutcome;
        try { outcome = await processInactiveAccount(ctx, uid, run, options); }
        catch (error) {
            outcome = error instanceof BillingContention ? 'contended' : 'failed';
            // Keep errors private; only fixed outcome counts reach telemetry. A failed
            // account is retried by its due state or the next complete discovery pass.
            const episode = await inactivityRef(ctx.db, uid).get();
            if (run.mode !== 'dry-run' && activeEpisode(episode.data())
                && (options.reminderFor === undefined || options.reminderFor === episode.get('generation'))) {
                await updateEpisode(ctx, uid, episode.get('generation'), run, { nextCheckAt: Timestamp.fromMillis(clock(ctx) + INACTIVITY_DAY_MS) });
            }
        }
        summary.counts[outcome] = (summary.counts[outcome] ?? 0) + 1;
        if (outcome === 'capped') summary.capped = true;
        return outcome;
    };
    const remaining: RemainingWork = { due: null, authPageSize: null };
    let retrySameWork = false;
    try {
        // Existing episodes get a separate half of the budget, independently of the Auth cursor.
        let due = acquired.work.due;
        let advancedDue = false;
        const dueEnd = start + INACTIVITY_BUDGET_MS / 2;
        duePages: while (due) {
            if (due.reminder) {
                if (clock(ctx) >= dueEnd) {
                    remaining.due = due;
                    summary.capped = true;
                    break;
                }
                await process(due.reminder.uid, { reminderFor: due.reminder.generation });
                due = { cutoff: due.cutoff, after: due.after };
                advancedDue = true;
            }
            let query = ctx.db.collectionGroup(INACTIVITY_COLLECTION).where('nextCheckAt', '<=', due.cutoff)
                .orderBy('nextCheckAt').orderBy(FieldPath.documentId()).limit(INACTIVITY_PAGE_SIZE);
            if (due.after) query = query.startAfter(due.after.at, ctx.db.doc(due.after.path));
            const page = await query.get();
            for (const doc of page.docs) {
                if (clock(ctx) >= dueEnd) {
                    remaining.due = due;
                    summary.capped = true;
                    break duePages;
                }
                const uid = doc.ref.parent.parent?.id;
                if (!uid || doc.ref.path !== inactivityRef(ctx.db, uid).path || doc.get('uid') !== uid) throw new Error('invalid_inactivity_owner');
                const outcome = await process(uid);
                advancedDue = true;
                due = { cutoff: due.cutoff, after: { at: doc.get('nextCheckAt'), path: doc.ref.path } };
                // A previously unobserved SMTP receipt may already be in its final
                // week. Give that episode a guarded reminder attempt in this sweep.
                if (outcome === 'accepted') {
                    const queued = timestampMillis(doc.get('queuedAt'));
                    const generation = doc.get('generation');
                    if (queued !== null && clock(ctx) >= queued + INACTIVITY_NOTICE_MS - INACTIVITY_REMINDER_MS
                        && typeof generation === 'string') {
                        if (clock(ctx) >= dueEnd) {
                            // Resume the same guarded reminder attempt, even if its deadline or generation changes.
                            remaining.due = { ...due, reminder: { uid, generation } };
                            summary.capped = true;
                            break duePages;
                        }
                        await process(uid, { reminderFor: generation });
                    }
                }
                if (run.mode === 'enforce' && doc.get('state') === 'warned'
                    && timestampMillis(doc.get('deleteAfter'))! + 2 * INACTIVITY_DAY_MS < start
                    && ['capped', 'failed', 'waiting'].includes(outcome)) summary.overdue++;
            }
            if (page.size < INACTIVITY_PAGE_SIZE) {
                advancedDue = true;
                break;
            }
        }
        // A stalled initiation survives user-root cleanup in the existing non-expiring fence.
        const pending = await ctx.db.collection('userDeletionTombstones').where('source', '==', 'inactivity')
            .where('cleanupStatus', '==', 'pending').limit(INACTIVITY_PAGE_SIZE).get();
        summary.reviewRequired = pending.docs.filter(doc => timestampMillis(doc.get('createdAt')) === null
            || timestampMillis(doc.get('createdAt'))! + INACTIVITY_DAY_MS < start).length;
        let cursor = acquired.cursor;
        const pageSize = acquired.work.authPageSize;
        let pagesSaved = 0;
        while (pageSize !== null) {
            if (clock(ctx) >= start + INACTIVITY_BUDGET_MS) {
                remaining.authPageSize = pageSize;
                summary.capped = true;
                break;
            }
            const page = await ctx.auth.listUsers(pageSize, cursor);
            const eligibleUids: string[] = [];
            let complete = true;
            for (const user of page.users) {
                if (clock(ctx) >= start + INACTIVITY_BUDGET_MS) {
                    // A slow page must eventually fit into one batch, including the first page of a scan.
                    remaining.authPageSize = pagesSaved ? pageSize : Math.max(1, Math.floor(pageSize / 2));
                    complete = false;
                    summary.capped = true;
                    break;
                }
                summary.scanned++;
                if (!inactiveIdentity(user, clock(ctx))) continue;
                const outcome = await process(user.uid, { discoveryOnly: true });
                if (acquired.draft && outcome === 'eligible') eligibleUids.push(user.uid);
                if (acquired.draft && (outcome === 'failed' || outcome === 'contended')) { complete = false; break; }
                if (outcome === 'capped') { complete = false; summary.capped = true; break; }
            }
            if (!complete) break; // Revisit the unfinished page; per-episode dedupe makes this safe.
            cursor = page.pageToken;
            const saved = await ctx.db.runTransaction(async tx => {
                const config = await tx.get(configRef);
                if (!matchesRun(config, run)) return false;
                if (!leaseActive(config, clock(ctx))) throw new Error('inactivity_lease_expired');
                const finishedAt = cursor ? null : Timestamp.fromMillis(clock(ctx));
                if (acquired.draft) await recordDryRunPage(ctx.db, tx, config, acquired.draft, eligibleUids, finishedAt);
                tx.update(configRef, { scanCursor: cursor ?? FieldValue.delete(),
                    ...(finishedAt ? { lastScanCompletedAt: finishedAt } : {}) });
                return true;
            });
            if (!saved) { summary.outcome = 'stale'; break; }
            pagesSaved++;
            if (!cursor) { summary.scanAgeMs = 0; break; }
        }
        // A smaller page or a finished lane is progress. Repeating exactly the same timed-out
        // work without advancing either cursor would otherwise create an endless event chain.
        if ((remaining.due || remaining.authPageSize !== null) && !advancedDue && pagesSaved === 0 && remaining.authPageSize === pageSize) {
            if (acquired.retryingSameWork) {
                summary.continuationStalled = true;
                summary.outcome = 'failed';
            } else {
                retrySameWork = true;
            }
        }
    } catch (error) {
        summary.outcome = 'failed';
        throw error;
    } finally {
        summary.outcome = await ctx.db.runTransaction(async tx => {
            const config = await tx.get(configRef);
            if (config.get('leaseToken') !== token) return 'stale' as const;
            const now = clock(ctx);
            let outcome = summary.outcome;
            if (!matchesRun(config, run)) outcome = 'stale';
            if (outcome === 'completed' && (remaining.due || remaining.authPageSize !== null)) {
                if (leaseActive(config, now)) {
                    const next: InactivityContinuation = { id: token, mode: run.mode, revision: acquired.revision, ...remaining,
                        ...(retrySameWork ? { retryingSameWork: true } : {}) };
                    tx.create(continuationRef, next);
                } else {
                    outcome = 'failed';
                }
            }
            const finishedAt = Timestamp.fromMillis(now);
            tx.update(configRef, {
                leaseToken: FieldValue.delete(), leaseUntil: FieldValue.delete(), lastFinishedAt: finishedAt,
                ...(outcome === 'stale' ? {} : { lastRun: { ...summary, outcome, finishedAt } }),
            });
            return outcome;
        });
    }
    return summary;
}
