import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

const {
  mockHasProAccess,
  mockIsRouteEnabled,
  mockAllowlistConfigError,
  mockIsAllowlisted,
  mockShouldSkipDeletedUser,
  mockUpdateToProcessed,
  mockMarkQueueItemSkipped,
  mockIncreaseRetryCount,
  mockMoveToDLQ,
  mockSetRouteDeliveryMetadata,
  mockAssertRouteSendUserActive,
  mockGetRouteSendAdapter,
  mockCreateContext,
  mockPrepareSavedRoute,
  mockSendPreparedRoute,
  mockPersistRouteDeliveryMetadata,
  mockIsAccountDeletionSkipError,
  mockIsDestinationAuthRequiredError,
  mockIsDestinationPermissionRequiredError,
  mockIsDeliveryMetadataPersistenceError,
  MockRouteSendItemError,
} = vi.hoisted(() => ({
  mockHasProAccess: vi.fn(),
  mockIsRouteEnabled: vi.fn(),
  mockAllowlistConfigError: vi.fn(),
  mockIsAllowlisted: vi.fn(),
  mockShouldSkipDeletedUser: vi.fn(),
  mockUpdateToProcessed: vi.fn(),
  mockMarkQueueItemSkipped: vi.fn(),
  mockIncreaseRetryCount: vi.fn(),
  mockMoveToDLQ: vi.fn(),
  mockSetRouteDeliveryMetadata: vi.fn(),
  mockAssertRouteSendUserActive: vi.fn(),
  mockGetRouteSendAdapter: vi.fn(),
  mockCreateContext: vi.fn(),
  mockPrepareSavedRoute: vi.fn(),
  mockSendPreparedRoute: vi.fn(),
  mockPersistRouteDeliveryMetadata: vi.fn(),
  mockIsAccountDeletionSkipError: vi.fn(),
  mockIsDestinationAuthRequiredError: vi.fn(),
  mockIsDestinationPermissionRequiredError: vi.fn(),
  mockIsDeliveryMetadataPersistenceError: vi.fn(),
  MockRouteSendItemError: class MockRouteSendItemError extends Error {
    constructor(
      public readonly reason: string,
      message: string,
    ) {
      super(message);
      this.name = 'RouteSendItemError';
    }
  },
}));

vi.mock('../utils', () => ({
  hasProAccess: mockHasProAccess,
}));

vi.mock('./settings', () => ({
  isRouteDeliverySyncRouteEnabledForUser: mockIsRouteEnabled,
}));

vi.mock('./allowlist', () => ({
  getRouteDeliverySyncRouteAllowlistConfigError: mockAllowlistConfigError,
  isRouteDeliverySyncRouteUserAllowlisted: mockIsAllowlisted,
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipDeletedUser,
}));

vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
    Skipped: 'SKIPPED',
    Deferred: 'DEFERRED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    RetryIncremented: 'RETRY_INCREMENTED',
    Failed: 'FAILED',
  },
  QUEUE_SKIPPED_REASONS: {
    UserDeletedOrDeleting: 'user_deleted_or_deleting',
  },
  updateToProcessed: mockUpdateToProcessed,
  markQueueItemSkipped: mockMarkQueueItemSkipped,
  increaseRetryCountForQueueItem: mockIncreaseRetryCount,
  moveToDeadLetterQueue: mockMoveToDLQ,
}));

vi.mock('../routes/route-send-core', () => ({
  assertRouteSendUserActive: mockAssertRouteSendUserActive,
  getRouteSendAdapter: mockGetRouteSendAdapter,
  prepareSavedRouteForSending: mockPrepareSavedRoute,
  sendPreparedRouteToDestination: mockSendPreparedRoute,
  persistRouteDeliveryMetadataAfterSend: mockPersistRouteDeliveryMetadata,
  isAccountDeletionSkipError: mockIsAccountDeletionSkipError,
  isDestinationAuthRequiredError: mockIsDestinationAuthRequiredError,
  isDestinationPermissionRequiredError: mockIsDestinationPermissionRequiredError,
  isDeliveryMetadataPersistenceError: mockIsDeliveryMetadataPersistenceError,
  RouteSendItemError: MockRouteSendItemError,
}));

