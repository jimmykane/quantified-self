import type {
    SubscriptionCadenceTierStats,
    SubscriptionHistoryTrendResponse,
    UserCountStats,
    UserGrowthTrendResponse,
} from '../services/admin.service';

export type AdminUserKpiProfile = 'dashboard' | 'full';
export type AdminUserKpiSeverity = 'ok' | 'warning' | 'error';
export type AdminUserKpiValueKind = 'number' | 'compact';

export type AdminUserKpiId =
    | 'active-24h'
    | 'active-7d'
    | 'active-30d'
    | 'total-users'
    | 'pro-users'
    | 'basic-users'
    | 'free-users'
    | 'monthly-paid'
    | 'yearly-paid'
    | 'onboarded-users'
    | 'marketing-consent'
    | 'service-connected-users'
    | 'mcp-connected-users'
    | 'any-connected-users'
    | 'events'
    | 'routes'
    | 'ever-paid'
    | 'canceled'
    | 'scheduled-cancel'
    | 'growth-12m'
    | 'subscription-net-12m';

export interface AdminUserKpiCard {
    id: AdminUserKpiId;
    label: string;
    icon: string;
    value: number | null;
    valueKind: AdminUserKpiValueKind;
    subtitle?: string;
    severity?: AdminUserKpiSeverity;
}

const AUTH_ACTIVITY_BASIS = 'Sign-in or ID token refresh';

const DASHBOARD_CARD_IDS: readonly AdminUserKpiId[] = [
    'active-24h',
    'active-7d',
    'active-30d',
    'total-users',
    'pro-users',
    'basic-users',
    'onboarded-users',
    'marketing-consent',
    'any-connected-users',
    'scheduled-cancel',
    'growth-12m',
    'subscription-net-12m',
];

const FULL_CARD_IDS: readonly AdminUserKpiId[] = [
    'active-24h',
    'active-7d',
    'active-30d',
    'total-users',
    'pro-users',
    'basic-users',
    'free-users',
    'monthly-paid',
    'yearly-paid',
    'onboarded-users',
    'marketing-consent',
    'service-connected-users',
    'mcp-connected-users',
    'any-connected-users',
    'events',
    'routes',
    'ever-paid',
    'canceled',
    'scheduled-cancel',
    'growth-12m',
    'subscription-net-12m',
];

