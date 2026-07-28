export const POLICY_CONSENT_FORM_CONTROL_NAMES = {
  privacy: 'acceptPrivacyPolicy',
  data: 'acceptDataPolicy',
  tracking: 'acceptTrackingPolicy',
  terms: 'acceptTos',
  marketing: 'acceptMarketingPolicy',
} as const;

export const REQUIRED_POLICY_CONSENT_FORM_CONTROL_NAMES = [
  POLICY_CONSENT_FORM_CONTROL_NAMES.privacy,
  POLICY_CONSENT_FORM_CONTROL_NAMES.data,
  POLICY_CONSENT_FORM_CONTROL_NAMES.terms,
] as const;
