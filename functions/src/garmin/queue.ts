import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { QueueErrors, QueueLogs } from '../shared/constants';
import { addToQueueForGarmin } from '../queue';
import { increaseRetryCountForQueueItem, updateToProcessed, moveToDeadLetterQueue, QueueResult } from '../queue-utils';

import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { generateIDFromParts, setEvent, UsageLimitExceededError, UserNotFoundError } from '../utils';
import * as requestPromise from '../request-helper';
import {
  GarminAPIActivityQueueItemInterface,
} from '../queue/queue-item.interface';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getTokenData } from '../tokens';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import * as xmldom from 'xmldom';
import {
  GarminAPIEventMetaData,
  ActivityParsingOptions,
} from '@sports-alliance/sports-lib';

interface RequestError extends Error {
  statusCode?: number;
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
      const activityFileID = new URLSearchParams(activityFile.callbackURL.split('?')[1]).get('id');
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

  // Use getTokenData (Shared) to handle auto-refresh if needed
  let serviceToken;
  try {
    serviceToken = await getTokenData(tokenQuerySnapshots.docs[0], ServiceNames.GarminAPI);
  } catch (e: any) {
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
        event = await EventImporterFIT.getFromArrayBuffer(result, new ActivityParsingOptions({ generateUnitStreams: false }));
        break;
      case 'GPX':
        try {
          event = await EventImporterGPX.getFromString(result, xmldom.DOMParser, new ActivityParsingOptions({ generateUnitStreams: false }));
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
          event = await EventImporterFIT.getFromArrayBuffer(result, new ActivityParsingOptions({ generateUnitStreams: false }));
        }
        break;
      case 'TCX':
        event = await EventImporterTCX.getFromXML(new xmldom.DOMParser().parseFromString(result, 'application/xml'), new ActivityParsingOptions({ generateUnitStreams: false }));
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
    const eventID = await generateIDFromParts([queueItem.userID, (queueItem.startTimeInSeconds || 0).toString()]);
    // The parent of the token document is the 'tokens' collection, and its parent is the User document.
    const firebaseUserID = tokenQuerySnapshots.docs[0].ref.parent.parent!.id;
    await setEvent(firebaseUserID, eventID, event, metaData, { data: result, extension: queueItem.activityFileType.toLowerCase(), startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
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
}
