import { describe, expect, it } from 'vitest';
import {
    buildEmailPlanDetails,
    calculateGracePeriodEnd,
    formatEmailDate,
    formatGracePeriodEnd,
} from './config';

describe('email config', () => {
    it.each([
        ['free', 'Up to 100 activities', 'Up to 10 saved routes', '20 AI Insights requests per calendar month', ''],
        ['basic', 'Up to 1,000 activities', 'Up to 100 saved routes', '50 AI Insights requests per billing period', ''],
        ['pro', 'Unlimited activities', 'Unlimited saved routes', '100 AI Insights requests per billing period', 'Device sync with Garmin, Suunto, and COROS'],
    ])('builds centralized plan descriptions for %s', (role, activities, routes, aiInsights, deviceSync) => {
        expect(buildEmailPlanDetails(role)).toEqual({
            plan_details_available: true,
            activity_description: activities,
            route_description: routes,
            ai_insights_description: aiInsights,
            device_sync_description: deviceSync,
        });
    });

    it('hides plan descriptions for unknown roles', () => {
        expect(buildEmailPlanDetails('unknown')).toEqual({
            plan_details_available: false,
            activity_description: '',
            route_description: '',
            ai_insights_description: '',
            device_sync_description: '',
        });
    });

    it('formats dates consistently in UTC and calculates the 30-day grace end', () => {
        const expiration = new Date('2026-01-15T23:30:00.000Z');

        expect(formatEmailDate(expiration)).toBe('15 January 2026');
        expect(calculateGracePeriodEnd(expiration).toISOString()).toBe('2026-02-14T23:30:00.000Z');
        expect(formatGracePeriodEnd(expiration)).toBe('14 February 2026');
    });
});
