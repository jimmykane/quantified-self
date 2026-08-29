import { describe, expect, it } from 'vitest';
import {
    buildAdminAuthProviderChartOption,
    buildAdminUserGrowthChartOption,
    buildCumulativeSeriesFromEndingTotal,
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
});
