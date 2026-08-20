import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS, ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';

const {
  mockHasProAccess,
  mockIsRouteEnabled,
  mockAllowlistConfigError,
  mockIsAllowlisted,
  mockShouldSkipDeletedUser,
  mockUpdateToProcessed,
  mockDeferQueueItemForPendingDisconnect,
  mockDeferQueueItemForPendingDisconnectIfCurrentUserActive,
  mockDeferQueueItemForReconnectRequiredIfCurrentUserActive,
  mockMarkQueueItemSkipped,
  mockIncreaseRetryCount,
  mockMoveToDLQ,
  mockMoveToDLQIfCurrentParams,
  mockSetRouteDeliveryMetadata,
  mockGetServiceConnectionMeta,
  mockAssertRouteSendUserActive,
  mockGetRouteSendAdapter,
  mockCreateContext,
  mockPrepareSavedRoute,
  mockSendPreparedRoute,
  mockPersistRouteDeliveryMetadata,
  mockUpdateQueueItemIfUserActive,
  mockIsAccountDeletionSkipError,
  mockIsDestinationAuthRequiredError,
  mockIsDestinationPermissionRequiredError,
  mockIsDeliveryMetadataPersistenceError,
  mockIsWahooReconnectRequiredError,
  MockRouteSendItemError,
} = vi.hoisted(() => ({
  mockHasProAccess: vi.fn(),
  mockIsRouteEnabled: vi.fn(),
  mockAllowlistConfigError: vi.fn(),
  mockIsAllowlisted: vi.fn(),
  mockShouldSkipDeletedUser: vi.fn(),
  mockUpdateToProcessed: vi.fn(),
  mockDeferQueueItemForPendingDisconnect: vi.fn(),
  mockDeferQueueItemForPendingDisconnectIfCurrentUserActive: vi.fn(),
  mockDeferQueueItemForReconnectRequiredIfCurrentUserActive: vi.fn(),
  mockMarkQueueItemSkipped: vi.fn(),
  mockIncreaseRetryCount: vi.fn(),
  mockMoveToDLQ: vi.fn(),
  mockMoveToDLQIfCurrentParams: vi.fn(),
  mockSetRouteDeliveryMetadata: vi.fn(),
  mockGetServiceConnectionMeta: vi.fn(),
  mockAssertRouteSendUserActive: vi.fn(),
  mockGetRouteSendAdapter: vi.fn(),
  mockCreateContext: vi.fn(),
  mockPrepareSavedRoute: vi.fn(),
  mockSendPreparedRoute: vi.fn(),
  mockPersistRouteDeliveryMetadata: vi.fn(),
  mockUpdateQueueItemIfUserActive: vi.fn(),
  mockIsAccountDeletionSkipError: vi.fn(),
  mockIsDestinationAuthRequiredError: vi.fn(),
  mockIsDestinationPermissionRequiredError: vi.fn(),
  mockIsDeliveryMetadataPersistenceError: vi.fn(),
  mockIsWahooReconnectRequiredError: vi.fn(),
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
  PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER: Number.MAX_SAFE_INTEGER - 1,
  ProviderOperationStillInFlightError: class ProviderOperationStillInFlightError extends Error {
    constructor(
      public readonly queueItemId: string,
      public readonly providerOperationStartedAt: number,
    ) {
      super(`Provider operation for queue item ${queueItemId} is still in flight.`);
    }
  },
  isProviderOperationInFlightLeaseActive: (queueItem: any) => (
    queueItem.dispatchedToCloudTask === Number.MAX_SAFE_INTEGER - 1
    && Number(queueItem.providerOperationStartedAt) > Date.now() - 12 * 60 * 1000
  ),
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
  updateToProcessed: (...args: any[]) => mockUpdateToProcessed(...args),
  deferQueueItemForPendingDisconnect: (...args: any[]) => mockDeferQueueItemForPendingDisconnect(...args),
  deferQueueItemForPendingDisconnectIfCurrentUserActive: (params: any) => (
    mockDeferQueueItemForPendingDisconnectIfCurrentUserActive(params)
  ),
  deferQueueItemForReconnectRequiredIfCurrentUserActive: (params: any) => (
    mockDeferQueueItemForReconnectRequiredIfCurrentUserActive(params)
  ),
  markQueueItemSkipped: (...args: any[]) => mockMarkQueueItemSkipped(...args),
  increaseRetryCountForQueueItem: (...args: any[]) => mockIncreaseRetryCount(...args),
  increaseRetryCountIfCurrentUserActive: (params: any) => {
    const args = [params.queueItem, params.error, params.incrementBy, params.bulkWriter];
    if (params.maxRetryDlqContext !== undefined) {
      args.push(params.maxRetryDlqContext);
    }
    return mockIncreaseRetryCount(...args);
  },
  moveToDeadLetterQueue: (...args: any[]) => mockMoveToDLQ(...args),
  moveToDeadLetterQueueIfCurrentUserActive: (params: any) => {
    mockMoveToDLQIfCurrentParams(params);
    return mockMoveToDLQ(
      params.queueItem,
      params.error,
      params.bulkWriter,
      params.context,
    );
  },
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: (...args: any[]) => mockGetServiceConnectionMeta(...args),
}));

