import { describe, expect, it } from 'vitest';
import {
    parseCorosSleepBackfillOptions,
    resolveCorosSleepBackfillRange,
} from './backfill-coros-sleep';

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
});
