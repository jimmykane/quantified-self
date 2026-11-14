import { randomUUID } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { INACTIVITY_DELETION_LIMIT, INACTIVITY_WARNING_LIMIT } from '../../../shared/admin-inactivity';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { acquireBillingLease, releaseBillingLease, type BillingLease } from '../stripe/billing/service';
import { BillingContention } from '../stripe/billing/model';
import { newEmailDeliveryFields } from '../email/queue-metadata';
import { TRANSACTIONAL_EMAIL_FROM, TRANSACTIONAL_EMAIL_REPLY_TO } from '../email/config';
import { TTL_CONFIG } from '../shared/ttl-config';
import { deleteAuthAccountAndNotify, pendingAccountDeletionMarker } from './initiate-deletion';
import { readInactivityBilling, stripeAllowsInactivity, type InactivityBilling } from './inactivity-billing';
import { INACTIVITY_BUDGET_MS, INACTIVITY_COLLECTION, INACTIVITY_CONTROL, INACTIVITY_DAY_MS,
    INACTIVITY_NOTICE_MS, INACTIVITY_PAGE_SIZE, INACTIVITY_TEMPLATE, inactiveIdentity, inactivityMode,
    timestampMillis, warningAcceptedAt, type InactiveIdentity, type InactivityMode } from './inactivity-policy';

export interface InactivityContext { db: Firestore; auth: Auth; stripe: () => Promise<Stripe>; now?: () => number }
export interface InactivityRun { token: string; mode: InactivityMode }
export type InactivityOutcome = 'skipped' | 'eligible' | 'queued' | 'accepted' | 'cancelled' | 'waiting'
    | 'blocked' | 'notice_unconfirmed' | 'capped' | 'contended' | 'deletion_requested' | 'review_required' | 'failed';
const clock = (ctx: InactivityContext) => ctx.now?.() ?? Date.now();
export const inactivityRef = (db: Firestore, uid: string) => db.doc(`users/${uid}/${INACTIVITY_COLLECTION}/state`);
const activeEpisode = (data?: DocumentData) => data?.state === 'queued' || data?.state === 'warned';
const currentEvidence = (data: DocumentData | undefined, now: number) => (timestampMillis(data?.expireAt) ?? 0) > now;
const expiry = (time: number) => Timestamp.fromMillis(time + TTL_CONFIG.MAIL_IN_DAYS * INACTIVITY_DAY_MS);

async function validRun(ctx: InactivityContext, tx: Transaction, run: InactivityRun): Promise<DocumentSnapshot | null> {
    const config = await tx.get(ctx.db.doc(INACTIVITY_CONTROL));
    return config.get('leaseToken') === run.token && timestampMillis(config.get('leaseUntil'))! > clock(ctx)
        && inactivityMode(config.get('mode')) === run.mode ? config : null;
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
    if (used >= limit) return false;
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
    billing: InactivityBilling, identity: InactiveIdentity, previous: DocumentSnapshot, deleting: boolean): Promise<InactivityOutcome> {
    const now = clock(ctx);
    const generation = deleting ? previous.get('generation') as string : randomUUID();
    const mailRef = ctx.db.collection('mail').doc(`inactivity_${generation}`);
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
        if (deleting && (run.mode !== 'enforce' || current.get('state') !== 'warned'
            || !currentEvidence(current.data(), clock(ctx))
            || timestampMillis(current.get('deleteAfter')) === null || timestampMillis(current.get('deleteAfter'))! > clock(ctx)
            || timestampMillis(current.get('acceptedAt')) === null
            || timestampMillis(current.get('deleteAfter'))! < timestampMillis(current.get('acceptedAt'))! + INACTIVITY_NOTICE_MS)) return 'blocked';
        if (!consumeBudget(tx, config, deleting ? 'deletions' : 'warnings', now)) return 'capped';
        if (deleting) {
            tx.set(marker.ref, { ...pendingAccountDeletionMarker('inactivity'), inactivityGeneration: generation, authDeleteStatus: 'prepared' }, { merge: true });
            tx.update(current.ref, { state: 'deletion_requested', requestedAt: Timestamp.fromMillis(now), nextCheckAt: FieldValue.delete() });
            return 'deletion_requested';
        }
        tx.set(inactivityRef(ctx.db, uid), { uid, generation, state: 'queued', activityAt: identity.activityAt,
            authCreatedAt: identity.createdAt, emailHash: identity.emailHash, billingRevision: billing.revision,
            mailId: mailRef.id, queuedAt: Timestamp.fromMillis(now), nextCheckAt: Timestamp.fromMillis(now + INACTIVITY_DAY_MS), expireAt: expiry(now) });
        tx.create(mailRef, { ...newEmailDeliveryFields(), uid, to: identity.email,
            from: TRANSACTIONAL_EMAIL_FROM, replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
            template: { name: INACTIVITY_TEMPLATE, data: { login_url: 'https://quantified-self.io/login', support_email: TRANSACTIONAL_EMAIL_REPLY_TO } },
            inactivity: { generation }, expireAt: expiry(now) });
        return 'queued';
    });
}

