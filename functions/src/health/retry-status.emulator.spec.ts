import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_PROVIDERS, type HealthProvider } from '../../../shared/health';
import { increaseRetryCountIfCurrentUserActive, QueueResult } from '../queue-utils';
import { getQueueCleanupTombstoneDocumentRef } from '../queue/cleanup-tombstone';
import { updateHealthSyncState } from './writer';

vi.unmock('firebase-admin');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Health retry status in isolated Firestore', () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('Loopback Firestore emulator required.');
    }
    let db: admin.firestore.Firestore;
    let uid: string;
    let queueRef: admin.firestore.DocumentReference;
    let stateRef: admin.firestore.DocumentReference;
    let metaRef: admin.firestore.DocumentReference;
    let provider: HealthProvider;
    beforeAll(() => {
        if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-functions-ci' });
        db = admin.firestore();
        // Match the production bootstrap used by queue/DLQ writers.
        db.settings({ ignoreUndefinedProperties: true });
    });
    beforeEach(() => { uid = `health-retry-${randomUUID()}`; });
    afterEach(async () => {
        await db.recursiveDelete(db.doc(`users/${uid}`));
        if (queueRef) {
            await db.recursiveDelete(queueRef);
            await db.recursiveDelete(db.doc(`failed_jobs/${queueRef.id}`));
            await db.recursiveDelete(getQueueCleanupTombstoneDocumentRef(db, 'sleepSyncQueue', queueRef.id));
        }
        await db.recursiveDelete(db.doc(`userDeletionTombstones/${uid}`));
    });
    afterAll(async () => { if (db) await admin.app().delete(); });

    async function seed(selectedProvider: HealthProvider, retryCount = 9) {
        provider = selectedProvider;
        queueRef = db.doc(`sleepSyncQueue/${uid}`);
        stateRef = db.doc(`users/${uid}/healthSyncState/${provider}`);
        metaRef = db.doc(`users/${uid}/meta/${provider}`);
        await db.doc(`users/${uid}`).set({});
        await metaRef.set({ connectionState: 'connected', connectionStateGeneration: 'original' });
        await stateRef.set({ provider, status: 'failed', retryPending: true, lastSyncedAtMs: 9_000, updatedAtMs: 10_000 });
        await queueRef.set({ userID: uid, dateCreated: 1, processed: false, retryCount, dispatchedToCloudTask: 1, queueRevision: 'original' });
    }
    async function terminalState(transaction: admin.firestore.Transaction) {
        return updateHealthSyncState(uid, provider, {
            status: 'failed', retryPending: false, lastErrorCode: 'provider_sync_failed',
        }, 20_000, {
            db, transaction,
            requiredDocumentFieldValues: { documentRef: metaRef,
                expectedFields: { connectionState: 'connected', connectionStateGeneration: 'original' } },
        });
    }
    function retry(finalize = terminalState) {
        return increaseRetryCountIfCurrentUserActive({
            // Deliberately stale input: the transaction's live count must decide exhaustion.
            queueItem: { id: queueRef.id, ref: queueRef, dateCreated: 1, retryCount: 0, processed: false, dispatchedToCloudTask: 1 },
            error: new Error('safe provider failure'), userID: uid, phase: 'health_retry_test', logPrefix: 'HealthRetryTest',
            isCurrent: current => current.processed === false && current.queueRevision === 'original',
            onRetryExhaustedInTransaction: finalize,
        });
    }

    it.each([HEALTH_PROVIDERS.GarminAPI, HEALTH_PROVIDERS.SuuntoApp, HEALTH_PROVIDERS.COROSAPI])(
        'keeps %s retrying until its live retry count is exhausted', async selectedProvider => {
            await seed(selectedProvider, 8);
            expect(await retry()).toBe(QueueResult.RetryIncremented);
            expect((await stateRef.get()).get('retryPending')).toBe(true);
            expect((await queueRef.get()).get('retryCount')).toBe(9);
            expect((await db.doc(`failed_jobs/${queueRef.id}`).get()).exists).toBe(false);
            expect(await retry()).toBe(QueueResult.MovedToDLQ);
            expect((await queueRef.get()).exists).toBe(false);
            expect((await db.doc(`failed_jobs/${queueRef.id}`).get()).get('retryCount')).toBe(10);
            expect((await stateRef.get()).data()).toMatchObject({ status: 'failed', retryPending: false, lastSyncedAtMs: 9_000 });
        },
    );

    it('rolls back final status and DLQ movement together when the transaction fails', async () => {
        await seed(HEALTH_PROVIDERS.SuuntoApp);
        const result = await retry(async transaction => {
            await terminalState(transaction);
            throw new Error('simulated transaction failure');
        });
        expect(result).toBe(QueueResult.Failed);
        expect((await stateRef.get()).get('retryPending')).toBe(true);
        expect((await queueRef.get()).get('retryCount')).toBe(9);
        expect((await db.doc(`failed_jobs/${queueRef.id}`).get()).exists).toBe(false);
    });

    it('does not consume retries or overwrite a replacement connection', async () => {
        await seed(HEALTH_PROVIDERS.GarminAPI);
        await metaRef.update({ connectionStateGeneration: 'replacement' });
        await stateRef.update({ status: 'ready', retryPending: false, updatedAtMs: 30_000 });
        expect(await retry()).toBe(QueueResult.Processed);
        expect((await stateRef.get()).get('status')).toBe('ready');
        expect((await queueRef.get()).get('retryCount')).toBe(9);
        expect((await db.doc(`failed_jobs/${queueRef.id}`).get()).exists).toBe(false);
    });

    it('does not overwrite a newer successful sync when an older job exhausts retries', async () => {
        await seed(HEALTH_PROVIDERS.COROSAPI);
        await stateRef.update({ status: 'ready', retryPending: false, lastSyncedAtMs: 25_000, updatedAtMs: 30_000 });
        expect(await retry()).toBe(QueueResult.MovedToDLQ);
        expect((await stateRef.get()).data()).toMatchObject({ status: 'ready', retryPending: false, lastSyncedAtMs: 25_000 });
    });

    it('clears retry metadata after a successful sync', async () => {
        await seed(HEALTH_PROVIDERS.COROSAPI, 1);
        await updateHealthSyncState(uid, provider, { status: 'ready', lastErrorCode: null, lastSyncedAtMs: 20_000 }, 20_000, { db });
        expect((await stateRef.get()).data()).toMatchObject({ status: 'ready', retryPending: false, lastErrorCode: null, lastSyncedAtMs: 20_000 });
    });

    it.each(['missing', 'tombstoned'])('does not recreate Health state for a %s user', async kind => {
        await seed(HEALTH_PROVIDERS.SuuntoApp);
        await db.recursiveDelete(stateRef);
        if (kind === 'missing') await db.recursiveDelete(db.doc(`users/${uid}`));
        else await db.doc(`userDeletionTombstones/${uid}`).set({});
        const finalize = vi.fn(terminalState);
        expect(await retry(finalize)).toBe(QueueResult.Processed);
        expect(finalize).not.toHaveBeenCalled();
        expect((await stateRef.get()).exists).toBe(false);
        expect((await db.doc(`failed_jobs/${queueRef.id}`).get()).exists).toBe(false);
    });

    it('ignores a stale queue revision without changing provider state', async () => {
        await seed(HEALTH_PROVIDERS.GarminAPI);
        await queueRef.update({ queueRevision: 'replacement' });
        const finalize = vi.fn(terminalState);
        expect(await retry(finalize)).toBe(QueueResult.Processed);
        expect(finalize).not.toHaveBeenCalled();
        expect((await stateRef.get()).get('retryPending')).toBe(true);
    });
});
