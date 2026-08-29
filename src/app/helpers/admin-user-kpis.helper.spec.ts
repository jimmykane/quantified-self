import { describe, expect, it } from 'vitest';
import type { UserCountStats } from '../services/admin.service';
import { buildAdminUserKpiCards } from './admin-user-kpis.helper';

function buildStats(overrides: Partial<UserCountStats> = {}): UserCountStats {
    return {
        total: 120,
        pro: 30,
        basic: 25,
        free: 65,
        monthlyPaid: 40,
        yearlyPaid: 14,
        subscriptionCadence: {
            pro: { monthly: 18, yearly: 11, unknown: 1 },
            basic: { monthly: 22, yearly: 3, unknown: 0 },
        },
        everPaid: 70,
        canceled: 15,
        cancelScheduled: 3,
        onboardingCompleted: 90,
        marketingConsent: 35,
        providers: {},
        events: { total: 1_250, computedAt: '2026-06-01T10:00:00.000Z' },
        routes: { total: 42 },
        connections: {
            serviceUsers: 48,
            mcpUsers: 12,
            both: 9,
            providers: { Garmin: 30, Suunto: 12, COROS: 8, Wahoo: 5 },
        },
        authActivity: {
            last24Hours: 12,
            last7Days: 40,
            last30Days: 50,
            computedAt: '2026-06-01T10:05:00.000Z',
        },
        ...overrides,
    };
}

const growthTrend = {
    months: 12,
    buckets: [],
    totals: { registeredUsers: 18, onboardedUsers: 12 },
};

const subscriptionTrend = {
    months: 12,
    buckets: [],
    totals: {
        newSubscriptions: 10,
        plannedCancellations: 4,
        net: 6,
        basicNewSubscriptions: 4,
        basicPlannedCancellations: 1,
        basicNet: 3,
        proNewSubscriptions: 6,
        proPlannedCancellations: 3,
        proNet: 3,
    },
};

describe('admin user KPI helper', () => {
    it('builds the exact curated dashboard profile', () => {
        const cards = buildAdminUserKpiCards('dashboard', buildStats(), growthTrend, subscriptionTrend);

        expect(cards.map(card => card.id)).toEqual([
            'active-24h', 'active-7d', 'active-30d', 'total-users', 'pro-users', 'basic-users',
            'onboarded-users', 'marketing-consent', 'any-connected-users', 'scheduled-cancel',
            'growth-12m', 'subscription-net-12m',
        ]);
    });

    it('builds the complete user analytics profile', () => {
        const cards = buildAdminUserKpiCards('full', buildStats(), growthTrend, subscriptionTrend);

        expect(cards).toHaveLength(21);
        expect(cards.find(card => card.id === 'active-7d')).toMatchObject({
            value: 40,
            subtitle: 'Sign-in or ID token refresh · 80% of 30-day active',
        });
        expect(cards.find(card => card.id === 'marketing-consent')).toMatchObject({
            value: 35,
            subtitle: 'Consent only · 29% of users',
        });
        expect(cards.find(card => card.id === 'service-connected-users')).toMatchObject({
            value: 48,
            subtitle: '40% of users · Garmin 30 · Suunto 12 · COROS 8 · Wahoo 5',
        });
        expect(cards.find(card => card.id === 'any-connected-users')).toMatchObject({ value: 51 });
        expect(cards.find(card => card.id === 'events')?.valueKind).toBe('compact');
        expect(cards.find(card => card.id === 'growth-12m')?.subtitle).toBe('12 onboarded');
        expect(cards.find(card => card.id === 'subscription-net-12m')?.value).toBe(6);
    });

    it('keeps optional cards stable when source data is unavailable', () => {
        const stats = buildStats({ authActivity: undefined, connections: undefined, marketingConsent: null });
        const cards = buildAdminUserKpiCards('full', stats, null, null);

        expect(cards).toHaveLength(21);
        expect(cards.find(card => card.id === 'active-24h')?.value).toBeNull();
        expect(cards.find(card => card.id === 'marketing-consent')).toMatchObject({
            value: null,
            subtitle: 'Unavailable',
        });
        expect(cards.find(card => card.id === 'service-connected-users')).toMatchObject({
            value: null,
            subtitle: 'Unavailable',
        });
        expect(cards.find(card => card.id === 'growth-12m')?.value).toBeNull();
        expect(cards.find(card => card.id === 'subscription-net-12m')?.value).toBeNull();
    });

    it('caps non-atomic shares and does not mark malformed values successful', () => {
        const stats = buildStats({
            total: 10,
            pro: Number.NaN,
            onboardingCompleted: Number.NaN,
            marketingConsent: 11,
            connections: {
                serviceUsers: null,
                mcpUsers: null,
                both: null,
                providers: {},
                cacheStatus: 'unavailable',
            },
        });
        const cards = buildAdminUserKpiCards('full', stats, null, null);

        expect(cards.find(card => card.id === 'marketing-consent')?.subtitle).toBe('Consent only · 100% of users');
        expect(cards.find(card => card.id === 'pro-users')).toMatchObject({ value: null, severity: undefined });
        expect(cards.find(card => card.id === 'onboarded-users')).toMatchObject({ value: null, severity: undefined });
        expect(cards.find(card => card.id === 'any-connected-users')).toMatchObject({
            value: null,
            severity: undefined,
            subtitle: 'Unavailable',
        });
    });
});
