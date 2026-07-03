import type {
    FinancialStats,
    MaintenanceStatus,
    QueueStats,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse
} from '../services/admin.service';
import type { ChangelogPost } from '../services/app.whats-new.service';
import { coerceChangelogPostDate } from '../services/app.whats-new.service';

export type AdminDashboardSeverity = 'ok' | 'warning' | 'error';
export type AdminDashboardValueKind = 'number' | 'compact' | 'text';

export interface AdminDashboardKpiCard {
    id: string;
    label: string;
    icon: string;
    value: number | string | null;
    valueKind: AdminDashboardValueKind;
    subtitle?: string;
    severity?: AdminDashboardSeverity;
}

export interface AdminDashboardQueueRow {
    id: string;
    label: string;
    icon: string;
    route: string;
    pendingDb: number;
    cloudTasks: number;
    completed: number;
    completedLabel: string;
    problemCount: number;
    problemLabel: string;
    dead: number;
    deadLabel: string;
    throughput: number | null;
    maxLagMs: number | null;
    maxLagLabel: string;
    chips: string[];
    severity: AdminDashboardSeverity;
}

export interface AdminDashboardMaintenanceCard {
    id: 'prod' | 'beta' | 'dev';
    label: string;
    icon: string;
    value: string;
    subtitle: string;
    severity: AdminDashboardSeverity;
}

export interface AdminDashboardChangelogSummary {
    total: number;
    published: number;
    drafts: number;
    latestTitle: string | null;
    latestDate: Date | null;
}

export interface AdminDashboardHealthSummary {
    queueIssues: number;
    queueWarnings: number;
    queueErrors: number;
    maintenanceIssues: number;
    maintenanceWarnings: number;
    draftChangelogs: number;
    revenueInvoiceCount: number | null;
}

interface QueueRowBase {
    id: string;
    label: string;
    icon: string;
    route: string;
    pendingDb?: number | null;
    cloudTasks?: number | null;
    completed?: number | null;
    completedLabel?: string;
    problemCount?: number | null;
    problemLabel?: string;
    dead?: number | null;
    deadLabel?: string;
    throughput?: number | null;
    maxLagMs?: number | null;
    chips?: string[];
}

const EMPTY_CHIPS: string[] = [];

export function buildAdminDashboardUserKpiCards(
    stats: UserCountStats | null,
    userGrowthTrend: UserGrowthTrendResponse | null,
    subscriptionHistoryTrend: SubscriptionHistoryTrendResponse | null
): AdminDashboardKpiCard[] {
    if (!stats) {
        return [];
    }

    const registeredGrowth = finiteNumber(userGrowthTrend?.totals?.registeredUsers);
    const onboardedGrowth = finiteNumber(userGrowthTrend?.totals?.onboardedUsers);
    const subscriptionNet = finiteNumber(subscriptionHistoryTrend?.totals?.net);
    const newSubscriptions = finiteNumber(subscriptionHistoryTrend?.totals?.newSubscriptions);
    const plannedCancellations = finiteNumber(subscriptionHistoryTrend?.totals?.plannedCancellations);

    const canceled = finiteNumber(stats.canceled);
    const cancelScheduled = finiteNumber(stats.cancelScheduled);

    return [
        numberCard('total-users', 'Total Users', 'people', stats.total),
        numberCard('pro-users', 'Pro Users', 'verified', stats.pro, 'ok'),
        numberCard('basic-users', 'Basic Users', 'person_outline', stats.basic),
        numberCard('free-users', 'Free Users', 'money_off', stats.free),
        numberCard('monthly-paid', 'Monthly Paid', 'calendar_view_month', stats.monthlyPaid),
        numberCard('yearly-paid', 'Yearly Paid', 'calendar_today', stats.yearlyPaid),
        numberCard('onboarded-users', 'Onboarded', 'how_to_reg', stats.onboardingCompleted, 'ok'),
        compactCard('events', 'Events', 'fitness_center', stats.events.total, countUpdatedSubtitle(stats.events.computedAt)),
        compactCard('routes', 'Routes', 'route', stats.routes.total, countUpdatedSubtitle(stats.routes.computedAt)),
        numberCard('ever-paid', 'Ever Paid', 'workspace_premium', stats.everPaid),
        numberCard('canceled', 'Canceled', 'cancel', canceled, (canceled ?? 0) > 0 ? 'warning' : undefined),
        numberCard('scheduled-cancel', 'Scheduled Cancels', 'event_busy', cancelScheduled, (cancelScheduled ?? 0) > 0 ? 'warning' : undefined),
        numberCard(
            'growth-12m',
            '12-Month Growth',
            'show_chart',
            registeredGrowth,
            undefined,
            onboardedGrowth !== null ? `${onboardedGrowth} onboarded` : undefined
        ),
        numberCard(
            'subscription-net-12m',
            'Subscription Net',
            'trending_up',
            subscriptionNet,
            subscriptionNet !== null && subscriptionNet < 0 ? 'warning' : undefined,
            newSubscriptions !== null && plannedCancellations !== null
                ? `${newSubscriptions} new / ${plannedCancellations} scheduled cancels`
                : undefined
        ),
    ];
}

