import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../training-load/training-load-cache', async importOriginal => ({ ...await importOriginal<any>(), refreshTrainingLoadSummary: hoisted.refresh }));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: hoisted.onDocumentWritten,
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueDerivedMetricsIngressTask: hoisted.enqueueDerivedMetricsIngressTask,
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
        hoisted.usersDoc.mockReset();
        hoisted.usersDoc.mockReturnValue({ path: 'users/user-1' });
        hoisted.tombstonesDoc.mockReset();
        hoisted.tombstonesDoc.mockReturnValue({ path: 'userDeletionTombstones/user-1' });
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
            incrementEventMutationVersion: true, taskScope: 'training-load',
            metricKinds: expect.arrayContaining([DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.Acwr,
                DERIVED_METRIC_KINDS.TrainingSummary, DERIVED_METRIC_KINDS.TrainingBuildComparison]),
        }));
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

    it('does not read deletion state for an unrelated Health create', async () => {
        await (onDashboardDerivedMetricsHealthWrite as any)({ params: { uid: 'user-1' }, data: {
            before: { exists: false, data: () => undefined }, after: { exists: true, data: () => ({ metricIds: ['steps'] }) },
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
