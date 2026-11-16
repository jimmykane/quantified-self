/** App-owned introductory offers. Existing Stripe subscriptions are never rewritten. */
export const BILLING_TRIAL_POLICY_PATH = 'configuration/billingTrials';
export const BILLING_TRIAL_DAYS = [0, 7, 14, 30] as const;
export type BillingTrialDays = typeof BILLING_TRIAL_DAYS[number] | null;
export interface BillingTrialPolicy {
  revision: number;
  basicTrialDays: BillingTrialDays;
  proTrialDays: BillingTrialDays;
}
export const DEFAULT_BILLING_TRIAL_POLICY: Readonly<BillingTrialPolicy> = {
  revision: 0, basicTrialDays: null, proTrialDays: null,
};
export const BILLING_OFFER_CHANGED_MESSAGE = 'Trial offers have changed. Refresh Membership and review the current terms before continuing.';

export function isBillingTrialDays(value: unknown): value is BillingTrialDays {
  return value === null || BILLING_TRIAL_DAYS.some(days => days === value);
}

/** Missing policy preserves the catalog; a malformed policy must never become a paid offer. */
export function parseBillingTrialPolicy(value: unknown): BillingTrialPolicy {
  if (value === undefined || value === null) return { ...DEFAULT_BILLING_TRIAL_POLICY };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid billing trial policy.');
  const data = value as Record<string, unknown>;
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 1
    || !isBillingTrialDays(data.basicTrialDays) || !isBillingTrialDays(data.proTrialDays)) {
    throw new Error('Invalid billing trial policy.');
  }
  return { revision: data.revision as number, basicTrialDays: data.basicTrialDays, proTrialDays: data.proTrialDays };
}

export function resolveBillingTrialDays(policy: BillingTrialPolicy, role: string | null | undefined, metadataDays: unknown): number {
  const override = role === 'basic' ? policy.basicTrialDays : role === 'pro' ? policy.proTrialDays : null;
  if (override !== null) return override;
  if (typeof metadataDays !== 'string' || !/^[1-9]\d*$/.test(metadataDays.trim())) return 0;
  const days = Number(metadataDays);
  return Number.isSafeInteger(days) && days <= 730 ? days : 0;
}