vi.mock('../routes/route-persistence', () => ({
  setRouteDeliveryMetadata: mockSetRouteDeliveryMetadata,
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

import { QueueResult } from '../queue-utils';
import { RouteDeliverySyncQueueItemInterface } from '../queue/queue-item.interface';
import { processRouteDeliverySyncQueueItem } from './process-queue-item';

type QueueItemRefMock = RouteDeliverySyncQueueItemInterface['ref'];
const CURRENT_SOURCE_REVISION_KEY = `${ServiceNames.SuuntoApp}:provider-route-1:1710000000000`;
const STALE_SOURCE_REVISION_KEY = `${ServiceNames.SuuntoApp}:provider-route-1:1700000000000`;

const baseQueueItem: RouteDeliverySyncQueueItemInterface = {
  id: 'queue-1',
  dateCreated: 1,
  processed: false,
  retryCount: 0,
  totalRetryCount: 0,
  dispatchedToCloudTask: 1,
  routeId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
  sourceServiceName: ServiceNames.SuuntoApp,
  destinationServiceName: ServiceNames.GarminAPI,
  userID: 'user-1',
  savedRouteID: 'route-1',
  sourceRevisionKey: CURRENT_SOURCE_REVISION_KEY,
  sourceProviderRouteId: 'provider-route-1',
  sourceProviderUserId: 'suunto-user',
  manual: false,
  ref: { update: vi.fn(), parent: { id: 'routeDeliverySyncQueue' } } as QueueItemRefMock,
};

function mockSuccessfulPrerequisites(): void {
  mockShouldSkipDeletedUser.mockResolvedValue(false);
  mockAllowlistConfigError.mockReturnValue(null);
  mockIsAllowlisted.mockReturnValue(true);
  mockHasProAccess.mockResolvedValue(true);
  mockIsRouteEnabled.mockResolvedValue(true);
  mockSetRouteDeliveryMetadata.mockResolvedValue(undefined);
  mockAssertRouteSendUserActive.mockResolvedValue(undefined);
  mockCreateContext.mockResolvedValue({ context: true });
  mockGetRouteSendAdapter.mockReturnValue({
    destinationServiceName: ServiceNames.GarminAPI,
    createContext: mockCreateContext,
    sendRoute: vi.fn(),
  });
  mockPrepareSavedRoute.mockResolvedValue({
    routeId: 'route-1',
    routeDocument: {
      sourceSummary: {
        sourceServiceName: ServiceNames.SuuntoApp,
        providerRouteId: 'provider-route-1',
        providerUserId: 'suunto-user',
        modifiedAt: 1710000000000,
      },
    },
    routeFile: {},
    sourceFile: { path: 'route.gpx' },
    gpxContent: '<gpx />',
  });
  mockSendPreparedRoute.mockResolvedValue({
    providerRouteId: 'garmin-course-1',
    deliveries: [{ providerUserId: 'garmin-user', providerRouteId: 'garmin-course-1' }],
  });
  mockPersistRouteDeliveryMetadata.mockResolvedValue(undefined);
  mockUpdateToProcessed.mockResolvedValue(QueueResult.Processed);
  mockMarkQueueItemSkipped.mockResolvedValue(QueueResult.Processed);
  mockIncreaseRetryCount.mockResolvedValue(QueueResult.RetryIncremented);
  mockMoveToDLQ.mockResolvedValue(QueueResult.MovedToDLQ);
  mockIsAccountDeletionSkipError.mockReturnValue(false);
  mockIsDestinationAuthRequiredError.mockReturnValue(false);
  mockIsDestinationPermissionRequiredError.mockReturnValue(false);
  mockIsDeliveryMetadataPersistenceError.mockReturnValue(false);
}

describe('route-delivery-sync/process-queue-item', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuccessfulPrerequisites();
  });

  it('sends a prepared Suunto route to Garmin and marks the queue item successful', async () => {
    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSendPreparedRoute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ routeId: 'route-1' }),
      expect.objectContaining({ destinationServiceName: ServiceNames.GarminAPI }),
      { context: true },
    );
    expect(mockPersistRouteDeliveryMetadata).toHaveBeenCalledWith(expect.objectContaining({
      userID: 'user-1',
      routeID: 'route-1',
      destinationServiceName: ServiceNames.GarminAPI,
      providerRouteId: 'garmin-course-1',
      routeSyncRouteId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      sourceRevisionKey: CURRENT_SOURCE_REVISION_KEY,
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      resultStatus: 'success',
      destinationProviderRouteId: 'garmin-course-1',
    }));
  });

  it('uses stable source import timestamps for revision checks when provider modified time is missing', async () => {
    const importedAt = '2026-02-01T12:00:00.000Z';
    mockPrepareSavedRoute.mockResolvedValue({
      routeId: 'route-1',
      routeDocument: {
        importedAt: '2026-02-01T12:00:01.000Z',
        updatedAt: '2026-02-03T12:00:00.000Z',
        sourceSummary: {
          sourceServiceName: ServiceNames.SuuntoApp,
          providerRouteId: 'provider-route-1',
          providerUserId: 'suunto-user',
          importedAt,
        },
      },
      routeFile: {},
      sourceFile: { path: 'route.gpx' },
      gpxContent: '<gpx />',
    });

    const result = await processRouteDeliverySyncQueueItem({
      ...baseQueueItem,
      sourceRevisionKey: `${ServiceNames.SuuntoApp}:provider-route-1:${new Date(importedAt).getTime()}`,
    });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSendPreparedRoute).toHaveBeenCalled();
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      resultStatus: 'success',
    }));
    expect(mockUpdateToProcessed).not.toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      skippedReason: 'stale_source_revision',
    }));
  });

  it('skips non-allowlisted users without retrying', async () => {
    mockIsAllowlisted.mockReturnValue(false);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetRouteDeliveryMetadata).toHaveBeenCalledWith(expect.objectContaining({
      deliveryMetadata: expect.objectContaining({
        status: 'skipped',
        skippedReason: 'user_not_allowlisted',
      }),
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      resultStatus: 'skipped',
      skippedReason: 'user_not_allowlisted',
    }));
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
  });

  it('skips destination permission failures without retrying', async () => {
    const permissionError = new Error('Grant Garmin COURSE_IMPORT permission.');
    mockGetRouteSendAdapter.mockReturnValue({
      destinationServiceName: ServiceNames.GarminAPI,
      createContext: vi.fn().mockRejectedValue(permissionError),
      sendRoute: vi.fn(),
    });
    mockIsDestinationPermissionRequiredError.mockImplementation(error => error === permissionError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      resultStatus: 'skipped',
      skippedReason: 'destination_permission_required',
    }));
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
  });

  it('retries transient provider failures', async () => {
    const transientError = Object.assign(new Error('Garmin unavailable'), { code: 'unavailable' });
    mockSendPreparedRoute.mockRejectedValue(transientError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(expect.anything(), transientError, 1, undefined);
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('retries provider rate limits reported as HTTP status errors', async () => {
    const rateLimitError = Object.assign(new Error('Garmin rate limited'), { statusCode: 429 });
    mockSendPreparedRoute.mockRejectedValue(rateLimitError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(expect.anything(), rateLimitError, 1, undefined);
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('retries transient route preparation failures', async () => {
    const transientError = Object.assign(new Error('Storage unavailable'), { code: 'unavailable' });
    mockPrepareSavedRoute.mockRejectedValue(transientError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(expect.anything(), transientError, 1, undefined);
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('skips permanently unavailable source files without retrying', async () => {
    const sourceFileError = new MockRouteSendItemError('SOURCE_FILE_UNAVAILABLE', 'Saved route source file could not be downloaded.');
    mockPrepareSavedRoute.mockRejectedValue(sourceFileError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetRouteDeliveryMetadata).toHaveBeenCalledWith(expect.objectContaining({
      deliveryMetadata: expect.objectContaining({
        status: 'skipped',
        skippedReason: 'source_file_unavailable',
      }),
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      resultStatus: 'skipped',
      skippedReason: 'source_file_unavailable',
    }));
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('skips stale source revisions without sending to Garmin', async () => {
    const result = await processRouteDeliverySyncQueueItem({
      ...baseQueueItem,
      sourceRevisionKey: STALE_SOURCE_REVISION_KEY,
    });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetRouteDeliveryMetadata).toHaveBeenCalledWith(expect.objectContaining({
      deliveryMetadata: expect.objectContaining({
        status: 'skipped',
        skippedReason: 'stale_source_revision',
      }),
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      resultStatus: 'skipped',
      skippedReason: 'stale_source_revision',
    }));
    expect(mockCreateContext).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockPersistRouteDeliveryMetadata).not.toHaveBeenCalled();
  });

  it('moves permanent parse failures to DLQ', async () => {
    const parseError = new MockRouteSendItemError('PARSE_FAILED', 'Bad GPX');
    mockPrepareSavedRoute.mockRejectedValue(parseError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      expect.anything(),
      parseError,
      undefined,
      'ROUTE_DELIVERY_PARSE_FAILED',
    );
  });
});
