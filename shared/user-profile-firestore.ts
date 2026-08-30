export const USER_PROFILE_COLLECTION_NAME = 'users';
export const USER_LEGAL_COLLECTION_NAME = 'legal';
export const USER_LEGAL_AGREEMENTS_DOCUMENT_NAME = 'agreements';
export const ACCEPTED_MARKETING_POLICY_FIELD = 'acceptedMarketingPolicy';

export const REQUIRED_USER_LEGAL_AGREEMENT_FIELDS = [
  'acceptedPrivacyPolicy',
  'acceptedDataPolicy',
  'acceptedDiagnosticsPolicy',
  'acceptedTos',
] as const;

export const OPTIONAL_USER_LEGAL_CONSENT_FIELDS = [
  'acceptedTrackingPolicy',
  ACCEPTED_MARKETING_POLICY_FIELD,
] as const;

export const USER_LEGAL_AGREEMENT_FIELDS = [
  ...REQUIRED_USER_LEGAL_AGREEMENT_FIELDS,
  ...OPTIONAL_USER_LEGAL_CONSENT_FIELDS,
] as const;

export function getUserLegalAgreementsPath(userID: string): string {
  return `${USER_PROFILE_COLLECTION_NAME}/${userID}/${USER_LEGAL_COLLECTION_NAME}/${USER_LEGAL_AGREEMENTS_DOCUMENT_NAME}`;
}
