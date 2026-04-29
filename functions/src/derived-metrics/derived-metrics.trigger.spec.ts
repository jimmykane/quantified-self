import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
    onDocumentWritten: vi.fn((_opts: unknown, handler: any) => handler),
    enqueueDerivedMetricsIngressTask: vi.fn(),
    isDerivedMetricsUidAllowed: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: hoisted.onDocumentWritten,
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueDerivedMetricsIngressTask: hoisted.enqueueDerivedMetricsIngressTask,
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

import { onDashboardDerivedMetricsEventWrite } from './derived-metrics.trigger';

describe('onDashboardDerivedMetricsEventWrite', () => {
    beforeEach(() => {
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
});