export function buildAdminDashboardQueueRows(stats: QueueStats | null): AdminDashboardQueueRow[] {
    if (!stats) {
        return [];
    }

    const queues = stats.cloudTasks?.queues;
    const reparseCloudTasks = normalizeCount(queues?.sportsLibReparse?.pending) + normalizeCount(queues?.sportsLibReparseHeavy?.pending);
    const derivedCoordinators = stats.derivedMetrics?.coordinators;
    const staleDerived = normalizeCount(derivedCoordinators?.staleQueued) + normalizeCount(derivedCoordinators?.staleProcessing);

    return [
        buildQueueRow({
            id: 'workout',
            label: 'Workout',
            icon: 'fitness_center',
            route: '/admin/queues/workout',
            pendingDb: stats.pending,
            cloudTasks: queues?.workout?.pending,
            completed: stats.succeeded,
            completedLabel: 'Succeeded',
            problemCount: stats.stuck,
            problemLabel: 'Stuck',
            dead: stats.dlq?.total,
            deadLabel: 'DLQ',
            throughput: stats.advanced?.throughput,
            maxLagMs: stats.advanced?.maxLagMs,
            chips: providerChips(stats.providers),
        }),
        buildQueueRow({
            id: 'activity-sync',
            label: 'Activity Sync',
            icon: 'published_with_changes',
            route: '/admin/queues/activity-sync',
            pendingDb: stats.activitySync?.pending,
            cloudTasks: queues?.activitySync?.pending,
            completed: stats.activitySync?.succeeded,
            completedLabel: 'Succeeded',
            problemCount: stats.activitySync?.stuck,
            problemLabel: 'Stuck',
            dead: stats.activitySync?.dead,
            deadLabel: 'Dead',
            throughput: stats.activitySync?.advanced?.throughput,
            maxLagMs: stats.activitySync?.advanced?.maxLagMs,
        }),
        buildQueueRow({
            id: 'route-delivery-sync',
            label: 'Route Delivery',
            icon: 'directions',
            route: '/admin/queues/route-delivery-sync',
            pendingDb: stats.routeDeliverySync?.pending,
            cloudTasks: queues?.routeDeliverySync?.pending,
            completed: stats.routeDeliverySync?.succeeded,
            completedLabel: 'Delivered',
            problemCount: stats.routeDeliverySync?.stuck,
            problemLabel: 'Stuck',
            dead: stats.routeDeliverySync?.dead,
            deadLabel: 'Dead',
            throughput: stats.routeDeliverySync?.advanced?.throughput,
            maxLagMs: stats.routeDeliverySync?.advanced?.maxLagMs,
            chips: countChip('Skipped', stats.routeDeliverySync?.skipped),
        }),
        buildQueueRow({
            id: 'route-sync',
            label: 'Route Sync',
            icon: 'sync_alt',
            route: '/admin/queues/route-sync',
            pendingDb: stats.routeSync?.pending,
            cloudTasks: queues?.routeSync?.pending,
            completed: stats.routeSync?.succeeded,
            completedLabel: 'Succeeded',
            problemCount: stats.routeSync?.stuck,
            problemLabel: 'Stuck',
            dead: stats.routeSync?.dead,
            deadLabel: 'Dead',
            throughput: stats.routeSync?.advanced?.throughput,
            maxLagMs: stats.routeSync?.advanced?.maxLagMs,
            chips: countChip('Skipped', stats.routeSync?.skipped),
        }),
        buildQueueRow({
            id: 'sleep-sync',
            label: 'Sleep Sync',
            icon: 'hotel',
            route: '/admin/queues/sleep-sync',
            pendingDb: stats.sleepSync?.pending,
            cloudTasks: queues?.sleepSync?.pending,
            completed: stats.sleepSync?.succeeded,
            completedLabel: 'Succeeded',
            problemCount: stats.sleepSync?.stuck,
            problemLabel: 'Stuck',
            dead: stats.sleepSync?.dead,
            deadLabel: 'Dead',
            throughput: stats.sleepSync?.advanced?.throughput,
            maxLagMs: stats.sleepSync?.advanced?.maxLagMs,
            chips: [
                ...countChip('Provider disabled', stats.sleepSync?.providerDisabled),
                ...disabledProviderChips(stats.sleepSync?.disabledProviders),
            ],
        }),
        buildQueueRow({
            id: 'reparse',
            label: 'Event Reparse',
            icon: 'autorenew',
            route: '/admin/queues/reparse',
            pendingDb: stats.reparse?.queuePending ?? stats.reparse?.jobs.pending,
            cloudTasks: reparseCloudTasks,
            completed: stats.reparse?.jobs.completed,
            completedLabel: 'Completed',
            problemCount: stats.reparse?.jobs.failed,
            problemLabel: 'Failed',
            dead: 0,
            deadLabel: 'DLQ',
            chips: [
                ...countChip('Processing', stats.reparse?.jobs.processing),
                versionChip(stats.reparse?.targetSportsLibVersion),
            ],
        }),
        buildQueueRow({
            id: 'route-reparse',
            label: 'Route Reparse',
            icon: 'route',
            route: '/admin/queues/route-reparse',
            pendingDb: stats.routeReparse?.queuePending ?? stats.routeReparse?.jobs.pending,
            cloudTasks: queues?.sportsLibRouteReparse?.pending,
            completed: stats.routeReparse?.jobs.completed,
            completedLabel: 'Completed',
            problemCount: stats.routeReparse?.jobs.failed,
            problemLabel: 'Failed',
            dead: 0,
            deadLabel: 'DLQ',
            chips: [
                ...countChip('Processing', stats.routeReparse?.jobs.processing),
                ...countChip('Skipped', stats.routeReparse?.jobs.skipped),
                versionChip(stats.routeReparse?.targetSportsLibVersion),
            ],
        }),
        buildQueueRow({
            id: 'derived-metrics',
            label: 'Derived Metrics',
            icon: 'monitor_heart',
            route: '/admin/queues/derived-metrics',
            pendingDb: derivedCoordinators?.queued,
            cloudTasks: queues?.derivedMetrics?.pending,
            completed: derivedCoordinators?.idle,
            completedLabel: 'Idle',
            problemCount: staleDerived,
            problemLabel: 'Stale',
            dead: derivedCoordinators?.failed,
            deadLabel: 'Failed',
            chips: [
                ...countChip('Processing', derivedCoordinators?.processing),
                ...countChip('Total', derivedCoordinators?.total),
            ],
        }),
    ];
}

