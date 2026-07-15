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
}));

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
    onDashboardDerivedMetricsActivityWrite,
    onDashboardDerivedMetricsEventWrite,
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
        hoisted.firestore.mockReturnValue({
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

    it('configures retry-safe Firestore trigger options', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/events/{eventId}',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('configures the activity trigger on normalized flat activity documents', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/activities/{activityId}',
                retry: true,
            }),
            expect.any(Function),
        );
    });

    it('configures the sleep trigger on normalized sleep sessions', () => {
        expect(hoisted.onDocumentWritten).toHaveBeenCalledWith(
            expect.objectContaining({
                document: 'users/{uid}/sleepSessions/{sleepSessionId}',
                retry: true,
            }),
            expect.any(Function),
        );
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
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
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
