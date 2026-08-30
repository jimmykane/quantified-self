import { ServiceNames } from '@sports-alliance/sports-lib';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import type { AdminUser } from '../services/admin.service';

dayjs.extend(localizedFormat);

export type AdminSubscriptionHistoryState = 'active' | 'scheduled' | 'canceled' | 'never';

export interface AdminUserTableService {
    provider: string;
    sourceServiceName: ServiceNames | null;
    connectedAtLabel: string;
}

export interface AdminUserTableRow {
    user: AdminUser;
    role: string;
    isAdmin: boolean;
    subscriptionState: AdminSubscriptionHistoryState;
    subscriptionLabel: string;
    subscriptionDetails: string | null;
    connectedServices: AdminUserTableService[];
    createdLabel: string;
    lastLoginLabel: string;
}

export function buildAdminUserTableRows(users: readonly AdminUser[], locale: string): AdminUserTableRow[] {
    const normalizedLocale = normalizeDayjsLocale(locale);
    return users.map(user => {
        const subscriptionState = subscriptionHistoryState(user);
        return {
            user,
            role: user.customClaims?.stripeRole || 'free',
            isAdmin: user.customClaims?.admin === true,
            subscriptionState,
            subscriptionLabel: subscriptionHistoryLabel(subscriptionState),
            subscriptionDetails: subscriptionHistoryDetails(user, subscriptionState, normalizedLocale),
            connectedServices: (user.connectedServices || []).map(service => ({
                provider: service.provider,
                sourceServiceName: serviceName(service.provider),
                connectedAtLabel: formatLocalizedDate(service.connectedAt, false, normalizedLocale) || 'Time unknown',
            })),
            createdLabel: formatLocalizedDate(user.metadata.creationTime, false, normalizedLocale) || '-',
            lastLoginLabel: formatLocalizedDate(user.metadata.lastSignInTime, true, normalizedLocale) || '-',
        };
    });
}

function subscriptionHistoryState(user: AdminUser): AdminSubscriptionHistoryState {
    const status = user.subscription?.status?.toLowerCase();
    const active = status === 'active' || status === 'trialing' || status === 'past_due';
    if (active && user.subscription?.cancel_at_period_end) {
        return 'scheduled';
    }
    if (active) {
        return 'active';
    }
    return user.hasSubscribedOnce === true ? 'canceled' : 'never';
}

function subscriptionHistoryLabel(state: AdminSubscriptionHistoryState): string {
    if (state === 'scheduled') return 'Cancel Scheduled';
    if (state === 'active') return 'Active';
    if (state === 'canceled') return 'Canceled';
    return 'Never Subscribed';
}

function subscriptionHistoryDetails(
    user: AdminUser,
    state: AdminSubscriptionHistoryState,
    locale: string,
): string | null {
    if (state === 'scheduled') {
        const endDate = formatLocalizedDate(user.subscription?.current_period_end, false, locale);
        return endDate ? `Ends ${endDate}` : 'Scheduled to end';
    }
    const status = user.subscription?.status?.toLowerCase();
    if (state === 'active' && status === 'trialing') return 'Trialing';
    if (state === 'active' && status === 'past_due') return 'Past Due';
    return null;
}

function formatLocalizedDate(timestamp: unknown, includeTime: boolean, locale: string): string {
    if (timestamp === null || timestamp === undefined || timestamp === '') {
        return '';
    }
    const value = timestampSeconds(timestamp) ?? timestamp;
    const parsed = dayjs(value as string | number | Date);
    return parsed.isValid() ? parsed.locale(locale).format(includeTime ? 'L LT' : 'L') : '';
}

function timestampSeconds(value: unknown): number | null {
    if (typeof value !== 'object' || value === null || !('seconds' in value)) {
        return null;
    }
    const seconds = (value as { seconds?: unknown }).seconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null;
}

function normalizeDayjsLocale(locale: string): string {
    const lowerLocale = (locale || 'en').toLowerCase();
    const localeMap: Record<string, string> = {
        'en-us': 'en', 'en-gb': 'en-gb', 'el-gr': 'el', 'de-de': 'de', 'fr-fr': 'fr',
        'es-es': 'es', 'it-it': 'it', 'nl-nl': 'nl', 'pl-pl': 'pl',
    };
    return localeMap[lowerLocale] || lowerLocale.split('-')[0];
}

function serviceName(provider: string): ServiceNames | null {
    const normalized = provider.trim().toLowerCase();
    if (normalized === 'garmin') return ServiceNames.GarminAPI;
    if (normalized === 'suunto') return ServiceNames.SuuntoApp;
    if (normalized === 'coros') return ServiceNames.COROSAPI;
    if (normalized === 'wahoo') return ServiceNames.WahooAPI;
    return null;
}
