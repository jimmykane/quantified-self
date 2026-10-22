import { randomUUID } from 'node:crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
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
    completeDerivedMetricsProcessing, failDerivedMetricsProcessing, fetchTrainingBuildWorkoutSeed, flushPendingDerivedMetricsAfterHistory,
    markDerivedMetricsDirtyAndMaybeQueue, markDerivedMetricSnapshotsBuilding, markDerivedMetricSnapshotsFailed,
    startDerivedMetricsProcessing, writeDerivedMetricSnapshotsReady,
} from './derived-metrics.service';
import { trainingBuildSettingsKey } from './training-build-workout-seed';
import { processDerivedMetricsTask } from '../tasks/derived-metrics-worker';
import { processDerivedMetricsIngressTask } from '../tasks/derived-metrics-ingress-worker';
import { ensureDerivedMetricsForUser, prepareDerivedMetricsForUser } from './ensure-derived-metrics';

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
        mocks.enqueue.mockReset().mockResolvedValue(undefined);
        mocks.firestore.mockReturnValue(db);
        uid = `reuse-fixture-${randomUUID()}`; owners.push(uid);
        await user().set({ fixture: true });
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
    afterAll(async () => {
        for (const owner of owners) {
            await db.recursiveDelete(db.doc(`users/${owner}`));
            await db.doc(`userDeletionTombstones/${owner}`).delete();
        }
        await db.doc('connectionHistoryImports/11111111-1111-4111-8111-111111111111').delete(); // Synthetic leaf fixture.
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

    it.each([false, true])('replays fourteen 30-second ingress arrivals without losing the tail (background=%s)', async background => {
        const base = Math.floor(Date.now() / 1000) * 1000;
        let now = base;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const tasks: { generation: number; due: number }[] = [];
        mocks.enqueue.mockImplementation(async (...args: unknown[]) => {
            tasks.push({ generation: Number(args[1]), due: now + Number(args[2] ?? 0) * 1000 });
        });
        const starts: number[] = [];
        let arrivals = 0;
        while (arrivals < 14 || tasks.length) {
            const arrival = arrivals < 14 ? base + arrivals * 30_000 : Infinity;
            now = Math.min(arrival, ...tasks.map(task => task.due));
            if (now === arrival) {
                await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background, incrementEventMutationVersion: true });
                arrivals++;
            }
            const index = tasks.findIndex(task => task.due <= now);
            if (index < 0) continue;
            const [task] = tasks.splice(index, 1);
            const start = await startDerivedMetricsProcessing(uid, task.generation);
            if (!start) continue;
            starts.push(now - base);
            const claim = { generation: task.generation, startedAtMs: start.startedAtMs };
            await markDerivedMetricSnapshotsBuilding(uid, start.dirtyMetricKinds, claim);
            now += 21_000; // Representative build time, with no real waiting or private fixtures.
            expect(await writeDerivedMetricSnapshotsReady(uid, start.dirtyMetricKinds, { trainingActivities: [] }, {
                claim, buildAtMs: now, builtFromEventMutationVersion: start.eventMutationVersion,
                workoutInputsVersion: start.workoutInputsVersion,
            })).toBe(true);
            await completeDerivedMetricsProcessing(uid, task.generation, claim);
        }
        expect(starts).toEqual(background ? [0, 120_000, 240_000, 360_000, 480_000]
            : Array.from({ length: 14 }, (_, i) => i * 30_000));
        expect((await coordinator().get()).data()).toMatchObject({ status: 'idle', dirtyMetricKinds: [],
            eventMutationVersion: 14, workoutInputsVersion: 14 });
        expect((await metric().get()).data()).toMatchObject({ status: 'ready', builtFromEventMutationVersion: 14 });
    });

    const historyId = '11111111-1111-4111-8111-111111111111';
    async function activeImport() {
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', uid);
        await user().collection('meta').doc(ServiceNames.SuuntoApp).set({ connectionHistoryImport: {
            active: true, runId: historyId, updatedAtMs: Date.now(),
        } });
    }
    async function terminalImport(revision = 1) {
        await db.doc(`connectionHistoryImports/${historyId}`).set({ userID: uid, serviceName: ServiceNames.SuuntoApp, processed: true, revision });
        await user().collection('meta').doc(ServiceNames.SuuntoApp).set({ connectionHistoryImport: {
            active: false, runId: historyId, updatedAtMs: Date.now(),
        } });
    }

    it('reduces fourteen-arrival imports while producing identical Form after a correction and deletion', async () => {
        const finalPayloads: unknown[] = [];
        const base = Date.parse('2026-10-22T12:00:00Z');
        for (const pilot of [false, true]) {
            mocks.firestore.mockReturnValue(db);
            uid = `reuse-fixture-${randomUUID()}`; owners.push(uid); await user().set({ fixture: true });
            let now = base;
            vi.spyOn(Date, 'now').mockImplementation(() => now);
            await activeImport();
            if (!pilot) vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', '');
            const tasks: { generation: number; due: number }[] = [];
            mocks.enqueue.mockImplementation(async (...args: unknown[]) => {
                tasks.push({ generation: Number(args[1]), due: now + Number(args[2] ?? 0) * 1000 });
            });
            const starts: number[] = [];
            let arrivals = 0;
            const dirty = () => markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form],
                { background: true, incrementEventMutationVersion: true });
            const worker = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
            while (arrivals < 14 || tasks.length) {
                const arrival = arrivals < 14 ? base + arrivals * 30_000 : Infinity;
                now = Math.min(arrival, ...tasks.map(task => task.due));
                if (now === arrival) {
                    await user().collection('events').doc(`event-${arrivals}`).set({
                        startDate: new Date(base - 2 * 86_400_000), stats: { 'Training Stress Score': arrivals },
                    });
                    await dirty();
                    if (arrivals === 5) {
                        await user().collection('events').doc('event-0').update({ 'stats.Training Stress Score': 77 });
                        await dirty();
                    }
                    if (arrivals === 9) {
                        // Synthetic leaf fixture with no descendants.
                        await user().collection('events').doc('event-1').delete(); await dirty();
                    }
                    arrivals++;
                }
                const index = tasks.findIndex(task => task.due <= now);
                if (index < 0) continue;
                const [task] = tasks.splice(index, 1);
                starts.push(now - base);
                await worker({ data: { uid, generation: task.generation } });
                now += 21_000;
            }
            expect(starts).toEqual(pilot ? [0, 300_000, 600_000] : [0, 120_000, 240_000, 360_000, 480_000]);
            const form = (await user().collection('derivedMetrics').doc(DERIVED_METRIC_KINDS.Form).get()).data()!;
            expect(form).toMatchObject({ status: 'ready', builtFromEventMutationVersion: 16, sourceEventCount: 13 });
            expect(form.payload.dailyLoads).toEqual([expect.objectContaining({ load: 167 })]);
            finalPayloads.push(form.payload);
            expect((await coordinator().get()).data()).toMatchObject({ status: 'idle', dirtyMetricKinds: [],
                eventMutationVersion: 16, workoutInputsVersion: 16 });
            vi.restoreAllMocks();
        }
        expect(finalPayloads[1]).toEqual(finalPayloads[0]);
    });

    it.each(['complete', 'abandon'] as const)('keeps import pending work durable after %s and retries a failed five-minute handoff', async path => {
        const { claim } = await warm(); await activeImport();
        vi.spyOn(Date, 'now').mockReturnValue(claim.startedAtMs + 30_000);
        await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form],
            { background: true, incrementEventMutationVersion: true });
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic import enqueue outage'));
        const handoff = path === 'complete' ? completeDerivedMetricsProcessing(uid, claim.generation, claim)
            : abandonDerivedMetricsProcessingAfterWriteBlock(uid, claim.generation, kinds, 'fixture write block', claim);
        await expect(handoff).rejects.toThrow('synthetic import enqueue outage');
        const pending = (await coordinator().get()).data()!;
        expect(pending).toMatchObject({ status: 'failed', buildNotBeforeMs: claim.startedAtMs + 300_000,
            eventMutationVersion: 2, workoutInputsVersion: 2 });
        expect(await startDerivedMetricsProcessing(uid, claim.generation)).toBeNull();
        expect(mocks.enqueue).toHaveBeenLastCalledWith(uid, pending.generation, 270);
    });

    it('promotes only pending work on history completion without advancing inputs or losing newer kinds', async () => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport();
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true, incrementEventMutationVersion: true });
        const waiting = (await coordinator().get()).data()!;
        await terminalImport();
        await Promise.all([flushPendingDerivedMetricsAfterHistory(uid, historyId, 1),
            markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form], { background: true, incrementEventMutationVersion: true })]);
        const next = (await coordinator().get()).data()!;
        expect(next).toMatchObject({ status: 'queued', generation: waiting.generation + 1,
            eventMutationVersion: 3, workoutInputsVersion: 3 });
        expect(next.buildNotBeforeMs).toBeLessThanOrEqual(Date.now());
        expect(new Set(next.dirtyMetricKinds)).toEqual(new Set([...kinds, DERIVED_METRIC_KINDS.Form]));
        expect(await startDerivedMetricsProcessing(uid, waiting.generation)).toBeNull();
        const worker = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
        await worker({ data: { uid, generation: next.generation } });
        const before = (await coordinator().get()).data(); const calls = mocks.enqueue.mock.calls.length;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
        expect((await coordinator().get()).data()).toEqual(before);
        // A source arriving after completion retains normal invalidation and the ordinary two-minute bound.
        await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form], { background: true, incrementEventMutationVersion: true });
        expect((await coordinator().get()).data()?.buildNotBeforeMs).toBeLessThanOrEqual(Date.now() + 120_000);
    }, 30_000);

    it('retains manual edit priority through import completion while a build is processing', async () => {
        const { claim } = await warm(); await activeImport();
        await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form]);
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport(); await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        const result = await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        expect(mocks.enqueue).toHaveBeenLastCalledWith(uid, result.nextGeneration);
        expect((await coordinator().get()).data()?.pendingImmediate).toBe(false);
    });

    it.each(['restarted', 'stale revision', 'foreign owner', 'deleted'] as const)('fences terminal history flush after %s', async change => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport(); await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport();
        if (change === 'restarted') await db.doc(`connectionHistoryImports/${historyId}`).update({ processed: false });
        if (change === 'stale revision') await db.doc(`connectionHistoryImports/${historyId}`).update({ revision: 2 });
        if (change === 'foreign owner') await db.doc(`connectionHistoryImports/${historyId}`).update({ userID: 'another-owner' });
        if (change === 'deleted') await tombstone().set({ fixture: true });
        const before = (await coordinator().get()).data(); const calls = mocks.enqueue.mock.calls.length;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
        expect((await coordinator().get()).data()).toEqual(before);
    });

    it('retries failed completion flush enqueue from the same terminal event', async () => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport(); await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport(); mocks.enqueue.mockRejectedValueOnce(new Error('synthetic outage'));
        await expect(flushPendingDerivedMetricsAfterHistory(uid, historyId, 1)).rejects.toThrow('derived_metrics_history_flush_enqueue_failed');
        const before = (await coordinator().get()).data()!;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect((await coordinator().get()).data()).toEqual(before);
        expect(mocks.enqueue).toHaveBeenLastCalledWith(uid, before.generation);
        expect((await db.doc(`connectionHistoryImports/${historyId}`).get()).data()?.derivedMetricsFlush)
            .toEqual({ revision: 1, generation: before.generation });
        const worker = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
        await worker({ data: { uid, generation: before.generation } });
        expect((await coordinator().get()).data()?.status).toBe('idle');
    });

    it.each(['clean completion', 'completed rebuild'] as const)('does not let a duplicate terminal event expedite later work after %s', async path => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport();
        if (path === 'completed rebuild') await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport(); await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        if (path === 'completed rebuild') {
            const pending = (await coordinator().get()).data()!;
            const worker = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
            await worker({ data: { uid, generation: pending.generation } });
        }
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true, incrementEventMutationVersion: true });
        const before = (await coordinator().get()).data(); const calls = mocks.enqueue.mock.calls.length;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect((await coordinator().get()).data()).toEqual(before);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
    });

    it('ignores the first late completion event when provider metadata already belongs to a newer import', async () => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport(); await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport();
        await user().collection('meta').doc(ServiceNames.SuuntoApp).set({ connectionHistoryImport: {
            active: true, runId: '22222222-2222-4222-8222-222222222222', updatedAtMs: Date.now(),
        } });
        const before = (await coordinator().get()).data(); const calls = mocks.enqueue.mock.calls.length;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect((await coordinator().get()).data()).toEqual(before);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
    });

    it('consumes a clean terminal event without creating a coordinator or affecting later work', async () => {
        await activeImport(); await terminalImport();
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect((await coordinator().get()).exists).toBe(false);
        expect((await db.doc(`connectionHistoryImports/${historyId}`).get()).data()?.derivedMetricsFlush)
            .toEqual({ revision: 1, generation: null });
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        const before = (await coordinator().get()).data(); const calls = mocks.enqueue.mock.calls.length;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
        expect((await coordinator().get()).data()).toEqual(before);
        expect(before?.generation).toBe(queued.generation);
    });

    it('confirms an already prompt queued generation without replacing it on first terminal delivery', async () => {
        await activeImport();
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport(); mocks.enqueue.mockClear();
        const before = (await coordinator().get()).data();
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect((await coordinator().get()).data()).toEqual(before);
        expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(uid, queued.generation);
    });

    it('coalesces simultaneous duplicate terminal events into one generation', async () => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport(); await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        const before = (await coordinator().get()).data()!;
        await terminalImport(); mocks.enqueue.mockClear();
        await Promise.all([flushPendingDerivedMetricsAfterHistory(uid, historyId, 1),
            flushPendingDerivedMetricsAfterHistory(uid, historyId, 1)]);
        const after = (await coordinator().get()).data()!;
        expect(after).toMatchObject({ generation: before.generation + 1, eventMutationVersion: before.eventMutationVersion,
            workoutInputsVersion: before.workoutInputsVersion });
        expect(mocks.enqueue.mock.calls.length).toBeGreaterThan(0);
        expect(mocks.enqueue.mock.calls.every(call => call[1] === after.generation)).toBe(true);
    }, 30_000);

    it('does not repair a completion enqueue after its task has already claimed the generation', async () => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport(); await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport();
        mocks.enqueue.mockImplementationOnce(async (...args: unknown[]) => {
            expect(await startDerivedMetricsProcessing(uid, Number(args[1]))).not.toBeNull();
            throw new Error('synthetic lost enqueue response');
        });
        await expect(flushPendingDerivedMetricsAfterHistory(uid, historyId, 1)).rejects.toThrow('derived_metrics_history_flush_enqueue_failed');
        const before = (await coordinator().get()).data(); const calls = mocks.enqueue.mock.calls.length;
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1);
        expect((await coordinator().get()).data()).toEqual(before);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
    });

    it('repairs an existing receipt after pilot opt-out without admitting another terminal event', async () => {
        const { claim } = await warm(); await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        await activeImport(); await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        await terminalImport();
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic outage'));
        await expect(flushPendingDerivedMetricsAfterHistory(uid, historyId, 1)).rejects.toThrow('derived_metrics_history_flush_enqueue_failed');
        const before = (await coordinator().get()).data()!;
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', ''); mocks.enqueue.mockClear();
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 1, { repairOnly: true });
        expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(uid, before.generation);
        expect((await coordinator().get()).data()).toEqual(before);
        // A repair event cannot consume a newer run revision without its own receipt.
        await terminalImport(2); mocks.enqueue.mockClear();
        await flushPendingDerivedMetricsAfterHistory(uid, historyId, 2, { repairOnly: true });
        expect(mocks.enqueue).not.toHaveBeenCalled();
        expect((await coordinator().get()).data()).toEqual(before);
        expect((await db.doc(`connectionHistoryImports/${historyId}`).get()).data()).not.toHaveProperty('derivedMetricsFlush');
    });

    it('coalesces simultaneous ingress and automatic/MCP freshness requests without moving the deadline', async () => {
        const { claim } = await warm();
        await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        const extraKinds = [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.TrainingReadiness, DERIVED_METRIC_KINDS.Acwr];
        const results = await Promise.all(extraKinds.map(kind => markDerivedMetricsDirtyAndMaybeQueue(uid, [kind],
            { background: true, incrementEventMutationVersion: true })));
        expect(new Set(results.map(result => result.generation)).size).toBe(1);
        expect(results.filter(result => result.queued)).toHaveLength(1);
        const before = (await coordinator().get()).data()!;
        const queuedCalls = mocks.enqueue.mock.calls.length;
        await ensureDerivedMetricsForUser(uid, [DERIVED_METRIC_KINDS.TrainingDurability]);
        const preparation = await prepareDerivedMetricsForUser(uid, [DERIVED_METRIC_KINDS.Form], 0);
        expect(preparation).toEqual({ status: 'preparing', metricKinds: [DERIVED_METRIC_KINDS.Form],
            readyMetricKinds: [], retryAfterSeconds: 5 });
        const after = (await coordinator().get()).data()!;
        expect(after).toMatchObject({ generation: before.generation, buildNotBeforeMs: before.buildNotBeforeMs,
            requestedAtMs: before.requestedAtMs, eventMutationVersion: 4 });
        expect(new Set(after.dirtyMetricKinds)).toEqual(new Set([...extraKinds, DERIVED_METRIC_KINDS.TrainingDurability]));
        expect(mocks.enqueue).toHaveBeenCalledTimes(queuedCalls);
    });

    it('promotes waiting work and fences a late failed enqueue and delivery of its old generation', async () => {
        const { claim } = await warm();
        await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        let rejectOld!: (error: Error) => void;
        let entered!: () => void;
        const enqueuing = new Promise<void>(resolve => { entered = resolve; });
        mocks.enqueue.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; entered(); }));
        const waiting = markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true, incrementEventMutationVersion: true });
        await enqueuing;
        const old = (await coordinator().get()).data()!;
        const priority = await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form]);
        rejectOld(new Error('synthetic late enqueue failure'));
        await waiting;
        expect(priority.generation).toBe(old.generation + 1);
        expect((await coordinator().get()).data()).toMatchObject({ status: 'queued', generation: priority.generation, lastError: null });
        expect(await startDerivedMetricsProcessing(uid, old.generation)).toBeNull();
        const start = (await startDerivedMetricsProcessing(uid, priority.generation!))!;
        expect(new Set(start.dirtyMetricKinds)).toEqual(new Set([...kinds, DERIVED_METRIC_KINDS.Form]));
        expect(start.eventMutationVersion).toBe(2);
    });

    it.each(['complete', 'abandon'] as const)('schedules pending work after %s even without another ingress', async path => {
        const { claim } = await warm();
        const now = claim.startedAtMs + 30_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form],
            { background: true, incrementEventMutationVersion: true });
        const result = path === 'complete'
            ? await completeDerivedMetricsProcessing(uid, claim.generation, claim)
            : await abandonDerivedMetricsProcessingAfterWriteBlock(uid, claim.generation, kinds, 'synthetic rejected write', claim);
        expect(result.requeued).toBe(true);
        expect(mocks.enqueue).toHaveBeenLastCalledWith(uid, result.nextGeneration, 90);
        const pending = (await coordinator().get()).data()!;
        expect(pending).toMatchObject({ buildNotBeforeMs: claim.startedAtMs + 120_000, pendingImmediate: false,
            eventMutationVersion: 2 });
        expect(pending.dirtyMetricKinds).toContain(DERIVED_METRIC_KINDS.Form);
        if (path === 'abandon') expect(pending.dirtyMetricKinds).toContain(kinds[0]);
        vi.mocked(Date.now).mockReturnValue(pending.buildNotBeforeMs);
        const start = (await startDerivedMetricsProcessing(uid, result.nextGeneration!))!;
        const finalClaim = { generation: result.nextGeneration!, startedAtMs: start.startedAtMs };
        await writeDerivedMetricSnapshotsReady(uid, start.dirtyMetricKinds, {}, {
            claim: finalClaim, builtFromEventMutationVersion: start.eventMutationVersion,
        });
        await completeDerivedMetricsProcessing(uid, finalClaim.generation, finalClaim);
        expect((await coordinator().get()).data()?.status).toBe('idle');
    });

    it.each(['complete', 'abandon'] as const)('keeps edits during processing urgent through later background writes and %s', async path => {
        const { claim } = await warm();
        await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.Form]);
        await markDerivedMetricsDirtyAndMaybeQueue(uid, [DERIVED_METRIC_KINDS.TrainingReadiness], { background: true });
        expect((await coordinator().get()).data()?.pendingImmediate).toBe(true);
        const result = path === 'complete'
            ? await completeDerivedMetricsProcessing(uid, claim.generation, claim)
            : await abandonDerivedMetricsProcessingAfterWriteBlock(uid, claim.generation, kinds, 'synthetic rejected write', claim);
        expect(mocks.enqueue).toHaveBeenLastCalledWith(uid, result.nextGeneration);
        const start = (await startDerivedMetricsProcessing(uid, result.nextGeneration!))!;
        expect(start.dirtyMetricKinds).toEqual(expect.arrayContaining([DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.TrainingReadiness]));
        expect((await coordinator().get()).data()?.pendingImmediate).toBe(false);
    });

    it('does not claim a delayed build after account deletion begins', async () => {
        const { claim } = await warm();
        await completeDerivedMetricsProcessing(uid, claim.generation, claim);
        const next = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        const before = (await coordinator().get()).updateTime;
        await tombstone().set({ fixture: true });
        expect(await startDerivedMetricsProcessing(uid, next.generation!)).toBeNull();
        expect((await coordinator().get()).updateTime!.isEqual(before!)).toBe(true);
    });

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

    it('retries an ingress enqueue failure without waiting for another source mutation', async () => {
        const ingress = processDerivedMetricsIngressTask as unknown as (request: unknown) => Promise<void>;
        const run = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
        const request = { data: { uid, metricKinds: kinds } };
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic enqueue outage'));
        await expect(ingress(request)).rejects.toThrow('derived_metrics_ingress_enqueue_failed');
        const failed = (await coordinator().get()).data()!;
        expect(failed).toMatchObject({ status: 'failed', dirtyMetricKinds: kinds });
        await ingress(request); // Redelivery of the original ingress task.
        const retry = (await coordinator().get()).data()!;
        expect(retry).toMatchObject({ status: 'queued', generation: failed.generation + 1, dirtyMetricKinds: kinds });
        await run({ data: { uid, generation: retry.generation } });
        expect((await coordinator().get()).data()?.status).toBe('idle');
        expect((await metric().get()).data()).toMatchObject({ status: 'ready',
            builtFromEventMutationVersion: retry.eventMutationVersion });
    });

    it('keeps published snapshots intact when a real worker fails during follow-up dispatch', async () => {
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { incrementEventMutationVersion: true });
        const originalDoc = db.doc.bind(db);
        let injectMutation = true;
        vi.spyOn(db, 'doc').mockImplementation(path => {
            const ref = originalDoc(path);
            if (injectMutation && path === `users/${uid}/derivedMetrics/${kinds[0]}`) {
                injectMutation = false;
                const get = ref.get.bind(ref);
                vi.spyOn(ref, 'get').mockImplementationOnce(async () => {
                    await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds,
                        { background: true, incrementEventMutationVersion: true });
                    return get();
                });
            }
            return ref;
        });
        const run = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
        const request = { data: { uid, generation: queued.generation } };
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic follow-up outage'));
        await expect(run(request)).rejects.toThrow('synthetic follow-up outage');
        const followUp = (await coordinator().get()).data()!;
        expect(followUp).toMatchObject({ status: 'failed', generation: queued.generation! + 1,
            retryFromGeneration: queued.generation, eventMutationVersion: 2, dirtyMetricKinds: kinds });
        const published = await metric().get();
        expect(published.data()).toMatchObject({ status: 'ready', builtFromEventMutationVersion: 1 });
        await run(request);
        expect((await metric().get()).updateTime!.isEqual(published.updateTime!)).toBe(true);
        vi.spyOn(Date, 'now').mockReturnValue(followUp.buildNotBeforeMs);
        await run({ data: { uid, generation: followUp.generation } });
        expect((await coordinator().get()).data()).toMatchObject({ status: 'idle', retryFromGeneration: null });
        expect((await metric().get()).data()).toMatchObject({ status: 'ready', builtFromEventMutationVersion: 2 });
    });

    it.each(['complete', 'abandon'] as const)('recovers failed %s handoff through the predecessor retry', async path => {
        const { claim } = await warm();
        vi.spyOn(Date, 'now').mockReturnValue(claim.startedAtMs + 30_000);
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true, incrementEventMutationVersion: true });
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic enqueue outage'));
        const handoff = path === 'complete'
            ? completeDerivedMetricsProcessing(uid, claim.generation, claim)
            : abandonDerivedMetricsProcessingAfterWriteBlock(uid, claim.generation, kinds, 'fixture write block', claim);
        await expect(handoff).rejects.toThrow('synthetic enqueue outage');
        const failed = (await coordinator().get()).data()!;
        expect(failed).toMatchObject({ status: 'failed', generation: claim.generation + 1,
            retryFromGeneration: claim.generation, dirtyMetricKinds: kinds,
            buildNotBeforeMs: claim.startedAtMs + 120_000 });

        const run = processDerivedMetricsTask as unknown as (request: unknown) => Promise<void>;
        const predecessor = { data: { uid, generation: claim.generation } };
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic repeated outage'));
        await expect(run(predecessor)).rejects.toThrow('synthetic repeated outage');
        await run(predecessor);
        expect(mocks.enqueue).toHaveBeenLastCalledWith(uid, failed.generation, 90);
        expect((await coordinator().get()).data()).toEqual(failed); // No re-scan or source revision bump.
        vi.mocked(Date.now).mockReturnValue(failed.buildNotBeforeMs);
        await run({ data: { uid, generation: failed.generation } });
        const completed = (await coordinator().get()).data()!;
        expect(completed).toMatchObject({ status: 'idle', retryFromGeneration: null, dirtyMetricKinds: [],
            eventMutationVersion: failed.eventMutationVersion, workoutInputsVersion: failed.workoutInputsVersion });
        expect((await metric().get()).data()).toMatchObject({ status: 'ready',
            builtFromEventMutationVersion: failed.eventMutationVersion });
        const calls = mocks.enqueue.mock.calls.length;
        await run(predecessor);
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
        expect((await coordinator().get()).data()).toEqual(completed);
    });

    it.each(['deletion', 'priority promotion', 'claimed successor'] as const)('fences handoff retries after %s', async replacement => {
        const { claim } = await warm();
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true, incrementEventMutationVersion: true });
        mocks.enqueue.mockRejectedValueOnce(new Error('synthetic enqueue outage'));
        await expect(completeDerivedMetricsProcessing(uid, claim.generation, claim)).rejects.toThrow('synthetic enqueue outage');
        if (replacement === 'deletion') await tombstone().set({ fixture: true });
        if (replacement === 'priority promotion') await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds);
        if (replacement === 'claimed successor') await startDerivedMetricsProcessing(uid, claim.generation + 1);
        const before = (await coordinator().get()).data();
        const calls = mocks.enqueue.mock.calls.length;
        expect(await startDerivedMetricsProcessing(uid, claim.generation)).toBeNull();
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
        expect((await coordinator().get()).data()).toEqual(before);
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

    it.each(['complete', 'abandon'] as const)('does not downgrade an already claimed replacement after a late %s enqueue failure', async path => {
        const { claim } = await warm();
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { background: true });
        mocks.enqueue.mockImplementationOnce(async (...args: unknown[]) => {
            expect(await startDerivedMetricsProcessing(uid, Number(args[1]))).not.toBeNull();
            throw new Error('enqueue_response_lost_after_dispatch');
        });
        const handoff = path === 'complete'
            ? completeDerivedMetricsProcessing(uid, claim.generation, claim)
            : abandonDerivedMetricsProcessingAfterWriteBlock(uid, claim.generation, kinds, 'fixture write block cleared', claim);
        await expect(handoff).rejects.toThrow('enqueue_response_lost_after_dispatch');
        expect((await coordinator().get()).data()).toMatchObject({ status: 'processing',
            generation: claim.generation + 1, processingMetricKinds: kinds, retryFromGeneration: null, lastError: null });
        const calls = mocks.enqueue.mock.calls.length;
        expect(await startDerivedMetricsProcessing(uid, claim.generation)).toBeNull();
        expect(mocks.enqueue).toHaveBeenCalledTimes(calls);
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
