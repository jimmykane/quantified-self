export const USAGE_LIMITS = {
    free: 100,
    basic: 1000,
} as const;

export const AI_INSIGHTS_REQUEST_LIMITS = {
    free: 0,
    basic: 50,
    pro: 100,
} as const;

export type LimitedSubscriptionRole = keyof typeof USAGE_LIMITS;
export type SubscriptionRole = LimitedSubscriptionRole | 'pro';

export function isLimitedSubscriptionRole(role: string): role is LimitedSubscriptionRole {
    return Object.prototype.hasOwnProperty.call(USAGE_LIMITS, role);
}

export function getUsageLimitForRole(role: string): number | null {
    if (role === 'pro') {
        return null;
    }

    if (isLimitedSubscriptionRole(role)) {
        return USAGE_LIMITS[role];
    }

    throw new Error(`Unsupported subscription role '${role}' for usage limits.`);
}

export function getAiInsightsRequestLimitForRole(role: string): number {
    if (role === 'free' || role === 'basic' || role === 'pro') {
        return AI_INSIGHTS_REQUEST_LIMITS[role];
    }

    throw new Error(`Unsupported subscription role '${role}' for AI insights request limits.`);
}

export const GRACE_PERIOD_DAYS = 30;
