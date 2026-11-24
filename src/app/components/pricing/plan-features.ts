import { getAssistantRequestLimitForRole, getRouteUsageLimitForRole, getUsageLimitForRole } from '@shared/limits';
import type { StripeRole } from '../../models/stripe-role.model';

export interface PlanFeature {
    icon: string;
    iconClass: string;
    label: string;
    highlight?: boolean;
}

export function buildPlanFeatures(role: StripeRole, dailyWorkoutBenefit?: string): PlanFeature[] {
    const standardIcon = role === 'pro' ? 'check_circle' : 'check';
    const standardIconClass = role === 'free' ? 'free-feature-icon' : role === 'basic' ? 'qs-color-accent' : 'qs-color-primary';
    const baseFeatures: PlanFeature[] = [
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: getActivityLimitLabel(role),
            highlight: true,
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: getRouteLimitLabel(role),
            highlight: role === 'basic',
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: 'MCP data access',
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: 'Manual training plans and standalone workouts',
        },
    ];

    if (role === 'free') {
        return [
            ...baseFeatures,
            { icon: standardIcon, iconClass: standardIconClass, label: 'Manual uploads', highlight: true },
            { icon: standardIcon, iconClass: standardIconClass, label: 'Core analysis tools', highlight: true },
            { icon: standardIcon, iconClass: standardIconClass, label: getAssistantLimitLabel(role), highlight: false },
        ];
    }

    if (role === 'basic') {
        return [
            ...baseFeatures,
            { icon: standardIcon, iconClass: standardIconClass, label: 'Manual uploads', highlight: false },
            { icon: standardIcon, iconClass: standardIconClass, label: getAssistantLimitLabel(role), highlight: true },
            { icon: 'favorite', iconClass: 'qs-color-primary', label: 'Supports independent, privacy-first development' },
        ];
    }

    return [
        ...baseFeatures,
        { icon: standardIcon, iconClass: standardIconClass, label: 'Automatic activity imports from your watch', highlight: true },
        { icon: standardIcon, iconClass: standardIconClass, label: 'Provider planned-workout delivery', highlight: true },
        ...(dailyWorkoutBenefit ? [{ icon: standardIcon, iconClass: standardIconClass, label: dailyWorkoutBenefit }] : []),
        { icon: standardIcon, iconClass: standardIconClass, label: 'Cross-device sync', highlight: true },
        { icon: standardIcon, iconClass: standardIconClass, label: getAssistantLimitLabel(role), highlight: false },
        { icon: 'favorite', iconClass: 'qs-color-warn', label: 'Helps fund faster feature releases' },
    ];
}

function getActivityLimitLabel(role: StripeRole): string {
    const limit = getUsageLimitForRole(role);
    return limit === null ? 'Unlimited activities' : `Up to ${limit} activities`;
}

function getRouteLimitLabel(role: StripeRole): string {
    const limit = getRouteUsageLimitForRole(role);
    return limit === null ? 'Unlimited saved routes' : `Up to ${limit} saved routes`;
}

function getAssistantLimitLabel(role: StripeRole): string {
    const limit = getAssistantRequestLimitForRole(role);
    if (limit <= 0) {
        return 'Assistant not included';
    }

    const period = role === 'free' ? 'calendar month' : 'billing period';
    return `Assistant up to ${limit} requests per ${period}`;
}
