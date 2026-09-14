import { getGarminPermissionsFromTokenLike, getGarminProviderUserIdFromTokenLike } from '@shared/garmin-service-token';
import type { ServiceConnectionAccountProjection } from '@shared/service-connection';

export const GARMIN_PERMISSION_DETAILS = [
  { id: 'HISTORICAL_DATA_EXPORT', label: 'History Importer', description: 'Import your past Garmin activities.' },
  { id: 'ACTIVITY_EXPORT', label: 'Activity Sync', description: 'Automatically import new Garmin activities.' },
  { id: 'WORKOUT_IMPORT', label: 'Workout Import', description: 'Send planned workouts when available for your account. Requires explicit opt-in.' },
  { id: 'HEALTH_EXPORT', label: 'Health Export', description: 'Import Garmin sleep and supported Health data.' },
  { id: 'COURSE_IMPORT', label: 'Course Import', description: 'Send saved routes or GPX/FIT files to Garmin Connect.' },
] as const;

/** Display only: never combine grants across accounts or use these rows as authority. */
export function buildGarminPermissionAccounts(accounts: readonly ServiceConnectionAccountProjection[] | undefined) {
  return (accounts ?? []).flatMap(account => {
    const providerUserId = getGarminProviderUserIdFromTokenLike(account);
    if (!providerUserId) return [];
    const known = Array.isArray(account.permissions)
      && account.permissions.every(value => typeof value === 'string' && value.trim().length > 0);
    const granted = new Set(known ? getGarminPermissionsFromTokenLike(account) : []);
    // MCT is deferred to #621; do not surface it even for accounts with an existing grant.
    const ids = [...new Set<string>([...GARMIN_PERMISSION_DETAILS.map(permission => permission.id), ...granted])]
      .filter(id => id !== 'MCT_EXPORT');
    return [{
      providerUserId,
      permissionsKnown: known,
      permissions: ids.map(id => {
        const detail = GARMIN_PERMISSION_DETAILS.find(permission => permission.id === id);
        const isGranted = granted.has(id);
        return {
          id,
          label: detail?.label ?? id,
          description: detail?.description ?? 'Additional permission reported by Garmin.',
          status: !known ? 'Not reported' : isGranted ? 'Granted' : 'Not granted',
          icon: !known ? 'help_outline' : isGranted ? 'check_circle' : 'remove_circle_outline',
        };
      }),
    }];
  });
}
