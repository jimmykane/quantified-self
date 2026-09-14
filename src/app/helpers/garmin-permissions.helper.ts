import { getGarminPermissionsFromTokenLike, getGarminProviderUserIdFromTokenLike } from '@shared/garmin-service-token';
import type { ServiceConnectionAccountProjection } from '@shared/service-connection';

export const GARMIN_PERMISSION_DETAILS = [
  { id: 'HISTORICAL_DATA_EXPORT', label: 'History Importer', description: 'Without this, you cannot import your past activities from Garmin Connect.' },
  { id: 'ACTIVITY_EXPORT', label: 'Activity Sync', description: 'Without this, your new activities will not automatically sync to Quantified Self.' },
  { id: 'WORKOUT_IMPORT', label: 'Workout Import', description: 'Required for planned-workout delivery when available for your account. Workouts also require explicit delivery opt-in.' },
  { id: 'HEALTH_EXPORT', label: 'Health Export', description: 'Required for Garmin Sleep and supported Health summary imports.' },
  { id: 'COURSE_IMPORT', label: 'Course Import', description: 'Required to send saved routes and manually selected GPX or FIT routes to Garmin Connect.' },
  { id: 'MCT_EXPORT', label: 'Menstrual Cycle Tracking Export', description: 'This permission is not used by Quantified Self yet.' },
] as const;

/** Display only: never combine grants across accounts or use these rows as authority. */
export function buildGarminPermissionAccounts(accounts: readonly ServiceConnectionAccountProjection[] | undefined) {
  return (accounts ?? []).flatMap(account => {
    const providerUserId = getGarminProviderUserIdFromTokenLike(account);
    if (!providerUserId) return [];
    const known = Array.isArray(account.permissions)
      && account.permissions.every(value => typeof value === 'string' && value.trim().length > 0);
    const granted = new Set(known ? getGarminPermissionsFromTokenLike(account) : []);
    const ids = [...new Set<string>([...GARMIN_PERMISSION_DETAILS.map(permission => permission.id), ...granted])];
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
