import { describe, expect, it } from 'vitest';
import { DEFAULT_BILLING_TRIAL_POLICY, parseBillingTrialPolicy, resolveBillingTrialDays } from '../../../../shared/billing-trial-policy';

describe('introductory billing trial policy', () => {
  it('preserves price-level offers until explicitly configured', () => {
    const policy = parseBillingTrialPolicy(undefined);
    expect(policy).toEqual(DEFAULT_BILLING_TRIAL_POLICY);
    expect(resolveBillingTrialDays(policy, 'pro', '30')).toBe(30);
    expect(resolveBillingTrialDays(policy, 'basic', undefined)).toBe(0);
  });
  it.each([0, 7, 14, 30])('applies %i days independently of price metadata and billing cadence', days => {
    const policy = parseBillingTrialPolicy({ revision: 1, basicTrialDays: days, proTrialDays: null });
    expect(resolveBillingTrialDays(policy, 'basic', '30')).toBe(days);
    expect(resolveBillingTrialDays(policy, 'pro', '7')).toBe(7);
    expect(resolveBillingTrialDays(policy, 'other', '14')).toBe(14);
  });
  it.each([{}, { revision: 0, basicTrialDays: 0, proTrialDays: 0 }, { revision: 1, basicTrialDays: 365, proTrialDays: null },
    { revision: 1, basicTrialDays: 7, proTrialDays: '14' }, { revision: 1.5, basicTrialDays: 7, proTrialDays: 14 }])('rejects malformed saved policy %j', value => {
    expect(() => parseBillingTrialPolicy(value)).toThrow();
  });
  it.each(['731', '-1', '1.5', 'Infinity', 'abc', '', undefined])('does not advertise invalid catalog trials %s', value => {
    expect(resolveBillingTrialDays(DEFAULT_BILLING_TRIAL_POLICY, 'pro', value)).toBe(0);
  });
});
