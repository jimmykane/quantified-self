import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { inactivityRef, processInactiveAccount, runInactivitySweep, type InactivityContext } from './inactivity';
import { INACTIVITY_BUDGET_MS, INACTIVITY_CONTROL, INACTIVITY_DAY_MS, INACTIVITY_NOTICE_MS } from './inactivity-policy';
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
    const refreshRun = () => config().set({ mode: run.mode, leaseToken: run.token, leaseUntil: Timestamp.fromMillis(now + 540_000) }, { merge: true });
    const process = () => processInactiveAccount(ctx, uid, run);
    async function acceptWarning() {
        const episode = (await inactivityRef(db, uid).get()).data()!;
        await db.doc(`mail/${episode.mailId}`).update({ delivery: { state: 'SUCCESS', endTime: Timestamp.fromMillis(now),
            info: { accepted: [authUser.email], rejected: [], pending: [] } } });
        expect(await process()).toBe('accepted');
    }
    async function dueWarning() {
        expect(await process()).toBe('queued');
        await acceptWarning();
        now += INACTIVITY_NOTICE_MS;
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
        now += INACTIVITY_NOTICE_MS - 1; await refreshRun(); expect(await process()).toBe('waiting');
        now++; await refreshRun(); expect(await process()).toBe('deletion_requested');
        expect(auth.deleteUser).toHaveBeenCalledExactlyOnceWith(uid);
        expect((await db.doc(`userDeletionTombstones/${uid}`).get()).data()).toMatchObject({ source: 'inactivity', cleanupStatus: 'pending', authDeleteStatus: 'attempted' });
        expect((await db.doc(`mail/account_deleted_confirmation_${uid}`).get()).get('uid')).toBe(uid);
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
