import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_MAX_RETRY_COUNT } from '../shared/queue-config';
import type { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';

const state = vi.hoisted(() => ({
    enqueue: vi.fn(), download: vi.fn(), upload: vi.fn(), status: vi.fn(), processing: vi.fn(), fingerprint: vi.fn(),
    afterCooldownRead: undefined as undefined | (() => Promise<void>),
}));
vi.unmock('@sports-alliance/sports-lib');
vi.mock('firebase-admin', async original => {
    const actual = await original<typeof import('firebase-admin')>();
    return { ...actual, apps: [], initializeApp: actual.default.initializeApp, firestore: actual.default.firestore,
        storage: () => ({ bucket: () => ({ file: () => ({ download: state.download }) }) }) };
});
vi.mock('firebase-functions/v2/tasks', () => ({ onTaskDispatched: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../shared/cloud-tasks', () => ({ enqueueActivitySyncTask: state.enqueue }));
vi.mock('../utils', async original => ({ ...await original<typeof import('../utils')>(), hasProAccess: async () => true }));
vi.mock('./settings', () => ({ isActivitySyncRouteEnabledForUser: async () => true }));
vi.mock('./metadata', () => ({
    setActivitySyncProcessingMetadata: state.processing,
    setActivitySyncSuccessMetadata: vi.fn(), setActivitySyncSkippedMetadata: vi.fn(),
    setActivitySyncRetryingMetadata: vi.fn(), setActivitySyncRetryingMetadataIfQueueItemDeferred: vi.fn(),
    setActivitySyncFailedMetadata: vi.fn(), toActivitySyncMetadataError: () => ({ code: 'unknown', message: 'synthetic failure' }),
}));
vi.mock('./outbound-fingerprint', () => ({ recordActivitySyncOutboundFingerprint: state.fingerprint }));
vi.mock('../wahoo/activities', () => ({ uploadActivityFileToWahoo: state.upload, getWahooActivityUploadStatus: state.status }));
vi.mock('../wahoo/rate-limit', async original => {
    const actual = await original<typeof import('../wahoo/rate-limit')>();
    return { ...actual, getWahooRateLimitCooldownSeconds: async () => {
        const seconds = await actual.getWahooRateLimitCooldownSeconds();
        await state.afterCooldownRead?.();
        return seconds;
    } };
});

import { processActivitySyncQueueItem } from './process-queue-item';
import { processActivitySyncTask } from '../tasks/activity-sync-worker';
import { QueueResult, PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER } from '../queue-utils';
import { extendWahooRateLimitCooldown } from '../wahoo/rate-limit';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Wahoo cooldown handoffs in isolated Firestore', () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('Loopback Firestore emulator required.');
    }
    let db: admin.firestore.Firestore;
    const uid = 'cooldown-owner';
    const queueId = 'cooldown-queue';
    beforeAll(() => {
        admin.initializeApp({ projectId: `demo-wahoo-cooldown-${randomUUID().slice(0, 8)}` });
        db = admin.firestore();
    });
    afterAll(async () => { if (db) await db.terminate(); });
    beforeEach(async () => {
        vi.clearAllMocks();
        state.afterCooldownRead = undefined;
        state.enqueue.mockReset().mockResolvedValue(true);
        state.download.mockResolvedValue([Buffer.from('SYNTHETIC_FIT')]);
        state.fingerprint.mockResolvedValue({ exactFingerprintId: 'synthetic-fingerprint' });
        state.upload.mockResolvedValue({ status: 'success', uploadId: 'upload', workoutKey: 'workout' });
        state.status.mockResolvedValue({ status: 'success', uploadId: 'accepted-upload', workoutKey: 'workout' });
        for (const collection of ['users', 'userDeletionTombstones', 'activitySyncQueue', 'failed_jobs', 'trainingProviderCapacity', 'wahooAPIAccessTokens']) {
            await db.recursiveDelete(db.collection(collection));
        }
        await db.doc(`users/${uid}`).set({ stripeRole: 'pro' });
        await db.doc(`wahooAPIAccessTokens/${uid}/tokens/account`).set({ serviceName: ServiceNames.WahooAPI });
        await extendWahooRateLimitCooldown(3600);
    });
    const queueRef = () => db.doc(`activitySyncQueue/${queueId}`);
    const cooldownRef = () => db.doc('trainingProviderCapacity/wahoo_86400000_app');
    async function seed(accepted = false, extra: Record<string, unknown> = {}) {
        await queueRef().set({
            userID: uid, eventID: 'event', sourceActivityID: 'activity',
            routeId: 'GarminAPI_to_WahooAPI', sourceServiceName: ServiceNames.GarminAPI,
            destinationServiceName: ServiceNames.WahooAPI, processed: false, dateCreated: Date.now(),
            dispatchedToCloudTask: null, retryCount: PROVIDER_MAX_RETRY_COUNT - 1, totalRetryCount: 29,
            errors: [{ error: 'previous real failure', date: 1 }],
            originalFile: { path: `users/${uid}/events/event/original.fit`, extension: 'fit' },
            ...(accepted ? { destinationUploadID: 'accepted-upload', destinationExpectedWorkoutTypeID: 9, outboundFingerprintID: 'retained-fingerprint' } : {}),
            ...extra,
        });
        return readItem();
    }
    async function readItem() {
        const snapshot = await queueRef().get();
        return { ...snapshot.data(), id: snapshot.id, ref: snapshot.ref } as ActivitySyncQueueItemInterface;
    }
    async function invoke() {
        await (processActivitySyncTask as unknown as (request: { data: { queueItemId: string } }) => Promise<void>)({ data: { queueItemId: queueId } });
    }
    function expectNoExpensiveWork() {
        for (const mock of [state.download, state.fingerprint, state.upload, state.status, state.processing]) expect(mock).not.toHaveBeenCalled();
    }
    it.each([false, true])('waits without spending the last business retry or losing receipt state (accepted: %s)', async accepted => {
        await seed(accepted);
        const before = (await queueRef().get()).data()!;
        const capacityBefore = await cooldownRef().get();
        await invoke();
        const saved = (await queueRef().get()).data()!;
        expect(saved.dispatchedToCloudTask).toBeGreaterThan(Date.now());
        expect({ ...saved, dispatchedToCloudTask: before.dispatchedToCloudTask }).toEqual(before);
        expect(state.enqueue).toHaveBeenCalledExactlyOnceWith(queueId, saved.dispatchedToCloudTask, expect.any(Number));
        expect((await db.collection('failed_jobs').get()).empty).toBe(true);
        expect((await cooldownRef().get()).updateTime!.isEqual(capacityBefore.updateTime!)).toBe(true);
        expectNoExpensiveWork();
    });
    it('converges ten concurrent deliveries on one saved deadline and deterministic task identity', async () => {
        const item = await seed(true);
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => processActivitySyncQueueItem({ ...item })));
        expect(results.filter(result => result.status === 'fulfilled' && result.value === QueueResult.ProviderQuotaDeferred)).toHaveLength(10);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(0);
        const saved = (await queueRef().get()).data()!;
        await Promise.all(Array.from({ length: 10 }, invoke));
        expect(state.enqueue).toHaveBeenCalledTimes(10);
        expect(state.enqueue.mock.calls.every(([id, at]) => id === queueId && at === saved.dispatchedToCloudTask)).toBe(true);
        expect((await queueRef().get()).data()).toMatchObject({ retryCount: PROVIDER_MAX_RETRY_COUNT - 1, totalRetryCount: 29, destinationUploadID: 'accepted-upload' });
        expectNoExpensiveWork();
    }, 30_000);
    it('recovers an enqueue that may have succeeded using the original deadline and a duplicate confirmation', async () => {
        await seed();
        state.enqueue.mockRejectedValueOnce(new Error('synthetic lost response')).mockResolvedValueOnce(false);
        await expect(invoke()).rejects.toThrow('synthetic lost response');
        const saved = (await queueRef().get()).data()!;
        await invoke();
        expect(state.enqueue).toHaveBeenCalledTimes(2);
        expect(state.enqueue.mock.calls.every(([, at]) => at === saved.dispatchedToCloudTask)).toBe(true);
        expect((await queueRef().get()).data()).toEqual(saved);
        expectNoExpensiveWork();
    });
    it('observes an extended cooldown when the previous delayed task becomes due', async () => {
        await seed(true);
        await invoke();
        await queueRef().update({ dispatchedToCloudTask: Date.now() - 1 });
        await extendWahooRateLimitCooldown(7200);
        const extendedUntil = (await cooldownRef().get()).data()!.notBeforeMs;
        await invoke();
        expect((await queueRef().get()).data()!.dispatchedToCloudTask).toBeGreaterThan(extendedUntil);
        expectNoExpensiveWork();
    });
    it('resumes the accepted operation after expiry without downloading or reposting its FIT', async () => {
        await seed(true);
        await invoke();
        await cooldownRef().update({ notBeforeMs: Date.now() - 1 });
        await queueRef().update({ dispatchedToCloudTask: Date.now() - 1 });
        await invoke();
        expect(state.status).toHaveBeenCalledOnce();
        expect(state.status.mock.calls[0][1]).toBe('accepted-upload');
        expect(state.download).not.toHaveBeenCalled();
        expect(state.upload).not.toHaveBeenCalled();
        expect((await queueRef().get()).data()).toMatchObject({ processed: true, resultStatus: 'success', destinationUploadID: 'accepted-upload', destinationExpectedWorkoutTypeID: 9 });
    });
    it.each(['replacement', 'receipt', 'claim', 'deleted', 'tombstone', 'missing_user', 'stop', 'expiry'])('cannot defer over a concurrent %s transition', async transition => {
        const workspace = transition === 'stop' || transition === 'expiry';
        const item = await seed(false, workspace ? { sendBatchID: 'batch' } : {});
        if (workspace) await db.doc(`users/${uid}/activitySendOperations/batch`).set({ state: 'confirmed', expiresAt: Date.now() + 60_000 });
        let before: admin.firestore.DocumentData | undefined;
        // The lifecycle prechecks have already passed. Mutate authority between
        // the cooldown read and its real guarded Firestore transaction.
        state.afterCooldownRead = async () => {
            if (transition === 'replacement') await queueRef().update({ dateCreated: item.dateCreated + 1 });
            if (transition === 'receipt') await queueRef().update({ destinationUploadID: 'newly-accepted-upload', destinationExpectedWorkoutTypeID: 9 });
            if (transition === 'claim') await queueRef().update({ dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER, providerOperationStartedAt: Date.now() });
            if (transition === 'deleted') await db.recursiveDelete(queueRef());
            if (transition === 'tombstone') await db.doc(`userDeletionTombstones/${uid}`).set({ expireAt: Timestamp.fromMillis(Date.now() + 60_000) });
            if (transition === 'missing_user') await db.recursiveDelete(db.doc(`users/${uid}`));
            if (transition === 'stop') await db.doc(`users/${uid}/activitySendOperations/batch`).update({ stopped: true });
            if (transition === 'expiry') await db.doc(`users/${uid}/activitySendOperations/batch`).update({ expiresAt: Date.now() - 1 });
            before = (await queueRef().get()).data();
        };
        await processActivitySyncQueueItem(item).catch(() => undefined);
        const after = (await queueRef().get()).data();
        if (transition === 'tombstone' || transition === 'missing_user') expect(after?.processed === true || after === undefined).toBe(true);
        else expect(after).toEqual(before);
        if (workspace) {
            state.afterCooldownRead = undefined;
            await invoke();
            expect((await queueRef().get()).data()).toMatchObject({ processed: true, skippedReason: transition === 'stop' ? 'send_stopped' : 'send_source_expired' });
        }
        expect(state.enqueue).not.toHaveBeenCalled();
        expectNoExpensiveWork();
    });
});
