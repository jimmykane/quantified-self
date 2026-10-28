import { describe, expect, it } from 'vitest';
import { buildAdminHistoryAxisBounds } from './admin-history-axis.helper';

describe('admin history axis bounds', () => {
    it('makes small changes around a large user total visible without clipping them', () => {
        const axis = buildAdminHistoryAxisBounds([[1980, 1990, null, 2010, 2020]], 'auto');
        expect(axis.min).toBeGreaterThan(1900);
        expect(axis.min).toBeLessThan(1980);
        expect(axis.max).toBeGreaterThan(2020);
        expect(axis.max - axis.min).toBeLessThan(100);
        expect(Number.isInteger(axis.interval)).toBe(true);
    });

    it('fits the selected cohorts instead of retaining the bounds of a hidden large cohort', () => {
        const all = buildAdminHistoryAxisBounds([[1900, 2000], [75, 80]], 'auto');
        const paidOnly = buildAdminHistoryAxisBounds([[75, 80]], 'auto');
        expect(all.max).toBeGreaterThan(2000);
        expect(paidOnly.min).toBeGreaterThan(0);
        expect(paidOnly.max - paidOnly.min).toBeLessThan(20);
    });

    it('supports a zero baseline with headroom', () => {
        const axis = buildAdminHistoryAxisBounds([[1980, 2020]], 'zero');
        expect(axis.min).toBe(0);
        expect(axis.max).toBeGreaterThan(2020);
    });

    it.each([0, 1, 2000])('keeps a constant count of %i readable', count => {
        const axis = buildAdminHistoryAxisBounds([[count, count, null]], 'auto');
        expect(axis.min).toBeGreaterThanOrEqual(0);
        expect(axis.min).toBeLessThanOrEqual(count);
        expect(axis.max).toBeGreaterThan(count);
        expect(axis.interval).toBeGreaterThanOrEqual(1);
        expect(axis.max - axis.min).toBeLessThanOrEqual(4);
    });

    it('ignores gaps and invalid values without treating them as zero counts', () => {
        const axis = buildAdminHistoryAxisBounds([[null, NaN, Infinity, -1, 500, 502]], 'auto');
        expect(axis.min).toBeGreaterThan(490);
        expect(buildAdminHistoryAxisBounds([[null, NaN, Infinity]], 'auto'))
            .toEqual({ min: 0, max: 1, interval: 1 });
    });
});
