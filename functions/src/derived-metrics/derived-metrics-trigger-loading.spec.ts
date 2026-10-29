import { describe, expect, it, vi } from 'vitest';

const lazy = vi.hoisted(() => ({ loaded: vi.fn(), handle: vi.fn().mockResolvedValue(undefined),
    guard: vi.fn().mockResolvedValue({ shouldSkip: true, userExists: false, deletionInProgress: true }) }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_options: unknown, handler: unknown) => handler }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardState: lazy.guard }));
vi.mock('./derived-metrics-source-handler', () => {
    lazy.loaded();
    return { handleDerivedMetricsSourceWrite: lazy.handle };
});
import { onDashboardDerivedMetricsActivityWrite, onDashboardDerivedMetricsEventWrite, onDashboardDerivedMetricsHealthWrite,
    onDashboardDerivedMetricsSleepWrite, onTrainingLoadMetadataWrite } from './derived-metrics.trigger';

const write = (before: unknown, after: unknown) => ({ params: { uid: 'owner', eventId: 'workout' }, data: {
    before: { exists: before !== undefined, data: () => before },
    after: { exists: after !== undefined, data: () => after },
} });

describe('lazy derived source triggers', () => {
    it('does not load the handler for empty, irrelevant or preparation-only deliveries', async () => {
        await (onDashboardDerivedMetricsEventWrite as unknown as (event: unknown) => Promise<void>)({ params: {} });
        await (onDashboardDerivedMetricsEventWrite as unknown as (event: unknown) => Promise<void>)(write(undefined, undefined));
        await (onDashboardDerivedMetricsEventWrite as unknown as (event: unknown) => Promise<void>)(write({ stats: { Distance: 100 } },
            { stats: { Distance: 100 }, updatedAt: 2 }));
        await (onTrainingLoadMetadataWrite as unknown as (event: unknown) => Promise<void>)(write(undefined, { sourceWritePending: true, controls: {} }));
        const saved = { version: 1, excluded: false, controls: {}, legs: {}, sourceRevision: 2, loadRevision: 2 };
        await (onTrainingLoadMetadataWrite as unknown as (event: unknown) => Promise<void>)(write(saved, { ...saved, sourceWritePending: true, revision: 8 }));
        await (onDashboardDerivedMetricsHealthWrite as unknown as (event: unknown) => Promise<void>)(write(undefined, { metricIds: ['steps'] }));
        await (onDashboardDerivedMetricsHealthWrite as unknown as (event: unknown) => Promise<void>)(write({ metricIds: ['steps'] }, undefined));
        expect(lazy.loaded).not.toHaveBeenCalled();
        expect(lazy.handle).not.toHaveBeenCalled();
        expect(lazy.guard).not.toHaveBeenCalled();
    });

    it.each([onDashboardDerivedMetricsEventWrite, onDashboardDerivedMetricsActivityWrite, onTrainingLoadMetadataWrite,
        onDashboardDerivedMetricsSleepWrite, onDashboardDerivedMetricsHealthWrite])(
        'does not load the handler for account-cleanup deletions', async handler => {
            await (handler as unknown as (event: unknown) => Promise<void>)(write({ metricIds: ['body_weight'] }, undefined));
            expect(lazy.loaded).not.toHaveBeenCalled();
            expect(lazy.handle).not.toHaveBeenCalled();
        });

    it('propagates deletion lookup failures for retry without loading the handler', async () => {
        const failure = new Error('deletion state unavailable');
        lazy.guard.mockRejectedValueOnce(failure);
        await expect((onDashboardDerivedMetricsEventWrite as unknown as (event: unknown) => Promise<void>)(write({}, undefined)))
            .rejects.toBe(failure);
        expect(lazy.loaded).not.toHaveBeenCalled();
        expect(lazy.handle).not.toHaveBeenCalled();
    });

    it('awaits lazy handling of owner edits during preparation and finalization, including failures', async () => {
        const before = { sourceWritePending: true, excluded: false, controls: {}, sourceRevision: 1 };
        const exclusion = write(before, { ...before, excluded: true });
        await (onTrainingLoadMetadataWrite as unknown as (event: unknown) => Promise<void>)(exclusion);
        expect(lazy.handle).toHaveBeenLastCalledWith(exclusion, 'training-load');
        const completed = write(before, { ...before, sourceWritePending: false, sourceRevision: 2 });
        const failure = new Error('cache unavailable');
        lazy.handle.mockRejectedValueOnce(failure);
        await expect((onTrainingLoadMetadataWrite as unknown as (event: unknown) => Promise<void>)(completed)).rejects.toBe(failure);
        expect(lazy.loaded).toHaveBeenCalledTimes(1);
        expect(lazy.handle).toHaveBeenLastCalledWith(completed, 'training-load');
    });
});
