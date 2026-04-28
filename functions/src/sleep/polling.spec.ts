import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { SLEEP_SYNC_DISABLED_PROVIDERS_ENV } from './provider-flags';

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: vi.fn((_options: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
    firestore: vi.fn(() => ({
        collectionGroup: vi.fn(),
    })),
}));

vi.mock('./queue', () => ({
    addSleepSyncQueueItem: vi.fn(),
}));

import { sleepPollingTestInternals } from './polling';
import { addSleepSyncQueueItem } from './queue';

describe('sleep polling', () => {
    afterEach(() => {
        delete process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV];
        vi.clearAllMocks();
    });

    it('chunks recent polling windows by provider API maximum range', () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const nowMs = Date.UTC(2026, 3, 28);

        const windows = sleepPollingTestInternals.chunkRecentWindow(nowMs, 70, 30);

        expect(windows).toEqual([
            { startMs: nowMs - (70 * dayMs), endMs: nowMs - (40 * dayMs) },
            { startMs: nowMs - (40 * dayMs), endMs: nowMs - (10 * dayMs) },
            { startMs: nowMs - (10 * dayMs), endMs: nowMs },
        ]);
    });

    it('skips polling for disabled sleep providers', async () => {
        process.env[SLEEP_SYNC_DISABLED_PROVIDERS_ENV] = 'GarminAPI,COROSAPI';

        const queued = await sleepPollingTestInternals.enqueueProviderPolls(
            SLEEP_PROVIDERS.COROSAPI,
            ServiceNames.COROSAPI,
            30,
            Date.UTC(2026, 3, 28),
        );

        expect(queued).toBe(0);
        expect(addSleepSyncQueueItem).not.toHaveBeenCalled();
    });
});