export function buildAdminUserKpiCards(
    profile: AdminUserKpiProfile,
    stats: UserCountStats | null,
    userGrowthTrend: UserGrowthTrendResponse | null,
    subscriptionHistoryTrend: SubscriptionHistoryTrendResponse | null,
): AdminUserKpiCard[] {
    if (!stats) {
        return [];
    }

    const registeredGrowth = safeCount(userGrowthTrend?.totals?.registeredUsers);
    const onboardedGrowth = safeCount(userGrowthTrend?.totals?.onboardedUsers);
    const subscriptionNet = safeSignedCount(subscriptionHistoryTrend?.totals?.net);
    const newSubscriptions = safeCount(subscriptionHistoryTrend?.totals?.newSubscriptions);
    const plannedCancellations = safeCount(subscriptionHistoryTrend?.totals?.plannedCancellations);
    const canceled = safeCount(stats.canceled);
    const cancelScheduled = safeCount(stats.cancelScheduled);
    const connections = stats.connections;
    const anyConnectionUsers = connections
        ? distinctConnectedUserCount(connections.serviceUsers, connections.mcpUsers, connections.both)
        : null;
    const active24Hours = safeCount(stats.authActivity?.last24Hours);
    const active7Days = safeCount(stats.authActivity?.last7Days);
    const active30Days = safeCount(stats.authActivity?.last30Days);
    const marketingConsent = safeCount(stats.marketingConsent);

    const cards: AdminUserKpiCard[] = [
        numberCard('active-24h', 'Active 24h', 'schedule', active24Hours, undefined, AUTH_ACTIVITY_BASIS),
        numberCard(
            'active-7d',
            'Active 7d',
            'date_range',
            active7Days,
            undefined,
            authActivity7DaySubtitle(active7Days, active30Days),
        ),
        numberCard('active-30d', 'Active 30d', 'calendar_view_month', active30Days, undefined, AUTH_ACTIVITY_BASIS),
        numberCard('total-users', 'Total Users', 'people', stats.total),
        numberCard(
            'pro-users',
            'Pro Users',
            'verified',
            stats.pro,
            'ok',
            subscriptionCadenceSubtitle(stats.subscriptionCadence?.pro),
        ),
        numberCard(
            'basic-users',
            'Basic Users',
            'person_outline',
            stats.basic,
            undefined,
            subscriptionCadenceSubtitle(stats.subscriptionCadence?.basic),
        ),
        numberCard('free-users', 'Free Users', 'money_off', stats.free),
        numberCard('monthly-paid', 'Monthly Paid', 'calendar_view_month', stats.monthlyPaid),
        numberCard('yearly-paid', 'Yearly Paid', 'calendar_today', stats.yearlyPaid),
        numberCard('onboarded-users', 'Onboarded', 'how_to_reg', stats.onboardingCompleted, 'ok'),
        numberCard(
            'marketing-consent',
            'Marketing Opt-ins',
            'mark_email_read',
            marketingConsent,
            undefined,
            userShareSubtitle(marketingConsent, stats.total, 'Consent only'),
        ),
        numberCard(
            'service-connected-users',
            'Service Connected',
            'link',
            connections?.serviceUsers ?? null,
            connectionCountSeverity(connections?.serviceUsers ?? null),
            connectedServiceSubtitle(connections?.serviceUsers ?? null, stats.total, connections?.providers ?? {}),
        ),
        numberCard(
            'mcp-connected-users',
            'MCP Connected',
            'hub',
            connections?.mcpUsers ?? null,
            connectionCountSeverity(connections?.mcpUsers ?? null),
            userShareSubtitle(connections?.mcpUsers ?? null, stats.total, 'Active authorization'),
        ),
        numberCard(
            'any-connected-users',
            'Any Connection',
            'account_tree',
            anyConnectionUsers,
            connectionCountSeverity(anyConnectionUsers),
            userShareSubtitle(anyConnectionUsers, stats.total, 'Service or MCP'),
        ),
        compactCard('events', 'Events', 'fitness_center', stats.events.total, countUpdatedSubtitle(stats.events.computedAt)),
        compactCard('routes', 'Routes', 'route', stats.routes.total, countUpdatedSubtitle(stats.routes.computedAt)),
        numberCard('ever-paid', 'Ever Paid', 'workspace_premium', stats.everPaid),
        numberCard('canceled', 'Canceled', 'cancel', canceled, (canceled ?? 0) > 0 ? 'warning' : undefined),
        numberCard(
            'scheduled-cancel',
            'Scheduled Cancels',
            'event_busy',
            cancelScheduled,
            (cancelScheduled ?? 0) > 0 ? 'warning' : undefined,
        ),
        numberCard(
            'growth-12m',
            '12-Month Growth',
            'show_chart',
            registeredGrowth,
            undefined,
            onboardedGrowth !== null ? `${onboardedGrowth} onboarded` : undefined,
        ),
        signedNumberCard(
            'subscription-net-12m',
            'Subscription Net',
            'trending_up',
            subscriptionNet,
            subscriptionNet !== null && subscriptionNet < 0 ? 'warning' : undefined,
            newSubscriptions !== null && plannedCancellations !== null
                ? `${newSubscriptions} new / ${plannedCancellations} scheduled cancels`
                : undefined,
        ),
    ];

    const cardsById = new Map(cards.map(card => [card.id, card]));
    const profileIds = profile === 'dashboard' ? DASHBOARD_CARD_IDS : FULL_CARD_IDS;
    return profileIds.map(id => cardsById.get(id)).filter((card): card is AdminUserKpiCard => Boolean(card));
}

function numberCard(
    id: AdminUserKpiId,
    label: string,
    icon: string,
    value: number | null,
    severity?: AdminUserKpiSeverity,
    subtitle?: string,
): AdminUserKpiCard {
    const normalizedValue = safeCount(value);
    return normalizedNumberCard(id, label, icon, normalizedValue, severity, subtitle);
}

function signedNumberCard(
    id: AdminUserKpiId,
    label: string,
    icon: string,
    value: number | null,
    severity?: AdminUserKpiSeverity,
    subtitle?: string,
): AdminUserKpiCard {
    return normalizedNumberCard(id, label, icon, safeSignedCount(value), severity, subtitle);
}

