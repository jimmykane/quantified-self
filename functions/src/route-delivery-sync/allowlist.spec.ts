import { describe, expect, it } from 'vitest';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS, ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';
import {
  getRouteDeliverySyncRouteAllowlistConfigError,
  isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';

describe('route-delivery-sync/allowlist', () => {
  it('registers the Suunto route-delivery destinations', () => {
    expect(Object.keys(ROUTE_DELIVERY_SYNC_ROUTES)).toEqual([
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
    ]);
    expect(ROUTE_DELIVERY_SYNC_ROUTES[ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]).toMatchObject({
      id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      destinationRequiredPermissions: ['COURSE_IMPORT'],
    });
    expect(ROUTE_DELIVERY_SYNC_ROUTES[ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]).toMatchObject({
      id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
      destinationRequiredPermissions: ['routes_read', 'routes_write'],
    });
    expect(ROUTE_DELIVERY_SYNC_ROUTES[ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]).toMatchObject({
      id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
      destinationRequiredPermissions: [],
    });
  });

  it.each([
    ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
    ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
  ])('allows any non-empty uid when the %s route allowlist is empty', (routeId) => {
    expect(getRouteDeliverySyncRouteAllowlistConfigError(routeId)).toBeNull();
    expect(isRouteDeliverySyncRouteUserAllowlisted(routeId, 'user-1')).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(routeId, 'someone-else')).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(routeId, '')).toBe(false);
  });

  it('allows Suunto-to-COROS route delivery for every non-empty uid', () => {
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
      'user-1',
    )).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
      'someone-else',
    )).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
      '',
    )).toBe(false);
  });
});
