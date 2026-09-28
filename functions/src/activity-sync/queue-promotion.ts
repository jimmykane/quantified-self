import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER } from '../queue-utils';

/** An explicit historical send may take over only before a provider operation begins. */
export function canPromotePendingActivitySyncQueueItem(
    item: Omit<Partial<ActivitySyncQueueItemInterface>, 'processed'> & { processed?: boolean },
): boolean {
    return item.processed !== true
        && item.deliveryMode !== 'historical'
        && item.resultStatus !== 'manual_reconciliation_required'
        && item.resultStatus !== 'success'
        && !item.manualReconciliationRequiredAt
        && item.dispatchedToCloudTask !== PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
        && !item.providerOperationStartedAt
        && !item.destinationUploadID
        && !item.destinationProviderUserID
        && !item.destinationWorkoutKey
        && !item.destinationInfoCode
        && !item.destinationUploadCountedID
        && !item.destinationUploadCountedAt
        && !item.destinationUploadContinuation;
}
