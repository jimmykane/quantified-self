export const USAGE_LIMITS = {
    free: 100,
    basic: 1000,
} as const;

export type LimitedSubscriptionRole = keyof typeof USAGE_LIMITS;

export const ROUTE_USAGE_LIMITS = {
    free: 10,
    basic: 100,
} as const satisfies Record<LimitedSubscriptionRole, number>;

export const AI_INSIGHTS_REQUEST_LIMITS = {
    free: 20,
    basic: 50,
    pro: 100,
} as const;

export type SubscriptionRole = LimitedSubscriptionRole | 'pro';

export const DEVICE_SYNC_ENABLED_ROLES = ['pro'] as const satisfies readonly SubscriptionRole[];

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

export function getRouteUsageLimitForRole(role: string): number | null {
    if (role === 'pro') {
        return null;
    }

    if (isLimitedSubscriptionRole(role)) {
        return ROUTE_USAGE_LIMITS[role];
    }

    throw new Error(`Unsupported subscription role '${role}' for route usage limits.`);
}

export function getAiInsightsRequestLimitForRole(role: string): number {
    if (role === 'free' || role === 'basic' || role === 'pro') {
        return AI_INSIGHTS_REQUEST_LIMITS[role];
    }

    throw new Error(`Unsupported subscription role '${role}' for AI insights request limits.`);
}

export function isDeviceSyncEnabledForRole(role: string): boolean {
    return DEVICE_SYNC_ENABLED_ROLES.some(enabledRole => enabledRole === role);
}

export const GRACE_PERIOD_DAYS = 30;
export const GRACE_PERIOD_MILLISECONDS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export function calculateGracePeriodEnd(start: Date | number): Date {
    const startMilliseconds = start instanceof Date ? start.getTime() : start;
    return new Date(startMilliseconds + GRACE_PERIOD_MILLISECONDS);
}
