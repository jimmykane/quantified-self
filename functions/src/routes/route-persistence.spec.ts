'use strict';

import { describe, expect, it } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

import {
  buildRouteDocumentForWrite,
  getUserOwnedRouteFields,
} from './route-persistence';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';

describe('route-persistence', () => {
  it('preserves normalized delivery summaries from the existing route document', () => {
    const existingRouteDocument: FirestoreRouteJSON = {
      id: 'route-1',
      userID: 'user-1',
      name: 'Saved route',
      syncedDestinationServiceNames: [ServiceNames.SuuntoApp],
      deliverySummaries: [
        {
          serviceName: ServiceNames.GarminAPI,
          providerUserIds: ['garmin-user-2', '', 'garmin-user-1', 'garmin-user-2'],
          latestProviderUserId: 'garmin-user-2',
        },
        {
          serviceName: '',
        },
      ] as unknown as FirestoreRouteJSON['deliverySummaries'],
    };

    const routeDocument = buildRouteDocumentForWrite({
      routeId: 'route-1',
      userID: 'user-1',
      parsedPayload: {
        name: 'Parsed route',
        deliverySummaries: [{
          serviceName: ServiceNames.GarminAPI,
          providerUserIds: ['other-account'],
          latestProviderUserId: 'other-account',
        }],
      },
      existingRouteDocument,
      preserveImportedAt: true,
    });

    expect(routeDocument.deliverySummaries).toEqual([{
      serviceName: ServiceNames.GarminAPI,
      providerUserIds: ['garmin-user-1', 'garmin-user-2'],
      latestProviderUserId: 'garmin-user-2',
      updatedAt: null,
    }]);
  });

  it('strips delivery summaries from user-owned route fields', () => {
    expect(getUserOwnedRouteFields({
      id: 'route-1',
      userID: 'user-1',
      name: 'Saved route',
      deliverySummaries: [{
        serviceName: ServiceNames.GarminAPI,
        providerUserIds: ['garmin-user-1'],
      }],
      syncedDestinationServiceNames: [ServiceNames.GarminAPI],
      customField: 'keep-me',
    } as FirestoreRouteJSON)).toEqual({
      name: 'Saved route',
      customField: 'keep-me',
    });
  });
});