vi.mock('../wahoo/refresh-recovery', () => ({
  isWahooReconnectRequiredError: mockIsWahooReconnectRequiredError,
}));

vi.mock('../queue/dispatch-marker', () => ({
  QueueItemUserGuardedUpdateResult: {
    Updated: 'updated',
    SkippedDeletedUser: 'skipped_deleted_user',
    NotCurrent: 'not_current',
  },
  updateQueueItemIfUserActive: (...args: any[]) => mockUpdateQueueItemIfUserActive(...args),
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
    delete: vi.fn(() => 'DELETE_FIELD'),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    fromDate: vi.fn((date: Date) => date),
  },
}));

import {
  PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
  QueueResult,
} from '../queue-utils';
import { RouteDeliverySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ProviderOperationError } from '../shared/provider-operation-error';
import { processRouteDeliverySyncQueueItem } from './process-queue-item';

type QueueItemRefMock = RouteDeliverySyncQueueItemInterface['ref'];
const suuntoToGarminRoute = ROUTE_DELIVERY_SYNC_ROUTES[ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI];
const CURRENT_SOURCE_REVISION_KEY = `${suuntoToGarminRoute.sourceServiceName}:provider-route-1:1710000000000`;
const STALE_SOURCE_REVISION_KEY = `${suuntoToGarminRoute.sourceServiceName}:provider-route-1:1700000000000`;

