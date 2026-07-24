import { describe, expect, it } from 'vitest';
import type { MaintenanceStatus, QueueStats, UserCountStats } from '../services/admin.service';
import type { ChangelogPost } from '../services/app.whats-new.service';
import {
    buildAdminDashboardChangelogSummary,
    buildAdminDashboardHealthSummary,
    buildAdminDashboardMaintenanceCards,
    buildAdminDashboardQueueRows,
    buildAdminDashboardUserKpiCards,
    formatAdminDashboardDuration,
} from './admin-dashboard-summary.helper';

describe('admin-dashboard-summary helper', () => {
    it('builds user KPI cards from stats and trend totals', () => {
        const stats: UserCountStats = {
            total: 120,
            pro: 30,
            basic: 25,
            free: 65,
            monthlyPaid: 40,
            yearlyPaid: 15,
            everPaid: 70,
            canceled: 15,
            cancelScheduled: 3,
            onboardingCompleted: 90,
            providers: {},
            events: { total: 1_250, computedAt: '2026-06-01T10:00:00.000Z' },
            routes: { total: 42 },
        };

        const cards = buildAdminDashboardUserKpiCards(
            stats,
            {
                months: 12,
                buckets: [],
                totals: { registeredUsers: 18, onboardedUsers: 12 },
            },
            {
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
            }
        );

        expect(cards.find(card => card.id === 'total-users')?.value).toBe(120);
        expect(cards.find(card => card.id === 'events')?.valueKind).toBe('compact');
        expect(cards.find(card => card.id === 'growth-12m')?.subtitle).toBe('12 onboarded');
        expect(cards.find(card => card.id === 'subscription-net-12m')?.value).toBe(6);
        expect(cards.find(card => card.id === 'scheduled-cancel')?.severity).toBe('warning');
    });

    it('keeps trend KPI cards present when trend totals are malformed', () => {
        const stats: UserCountStats = {
            total: 2,
            pro: 1,
            basic: 0,
            free: 1,
            monthlyPaid: 1,
            yearlyPaid: 0,
            everPaid: 1,
            canceled: 0,
            cancelScheduled: 0,
            onboardingCompleted: 1,
            providers: {},
            events: { total: 0 },
            routes: { total: 0 },
        };

        const cards = buildAdminDashboardUserKpiCards(stats, {} as any, { totals: { net: Number.NaN } } as any);

        expect(cards.find(card => card.id === 'growth-12m')?.value).toBeNull();
        expect(cards.find(card => card.id === 'subscription-net-12m')?.value).toBeNull();
    });

    it('normalizes malformed KPI counts and financial summary numbers', () => {
        const stats = {
            total: Number.NaN,
            pro: 1,
            basic: 0,
            free: 1,
            monthlyPaid: 1,
            yearlyPaid: 0,
            everPaid: 1,
            canceled: Number.NaN,
            cancelScheduled: 2,
            onboardingCompleted: 1,
            providers: {},
            events: { total: Number.NaN },
            routes: { total: 5 },
        } as UserCountStats;

        const cards = buildAdminDashboardUserKpiCards(stats, null, null);
        const summary = buildAdminDashboardHealthSummary(
            [],
            [],
            { total: 0, published: 0, drafts: 0, latestTitle: null, latestDate: null },
            { revenue: { total: 0, currency: 'usd', invoiceCount: Number.NaN }, cost: { billingAccountId: null, projectId: 'p', reportUrl: null, currency: 'usd', total: null, budget: null } }
        );

        expect(cards.find(card => card.id === 'total-users')?.value).toBeNull();
        expect(cards.find(card => card.id === 'events')?.value).toBeNull();
        expect(cards.find(card => card.id === 'canceled')?.severity).toBeUndefined();
        expect(cards.find(card => card.id === 'scheduled-cancel')?.severity).toBe('warning');
        expect(summary.revenueInvoiceCount).toBeNull();
    });

    it('builds compact queue rows for every admin queue', () => {
        const stats: QueueStats = {
            pending: 2,
            succeeded: 10,
            stuck: 0,
            providers: [
                { name: 'Garmin', pending: 2, succeeded: 5, stuck: 0, dead: 0 },
            ],
            dlq: { total: 1, byContext: [], byProvider: [] },
            cloudTasks: {
                pending: 16,
                queues: {
                    workout: { queueId: 'workout', pending: 3 },
                    activitySync: { queueId: 'activity', pending: 0 },
                    routeDeliverySync: { queueId: 'delivery', pending: 1 },
                    routeSync: { queueId: 'route', pending: 0 },
                    sleepSync: { queueId: 'sleep', pending: 2 },
                    sportsLibReparse: { queueId: 'reparse', pending: 4, state: 'PAUSED', enabled: false },
                    sportsLibReparseHeavy: { queueId: 'heavy', pending: 1, state: 'RUNNING', enabled: true },
                    sportsLibRouteReparse: { queueId: 'route-reparse', pending: 0, state: 'DISABLED', enabled: false },
                    derivedMetricsIngress: { queueId: 'derived-ingress', pending: 2 },
                    derivedMetrics: { queueId: 'derived', pending: 3 },
                },
            },
            advanced: {
                throughput: 6,
                maxLagMs: 65_000,
                retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 },
                topErrors: [],
            },
            activitySync: {
                pending: 0,
                succeeded: 20,
                stuck: 0,
                dead: 0,
                dlqByContext: [],
                advanced: { throughput: 7, maxLagMs: 0, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
            },
            routeDeliverySync: {
                pending: 1,
                succeeded: 12,
                skipped: 5,
                stuck: 0,
                dead: 0,
                dlqByContext: [],
                advanced: { throughput: 3, maxLagMs: 1_000, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
            },
            routeSync: {
                pending: 0,
                succeeded: 8,
                skipped: 2,
                stuck: 0,
                dead: 0,
                dlqByContext: [],
                advanced: { throughput: 2, maxLagMs: 0, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
            },
            sleepSync: {
                pending: 2,
                succeeded: 30,
                providerDisabled: 1,
                disabledProviders: ['Garmin'],
                providers: [],
                stuck: 0,
                dead: 0,
                dlqByContext: [],
                advanced: { throughput: 5, maxLagMs: 5_000, retryHistogram: { '0-3': 0, '4-7': 0, '8-9': 0 }, topErrors: [] },
            },
            reparse: {
                automaticScanEnabled: false,
                queuePending: 0,
                targetSportsLibVersion: '9.1.5',
                jobs: { total: 20, pending: 6, processing: 2, completed: 12, failed: 1 },
                checkpoint: {
                    cursorEventPath: null,
                    lastScanAt: null,
                    lastPassStartedAt: null,
                    lastPassCompletedAt: null,
                    lastScanCount: 0,
                    lastEnqueuedCount: 0,
                    overrideUsersInProgress: 0,
                },
                recentFailures: [],
            },
            routeReparse: {
                automaticScanEnabled: false,
                queuePending: 2,
                targetSportsLibVersion: '9.1.5',
                jobs: { total: 10, pending: 7, processing: 0, completed: 8, skipped: 2, failed: 0 },
                checkpoint: {
                    cursorProcessingDocPath: null,
                    cursorProcessingVersionCode: null,
                    lastScanAt: null,
                    lastPassStartedAt: null,
                    lastPassCompletedAt: null,
                    lastScanCount: 0,
                    lastEnqueuedCount: 0,
                    overrideUsersInProgress: 0,
                },
                recentFailures: [],
            },
            derivedMetrics: {
                coordinators: { idle: 4, queued: 1, processing: 1, staleQueued: 0, staleProcessing: 1, failed: 0, total: 7 },
                recentFailures: [],
            },
        };

        const rows = buildAdminDashboardQueueRows(stats);

        expect(rows.map(row => row.id)).toEqual([
            'workout',
            'activity-sync',
            'route-delivery-sync',
            'route-sync',
            'sleep-sync',
            'reparse',
            'route-reparse',
            'derived-metrics',
        ]);
        expect(rows.find(row => row.id === 'workout')?.severity).toBe('error');
        expect(rows.find(row => row.id === 'route-delivery-sync')?.severity).toBe('ok');
        expect(rows.find(row => row.id === 'route-sync')?.maxLagLabel).toBe('0s');
        expect(rows.find(row => row.id === 'derived-metrics')?.maxLagLabel).toBe('-');
        expect(rows.find(row => row.id === 'reparse')?.pendingDb).toBe(6);
        expect(rows.find(row => row.id === 'reparse')?.cloudTasks).toBe(5);
        expect(rows.find(row => row.id === 'reparse')?.chips).toEqual([
            'Automatic scan: disabled',
            'Normal Cloud Tasks: paused',
            'Heavy Cloud Tasks: running',
            'Target 9.1.5',
        ]);
        expect(rows.find(row => row.id === 'route-reparse')?.pendingDb).toBe(7);
        expect(rows.find(row => row.id === 'route-reparse')?.cloudTasks).toBe(0);
        expect(rows.find(row => row.id === 'route-reparse')?.chips).toEqual(expect.arrayContaining([
            'Automatic scan: disabled',
            'Cloud Tasks: disabled',
        ]));
        expect(rows.find(row => row.id === 'route-reparse')?.severity).toBe('disabled');
        expect(rows.find(row => row.id === 'sleep-sync')?.chips).toContain('Disabled: Garmin');
        expect(rows.find(row => row.id === 'derived-metrics')?.cloudTasks).toBe(5);
        expect(rows.find(row => row.id === 'derived-metrics')?.chips).toEqual([
            'Ingress tasks: 2',
            'Worker tasks: 3',
            'Processing: 1',
            'Total: 7',
        ]);
        expect(rows.find(row => row.id === 'derived-metrics')?.problemLabel).toBe('Stale');
    });

    it('builds maintenance and changelog summaries', () => {
        const maintenanceCards = buildAdminDashboardMaintenanceCards({
            prod: { enabled: false, message: '' },
            beta: { enabled: true, message: 'Deploying' },
            dev: { enabled: false, message: '' },
        });
        const changelogSummary = buildAdminDashboardChangelogSummary([
            { id: 'old', title: 'Old', description: '', date: new Date('2026-01-01T00:00:00Z'), published: true, type: 'minor' },
            { id: 'new', title: 'New Draft', description: '', date: new Date('2026-02-01T00:00:00Z'), published: false, type: 'patch' },
        ] as ChangelogPost[]);

        expect(maintenanceCards.find(card => card.id === 'beta')?.severity).toBe('error');
        expect(changelogSummary).toMatchObject({
            total: 2,
            published: 1,
            drafts: 1,
            latestTitle: 'Old',
        });
    });

    it('does not treat drafts as the latest published release', () => {
        const changelogSummary = buildAdminDashboardChangelogSummary([
            { id: 'draft', title: 'Upcoming Draft', description: '', date: new Date('2026-03-01T00:00:00Z'), published: false, type: 'patch' },
        ] as ChangelogPost[]);

        expect(changelogSummary).toMatchObject({
            total: 1,
            published: 0,
            drafts: 1,
            latestTitle: null,
            latestDate: null,
        });
    });

    it('keeps partial maintenance payloads and invalid count timestamps presentable', () => {
        const maintenanceCards = buildAdminDashboardMaintenanceCards({
            prod: { enabled: true, message: 'Deploying' },
        } as unknown as MaintenanceStatus);
        const stats: UserCountStats = {
            total: 1,
            pro: 0,
            basic: 0,
            free: 1,
            monthlyPaid: 0,
            yearlyPaid: 0,
            everPaid: 0,
            canceled: 0,
            cancelScheduled: 0,
            onboardingCompleted: 0,
            providers: {},
            events: { total: 10, computedAt: 'not-a-date' },
            routes: { total: 5, computedAt: '2026-06-01T10:00:00.000Z' },
        };

        expect(maintenanceCards.find(card => card.id === 'prod')?.severity).toBe('error');
        expect(maintenanceCards.find(card => card.id === 'beta')?.value).toBe('Unknown');
        expect(maintenanceCards.find(card => card.id === 'beta')?.severity).toBe('warning');
        expect(buildAdminDashboardUserKpiCards(stats, null, null).find(card => card.id === 'events')?.subtitle).toBeUndefined();
    });

    it('builds health summary and formats durations', () => {
        const maintenanceCards = buildAdminDashboardMaintenanceCards({
            prod: { enabled: true, message: 'Maintenance' },
            beta: { enabled: false, message: '' },
            dev: { enabled: false, message: '' },
        });
        const queueRows = buildAdminDashboardQueueRows({
            pending: 0,
            succeeded: 1,
            stuck: 0,
            providers: [],
            cloudTasks: { pending: 0, queues: {} },
        });
        const summary = buildAdminDashboardHealthSummary(
            queueRows,
            maintenanceCards,
            { total: 3, published: 2, drafts: 1, latestTitle: null, latestDate: null },
            { revenue: { total: 100, currency: 'usd', invoiceCount: 4 }, cost: { billingAccountId: null, projectId: 'p', reportUrl: null, currency: 'usd', total: null, budget: null } }
        );

        expect(summary.maintenanceIssues).toBe(1);
        expect(summary.maintenanceWarnings).toBe(0);
        expect(summary.draftChangelogs).toBe(1);
        expect(summary.revenueInvoiceCount).toBe(4);
        expect(formatAdminDashboardDuration(3_661_000)).toBe('1h 1m');
    });

    it('separates queue warnings from queue errors in health summary', () => {
        const summary = buildAdminDashboardHealthSummary(
            [
                {
                    id: 'warning',
                    label: 'Warning',
                    icon: 'warning',
                    route: '/warning',
                    pendingDb: 1,
                    cloudTasks: 0,
                    completed: 0,
                    completedLabel: 'Completed',
                    problemCount: 0,
                    problemLabel: 'Stuck',
                    dead: 0,
                    deadLabel: 'Dead',
                    throughput: null,
                    maxLagMs: null,
                    maxLagLabel: '0s',
                    chips: [],
                    severity: 'warning',
                },
                {
                    id: 'error',
                    label: 'Error',
                    icon: 'error',
                    route: '/error',
                    pendingDb: 0,
                    cloudTasks: 0,
                    completed: 0,
                    completedLabel: 'Completed',
                    problemCount: 1,
                    problemLabel: 'Failed',
                    dead: 0,
                    deadLabel: 'Dead',
                    throughput: null,
                    maxLagMs: null,
                    maxLagLabel: '0s',
                    chips: [],
                    severity: 'error',
                },
            ],
            [],
            { total: 0, published: 0, drafts: 0, latestTitle: null, latestDate: null },
            null
        );

        expect(summary.queueIssues).toBe(2);
        expect(summary.queueWarnings).toBe(1);
        expect(summary.queueErrors).toBe(1);
    });

    it('includes provider stuck and dead counts in workout queue chips', () => {
        const rows = buildAdminDashboardQueueRows({
            pending: 0,
            succeeded: 1,
            stuck: 2,
            providers: [
                { name: 'Garmin', pending: 0, succeeded: 1, stuck: 2, dead: 1 },
                { name: 'Suunto', pending: 3, succeeded: 0, stuck: 0, dead: 0 },
            ],
            cloudTasks: { pending: 0, queues: {} },
        });

        expect(rows.find(row => row.id === 'workout')?.chips).toEqual([
            'Garmin: 2 stuck, 1 dead',
            'Suunto: 3 pending',
        ]);
    });
});
