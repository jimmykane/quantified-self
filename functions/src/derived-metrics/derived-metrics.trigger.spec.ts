import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cloudTasks from '../shared/cloud-tasks';
import * as trainingLoadCache from '../training-load/training-load-cache';

const hoisted = vi.hoisted(() => ({
    onDocumentWritten: vi.fn((_opts: unknown, handler: any) => handler),
    enqueueDerivedMetricsIngressTask: vi.fn(),
    isDerivedMetricsUidAllowed: vi.fn(),
    getAll: vi.fn(),
    usersDoc: vi.fn(),
    tombstonesDoc: vi.fn(),
    usersCollection: vi.fn(),
    tombstonesCollection: vi.fn(),
    firestore: vi.fn(),
    metadata: vi.fn(),
    refresh: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: hoisted.onDocumentWritten,
}));

vi.mock('firebase-admin', () => ({
    firestore: hoisted.firestore,
}));
vi.mock('./derived-metrics-uid-gate', () => ({
    isDerivedMetricsUidAllowed: hoisted.isDerivedMetricsUidAllowed,
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        ensureDerivedMetrics: {
            region: 'europe-west2',
        },
    },
}));

import {
    onTrainingLoadMetadataWrite,
    onDashboardDerivedMetricsActivityWrite,
    onDashboardDerivedMetricsEventWrite,
    onDashboardDerivedMetricsHealthWrite,
    onDashboardDerivedMetricsSleepWrite,
} from './derived-metrics.trigger';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';

