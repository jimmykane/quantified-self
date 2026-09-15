import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';

const mocks = vi.hoisted(() => ({ firestore: vi.fn(), enqueue: vi.fn(async () => undefined) }));
vi.mock('firebase-admin', () => ({ firestore: mocks.firestore }));
vi.mock('../shared/cloud-tasks', () => ({ enqueueDerivedMetricsTask: mocks.enqueue }));
vi.mock('./derived-metrics-uid-gate', () => ({ isDerivedMetricsUidAllowed: () => true, getDerivedMetricsUidAllowlist: () => new Set() }));
vi.mock('firebase-functions/v2/tasks', () => ({ onTaskDispatched: (_options: unknown, handler: unknown) => handler }));

import {
    abandonDerivedMetricsProcessingAfterWriteBlock,
    completeDerivedMetricsProcessing, failDerivedMetricsProcessing, fetchTrainingBuildWorkoutSeed,
    markDerivedMetricsDirtyAndMaybeQueue, markDerivedMetricSnapshotsBuilding, markDerivedMetricSnapshotsFailed,
    startDerivedMetricsProcessing, writeDerivedMetricSnapshotsReady,
} from './derived-metrics.service';
import { trainingBuildSettingsKey } from './training-build-workout-seed';
import { processDerivedMetricsTask } from '../tasks/derived-metrics-worker';

