import { describe, expect, it } from 'vitest';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';

describe('activity-sync/allowlist', () => {
  it('has configured allowlist entries for known routes', () => {
    expect(getActivitySyncRouteAllowlistConfigError(ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp)).toBeNull();
  });

  it('allows the configured rollout user', () => {
    expect(isActivitySyncRouteUserAllowlisted(
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
    )).toBe(true);
  });

  it('denies non-allowlisted users', () => {
    expect(isActivitySyncRouteUserAllowlisted(
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      'not-allowlisted',
    )).toBe(false);
  });
});