function normalizedNumberCard(
    id: AdminUserKpiId,
    label: string,
    icon: string,
    normalizedValue: number | null,
    severity?: AdminUserKpiSeverity,
    subtitle?: string,
): AdminUserKpiCard {
    return {
        id,
        label,
        icon,
        value: normalizedValue,
        valueKind: 'number',
        severity: normalizedValue === null ? undefined : severity,
        subtitle,
    };
}

function compactCard(
    id: AdminUserKpiId,
    label: string,
    icon: string,
    value: number | null | undefined,
    subtitle?: string,
): AdminUserKpiCard {
    return { id, label, icon, value: safeCount(value), valueKind: 'compact', subtitle };
}

function countUpdatedSubtitle(computedAt: string | null | undefined): string | undefined {
    if (!computedAt) {
        return undefined;
    }
    const parsedDate = new Date(computedAt);
    return Number.isNaN(parsedDate.getTime()) ? undefined : `Updated ${parsedDate.toLocaleString()}`;
}

function connectedServiceSubtitle(
    connectedUsers: number | null,
    totalUsers: number,
    providers: Record<string, number>,
): string | undefined {
    if (connectedUsers === null) {
        return 'Unavailable';
    }

    const share = userShareSubtitle(connectedUsers, totalUsers);
    const providerSummary = ['Garmin', 'Suunto', 'COROS', 'Wahoo']
        .map(provider => `${provider} ${normalizeCount(providers[provider])}`)
        .join(' · ');
    return [share, providerSummary].filter((value): value is string => Boolean(value)).join(' · ') || undefined;
}

function userShareSubtitle(users: number | null, totalUsers: number, prefix?: string): string | undefined {
    const normalizedUsers = safeCount(users);
    if (normalizedUsers === null) {
        return 'Unavailable';
    }

    const normalizedTotalUsers = safeCount(totalUsers);
    if (normalizedTotalUsers === null || normalizedTotalUsers <= 0) {
        return prefix;
    }

    const share = Math.min(100, Math.round((normalizedUsers / normalizedTotalUsers) * 100));
    return [prefix, `${share}% of users`].filter((value): value is string => Boolean(value)).join(' · ');
}

function authActivity7DaySubtitle(active7Days: number | null, active30Days: number | null): string {
    if (active7Days === null || active30Days === null || active30Days <= 0) {
        return AUTH_ACTIVITY_BASIS;
    }
    const share = Math.min(100, Math.max(0, Math.round((active7Days / active30Days) * 100)));
    return `${AUTH_ACTIVITY_BASIS} · ${share}% of 30-day active`;
}

function subscriptionCadenceSubtitle(stats: SubscriptionCadenceTierStats | undefined): string | undefined {
    if (!stats) {
        return undefined;
    }

    const count = (value: unknown): number | null => (
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
    );
    const monthly = count(stats.monthly);
    const yearly = count(stats.yearly);
    const unknown = count(stats.unknown);
    if (monthly === null && yearly === null) {
        return 'Cadence unavailable';
    }

    const details = [
        monthly === null ? 'Monthly unavailable' : `Monthly ${monthly}`,
        yearly === null ? 'Yearly unavailable' : `Yearly ${yearly}`,
    ];
    if (unknown !== null && unknown > 0) {
        details.push(`Unknown ${unknown}`);
    }
    return details.join(' · ');
}

function distinctConnectedUserCount(serviceUsers: number | null, mcpUsers: number | null, both: number | null): number | null {
    const normalizedServiceUsers = safeCount(serviceUsers);
    const normalizedMcpUsers = safeCount(mcpUsers);
    const normalizedBothUsers = safeCount(both);
    if (normalizedServiceUsers === null || normalizedMcpUsers === null || normalizedBothUsers === null) {
        return null;
    }
    const normalizedBoth = Math.min(normalizedBothUsers, normalizedServiceUsers, normalizedMcpUsers);
    return normalizedServiceUsers + normalizedMcpUsers - normalizedBoth;
}

function connectionCountSeverity(value: number | null): AdminUserKpiSeverity | undefined {
    return safeCount(value) === null ? undefined : 'ok';
}

function normalizeCount(value: unknown): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}

function safeCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeSignedCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}
