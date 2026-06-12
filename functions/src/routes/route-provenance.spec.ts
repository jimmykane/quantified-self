'use strict';

import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { getRouteDeliveryMetadataDocId } from '../../../shared/route-provenance';

describe('getRouteDeliveryMetadataDocId', () => {
  it('keeps service-only delivery ids for non-account-scoped destinations', () => {
    expect(getRouteDeliveryMetadataDocId(ServiceNames.GarminAPI)).toBe('delivery_garminAPI');
  });

  it('scopes delivery ids by provider user identity when present', () => {
    expect(getRouteDeliveryMetadataDocId(ServiceNames.SuuntoApp, 'user/name')).toBe(
      'delivery_suuntoApp_user%2Fname',
    );
  });
});
