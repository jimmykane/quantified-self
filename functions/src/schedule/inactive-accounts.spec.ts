import { beforeEach, describe, expect, it, vi } from 'vitest';
const { run, info, error } = vi.hoisted(() => ({ run: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../users/inactivity', () => ({ runInactivitySweep: run }));
vi.mock('firebase-functions/logger', () => ({ info, error }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (options: unknown, handler: () => Promise<void>) => Object.assign(handler, { options }) }));
import { processInactiveAccounts } from './inactive-accounts';
const handler = processInactiveAccounts as unknown as (() => Promise<void>) & { options: Record<string, unknown> };
describe('daily inactivity owner', () => {
    beforeEach(() => vi.clearAllMocks());
    it('pins daily execution, bounded concurrency and no automatic destructive retry', () => {
        expect(handler.options).toMatchObject({ schedule: 'every 24 hours', region: 'europe-west2', memory: '512MiB',
            timeoutSeconds: 540, concurrency: 1, maxInstances: 1, retryCount: 0 });
        expect((handler.options.secrets as { name: string }[]).map(secret => secret.name)).toEqual(['STRIPE_BILLING_KEY']);
    });
    it('emits an off heartbeat without implying any deletion', async () => {
        run.mockResolvedValue({ mode: 'off', outcome: 'off', counts: {}, scanned: 0, capped: false, overdue: 0, reviewRequired: 0 });
        await handler(); expect(info).toHaveBeenCalledWith('[AccountInactivity]', expect.objectContaining({ outcome: 'off', telemetryVersion: 1 }));
    });
    it('reports failure without leaking provider error contents', async () => {
        run.mockRejectedValue(new Error('PRIVATE_RECIPIENT@example.invalid'));
        await expect(handler()).rejects.toThrow('account_inactivity_failed');
        expect(error).toHaveBeenCalledExactlyOnceWith('[AccountInactivity]', { telemetryVersion: 1, outcome: 'failed' });
    });
});
