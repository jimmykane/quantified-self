import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SYNC_ROUTES,
  ACTIVITY_SYNC_ROUTE_IDS,
  getActivitySyncRouteId,
} from '../../../shared/activity-sync-routes';

describe('activity-sync Wahoo route registry', () => {
  it('registers Garmin, COROS, and Suunto FIT delivery to Wahoo', () => {
    const routes = [
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI],
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI],
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI],
    ];
    const wahooServiceName = routes[0].destinationServiceName;

    for (const route of routes) {
      expect(route.destinationServiceName).toBe(wahooServiceName);
      expect(route.supportedFileExtensions).toEqual(['fit']);
      expect(getActivitySyncRouteId(route.sourceServiceName, route.destinationServiceName)).toBe(route.id);
    }
  });

  it('registers Wahoo FIT delivery to Suunto', () => {
    const route = ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp];

    expect(route.sourceServiceName).toBe(
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI].destinationServiceName,
    );
    expect(route.destinationServiceName).toBe(
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp].destinationServiceName,
    );
    expect(route.supportedFileExtensions).toEqual(['fit']);
    expect(getActivitySyncRouteId(route.sourceServiceName, route.destinationServiceName)).toBe(route.id);
  });
});