const baseQueueItem: RouteDeliverySyncQueueItemInterface = {
  id: 'queue-1',
  dateCreated: 1,
  processed: false,
  retryCount: 0,
  totalRetryCount: 0,
  dispatchedToCloudTask: 1,
  routeId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
  sourceServiceName: suuntoToGarminRoute.sourceServiceName,
  destinationServiceName: suuntoToGarminRoute.destinationServiceName,
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
  mockGetServiceConnectionMeta.mockResolvedValue(null);
  mockAssertRouteSendUserActive.mockResolvedValue(undefined);
  mockCreateContext.mockResolvedValue({ context: true });
  mockGetRouteSendAdapter.mockReturnValue({
    destinationServiceName: suuntoToGarminRoute.destinationServiceName,
    createContext: mockCreateContext,
    sendRoute: vi.fn(),
  });
  mockPrepareSavedRoute.mockResolvedValue({
    routeId: 'route-1',
    routeDocument: {
      sourceSummary: {
        sourceServiceName: suuntoToGarminRoute.sourceServiceName,
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
  mockUpdateQueueItemIfUserActive.mockReset().mockResolvedValue('updated');
  mockUpdateToProcessed.mockResolvedValue(QueueResult.Processed);
  mockDeferQueueItemForPendingDisconnect.mockResolvedValue(QueueResult.Deferred);
  mockDeferQueueItemForPendingDisconnectIfCurrentUserActive.mockResolvedValue(QueueResult.Deferred);
  mockDeferQueueItemForReconnectRequiredIfCurrentUserActive.mockResolvedValue(QueueResult.Deferred);
  mockMarkQueueItemSkipped.mockResolvedValue(QueueResult.Processed);
  mockIncreaseRetryCount.mockResolvedValue(QueueResult.RetryIncremented);
  mockMoveToDLQ.mockResolvedValue(QueueResult.MovedToDLQ);
  mockIsAccountDeletionSkipError.mockReturnValue(false);
  mockIsDestinationAuthRequiredError.mockReturnValue(false);
  mockIsDestinationPermissionRequiredError.mockReturnValue(false);
  mockIsDeliveryMetadataPersistenceError.mockReturnValue(false);
  mockIsWahooReconnectRequiredError.mockReturnValue(false);
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
      expect.objectContaining({ destinationServiceName: suuntoToGarminRoute.destinationServiceName }),
      { context: true },
      expect.any(Function),
    );
    expect(mockPersistRouteDeliveryMetadata).toHaveBeenCalledWith(expect.objectContaining({
      userID: 'user-1',
      routeID: 'route-1',
      destinationServiceName: suuntoToGarminRoute.destinationServiceName,
      providerRouteId: 'garmin-course-1',
      routeSyncRouteId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      sourceRevisionKey: CURRENT_SOURCE_REVISION_KEY,
      requirePersistence: true,
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItemId: 'queue-1',
      userID: 'user-1',
      updateData: expect.objectContaining({
        dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
        destinationProviderRouteId: 'garmin-course-1',
        destinationDeliveries: [{
          providerUserId: 'garmin-user',
          providerRouteId: 'garmin-course-1',
        }],
        destinationDeliveryAcceptedAt: expect.any(Number),
      }),
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_route_delivery_success_finalize',
      updateData: expect.objectContaining({
        processed: true,
        resultStatus: 'success',
        destinationProviderRouteId: 'garmin-course-1',
      }),
    }));
    const claim = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_route_delivery_destination_provider_operation');
    const receipt = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_route_delivery_provider_acceptance_persist');
    const finalization = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_route_delivery_success_finalize');
    const acceptedAt = receipt?.updateData.destinationDeliveryAcceptedAt;
    const providerOperationStartedAt = claim?.updateData.providerOperationStartedAt;
    expect(acceptedAt).toEqual(expect.any(Number));
    expect(providerOperationStartedAt).toEqual(expect.any(Number));
    expect(claim?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: baseQueueItem.dispatchedToCloudTask,
      providerOperationStartedAt: undefined,
    })).toBe(true);
    expect(claim?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
    })).toBe(false);
    expect(receipt?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
    })).toBe(true);
    expect(receipt?.isCurrent({
      ...baseQueueItem,
      sourceRevisionKey: STALE_SOURCE_REVISION_KEY,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
    })).toBe(false);
    expect(finalization?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
      destinationDeliveryAcceptedAt: acceptedAt,
      destinationProviderRouteId: 'garmin-course-1',
      destinationDeliveries: [{
        providerUserId: 'garmin-user',
        providerRouteId: 'garmin-course-1',
      }],
    })).toBe(true);
    expect(finalization?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
      destinationDeliveryAcceptedAt: acceptedAt,
      destinationDeliveryComplete: false,
      destinationProviderRouteId: 'garmin-course-1',
      destinationDeliveries: [{
        providerUserId: 'garmin-user',
        providerRouteId: 'garmin-course-1',
      }],
    })).toBe(false);
    expect(finalization?.isCurrent({
      ...baseQueueItem,
      dateCreated: baseQueueItem.dateCreated + 1,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
      destinationDeliveryAcceptedAt: acceptedAt,
      destinationProviderRouteId: 'garmin-course-1',
      destinationDeliveries: [{
        providerUserId: 'garmin-user',
        providerRouteId: 'garmin-course-1',
      }],
    })).toBe(false);
  });

  it('does not call the provider when another worker already claimed this dispatch', async () => {
    mockUpdateQueueItemIfUserActive.mockResolvedValueOnce('not_current');

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledOnce();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockPersistRouteDeliveryMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
  });

  it('fails closed when later work fails after a partial provider acceptance', async () => {
    const laterFailure = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_create',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'unavailable',
      message: 'A later provider account is temporarily unavailable.',
      dlqContext: 'GARMIN_ROUTE_UPDATE_RETRY_EXHAUSTED',
    });
    mockSendPreparedRoute.mockImplementationOnce(async (...args: unknown[]) => {
      const onProviderAccepted = args[4] as (result: unknown) => Promise<void>;
      await onProviderAccepted({
        providerRouteId: 'suunto-route-1',
        complete: false,
        deliveries: [{ providerUserId: 'suunto-user-1', providerRouteId: 'suunto-route-1' }],
      });
      throw laterFailure;
    });

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_route_delivery_provider_acceptance_persist',
      updateData: expect.objectContaining({
        destinationProviderRouteId: 'suunto-route-1',
        destinationDeliveryComplete: false,
        destinationDeliveries: [{
          providerUserId: 'suunto-user-1',
          providerRouteId: 'suunto-route-1',
        }],
      }),
    }));
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationDeliveryAcceptedAt: expect.any(Number),
        destinationDeliveryComplete: false,
        destinationProviderRouteId: 'suunto-route-1',
      }),
      expect.objectContaining({
        disposition: 'permanent',
        dlqContext: 'DESTINATION_PROVIDER_PARTIAL_ACCEPTANCE',
      }),
      undefined,
      'DESTINATION_PROVIDER_PARTIAL_ACCEPTANCE',
    );
    expect(mockMoveToDLQIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationDeliveryComplete: false,
          destinationProviderRouteId: 'suunto-route-1',
          destinationDeliveries: [{
            providerUserId: 'suunto-user-1',
            providerRouteId: 'suunto-route-1',
          }],
        }),
      },
    }));
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
  });

  it('moves a stale partial multi-account acceptance to DLQ without replaying the route', async () => {
    const result = await processRouteDeliverySyncQueueItem({
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: Date.now() - (13 * 60 * 1000),
      destinationDeliveryAcceptedAt: 1710000001000,
      destinationDeliveryComplete: false,
      destinationProviderRouteId: 'suunto-route-accepted',
      destinationDeliveries: [{
        providerUserId: 'suunto-destination-user',
        providerRouteId: 'suunto-route-accepted',
      }],
    });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockPersistRouteDeliveryMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({ destinationDeliveryComplete: false }),
      expect.objectContaining({ dlqContext: 'DESTINATION_PROVIDER_PARTIAL_ACCEPTANCE' }),
      undefined,
      'DESTINATION_PROVIDER_PARTIAL_ACCEPTANCE',
    );
  });

  it('waits for the active worker when a partial multi-account acceptance was just persisted', async () => {
    const processing = processRouteDeliverySyncQueueItem({
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: Date.now(),
      destinationDeliveryAcceptedAt: 1710000001000,
      destinationDeliveryComplete: false,
      destinationProviderRouteId: 'suunto-route-accepted',
      destinationDeliveries: [{
        providerUserId: 'suunto-destination-user',
        providerRouteId: 'suunto-route-accepted',
      }],
    });

    await expect(processing).rejects.toMatchObject({
      message: expect.stringContaining('still in flight'),
    });
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('finalizes a persisted provider acceptance without sending the route again', async () => {
    const result = await processRouteDeliverySyncQueueItem({
      ...baseQueueItem,
      destinationDeliveryAcceptedAt: 1710000001000,
      destinationProviderRouteId: 'suunto-route-accepted',
      destinationDeliveries: [{
        providerUserId: 'suunto-destination-user',
        providerRouteId: 'suunto-route-accepted',
      }],
    });

    expect(result).toBe(QueueResult.Processed);
    expect(mockHasProAccess).not.toHaveBeenCalled();
    expect(mockPrepareSavedRoute).not.toHaveBeenCalled();
    expect(mockCreateContext).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockPersistRouteDeliveryMetadata).toHaveBeenCalledWith(expect.objectContaining({
      providerRouteId: 'suunto-route-accepted',
      deliveries: [{
        providerUserId: 'suunto-destination-user',
        providerRouteId: 'suunto-route-accepted',
      }],
      requirePersistence: true,
    }));
  });

  it('moves an accepted provider route to DLQ when its durable receipt cannot be persisted', async () => {
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationDeliveryAcceptedAt: expect.any(Number),
        destinationProviderRouteId: 'garmin-course-1',
        destinationDeliveries: [{
          providerUserId: 'garmin-user',
          providerRouteId: 'garmin-course-1',
        }],
      }),
      expect.objectContaining({
        dlqContext: 'ROUTE_DELIVERY_PROVIDER_ACCEPTANCE_PERSIST_FAILED',
      }),
      undefined,
      'ROUTE_DELIVERY_PROVIDER_ACCEPTANCE_PERSIST_FAILED',
    );
    expect(mockPersistRouteDeliveryMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
  });

  it('acknowledges accepted provider work when receipt and DLQ persistence both fail', async () => {
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));
    mockMoveToDLQ.mockResolvedValueOnce(QueueResult.Failed);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Skipped);
    expect(mockSendPreparedRoute).toHaveBeenCalledTimes(1);
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledTimes(3);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'before_route_delivery_manual_reconciliation_persist',
      updateData: expect.objectContaining({
        processed: true,
        resultStatus: 'manual_reconciliation_required',
        expireAt: 'DELETE_FIELD',
        destinationProviderRouteId: 'garmin-course-1',
      }),
    }));
  });

  it('retries only the durable claim transition when accepted route work cannot be recorded', async () => {
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'))
      .mockRejectedValueOnce(new Error('Firestore still unavailable'));
    mockMoveToDLQ.mockResolvedValueOnce(QueueResult.Failed);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Failed);
    expect(mockSendPreparedRoute).toHaveBeenCalledTimes(1);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledTimes(3);
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
  });

  it('stops after guarded receipt persistence removes work for a deleting user', async () => {
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('skipped_deleted_user');

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSendPreparedRoute).toHaveBeenCalledTimes(1);
    expect(mockPersistRouteDeliveryMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
  });

  it('moves an unresolved provider operation to DLQ without sending the route again', async () => {
    const queueItem: RouteDeliverySyncQueueItemInterface = {
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
    };

    const result = await processRouteDeliverySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockPrepareSavedRoute).not.toHaveBeenCalled();
    expect(mockCreateContext).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        disposition: 'permanent',
        retryMode: 'none',
        dlqContext: 'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
      }),
      undefined,
      'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
    );
  });

  it('retries a recently claimed provider operation without changing queue state', async () => {
    const queueItem: RouteDeliverySyncQueueItemInterface = {
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: Date.now(),
    };

    await expect(processRouteDeliverySyncQueueItem(queueItem)).rejects.toMatchObject({
      message: expect.stringContaining('still in flight'),
    });

    expect(mockPrepareSavedRoute).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).not.toHaveBeenCalled();
  });

  it('retries metadata from a durable acceptance receipt without repeating the provider send', async () => {
    const metadataError = new MockRouteSendItemError(
      'DELIVERY_METADATA_PERSIST_FAILED',
      'Could not save delivery metadata.',
    );
    mockPersistRouteDeliveryMetadata.mockRejectedValueOnce(metadataError);
    mockIsDeliveryMetadataPersistenceError.mockImplementation(error => error === metadataError);

    const firstResult = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(firstResult).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationDeliveryAcceptedAt: expect.any(Number),
        destinationProviderRouteId: 'garmin-course-1',
      }),
      metadataError,
      1,
      undefined,
      'ROUTE_DELIVERY_METADATA_PERSIST_FAILED',
    );
    expect(mockSendPreparedRoute).toHaveBeenCalledTimes(1);

    mockPersistRouteDeliveryMetadata.mockResolvedValueOnce(undefined);
    mockIncreaseRetryCount.mockClear();
    mockUpdateToProcessed.mockClear();
    const retryResult = await processRouteDeliverySyncQueueItem({
      ...baseQueueItem,
      destinationDeliveryAcceptedAt: 1710000001000,
      destinationProviderRouteId: 'garmin-course-1',
      destinationDeliveries: [{
        providerUserId: 'garmin-user',
        providerRouteId: 'garmin-course-1',
      }],
    });

    expect(retryResult).toBe(QueueResult.Processed);
    expect(mockSendPreparedRoute).toHaveBeenCalledTimes(1);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_route_delivery_success_finalize',
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
          sourceServiceName: suuntoToGarminRoute.sourceServiceName,
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
      sourceRevisionKey: `${suuntoToGarminRoute.sourceServiceName}:provider-route-1:${new Date(importedAt).getTime()}`,
    });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSendPreparedRoute).toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_route_delivery_success_finalize',
      updateData: expect.objectContaining({ resultStatus: 'success' }),
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
      destinationServiceName: suuntoToGarminRoute.destinationServiceName,
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

  it('delivers legacy saved routes when source provider user id is absent from saved source metadata', async () => {
    mockPrepareSavedRoute.mockResolvedValue({
      routeId: 'route-1',
      routeDocument: {
        sourceSummary: {
          sourceServiceName: suuntoToGarminRoute.sourceServiceName,
          providerRouteId: 'provider-route-1',
          modifiedAt: 1710000000000,
        },
      },
      routeFile: {},
      sourceFile: { path: 'route.gpx' },
      gpxContent: '<gpx />',
    });

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockSendPreparedRoute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ routeId: 'route-1' }),
      expect.objectContaining({ destinationServiceName: suuntoToGarminRoute.destinationServiceName }),
      { context: true },
      expect.any(Function),
    );
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_route_delivery_success_finalize',
      updateData: expect.objectContaining({ resultStatus: 'success' }),
    }));
    expect(mockUpdateToProcessed).not.toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      skippedReason: 'source_route_mismatch',
    }));
  });

  it('defers manual route delivery when source service disconnect is pending', async () => {
    mockIsRouteEnabled.mockResolvedValue(false);
    mockGetServiceConnectionMeta
      .mockResolvedValueOnce({ connectionState: 'disconnect_pending' })
      .mockResolvedValueOnce(null);

    const manualQueueItem: RouteDeliverySyncQueueItemInterface = {
      ...baseQueueItem,
      manual: true,
    };

    const result = await processRouteDeliverySyncQueueItem(manualQueueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(baseQueueItem.userID, suuntoToGarminRoute.sourceServiceName);
    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(baseQueueItem.userID, suuntoToGarminRoute.destinationServiceName);
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      manualQueueItem,
      undefined,
      expect.objectContaining({
        deferredServiceName: `${suuntoToGarminRoute.sourceServiceName}`,
      }),
    );
    expect(mockCreateContext).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
  });

  it('defers manual route delivery before Garmin context creation when destination disconnect is pending', async () => {
    mockGetServiceConnectionMeta
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ connectionState: 'disconnect_pending' });

    const manualQueueItem: RouteDeliverySyncQueueItemInterface = {
      ...baseQueueItem,
      manual: true,
    };

    const result = await processRouteDeliverySyncQueueItem(manualQueueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      manualQueueItem,
      undefined,
      expect.objectContaining({
        deferredServiceName: `${suuntoToGarminRoute.destinationServiceName}`,
      }),
    );
    expect(mockCreateContext).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockPersistRouteDeliveryMetadata).not.toHaveBeenCalled();
  });

  it('parks Wahoo route delivery when the destination requires reconnecting', async () => {
    mockGetServiceConnectionMeta
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ connectionState: 'reconnect_required' });

    const wahooQueueItem: RouteDeliverySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };

    const result = await processRouteDeliverySyncQueueItem(wahooQueueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForReconnectRequiredIfCurrentUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItem: wahooQueueItem,
      phase: 'route_delivery_sync_reconnect_required_transition',
      serviceName: ServiceNames.WahooAPI,
      additionalData: { deferredServiceName: ServiceNames.WahooAPI },
    }));
    expect(mockCreateContext).not.toHaveBeenCalled();
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
  });

  it('defers when destination token use becomes blocked by pending disconnect during context creation', async () => {
    const pendingDisconnectError = Object.assign(new Error('Garmin disconnect is pending.'), {
      name: 'TokenUseSkippedForPendingDisconnectError',
      serviceName: suuntoToGarminRoute.destinationServiceName,
    });
    mockCreateContext.mockRejectedValue(pendingDisconnectError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: baseQueueItem.id }),
      undefined,
      expect.objectContaining({
        deferredServiceName: `${suuntoToGarminRoute.destinationServiceName}`,
      }),
    );
    expect(mockUpdateToProcessed).not.toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({
      skippedReason: 'destination_not_connected',
    }));
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('defers when the provider adapter detects a pending disconnect immediately before send', async () => {
    const pendingDisconnectError = Object.assign(new Error('Garmin disconnect is pending.'), {
      name: 'TokenUseSkippedForPendingDisconnectError',
      serviceName: suuntoToGarminRoute.destinationServiceName,
    });
    mockSendPreparedRoute.mockRejectedValue(pendingDisconnectError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForPendingDisconnectIfCurrentUserActive).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItem: expect.objectContaining({ id: baseQueueItem.id }),
        additionalData: expect.objectContaining({
          deferredServiceName: `${suuntoToGarminRoute.destinationServiceName}`,
        }),
        phase: 'route_delivery_sync_pending_disconnect_transition',
      }),
    );
    const guardedDeferral = mockDeferQueueItemForPendingDisconnectIfCurrentUserActive.mock.calls[0][0];
    expect(guardedDeferral.isCurrent({ ...guardedDeferral.queueItem })).toBe(true);
    expect(guardedDeferral.isCurrent({ ...guardedDeferral.queueItem, processed: true })).toBe(false);
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('guards a legacy authentication skip returned after provider sending starts', async () => {
    const authError = Object.assign(new Error('Reconnect Garmin before sending routes.'), {
      code: 'unauthenticated',
    });
    mockSendPreparedRoute.mockRejectedValue(authError);
    mockIsDestinationAuthRequiredError.mockImplementation(error => error === authError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'route_delivery_sync_auth_skip_transition',
      updateData: expect.objectContaining({
        processed: true,
        skippedReason: 'destination_not_connected',
      }),
    }));
    expect(mockUpdateToProcessed).not.toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({ skippedReason: 'destination_not_connected' }),
    );
  });

  it('guards a legacy permission skip returned after provider sending starts', async () => {
    const permissionError = new Error('Grant Garmin COURSE_IMPORT permission.');
    mockSendPreparedRoute.mockRejectedValue(permissionError);
    mockIsDestinationPermissionRequiredError.mockImplementation(error => error === permissionError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'route_delivery_sync_permission_skip_transition',
      updateData: expect.objectContaining({
        processed: true,
        skippedReason: 'destination_permission_required',
      }),
    }));
    expect(mockUpdateToProcessed).not.toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.objectContaining({ skippedReason: 'destination_permission_required' }),
    );
  });

  it('retries transient provider failures', async () => {
    const transientError = Object.assign(new Error('Garmin unavailable'), { code: 'unavailable' });
    mockSendPreparedRoute.mockRejectedValue(transientError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(expect.anything(), transientError, 1, undefined);
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it.each([
    ['named code', { code: 'resource-exhausted' }],
    ['numeric gRPC code', { code: 8 }],
  ])('retries Firestore resource exhaustion reported as a %s', async (_scenario, errorFields) => {
    const transientError = Object.assign(new Error('Firestore quota temporarily exhausted'), errorFields);
    mockPrepareSavedRoute.mockRejectedValue(transientError);

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

  it('retries an HTTP 408 before route delivery starts', async () => {
    const timeoutError = Object.assign(new Error('token request timed out'), { statusCode: 408 });
    mockPrepareSavedRoute.mockRejectedValue(timeoutError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockSendPreparedRoute).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(expect.anything(), timeoutError, 1, undefined);
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('retries an explicitly retryable destination provider failure with its DLQ context', async () => {
    const providerError = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_create',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'unavailable',
      message: 'Garmin Connect is temporarily unavailable.',
      statusCode: 503,
      dlqContext: 'GARMIN_ROUTE_CREATE_RETRY_EXHAUSTED',
    });
    mockSendPreparedRoute.mockRejectedValue(providerError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCount).toHaveBeenCalledWith(
      expect.anything(),
      providerError,
      1,
      undefined,
      'GARMIN_ROUTE_CREATE_RETRY_EXHAUSTED',
    );
    expect(mockMoveToDLQ).not.toHaveBeenCalled();
  });

  it('moves an explicitly permanent destination provider failure directly to DLQ', async () => {
    const providerError = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_create',
      disposition: 'permanent',
      code: 'failed-precondition',
      message: 'Garmin rejected the route.',
      providerStatus: -1,
      statusCode: 400,
      dlqContext: 'GARMIN_ROUTE_CREATE_REJECTED',
    });
    mockSendPreparedRoute.mockRejectedValue(providerError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      expect.anything(),
      providerError,
      undefined,
      'GARMIN_ROUTE_CREATE_REJECTED',
    );
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[RouteDeliverySync] Destination provider failure moved to DLQ.',
      expect.objectContaining({
        code: 'failed-precondition',
        providerStatus: -1,
        providerMessage: 'Garmin rejected the route.',
      }),
    );
    const providerFailureLog = vi.mocked(logger.error).mock.calls.find(
      ([summary]) => summary === '[RouteDeliverySync] Destination provider failure moved to DLQ.',
    );
    expect(providerFailureLog?.[1]).not.toHaveProperty('message');
  });

  it('retains the Garmin account identity for an ambiguous route create reconciliation', async () => {
    const providerError = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_create',
      disposition: 'permanent',
      code: 'failed-precondition',
      message: 'Garmin did not confirm whether the course was created.',
      providerUserId: 'garmin-destination-account',
      dlqContext: 'GARMIN_ROUTE_CREATE_AMBIGUOUS',
    });
    mockSendPreparedRoute.mockRejectedValue(providerError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockMoveToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationProviderUserId: 'garmin-destination-account',
        destinationProviderOperation: 'route_create',
      }),
      providerError,
      undefined,
      'GARMIN_ROUTE_CREATE_AMBIGUOUS',
    );
    expect(mockMoveToDLQIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationProviderUserId: 'garmin-destination-account',
          destinationProviderOperation: 'route_create',
        }),
      },
    }));
  });

  it('does not apply provider retry policy after a successful send', async () => {
    const metadataError = new ProviderOperationError({
      serviceName: ServiceNames.GarminAPI,
      operation: 'route_update',
      disposition: 'retryable',
      code: 'unavailable',
      message: 'Metadata write failed after provider success.',
      dlqContext: 'SHOULD_NOT_RETRY_PROVIDER_SEND',
    });
    mockPersistRouteDeliveryMetadata.mockRejectedValue(metadataError);

    const result = await processRouteDeliverySyncQueueItem({ ...baseQueueItem });

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCount).not.toHaveBeenCalled();
    expect(mockMoveToDLQ).toHaveBeenCalled();
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
