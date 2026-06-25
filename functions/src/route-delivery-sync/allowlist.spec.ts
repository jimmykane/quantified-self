import { describe, expect, it } from 'vitest';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS, ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';
import {
  getRouteDeliverySyncRouteAllowlistConfigError,
  isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';

describe('route-delivery-sync/allowlist', () => {
  it('registers only the Suunto to Garmin route for v1', () => {
    expect(Object.keys(ROUTE_DELIVERY_SYNC_ROUTES)).toEqual([
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
    ]);
    expect(ROUTE_DELIVERY_SYNC_ROUTES[ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]).toMatchObject({
      id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      destinationRequiredPermissions: ['COURSE_IMPORT'],
    });
  });

  it('allows any non-empty uid when the route allowlist is empty', () => {
    expect(getRouteDeliverySyncRouteAllowlistConfigError(ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI)).toBeNull();
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      'user-1',
    )).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      'someone-else',
    )).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      '',
    )).toBe(false);
  });
});
