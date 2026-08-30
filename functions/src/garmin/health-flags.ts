/** Independent operational rollback switch for Garmin Health beyond Sleep. */
export const GARMIN_HEALTH_SYNC_ENABLED = true;

export function isGarminHealthSyncEnabled(): boolean {
  return GARMIN_HEALTH_SYNC_ENABLED;
}
