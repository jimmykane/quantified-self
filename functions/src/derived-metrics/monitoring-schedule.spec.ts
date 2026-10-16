import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ register: vi.fn((_options, handler) => handler), observe: vi.fn(), db: {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: mocks.register }));
vi.mock('firebase-admin', () => ({ firestore: () => mocks.db }));
vi.mock('./monitoring-probe', () => ({ observeDerivedMetricsQueue: mocks.observe }));
import { observeDerivedMetricsHealth } from './monitoring-schedule';
describe('isolated quarter-hour derived metrics observer', () => {
    it('uses Gen 2 schedule registration with fixed resource limits and no secret bindings', async () => {
        expect(mocks.register).toHaveBeenCalledWith({ schedule: '*/15 * * * *', timeZone: 'UTC', region: 'europe-west2',
            memory: '512MiB', timeoutSeconds: 60, maxInstances: 1 }, expect.any(Function));
        await (observeDerivedMetricsHealth as unknown as () => Promise<void>)();
        expect(mocks.observe).toHaveBeenCalledExactlyOnceWith(mocks.db);
    });
});
