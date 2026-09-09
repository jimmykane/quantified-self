import { describe, expect, it } from 'vitest';
import { adminHistoryPercentage, formatAdminHistoryTooltipValue } from './admin-history-percentage.helper';
import { buildAdminHistoryAxisBounds } from './admin-history-axis.helper';

describe('admin history percentages', () => {
    it('retains precision and labels the actual population', () => {
        expect(adminHistoryPercentage(1, 3)).toBeCloseTo(33.333333);
        expect(formatAdminHistoryTooltipValue(1, 3, 'eligible Pro accounts', 'percentage')).toEqual({
            value: '33.3%', detail: '1 of 3 eligible Pro accounts',
        });
        expect(formatAdminHistoryTooltipValue(1, 3, 'eligible Pro accounts', 'count')).toEqual({
            value: '1 user', detail: '33.3% of 3 eligible Pro accounts',
        });
        expect(adminHistoryPercentage(0, 3)).toBe(0);
    });

    it.each([[0, 0], [1, undefined], [null, 5], [undefined, 5], [-1, 2], [3, 2], [1, NaN], [Infinity, 10]])(
        'leaves unavailable or invalid populations as gaps (%s / %s)', (count, total) => {
            expect(adminHistoryPercentage(count, total)).toBeNull();
        },
    );

    it('keeps empty and legacy populations visibly unavailable', () => {
        expect(formatAdminHistoryTooltipValue(0, 0, 'users', 'percentage')).toEqual({
            value: 'Unavailable', detail: '0 users · Percentage unavailable (0 users)',
        });
        expect(formatAdminHistoryTooltipValue(5, null, 'eligible accounts', 'count')).toEqual({
            value: '5 users', detail: 'Percentage unavailable (eligible accounts unavailable)',
        });
        expect(formatAdminHistoryTooltipValue(undefined, 5, 'users', 'count')).toEqual({ value: 'Unavailable' });
    });

    it('keeps large counts readable and zero active counts distinct from missing populations', () => {
        expect(formatAdminHistoryTooltipValue(1234, 2468, 'active accounts', 'count')).toEqual({
            value: '1,234 users', detail: '50% of 2,468 active accounts',
        });
        expect(formatAdminHistoryTooltipValue(0, 10, 'eligible Pro accounts', 'percentage')).toEqual({
            value: '0%', detail: '0 of 10 eligible Pro accounts',
        });
    });

    it('fits fractional percentages without going outside 0–100', () => {
        const axis = buildAdminHistoryAxisBounds([[0.12, 0.25, null]], 'auto', 'percentage');
        expect(axis.min).toBe(0);
        expect(axis.max).toBeLessThan(1);
        expect(axis.interval).toBeLessThan(1);
        expect(buildAdminHistoryAxisBounds([[99.9, 100]], 'auto', 'percentage').max).toBe(100);
        expect(buildAdminHistoryAxisBounds([[1, 2]], 'zero', 'percentage')).toEqual({ min: 0, max: 100, interval: 20 });
        expect(buildAdminHistoryAxisBounds([[null]], 'auto', 'percentage')).toEqual({ min: 0, max: 100, interval: 20 });
    });
});
