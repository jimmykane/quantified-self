import { describe, expect, it } from 'vitest';
import {
    buildAdminAuthProviderChartOption,
    buildAdminUserGrowthChartOption,
    buildCumulativeSeriesFromEndingTotal,
    hasAdminAuthProviderData,
} from './admin-user-charts.helper';

const palette = {
    primary: '#1', tertiary: '#2', secondary: '#3', warning: '#4', neutral: '#5', onboarded: '#6', combined: '#7',
};

describe('admin user chart helpers', () => {
    it('builds provider data and responsive legend placement', () => {
        const option = buildAdminAuthProviderChartOption({ 'google.com': 4, password: 2 }, false, 500);
        const legend = option['legend'] as Record<string, unknown>;
        const series = option['series'] as Array<Record<string, unknown>>;

        expect(legend['orient']).toBe('horizontal');
        expect(series[0]['data']).toEqual([
            expect.objectContaining({ name: 'Google', value: 4 }),
            expect.objectContaining({ name: 'Email/Password', value: 2 }),
        ]);
    });

    it('filters empty and malformed provider counts from chart data', () => {
        const providers = { password: 0, 'google.com': Number.NaN, 'apple.com': -2, custom: 2.8 };
        const option = buildAdminAuthProviderChartOption(providers, false, 900);
        const series = option['series'] as Array<Record<string, unknown>>;

        expect(hasAdminAuthProviderData(providers)).toBe(true);
        expect(series[0]['data']).toEqual([
            expect.objectContaining({ name: 'custom', value: 2 }),
        ]);
        expect(hasAdminAuthProviderData({ password: 0, 'google.com': Number.NaN })).toBe(false);
    });

    it('reconstructs cumulative totals from the ending snapshot', () => {
        expect(buildCumulativeSeriesFromEndingTotal([2, -1, 3], 14)).toEqual([12, 11, 14]);
    });

    it('merges user and subscription months into one ordered chart', () => {
        const option = buildAdminUserGrowthChartOption(
            { months: 12, buckets: [{ key: '2026-02', label: 'Feb', registeredUsers: 3, onboardedUsers: 2 }], totals: { registeredUsers: 3, onboardedUsers: 2 } },
            { months: 12, buckets: [{ key: '2026-01', label: 'Jan', basicNet: 1, proNet: 2 }], totals: { net: 3 } },
            { registeredUsers: 20, onboardedUsers: 15, basicSubscriptions: 5, proSubscriptions: 7 },
            false,
            900,
            palette,
        );
        const xAxis = option['xAxis'] as Record<string, unknown>;
        const series = option['series'] as Array<Record<string, unknown>>;

        expect(xAxis['data']).toEqual(['Jan', 'Feb']);
        expect(series.map(item => item['name'])).toEqual([
            'Registered Users / month', 'Onboarded Users / month', 'Total Registered', 'Total Onboarded',
            'Basic Totals', 'Pro Totals', 'Totals (Pro+Basic)',
        ]);
    });

    it('preserves negative subscription net months when reconstructing totals', () => {
        const option = buildAdminUserGrowthChartOption(
            null,
            {
                months: 12,
                buckets: [
                    { key: '2026-01', label: 'Jan', basicNet: 2, proNet: 1 },
                    { key: '2026-02', label: 'Feb', basicNet: -1, proNet: -2 },
                ],
                totals: { net: 0 },
            },
            { registeredUsers: 0, onboardedUsers: 0, basicSubscriptions: 5, proSubscriptions: 4 },
            false,
            900,
            palette,
        );
        const series = option['series'] as Array<Record<string, unknown>>;

        expect(series.find(item => item['name'] === 'Basic Totals')?.['data']).toEqual([6, 5]);
        expect(series.find(item => item['name'] === 'Pro Totals')?.['data']).toEqual([6, 4]);
        expect(series.find(item => item['name'] === 'Totals (Pro+Basic)')?.['data']).toEqual([12, 9]);
    });
});
