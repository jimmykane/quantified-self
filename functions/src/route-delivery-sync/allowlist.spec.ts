import { describe, expect, it } from 'vitest';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS, ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';
import {
  getRouteDeliverySyncRouteAllowlistConfigError,
  isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';

const ALLOWLISTED_UID = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2';

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

  it('allows only the hard-coded v1 rollout UID', () => {
    expect(getRouteDeliverySyncRouteAllowlistConfigError(ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI)).toBeNull();
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      ALLOWLISTED_UID,
    )).toBe(true);
    expect(isRouteDeliverySyncRouteUserAllowlisted(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      'someone-else',
    )).toBe(false);
  });
});
