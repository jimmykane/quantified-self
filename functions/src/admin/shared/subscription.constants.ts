export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;
export const ACTIVE_SUBSCRIPTION_STATUS_SET = new Set<string>(ACTIVE_SUBSCRIPTION_STATUSES);
export const SUBSCRIPTION_ROLE_BASIC = 'basic';
export const SUBSCRIPTION_ROLE_PRO = 'pro';
