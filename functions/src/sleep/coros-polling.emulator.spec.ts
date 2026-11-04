import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { generateIDFromParts } from '../shared/id-generator';

vi.unmock('firebase-admin');
vi.mock('./queue', async importOriginal => {
    const actual = await importOriginal<typeof import('./queue')>();
    return { ...actual, addSleepSyncQueueItem: vi.fn(actual.addSleepSyncQueueItem) };
});
vi.mock('../utils', async importOriginal => {
    const actual = await importOriginal<typeof import('../utils')>();
    return { ...actual, enqueueSleepSyncTask: vi.fn().mockResolvedValue(true) };
});
vi.mock('../request-helper', () => ({
    get: vi.fn().mockRejectedValue(new Error('Provider I/O is forbidden in emulator tests')),
    post: vi.fn().mockRejectedValue(new Error('Provider I/O is forbidden in emulator tests')),
}));
import { addSleepSyncQueueItem, processSleepSyncQueueItem } from './queue';
import * as providerTransport from '../request-helper';
import { enqueueSleepSyncTask } from '../utils';
import { COROS_POLL_STATE_DOCUMENT, enqueueCOROSDailyPoll } from './coros-polling';

const hour = 3_600_000;
const day = 24 * hour;
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('COROS polling coverage receipts', () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('Loopback Firestore emulator required.');
    }
    let db: admin.firestore.Firestore;
    let uid: string;
    const account = 'test-coros-account';
    const now = Date.UTC(2026, 10, 4, 12);
    const state = () => db.doc(`users/${uid}/${COROS_POLL_STATE_DOCUMENT}`);
    const root = () => db.doc(`COROSAPIAccessTokens/${uid}`);
    const token = () => root().collection('tokens').doc(account);
    const meta = () => db.doc(`users/${uid}/meta/${ServiceNames.COROSAPI}`);
    const queueIds = new Set<string>();
    beforeAll(() => {
        if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-functions-ci' });
        db = admin.firestore();
        db.settings({ ignoreUndefinedProperties: true });
    });
    beforeEach(async () => {
        uid = `coros-poll-${randomUUID()}`;
        vi.clearAllMocks();
        vi.mocked(enqueueSleepSyncTask).mockResolvedValue(true);
        await db.doc(`users/${uid}`).set({});
        await root().set({ activeOAuthCredentialGeneration: 'credential' });
        await token().set({ openId: account, tokenCredentialGeneration: 'credential', accessToken: 'synthetic-access',
            serviceName: ServiceNames.COROSAPI });
        await meta().set({ providerUserId: account, connectionState: 'connected', connectionStateGeneration: 'connection' });
        const actual = await vi.importActual<typeof import('./queue')>('./queue');
        // Only Cloud Tasks transport is mocked; exercise the real guarded queue admission.
        vi.mocked(addSleepSyncQueueItem).mockImplementation(async input => {
            const id = await generateIDFromParts([input.provider, input.type, input.providerUserId, input.dedupeKey!]);
            queueIds.add(id);
            const ref = await actual.addSleepSyncQueueItem(input);
            queueIds.add(ref.id);
            return ref;
        });
    });
    afterEach(async () => {
        await db.recursiveDelete(db.doc(`users/${uid}`));
        await db.recursiveDelete(root());
        await db.recursiveDelete(db.doc(`userDeletionTombstones/${uid}`));
        for (const id of queueIds) {
            await db.recursiveDelete(db.doc(`sleepSyncQueue/${id}`));
            await db.recursiveDelete(db.doc(`failed_jobs/${id}`));
        }
        queueIds.clear();
    });
    afterAll(async () => { await admin.app().delete(); });
    async function pendingRef() {
        return db.doc(`sleepSyncQueue/${(await state().get()).get('pending.queueId')}`);
    }
    async function finish(status = 'success') { await (await pendingRef()).update({ processed: true, resultStatus: status }); }

    it('admits one immediate seven-day poll without claiming successful coverage', async () => {
        expect(await enqueueCOROSDailyPoll(uid, account, now)).toBe(true);
        expect((await state().get()).data()).toMatchObject({ lastSuccessfulEndMs: null, lastReconciledEndMs: null,
            pending: { startMs: now - 7 * day, endMs: now + 14 * hour, pollAtMs: now, reconciliation: true } });
        const input = vi.mocked(addSleepSyncQueueItem).mock.calls[0][0];
        expect(input.dispatchImmediately).toBe(true);
        const queue = await (await pendingRef()).get();
        expect(queue.get('queueRevision')).toMatch(/^[a-f0-9-]{36}$/);
        expect(queue.get('corosTokenCredentialGeneration')).toBe('credential');
        expect(queue.get('corosConnectionStateGeneration')).toBe('connection');
        expect(queue.get('dispatchedToCloudTask')).toBeGreaterThan(0);
        expect(enqueueSleepSyncTask).toHaveBeenCalledWith(queue.id, queue.get('dateCreated'), undefined, {
            queueRevision: queue.get('queueRevision'), queueDateCreated: queue.get('dateCreated'),
        });
        expect(input.requiredDocumentFieldValues?.map(guard => guard.documentRef.path)).toEqual([
            root().path, token().path, meta().path, state().path,
        ]);
        // Queue admission compares top-level data fields, not dotted Firestore paths.
        for (const guard of input.requiredDocumentFieldValues ?? []) {
            const data = (await guard.documentRef.get()).data();
            for (const [field, expected] of Object.entries(guard.expectedFields)) {
                expect(data?.[field]).toEqual(expected);
            }
        }
    });
    it('advances only from committed whole-job success and then requests recent dates', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await finish();
        await enqueueCOROSDailyPoll(uid, account, now + hour);
        expect((await state().get()).data()).toMatchObject({ lastSuccessfulEndMs: now, lastReconciledEndMs: now,
            pending: { startMs: Date.UTC(2026, 10, 3), endMs: now + 15 * hour, pollAtMs: now + hour, reconciliation: false } });
    });
    it('retains successful receipts from the original UTC-only cursor format', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await state().update({ 'pending.pollAtMs': admin.firestore.FieldValue.delete(), 'pending.endMs': now });
        await (await pendingRef()).update({ rangeEndMs: now });
        await finish();
        await enqueueCOROSDailyPoll(uid, account, now + hour);
        expect((await state().get()).get('lastSuccessfulEndMs')).toBe(now);
        expect((await state().get()).get('pending.endMs')).toBe(now + 15 * hour);
    });
    it('keeps pending retries, partial writes and leases on their existing task', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await (await pendingRef()).update({ retryCount: 15, sessionsWritten: 8, processingLeaseExpiresAt: now + 2 * hour });
        expect(await enqueueCOROSDailyPoll(uid, account, now + hour)).toBe(false);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
        expect((await state().get()).get('lastSuccessfulEndMs')).toBeNull();
        expect((await (await pendingRef()).get()).get('retryCount')).toBe(15);
    });
    it.each(['failed', 'skipped', 'provider_disabled', undefined])('does not advance from terminal %s', async status => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await (await pendingRef()).update({ processed: true, ...(status ? { resultStatus: status } : {}) });
        await enqueueCOROSDailyPoll(uid, account, now + hour);
        expect((await state().get()).data()).toMatchObject({ lastSuccessfulEndMs: null, lastReconciledEndMs: null,
            pending: { reconciliation: true } });
    });
    it('does not advance from a success receipt for a different range', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await finish();
        await (await pendingRef()).update({ rangeStartMs: now - day });
        await enqueueCOROSDailyPoll(uid, account, now + hour);
        expect((await state().get()).get('lastSuccessfulEndMs')).toBeNull();
    });
    it('does not repeat completed work in the same hourly slot', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await finish();
        expect(await enqueueCOROSDailyPoll(uid, account, now + 20_000)).toBe(false);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
    });
    it('reconciles again after 24 hours, using success rather than admission time', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await finish();
        await enqueueCOROSDailyPoll(uid, account, now + 23 * hour);
        expect((await state().get()).get('pending.reconciliation')).toBe(false);
        await finish();
        await enqueueCOROSDailyPoll(uid, account, now + day);
        expect((await state().get()).get('pending.reconciliation')).toBe(true);
        expect((await state().get()).get('lastReconciledEndMs')).toBe(now);
    });
    it('reuses the same reservation after queue admission fails', async () => {
        const enqueue = vi.mocked(addSleepSyncQueueItem).getMockImplementation()!;
        vi.mocked(addSleepSyncQueueItem).mockRejectedValueOnce(new Error('temporary admission failure'));
        await expect(enqueueCOROSDailyPoll(uid, account, now)).rejects.toThrow('temporary admission failure');
        const first = (await state().get()).get('pending');
        vi.mocked(addSleepSyncQueueItem).mockImplementation(enqueue);
        await enqueueCOROSDailyPoll(uid, account, now + 20_000);
        expect((await state().get()).get('pending')).toEqual(first);
    });
    it('leaves a durable undispatched row for reconciliation after dispatch fails', async () => {
        vi.mocked(enqueueSleepSyncTask).mockRejectedValueOnce(new Error('dispatch unavailable'));
        await expect(enqueueCOROSDailyPoll(uid, account, now)).rejects.toThrow('dispatch unavailable');
        expect((await (await pendingRef()).get()).get('dispatchedToCloudTask')).toBeNull();
        expect(await enqueueCOROSDailyPoll(uid, account, now + hour)).toBe(false);
        expect(addSleepSyncQueueItem).toHaveBeenCalledTimes(1);
    });
    it('does not recreate a dead letter within the same slot', async () => {
        await enqueueCOROSDailyPoll(uid, account, now);
        const queue = await pendingRef();
        await db.doc(`failed_jobs/${queue.id}`).set({});
        await db.recursiveDelete(queue);
        expect(await enqueueCOROSDailyPoll(uid, account, now + 10_000)).toBe(false);
    });
    it.each(['connection', 'credential'])('resets coverage when the same account changes %s generation', async generation => {
        await enqueueCOROSDailyPoll(uid, account, now);
        await finish();
        if (generation === 'connection') await meta().update({ connectionStateGeneration: 'replacement' });
        else {
            await root().update({ activeOAuthCredentialGeneration: 'replacement' });
            await token().update({ tokenCredentialGeneration: 'replacement' });
        }
        await enqueueCOROSDailyPoll(uid, account, now + hour);
        expect((await state().get()).get('lastSuccessfulEndMs')).toBeNull();
        expect((await state().get()).get('pending.reconciliation')).toBe(true);
    });
    it('supports retained legacy connections with no credential generations', async () => {
        await root().set({});
        await token().set({});
        await meta().set({ providerUserId: account });
        expect(await enqueueCOROSDailyPoll(uid, account, now)).toBe(true);
    });
    it.each(['connection', 'credential'])('retires queued work before provider I/O after %s changes', async kind => {
        await enqueueCOROSDailyPoll(uid, account, now);
        const ref = await pendingRef();
        if (kind === 'connection') await meta().update({ connectionStateGeneration: 'replacement' });
        else {
            await root().update({ activeOAuthCredentialGeneration: 'replacement' });
            await token().update({ tokenCredentialGeneration: 'replacement' });
        }
        const snapshot = await ref.get();
        await processSleepSyncQueueItem({ ...snapshot.data(), id: ref.id, ref } as Parameters<typeof processSleepSyncQueueItem>[0]);
        expect((await ref.get()).data()).toMatchObject({ processed: true, resultStatus: 'skipped',
            skippedReason: 'user_or_provider_lifecycle_changed' });
        expect(providerTransport.get).not.toHaveBeenCalled();
        expect(providerTransport.post).not.toHaveBeenCalled();
    });
    it('rejects a reconnect between reservation and the real queue admission transaction', async () => {
        const enqueue = vi.mocked(addSleepSyncQueueItem).getMockImplementation()!;
        vi.mocked(addSleepSyncQueueItem).mockImplementationOnce(async input => {
            await meta().update({ connectionStateGeneration: 'replacement' });
            return enqueue(input);
        });
        await expect(enqueueCOROSDailyPoll(uid, account, now)).rejects.toMatchObject({ name: 'ProviderQueueUserNotConnectedError' });
        expect((await (await pendingRef()).get()).exists).toBe(false);
    });
    it.each(['disconnect', 'root disconnect', 'reconnect required', 'missing root', 'missing token', 'credential mismatch', 'account changed', 'missing user', 'deletion'])(
        'does not reserve or enqueue after %s', async reason => {
            if (reason === 'disconnect') await meta().update({ connectionState: 'disconnect_pending' });
            if (reason === 'root disconnect') await root().update({ disconnectOperationGeneration: 'pending' });
            if (reason === 'reconnect required') await meta().update({ connectionState: 'reconnect_required' });
            if (reason === 'missing root') await db.recursiveDelete(root());
            if (reason === 'missing token') await db.recursiveDelete(token());
            if (reason === 'credential mismatch') await token().update({ tokenCredentialGeneration: 'old' });
            if (reason === 'account changed') await meta().update({ providerUserId: 'other-account' });
            if (reason === 'missing user') await db.recursiveDelete(db.doc(`users/${uid}`));
            if (reason === 'deletion') await db.doc(`userDeletionTombstones/${uid}`).set({});
            expect(await enqueueCOROSDailyPoll(uid, account, now)).toBe(false);
            expect((await state().get()).exists).toBe(false);
            expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
        },
    );
    it('concurrent scheduler deliveries share one canonical reservation', async () => {
        await Promise.all([enqueueCOROSDailyPoll(uid, account, now), enqueueCOROSDailyPoll(uid, account, now + 1)]);
        expect(queueIds.size).toBe(1);
        const inputs = vi.mocked(addSleepSyncQueueItem).mock.calls.map(([input]) => input);
        expect(new Set(inputs.map(input => input.dedupeKey)).size).toBe(1);
    }, 30_000);
    it.each(['dispatched', 'retrying', 'completed', 'dead-lettered'])('preserves a %s poll that wins admission after a stale duplicate preflight', async status => {
        const actual = await vi.importActual<typeof import('./queue')>('./queue');
        const enqueue = vi.mocked(addSleepSyncQueueItem).getMockImplementation()!;
        let winner: admin.firestore.DocumentSnapshot | undefined;
        vi.mocked(addSleepSyncQueueItem).mockImplementationOnce(async input => {
            const runTransaction = db.runTransaction.bind(db);
            // The duplicate has already observed a missing queue row. Let the
            // first admission win before the duplicate's write transaction.
            const transactionSpy = vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (...args) => {
                const ref = await actual.addSleepSyncQueueItem(input);
                if (status === 'retrying') await ref.update({ retryCount: 4, dispatchedToCloudTask: null });
                if (status === 'completed') await ref.update({ processed: true, resultStatus: 'success' });
                if (status === 'dead-lettered') {
                    await db.doc(`failed_jobs/${ref.id}`).set({ originalCollection: 'sleepSyncQueue' });
                    await db.recursiveDelete(ref);
                }
                winner = await ref.get();
                return runTransaction(...args);
            });
            try { return await enqueue(input); }
            finally { transactionSpy.mockRestore(); }
        });
        await enqueueCOROSDailyPoll(uid, account, now);
        const current = await (await pendingRef()).get();
        expect(winner).toBeDefined();
        expect(current.data()).toEqual(winner!.data());
        if (winner!.exists) expect(current.updateTime!.isEqual(winner!.updateTime!)).toBe(true);
        else expect((await db.doc(`failed_jobs/${current.id}`).get()).get('originalCollection')).toBe('sleepSyncQueue');
        expect(enqueueSleepSyncTask).toHaveBeenCalledTimes(1);
    });
});
