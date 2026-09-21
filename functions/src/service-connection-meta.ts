// Compatibility facade: callers keep their existing API while lifecycle and
// provider recovery implementations have separate owners.
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { HistoryConnectionContext } from './connection-history/model';
import type { DocumentGenerationGuard } from './token-refresh-coordinator';
import {
  clearServiceConnectionStateLifecycle,
  markServiceConnectedLifecycle,
  type ClearServiceConnectionStateOptions,
} from './service-connection-lifecycle';
import {
  getWahooConnectedRecoveryFields,
  getWahooRecoveryFieldDeletes,
  releaseWahooReconnectQueueItemsWithRepair,
} from './wahoo/connection-recovery';

export {
  beginPendingDisconnectQueueReleaseRepair,
  completePendingDisconnectQueueReleaseRepair,
  getServiceConnectionMeta,
  isServiceReconnectRequiredForUser,
  isServiceUnavailableForSyncForUser,
  markServiceReconnectRequired,
  mirrorServiceDisconnectPendingToUserMeta,
  pinServiceConnectionProviderUserIdIfUnset,
  retryPendingCOROSHealthLifecycleProjection,
  retryPendingDisconnectQueueRelease,
  retryPendingHealthLifecycleProjection,
  retryPendingServiceRouteRestore,
  setServiceConnectionProviderUserId,
  supersedePendingCOROSHealthLifecycleProjectionForTokenRootDelete,
  supersedePendingHealthLifecycleProjectionForTokenRootDelete,
  type MarkServiceReconnectRequiredOptions,
  type ServiceConnectionProviderUserIdPinOptions,
  type ServiceConnectionProviderUserIdPinResult,
  type ServiceDisconnectPendingMetaInput,
} from './service-connection-lifecycle';
export {
  recordWahooOpaqueRefreshFailure,
  retryWahooReconnectQueueRelease,
  WAHOO_OPAQUE_REFRESH_FAILURE_THRESHOLD,
  type WahooOpaqueRefreshFailureClaim,
  type WahooOpaqueRefreshFailureOutcome,
} from './wahoo/connection-recovery';

export async function markServiceConnected(
  userID: string,
  serviceName: ServiceNames,
  providerUserId?: string | null,
  expectedTokenCredentialGeneration?: DocumentGenerationGuard,
  expectedOAuthFlowGeneration?: DocumentGenerationGuard,
  historyContext?: HistoryConnectionContext,
): Promise<boolean> {
  return markServiceConnectedLifecycle(
    userID,
    serviceName,
    providerUserId,
    expectedTokenCredentialGeneration,
    expectedOAuthFlowGeneration,
    {
      connectedFields: (generation, nowMs) => getWahooConnectedRecoveryFields(serviceName, generation, nowMs),
      releaseReconnectWork: serviceName === ServiceNames.WahooAPI
        ? releaseWahooReconnectQueueItemsWithRepair
        : undefined,
    },
    historyContext,
  );
}

export async function clearServiceConnectionState(
  userID: string,
  serviceName: ServiceNames,
  options: ClearServiceConnectionStateOptions = {},
): Promise<boolean> {
  return clearServiceConnectionStateLifecycle(userID, serviceName, options, getWahooRecoveryFieldDeletes);
}
