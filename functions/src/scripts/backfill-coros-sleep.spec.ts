import { describe, expect, it } from 'vitest';
import {
    createCorosSleepBackfillQueueInput,
    parseCorosSleepBackfillOptions,
    resolveCorosSleepBackfillRange,
} from './backfill-coros-sleep';
import { getCorosSleepBackfillStartMs } from '../../../shared/sleep-backfill';

describe('backfill-coros-sleep', () => {
    it('requires an explicit confirmation before globally writing sleep backfill queue items', () => {
        expect(() => parseCorosSleepBackfillOptions(['--execute']))
            .toThrow('Global execution requires --confirm-all-users');
        expect(parseCorosSleepBackfillOptions(['--execute', '--confirm-all-users']).execute).toBe(true);
    });

    it('accepts a scoped write without a global confirmation', () => {
        expect(parseCorosSleepBackfillOptions(['--execute', '--uid', 'user-1'])).toMatchObject({
            execute: true,
            userID: 'user-1',
        });
    });

    it('clamps the range to the documented three-month COROS lookback', () => {
        const nowMs = Date.UTC(2026, 6, 24, 12, 0, 0);
        const range = resolveCorosSleepBackfillRange({
            startMs: Date.UTC(2025, 0, 1),
            endMs: Date.UTC(2026, 6, 30),
        }, nowMs);

        expect(range).toEqual({
            startMs: Date.UTC(2026, 3, 24, 12, 0, 0),
            endMs: nowMs,
            clampedToProviderLookback: true,
        });
    });

    it('uses calendar-month lookback without overflowing shorter months', () => {
        expect(getCorosSleepBackfillStartMs(Date.UTC(2026, 4, 31, 12, 0, 0)))
            .toBe(Date.UTC(2026, 1, 28, 12, 0, 0));
    });

    it('accepts a single inclusive provider calendar date', () => {
        const selectedDayMs = Date.UTC(2026, 6, 24);

        expect(resolveCorosSleepBackfillRange({
            startMs: selectedDayMs,
            endMs: selectedDayMs,
        }, Date.UTC(2026, 6, 24, 12))).toEqual({
            startMs: selectedDayMs,
            endMs: selectedDayMs,
            clampedToProviderLookback: false,
        });
    });

    it('queues bulk backfill work for the deployed reconciliation dispatcher', () => {
        expect(createCorosSleepBackfillQueueInput(
            { userID: 'user-1', providerUserID: 'coros-user-1' },
            { startMs: 1_777_000_000_000, endMs: 1_777_086_400_000 },
        )).toEqual({
            type: 'coros_poll',
            provider: 'COROSAPI',
            userID: 'user-1',
            providerUserId: 'coros-user-1',
            rangeStartMs: 1_777_000_000_000,
            rangeEndMs: 1_777_086_400_000,
            dedupeKey: 'coros-daily-health-backfill-v1:user-1:coros-user-1:1777000000000:1777086400000',
        });
    });
});
