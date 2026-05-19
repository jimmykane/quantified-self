import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { QueueErrors, QueueLogs } from '../shared/constants';
import { addToQueueForGarmin } from '../queue';
import { isProviderQueueUserNotConnectedError } from '../queue/provider-queue-errors';
import { increaseRetryCountForQueueItem, markQueueItemSkipped, QUEUE_SKIPPED_REASONS, updateToProcessed, moveToDeadLetterQueue, QueueResult } from '../queue-utils';

import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { generateEventID, setEvent, UsageLimitExceededError, UserNotFoundError } from '../utils';
import * as requestPromise from '../request-helper';
import {
  GarminAPIActivityQueueItemInterface,
} from '../queue/queue-item.interface';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import * as xmldom from 'xmldom';
import {
  GarminAPIEventMetaData,
} from '@sports-alliance/sports-lib';
import { uploadDebugFile } from '../debug-utils';
import { createParsingOptions } from '../../../shared/parsing-options';
import { enqueueActivitySyncJobsForImportedEvent } from '../activity-sync/enqueue-imported-event';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';

interface RequestError extends Error {
  statusCode?: number;
}

function isTokenRefreshSkippedForDeletedUserError(error: unknown): error is TokenRefreshSkippedForDeletedUserError {
  return error instanceof TokenRefreshSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'TokenRefreshSkippedForDeletedUserError');
}

function markGarminQueueItemSkippedForDeletedUser(
  queueItem: GarminAPIActivityQueueItemInterface,
  bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult.Processed | QueueResult.Failed> {
  return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
    skippedContext: 'USER_DELETION_GUARD',
  });
}


export const insertGarminAPIActivityFileToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  const activityFiles: GarminAPIActivityFileInterface[] = req.body.activityFiles;
  const queueItemRefs: admin.firestore.DocumentReference[] = [];
  for (const activityFile of activityFiles) {
    let queueItemDocumentReference;
    try {
      const activityFileID = activityFile.summaryId || new URLSearchParams(activityFile.callbackURL.split('?')[1]).get('id');
      const activityFileToken = new URLSearchParams(activityFile.callbackURL.split('?')[1]).get('token');
      if (!activityFileID) {
        res.status(500).send();
        return;
      }

      queueItemDocumentReference = await addToQueueForGarmin(
        {
          userID: activityFile.userId,
          startTimeInSeconds: activityFile.startTimeInSeconds,
          manual: activityFile.manual,
          activityFileID: activityFileID,
          activityFileType: activityFile.fileType,
          token: activityFileToken || 'No token',
          userAccessToken: activityFile.userAccessToken,
          callbackURL: activityFile.callbackURL,
      });
      queueItemRefs.push(queueItemDocumentReference);
    } catch (e: unknown) {
      if (isProviderQueueUserNotConnectedError(e)) {
        logger.warn(`Skipping Garmin activity file webhook for ${activityFile.userId} because no local token/user is connected.`);
        continue;
      }
      logger.error(e);
      res.status(500).send();
      return;
    }
  }
  logger.info(`Inserted to queue ${queueItemRefs.length} Garmin activity files.`);
  res.status(200).send();
});