// A separate demo namespace, synthetic fixtures only, and no Cloud Tasks or provider calls.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('derived workout reuse / real Firestore', { timeout: 30_000 }, () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback Firestore emulator required.');
    const db = new Firestore({ projectId: 'demo-derived-metrics-reuse' });
    const owners: string[] = [];
    const kinds = [DERIVED_METRIC_KINDS.TrainingBuildComparison];
    let uid: string;
    const user = () => db.doc(`users/${uid}`);
    const coordinator = () => user().collection('derivedMetrics').doc('coordinator');
    const metric = () => user().collection('derivedMetrics').doc(kinds[0]);
    const tombstone = () => db.doc(`userDeletionTombstones/${uid}`);
    beforeEach(async () => {
        mocks.firestore.mockReturnValue(db);
        uid = `reuse-fixture-${randomUUID()}`; owners.push(uid);
        await user().set({ fixture: true });
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
        for (const owner of owners) {
            await db.recursiveDelete(db.doc(`users/${owner}`));
            await db.doc(`userDeletionTombstones/${owner}`).delete();
        }
        await db.terminate();
    });
    async function warm() {
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { incrementEventMutationVersion: true });
        const start = (await startDerivedMetricsProcessing(uid, queued.generation!))!;
        const claim = { generation: queued.generation!, startedAtMs: start.startedAtMs };
        const buildAtMs = Date.now();
        await markDerivedMetricSnapshotsBuilding(uid, kinds, claim);
        await writeDerivedMetricSnapshotsReady(uid, kinds, { trainingActivities: [] }, {
            claim, buildAtMs, workoutInputsVersion: start.workoutInputsVersion,
            builtFromEventMutationVersion: start.eventMutationVersion,
        });
        const context = { nowMs: buildAtMs, sourceVersion: start.workoutInputsVersion,
            eventMutationVersion: start.eventMutationVersion, settingsKey: trainingBuildSettingsKey({}) };
        return { start, claim, context };
    }

    it('round-trips a seed through real Firestore and coalesces sleep ingress without invalidating workouts', async () => {
        const { claim, context } = await warm();
        expect(await fetchTrainingBuildWorkoutSeed(uid, context)).not.toBeNull();
        expect(await fetchTrainingBuildWorkoutSeed(`${uid}-other`, context)).toBeNull();
        await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { preserveWorkoutInputs: true });
        const before = (await coordinator().get()).updateTime;
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { preserveWorkoutInputs: true });
        expect((await coordinator().get()).updateTime!.isEqual(before!)).toBe(true);
        const start = (await startDerivedMetricsProcessing(uid, queued.generation!))!;
        expect(start.workoutInputsVersion).toBe(context.sourceVersion);
        expect(start.eventMutationVersion).toBe(context.eventMutationVersion);
        expect(await fetchTrainingBuildWorkoutSeed(uid, context)).not.toBeNull();
    });

    it('recovers a transient seed-read failure through a real worker retry of the same generation', async () => {
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds);
        const run = processDerivedMetricsTask as unknown as (request: { data: { uid: string; generation: number } }) => Promise<void>;
        const request = { data: { uid, generation: queued.generation! } };
        const originalDoc = db.doc.bind(db);
        let failSeedRead = true;
        vi.spyOn(db, 'doc').mockImplementation(path => {
            const ref = originalDoc(path);
            if (failSeedRead && path === `users/${uid}/derivedMetrics/${kinds[0]}`) {
                failSeedRead = false;
                vi.spyOn(ref, 'get').mockRejectedValueOnce(new Error('transient_seed_read'));
            }
            return ref;
        });
        await expect(run(request)).rejects.toThrow('transient_seed_read');
        const failed = (await coordinator().get()).data()!;
        expect(failed.status).toBe('failed');
        expect(failed.dirtyMetricKinds).toEqual(kinds);
        await run(request);
        expect((await coordinator().get()).data()).toMatchObject({ status: 'idle',
            generation: queued.generation, dirtyMetricKinds: [], processingMetricKinds: [] });
        expect((await metric().get()).data()?.status).toBe('ready');
        await run(request); // A duplicate after completion remains a no-op.
        expect((await coordinator().get()).data()?.status).toBe('idle');
    });

    it('carries claimed workout kinds into a replacement generation triggered only by Readiness', async () => {
        const originalKinds = [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.TrainingDurability];
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, originalKinds);
        const original = (await startDerivedMetricsProcessing(uid, queued.generation!))!;
        await coordinator().update({ startedAtMs: Date.now() - 20 * 60_000 });
        const replacement = await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.TrainingReadiness],
            { preserveWorkoutInputs: true });
        expect(replacement.generation).toBe(queued.generation! + 1);
        expect(await markDerivedMetricSnapshotsBuilding(uid, originalKinds,
            { generation: queued.generation!, startedAtMs: original.startedAtMs })).toBe(false);
        const next = (await startDerivedMetricsProcessing(uid, replacement.generation!))!;
        expect(new Set(next.dirtyMetricKinds)).toEqual(new Set([...originalKinds, DERIVED_METRIC_KINDS.TrainingReadiness]));
        const claim = { generation: replacement.generation!, startedAtMs: next.startedAtMs };
        expect(await writeDerivedMetricSnapshotsReady(uid, next.dirtyMetricKinds, {}, { claim })).toBe(true);
        await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        for (const kind of next.dirtyMetricKinds) {
            expect((await user().collection('derivedMetrics').doc(kind).get()).data()?.status).toBe('ready');
        }
    });

    it('does not downgrade an already claimed replacement after a late enqueue failure during write-block recovery', async () => {
        const { claim } = await warm();
        mocks.enqueue.mockImplementationOnce(async (...args: unknown[]) => {
            expect(await startDerivedMetricsProcessing(uid, Number(args[1]))).not.toBeNull();
            throw new Error('enqueue_response_lost_after_dispatch');
        });
        const result = await abandonDerivedMetricsProcessingAfterWriteBlock(uid, claim.generation, kinds,
            'fixture write block cleared', claim);
        expect(result.requeued).toBe(true);
        expect((await coordinator().get()).data()).toMatchObject({ status: 'processing',
            generation: result.nextGeneration, processingMetricKinds: kinds, lastError: null });
    });

    it.each(['workout mutation', 'explicit repair'] as const)('invalidates on %s during processing and retains follow-up work', async reason => {
        const { claim, context } = await warm();
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, reason === 'workout mutation'
            ? { incrementEventMutationVersion: true, preserveWorkoutInputs: true } : undefined);
        const completion = await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        expect(completion.requeued).toBe(true);
        const next = (await startDerivedMetricsProcessing(uid, completion.nextGeneration!))!;
        expect(next.dirtyMetricKinds).toEqual(kinds);
        expect(next.workoutInputsVersion).toBe(context.sourceVersion + 1);
        expect(await fetchTrainingBuildWorkoutSeed(uid, { ...context, sourceVersion: next.workoutInputsVersion,
            eventMutationVersion: next.eventMutationVersion })).toBeNull();
    });

    it('allows one concurrent claim and fences ready/failure/completion writes from a reclaimed attempt', async () => {
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds);
        const starts = await Promise.all([startDerivedMetricsProcessing(uid, queued.generation!),
            startDerivedMetricsProcessing(uid, queued.generation!)]);
        expect(starts.filter(Boolean)).toHaveLength(1);
        const oldStartedAtMs = Date.now() - 20 * 60_000;
        await coordinator().update({ startedAtMs: oldStartedAtMs, updatedAtMs: oldStartedAtMs });
        const fresh = (await startDerivedMetricsProcessing(uid, queued.generation!))!;
        const freshClaim = { generation: queued.generation!, startedAtMs: fresh.startedAtMs };
        await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: freshClaim,
            builtFromEventMutationVersion: fresh.eventMutationVersion, workoutInputsVersion: fresh.workoutInputsVersion });
        const snapshotBefore = (await metric().get()).data();
        const coordinatorBefore = (await coordinator().get()).data();
        for (const stale of [{ ...freshClaim, startedAtMs: oldStartedAtMs }, { ...freshClaim, generation: freshClaim.generation - 1 }]) {
            await markDerivedMetricSnapshotsBuilding(uid, kinds, stale);
            await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: stale, buildAtMs: 1 });
            await markDerivedMetricSnapshotsFailed(uid, kinds, new Error('old attempt'), stale);
            await failDerivedMetricsProcessing(uid, stale.generation, new Error('old attempt'), kinds, stale);
            await completeDerivedMetricsProcessing(uid, stale.generation, stale);
        }
        expect((await metric().get()).data()).toEqual(snapshotBefore);
        expect((await coordinator().get()).data()).toEqual(coordinatorBefore);
    });

    it.each(['ready', 'building', 'failed'] as const)('blocks a %s write when deletion starts after the preliminary check', async stage => {
        const { claim } = await warm();
        const before = (await metric().get()).data();
        const original = db.runTransaction.bind(db);
        vi.spyOn(db, 'runTransaction').mockImplementationOnce((async (callback: any) => {
            await tombstone().set({ fixture: true });
            return original(callback);
        }) as typeof db.runTransaction);
        if (stage === 'ready') await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim, buildAtMs: 1 });
        if (stage === 'building') await markDerivedMetricSnapshotsBuilding(uid, kinds, claim);
        if (stage === 'failed') await markDerivedMetricSnapshotsFailed(uid, kinds, new Error('fixture'), claim);
        expect((await metric().get()).data()).toEqual(before);
    });
});
