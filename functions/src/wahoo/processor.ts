import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import {
  EventImporterFIT,
  ServiceNames,
  WahooAPIEventMetaData,
} from '@sports-alliance/sports-lib';
import { createParsingOptions } from '../../../shared/parsing-options';
import { deferQueueItemForPendingDisconnect, markQueueItemSkipped, QueueResult } from '../queue-utils';
import { WahooAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { resolveProviderImportEventID } from '../queue/provider-event-id';
import {
  EventWriteSkippedByTransactionGuardError,
  hasProAccess,
  setEvent,
} from '../utils';
import { enqueueActivitySyncAfterEventPersistence } from '../activity-sync/enqueue-after-event-persistence';
import { ACTIVITY_SYNC_ROUTES, ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { downloadWahooFITFile } from './file-download';
import { getWahooErrorLogDetails, getWahooRetryError } from './error-details';
import {
  claimWahooWorkoutQueueRevision,
  completeWahooWorkoutQueueRevision,
  createWahooEventWriteOwnershipGuard,
  failWahooWorkoutQueueRevision,
  getClaimedWahooWorkoutQueueRevisionEventWriteFence,
  type WahooQueueClaimResult,
} from './queue-store';

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
    return deferQueueItemForPendingDisconnect(queueItem);
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
    const tokenSnapshot = await admin.firestore()
      .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
      .doc(userID)
      .collection('tokens')
      .doc(queueItem.wahooUserID)
      .get();
    if (!tokenSnapshot.exists || tokenSnapshot.data()?.serviceName !== ServiceNames.WahooAPI) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'provider_not_connected',
      });
    }

    const fitFile = await downloadWahooFITFile(queueItem.FITFileURI);
    const event = await EventImporterFIT.getFromArrayBuffer(toArrayBuffer(fitFile), createParsingOptions());
    event.name = event.startDate.toJSON();
    if (await shouldSkipQueueWorkForDeletedUser(userID, ServiceNames.WahooAPI, queueItem.id, 'before_event_write')) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'user_deleted_or_deleting',
      });
    }
    const eventWriteOwnershipFence = await getClaimedWahooWorkoutQueueRevisionEventWriteFence(
      queueItem,
      processingOwner,
    );
    if (!eventWriteOwnershipFence) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
    }
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
    const setEventResult = await setEvent(
      userID,
      eventID,
      event,
      metadata,
      { data: fitFile, extension: 'fit', startDate: event.startDate },
      undefined,
      undefined,
      undefined,
      {
        transactionGuard: createWahooEventWriteOwnershipGuard(eventWriteOwnershipFence),
        stageOriginalFilesUntilEventWrite: true,
      },
    );
    const skippedAfterDeletionStarted = await enqueueActivitySyncAfterEventPersistence({
      userID,
      eventID,
      sourceServiceName: ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp].sourceServiceName,
      sourceActivityID: queueItem.workoutID,
      setEventResult,
    });
    if (skippedAfterDeletionStarted) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'user_deleted_or_deleting',
      });
    }
    return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
  } catch (error) {
    if (error instanceof EventWriteSkippedByTransactionGuardError) {
      logger.info('Skipped Wahoo activity persistence because ownership changed during processing', {
        queueItemId: queueItem.id,
        wahooUserID: queueItem.wahooUserID,
      });
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner, {
        resultStatus: 'skipped',
        skippedReason: 'wahoo_ownership_changed',
      });
    }
    logger.error('Wahoo activity processing failed', {
      queueItemId: queueItem.id,
      error: getWahooErrorLogDetails(error),
    });
    return failWahooWorkoutQueueRevision(queueItem, processingOwner, getWahooRetryError(error));
  }
}