export async function processGarminAPIActivityQueueItem(queueItem: GarminAPIActivityQueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, tokenCache?: Map<string, Promise<admin.firestore.QuerySnapshot>>, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>): Promise<QueueResult> {
  logger.info(`Processing queue item ${queueItem.id} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots: admin.firestore.QuerySnapshot | undefined;
  // Use UserID for cache key as it's stable, unlike access tokens
  const userKey = `GarminAPI:${queueItem.userID}`;

  if (tokenCache) {
    let tokenPromise = tokenCache.get(userKey);
    if (!tokenPromise) {
      // Lookup by userID (Garmin User ID) which is stored in the 'userID' field of the token document
      // Since we don't know the Firebase User ID (the parent doc ID), we must use a Collection Group Query.
      tokenPromise = admin.firestore().collectionGroup('tokens')
        .where('userID', '==', queueItem.userID)
        .where('serviceName', '==', ServiceNames.GarminAPI)
        .limit(1)
        .get();
      tokenCache.set(userKey, tokenPromise);
    }
    try {
      tokenQuerySnapshots = await tokenPromise;
    } catch (e: any) {
      logger.error(e);
      return increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
    }
  } else {
    tokenQuerySnapshots = await admin.firestore().collectionGroup('tokens')
      .where('userID', '==', queueItem.userID)
      .where('serviceName', '==', ServiceNames.GarminAPI)
      .limit(1)
      .get();
  }

  if (!tokenQuerySnapshots.size) {
    logger.warn(QueueLogs.NO_TOKEN_FOUND.replace('${id}', queueItem.id));
    return moveToDeadLetterQueue(queueItem, new Error(QueueErrors.NO_TOKEN_FOUND), bulkWriter, 'NO_TOKEN_FOUND');
  }

  // The parent of the token document is the 'tokens' collection, and its parent is the User document.
  const firebaseUserID = tokenQuerySnapshots.docs[0].ref.parent.parent!.id;
  if (await shouldSkipQueueWorkForDeletedUser(firebaseUserID, ServiceNames.GarminAPI, queueItem.id, 'before_token_refresh')) {
    return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
  }

  // Use getTokenData (Shared) to handle auto-refresh if needed
  let serviceToken;
  try {
    serviceToken = await getTokenData(tokenQuerySnapshots.docs[0], ServiceNames.GarminAPI);
  } catch (e: any) {
    if (isTokenRefreshSkippedForDeletedUserError(e)) {
      logger.warn(`Skipping Garmin queue item ${queueItem.id} because user ${firebaseUserID} is missing or deletion is in progress.`);
      return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
    }
    if (e instanceof TerminalServiceAuthError) {
      logger.warn(`Garmin token for queue item ${queueItem.id} requires reconnect; moving item to DLQ with ${e.dlqContext}.`, {
        queueItemID: queueItem.id,
        userID: queueItem.userID,
        firebaseUserID: e.firebaseUserID,
        providerUserId: e.providerUserId,
        dlqContext: e.dlqContext,
      });
      return moveToDeadLetterQueue(queueItem, e, bulkWriter, e.dlqContext);
    }
    logger.error(`Failed to get/refresh token for ${queueItem.id}: ${e.message}`);
    return increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
  }

  let result;
  // Use the ORIGINAL callback URL directly, do not reconstruct it
  const url = queueItem.callbackURL;

  try {
    logger.info(`Downloading Garmin activityID: ${queueItem.activityFileID} for queue item ${queueItem.id}`);
    logger.info('Starting timer: DownloadFile');
    result = await requestPromise.get({
      headers: {
        'Authorization': `Bearer ${serviceToken.accessToken}`,
      },
      encoding: queueItem.activityFileType === 'FIT' ? null : undefined,
      url: url,
    });
    logger.info('Ending timer: DownloadFile');
    logger.info(`Downloaded ${queueItem.activityFileType} for ${queueItem.id} and token user ${(serviceToken as any).userID}`);
  } catch (error: unknown) {
    const e = error as RequestError;
    if (e.statusCode === 400) {
      logger.error(new Error(`Could not get workout for ${queueItem.id} and token user ${(serviceToken as any).userID} due to 400, increasing retry by 20 URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
    } else if (e.statusCode === 500) {
      logger.error(new Error(`Could not get workout for ${queueItem.id} and token user ${(serviceToken as any).userID} due to 500 increasing retry by 20 URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
    } else if (e.statusCode === 410) {
      logger.error(new Error(`410 Gone for ${queueItem.id}. The resource is no longer available. Aborting retries.`));
      await moveToDeadLetterQueue(queueItem, e, bulkWriter, 'RESOURCE_GONE');
      return QueueResult.MovedToDLQ;
    } else if (e.statusCode === 401) {
      // Token might be bad, getTokenData usually handles refresh but if it fails here, maybe we need force refresh?
      // For now, treat as error
      logger.error(new Error(`401 Unauthorized for ${queueItem.id}. Token might be invalid despite refresh.`));
      await increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
    } else {
      logger.error(new Error(`Could not get workout for ${queueItem.id} and token user ${(serviceToken as any).userID}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}  URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
    }
    logger.info('Ending timer: DownloadFile');
    return QueueResult.RetryIncremented;
  }


  try {
    logger.info(`File size: ${result.byteLength || result.length} bytes for queue item ${queueItem.id}`);
    let event;
    switch (queueItem.activityFileType) {
      case 'FIT':
        event = await EventImporterFIT.getFromArrayBuffer(result, createParsingOptions());
        break;
      case 'GPX':
        try {
          event = await EventImporterGPX.getFromString(result, xmldom.DOMParser, createParsingOptions());
        } catch {
          logger.error('Could not decode as GPX trying as FIT');
        }
        if (!event) {
          logger.info('Starting timer: DownloadFileRetry');
          // Retry as FIT if GPX failed (Legacy fallback?)
          // Note: We use the same URL
          result = await requestPromise.get({
            headers: {
              'Authorization': `Bearer ${serviceToken.accessToken}`,
            },
            encoding: null,
            url: url,
          });
          logger.info('Ending timer: DownloadFileRetry');
          logger.info(`Downloaded ${queueItem.activityFileType} (retry as FIT) for ${queueItem.id}`);
          event = await EventImporterFIT.getFromArrayBuffer(result, createParsingOptions());
        }
        break;
      case 'TCX':
        event = await EventImporterTCX.getFromXML(
          new xmldom.DOMParser().parseFromString(result, 'application/xml'),
          createParsingOptions(),
        );
        break;
    }
    event.name = event.startDate.toJSON(); // @todo improve
    logger.info(`Created Event from FIT file of ${queueItem.id} and token user ${(serviceToken as any).userID}`);
    const metaData = new GarminAPIEventMetaData(
      queueItem.userID,
      queueItem.activityFileID,
      queueItem.activityFileType,
      queueItem.manual || false,
      queueItem.startTimeInSeconds || 0, // 0 is ok here I suppose
      new Date());
    const eventID = await generateEventID(firebaseUserID, event.startDate);
    if (await shouldSkipQueueWorkForDeletedUser(firebaseUserID, ServiceNames.GarminAPI, queueItem.id, 'before_event_write')) {
      return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
    }
    const setEventResult = await setEvent(firebaseUserID, eventID, event, metaData, { data: result, extension: queueItem.activityFileType.toLowerCase(), startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
    if (!bulkWriter) {
      if (await shouldSkipQueueWorkForDeletedUser(firebaseUserID, ServiceNames.GarminAPI, queueItem.id, 'before_activity_sync_enqueue')) {
        return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
      }

      try {
        const activitySyncEventID = `${(setEventResult as any)?.eventID || eventID}`;
        const activitySyncOriginalFiles = Array.isArray((setEventResult as any)?.savedOriginalFiles) ? (setEventResult as any).savedOriginalFiles : [];
        await enqueueActivitySyncJobsForImportedEvent({
          userID: firebaseUserID,
          eventID: activitySyncEventID,
          sourceServiceName: ServiceNames.GarminAPI,
          sourceActivityID: queueItem.activityFileID,
          originalFiles: activitySyncOriginalFiles,
        });
      } catch (activitySyncError) {
        logger.error(`[ActivitySync] Failed to enqueue Garmin->destination sync for event ${eventID} and user ${firebaseUserID}. Import remains successful.`, activitySyncError);
      }
    }
    logger.info(`Created Event ${event.getID()} for ${queueItem.id} user id ${firebaseUserID} and token user ${(serviceToken as any).userID}`);
    // For each ended so we can set it to processed
    return updateToProcessed(queueItem, bulkWriter);
  } catch (e: unknown) {
    logger.error(e);
    if (e instanceof UsageLimitExceededError) {
      logger.error(new Error(`Usage limit exceeded for ${queueItem.id}. Aborting retries. ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
      return QueueResult.RetryIncremented;
    } else if (e instanceof UserNotFoundError) {
      logger.error(new Error(`User for queue item ${queueItem.id} not found. Aborting retries. ${e.message}`));
      await moveToDeadLetterQueue(queueItem, e, bulkWriter, 'USER_NOT_FOUND');
      return QueueResult.MovedToDLQ;
    }

    const err = e instanceof Error ? e : new Error(String(e));

    // Attempt to upload the debug file if we have the result (file data)
    if (result) {
      try {
        await uploadDebugFile(result, queueItem.activityFileType.toLowerCase(), queueItem.id, 'garmin', firebaseUserID);
      } catch (uploadError) {
        logger.error(`Failed to upload debug file for ${queueItem.id}:`, uploadError);
      }
    }

    logger.info(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${(serviceToken as any).userID} to ${queueItem.retryCount + 1} due to ${err.message}`));
    await increaseRetryCountForQueueItem(queueItem, err, 1, bulkWriter);
    return QueueResult.RetryIncremented;
  }
}



export interface GarminAPIActivityFileInterface {
  userId: string,
  userAccessToken: string,
  fileType: 'FIT' | 'TCX' | 'GPX',
  callbackURL: string,
  startTimeInSeconds: number,
  manual: boolean,
  token: string,
  summaryId?: string,
}
