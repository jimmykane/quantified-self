import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { QueueErrors, QueueLogs } from '../shared/constants';
import { addToQueueForGarmin } from '../queue';
import { increaseRetryCountForQueueItem, updateToProcessed, moveToDeadLetterQueue } from '../queue-utils';

import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { generateIDFromParts, setEvent, UsageLimitExceededError } from '../utils';
import { GarminHealthAPIAuth } from './auth/auth';
import * as requestPromise from '../request-helper';
import {
  GarminHealthAPIActivityQueueItemInterface,
} from '../queue/queue-item.interface';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import * as xmldom from 'xmldom';
import {
  GarminHealthAPIEventMetaData,
} from '@sports-alliance/sports-lib';
interface RequestError extends Error {
  statusCode?: number;
}

const GARMIN_ACTIVITY_URI = 'https://apis.garmin.com/wellness-api/rest/activityFile';

export const insertGarminHealthAPIActivityFileToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '256MB',
}).https.onRequest(async (req, res) => {
  const activityFiles: GarminHealthAPIActivityFileInterface[] = req.body.activityFiles;
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
        });
      queueItemRefs.push(queueItemDocumentReference);
    } catch (e: unknown) {
      logger.error(e);
      res.status(500).send();
      return;
    }
  }
  logger.info(`Inserted to queue ${queueItemRefs.length}`);
  res.status(200).send();
});




export async function processGarminHealthAPIActivityQueueItem(queueItem: GarminHealthAPIActivityQueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, tokenCache?: Map<string, Promise<admin.firestore.QuerySnapshot>>, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>) {
  logger.info(`Processing queue item ${queueItem.id} and userID ${queueItem.userID} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots: admin.firestore.QuerySnapshot | undefined;
  const userKey = `GarminHealthAPI:${queueItem['userID']}`;

  if (tokenCache) {
    let tokenPromise = tokenCache.get(userKey);
    if (!tokenPromise) {
      tokenPromise = admin.firestore().collection('garminHealthAPITokens').where('userID', '==', queueItem['userID']).get();
      tokenCache.set(userKey, tokenPromise);
    }
    try {
      tokenQuerySnapshots = await tokenPromise;
    } catch (e: any) {
      logger.error(e);
      return increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
    }
  } else {
    tokenQuerySnapshots = await admin.firestore().collection('garminHealthAPITokens').where('userID', '==', queueItem['userID']).get();
  }

  if (!tokenQuerySnapshots.size) {
    logger.warn(QueueLogs.NO_TOKEN_FOUND.replace('${id}', queueItem.id));
    // return increaseRetryCountForQueueItem(queueItem, new Error('No tokens found'), 20, bulkWriter);
    return moveToDeadLetterQueue(queueItem, new Error(QueueErrors.NO_TOKEN_FOUND), bulkWriter, 'NO_TOKEN_FOUND');
  }

  const serviceToken = tokenQuerySnapshots.docs[0].data();

  const oAuth = GarminHealthAPIAuth();

  let result;
  const url = `${GARMIN_ACTIVITY_URI}?id=${queueItem.activityFileID}&token=${queueItem.token}`;
  try {
    logger.info('Starting timer: DownloadFile');
    result = await requestPromise.get({
      headers: oAuth.toHeader(oAuth.authorize({
        url: url,
        method: 'get',
      },
        {
          key: serviceToken.accessToken,
          secret: serviceToken.accessTokenSecret,
        })),
      encoding: queueItem.activityFileType === 'FIT' ? null : undefined,
      // gzip: true,
      url: url,
    });
    logger.info('Ending timer: DownloadFile');
    logger.info(`Downloaded ${queueItem.activityFileType} for ${queueItem.id} and token user ${serviceToken.userID}`);
  } catch (error: unknown) {
    const e = error as RequestError;
    if (e.statusCode === 400) {
      logger.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 403, increasing retry by 20 URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
    } else if (e.statusCode === 500) {
      logger.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 500 increasing retry by 20 URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
    } else {
      logger.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}  URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
    }
    logger.info('Ending timer: DownloadFile');
    return;
  }

  try {
    let event;
    switch (queueItem.activityFileType) {
      case 'FIT':
        event = await EventImporterFIT.getFromArrayBuffer(result);
        break;
      case 'GPX':
        try {
          event = await EventImporterGPX.getFromString(result, xmldom.DOMParser);
        } catch {
          logger.error('Could not decode as GPX trying as FIT');
        }
        if (!event) {
          // Let it fail in any case
          // @todo extract or encode somehow
          // I hate this
          logger.info('Starting timer: DownloadFile');
          result = await requestPromise.get({
            headers: oAuth.toHeader(oAuth.authorize({
              url: url,
              method: 'get',
            },
              {
                key: serviceToken.accessToken,
                secret: serviceToken.accessTokenSecret,
              })),
            encoding: null,
            // gzip: true,
            url: url,
          });
          logger.info('Ending timer: DownloadFile');
          logger.info(`Downloaded ${queueItem.activityFileType} for ${queueItem.id} and token user ${serviceToken.userID}`);
          event = await EventImporterFIT.getFromArrayBuffer(result); // Let it fail here
        }
        break;
      case 'TCX':
        event = await EventImporterTCX.getFromXML(new xmldom.DOMParser().parseFromString(result, 'application/xml'));
        break;
    }
    event.name = event.startDate.toJSON(); // @todo improve
    logger.info(`Created Event from FIT file of ${queueItem.id} and token user ${serviceToken.userID}`);
    const metaData = new GarminHealthAPIEventMetaData(
      queueItem.userID,
      queueItem.activityFileID,
      queueItem.activityFileType,
      queueItem.manual || false,
      queueItem.startTimeInSeconds || 0, // 0 is ok here I suppose
      new Date());
    await setEvent(tokenQuerySnapshots.docs[0].id, generateIDFromParts([queueItem.userID, queueItem.startTimeInSeconds.toString()]), event, metaData, { data: result, extension: queueItem.activityFileType.toLowerCase(), startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
    logger.info(`Created Event ${event.getID()} for ${queueItem.id} user id ${tokenQuerySnapshots.docs[0].id} and token user ${serviceToken.userID}`);
    // For each ended so we can set it to processed
    return updateToProcessed(queueItem, bulkWriter);
  } catch (e: unknown) {
    // @todo should delete meta etc
    logger.error(e);
    if (e instanceof UsageLimitExceededError) {
      logger.error(new Error(`Usage limit exceeded for ${queueItem.id}. Aborting retries. ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
      return;
    }
    const err = e instanceof Error ? e : new Error(String(e));
    logger.info(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.userID} to ${queueItem.retryCount + 1} due to ${err.message}`));
    await increaseRetryCountForQueueItem(queueItem, err, 1, bulkWriter);
  }
}


export interface GarminHealthAPIActivityFileInterface {
  userId: string,
  userAccessToken: string,
  fileType: 'FIT' | 'TCX' | 'GPX',
  callbackURL: string,
  startTimeInSeconds: number,
  manual: boolean,
  token: string,
}