export async function processInactiveAccount(ctx: InactivityContext, uid: string, run: InactivityRun,
    options: { discoveryOnly?: boolean } = {}): Promise<InactivityOutcome> {
    if (run.mode === 'off') return 'skipped';
    const episodeRef = inactivityRef(ctx.db, uid);
    const previous = await episodeRef.get();
    const episode = previous.data();
    if (episode?.state === 'deletion_requested') return 'review_required'; // Never repeat an uncertain destructive call.
    // Existing notices belong to the due lane. Revisiting them during Auth discovery
    // could exhaust its time/budget and hide new candidates behind capped deletions.
    if (options.discoveryOnly && activeEpisode(episode)) return 'skipped';
    const identity = inactiveIdentity(await ctx.auth.getUser(uid), clock(ctx));
    const local = await readInactivityBilling(ctx.db, uid, clock(ctx));
    const changed = !identity || !local.eligible || activeEpisode(episode) && (!currentEvidence(episode, clock(ctx)) ||
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
            if (guard.shouldSkip || !config || current.get('generation') !== episode.generation || current.get('state') !== 'queued'
                || !currentEvidence(current.data(), clock(ctx))
                || warningAcceptedAt(latestMail.data() ?? {}, uid, episode.generation, identity.email, queued!, clock(ctx)) !== accepted) return 'skipped';
            tx.update(episodeRef, { state: 'warned', acceptedAt: Timestamp.fromMillis(accepted), deleteAfter: Timestamp.fromMillis(accepted + INACTIVITY_NOTICE_MS),
                nextCheckAt: Timestamp.fromMillis(clock(ctx) + INACTIVITY_DAY_MS), expireAt: expiry(clock(ctx)) });
            return 'accepted';
        });
    }
    const deleting = episode?.state === 'warned';
    if (deleting && (timestampMillis(episode.deleteAfter) === null || timestampMillis(episode.deleteAfter)! > clock(ctx) || run.mode === 'warnings-only')) {
        if (run.mode !== 'dry-run') await updateEpisode(ctx, uid, episode.generation, run, { nextCheckAt: Timestamp.fromMillis(clock(ctx) + INACTIVITY_DAY_MS) });
        return 'waiting';
    }
    const lease = await acquireBillingLease(ctx.db, `customer:${uid}`, clock(ctx));
    try {
        // Refresh after acquiring the same lease used by native checkout/portal/webhook workers.
        const billing = await readInactivityBilling(ctx.db, uid, clock(ctx));
        if (!billing.eligible || billing.revision !== local.revision
            || !await stripeAllowsInactivity(await ctx.stripe(), uid, identity.email, billing.customerId, deleting ? timestampMillis(episode?.queuedAt) ?? undefined : undefined)) {
            if (run.mode !== 'dry-run' && activeEpisode(episode)) await updateEpisode(ctx, uid, episode!.generation, run, cancellation());
            return 'blocked';
        }
        if (run.mode === 'dry-run') return 'eligible';
        const fresh = inactiveIdentity(await ctx.auth.getUser(uid), clock(ctx));
        if (!fresh || fresh.activityAt !== identity.activityAt || fresh.emailHash !== identity.emailHash || fresh.createdAt !== identity.createdAt) {
            if (activeEpisode(episode)) await updateEpisode(ctx, uid, episode!.generation, run, cancellation());
            return 'cancelled';
        }
        const result = await prepareMutation(ctx, uid, run, lease, billing, identity, previous, deleting);
        // A capped deletion must yield its old queue position. Otherwise a backlog
        // can repeatedly exhaust the due lane before newer mail receipts are observed.
        if (result === 'capped' && deleting) await updateEpisode(ctx, uid, episode!.generation, run,
            { nextCheckAt: Timestamp.fromMillis(clock(ctx) + INACTIVITY_DAY_MS) });
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

export interface InactivitySummary { mode: InactivityMode; outcome: 'off' | 'contended' | 'completed' | 'failed'; counts: Partial<Record<InactivityOutcome, number>>; scanned: number; capped: boolean; overdue: number; reviewRequired: number; scanAgeMs: number }
export async function runInactivitySweep(ctx: InactivityContext): Promise<InactivitySummary> {
    const start = clock(ctx);
    const configRef = ctx.db.doc(INACTIVITY_CONTROL);
    const token = randomUUID();
    const acquired = await ctx.db.runTransaction(async tx => {
        const config = await tx.get(configRef);
        const mode = inactivityMode(config.get('mode'));
        if (mode === 'off') return { mode, status: 'off' as const, cursor: undefined };
        if (timestampMillis(config.get('leaseUntil'))! > start) return { mode, status: 'contended' as const, cursor: undefined };
        const priorStart = timestampMillis(config.get('scanStartedAt'));
        const completedAt = timestampMillis(config.get('lastScanCompletedAt'));
        // A daily cap can stop the very first page, before any cursor is saved.
        const scanStartedAt = priorStart !== null && (completedAt === null || priorStart > completedAt) ? priorStart : start;
        tx.set(configRef, { leaseToken: token, leaseUntil: Timestamp.fromMillis(start + 540_000), lastStartedAt: Timestamp.fromMillis(start), scanStartedAt: Timestamp.fromMillis(scanStartedAt) }, { merge: true });
        return { mode, status: 'started' as const, cursor: config.get('scanCursor') as string | undefined, scanStartedAt };
    });
    const summary: InactivitySummary = { mode: acquired.mode, outcome: acquired.status === 'started' ? 'completed' : acquired.status,
        counts: {}, scanned: 0, capped: false, overdue: 0, reviewRequired: 0, scanAgeMs: Math.max(0, start - (acquired.scanStartedAt ?? start)) };
    if (acquired.status !== 'started') return summary;
    const run = { token, mode: acquired.mode };
    const process = async (uid: string, discoveryOnly = false) => {
        let outcome: InactivityOutcome;
        try { outcome = await processInactiveAccount(ctx, uid, run, { discoveryOnly }); }
        catch (error) {
            outcome = error instanceof BillingContention ? 'contended' : 'failed';
            // Keep errors private; only fixed outcome counts reach telemetry. A failed
            // account is retried by its due state or the next complete discovery pass.
            const episode = await inactivityRef(ctx.db, uid).get();
            if (run.mode !== 'dry-run' && activeEpisode(episode.data())) await updateEpisode(ctx, uid, episode.get('generation'), run,
                { nextCheckAt: Timestamp.fromMillis(clock(ctx) + INACTIVITY_DAY_MS) });
        }
        summary.counts[outcome] = (summary.counts[outcome] ?? 0) + 1;
        if (outcome === 'capped') summary.capped = true;
        return outcome;
    };
    try {
        // Existing episodes get a separate half of the budget, independently of the Auth cursor.
        let dueCursor: DocumentSnapshot | undefined;
        while (clock(ctx) < start + INACTIVITY_BUDGET_MS / 2) {
            let query = ctx.db.collectionGroup(INACTIVITY_COLLECTION).where('nextCheckAt', '<=', Timestamp.fromMillis(start)).orderBy('nextCheckAt').limit(INACTIVITY_PAGE_SIZE);
            if (dueCursor) query = query.startAfter(dueCursor);
            const page = await query.get();
            for (const doc of page.docs) {
                if (clock(ctx) >= start + INACTIVITY_BUDGET_MS / 2) { summary.capped = true; break; }
                const uid = doc.ref.parent.parent?.id;
                if (!uid || doc.ref.path !== inactivityRef(ctx.db, uid).path || doc.get('uid') !== uid) throw new Error('invalid_inactivity_owner');
                const outcome = await process(uid);
                if (run.mode === 'enforce' && doc.get('state') === 'warned'
                    && timestampMillis(doc.get('deleteAfter'))! + 2 * INACTIVITY_DAY_MS < start
                    && ['capped', 'failed', 'waiting'].includes(outcome)) summary.overdue++;
            }
            if (page.size < INACTIVITY_PAGE_SIZE) break;
            dueCursor = page.docs[page.size - 1];
        }
        // A stalled initiation survives user-root cleanup in the existing non-expiring fence.
        const pending = await ctx.db.collection('userDeletionTombstones').where('source', '==', 'inactivity')
            .where('cleanupStatus', '==', 'pending').limit(INACTIVITY_PAGE_SIZE).get();
        summary.reviewRequired = pending.docs.filter(doc => timestampMillis(doc.get('createdAt')) === null
            || timestampMillis(doc.get('createdAt'))! + INACTIVITY_DAY_MS < start).length;
        let cursor = acquired.cursor;
        while (clock(ctx) < start + INACTIVITY_BUDGET_MS) {
            const page = await ctx.auth.listUsers(INACTIVITY_PAGE_SIZE, cursor);
            let complete = true;
            for (const user of page.users) {
                if (clock(ctx) >= start + INACTIVITY_BUDGET_MS) { complete = false; summary.capped = true; break; }
                summary.scanned++;
                if (!inactiveIdentity(user, clock(ctx))) continue;
                if (await process(user.uid, true) === 'capped') { complete = false; summary.capped = true; break; }
            }
            if (!complete) break; // Revisit the unfinished page; per-episode dedupe makes this safe.
            cursor = page.pageToken;
            await ctx.db.runTransaction(async tx => {
                if (!await validRun(ctx, tx, run)) throw new Error('inactivity_run_superseded');
                tx.update(configRef, { scanCursor: cursor ?? FieldValue.delete(),
                    ...(!cursor ? { lastScanCompletedAt: Timestamp.fromMillis(clock(ctx)) } : {}) });
            });
            if (!cursor) { summary.scanAgeMs = 0; break; }
        }
        return summary;
    } catch (error) {
        summary.outcome = 'failed';
        throw error;
    } finally {
        await ctx.db.runTransaction(async tx => {
            const config = await tx.get(configRef);
            if (config.get('leaseToken') === token) tx.update(configRef, {
                leaseToken: FieldValue.delete(), leaseUntil: FieldValue.delete(), lastFinishedAt: Timestamp.fromMillis(clock(ctx)),
                lastRun: { ...summary, finishedAt: Timestamp.fromMillis(clock(ctx)) },
            });
        });
    }
}
