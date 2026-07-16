import {
    getAiInsightsRequestLimitForRole,
    calculateGracePeriodEnd as calculateGracePeriodEndFromStart,
    getRouteUsageLimitForRole,
    getUsageLimitForRole,
    isDeviceSyncEnabledForRole,
} from '../../../shared/limits';
import { ROLE_DISPLAY_NAMES } from '../shared/pricing';

export const TRANSACTIONAL_EMAIL_FROM = 'Quantified Self <hello@quantified-self.io>';
export const TRANSACTIONAL_EMAIL_REPLY_TO = 'support@quantified-self.io';
export const FOUNDER_EMAIL_FROM = 'Dimitrios from Quantified Self <hello@quantified-self.io>';
export const FOUNDER_EMAIL_REPLY_TO = 'dimitrios@quantified-self.io';

export const EMAIL_LINKS = {
    dashboard: 'https://quantified-self.io/dashboard',
    membership: 'https://quantified-self.io/pricing',
    product: 'https://quantified-self.io',
} as const;

type TimestampLike = {
    toDate(): Date;
};

export interface EmailPlanDetails {
    plan_details_available: boolean;
    activity_description: string;
    route_description: string;
    ai_insights_description: string;
    device_sync_description: string;
}

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
});

function toDate(value: Date | TimestampLike): Date {
    return value instanceof Date ? value : value.toDate();
}

function formatLimit(limit: number | null, label: string): string {
    return limit === null
        ? `Unlimited ${label}`
        : `Up to ${NUMBER_FORMATTER.format(limit)} ${label}`;
}

export function getRoleDisplayName(role: string): string {
    return ROLE_DISPLAY_NAMES[role] || role;
}

export function buildEmailPlanDetails(role: string): EmailPlanDetails {
    if (role !== 'free' && role !== 'basic' && role !== 'pro') {
        return {
            plan_details_available: false,
            activity_description: '',
            route_description: '',
            ai_insights_description: '',
            device_sync_description: '',
        };
    }

    const aiInsightsLimit = getAiInsightsRequestLimitForRole(role);
    const aiInsightsPeriod = role === 'free' ? 'calendar month' : 'billing period';

    return {
        plan_details_available: true,
        activity_description: formatLimit(getUsageLimitForRole(role), 'activities'),
        route_description: formatLimit(getRouteUsageLimitForRole(role), 'saved routes'),
        ai_insights_description: `${NUMBER_FORMATTER.format(aiInsightsLimit)} AI Insights requests per ${aiInsightsPeriod}`,
        device_sync_description: isDeviceSyncEnabledForRole(role)
            ? 'Device sync with Garmin, Suunto, and COROS'
            : '',
    };
}

export function formatEmailDate(value: Date | TimestampLike): string {
    return DATE_FORMATTER.format(toDate(value));
}

export function calculateGracePeriodEnd(value: Date | TimestampLike): Date {
    return calculateGracePeriodEndFromStart(toDate(value));
}

export function formatGracePeriodEnd(value: Date | TimestampLike): string {
    return formatEmailDate(calculateGracePeriodEnd(value));
}
