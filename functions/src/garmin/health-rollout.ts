/**
 * Garmin Health summaries beyond Sleep are staged independently. Keep raw
 * Firebase UIDs server-only; an empty list is intentionally deny-all.
 */
export const GARMIN_HEALTH_SYNC_ALLOWED_USER_IDS: readonly string[] = [
  'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
];

export const GARMIN_HEALTH_SYNC_ENABLED = true;

export function isGarminHealthSyncEnabled(): boolean {
  return GARMIN_HEALTH_SYNC_ENABLED;
}

export function isGarminHealthSyncUserAllowed(userID: string | null | undefined): boolean {
  const normalizedUserID = typeof userID === 'string' ? userID.trim() : '';
  return normalizedUserID.length > 0
    && GARMIN_HEALTH_SYNC_ALLOWED_USER_IDS.includes(normalizedUserID);
}
