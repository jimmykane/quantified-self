import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_PROVIDERS, type HealthProvider } from '../../../shared/health';
import { increaseRetryCountIfCurrentUserActive, QueueResult } from '../queue-utils';
import { MAX_RETRY_COUNT, PROVIDER_MAX_RETRY_COUNT } from '../shared/queue-config';
import { updateHealthSyncState } from './writer';

vi.unmock('firebase-admin');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Health status in the existing retry transaction', () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('Loopback emulator required.');
    }
    let db: admin.firestore.Firestore;
    let uid: string;
    let provider: HealthProvider;
    beforeAll(() => {
        if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-functions-ci' });
        db = admin.firestore();
        db.settings({ ignoreUndefinedProperties: true });
    });
    beforeEach(() => { uid = `health-status-${randomUUID()}`; provider = HEALTH_PROVIDERS.SuuntoApp; });
    afterEach(async () => {
        await db.recursiveDelete(db.doc(`users/${uid}`));
        await db.recursiveDelete(db.doc(`sleepSyncQueue/${uid}`));
        await db.recursiveDelete(db.doc(`failed_jobs/${uid}`));
    });
    afterAll(async () => { await admin.app().delete(); });
    const state = () => db.doc(`users/${uid}/healthSyncState/${provider}`);
    const queue = () => db.doc(`sleepSyncQueue/${uid}`);
    async function seed(retryCount = PROVIDER_MAX_RETRY_COUNT - 1) {
        await db.doc(`users/${uid}`).set({});
        await db.doc(`users/${uid}/meta/connection`).set({ generation: 'original' });
        await queue().set({ userID: uid, processed: false, retryCount, queueRevision: 'original', dateCreated: 1 });
        await state().set({ provider, status: 'failed', retryPending: true, lastSyncedAtMs: 8_000, updatedAtMs: 10_000 });
    }
    async function finalStatus(transaction: admin.firestore.Transaction) {
        await updateHealthSyncState(uid, provider, { status: 'failed', retryPending: false }, 20_000, {
            db, transaction, requiredDocumentFieldValues: {
                documentRef: db.doc(`users/${uid}/meta/connection`), expectedFields: { generation: 'original' },
            },
        });
    }
    const retry = (finalize = finalStatus) => increaseRetryCountIfCurrentUserActive({
        queueItem: { id: uid, ref: queue(), dateCreated: 1, processed: false, retryCount: 0 },
        userID: uid, phase: 'health_status_test', logPrefix: 'HealthStatusTest', error: new Error('provider failed'),
        isCurrent: current => current.queueRevision === 'original', onRetryExhaustedInTransaction: finalize,
    });
    it.each([HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.SuuntoApp, HEALTH_PROVIDERS.COROSAPI])(
        'keeps %s pending beyond the default internal retry budget', async selected => {
            provider = selected;
            await seed(MAX_RETRY_COUNT - 1);
            expect(await retry()).toBe(QueueResult.RetryIncremented);
            expect((await queue().get()).get('retryCount')).toBe(MAX_RETRY_COUNT);
            expect((await state().get()).get('retryPending')).toBe(true);
            expect((await db.doc(`failed_jobs/${uid}`).get()).exists).toBe(false);
        },
    );
    it.each([HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.SuuntoApp, HEALTH_PROVIDERS.COROSAPI])(
        'keeps %s retrying until the live counter commits exhaustion', async selected => {
            provider = selected;
            await seed(PROVIDER_MAX_RETRY_COUNT - 2);
            expect(await retry()).toBe(QueueResult.RetryIncremented);
            expect((await queue().get()).get('retryCount')).toBe(PROVIDER_MAX_RETRY_COUNT - 1);
            expect((await state().get()).get('retryPending')).toBe(true);
            expect(await retry()).toBe(QueueResult.MovedToDLQ);
            expect((await state().get()).data()).toMatchObject({ status: 'failed', retryPending: false, lastSyncedAtMs: 8_000 });
            expect((await queue().get()).exists).toBe(false);
            expect((await db.doc(`failed_jobs/${uid}`).get()).get('retryCount')).toBe(PROVIDER_MAX_RETRY_COUNT);
        },
    );
    it('rolls status and queue movement back together on a failed transaction', async () => {
        await seed();
        expect(await retry(async transaction => { await finalStatus(transaction); throw new Error('commit failed'); })).toBe(QueueResult.Failed);
        expect((await state().get()).get('retryPending')).toBe(true);
        expect((await queue().get()).get('retryCount')).toBe(PROVIDER_MAX_RETRY_COUNT - 1);
        expect((await db.doc(`failed_jobs/${uid}`).get()).exists).toBe(false);
    });
    it.each(['queueRevision', 'processingOwner'])('does not publish a pending retry after %s changes', async field => {
        await seed();
        await state().set({ provider, status: 'ready', retryPending: false, updatedAtMs: 15_000 });
        await queue().update({ processingOwner: 'worker-1', [field]: 'replacement' });
        expect(await updateHealthSyncState(uid, provider, { status: 'failed', retryPending: true }, 20_000, {
            db, additionalRequiredDocumentFieldValues: [{ documentRef: queue(), expectedFields: {
                processed: false, queueRevision: 'original', processingOwner: 'worker-1',
            } }],
        })).toBe(false);
        expect((await state().get()).data()).toMatchObject({ status: 'ready', retryPending: false });
    });
    it.each(['newer_success', 'replacement_connection'])('preserves %s without changing the queue outcome', async reason => {
        await seed();
        await state().set({ provider, status: 'ready', retryPending: false, updatedAtMs: reason === 'newer_success' ? 30_000 : 15_000 });
        if (reason === 'replacement_connection') await db.doc(`users/${uid}/meta/connection`).set({ generation: 'replacement' });
        expect(await retry()).toBe(QueueResult.MovedToDLQ);
        expect((await state().get()).data()).toMatchObject({ status: 'ready', retryPending: false });
    });
});
