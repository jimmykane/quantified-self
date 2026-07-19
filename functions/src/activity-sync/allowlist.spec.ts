import { describe, expect, it } from 'vitest';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';

describe('activity-sync/allowlist', () => {
  it('has configured allowlist structure for known routes', () => {
    expect(getActivitySyncRouteAllowlistConfigError(ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp)).toBeNull();
    expect(getActivitySyncRouteAllowlistConfigError(ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp)).toBeNull();
    expect(getActivitySyncRouteAllowlistConfigError(ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI)).toBeNull();
    expect(getActivitySyncRouteAllowlistConfigError(ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI)).toBeNull();
    expect(getActivitySyncRouteAllowlistConfigError(ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI)).toBeNull();
  });

  it('allows any non-empty uid when route allowlist is empty (gate disabled)', () => {
    expect(isActivitySyncRouteUserAllowlisted(
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      'any-user-id',
    )).toBe(true);
    expect(isActivitySyncRouteUserAllowlisted(
      ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
      'any-user-id',
    )).toBe(true);
    expect(isActivitySyncRouteUserAllowlisted(
      ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
      'any-user-id',
    )).toBe(true);
  });

  it('denies empty uid values', () => {
    expect(isActivitySyncRouteUserAllowlisted(
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      '',
    )).toBe(false);
  });
});
