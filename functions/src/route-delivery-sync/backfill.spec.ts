import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTES, ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

interface CallableRequestMock {
  app: { appId: string };
  auth: { uid: string } | null;
  data: {
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
  };
}

type CallableHandlerMock = (request: CallableRequestMock) => unknown;
type BackfillCallableMock = (request: CallableRequestMock) => Promise<unknown>;

const {
  mockRoutesGet,
  mockRoutesOrderBy,
  mockRoutesStartAfter,
  mockRoutesLimit,
  mockHasProAccess,
  mockGetRouteDeliverySyncRouteAllowlistConfigError,
  mockIsRouteDeliverySyncRouteUserAllowlisted,
  mockEnqueueRouteDeliverySyncJobsForImportedRoute,
  mockDocumentId,
} = vi.hoisted(() => ({
  mockRoutesGet: vi.fn(),
  mockRoutesOrderBy: vi.fn(),
  mockRoutesStartAfter: vi.fn(),
  mockRoutesLimit: vi.fn(),
  mockHasProAccess: vi.fn(),
  mockGetRouteDeliverySyncRouteAllowlistConfigError: vi.fn(),
  mockIsRouteDeliverySyncRouteUserAllowlisted: vi.fn(),
  mockEnqueueRouteDeliverySyncJobsForImportedRoute: vi.fn(),
  mockDocumentId: vi.fn(() => '__name__'),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: CallableHandlerMock) => handler,
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    ALLOWED_CORS_ORIGINS: ['*'],
    enforceAppCheck: vi.fn(),
    hasProAccess: mockHasProAccess,
    PRO_REQUIRED_MESSAGE: 'Service sync is a Pro feature. Please upgrade to Pro.',
  };
});

vi.mock('./enqueue-imported-route', () => ({
  enqueueRouteDeliverySyncJobsForImportedRoute: mockEnqueueRouteDeliverySyncJobsForImportedRoute,
}));

vi.mock('./revision', () => ({
  buildRouteDeliverySourceRevisionKey: vi.fn((parts: {
    sourceServiceName: string;
    providerRouteId?: string | null;
    providerRouteModifiedAt?: unknown;
    fallbackUpdatedAt?: unknown;
    fallbackRouteID: string;
  }) => `${parts.sourceServiceName}:${parts.providerRouteId || parts.fallbackRouteID}:${parts.providerRouteModifiedAt || parts.fallbackUpdatedAt || parts.fallbackRouteID}`),
}));

vi.mock('./allowlist', () => ({
  getRouteDeliverySyncRouteAllowlistConfigError: mockGetRouteDeliverySyncRouteAllowlistConfigError,
  isRouteDeliverySyncRouteUserAllowlisted: mockIsRouteDeliverySyncRouteUserAllowlisted,
}));

vi.mock('firebase-admin', () => {
  interface RoutesQueryMock {
    orderBy: typeof mockRoutesOrderBy;
    startAfter: typeof mockRoutesStartAfter;
    limit: typeof mockRoutesLimit;
    get: typeof mockRoutesGet;
  }

  const routesQuery: RoutesQueryMock = {
    orderBy: mockRoutesOrderBy,
    startAfter: mockRoutesStartAfter,
    limit: mockRoutesLimit,
    get: mockRoutesGet,
  };
  mockRoutesOrderBy.mockReturnValue(routesQuery);
  mockRoutesStartAfter.mockReturnValue(routesQuery);
  mockRoutesLimit.mockReturnValue(routesQuery);

  const firestoreFn = Object.assign(() => ({
    collection: vi.fn((name: string) => {
      if (name !== 'users') {
        throw new Error(`Unexpected top collection: ${name}`);
      }
      return {
        doc: vi.fn(() => ({
          collection: vi.fn((subName: string) => {
            if (subName === 'routes') {
              return routesQuery;
            }
            throw new Error(`Unexpected sub collection: ${subName}`);
          }),
        })),
      };
    }),
  }), {
    FieldPath: { documentId: mockDocumentId },
  });

  return {
    firestore: firestoreFn,
  };
});

