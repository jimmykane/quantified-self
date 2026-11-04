import { describe, expect, it, vi } from 'vitest';

vi.mock('./queue', () => ({ addSleepSyncQueueItem: vi.fn() }));
import { getCOROSPollWindow } from './coros-polling';

const hour = 60 * 60 * 1000;
const day = 24 * hour;
describe('COROS incremental polling dates', () => {
    const now = Date.UTC(2026, 10, 4, 12, 15);
    const end = Date.UTC(2026, 10, 4, 12);
    it('reconciles the existing seven-day window on the first poll', () => {
        expect(getCOROSPollWindow(now)).toEqual({ startMs: end - 7 * day, endMs: end, reconciliation: true });
    });
    it('normally requests yesterday and today, using a stable hourly end', () => {
        expect(getCOROSPollWindow(now, end - hour, end - 5 * hour)).toEqual({
            startMs: Date.UTC(2026, 10, 3), endMs: end, reconciliation: false,
        });
    });
    it('catches missed polls from the successful range with a calendar-day overlap', () => {
        expect(getCOROSPollWindow(now, end - 2 * day, end - hour)).toEqual({
            startMs: Date.UTC(2026, 10, 1), endMs: end, reconciliation: false,
        });
    });
    it('reconciles again only after a full day since successful reconciliation', () => {
        expect(getCOROSPollWindow(now, end - hour, end - day).reconciliation).toBe(true);
        expect(getCOROSPollWindow(now, end - hour, end - day + 1).reconciliation).toBe(false);
    });
    it.each([null, undefined, 0, NaN, '123', end + hour])('rejects an invalid successful watermark %s', watermark => {
        expect(getCOROSPollWindow(now, watermark, end - hour).reconciliation).toBe(true);
    });
    it('bounds outage recovery to the existing seven-day horizon', () => {
        expect(getCOROSPollWindow(now, end - 90 * day, end - hour).startMs).toBe(end - 7 * day);
    });
    it.each([Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 29), Date.UTC(2026, 9, 25)])(
        'retains the previous UTC date across year and DST boundaries at %s', date => {
            expect(getCOROSPollWindow(date, date - 1, date - hour)).toEqual({
                startMs: date - 2 * day, endMs: date, reconciliation: false,
            });
        },
    );
});