export function buildAdminDashboardMaintenanceCards(status: MaintenanceStatus | null): AdminDashboardMaintenanceCard[] {
    return [
        maintenanceCard('prod', 'Production', status?.prod),
        maintenanceCard('beta', 'Beta', status?.beta),
        maintenanceCard('dev', 'Dev / Localhost', status?.dev),
    ];
}

export function buildAdminDashboardChangelogSummary(changelogs: ChangelogPost[] | null | undefined): AdminDashboardChangelogSummary {
    const logs = [...(changelogs || [])];
    const published = logs.filter(log => log.published).length;
    const drafts = logs.length - published;
    logs.sort((left, right) => {
        const leftDate = coerceChangelogPostDate(left.date)?.getTime() ?? 0;
        const rightDate = coerceChangelogPostDate(right.date)?.getTime() ?? 0;
        return rightDate - leftDate;
    });
    const latest = logs.find(log => log.published) || null;

    return {
        total: logs.length,
        published,
        drafts,
        latestTitle: latest?.title || null,
        latestDate: latest ? coerceChangelogPostDate(latest.date) : null,
    };
}

export function buildAdminDashboardHealthSummary(
    queueRows: AdminDashboardQueueRow[],
    maintenanceCards: AdminDashboardMaintenanceCard[],
    changelogSummary: AdminDashboardChangelogSummary,
    financialStats: FinancialStats | null
): AdminDashboardHealthSummary {
    const queueWarnings = queueRows.filter(row => row.severity === 'warning').length;
    const queueErrors = queueRows.filter(row => row.severity === 'error').length;

    return {
        queueIssues: queueWarnings + queueErrors,
        queueWarnings,
        queueErrors,
        maintenanceIssues: maintenanceCards.filter(card => card.severity === 'error').length,
        maintenanceWarnings: maintenanceCards.filter(card => card.severity === 'warning').length,
        draftChangelogs: changelogSummary.drafts,
        revenueInvoiceCount: normalizeOptionalCount(financialStats?.revenue?.invoiceCount),
    };
}

