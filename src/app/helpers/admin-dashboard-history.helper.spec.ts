import { describe, expect, it } from 'vitest';
import type { AdminDashboardHistoryPoint, AdminDashboardHistoryResponse } from '../services/admin.service';
import {
    ADMIN_DASHBOARD_HISTORY_MINIMUM_POINTS,
    buildAdminDashboardHistoryView,
} from './admin-dashboard-history.helper';

function point(date: string, overrides: Partial<AdminDashboardHistoryPoint> = {}): AdminDashboardHistoryPoint {
    return {
        date,
        computedAt: `${date}T00:12:00.000Z`,
        users: { total: 10, free: 5, basic: 3, pro: 2, onboardingCompleted: 7 },
        authActivity: { eligibleAccounts: 9, last24Hours: 2, last7Days: 5, last30Days: 8 },
        subscriptionCadence: {
            pro: { monthly: 1, yearly: 1, unknown: 0 },
            basic: { monthly: 2, yearly: 1, unknown: 0 },
        },
        ...overrides,
    };
}

function history(snapshots: AdminDashboardHistoryPoint[]): AdminDashboardHistoryResponse {
    return {
        days: 365,
        startDate: '2025-08-28',
        endDate: '2026-08-27',
        snapshots,
    };
}

describe('admin dashboard history helper', () => {
    it('filters locally and represents only internal missing dates as chart gaps', () => {
        const view = buildAdminDashboardHistoryView(history([
            point('2026-07-01'),
            point('2026-08-25'),
            point('2026-08-27'),
        ]), 30, Date.parse('2026-08-27T12:00:00.000Z'));

        expect(view.observed.map(snapshot => snapshot.date)).toEqual(['2026-08-25', '2026-08-27']);
        expect(view.timeline.map(item => [item.date, item.snapshot?.date ?? null])).toEqual([
            ['2026-08-25', '2026-08-25'],
            ['2026-08-26', null],
            ['2026-08-27', '2026-08-27'],
        ]);
        expect(view.missingDays).toBe(1);
    });

    it('marks the latest snapshot stale after 36 hours', () => {
        const snapshots = [point('2026-08-25')];

        expect(buildAdminDashboardHistoryView(
            history(snapshots),
            90,
            Date.parse('2026-08-26T12:11:59.000Z'),
        ).isStale).toBe(false);
        expect(buildAdminDashboardHistoryView(
            history(snapshots),
            90,
            Date.parse('2026-08-26T12:12:01.000Z'),
        ).isStale).toBe(true);
    });

    it('reports available points and unknown cadence for startup-state decisions', () => {
        const snapshots = Array.from({ length: ADMIN_DASHBOARD_HISTORY_MINIMUM_POINTS - 1 }, (_, index) => (
            point(`2026-08-${String(20 + index).padStart(2, '0')}`, index === 3 ? {
                subscriptionCadence: {
                    pro: { monthly: 1, yearly: 0, unknown: 1 },
                    basic: { monthly: 2, yearly: 1, unknown: 0 },
                },
            } : {})
        ));

        const view = buildAdminDashboardHistoryView(history(snapshots), 90);

        expect(view.availablePoints).toBe(7);
        expect(view.hasUnknownCadence).toBe(true);
    });

    it('returns an empty view when no selected-range snapshots exist', () => {
        const view = buildAdminDashboardHistoryView(history([point('2026-01-01')]), 30);

        expect(view).toMatchObject({ availablePoints: 0, missingDays: 0, latestSnapshot: null });
        expect(view.timeline).toEqual([]);
    });
});
