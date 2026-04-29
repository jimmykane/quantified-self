import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_opts: unknown, handler: any) => handler,
}));

const hoisted = vi.hoisted(() => ({
    enqueueDerivedMetricsIngressTask: vi.fn(),
}));

vi.mock('../shared/cloud-tasks', () => ({
    enqueueDerivedMetricsIngressTask: hoisted.enqueueDerivedMetricsIngressTask,
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
        vi.clearAllMocks();
        hoisted.enqueueDerivedMetricsIngressTask.mockResolvedValue(true);
    });

    it('enqueues a debounced ingress task for valid event writes', async () => {
        await (onDashboardDerivedMetricsEventWrite as any)({
            params: { uid: 'user-1', eventId: 'event-1' },
            data: {
                before: { exists: true },
                after: { exists: true },
            },
        });

        expect(hoisted.enqueueDerivedMetricsIngressTask).toHaveBeenCalledWith('user-1', 1);
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

