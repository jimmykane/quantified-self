/**
 * Suunto Health is staged independently from production-wide Suunto Sleep.
 * Keep the raw Firebase UIDs server-only so rollout membership is not emitted
 * into the public Angular bundle. An empty list is deny-all.
 */
export const SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS: readonly string[] = [
  'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
];

export function isSuuntoHealthSyncUserAllowed(userID: string | null | undefined): boolean {
  const normalizedUserID = typeof userID === 'string' ? userID.trim() : '';
  return normalizedUserID.length > 0
    && SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS.includes(normalizedUserID);
}