import { backfillRouteDeliverySyncRoute } from './backfill';

const invokeBackfill = (request: CallableRequestMock): Promise<unknown> =>
  (backfillRouteDeliverySyncRoute as unknown as BackfillCallableMock)(request);

function makeRouteDoc(params: {
  routeID: string;
  data: Record<string, unknown>;
  metadataDocs?: Record<string, unknown>[];
}) {
  const metadataGet = vi.fn(async () => ({
    docs: (params.metadataDocs || []).map(data => ({ data: () => data })),
  }));

  return {
    id: params.routeID,
    data: () => params.data,
    ref: {
      collection: vi.fn((name: string) => {
        if (name !== 'metaData') {
          throw new Error(`Unexpected route nested collection: ${name}`);
        }
        return { get: metadataGet };
      }),
    },
  };
}

const route = ROUTE_DELIVERY_SYNC_ROUTES[ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI];

describe('route-delivery-sync/backfill callable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasProAccess.mockResolvedValue(true);
    mockGetRouteDeliverySyncRouteAllowlistConfigError.mockReturnValue(null);
    mockIsRouteDeliverySyncRouteUserAllowlisted.mockReturnValue(true);
    mockEnqueueRouteDeliverySyncJobsForImportedRoute.mockResolvedValue({ queued: 1, skippedByReason: {} });
    mockRoutesGet.mockResolvedValue({ empty: true, size: 0, docs: [] });
  });

  it('rejects unsupported source/destination routes', async () => {
    await expect(invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.destinationServiceName,
        destinationServiceName: route.sourceServiceName,
      },
    })).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(mockRoutesGet).not.toHaveBeenCalled();
  });

  it('rejects non-allowlisted users before scanning routes', async () => {
    mockIsRouteDeliverySyncRouteUserAllowlisted.mockReturnValue(false);

    await expect(invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
      },
    })).rejects.toMatchObject({ code: 'permission-denied' });

    expect(mockRoutesGet).not.toHaveBeenCalled();
  });

  it('paginates saved routes and enqueues only Suunto routes missing current-revision Garmin delivery', async () => {
    const fillerPage = Array.from({ length: 200 }, (_, index) => makeRouteDoc({
      routeID: `manual-${index}`,
      data: {
        sourceSummary: { sourceServiceName: route.destinationServiceName },
      },
    }));
    const eligibleRoute = makeRouteDoc({
      routeID: 'route-eligible',
      data: {
        originalFiles: [{ path: 'users/user-1/routes/route-eligible/original.gpx' }],
        sourceSummary: {
          sourceServiceName: route.sourceServiceName,
          providerRouteId: 'suunto-route-1',
          providerUserId: 'suunto-user-1',
          modifiedAt: 1710000000000,
        },
      },
      metadataDocs: [],
    });
    const alreadySyncedRoute = makeRouteDoc({
      routeID: 'route-already-synced',
      data: {
        originalFile: { path: 'users/user-1/routes/route-already-synced/original.gpx' },
        sourceSummary: {
          sourceServiceName: route.sourceServiceName,
          providerRouteId: 'suunto-route-2',
          modifiedAt: 1710000000001,
        },
      },
      metadataDocs: [{
        serviceName: route.destinationServiceName,
        status: 'success',
        routeSyncRouteId: route.id,
        sourceRevisionKey: `${route.sourceServiceName}:suunto-route-2:1710000000001`,
      }],
    });
    const updatedSinceLastDeliveryRoute = makeRouteDoc({
      routeID: 'route-updated',
      data: {
        syncedDestinationServiceNames: [route.destinationServiceName],
        originalFile: { path: 'users/user-1/routes/route-updated/original.gpx' },
        sourceSummary: {
          sourceServiceName: route.sourceServiceName,
          providerRouteId: 'suunto-route-3',
          modifiedAt: 1710000000002,
        },
      },
      metadataDocs: [{
        serviceName: route.destinationServiceName,
        status: 'success',
        routeSyncRouteId: route.id,
        sourceRevisionKey: `${route.sourceServiceName}:suunto-route-3:1700000000000`,
      }],
    });
    const missingOriginalRoute = makeRouteDoc({
      routeID: 'route-missing-original',
      data: {
        sourceSummary: {
          sourceServiceName: route.sourceServiceName,
          providerRouteId: 'suunto-route-4',
          modifiedAt: 1710000000003,
        },
      },
    });

    mockRoutesGet
      .mockResolvedValueOnce({ empty: false, size: fillerPage.length, docs: fillerPage })
      .mockResolvedValueOnce({
        empty: false,
        size: 4,
        docs: [eligibleRoute, alreadySyncedRoute, updatedSinceLastDeliveryRoute, missingOriginalRoute],
      });

    const response = await invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
      },
    });
    expect(response).toEqual({
      scanned: 204,
      queued: 2,
      skippedByReason: {
        already_synced: 1,
        missing_original_files: 1,
      },
      failedCount: 0,
      failedRoutes: [],
    });
    expect(mockRoutesOrderBy).toHaveBeenCalledWith('__name__');
    expect(mockRoutesLimit).toHaveBeenCalledWith(200);
    expect(mockRoutesStartAfter).toHaveBeenCalledWith(fillerPage[199]);
    expect(mockEnqueueRouteDeliverySyncJobsForImportedRoute).toHaveBeenCalledTimes(2);
    expect(mockEnqueueRouteDeliverySyncJobsForImportedRoute).toHaveBeenCalledWith(expect.objectContaining({
      userID: 'user-1',
      savedRouteID: 'route-eligible',
      sourceServiceName: route.sourceServiceName,
      sourceProviderRouteId: 'suunto-route-1',
      sourceProviderUserId: 'suunto-user-1',
      sourceRevisionKey: `${route.sourceServiceName}:suunto-route-1:1710000000000`,
      routeIdFilter: route.id,
      manual: true,
      respectRouteEnabled: false,
    }));
    expect(mockEnqueueRouteDeliverySyncJobsForImportedRoute).toHaveBeenCalledWith(expect.objectContaining({
      savedRouteID: 'route-updated',
      sourceRevisionKey: `${route.sourceServiceName}:suunto-route-3:1710000000002`,
    }));
  });

  it('returns failed route summaries when enqueueing one route fails and continues scanning', async () => {
    const failingRoute = makeRouteDoc({
      routeID: 'route-fail',
      data: {
        originalFile: { path: 'users/user-1/routes/route-fail/original.gpx' },
        sourceSummary: {
          sourceServiceName: route.sourceServiceName,
          providerRouteId: 'suunto-route-fail',
          modifiedAt: 1710000000000,
        },
      },
    });
    const successRoute = makeRouteDoc({
      routeID: 'route-success',
      data: {
        originalFile: { path: 'users/user-1/routes/route-success/original.gpx' },
        sourceSummary: {
          sourceServiceName: route.sourceServiceName,
          providerRouteId: 'suunto-route-success',
          modifiedAt: 1710000000001,
        },
      },
    });

    mockRoutesGet.mockResolvedValueOnce({ empty: false, size: 2, docs: [failingRoute, successRoute] });
    mockEnqueueRouteDeliverySyncJobsForImportedRoute
      .mockRejectedValueOnce(new Error('queue enqueue failed'))
      .mockResolvedValueOnce({ queued: 1, skippedByReason: {} });

    const response = await invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
      },
    });

    expect(response).toEqual({
      scanned: 2,
      queued: 1,
      skippedByReason: {},
      failedCount: 1,
      failedRoutes: [{
        routeID: 'route-fail',
        reason: 'route_processing_failed',
        message: 'queue enqueue failed',
      }],
    });
  });
});
