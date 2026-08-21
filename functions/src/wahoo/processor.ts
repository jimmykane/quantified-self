import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import {
  EventImporterFIT,
  ServiceNames,
  WahooAPIEventMetaData,
} from '@sports-alliance/sports-lib';
import { createParsingOptions } from '../../../shared/parsing-options';
import {
  deferQueueItemForPendingDisconnect,
  deferQueueItemForPendingDisconnectIfCurrentUserActive,
  deferQueueItemForReconnectRequiredIfCurrentUserActive,
  markQueueItemSkipped,
  QueueResult,
} from '../queue-utils';
import { WahooAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { resolveProviderImportEventID } from '../queue/provider-event-id';
import { hasProAccess, setEvent } from '../utils';
import { enqueueActivitySyncAfterEventPersistence } from '../activity-sync/enqueue-after-event-persistence';
import { isActivitySyncOutboundEcho } from '../activity-sync/outbound-fingerprint';
import { ACTIVITY_SYNC_ROUTES, ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { downloadWahooFITFile } from './file-download';
import { getWahooErrorLogDetails, getWahooRetryError } from './error-details';
import {
  assertWahooActiveAccountGuardCurrent,
  captureWahooActiveAccountGuard,
  getActiveWahooTokenSnapshot,
} from './account';
import { isWahooReconnectRequiredError } from './refresh-recovery';
import {
  claimWahooWorkoutQueueRevision,
  completeWahooWorkoutQueueRevision,
  failWahooWorkoutQueueRevision,
  isClaimedWahooWorkoutQueueRevisionCurrent,
  type WahooQueueClaimResult,
} from './queue-store';

function isPendingDisconnectError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'TokenUseSkippedForPendingDisconnectError';
}

function isWahooAccountUnavailableError(error: unknown): boolean {
  return `${(error as { code?: unknown } | null)?.code || ''}`.endsWith('unauthenticated');
}

function isCurrentClaimedWahooRevision(
  current: Record<string, unknown>,
  queueItem: WahooAPIWorkoutQueueItemInterface,
  processingOwner: string,
): boolean {
  return current.processingOwner === processingOwner
    && current.workoutSummaryID === queueItem.workoutSummaryID
    && current.summaryUpdatedAt === queueItem.summaryUpdatedAt;
}

async function deferClaimedWahooQueueItemForReconnect(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  userID: string,
  processingOwner: string,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
  return deferQueueItemForReconnectRequiredIfCurrentUserActive({
    queueItem,
    userID,
    serviceName: ServiceNames.WahooAPI,
    phase: 'wahoo_workout_reconnect_required_transition',
    logPrefix: 'WahooWorkoutQueue',
    isCurrent: current => isCurrentClaimedWahooRevision(current, queueItem, processingOwner),
  });
}

async function deferClaimedWahooQueueItemForPendingDisconnect(
  queueItem: WahooAPIWorkoutQueueItemInterface,
  userID: string,
  processingOwner: string,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
  return deferQueueItemForPendingDisconnectIfCurrentUserActive({
    queueItem,
    userID,
    serviceName: ServiceNames.WahooAPI,
    phase: 'wahoo_workout_pending_disconnect_transition',
    logPrefix: 'WahooWorkoutQueue',
    isCurrent: current => isCurrentClaimedWahooRevision(current, queueItem, processingOwner),
  });
}

function toArrayBuffer(payload: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(payload.byteLength);
  copy.set(payload);
  return copy.buffer;
}

export async function processWahooWorkoutQueueItem(
  queueItem: WahooAPIWorkoutQueueItemInterface,
): Promise<QueueResult> {
  const userID = `${queueItem.firebaseUserID || ''}`.trim();
  if (!userID || await shouldSkipQueueWorkForDeletedUser(userID, ServiceNames.WahooAPI, queueItem.id, 'before_token_refresh')) {
    return markQueueItemSkipped(queueItem, undefined, 'user_deleted_or_deleting');
  }
  if (await isServiceDisconnectPendingForUser(userID, ServiceNames.WahooAPI)) {
    return deferQueueItemForPendingDisconnect(queueItem, undefined, {}, {
      userID,
      serviceName: ServiceNames.WahooAPI,
    });
  }
  const processingOwner = crypto.randomUUID();
  const claimResult: WahooQueueClaimResult = await claimWahooWorkoutQueueRevision(queueItem, processingOwner);
  if (claimResult === 'superseded') return QueueResult.Processed;
  if (claimResult === 'busy') {
    logger.info('Skipped duplicate Wahoo task while another worker owns the current revision', {
      queueItemId: queueItem.id,
    });
    return QueueResult.Processed;
  }
  try {
    if (!(await hasProAccess(userID))) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'pro_access_required',
      });
    }
    await getActiveWahooTokenSnapshot(userID, queueItem.wahooUserID);
    const accountGuard = await captureWahooActiveAccountGuard(userID, queueItem.wahooUserID);

    const fitFile = await downloadWahooFITFile(queueItem.FITFileURI);
    const event = await EventImporterFIT.getFromArrayBuffer(toArrayBuffer(fitFile), createParsingOptions());
    event.name = event.startDate.toJSON();
    if (await shouldSkipQueueWorkForDeletedUser(userID, ServiceNames.WahooAPI, queueItem.id, 'before_event_write')) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'user_deleted_or_deleting',
      });
    }
    if (!(await isClaimedWahooWorkoutQueueRevisionCurrent(queueItem, processingOwner))) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
    }
    if (await isActivitySyncOutboundEcho({
      userID,
      sourceServiceName: ServiceNames.WahooAPI,
      fileBuffer: Buffer.from(fitFile),
    })) {
      logger.info('[ActivitySync] Skipped an inbound Wahoo provider echo before event persistence.', {
        userID,
        queueItemId: queueItem.id,
      });
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'outbound_provider_echo',
      });
    }
    // Event-ID resolution persists a provider-identity reservation. Guard it
    // separately from the later event write so neither durable mutation can
    // be attributed to an account that was replaced during parsing.
    await assertWahooActiveAccountGuardCurrent(userID, accountGuard);
    const eventID = await resolveProviderImportEventID({
      userID,
      startDate: event.startDate,
      serviceName: ServiceNames.WahooAPI,
      providerEventID: queueItem.workoutID,
      providerEventIDField: 'serviceWorkoutID',
      providerEventSecondaryID: queueItem.wahooUserID,
      providerEventSecondaryIDField: 'serviceUserID',
      preferProviderIdentityEventID: true,
    });
    const metadata = new WahooAPIEventMetaData(
      queueItem.workoutID,
      queueItem.workoutSummaryID,
      queueItem.wahooUserID,
      queueItem.summaryUpdatedAt,
      new Date(),
      queueItem.manual,
      queueItem.edited,
      queueItem.fitnessAppID,
    );
    // Event-id migration can also outlive a disconnect/reconnect. Prove this
    // inbound item still belongs to the same connection immediately before
    // the event and original-file persistence transaction.
    if (!(await isClaimedWahooWorkoutQueueRevisionCurrent(queueItem, processingOwner))) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
    }
    await assertWahooActiveAccountGuardCurrent(userID, accountGuard);
    const setEventResult = await setEvent(
      userID,
      eventID,
      event,
      metadata,
      { data: fitFile, extension: 'fit', startDate: event.startDate },
      undefined,
      undefined,
      undefined,
      { stageOriginalFilesUntilEventWrite: true },
    );
    const skippedAfterDeletionStarted = await enqueueActivitySyncAfterEventPersistence({
      userID,
      eventID,
      sourceServiceName: ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp].sourceServiceName,
      sourceActivityID: queueItem.workoutID,
      setEventResult,
      sourceFileData: Buffer.from(fitFile),
    });
    if (skippedAfterDeletionStarted) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'user_deleted_or_deleting',
      });
    }
    return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
  } catch (error) {
    if (isWahooReconnectRequiredError(error)) {
      return deferClaimedWahooQueueItemForReconnect(queueItem, userID, processingOwner);
    }
    if (isPendingDisconnectError(error)) {
      return deferClaimedWahooQueueItemForPendingDisconnect(queueItem, userID, processingOwner);
    }
    if (isWahooAccountUnavailableError(error)) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'provider_not_connected',
      });
    }
    logger.error('Wahoo activity processing failed', {
      queueItemId: queueItem.id,
      error: getWahooErrorLogDetails(error),
    });
    return failWahooWorkoutQueueRevision(queueItem, processingOwner, getWahooRetryError(error));
  }
}
