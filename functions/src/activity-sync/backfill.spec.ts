import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTES, ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';

interface CallableRequestMock {
  app: { appId: string };
  auth: { uid: string } | null;
  data: {
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    startDate: string;
    endDate: string;
  };
}

type CallableHandlerMock = (request: CallableRequestMock) => unknown;
type BackfillCallableMock = (request: CallableRequestMock) => Promise<unknown>;

const {
  mockEventsGet,
  mockEventsOrderBy,
  mockEventsStartAfter,
  mockEventsLimit,
  mockHasProAccess,
  mockGetActivitySyncRouteAllowlistConfigError,
  mockIsActivitySyncRouteUserAllowlisted,
  mockEnqueueActivitySyncJobsForImportedEvent,
  mockSetActivitySyncSkippedMetadata,
  mockGetActivitySyncMetadataDocId,
  mockRequestGet,
} = vi.hoisted(() => ({
  mockEventsGet: vi.fn(),
  mockEventsOrderBy: vi.fn(),
  mockEventsStartAfter: vi.fn(),
  mockEventsLimit: vi.fn(),
  mockHasProAccess: vi.fn(),
  mockGetActivitySyncRouteAllowlistConfigError: vi.fn(),
  mockIsActivitySyncRouteUserAllowlisted: vi.fn(),
  mockEnqueueActivitySyncJobsForImportedEvent: vi.fn(),
  mockSetActivitySyncSkippedMetadata: vi.fn().mockResolvedValue(undefined),
  mockGetActivitySyncMetadataDocId: vi.fn((routeId: string) => `activitySync_${routeId}`),
  mockRequestGet: vi.fn(),
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

vi.mock('./enqueue-imported-event', () => ({
  enqueueActivitySyncJobsForImportedEvent: mockEnqueueActivitySyncJobsForImportedEvent,
}));

vi.mock('./allowlist', () => ({
  getActivitySyncRouteAllowlistConfigError: mockGetActivitySyncRouteAllowlistConfigError,
  isActivitySyncRouteUserAllowlisted: mockIsActivitySyncRouteUserAllowlisted,
}));

vi.mock('./metadata', () => ({
  getActivitySyncMetadataDocId: mockGetActivitySyncMetadataDocId,
  setActivitySyncSkippedMetadata: mockSetActivitySyncSkippedMetadata,
}));

vi.mock('../request-helper', () => ({
  get: mockRequestGet,
}));

vi.mock('firebase-admin', () => {
  interface EventsQueryMock {
    where: ReturnType<typeof vi.fn>;
    orderBy: typeof mockEventsOrderBy;
    startAfter: typeof mockEventsStartAfter;
    limit: typeof mockEventsLimit;
    get: typeof mockEventsGet;
  }

  const eventsQuery: EventsQueryMock = {
    where: vi.fn(),
    orderBy: mockEventsOrderBy,
    startAfter: mockEventsStartAfter,
    limit: mockEventsLimit,
    get: mockEventsGet,
  };
  eventsQuery.where.mockReturnValue(eventsQuery);
  mockEventsOrderBy.mockReturnValue(eventsQuery);
  mockEventsStartAfter.mockReturnValue(eventsQuery);
  mockEventsLimit.mockReturnValue(eventsQuery);

  return {
    firestore: () => ({
      collection: vi.fn((name: string) => {
        if (name !== 'users') {
          throw new Error(`Unexpected top collection: ${name}`);
        }
        return {
          doc: vi.fn(() => ({
            collection: vi.fn((subName: string) => {
              if (subName === 'events') {
                return eventsQuery;
              }
              throw new Error(`Unexpected sub collection: ${subName}`);
            }),
          })),
        };
      }),
    }),
  };
});

import { backfillActivitySyncRoute } from './backfill';

const invokeBackfill = (request: CallableRequestMock): Promise<unknown> =>
  (backfillActivitySyncRoute as unknown as BackfillCallableMock)(request);

describe('activity-sync/backfill callable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasProAccess.mockResolvedValue(true);
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue(null);
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(true);
    mockEnqueueActivitySyncJobsForImportedEvent.mockResolvedValue({ queued: 1, skippedByReason: {} });
    mockEventsGet.mockResolvedValue({ empty: true, docs: [] });
  });

  it('rejects unsupported source/destination routes', async () => {
    await expect(invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: ServiceNames.SuuntoApp,
        destinationServiceName: ServiceNames.GarminAPI,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      },
    })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects non-allowlisted users for supported routes', async () => {
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(false);

    const route = ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp];
    await expect(invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      },
    })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(mockEventsGet).not.toHaveBeenCalled();
  });

  it('rejects allowlist misconfiguration before scanning events', async () => {
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue('allowlist misconfigured');
    const route = ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp];

    await expect(invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      },
    })).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(mockIsActivitySyncRouteUserAllowlisted).not.toHaveBeenCalled();
    expect(mockEventsGet).not.toHaveBeenCalled();
  });

  it('scans events in date range, queues eligible items, and skips unsupported cases without source downloads', async () => {
    const route = ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp];
    const sourceServiceName = route.sourceServiceName;
    const routeMetaDocId = `activitySync_${route.id}`;
    let sourceMetadataReads = 0;
    let routeMetadataReads = 0;

    const makeEventDoc = (params: {
      eventID: string;
      eventData: Record<string, unknown>;
      hasSourceMeta: boolean;
      sourceMetaData?: Record<string, unknown>;
      existingRouteStatus?: string;
    }) => {
      const metaDataCollection = {
        doc: vi.fn((docID: string) => ({
          get: vi.fn(async () => {
            if (docID === sourceServiceName) {
              sourceMetadataReads += 1;
              return {
                exists: params.hasSourceMeta,
                data: () => params.sourceMetaData || {},
              };
            }

            if (docID === routeMetaDocId) {
              routeMetadataReads += 1;
              return {
                exists: !!params.existingRouteStatus,
                data: () => params.existingRouteStatus ? { status: params.existingRouteStatus } : undefined,
              };
            }

            return { exists: false, data: () => undefined };
          }),
        })),
      };

      return {
        id: params.eventID,
        data: () => params.eventData,
        ref: {
          collection: vi.fn((name: string) => {
            if (name !== 'metaData') {
              throw new Error(`Unexpected nested collection: ${name}`);
            }
            return metaDataCollection;
          }),
        },
      };
    };

    mockEventsGet.mockResolvedValue({
      docs: [
        makeEventDoc({
          eventID: 'event-eligible',
          eventData: {
            originalFiles: [{ path: 'users/user-1/events/event-eligible/original.fit' }],
          },
          hasSourceMeta: true,
          sourceMetaData: { activityFileID: 'garmin-1' },
        }),
        makeEventDoc({
          eventID: 'event-already-synced',
          eventData: {
            originalFiles: [{ path: 'users/user-1/events/event-already-synced/original.fit' }],
          },
          hasSourceMeta: true,
          sourceMetaData: { activityFileID: 'garmin-2' },
          existingRouteStatus: 'success',
        }),
        makeEventDoc({
          eventID: 'event-missing-originals',
          eventData: {},
          hasSourceMeta: true,
          sourceMetaData: { activityFileID: 'garmin-3' },
        }),
        makeEventDoc({
          eventID: 'event-missing-source-meta',
          eventData: {
            originalFiles: [{ path: 'users/user-1/events/event-missing-source-meta/original.fit' }],
          },
          hasSourceMeta: false,
        }),
      ],
    });

    mockGetActivitySyncMetadataDocId.mockReturnValue(routeMetaDocId);

    const response = await invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      },
    });

    expect(response).toEqual({
      scanned: 4,
      queued: 1,
      skippedByReason: {
        already_synced: 1,
        missing_original_files: 1,
      },
      failedCount: 0,
      failedEvents: [],
    });

    expect(mockEnqueueActivitySyncJobsForImportedEvent).toHaveBeenCalledTimes(1);
    expect(mockEnqueueActivitySyncJobsForImportedEvent).toHaveBeenCalledWith(expect.objectContaining({
      userID: 'user-1',
      eventID: 'event-eligible',
      sourceServiceName: route.sourceServiceName,
      sourceActivityID: 'garmin-1',
      manual: true,
    }));

    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledTimes(1);
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'missing_original_files',
    }));
    expect(sourceMetadataReads).toBe(4);
    expect(routeMetadataReads).toBe(3);
    expect(mockRequestGet).not.toHaveBeenCalled();
  });

  it('returns failed events summary when one event processing fails and continues scanning', async () => {
    const route = ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp];
    const sourceServiceName = route.sourceServiceName;
    const routeMetaDocId = `activitySync_${route.id}`;

    const makeEventDoc = (eventID: string, sourceActivityID: string) => {
      const metaDataCollection = {
        doc: vi.fn((docID: string) => ({
          get: vi.fn(async () => {
            if (docID === sourceServiceName) {
              return {
                exists: true,
                data: () => ({ activityFileID: sourceActivityID }),
              };
            }

            if (docID === routeMetaDocId) {
              return {
                exists: false,
                data: () => undefined,
              };
            }

            return { exists: false, data: () => undefined };
          }),
        })),
      };

      return {
        id: eventID,
        data: () => ({
          originalFiles: [{ path: `users/user-1/events/${eventID}/original.fit` }],
        }),
        ref: {
          collection: vi.fn((name: string) => {
            if (name !== 'metaData') {
              throw new Error(`Unexpected nested collection: ${name}`);
            }
            return metaDataCollection;
          }),
        },
      };
    };

    mockEventsGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeEventDoc('event-fail', 'garmin-fail'),
        makeEventDoc('event-success', 'garmin-success'),
      ],
    });
    mockGetActivitySyncMetadataDocId.mockReturnValue(routeMetaDocId);
    mockEnqueueActivitySyncJobsForImportedEvent
      .mockRejectedValueOnce(new Error('queue enqueue failed'))
      .mockResolvedValueOnce({ queued: 1, skippedByReason: {} });

    const response = await invokeBackfill({
      app: { appId: 'test-app' },
      auth: { uid: 'user-1' },
      data: {
        sourceServiceName: route.sourceServiceName,
        destinationServiceName: route.destinationServiceName,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      },
    });

    expect(response).toEqual({
      scanned: 2,
      queued: 1,
      skippedByReason: {},
      failedCount: 1,
      failedEvents: [
        {
          eventID: 'event-fail',
          reason: 'event_processing_failed',
          message: 'queue enqueue failed',
        },
      ],
    });
    expect(mockEnqueueActivitySyncJobsForImportedEvent).toHaveBeenCalledTimes(2);
  });
});