describe('onDashboardDerivedMetricsEventWrite', () => {
    beforeEach(() => {
        // Spy on the loaded export: overlapping dynamic imports can bypass Vitest's
        // async mock factory. Cold import isolation has its own loading spec.
        vi.spyOn(cloudTasks, 'enqueueDerivedMetricsIngressTask').mockImplementation(hoisted.enqueueDerivedMetricsIngressTask);
        vi.spyOn(trainingLoadCache, 'refreshTrainingLoadSummary').mockImplementation(hoisted.refresh);
        hoisted.usersDoc.mockReset();
        hoisted.usersDoc.mockImplementation((uid: string) => ({ path: `users/${uid}` }));
        hoisted.tombstonesDoc.mockReset();
        hoisted.tombstonesDoc.mockImplementation((uid: string) => ({ path: `userDeletionTombstones/${uid}` }));
        hoisted.usersCollection.mockReset();
        hoisted.usersCollection.mockReturnValue({ doc: hoisted.usersDoc });
        hoisted.tombstonesCollection.mockReset();
        hoisted.tombstonesCollection.mockReturnValue({ doc: hoisted.tombstonesDoc });
        hoisted.firestore.mockReset();
        hoisted.getAll.mockReset();
        hoisted.getAll.mockImplementation(async (...refs: Array<{ path?: string }>) => refs.map(ref => {
            if (`${ref.path || ''}`.startsWith('users/')) {
                return { exists: true, data: () => ({}) };
            }
            return { exists: false, data: () => undefined };
        }));
        hoisted.metadata.mockReset().mockResolvedValue({ data: () => undefined });
        hoisted.refresh.mockReset().mockResolvedValue(undefined);
        hoisted.firestore.mockReturnValue({
            doc: vi.fn(() => ({ get: hoisted.metadata })),
            collection: vi.fn((collectionId: string) => {
                if (collectionId === 'userDeletionTombstones') {
                    return hoisted.tombstonesCollection();
                }
                return hoisted.usersCollection();
            }),
            getAll: hoisted.getAll,
        });
        hoisted.enqueueDerivedMetricsIngressTask.mockClear();
        hoisted.enqueueDerivedMetricsIngressTask.mockResolvedValue(true);
        hoisted.isDerivedMetricsUidAllowed.mockReset();
        hoisted.isDerivedMetricsUidAllowed.mockReturnValue(true);
    });

    const deletionTriggers = [
        ['event', onDashboardDerivedMetricsEventWrite],
        ['activity', onDashboardDerivedMetricsActivityWrite],
        ['training-load', onTrainingLoadMetadataWrite],
        ['sleep', onDashboardDerivedMetricsSleepWrite],
        ['health', onDashboardDerivedMetricsHealthWrite],
    ] as const;
    const deletionEvent = () => ({
        params: { uid: 'user-1', eventId: 'event-1', activityId: 'leg', sleepSessionId: 'sleep-1', sourceRecordId: 'health-1' },
        data: { before: { exists: true, data: () => ({ eventID: 'event-1', metricIds: ['body_weight'] }) },
            after: { exists: false, data: () => undefined } },
    });

    describe.each(deletionTriggers)('%s concurrent deliveries', (source, handler) => {
        it.each(['same owner', 'different owners'])('keeps owners and invalidation scopes isolated across five overlapping writes (%s)', async scope => {
            let release!: () => void;
            const blocked = new Promise<void>(resolve => { release = resolve; });
            hoisted.enqueueDerivedMetricsIngressTask.mockImplementation(async () => { await blocked; return true; });
            const events = Array.from({ length: 5 }, (_, index) => {
                const uid = scope === 'same owner' ? 'owner-shared' : `owner-${index}`;
                const data = source === 'health' ? { metricIds: ['body_weight'] }
                    : source === 'activity' ? { eventID: 'workout' }
                        : source === 'training-load' ? { controls: {}, excluded: true } : {};
                return { source, uid, handler, event: {
                    params: { uid, eventId: 'workout', activityId: 'leg', sleepSessionId: 'night', sourceRecordId: 'weight' },
                    data: { before: { exists: false, data: () => undefined }, after: { exists: true, data: () => data } },
                } };
            });
            const pending = Promise.allSettled(events.map(({ handler, event }) =>
                (handler as unknown as (event: unknown) => Promise<void>)(event)));
            try {
                await vi.waitFor(() => expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(5));
                for (const { source, uid } of events) {
                    const calls = hoisted.enqueueDerivedMetricsIngressTask.mock.calls.filter(call => call[0] === uid);
                    const taskScope = source === 'training-load' ? 'training-load' : source === 'sleep' ? 'sleep'
                        : source === 'health' ? 'health-body_weight_trend' : undefined;
                    expect(calls.some(call => call[3]?.taskScope === taskScope)).toBe(true);
                    if (source === 'health') {
                        expect(calls.find(call => call[3]?.taskScope === taskScope)?.[3]).toEqual({
                            taskScope, metricKinds: [DERIVED_METRIC_KINDS.BodyWeightTrend], incrementEventMutationVersion: false,
                        });
                    }
                }
                expect(hoisted.refresh).toHaveBeenCalledTimes(source === 'training-load' ? 5 : 0);
                if (source === 'training-load') {
                    for (const { uid } of events) expect(hoisted.refresh).toHaveBeenCalledWith(uid, 'workout');
                }
            } finally { release(); await pending; }
            expect(await pending).toEqual(events.map(() => ({ status: 'fulfilled', value: undefined })));
        });
    });

    it('propagates an enqueue failure independently while other concurrent owners complete and the failed owner retries', async () => {
        const failedUid = 'owner-retry';
        const completed = new Set<string>();
        let unavailable = true;
        const failure = new Error('synthetic enqueue unavailable');
        hoisted.enqueueDerivedMetricsIngressTask.mockImplementation(async (uid: string) => {
            if (uid === failedUid && unavailable) throw failure;
            completed.add(uid);
            return true;
        });
        const owners = [failedUid, 'owner-1', 'owner-2', 'owner-3', 'owner-4'];
        const run = (uid: string) => (onDashboardDerivedMetricsSleepWrite as unknown as (event: unknown) => Promise<void>)({
            params: { uid, sleepSessionId: 'night' },
            data: { before: { exists: false }, after: { exists: true, data: () => ({}) } },
        });
        const results = await Promise.allSettled(owners.map(run));
        expect(results[0]).toEqual({ status: 'rejected', reason: failure });
        expect(results.slice(1)).toEqual(owners.slice(1).map(() => ({ status: 'fulfilled', value: undefined })));
        expect(completed).toEqual(new Set(owners.slice(1)));
        unavailable = false;
        await run(failedUid);
        expect(completed).toEqual(new Set(owners));
    });

    it.each(deletionTriggers)('keeps the %s trigger at 512 MiB with retries and the existing instance ceiling', (_source, handler) => {
        const registered = hoisted.onDocumentWritten.mock.calls.find(call => call[1] === handler);
        expect(registered?.[0]).toMatchObject({
            region: 'europe-west2', memory: '512MiB', concurrency: 5, maxInstances: 50, retry: true,
        });
    });

    describe.each(['tombstone', 'missing root'])('account deletion (%s)', state => {
        it.each(deletionTriggers)('skips %s deletion before cache or metadata work', async (_source, handler) => {
            hoisted.getAll.mockResolvedValueOnce([
                { exists: state === 'tombstone', data: () => ({}) },
                { exists: state === 'tombstone', data: () => ({}) },
            ]);
            await (handler as unknown as (event: unknown) => Promise<void>)(deletionEvent());
            expect(hoisted.getAll).toHaveBeenCalledTimes(1);
            expect(hoisted.refresh).not.toHaveBeenCalled();
            expect(hoisted.metadata).not.toHaveBeenCalled();
            expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
        });
    });

    it.each(deletionTriggers)('keeps ordinary %s deletion invalidation for active accounts', async (source, handler) => {
        hoisted.metadata.mockResolvedValue({ data: () => ({ controls: { leg: { override: 0 } } }) });
        await (handler as unknown as (event: unknown) => Promise<void>)(deletionEvent());
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(1);
        if (['event', 'activity', 'training-load'].includes(source)) {
            expect(hoisted.refresh).toHaveBeenCalledExactlyOnceWith('user-1', 'event-1');
        } else {
            expect(hoisted.refresh).not.toHaveBeenCalled();
        }
    });

    it('still checks deletion after cache work if account deletion starts during an ordinary delete', async () => {
        hoisted.refresh.mockImplementationOnce(async () => {
            hoisted.getAll.mockResolvedValueOnce([
                { exists: true, data: () => ({}) }, { exists: true, data: () => ({}) },
            ]);
        });
        await (onDashboardDerivedMetricsEventWrite as unknown as (event: unknown) => Promise<void>)(deletionEvent());
        expect(hoisted.refresh).toHaveBeenCalledTimes(1);
        expect(hoisted.getAll).toHaveBeenCalledTimes(2);
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('defers pending imports and suppresses delayed source triggers after final persistence', async () => {
        const event = { params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: false }, after: { exists: true, data: () => ({}), updateTime: { seconds: 2, nanoseconds: 3 } } } };
        hoisted.metadata.mockResolvedValueOnce({ data: () => ({ sourceWritePending: true }) });
        await (onDashboardDerivedMetricsEventWrite as any)(event);
        hoisted.metadata.mockResolvedValueOnce({ data: () => ({ sourceWriteTimes: { event: '2:3' } }) });
        await (onDashboardDerivedMetricsEventWrite as any)(event);
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
        await (onDashboardDerivedMetricsEventWrite as any)(event);
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(1);
    });

    it('refreshes legacy overrides after ordinary source corrections and child deletions', async () => {
        hoisted.metadata.mockResolvedValue({ data: () => ({ controls: { leg: { override: 0 } } }) });
        await (onDashboardDerivedMetricsActivityWrite as any)({ params: { uid: 'user-1', activityId: 'leg' }, data: {
            before: { exists: true, data: () => ({ eventID: 'e', stats: {} }) },
            after: { exists: true, data: () => ({ eventID: 'e', stats: { Duration: 10 } }) } } });
        await (onDashboardDerivedMetricsActivityWrite as any)({ params: { uid: 'user-1', activityId: 'leg' }, data: {
            before: { exists: true, data: () => ({ eventID: 'e' }) }, after: { exists: false } } });
        expect(hoisted.refresh).toHaveBeenNthCalledWith(1, 'user-1', 'e');
        expect(hoisted.refresh).toHaveBeenNthCalledWith(2, 'user-1', 'e');
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])('refreshes parsed load candidates after uncoordinated child changes (deleted: %s)', async deleted => {
        hoisted.metadata.mockResolvedValue({ data: () => ({ controls: {}, legs: { leg: { activityId: 'leg' } } }) });
        await (onDashboardDerivedMetricsActivityWrite as any)({ params: { uid: 'user-1', activityId: 'leg' }, data: {
            before: { exists: true, data: () => ({ eventID: 'e', stats: {} }) },
            after: { exists: !deleted, data: () => deleted ? undefined : { eventID: 'e', stats: { Duration: 10 } } } } });
        expect(hoisted.refresh).toHaveBeenCalledWith('user-1', 'e');
        expect(hoisted.refresh.mock.invocationCallOrder[0]).toBeLessThan(hoisted.enqueueDerivedMetricsIngressTask.mock.invocationCallOrder[0]);
    });

    it('avoids parsed leg verification for a device-label-only edit', async () => {
        hoisted.metadata.mockResolvedValue({ data: () => ({ controls: {}, legs: { leg: { activityId: 'leg' } } }) });
        await (onDashboardDerivedMetricsActivityWrite as any)({ params: { uid: 'user-1', activityId: 'leg' }, data: {
            before: { exists: true, data: () => ({ eventID: 'e', creator: { name: 'Old label' } }) },
            after: { exists: true, data: () => ({ eventID: 'e', creator: { name: 'New label' } }) } } });
        expect(hoisted.refresh).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(1);
    });

    it('refreshes legacy source changes outside the derived rollout without enqueueing', async () => {
        hoisted.isDerivedMetricsUidAllowed.mockReturnValue(false);
        hoisted.metadata.mockResolvedValue({ data: () => ({ controls: { leg: { override: 0 } } }) });
        await (onDashboardDerivedMetricsActivityWrite as any)({ params: { uid: 'user-1', activityId: 'leg' }, data: {
            before: { exists: true, data: () => ({ eventID: 'e', stats: {} }) },
            after: { exists: true, data: () => ({ eventID: 'e', stats: { Duration: 10 } }) } } });
        expect(hoisted.refresh).toHaveBeenCalledWith('user-1', 'e');
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('uses cache readiness time for delayed legacy source invalidations', async () => {
        hoisted.metadata.mockResolvedValue({ data: () => ({ controls: { leg: { override: 0 } } }) });
        const started = Date.now();
        await (onDashboardDerivedMetricsActivityWrite as any)({ time: '2026-01-01T00:00:00Z',
            params: { uid: 'user-1', activityId: 'leg' }, data: {
                before: { exists: true, data: () => ({ eventID: 'e' }) }, after: { exists: false } } });
        expect(hoisted.enqueueDerivedMetricsIngressTask.mock.calls[0][2]).toBeGreaterThanOrEqual(started);
    });

    it.each([[false, false], [false, true], [true, false], [true, true]])(
        'refreshes the previous parent when a leg moves (destination import: %s, parsed: %s)', async (destinationPending, parsed) => {
        const legacy = { data: () => ({ controls: { leg: { override: 0 } }, ...(parsed ? { legs: { leg: { activityId: 'leg' } } } : {}) }) };
        hoisted.metadata.mockResolvedValueOnce(destinationPending ? { data: () => ({ sourceWritePending: true }) } : legacy)
            .mockResolvedValueOnce(legacy);
        await (onDashboardDerivedMetricsActivityWrite as any)({ params: { uid: 'user-1', activityId: 'leg' }, data: {
            before: { exists: true, data: () => ({ eventID: 'old' }) },
            after: { exists: true, data: () => ({ eventID: 'new' }) } } });
        expect(hoisted.refresh).toHaveBeenCalledWith('user-1', 'old');
        if (!destinationPending) expect(hoisted.refresh).toHaveBeenCalledWith('user-1', 'new');
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(1);
    });

    it('selects the cache invalidation bucket after a slow deletion guard finishes', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const readGuard = hoisted.getAll.getMockImplementation()!;
        hoisted.getAll.mockImplementation(async (...args: unknown[]) => { now.mockReturnValue(90000); return readGuard(...args); });
        try {
            await (onTrainingLoadMetadataWrite as any)({ params: { uid: 'user-1', eventId: 'e' }, data: {
                before: { exists: true, data: () => ({ controls: {} }) },
                after: { exists: true, data: () => ({ controls: { leg: { override: 0 } } }) } } });
            expect(hoisted.enqueueDerivedMetricsIngressTask.mock.calls[0][2]).toBe(90000);
        } finally { now.mockRestore(); }
    });

    it('publishes completed imports once through normal full-source ingress after the cache is ready', async () => {
        await (onTrainingLoadMetadataWrite as any)({ params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: true, data: () => ({ version: 1, controls: {}, sourceWritePending: true }) },
            after: { exists: true, data: () => ({ version: 1, controls: {}, sourceWritePending: false, sourceRevision: 1 }) } } });
        expect(hoisted.refresh).toHaveBeenCalledWith('user-1', 'e');
        expect(hoisted.refresh.mock.invocationCallOrder[0]).toBeLessThan(hoisted.enqueueDerivedMetricsIngressTask.mock.invocationCallOrder[0]);
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledExactlyOnceWith('user-1', undefined, expect.any(Number));
    });

    it('invalidates a control saved during an unchanged import using readiness time rather than an expired bucket', async () => {
        const oldTime = '2026-01-01T00:00:00Z'; const start = Date.now();
        await (onTrainingLoadMetadataWrite as any)({ time: oldTime, params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: true, data: () => ({ version: 1, controls: { leg: { override: 0 } }, sourceRevision: 1, loadRevision: 1, sourceWritePending: true }) },
            after: { exists: true, data: () => ({ version: 1, controls: { leg: { override: 0 } }, sourceRevision: 1, loadRevision: 2, sourceWritePending: false }) } } });
        expect(hoisted.enqueueDerivedMetricsIngressTask.mock.calls[0][2]).toBeGreaterThanOrEqual(start);
        expect(hoisted.enqueueDerivedMetricsIngressTask.mock.calls[0][3]).toMatchObject({ taskScope: 'training-load' });
    });

    it('keeps cache maintenance active outside the derived rollout and retries failed refreshes before enqueue', async () => {
        const event = { params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: true, data: () => ({ version: 1, controls: {} }) },
            after: { exists: true, data: () => ({ version: 1, controls: {}, excluded: true }) } } };
        hoisted.isDerivedMetricsUidAllowed.mockReturnValue(false);
        await (onTrainingLoadMetadataWrite as any)(event);
        expect(hoisted.refresh).toHaveBeenCalledTimes(1);
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
        hoisted.isDerivedMetricsUidAllowed.mockReturnValue(true);
        hoisted.refresh.mockRejectedValueOnce(new Error('pending source'));
        await expect((onTrainingLoadMetadataWrite as any)(event)).rejects.toThrow('pending source');
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('configures retry-safe Firestore trigger options', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/events/{eventId}',
                memory: '512MiB',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('configures the activity trigger on normalized flat activity documents', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/activities/{activityId}',
                memory: '512MiB',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('configures the sleep trigger on normalized sleep sessions', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/sleepSessions/{sleepSessionId}',
                memory: '512MiB',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('configures the Health trigger on owner-scoped source records', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/healthSourceRecords/{sourceRecordId}',
                memory: '512MiB',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it.each(['create', 'update', 'delete'])('refreshes recovery history after an HRV %s', async kind => {
        await (onDashboardDerivedMetricsHealthWrite as any)({
            params: {uid: 'user-1', sourceRecordId: 'nightly-hrv'},
            data: {
                before: {exists: kind !== 'create', data: () => kind === 'create' ? undefined : ({metricIds: ['heart_rate_variability'], metrics: [{value: 40}]})},
                after: {exists: kind !== 'delete', data: () => kind === 'delete' ? undefined : ({metricIds: ['heart_rate_variability'], metrics: [{value: 45}]})},
            },
        });
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith('user-1', undefined, undefined, {
            taskScope: 'health-training_build_comparison-training_readiness',
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison, DERIVED_METRIC_KINDS.TrainingReadiness],
            incrementEventMutationVersion: false,
        });
    });

    it.each(['create', 'update', 'delete'])('refreshes only readiness for a Garmin HR sample %s', async kind => {
        const data = { metricIds: ['heart_rate'], sampleChunkIds: ['chunk'], source: { provider: 'GarminAPI', sourceRecordType: 'garmin_daily', revision: { digest: 'old' } } };
        await (onDashboardDerivedMetricsHealthWrite as unknown as (event: unknown) => Promise<void>)({
            params: { uid: 'user-1', sourceRecordId: 'garmin-daily' }, data: {
                before: { exists: kind !== 'create', data: () => kind === 'create' ? undefined : data },
                after: { exists: kind !== 'delete', data: () => kind === 'delete' ? undefined : { ...data, source: { ...data.source, revision: { digest: 'new' } } } },
            },
        });
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith('user-1', undefined, undefined, {
            taskScope: 'health-training_readiness', metricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness], incrementEventMutationVersion: false,
        });
    });

    it('targets only derived metrics affected by a Health record mutation', async () => {
        await (onDashboardDerivedMetricsHealthWrite as any)({
            params: { uid: 'user-1', sourceRecordId: 'health-1' },
            data: {
                before: { exists: false, data: () => undefined },
                after: { exists: true, data: () => ({ metricIds: ['body_weight', 'unrelated'] }) },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith(
            'user-1',
            undefined,
            undefined,
            {
                taskScope: `health-${DERIVED_METRIC_KINDS.BodyWeightTrend}`,
                metricKinds: [DERIVED_METRIC_KINDS.BodyWeightTrend],
                incrementEventMutationVersion: false,
            },
        );
    });

    it('coalesces only identical Health invalidation sets in the same bucket', async () => {
        const pendingTasks = new Map<string, readonly string[]>();
        hoisted.enqueueDerivedMetricsIngressTask.mockImplementation(async (uid, _delay, time, options) => {
            const key = `${uid}-${time}-${options.taskScope}`;
            if (pendingTasks.has(key)) return false;
            pendingTasks.set(key, options.metricKinds);
            return true;
        });
        for (const [before, after] of [
            [[], ['body_weight']],
            [[], ['vo2_max']],
            [[], ['body_weight']],
            [['body_weight'], ['vo2_max']],
            [['vo2_max'], []],
            [[], ['heart_rate']],
        ]) {
            await (onDashboardDerivedMetricsHealthWrite as any)({
                time: '2026-04-29T10:00:15.000Z',
                params: { uid: 'user-1', sourceRecordId: 'health-1' },
                data: {
                    before: { exists: before.length > 0, data: () => ({ metricIds: before }) },
                    after: { exists: after.length > 0, data: () => ({ metricIds: after }) },
                },
            });
        }

        expect([...pendingTasks.values()]).toEqual([
            [DERIVED_METRIC_KINDS.BodyWeightTrend],
            [DERIVED_METRIC_KINDS.TrainingCapacity],
            [DERIVED_METRIC_KINDS.BodyWeightTrend, DERIVED_METRIC_KINDS.TrainingCapacity],
        ]);
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(5);
        expect(hoisted.enqueueDerivedMetricsIngressTask.mock.calls.every(
            call => call[3].incrementEventMutationVersion === false,
        )).toBe(true);
    });

    it('enqueues sleep creates and deletes as a separate targeted ingress scope', async () => {
        await (onDashboardDerivedMetricsSleepWrite as any)({
            params: { uid: 'user-1', sleepSessionId: 'sleep-1' },
            data: {
                before: { exists: false },
                after: { exists: true },
            },
        });
        await (onDashboardDerivedMetricsSleepWrite as any)({
            params: { uid: 'user-1', sleepSessionId: 'sleep-1' },
            data: {
                before: { exists: true },
                after: { exists: false },
            },
        });

        const expectedOptions = {
            taskScope: 'sleep',
            metricKinds: [
                DERIVED_METRIC_KINDS.TrainingBuildComparison,
                DERIVED_METRIC_KINDS.TrainingReadiness,
            ],
            incrementEventMutationVersion: false,
        };
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(2);
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenNthCalledWith(
            1, 'user-1', undefined, undefined, expectedOptions,
        );
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenNthCalledWith(
            2, 'user-1', undefined, undefined, expectedOptions,
        );
    });

    it('enqueues activity creates and deletes through the same debounced ingress', async () => {
        await (onDashboardDerivedMetricsActivityWrite as any)({
            params: { uid: 'user-1', activityId: 'activity-1' },
            data: {
                before: { exists: false },
                after: { exists: true },
            },
        });
        await (onDashboardDerivedMetricsActivityWrite as any)({
            params: { uid: 'user-1', activityId: 'activity-1' },
            data: {
                before: { exists: true },
                after: { exists: false },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(2);
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenNthCalledWith(1, 'user-1');
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenNthCalledWith(2, 'user-1');
    });

    it('invalidates modeled load kinds after an owner edit', async () => {
        await (onTrainingLoadMetadataWrite as any)({ params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: true, data: () => ({ controls: {} }) },
            after: { exists: true, data: () => ({ controls: { leg: { override: 0 } } }) },
        } });
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith('user-1', undefined, expect.any(Number), expect.objectContaining({
            incrementEventMutationVersion: true, taskScope: 'training-load', immediate: true,
            metricKinds: expect.arrayContaining([DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Acwr,
                DERIVED_METRIC_KINDS.TrainingSummary, DERIVED_METRIC_KINDS.TrainingBuildComparison]),
        }));
    });
    it.each([
        [{ controls: { leg: { override: 0 } } }, { controls: {} }],
        [{ excluded: false }, { excluded: true }],
        [{ excluded: true }, { excluded: false }],
        [{ resetUnmatched: false }, { resetUnmatched: true }],
        [{ sourceWritePending: true, controls: {} }, { sourceWritePending: true, controls: { leg: { included: false } } }],
    ])('gives control resets/exclusion and edits during imports priority', async (before, after) => {
        await (onTrainingLoadMetadataWrite as unknown as (event: unknown) => Promise<void>)({ params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: true, data: () => before }, after: { exists: true, data: () => after },
        } });
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith('user-1', undefined, expect.any(Number),
            expect.objectContaining({ taskScope: 'training-load', immediate: true }));
    });

    it.each([
        [{ controls: { leg: { override: 0 } }, sourceRevision: 1 },
            { controls: { leg: { override: 0 } }, sourceRevision: 1, sourceWritePending: true }, 0],
        [{ controls: { old: { override: 0 } }, sourceRevision: 1, sourceWritePending: true },
            { controls: { new: { override: 0 } }, sourceRevision: 2, sourceWritePending: false }, 1],
    ])('does not give import preparation or finalization priority', async (before, after, count) => {
        await (onTrainingLoadMetadataWrite as unknown as (event: unknown) => Promise<void>)({ params: { uid: 'user-1', eventId: 'e' }, data: {
            before: { exists: true, data: () => before }, after: { exists: true, data: () => after },
        } });
        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledTimes(count as number);
        expect(hoisted.enqueueDerivedMetricsIngressTask.mock.calls[0]?.[3]?.immediate).not.toBe(true);
    });

    it('enqueues a debounced ingress task for valid event writes', async () => {
        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: true },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith('user-1');
    });

    it.each([
        onDashboardDerivedMetricsEventWrite, onDashboardDerivedMetricsActivityWrite,
        onDashboardDerivedMetricsSleepWrite, onDashboardDerivedMetricsHealthWrite,
    ])('does no Firestore reads or enqueue for a metadata-only update', async handler => {
        const before = { metricIds: ['heart_rate_variability'], source: { maxObservedRevisionOrder: 1 } };
        const after = { ...before, updatedAtMs: 2, source: { maxObservedRevisionOrder: 2 } };
        await (handler as any)({ params: { uid: 'user-1' }, data: {
            before: { exists: true, data: () => before }, after: { exists: true, data: () => after },
        } });
        expect(hoisted.getAll).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it.each([false, true])('does not read deletion state for unrelated Health records (deleted: %s)', async deleted => {
        await (onDashboardDerivedMetricsHealthWrite as any)({ params: { uid: 'user-1' }, data: {
            before: { exists: deleted, data: () => deleted ? { metricIds: ['steps'] } : undefined },
            after: { exists: !deleted, data: () => deleted ? undefined : { metricIds: ['steps'] } },
        } });
        expect(hoisted.getAll).not.toHaveBeenCalled();
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('uses event timestamp for ingress bucketing when CloudEvent time is present', async () => {
        await (onDashboardDerivedMetricsEventWrite as any)({
            time: '2026-04-29T10:00:15.000Z',
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: true },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith(
            'user-1',
            undefined,
            Date.parse('2026-04-29T10:00:15.000Z'),
        );
    });

    it('skips when uid is missing', async () => {
        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: '', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: true },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('skips when uid is not allowlisted', async () => {
        hoisted.isDerivedMetricsUidAllowed.mockReturnValue(false);

        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: true },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('skips when both before and after snapshots are absent', async () => {
        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: false },
                after: { exists: false },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('skips delete ingress when user root document is already missing', async () => {
        hoisted.getAll.mockResolvedValueOnce([
            { exists: false, data: () => undefined },
            { exists: false, data: () => undefined },
        ]);

        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: false },
            },
        });

        expect(hoisted.getAll).toHaveBeenCalledTimes(1);
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('applies the deletion guard to sleep deletes before targeted enqueueing', async () => {
        hoisted.getAll.mockResolvedValueOnce([
            { exists: false, data: () => undefined },
            { exists: false, data: () => undefined },
        ]);

        await (onDashboardDerivedMetricsSleepWrite as any)({
            params: { uid: 'user-1', sleepSessionId: 'sleep-1' },
            data: {
                before: { exists: true },
                after: { exists: false },
            },
        });

        expect(hoisted.getAll).toHaveBeenCalledTimes(1);
        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });

    it('skips ingress when a deletion tombstone is active', async () => {
        hoisted.getAll.mockResolvedValueOnce([
            { exists: true, data: () => ({}) },
            { exists: true, data: () => ({ expireAt: { toMillis: () => Date.now() + 60_000 } }) },
        ]);

        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: true },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).not.toHaveBeenCalled();
    });
});
