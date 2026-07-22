import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_DELIVERY_SYNC_ROUTES, ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

const {
  mockMetadataDocs,
  mockIsRouteEnabled,
  mockAllowlistConfigError,
  mockIsAllowlisted,
  mockEnqueueQueueItem,
  mockShouldSkipDeletedUser,
} = vi.hoisted(() => ({
  mockMetadataDocs: vi.fn(),
  mockIsRouteEnabled: vi.fn(),
  mockAllowlistConfigError: vi.fn(),
  mockIsAllowlisted: vi.fn(),
  mockEnqueueQueueItem: vi.fn(),
  mockShouldSkipDeletedUser: vi.fn(),
}));

vi.mock('./settings', () => ({
  isRouteDeliverySyncRouteEnabledForUser: mockIsRouteEnabled,
}));

vi.mock('./allowlist', () => ({
  getRouteDeliverySyncRouteAllowlistConfigError: mockAllowlistConfigError,
  isRouteDeliverySyncRouteUserAllowlisted: mockIsAllowlisted,
}));

vi.mock('./queue', () => ({
  enqueueRouteDeliverySyncQueueItem: mockEnqueueQueueItem,
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipDeletedUser,
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn((collectionName: string) => {
      if (collectionName !== 'users') {
        throw new Error(`Unexpected collection: ${collectionName}`);
      }
      return {
        doc: vi.fn(() => ({
          collection: vi.fn((subcollectionName: string) => {
            if (subcollectionName !== 'routes') {
              throw new Error(`Unexpected user subcollection: ${subcollectionName}`);
            }
            return {
              doc: vi.fn(() => ({
                collection: vi.fn((routeSubcollectionName: string) => {
                  if (routeSubcollectionName !== 'metaData') {
                    throw new Error(`Unexpected route subcollection: ${routeSubcollectionName}`);
                  }
                  return {
                    get: vi.fn(async () => ({
                      docs: mockMetadataDocs().map((data: Record<string, unknown>) => ({
                        data: () => data,
                      })),
                    })),
                  };
                }),
              })),
            };
          }),
        })),
      };
    }),
  }),
}));

import { enqueueRouteDeliverySyncJobsForImportedRoute } from './enqueue-imported-route';

const routeId = ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI;
const route = ROUTE_DELIVERY_SYNC_ROUTES[routeId];
const wahooRouteId = ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI;

function baseParams() {
  return {
    userID: 'user-1',
    savedRouteID: 'route-1',
    sourceServiceName: route.sourceServiceName,
    sourceProviderRouteId: 'suunto-route-1',
    sourceProviderUserId: 'suunto-user-1',
    sourceRevisionKey: `${route.sourceServiceName}:suunto-route-1:1710000000000`,
    routeIdFilter: routeId,
  };
}

describe('route-delivery-sync/enqueue-imported-route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMetadataDocs.mockReturnValue([]);
    mockIsRouteEnabled.mockResolvedValue(true);
    mockAllowlistConfigError.mockReturnValue(null);
    mockIsAllowlisted.mockReturnValue(true);
    mockShouldSkipDeletedUser.mockResolvedValue(false);
    mockEnqueueQueueItem.mockResolvedValue({
      enqueued: true,
      queueItemId: 'queue-1',
    });
  });

  it('skips automatic enqueue when durable delivery metadata already succeeded for the same revision', async () => {
    mockMetadataDocs.mockReturnValueOnce([{
      serviceName: route.destinationServiceName,
      status: 'success',
      routeSyncRouteId: routeId,
      sourceRevisionKey: `${route.sourceServiceName}:suunto-route-1:1710000000000`,
    }]);

    const result = await enqueueRouteDeliverySyncJobsForImportedRoute(baseParams());

    expect(result).toEqual({
      queued: 0,
      skippedByReason: {
        already_synced: 1,
      },
    });
    expect(mockEnqueueQueueItem).not.toHaveBeenCalled();
  });

  it('queues automatic delivery when existing durable metadata is for an older revision', async () => {
    mockMetadataDocs.mockReturnValueOnce([{
      serviceName: route.destinationServiceName,
      status: 'success',
      routeSyncRouteId: routeId,
      sourceRevisionKey: `${route.sourceServiceName}:suunto-route-1:1700000000000`,
    }]);

    const result = await enqueueRouteDeliverySyncJobsForImportedRoute(baseParams());

    expect(result).toEqual({
      queued: 1,
      skippedByReason: {},
    });
    expect(mockEnqueueQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      routeId,
      userID: 'user-1',
      savedRouteID: 'route-1',
      sourceRevisionKey: `${route.sourceServiceName}:suunto-route-1:1710000000000`,
    }));
  });

  it('allows callers that already checked durable metadata to skip the metadata read', async () => {
    mockMetadataDocs.mockReturnValueOnce([{
      serviceName: route.destinationServiceName,
      status: 'success',
      routeSyncRouteId: routeId,
      sourceRevisionKey: `${route.sourceServiceName}:suunto-route-1:1710000000000`,
    }]);

    const result = await enqueueRouteDeliverySyncJobsForImportedRoute({
      ...baseParams(),
      skipExistingSuccessfulDeliveryCheck: true,
    });

    expect(result).toEqual({
      queued: 1,
      skippedByReason: {},
    });
    expect(mockMetadataDocs).not.toHaveBeenCalled();
    expect(mockEnqueueQueueItem).toHaveBeenCalled();
  });

  it('queues one delivery per enabled Suunto destination', async () => {
    mockMetadataDocs.mockReset();
    mockMetadataDocs.mockReturnValue([]);
    const result = await enqueueRouteDeliverySyncJobsForImportedRoute({
      ...baseParams(),
      routeIdFilter: undefined,
    });

    expect(result).toEqual({
      queued: 2,
      skippedByReason: {},
    });
    expect(mockEnqueueQueueItem).toHaveBeenCalledWith(expect.objectContaining({ routeId }));
    expect(mockEnqueueQueueItem).toHaveBeenCalledWith(expect.objectContaining({ routeId: wahooRouteId }));
  });
});
