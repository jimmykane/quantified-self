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
import { setEvent } from '../utils';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { downloadWahooFITFile } from './file-download';
import { getWahooErrorLogDetails, getWahooRetryError } from './error-details';
import {
  claimWahooWorkoutQueueRevision,
  completeWahooWorkoutQueueRevision,
  failWahooWorkoutQueueRevision,
  isClaimedWahooWorkoutQueueRevisionCurrent,
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
  const claimResult = await claimWahooWorkoutQueueRevision(queueItem, processingOwner);
  if (claimResult === 'superseded') return QueueResult.Processed;
  try {
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
    if (!(await isClaimedWahooWorkoutQueueRevisionCurrent(queueItem, processingOwner))) {
      return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
    }
    const eventID = await resolveProviderImportEventID({
      userID,
      startDate: event.startDate,
      serviceName: ServiceNames.WahooAPI,
      providerEventID: queueItem.workoutID,
      providerEventIDField: 'serviceWorkoutID',
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
    await setEvent(
      userID,
      eventID,
      event,
      metadata,
      { data: fitFile, extension: 'fit', startDate: event.startDate },
    );
    return completeWahooWorkoutQueueRevision(queueItem, processingOwner);
  } catch (error) {
    logger.error('Wahoo activity processing failed', {
      queueItemId: queueItem.id,
      error: getWahooErrorLogDetails(error),
    });
    return failWahooWorkoutQueueRevision(queueItem, processingOwner, getWahooRetryError(error));
  }
}
