import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { inactivityRef, processInactiveAccount, runInactivitySweep, type InactivityContext } from './inactivity';
import { INACTIVITY_BUDGET_MS, INACTIVITY_CONTINUATION, INACTIVITY_CONTROL, INACTIVITY_DAY_MS, INACTIVITY_NOTICE_MS, INACTIVITY_REMINDER_MS,
    INACTIVITY_REMINDER_TEMPLATE } from './inactivity-policy';
import { formatEmailDateTime } from '../email/config';
import { emailEligibility, emailSource } from '../email/monitoring';
import { invalidateInactivityWarning } from './inactivity-cancellation';
import { readInactivityBilling } from './inactivity-billing';
import { readInactivityAdmin } from './inactivity-admin';
import { beginAccountDataCleanup, deleteAccountFirestoreRoot, assertAccountFirestoreRootAbsent } from './data-cleanup';
vi.unmock('firebase-admin');
vi.unmock('firebase-admin/firestore');
const host = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!host)('inactive account lifecycle (isolated loopback Firestore)', () => {
    let db: admin.firestore.Firestore;
    let now: number;
    let ctx: InactivityContext;
    let uid: string;
    let authUser: admin.auth.UserRecord;
    const owners: string[] = [];
    const auth = { getUser: vi.fn(), deleteUser: vi.fn(), listUsers: vi.fn() };
    const stripe = { customers: { list: vi.fn(), retrieve: vi.fn() }, subscriptions: { list: vi.fn() },
        subscriptionSchedules: { list: vi.fn() }, checkout: { sessions: { list: vi.fn() } } };
    const run = { token: 'synthetic-run', mode: 'enforce' as const };
    const config = () => db.doc(INACTIVITY_CONTROL);
    const pendingBatch = () => db.doc(INACTIVITY_CONTINUATION).get();
    const refreshRun = () => config().set({ mode: run.mode, leaseToken: run.token, leaseUntil: Timestamp.fromMillis(now + 540_000) }, { merge: true });
    const process = () => processInactiveAccount(ctx, uid, run);
    async function recordSmtpAcceptance() {
        const episode = (await inactivityRef(db, uid).get()).data()!;
        await db.doc(`mail/${episode.mailId}`).update({ delivery: { state: 'SUCCESS', endTime: Timestamp.fromMillis(now),
            info: { accepted: [authUser.email], rejected: [], pending: [] } } });
    }
    async function acceptWarning() {
        await recordSmtpAcceptance();
        expect(await process()).toBe('accepted');
    }
    async function dueWarning() {
        expect(await process()).toBe('queued');
        await acceptWarning();
        now += INACTIVITY_NOTICE_MS;
        await refreshRun();
    }
    async function reminderWindow() {
        await process(); await acceptWarning();
        now += INACTIVITY_NOTICE_MS - INACTIVITY_REMINDER_MS;
        await refreshRun();
    }
    beforeAll(() => {
        if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required');
        admin.initializeApp({ projectId: 'demo-inactivity-retention' }); db = admin.firestore();
    });
    beforeEach(async () => {
        now = Date.parse('2026-11-13T12:00:00Z'); uid = `inactive-${randomUUID()}`; owners.push(uid);
        authUser = { uid, email: `${uid}@example.invalid`, disabled: false,
            metadata: { creationTime: '2020-01-01T00:00:00Z', lastSignInTime: '2025-01-01T00:00:00Z' } } as admin.auth.UserRecord;
        auth.getUser.mockReset().mockImplementation(async () => authUser);
        auth.deleteUser.mockReset().mockResolvedValue(undefined);
        auth.listUsers.mockReset().mockResolvedValue({ users: [authUser] });
        stripe.customers.list.mockReset().mockResolvedValue({ data: [], has_more: false });
        stripe.customers.retrieve.mockReset().mockResolvedValue({ metadata: { firebaseUID: uid } });
        for (const mock of [stripe.subscriptions.list, stripe.subscriptionSchedules.list, stripe.checkout.sessions.list]) mock.mockReset().mockResolvedValue({ data: [], has_more: false });
        ctx = { db, auth: auth as unknown as admin.auth.Auth, stripe: async () => stripe as unknown as Stripe, now: () => now };
        await config().set({ mode: 'enforce' }); await refreshRun();
        await db.doc('configuration/stripeBilling').set({ owner: 'native', nativeSince: Timestamp.fromMillis(1) });
        await db.doc(`users/${uid}`).set({ synthetic: true });
    });
    afterEach(async () => {
        await db.doc(INACTIVITY_CONTINUATION).delete();
        for (const owner of owners.splice(0)) {
            for (const root of ['users', 'customers', 'userDeletionTombstones', 'stripeBillingAccounts']) await db.recursiveDelete(db.doc(`${root}/${owner}`));
            for (const collection of ['mail', 'stripeBillingJobs']) {
                const docs = await db.collection(collection).where('uid', '==', owner).get();
                for (const doc of docs.docs) await db.recursiveDelete(doc.ref);
            }
        }
    });
    afterAll(async () => {
        await db.recursiveDelete(config()); await db.recursiveDelete(db.doc('configuration/stripeBilling'));
        await admin.app().delete();
    });
    it('queues one owned expiring notice without an early deletion fence', async () => {
        expect(await process()).toBe('queued'); expect(await process()).toBe('waiting');
        const episode = (await inactivityRef(db, uid).get()).data()!;
        const mail = await db.doc(`mail/${episode.mailId}`).get();
        expect(mail.get('uid')).toBe(uid); expect(mail.get('to')).toBe(authUser.email);
        expect(mail.get('expireAt').toMillis()).toBe(now + 90 * INACTIVITY_DAY_MS);
        expect(episode.expireAt.toMillis()).toBe(now + 90 * INACTIVITY_DAY_MS);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).exists).toBe(false);
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(1);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('uses actual acceptance time, persists evidence across mail expiry, and never deletes early', async () => {
        expect(await process()).toBe('queued'); now += 3 * INACTIVITY_DAY_MS; await refreshRun(); await acceptWarning();
        const episode = (await inactivityRef(db, uid).get()).data()!;
        await db.doc(`mail/${episode.mailId}`).delete(); // Synthetic TTL expiry; receipt survives.
        now += INACTIVITY_NOTICE_MS - 1; await refreshRun(); expect(await process()).toBe('queued');
        now++; await refreshRun(); expect(await process()).toBe('deletion_requested');
        expect(auth.deleteUser).toHaveBeenCalledExactlyOnceWith(uid);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()).toMatchObject({ source: 'inactivity', cleanupStatus: 'pending', authDeleteStatus: 'attempted' });
        expect((await db.doc(`mail/account_deleted_confirmation_${uid}`).get()).get('uid')).toBe(uid);
    });
    it('queues one owned final reminder in the last seven days without changing the notice or deadline', async () => {
        await reminderWindow();
        const before = (await inactivityRef(db, uid).get()).data()!;
        now--; expect(await process()).toBe('waiting');
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBeUndefined();
        now++;
        expect(await process()).toBe('queued');
        const after = (await inactivityRef(db, uid).get()).data()!;
        for (const key of ['state', 'generation', 'mailId', 'acceptedAt', 'deleteAfter', 'expireAt']) expect(after[key]).toEqual(before[key]);
        expect(after.reminderQueuedAt.toMillis()).toBe(now);
        const mail = await db.doc(`mail/${after.reminderMailId}`).get();
        expect(mail.data()).toMatchObject({ uid, to: authUser.email, inactivity: { generation: before.generation },
            delivery: { state: 'PENDING', attempts: 0 }, template: { name: INACTIVITY_REMINDER_TEMPLATE,
                data: { deletion_deadline: formatEmailDateTime(before.deleteAfter) } } });
        expect(mail.get('expireAt').toMillis()).toBe(now + 90 * INACTIVITY_DAY_MS);
        expect(emailSource(mail.data()!)).toBe('transactional');
        expect(emailEligibility(mail, Date.now() + 1000)).toMatchObject({ source: 'transactional', kind: 'due' });
        expect(await process()).toBe('waiting');
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(2);
        expect((await config().get()).get('warnings')).toBe(1);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).exists).toBe(false);
        const view = await readInactivityAdmin(db, { getUsers: vi.fn().mockResolvedValue({ users: [authUser] }) }, { view: 'warned' }, now);
        expect(view.accounts[0].detail).toContain('Final reminder queued');
        expect(JSON.stringify(view)).not.toContain(after.reminderMailId);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('deduplicates concurrent reminder attempts transactionally', async () => {
        await reminderWindow();
        const results = await Promise.allSettled([process(), process()]);
        expect(results.filter(result => result.status === 'fulfilled' && result.value === 'queued')).toHaveLength(1);
        expect((await config().get()).get('warnings')).toBe(1);
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(2);
    }, 30_000);
    it('requires a fresh notice after an email change and deduplicates reminders per episode', async () => {
        await reminderWindow(); expect(await process()).toBe('queued');
        const original = (await inactivityRef(db, uid).get()).data()!;
        authUser = { ...authUser, email: 'changed@example.invalid' };
        expect(await process()).toBe('cancelled'); expect(await process()).toBe('queued');
        const replacement = (await inactivityRef(db, uid).get()).data()!;
        expect(replacement.generation).not.toBe(original.generation);
        expect(replacement.reminderMailId).toBeUndefined(); expect(replacement.reminderQueuedAt).toBeUndefined();
        expect(replacement.acceptedAt).toBeUndefined(); expect(replacement.deleteAfter).toBeUndefined();
        await acceptWarning();
        expect((await inactivityRef(db, uid).get()).get('deleteAfter').toMillis()).toBe(now + INACTIVITY_NOTICE_MS);
        now += INACTIVITY_NOTICE_MS - INACTIVITY_REMINDER_MS; await refreshRun();
        expect(await process()).toBe('queued');
        const reminderId = (await inactivityRef(db, uid).get()).get('reminderMailId');
        expect(reminderId).not.toBe(original.reminderMailId);
        expect((await db.doc(`mail/${reminderId}`).get()).get('to')).toBe(authUser.email);
    });
    it.each(['ERROR', 'PENDING', 'missing'])('does not resend or extend the deadline for a %s final reminder', async state => {
        await reminderWindow(); expect(await process()).toBe('queued');
        const episode = (await inactivityRef(db, uid).get()).data()!;
        const mail = db.doc(`mail/${episode.reminderMailId}`);
        if (state === 'missing') await mail.delete(); else await mail.update({ 'delivery.state': state });
        now += INACTIVITY_DAY_MS; await refreshRun(); expect(await process()).toBe('waiting');
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBe(episode.reminderMailId);
        expect((await config().get()).get('budgetDay')).not.toBe(new Date(now).toISOString().slice(0, 10));
        now = episode.deleteAfter.toMillis(); await refreshRun();
        expect(await process()).toBe('deletion_requested');
        expect(auth.deleteUser).toHaveBeenCalledExactlyOnceWith(uid);
    });
    it('shares the warning cap, yields when capped, and uses the original deadline on a late scan', async () => {
        await reminderWindow();
        const deadline = (await inactivityRef(db, uid).get()).get('deleteAfter');
        await config().update({ budgetDay: new Date(now).toISOString().slice(0, 10), warnings: 100 });
        expect(await process()).toBe('capped');
        const midnight = new Date(now);
        midnight.setUTCHours(24, 0, 0, 0);
        expect((await inactivityRef(db, uid).get()).get('nextCheckAt').toMillis()).toBe(midnight.getTime());
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBeUndefined();
        now = midnight.getTime();
        expect((await runInactivitySweep(ctx)).counts.queued).toBe(1);
        expect((await config().get()).get('warnings')).toBe(1);
        const episode = (await inactivityRef(db, uid).get()).data()!;
        expect(episode.deleteAfter).toEqual(deadline);
        expect((await db.doc(`mail/${episode.reminderMailId}`).get()).get('template.data.deletion_deadline')).toBe(formatEmailDateTime(deadline));
    });
    it('processes a reminder on the first daily sweep in its window after a slightly later prior sweep', async () => {
        await reminderWindow();
        const opens = now;
        now = opens - INACTIVITY_DAY_MS + 1000;
        await config().set({ mode: 'warnings-only' });
        expect((await runInactivitySweep(ctx)).counts.waiting).toBe(1);
        now = opens;
        expect((await runInactivitySweep(ctx)).counts.queued).toBe(1);
        expect((await inactivityRef(db, uid).get()).get('reminderQueuedAt').toMillis()).toBe(opens);
    });
    it.each(['enforce', 'warnings-only'])('processes a reminder when the first receipt is observed on the last day in %s', async mode => {
        expect(await process()).toBe('queued');
        const ref = inactivityRef(db, uid);
        await recordSmtpAcceptance();
        const deadline = now + INACTIVITY_NOTICE_MS;
        now = deadline - 60_000;
        await config().set({ mode });
        const sweep = await runInactivitySweep(ctx);
        expect(sweep.counts.accepted).toBe(1);
        expect(sweep.counts.queued).toBe(1);
        expect((await ref.get()).get('reminderQueuedAt').toMillis()).toBe(now);
        expect((await ref.get()).get('deleteAfter').toMillis()).toBe(deadline);
        expect(auth.deleteUser).not.toHaveBeenCalled();
        expect((await runInactivitySweep(ctx)).counts.queued).toBeUndefined();
    });
    it('hands off a late reminder when observing the receipt used the due-notice time allowance', async () => {
        await process(); await recordSmtpAcceptance();
        now += INACTIVITY_NOTICE_MS - INACTIVITY_DAY_MS;
        await config().set({ mode: 'warnings-only' });
        auth.getUser.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS / 2;
            return authUser;
        });
        const first = await runInactivitySweep(ctx);
        expect(first.counts.accepted).toBe(1);
        expect(first.counts.queued).toBeUndefined();
        const ticket = (await pendingBatch()).data()!;
        expect(ticket.authPageSize).toBeNull();
        expect((await runInactivitySweep(ctx, ticket.id)).counts.queued).toBe(1);
        expect((await pendingBatch()).exists).toBe(false);
        expect(auth.listUsers).toHaveBeenCalledTimes(1);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('only records the receipt when the sweep first observes it at the deadline', async () => {
        expect(await process()).toBe('queued');
        await recordSmtpAcceptance();
        now += INACTIVITY_NOTICE_MS;
        const sweep = await runInactivitySweep(ctx);
        expect(sweep.counts.accepted).toBe(1);
        expect(sweep.counts.queued).toBeUndefined();
        expect((await inactivityRef(db, uid).get()).get('state')).toBe('warned');
        expect(auth.deleteUser).not.toHaveBeenCalled();
        now += INACTIVITY_DAY_MS;
        expect((await runInactivitySweep(ctx)).counts.deletion_requested).toBe(1);
    });
    it('cancels a late reminder when the user signs in after receipt observation', async () => {
        expect(await process()).toBe('queued');
        await recordSmtpAcceptance();
        now += INACTIVITY_NOTICE_MS - INACTIVITY_DAY_MS;
        const returned = { ...authUser, metadata: { ...authUser.metadata, lastSignInTime: new Date(now).toUTCString() } };
        auth.getUser.mockResolvedValueOnce(authUser).mockResolvedValue(returned);
        const sweep = await runInactivitySweep(ctx);
        expect(sweep.counts).toMatchObject({ accepted: 1, cancelled: 1 });
        expect((await inactivityRef(db, uid).get()).get('state')).toBe('cancelled');
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(1);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it.each(['reminder', 'deletion'])('requires the original queue time for billing history before %s', async action => {
        if (action === 'reminder') await reminderWindow(); else await dueWarning();
        const ref = inactivityRef(db, uid);
        await ref.update({ queuedAt: admin.firestore.FieldValue.delete() });
        const view = await readInactivityAdmin(db, { getUsers: vi.fn().mockResolvedValue({ users: [authUser] }) }, { view: 'warned' }, now);
        expect(view.accounts[0].detail).toContain('A new warning is required before deletion');
        await process();
        expect((await ref.get()).get('state')).toBe('cancelled');
        expect((await ref.get()).get('reminderMailId')).toBeUndefined();
        expect(auth.deleteUser).not.toHaveBeenCalled();
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).exists).toBe(false);
    });
    it('cancels a prepared deletion if the original queue time changes after the billing check', async () => {
        await dueWarning();
        const ref = inactivityRef(db, uid);
        const marker = db.doc(`userDeletionTombstones/${uid}`);
        const queued = (await ref.get()).get('queuedAt').toMillis();
        auth.getUser.mockImplementation(async () => {
            if ((await marker.get()).exists) await ref.update({ queuedAt: Timestamp.fromMillis(queued - 1) });
            return authUser;
        });
        expect(await process()).toBe('cancelled');
        expect((await ref.get()).get('state')).toBe('cancelled');
        expect((await marker.get()).exists).toBe(false);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('observes reminder queues in the existing daily warning counters', async () => {
        await reminderWindow(); await config().set({ mode: 'warnings-only' });
        const summary = await runInactivitySweep(ctx);
        expect(summary.counts.queued).toBe(1);
        expect((await config().get()).get('lastRun.counts.queued')).toBe(1);
        expect((await inactivityRef(db, uid).get()).get('state')).toBe('warned');
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it.each([0, 100])('charges a reminder crossing UTC midnight to the new day with %i previous reservations', async warnings => {
        await reminderWindow();
        const midnight = new Date(now); midnight.setUTCHours(23, 59, 59, 0); now = midnight.getTime();
        await refreshRun();
        await config().update({ budgetDay: new Date(now).toISOString().slice(0, 10), warnings, deletions: 7 });
        const runTransaction = db.runTransaction.bind(db);
        let crossedMidnight = false;
        const transactions = vi.spyOn(db, 'runTransaction').mockImplementation((update, options) => runTransaction(async tx => {
            const getAll = tx.getAll.bind(tx);
            const reads = vi.spyOn(tx, 'getAll').mockImplementation(async (...refs) => {
                const snapshots = await getAll(...refs);
                // Model billing guard reads finishing after midnight, inside the mail transaction.
                if (!crossedMidnight && refs.some(ref => 'path' in ref && ref.path === 'configuration/stripeBilling')) {
                    now += 2000; crossedMidnight = true;
                }
                return snapshots;
            });
            try { return await update(tx); } finally { reads.mockRestore(); }
        }, options));
        try {
            expect(await process()).toBe('queued');
            expect(crossedMidnight).toBe(true);
            expect((await config().get()).data()).toMatchObject({
                budgetDay: new Date(now).toISOString().slice(0, 10), warnings: 1, deletions: 0,
            });
            const episode = (await inactivityRef(db, uid).get()).data()!;
            expect(episode.reminderQueuedAt.toMillis()).toBe(now);
            expect(episode.nextCheckAt.toMillis()).toBe(now + INACTIVITY_DAY_MS);
            expect((await db.doc(`mail/${episode.reminderMailId}`).get()).get('expireAt').toMillis()).toBe(now + 90 * INACTIVITY_DAY_MS);
        } finally { transactions.mockRestore(); }
    });
    it.each(['off', 'dry-run', 'warnings-only'] as const)('respects %s mode for final reminders', async mode => {
        await reminderWindow();
        const before = (await inactivityRef(db, uid).get()).data();
        await config().update({ mode });
        expect(await processInactiveAccount(ctx, uid, { ...run, mode })).toBe(mode === 'off' ? 'skipped' : mode === 'dry-run' ? 'eligible' : 'queued');
        if (mode !== 'warnings-only') expect((await inactivityRef(db, uid).get()).data()).toEqual(before);
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(mode === 'warnings-only' ? 2 : 1);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it.each(['login', 'refresh', 'email', 'basic', 'pro', 'trial', 'grace', 'expired-evidence'])('cancels the pending reminder after %s', async change => {
        await reminderWindow();
        if (change === 'login' || change === 'refresh') authUser = { ...authUser, metadata: { ...authUser.metadata,
            [change === 'login' ? 'lastSignInTime' : 'lastRefreshTime']: new Date(now).toISOString() } } as admin.auth.UserRecord;
        else if (change === 'email') authUser = { ...authUser, email: 'replacement@example.invalid' };
        else if (change === 'basic' || change === 'pro') authUser = { ...authUser, customClaims: { stripeRole: change } };
        else if (change === 'trial') await db.doc(`customers/${uid}/subscriptions/sub_trial`).set({ status: 'trialing' });
        else if (change === 'grace') await db.doc(`users/${uid}/system/status`).set({ gracePeriodUntil: Timestamp.fromMillis(now + INACTIVITY_DAY_MS) });
        else await inactivityRef(db, uid).update({ expireAt: Timestamp.fromMillis(now) });
        expect(await process()).toBe('cancelled');
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBeUndefined();
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(1);
    });
    it('rechecks Auth after billing reads before queuing the reminder', async () => {
        await reminderWindow();
        auth.getUser.mockResolvedValueOnce(authUser).mockResolvedValue({ ...authUser,
            metadata: { ...authUser.metadata, lastRefreshTime: new Date(now).toISOString() } });
        expect(await process()).toBe('cancelled');
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBeUndefined();
    });
    it.each(['off', 'missing-user', 'deletion', 'cancelled', 'billing', 'deadline', 'expiry'])('rechecks the %s boundary inside the reminder transaction', async change => {
        await reminderWindow();
        // Keep both leases valid so the test exercises the deadline/evidence check itself.
        if (change === 'deadline') { now += INACTIVITY_REMINDER_MS - 1; await refreshRun(); }
        if (change === 'expiry') await inactivityRef(db, uid).update({ expireAt: Timestamp.fromMillis(now + 1) });
        stripe.customers.list.mockImplementation(async () => {
            if (change === 'off') await config().update({ mode: 'off' });
            else if (change === 'missing-user') await db.doc(`users/${uid}`).delete();
            else if (change === 'deletion') await db.doc(`userDeletionTombstones/${uid}`).set({ cleanupStatus: 'pending' });
            else if (change === 'cancelled') await invalidateInactivityWarning(db, uid, now);
            else if (change === 'billing') await db.doc(`users/${uid}/system/status`).set({ gracePeriodUntil: Timestamp.fromMillis(now + INACTIVITY_DAY_MS) });
            else now++;
            return { data: [], has_more: false };
        });
        expect(await process()).toBe('skipped');
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBeUndefined();
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(1);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('reports billing read failures and defers a reminder without reserving mail', async () => {
        await reminderWindow(); await config().set({ mode: 'enforce' });
        stripe.customers.list.mockRejectedValue(new Error('synthetic billing outage'));
        expect((await runInactivitySweep(ctx)).counts.failed).toBe(1);
        expect((await inactivityRef(db, uid).get()).get('nextCheckAt').toMillis()).toBe(now + INACTIVITY_DAY_MS);
        expect((await inactivityRef(db, uid).get()).get('reminderMailId')).toBeUndefined();
        expect((await config().get()).get('warnings')).toBeUndefined();
    });
    it('preserves the notice across daily claims signals and accepts server timestamp precision', async () => {
        await db.doc('configuration/stripeBilling').update({ nativeSince: new Timestamp(1, 123_456_000) });
        await dueWarning();
        await db.doc(`users/${uid}/system/status`).set({ claimsUpdatedAt: Timestamp.now() });
        expect(await process()).toBe('deletion_requested');
        expect(auth.deleteUser).toHaveBeenCalledExactlyOnceWith(uid);
    });
    it('reports a stalled first page even before it can save an Auth cursor', async () => {
        const began = now - 8 * INACTIVITY_DAY_MS;
        await config().set({ mode: 'enforce', warningDailyLimit: 0, scanStartedAt: Timestamp.fromMillis(began) });
        const result = await runInactivitySweep(ctx);
        expect(result.capped).toBe(true);
        expect(result.scanAgeMs).toBe(8 * INACTIVITY_DAY_MS);
        expect((await config().get()).get('scanStartedAt').toMillis()).toBe(began);
        expect((await config().get()).get('scanCursor')).toBeUndefined();
    });
    it.each(['PENDING', 'PROCESSING', 'ERROR', 'SUCCESS'])('does not delete with unconfirmed delivery %s', async state => {
        await process(); const episode = (await inactivityRef(db, uid).get()).data()!;
        await db.doc(`mail/${episode.mailId}`).update({ delivery: { state, endTime: Timestamp.fromMillis(now) } });
        now += 40 * INACTIVITY_DAY_MS; await refreshRun();
        expect(await process()).toBe('notice_unconfirmed'); expect(auth.deleteUser).not.toHaveBeenCalled();
        expect((await inactivityRef(db, uid).get()).get('deleteAfter')).toBeUndefined();
    });
    it.each(['login', 'refresh', 'email', 'email-case', 'basic', 'pro', 'disabled'])('cancels a warning after %s changes', async change => {
        await dueWarning();
        if (change === 'login' || change === 'refresh') authUser = { ...authUser, metadata: { ...authUser.metadata,
            [change === 'login' ? 'lastSignInTime' : 'lastRefreshTime']: new Date(now).toISOString() } } as admin.auth.UserRecord;
        else if (change === 'email') authUser = { ...authUser, email: 'replacement@example.invalid' } as admin.auth.UserRecord;
        else if (change === 'email-case') authUser = { ...authUser, email: authUser.email!.toUpperCase() } as admin.auth.UserRecord;
        else if (change === 'disabled') authUser = { ...authUser, disabled: true } as admin.auth.UserRecord;
        else authUser = { ...authUser, customClaims: { stripeRole: change } } as admin.auth.UserRecord;
        expect(await process()).toBe('cancelled'); expect(auth.deleteUser).not.toHaveBeenCalled();
        expect((await inactivityRef(db, uid).get()).get('state')).toBe('cancelled');
        if (change === 'email' || change === 'email-case') {
            expect(await process()).toBe('queued');
            expect((await inactivityRef(db, uid).get()).get('deleteAfter')).toBeUndefined();
        }
    });
    it.each(['trialing', 'active', 'past_due', 'unpaid', 'paused', 'unknown'])('protects local subscription %s despite a Free claim', async status => {
        await db.doc(`customers/${uid}/subscriptions/sub_synthetic`).set({ status, role: 'free' });
        expect(await process()).toBe('blocked'); expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('protects grace, pending billing, ambiguous gifts and incomplete checkout', async () => {
        const status = db.doc(`users/${uid}/system/status`);
        await status.set({ gracePeriodUntil: Timestamp.fromMillis(now + 1) }); expect(await process()).toBe('blocked'); await status.delete();
        const gift = db.doc(`users/${uid}/adminSubscriptionGiftState/lock`);
        await gift.set({ status: 'needs_review' }); expect(await process()).toBe('blocked'); await gift.delete();
        const checkout = db.doc(`customers/${uid}/checkout_sessions/pending`);
        await checkout.set({ price: 'price_synthetic' }); expect(await process()).toBe('blocked'); await checkout.delete();
        await db.doc(`stripeBillingJobs/${uid}`).set({ uid, state: 'pending' }); expect(await process()).toBe('blocked');
    });
    it('blocks truncated subscription history and missing former-member customer ownership', async () => {
        await db.doc(`users/${uid}`).update({ hasSubscribedOnce: true }); expect(await process()).toBe('blocked');
        await db.doc(`customers/${uid}`).set({ stripeId: 'cus_synthetic' });
        const batch = db.batch(); for (let n = 0; n < 101; n++) batch.set(db.doc(`customers/${uid}/subscriptions/sub_${n}`), { status: 'canceled' }); await batch.commit();
        expect((await readInactivityBilling(db, uid, now)).eligible).toBe(false);
    });
    it('invalidates briefly restored membership and ignores events older than the warning', async () => {
        await process(); await invalidateInactivityWarning(db, uid, now - 1);
        expect((await inactivityRef(db, uid).get()).get('state')).toBe('queued');
        await invalidateInactivityWarning(db, uid, now + 1);
        expect((await inactivityRef(db, uid).get()).get('state')).toBe('cancelled');
    });
    it('cancels when activity returns between fence creation and the final Auth check', async () => {
        await dueWarning(); auth.getUser.mockImplementation(async () => (await db.doc(`userDeletionTombstones/${uid}`).get()).exists
            ? { ...authUser, metadata: { ...authUser.metadata, lastRefreshTime: new Date(now).toISOString() } } : authUser);
        expect(await process()).toBe('cancelled'); expect(auth.deleteUser).not.toHaveBeenCalled();
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).exists).toBe(false);
    });
    it('never removes a prepared fence or descendants once native cleanup owns an attempt', async () => {
        await dueWarning();
        const marker = db.doc(`userDeletionTombstones/${uid}`);
        const child = marker.collection('operationalCheckpoints').doc('synthetic');
        auth.getUser.mockImplementation(async () => {
            if ((await marker.get()).exists) {
                await beginAccountDataCleanup(db, uid);
                await child.set({ synthetic: true });
                return { ...authUser, metadata: { ...authUser.metadata, lastRefreshTime: new Date(now).toISOString() } };
            }
            return authUser;
        });
        expect(await process()).toBe('cancelled');
        expect((await marker.get()).get('cleanupAttemptId')).toBeTypeOf('string');
        expect((await child.get()).exists).toBe(true);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('retains the fence on ambiguous Auth failure and never automatically repeats deletion', async () => {
        await dueWarning(); auth.deleteUser.mockRejectedValue(new Error('synthetic lost response'));
        await expect(process()).rejects.toThrow('synthetic lost response');
        expect(await process()).toBe('review_required'); expect(auth.deleteUser).toHaveBeenCalledTimes(1);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).get('expireAt')).toBeUndefined();
    });
    it('protects existing pending and completed deletion markers', async () => {
        for (const cleanupStatus of ['pending', 'complete']) {
            await db.doc(`userDeletionTombstones/${uid}`).set({ cleanupStatus, source: 'deleteSelf' });
            expect(await process()).toBe('skipped');
            expect((await db.doc(`userDeletionTombstones/${uid}`).get()).get('cleanupStatus')).toBe(cleanupStatus);
        }
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('does not create warnings for a missing root or during Stripe failure', async () => {
        await db.doc(`users/${uid}`).delete(); expect(await process()).toBe('blocked');
        await db.doc(`users/${uid}`).set({}); stripe.customers.list.mockRejectedValue(new Error('synthetic Stripe outage'));
        await expect(process()).rejects.toThrow('synthetic Stripe outage');
        expect((await inactivityRef(db, uid).get()).exists).toBe(false);
    });
    it('serializes contenders and enforces the same UTC-day budget across repeated runs', async () => {
        const results = await Promise.allSettled([process(), process()]);
        expect(results.filter(r => r.status === 'fulfilled' && r.value === 'queued')).toHaveLength(1);
        expect((await db.collection('mail').where('uid', '==', uid).get()).size).toBe(1);
        expect((await config().get()).get('warnings')).toBe(1);
        await config().update({ warnings: 100 });
        await inactivityRef(db, uid).update({ state: 'cancelled' }); expect(await process()).toBe('capped');
        now += INACTIVITY_DAY_MS; await refreshRun(); expect(await process()).toBe('queued');
        expect((await config().get()).get('warnings')).toBe(1);
    }, 30_000);
    it('respects deletion cap and the warnings-only mode', async () => {
        await dueWarning(); await config().update({ budgetDay: new Date(now).toISOString().slice(0, 10), deletions: 25 });
        expect(await process()).toBe('capped'); expect(auth.deleteUser).not.toHaveBeenCalled();
        await config().update({ mode: 'warnings-only' });
        expect(await processInactiveAccount(ctx, uid, { ...run, mode: 'warnings-only' })).toBe('waiting');
    });
    it('continues warning discovery when the independent deletion budget is exhausted', async () => {
        await dueWarning();
        const newcomer = { ...authUser, uid: `${uid}-later`, email: 'later@example.invalid' } as admin.auth.UserRecord;
        owners.push(newcomer.uid);
        await db.doc(`users/${newcomer.uid}`).set({ synthetic: true });
        auth.getUser.mockImplementation(async candidate => candidate === newcomer.uid ? newcomer : authUser);
        auth.listUsers.mockResolvedValue({ users: [authUser, newcomer] });
        await config().set({ mode: 'enforce', deletionDailyLimit: 0 });
        const result = await runInactivitySweep(ctx);
        expect(result.counts.queued).toBe(1);
        expect(result.counts.capped).toBe(1);
        expect(result.capped).toBe(true);
        expect((await inactivityRef(db, newcomer.uid).get()).get('state')).toBe('queued');
        expect((await config().get()).get('lastScanCompletedAt')).toBeDefined();
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('lets newer warning receipts progress past capped deletions across daily scan windows', async () => {
        await dueWarning();
        const newcomer = { ...authUser, uid: `${uid}-later`, email: 'later@example.invalid' } as admin.auth.UserRecord;
        owners.push(newcomer.uid);
        await db.doc(`users/${newcomer.uid}`).set({ synthetic: true });
        auth.getUser.mockImplementation(async candidate => candidate === newcomer.uid ? newcomer : authUser);
        auth.listUsers.mockResolvedValue({ users: [authUser, newcomer] });
        expect(await processInactiveAccount(ctx, newcomer.uid, run)).toBe('queued');
        const newer = inactivityRef(db, newcomer.uid);
        const mailId = (await newer.get()).get('mailId');
        const acceptedAt = now;
        await db.doc(`mail/${mailId}`).update({ delivery: { state: 'SUCCESS', endTime: Timestamp.fromMillis(acceptedAt),
            info: { accepted: [newcomer.email], rejected: [], pending: [] } } });
        now += INACTIVITY_DAY_MS;
        await config().set({ mode: 'enforce', deletionDailyLimit: 0 });
        // Model an older deletion consuming the due lane's remaining time in billing reads.
        stripe.customers.list.mockImplementation(async () => {
            now += INACTIVITY_BUDGET_MS / 2;
            return { data: [], has_more: false };
        });
        expect((await runInactivitySweep(ctx)).counts.capped).toBe(1);
        expect((await newer.get()).get('state')).toBe('queued');
        now += INACTIVITY_DAY_MS;
        expect((await runInactivitySweep(ctx)).counts.accepted).toBe(1);
        expect((await newer.get()).get('state')).toBe('warned');
        expect((await newer.get()).get('deleteAfter').toMillis()).toBe(acceptedAt + INACTIVITY_NOTICE_MS);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it.each(['elapsed', 'missing'])('requires a fresh warning when evidence expiry is %s, even before TTL removes it', async kind => {
        await dueWarning();
        const ref = inactivityRef(db, uid);
        const generation = (await ref.get()).get('generation');
        await ref.update({ expireAt: kind === 'elapsed' ? Timestamp.fromMillis(now) : null });
        expect(await process()).toBe('cancelled');
        expect(auth.deleteUser).not.toHaveBeenCalled();
        expect(await process()).toBe('queued');
        expect((await ref.get()).get('generation')).not.toBe(generation);
        expect((await ref.get()).get('acceptedAt')).toBeUndefined();
    });
    it('rechecks evidence expiry after the external billing reads', async () => {
        await dueWarning();
        await inactivityRef(db, uid).update({ expireAt: Timestamp.fromMillis(now + 1) });
        stripe.customers.list.mockImplementation(async () => { now++; return { data: [], has_more: false }; });
        expect(await process()).toBe('blocked');
        expect(auth.deleteUser).not.toHaveBeenCalled();
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).exists).toBe(false);
    });
    it.each(['dry-run', 'warnings-only', 'enforce'])('continues a timed-out %s inventory exactly once', async mode => {
        await config().set({ mode });
        // The first page finishes just as the time budget expires, before the next page starts.
        auth.listUsers.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS;
            return { users: [], pageToken: 'resume-here' };
        });
        const first = await runInactivitySweep(ctx);
        expect(first.capped).toBe(true);
        const ticket = (await pendingBatch()).data()!;
        expect(ticket).toMatchObject({ mode, due: null, authPageSize: 100 });
        expect((await config().get()).get('leaseToken')).toBeUndefined();
        expect((await runInactivitySweep(ctx, 'obsolete-ticket')).outcome).toBe('stale');
        expect((await pendingBatch()).get('id')).toBe(ticket.id);

        const next = await runInactivitySweep(ctx, ticket.id);
        expect(auth.listUsers).toHaveBeenLastCalledWith(100, 'resume-here');
        expect(next.continuationAgeMs).toBeGreaterThanOrEqual(0);
        expect(next.counts).toMatchObject(mode === 'dry-run' ? { eligible: 1 } : { queued: 1 });
        expect((await config().get()).get('lastScanCompletedAt')).toBeDefined();
        expect((await pendingBatch()).exists).toBe(false);
        expect((await runInactivitySweep(ctx, ticket.id)).outcome).toBe('stale');
        expect(auth.listUsers).toHaveBeenCalledTimes(2);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });

    it('claims concurrent deliveries once and leaves a failed claimed batch for the daily recovery', async () => {
        await config().set({ mode: 'warnings-only' });
        auth.listUsers.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS;
            return { users: [], pageToken: 'recover' };
        });
        await runInactivitySweep(ctx);
        const id = (await pendingBatch()).get('id');
        auth.listUsers.mockRejectedValueOnce(new Error('synthetic Auth read failure'));
        const outcomes = await Promise.allSettled([runInactivitySweep(ctx, id), runInactivitySweep(ctx, id)]);
        expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(outcomes).toContainEqual(expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ outcome: 'stale' }) }));
        expect((await pendingBatch()).exists).toBe(false);
        expect((await config().get()).get('lastRun.outcome')).toBe('failed');
        expect((await runInactivitySweep(ctx, id)).outcome).toBe('stale');
        expect(auth.listUsers).toHaveBeenCalledTimes(2);
        now += INACTIVITY_DAY_MS;
        expect((await runInactivitySweep(ctx)).counts.queued).toBe(1);
        expect(auth.listUsers).toHaveBeenLastCalledWith(100, 'recover');
    }, 30_000);

    it('carries the warning allowance across a continuation and stops at the UTC cap', async () => {
        await config().set({ mode: 'warnings-only', warningDailyLimit: 1 });
        const other = { ...authUser, uid: uid + '-next' }; owners.push(other.uid);
        await db.doc(`users/${other.uid}`).set({});
        auth.getUser.mockImplementation(async id => id === other.uid ? other : authUser);
        auth.listUsers.mockResolvedValueOnce({ users: [authUser], pageToken: 'resume' }).mockResolvedValue({ users: [other] });
        stripe.customers.list.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS;
            return { data: [], has_more: false };
        });
        expect((await runInactivitySweep(ctx)).counts.queued).toBe(1);
        const id = (await pendingBatch()).get('id');
        expect((await runInactivitySweep(ctx, id)).counts.capped).toBe(1);
        expect((await pendingBatch()).exists).toBe(false);
        expect((await config().get()).get('warnings')).toBe(1);
        expect((await inactivityRef(db, other.uid).get()).exists).toBe(false);
        now += INACTIVITY_DAY_MS;
        expect((await runInactivitySweep(ctx)).counts.queued).toBe(1);
        expect(auth.listUsers).toHaveBeenLastCalledWith(100, 'resume');
    });

    it.each(['off', 'enforce', 'dry-run'])('discards a pending dry run after settings change to %s', async mode => {
        await config().set({ mode: 'dry-run' });
        auth.listUsers.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS;
            return { users: [authUser] };
        });
        await runInactivitySweep(ctx);
        const ticket = (await pendingBatch()).data()!;
        expect(ticket.authPageSize).toBe(50);
        await config().update({ mode, settingsRevision: 1 });
        expect((await runInactivitySweep(ctx, ticket.id)).outcome).toBe('stale');
        expect((await pendingBatch()).exists).toBe(false);
        expect(auth.listUsers).toHaveBeenCalledTimes(1);
    });

    it('finishes the due backlog without reopening Auth discovery or exceeding the deletion limit', async () => {
        await dueWarning();
        const original = inactivityRef(db, uid);
        const other = { ...authUser, uid: uid + '-next' }; owners.push(other.uid);
        await db.doc(`users/${other.uid}`).set({});
        const otherBilling = await readInactivityBilling(db, other.uid, now);
        await inactivityRef(db, other.uid).set({ ...(await original.get()).data(), uid: other.uid, billingRevision: otherBilling.revision });
        auth.getUser.mockImplementation(async id => id === other.uid ? other : authUser);
        await config().set({ mode: 'enforce', deletionDailyLimit: 1 });
        auth.listUsers.mockResolvedValue({ users: [] });
        stripe.customers.list.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS / 2;
            return { data: [], has_more: false };
        });
        const first = await runInactivitySweep(ctx);
        expect(first.counts.deletion_requested).toBe(1);
        const ticket = (await pendingBatch()).data()!;
        expect(ticket.authPageSize).toBeNull();
        expect(ticket.due.after.path).toBe(original.path);
        const completed = (await config().get()).get('lastScanCompletedAt');
        expect((await runInactivitySweep(ctx, ticket.id)).counts.capped).toBe(1);
        expect((await pendingBatch()).exists).toBe(false);
        expect(auth.listUsers).toHaveBeenCalledTimes(1);
        expect((await config().get()).get('lastScanCompletedAt')).toEqual(completed);
        expect((await config().get()).get('deletions')).toBe(1);
        expect(auth.deleteUser).toHaveBeenCalledTimes(1);
    });

    it('publishes only whole dry scans across batches, preserving the prior result and deduplicating replayed accounts', async () => {
        const review = () => readInactivityAdmin(db, { getUsers: vi.fn().mockResolvedValue({ users: [authUser] }) }, { view: 'eligible' }, now);
        await config().set({ mode: 'dry-run', scanCursor: 'pre-report-cursor', lastScanCompletedAt: Timestamp.fromMillis(now - 1) });
        expect((await review()).lastCompletedDryRun).toBeNull();
        await runInactivitySweep(ctx);
        expect(auth.listUsers).toHaveBeenCalledWith(100, undefined);
        const first = await review();
        expect(first.lastCompletedDryRun).toMatchObject({ eligibleCount: 1, finishedAt: now });
        expect(first.accounts.map(row => row.uid)).toEqual([uid]);

        const other = { ...authUser, uid: uid + '-second' }; owners.push(other.uid);
        await db.doc(`users/${other.uid}`).set({});
        auth.getUser.mockImplementation(async id => id === other.uid ? other : authUser);
        auth.listUsers.mockResolvedValueOnce({ users: [authUser], pageToken: 'next-page' })
            .mockResolvedValueOnce({ users: [other, authUser] });
        stripe.customers.list.mockResolvedValueOnce({ data: [], has_more: false }).mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS;
            return { data: [], has_more: false };
        });
        expect((await runInactivitySweep(ctx)).capped).toBe(true);
        expect((await config().get()).get('scanCursor')).toBe('next-page');
        expect((await review()).lastCompletedDryRun).toEqual(first.lastCompletedDryRun);
        auth.listUsers.mockResolvedValueOnce({ users: [other, authUser] });
        await runInactivitySweep(ctx);
        const completed = await review();
        expect(completed.lastCompletedDryRun!.id).not.toBe(first.lastCompletedDryRun!.id);
        expect(completed.lastCompletedDryRun!.eligibleCount).toBe(2);
        expect(completed.accounts.map(row => row.uid)).toEqual([uid, other.uid]);

        auth.listUsers.mockResolvedValue({ users: [] });
        await runInactivitySweep(ctx);
        const empty = await review();
        expect(empty.lastCompletedDryRun!.eligibleCount).toBe(0);
        expect(empty.accounts).toEqual([]);
        expect((await inactivityRef(db, uid).get()).exists).toBe(false);
        expect((await db.collection('mail').where('uid', '==', uid).get()).empty).toBe(true);
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('retries unresolved discovery pages and discards interrupted drafts when settings change', async () => {
        await config().set({ mode: 'dry-run' });
        auth.listUsers.mockResolvedValueOnce({ users: [authUser], pageToken: 'resume' });
        stripe.customers.list.mockResolvedValueOnce({ data: [], has_more: false }).mockRejectedValueOnce(new Error('retry'));
        expect((await runInactivitySweep(ctx)).counts.failed).toBe(1);
        const interrupted = (await config().get()).data()!;
        expect(interrupted.scanCursor).toBe('resume');
        expect((await pendingBatch()).exists).toBe(false);
        expect(interrupted.lastCompletedDryRun).toBeUndefined();
        await config().update({ settingsRevision: 1 });
        auth.listUsers.mockResolvedValue({ users: [] });
        await runInactivitySweep(ctx);
        expect(auth.listUsers).toHaveBeenLastCalledWith(100, undefined);
        const saved = (await config().get()).data()!;
        expect(saved.lastCompletedDryRun.id).not.toBe(interrupted.dryRunDraft.id);
        expect(saved.lastCompletedDryRun.eligibleCount).toBe(0);
    });
    it('rechecks an unfinished page before publishing and keeps the report through later live scans', async () => {
        await config().set({ mode: 'dry-run' });
        auth.listUsers.mockResolvedValue({ users: [authUser, { ...authUser, disabled: true }] });
        stripe.customers.list.mockImplementationOnce(async () => {
            now += INACTIVITY_BUDGET_MS;
            return { data: [], has_more: false };
        });
        const partial = await runInactivitySweep(ctx);
        expect(partial.counts.eligible).toBe(1);
        expect((await config().get()).get('lastCompletedDryRun')).toBeUndefined();
        expect((await db.collection(`users/${uid}/inactivityDryRunMatches`).get()).empty).toBe(true);
        auth.listUsers.mockResolvedValue({ users: [{ ...authUser, disabled: true }] });
        await runInactivitySweep(ctx);
        const report = (await config().get()).get('lastCompletedDryRun');
        expect(report.eligibleCount).toBe(0);
        await config().update({ mode: 'warnings-only', settingsRevision: 1 });
        await runInactivitySweep(ctx);
        expect((await config().get()).get('lastCompletedDryRun')).toEqual(report);
    });
    it('checks account cleanup again before saving report membership', async () => {
        await config().set({ mode: 'dry-run' });
        stripe.customers.list.mockImplementationOnce(async () => {
            await db.doc(`userDeletionTombstones/${uid}`).set({ cleanupStatus: 'pending' });
            return { data: [], has_more: false };
        });
        await runInactivitySweep(ctx);
        expect((await config().get()).get('lastCompletedDryRun.eligibleCount')).toBe(0);
        expect((await db.collection(`users/${uid}/inactivityDryRunMatches`).get()).empty).toBe(true);
    });
    it('pages only the published dry run and returns page one when a newer report replaces it', async () => {
        const id = randomUUID();
        const replacementId = randomUUID();
        await config().set({ lastCompletedDryRun: { id, slot: 'a', finishedAt: Timestamp.fromMillis(now), eligibleCount: 26 } });
        const batch = db.batch();
        for (let index = 0; index < 26; index++) {
            const owner = uid + '-' + String(index).padStart(2, '0'); owners.push(owner);
            batch.set(db.doc(`users/${owner}/inactivityDryRunMatches/a`), { scanId: id });
        }
        batch.set(db.doc(`users/${uid}/inactivityDryRunMatches/b`), { scanId: replacementId });
        await batch.commit();
        const getUsers = vi.fn().mockResolvedValue({ users: [] });
        const page = await readInactivityAdmin(db, { getUsers }, { view: 'eligible' }, now);
        expect(page.accounts).toHaveLength(25); expect(page.nextUid).toBe(uid + '-24');
        const request = { view: 'eligible' as const, afterUid: page.nextUid!, dryRunId: id };
        const next = await readInactivityAdmin(db, { getUsers }, request, now);
        expect(next.accounts.map(row => row.uid)).toEqual([uid + '-25']); expect(next.nextUid).toBeNull();
        await config().update({ lastCompletedDryRun: { id: replacementId, slot: 'b', finishedAt: Timestamp.fromMillis(now), eligibleCount: 1 } });
        const replaced = await readInactivityAdmin(db, { getUsers }, request, now);
        expect(replaced.accounts.map(row => row.uid)).toEqual([uid]);
        expect(replaced.accounts[0]).toMatchObject({ email: null, authPresent: false, deleteAfter: null });
    });
    it('defaults off, dry-runs without account/mail changes, and skips overlapping sweeps', async () => {
        await config().set({}); expect((await runInactivitySweep(ctx)).outcome).toBe('off');
        expect(auth.listUsers).not.toHaveBeenCalled();
        await config().set({ mode: 'dry-run' }); expect((await runInactivitySweep(ctx)).counts.eligible).toBeGreaterThan(0);
        expect((await inactivityRef(db, uid).get()).exists).toBe(false); expect(auth.deleteUser).not.toHaveBeenCalled();
        await refreshRun(); expect((await runInactivitySweep(ctx)).outcome).toBe('contended');
    });
    it('resumes Auth pagination and only advances after a complete page', async () => {
        await config().set({ mode: 'warnings-only', scanCursor: 'old-page', warningDailyLimit: 0 });
        expect((await runInactivitySweep(ctx)).capped).toBe(true);
        expect(auth.listUsers).toHaveBeenCalledWith(100, 'old-page');
        expect((await config().get()).get('scanCursor')).toBe('old-page');
        await config().update({ warningDailyLimit: 100 });
        await runInactivitySweep(ctx); expect((await config().get()).get('scanCursor')).toBeUndefined();
    });
    it('keeps state in the existing recursive account scope, preserving a neighbouring account', async () => {
        await process(); await db.doc(`users/${uid}/inactivityRetention/state/unknown/child`).set({ synthetic: true });
        const neighbour = `${uid}-neighbour`; owners.push(neighbour); await db.doc(`users/${neighbour}`).set({ preserved: true });
        await beginAccountDataCleanup(db, uid);
        await deleteAccountFirestoreRoot(db, uid, 'users');
        await assertAccountFirestoreRootAbsent(db, uid, 'users');
        expect((await inactivityRef(db, uid).get()).exists).toBe(false);
        expect((await db.doc(`users/${neighbour}`).get()).get('preserved')).toBe(true);
    }, 30_000);
    it('projects current Auth identity and warning delivery without private evidence', async () => {
        await process();
        const episode = (await inactivityRef(db, uid).get()).data()!;
        await config().update({ leaseToken: 'private-lease-canary' });
        const getUsers = vi.fn().mockResolvedValue({ users: [{ uid, email: 'current@example.invalid' }] });
        const view = await readInactivityAdmin(db, { getUsers }, { view: 'queued' }, now);
        expect(view.accounts).toEqual([{ uid, email: 'current@example.invalid', authPresent: true, queuedAt: now,
            acceptedAt: null, deleteAfter: null, requestedAt: null, detail: 'Awaiting confirmed warning delivery.' }]);
        for (const privateValue of ['private-lease-canary', episode.generation, episode.emailHash, episode.billingRevision, authUser.email])
            expect(JSON.stringify(view)).not.toContain(privateValue);
        expect(view.settings).toEqual({ mode: 'enforce', warningDailyLimit: 100, deletionDailyLimit: 25, revision: 0 });
        expect(view.lastRun).toBeNull();
        expect(auth.deleteUser).not.toHaveBeenCalled();
    });
    it('paginates equal-state episodes and includes pending deletion markers after root cleanup', async () => {
        const batch = db.batch();
        for (let n = 0; n < 26; n++) {
            const owner = `${uid}-${String(n).padStart(2, '0')}`; owners.push(owner);
            batch.set(inactivityRef(db, owner), { uid: owner, state: 'warned', expireAt: Timestamp.fromMillis(now + INACTIVITY_DAY_MS) });
        }
        await batch.commit();
        const getUsers = vi.fn().mockResolvedValue({ users: [] });
        const first = await readInactivityAdmin(db, { getUsers }, { view: 'warned' }, now);
        expect(first.accounts).toHaveLength(25); expect(first.nextUid).toBe(`${uid}-24`);
        const second = await readInactivityAdmin(db, { getUsers }, { view: 'warned', afterUid: first.nextUid! }, now);
        expect(second.accounts.map(account => account.uid)).toEqual([`${uid}-25`]); expect(second.nextUid).toBeNull();
        await db.doc(`userDeletionTombstones/${uid}`).set({ source: 'inactivity', cleanupStatus: 'pending',
            authDeleteStatus: 'attempted', createdAt: Timestamp.fromMillis(now - 2 * INACTIVITY_DAY_MS) });
        await db.recursiveDelete(db.doc(`users/${uid}`));
        const pending = await readInactivityAdmin(db, { getUsers }, { view: 'pending-deletion' }, now);
        expect(pending.accounts[0]).toMatchObject({ uid, authPresent: false, detail: 'Deletion needs operator review.' });
    });
    it('persists bounded last-run counters and a failed run without losing the global lease cleanup', async () => {
        await config().set({ mode: 'dry-run' });
        await runInactivitySweep(ctx);
        expect((await config().get()).get('lastRun.outcome')).toBe('completed');
        auth.listUsers.mockRejectedValue(new Error('private-failure-canary'));
        await expect(runInactivitySweep(ctx)).rejects.toThrow('private-failure-canary');
        const saved = (await config().get()).data()!;
        expect(saved.lastRun.outcome).toBe('failed'); expect(saved.leaseToken).toBeUndefined();
        expect(JSON.stringify(saved)).not.toContain('private-failure-canary');
    });
    it.each(['warningDailyLimit', 'deletionDailyLimit', 'settingsRevision'])('reports explicit null %s as invalid instead of a missing default', async field => {
        await config().set({ mode: 'off', [field]: null });
        const getUsers = vi.fn().mockResolvedValue({ users: [] });
        const view = await readInactivityAdmin(db, { getUsers }, { view: 'queued' }, now);
        expect(view.settingsValid).toBe(false); expect(getUsers).not.toHaveBeenCalled();
    });
    it('rejects an unexpected collection-group owner instead of returning an unusable pagination cursor', async () => {
        await db.doc(`users/${uid}/other/root/inactivityRetention/state`).set({ uid, state: 'warned' });
        const getUsers = vi.fn().mockResolvedValue({ users: [] });
        await expect(readInactivityAdmin(db, { getUsers }, { view: 'warned' }, now)).rejects.toThrow('invalid_inactivity_owner');
        expect(getUsers).not.toHaveBeenCalled();
    });
});