export function formatAdminDashboardDuration(ms: number | null | undefined): string {
    const normalizedMs = normalizeCount(ms);
    if (normalizedMs <= 0) {
        return '0s';
    }

    const seconds = Math.floor(normalizedMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

function numberCard(
    id: string,
    label: string,
    icon: string,
    value: number | null,
    severity?: AdminDashboardSeverity,
    subtitle?: string
): AdminDashboardKpiCard {
    return {
        id,
        label,
        icon,
        value: finiteNumber(value),
        valueKind: 'number',
        severity,
        subtitle,
    };
}

function compactCard(
    id: string,
    label: string,
    icon: string,
    value: number | null | undefined,
    subtitle?: string
): AdminDashboardKpiCard {
    return {
        id,
        label,
        icon,
        value: finiteNumber(value),
        valueKind: 'compact',
        subtitle,
    };
}

function countUpdatedSubtitle(computedAt: string | null | undefined): string | undefined {
    if (!computedAt) {
        return undefined;
    }
    const parsedDate = new Date(computedAt);
    if (Number.isNaN(parsedDate.getTime())) {
        return undefined;
    }
    return `Updated ${parsedDate.toLocaleString()}`;
}

function buildQueueRow(base: QueueRowBase): AdminDashboardQueueRow {
    const row = {
        id: base.id,
        label: base.label,
        icon: base.icon,
        route: base.route,
        pendingDb: normalizeCount(base.pendingDb),
        cloudTasks: normalizeCount(base.cloudTasks),
        completed: normalizeCount(base.completed),
        completedLabel: base.completedLabel || 'Completed',
        problemCount: normalizeCount(base.problemCount),
        problemLabel: base.problemLabel || 'Stuck',
        dead: normalizeCount(base.dead),
        deadLabel: base.deadLabel || 'Dead',
        throughput: normalizeNullableCount(base.throughput),
        maxLagMs: normalizeNullableCount(base.maxLagMs),
        chips: compactChips(base.chips || EMPTY_CHIPS),
    };

    return {
        ...row,
        maxLagLabel: row.maxLagMs === null ? '-' : formatAdminDashboardDuration(row.maxLagMs),
        severity: resolveQueueSeverity(row.problemCount, row.dead, row.pendingDb, row.cloudTasks),
    };
}

function resolveQueueSeverity(
    problemCount: number,
    dead: number,
    pendingDb: number,
    cloudTasks: number
): AdminDashboardSeverity {
    if (problemCount > 0 || dead > 0) {
        return 'error';
    }
    if (pendingDb > 0 || cloudTasks > 0) {
        return 'warning';
    }
    return 'ok';
}

function maintenanceCard(
    id: 'prod' | 'beta' | 'dev',
    label: string,
    status: { enabled?: boolean; message?: string } | null | undefined
): AdminDashboardMaintenanceCard {
    if (typeof status?.enabled !== 'boolean') {
        return {
            id,
            label,
            icon: 'help',
            value: 'Unknown',
            subtitle: 'Status unavailable',
            severity: 'warning',
        };
    }

    const enabled = status.enabled === true;
    return {
        id,
        label,
        icon: enabled ? 'engineering' : 'check_circle',
        value: enabled ? 'Offline' : 'Online',
        subtitle: status.message?.trim() || (enabled ? 'Maintenance enabled' : 'No active maintenance'),
        severity: enabled ? 'error' : 'ok',
    };
}

function normalizeCount(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }
    return Math.max(0, Math.floor(numericValue));
}

function normalizeNullableCount(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeCount(value);
}

function normalizeOptionalCount(value: unknown): number | null {
    return finiteNumber(value) === null ? null : normalizeCount(value);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countChip(label: string, value: unknown): string[] {
    const count = normalizeCount(value);
    return count > 0 ? [`${label}: ${count}`] : [];
}

function versionChip(version: string | null | undefined): string {
    const trimmed = `${version || ''}`.trim();
    return trimmed ? `Target ${trimmed}` : '';
}

function providerChips(providers: QueueStats['providers'] | undefined): string[] {
    return (providers || [])
        .map(provider => {
            const pending = normalizeCount(provider.pending);
            const stuck = normalizeCount(provider.stuck);
            const dead = normalizeCount(provider.dead);
            const parts = [
                pending > 0 ? `${pending} pending` : '',
                stuck > 0 ? `${stuck} stuck` : '',
                dead > 0 ? `${dead} dead` : '',
            ].filter(Boolean);

            return parts.length ? `${provider.name}: ${parts.join(', ')}` : '';
        })
        .filter(Boolean);
}

function disabledProviderChips(providers: string[] | undefined): string[] {
    const disabledProviders = (providers || []).filter(Boolean);
    return disabledProviders.length ? [`Disabled: ${disabledProviders.join(', ')}`] : [];
}

function compactChips(chips: string[]): string[] {
    return chips
        .map(chip => chip.trim())
        .filter(Boolean)
        .slice(0, 4);
}
