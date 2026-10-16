import { randomUUID } from 'node:crypto';
import { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metric-kinds';
const mocks = vi.hoisted(() => ({ firestore: vi.fn(), enqueue: vi.fn(async () => true) }));
vi.mock('firebase-admin', () => ({ firestore: mocks.firestore }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../shared/cloud-tasks', () => ({ enqueueDerivedMetricsTask: mocks.enqueue }));
import { observeDerivedMetricsQueue, DERIVED_METRICS_PROBE_FIELDS, DERIVED_METRICS_PROBE_LIMIT } from './monitoring-probe';
import { markDerivedMetricsDirtyAndMaybeQueue, startDerivedMetricsProcessing, completeDerivedMetricsProcessing,
    failDerivedMetricsProcessing, markDerivedMetricSnapshotsFailed, writeDerivedMetricSnapshotsReady } from './derived-metrics.service';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('derived metrics monitoring / real read-only Firestore observation', { timeout: 30_000 }, () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback Firestore emulator required');
    let db: Firestore;
    const uid = 'PRIVATE_OWNER';
    const now = Date.now();
    const hour = 3_600_000;
    const kinds = [DERIVED_METRIC_KINDS.Form];
    const user = () => db.doc(`users/${uid}`);
    const coordinator = () => db.doc(`users/${uid}/derivedMetrics/coordinator`);
    const tombstone = () => db.doc(`userDeletionTombstones/${uid}`);
    const observations = (event?: string) => vi.mocked(logger.info).mock.calls
        .filter(([message, fields]) => message === '[DerivedMetrics]' && (!event || fields.event === event)).map(([, fields]) => fields);
    const sample = (state = 'queued') => observations('queue_sample').find(fields => fields.state === state);
    beforeEach(async () => {
        vi.clearAllMocks(); mocks.enqueue.mockResolvedValue(true);
        db = new Firestore({ projectId: `demo-derived-monitor-${randomUUID().slice(0, 8)}` });
        mocks.firestore.mockReturnValue(db);
        await user().set({ private: 'PRIVATE_PROFILE' });
    });
    afterEach(async () => { vi.restoreAllMocks(); await db.terminate(); });
    async function seed(patch: Record<string, unknown> = {}, owner = uid) {
        const ref = db.doc(`users/${owner}/derivedMetrics/coordinator`);
        await ref.set({ entryType: 'coordinator', status: 'queued', generation: 4, dirtyMetricKinds: kinds,
            processingMetricKinds: kinds, requestedAtMs: now - hour, startedAtMs: now - hour / 2,
            updatedAtMs: now - 5 * hour, lastError: 'PRIVATE_ERROR', payload: 'PRIVATE_PAYLOAD', ...patch });
        return ref;
    }
    async function claim() {
        const queued = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds);
        const started = (await startDerivedMetricsProcessing(uid, queued.generation!))!;
        return { generation: queued.generation!, startedAtMs: started.startedAtMs };
    }
    it('reports three genuine idle heartbeat groups, not athlete inactivity or retained ready snapshots', async () => {
        await seed({ status: 'idle', updatedAtMs: 1, requestedAtMs: 1 });
        await db.doc(`users/${uid}/derivedMetrics/form`).set({ entryType: 'snapshot', status: 'ready', updatedAtMs: 1, payload: 'PRIVATE_OLD' });
        await observeDerivedMetricsQueue(db, now);
        expect(observations()).toHaveLength(3);
        for (const state of ['queued', 'processing', 'failed']) expect(sample(state)).toMatchObject({ pendingSample: 0, ageLowerBoundMs: 0, unknownSample: 0, truncated: false });
    });
    it.each(['queued', 'processing', 'failed'])('observes eligible %s generation timing without writes, source reads or private log fields', async status => {
        const ref = await seed({ status }); const before = await ref.get();
        const select = vi.spyOn(Query.prototype, 'select'); const getAll = vi.spyOn(Transaction.prototype, 'getAll');
        const transactions = vi.spyOn(db, 'runTransaction'); const writes = vi.spyOn(Transaction.prototype, 'set');
        await observeDerivedMetricsQueue(db, now);
        expect(sample(status)).toMatchObject({ pendingSample: 1, ageLowerBoundMs: status === 'processing' ? hour / 2 : hour });
        expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
        expect(select).toHaveBeenCalledExactlyOnceWith(...DERIVED_METRICS_PROBE_FIELDS);
        expect(transactions.mock.calls.every(([, options]) => options?.readOnly)).toBe(true);
        expect(writes).not.toHaveBeenCalled(); expect(getAll).toHaveBeenCalledOnce();
        const fields = (getAll.mock.calls[0].at(-1) as { fieldMask: string[] }).fieldMask;
        expect(fields).toEqual([...DERIVED_METRICS_PROBE_FIELDS, 'expireAt']);
        expect(JSON.stringify(observations())).not.toContain('PRIVATE');
    });
    it.each(['missing', 'deleting', 'retry-backoff'])('excludes expected %s without reporting a stalled generation', async reason => {
        await seed(reason === 'retry-backoff' ? { status: 'failed', updatedAtMs: now - 60_000 } : {});
        if (reason === 'missing') await db.recursiveDelete(user());
        // Re-seed the orphan only to verify the missing-owner fence, never in production.
        if (reason === 'missing') await seed();
        if (reason === 'deleting') await tombstone().set({ private: 'PRIVATE_DELETION' });
        await observeDerivedMetricsQueue(db, now);
        expect(observations().some(fields => fields.pendingSample > 0)).toBe(false);
        expect(observations('queue_sample_unavailable')).toHaveLength(0);
    });
    it('accepts expired tombstones but retains the active-account check', async () => {
        await seed(); await tombstone().set({ expireAt: new Date(now - 1) });
        await observeDerivedMetricsQueue(db, now); expect(sample()).toMatchObject({ pendingSample: 1 });
    });
    it('keeps malformed pending metadata unknown instead of substituting a last-ready timestamp', async () => {
        await seed({ requestedAtMs: null });
        await observeDerivedMetricsQueue(db, now);
        expect(sample()).toMatchObject({ unknownSample: 1 }); expect(sample()).not.toHaveProperty('pendingSample');
    });
    it('revalidates a coordinator changed after sampling without claiming a stale backlog', async () => {
        const ref = await seed(); const original = db.runTransaction.bind(db);
        vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (callback, options) => {
            await ref.update({ generation: 5, requestedAtMs: now, updatedAtMs: now });
            return original(callback, options);
        });
        await observeDerivedMetricsQueue(db, now);
        expect(sample()).toMatchObject({ pendingSample: 0, excludedSample: 1 });
    });
    it('rejects a coordinator-shaped document outside the owner-scoped exact path', async () => {
        await db.doc('other/PRIVATE_OWNER/derivedMetrics/coordinator').set({ entryType: 'coordinator', status: 'queued', updatedAtMs: 1 });
        await observeDerivedMetricsQueue(db, now);
        expect(observations('queue_sample').every(fields => fields.unknownSample === 1 && !('pendingSample' in fields))).toBe(true);
    });
    it('bounds a saturated positive prefix and never asserts zero for unseen states', async () => {
        for (let index = 0; index <= DERIVED_METRICS_PROBE_LIMIT; index++) {
            const owner = `PRIVATE_${index}`; await db.doc(`users/${owner}`).set({ private: true }); await seed({}, owner);
        }
        const transactions = vi.spyOn(db, 'runTransaction');
        await observeDerivedMetricsQueue(db, now);
        expect(transactions).toHaveBeenCalledTimes(DERIVED_METRICS_PROBE_LIMIT);
        expect(sample()).toMatchObject({ pendingSample: DERIVED_METRICS_PROBE_LIMIT, truncated: true });
        expect(sample('processing')).not.toHaveProperty('pendingSample');
    });
    it('withholds saturated excluded-prefix zeroes and reports query failure as unavailable', async () => {
        for (let index = 0; index <= DERIVED_METRICS_PROBE_LIMIT; index++) await seed({}, `PRIVATE_MISSING_${index}`);
        await observeDerivedMetricsQueue(db, now);
        expect(observations('queue_sample').every(fields => fields.truncated && !('pendingSample' in fields))).toBe(true);
        vi.clearAllMocks();
        vi.spyOn(db, 'collectionGroup').mockImplementationOnce(() => { throw new Error('PRIVATE_QUERY_ERROR'); });
        await observeDerivedMetricsQueue(db, now);
        expect(observations('queue_sample_unavailable')).toHaveLength(3);
        expect(JSON.stringify(observations())).not.toContain('PRIVATE');
    });
    it('distinguishes guarded ready publication, intentional follow-up and final settlement', async () => {
        const current = await claim();
        expect(await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: current })).toBe(true);
        await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds, { incrementEventMutationVersion: true });
        const next = await completeDerivedMetricsProcessing(uid, current.generation, current);
        expect(next.requeued).toBe(true);
        expect(observations('snapshot_commit')).toEqual([expect.objectContaining({ outcome: 'ready', metricKind: kinds[0] })]);
        expect(observations('coordinator_commit')).toEqual([expect.objectContaining({ outcome: 'requeued' })]);
        const started = (await startDerivedMetricsProcessing(uid, next.nextGeneration!))!;
        const nextClaim = { generation: next.nextGeneration!, startedAtMs: started.startedAtMs };
        await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: nextClaim });
        await completeDerivedMetricsProcessing(uid, nextClaim.generation, nextClaim);
        expect(observations('coordinator_commit').at(-1)).toMatchObject({ outcome: 'settled', metricKind: kinds[0] });
        expect((await coordinator().get()).get('status')).toBe('idle');
    });
    it('never emits successful publication, failure or settlement for a superseded claim', async () => {
        const current = await claim();
        await coordinator().update({ generation: current.generation + 1, status: 'queued', dirtyMetricKinds: kinds });
        vi.clearAllMocks();
        expect(await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: current })).toBe(false);
        await markDerivedMetricSnapshotsFailed(uid, kinds, new Error('PRIVATE_STALE'), current);
        await failDerivedMetricsProcessing(uid, current.generation, new Error('PRIVATE_STALE'), kinds, current);
        await completeDerivedMetricsProcessing(uid, current.generation, current);
        expect(observations()).toEqual([]);
    });
    it('records actual failure only after guarded persistence; same-generation retry can settle normally', async () => {
        const current = await claim();
        await markDerivedMetricSnapshotsFailed(uid, kinds, new Error('PRIVATE_ERROR'), current);
        await failDerivedMetricsProcessing(uid, current.generation, new Error('PRIVATE_ERROR'), kinds, current);
        expect(observations('snapshot_commit')).toEqual([expect.objectContaining({ outcome: 'failed' })]);
        expect(observations('coordinator_commit')).toEqual([expect.objectContaining({ outcome: 'failed' })]);
        const started = (await startDerivedMetricsProcessing(uid, current.generation))!;
        const retry = { generation: current.generation, startedAtMs: started.startedAtMs };
        await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: retry });
        await completeDerivedMetricsProcessing(uid, retry.generation, retry);
        expect(observations('coordinator_commit').map(fields => fields.outcome)).toEqual(['failed', 'settled']);
        expect(JSON.stringify(observations())).not.toContain('PRIVATE');
    });
    it('suppresses publication and failure observations if deletion starts before a transaction commits', async () => {
        const current = await claim(); const original = db.runTransaction.bind(db);
        vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (callback, options) => {
            await tombstone().set({ private: 'PRIVATE_DELETION' }); return original(callback, options);
        });
        expect(await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: current })).toBe(false);
        await failDerivedMetricsProcessing(uid, current.generation, new Error('PRIVATE_ERROR'), kinds, current);
        expect(observations()).toEqual([]);
    });
    it('logs once after a real transaction retry, never from the retriable callback', async () => {
        const current = await claim(); const original = db.runTransaction.bind(db);
        let attempts = 0;
        vi.spyOn(db, 'runTransaction').mockImplementationOnce((callback, options) => original(async tx => {
            const result = await callback(tx); attempts++;
            expect(observations('snapshot_commit')).toHaveLength(0);
            if (attempts === 1) throw Object.assign(new Error('Synthetic retriable abort'), { code: 10 });
            return result;
        }, options));
        expect(await writeDerivedMetricSnapshotsReady(uid, kinds, {}, { claim: current })).toBe(true);
        expect(attempts).toBeGreaterThan(1);
        expect(observations('snapshot_commit')).toHaveLength(1);
    });
    it.each(['failed-before-admission', 'late-after-claim'])('fences %s enqueue failures before emitting telemetry', async phase => {
        mocks.enqueue.mockImplementationOnce(async (_uid?: string, generation?: number) => {
            if (phase === 'late-after-claim') await startDerivedMetricsProcessing(uid, generation!);
            throw new Error('PRIVATE_ENQUEUE_ERROR');
        });
        const result = await markDerivedMetricsDirtyAndMaybeQueue(uid, kinds);
        expect(result.accepted).toBe(false);
        expect(observations('coordinator_commit').filter(fields => fields.outcome === 'enqueue_failed')).toHaveLength(phase === 'failed-before-admission' ? 1 : 0);
        expect((await coordinator().get()).get('status')).toBe(phase === 'failed-before-admission' ? 'failed' : 'processing');
    });
});
