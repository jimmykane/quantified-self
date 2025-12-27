import * as functions from 'firebase-functions/v1';
import { MAX_RETRY_COUNT, QUEUE_SCHEDULE, QUEUE_ITEM_TTL_MS } from './shared/queue-config';
import { QueueErrors, QueueLogs } from './shared/constants';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import pLimit from 'p-limit';
import { increaseRetryCountForQueueItem, updateToProcessed, moveToDeadLetterQueue } from './queue-utils';
import { processGarminHealthAPIActivityQueueItem } from './garmin/queue';
import {
  COROSAPIWorkoutQueueItemInterface,
  GarminHealthAPIActivityQueueItemInterface,
  SuuntoAppWorkoutQueueItemInterface,
} from './queue/queue-item.interface';
import { generateIDFromParts, setEvent, UsageLimitExceededError, enqueueWorkoutTask } from './utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceWorkoutQueueName } from './shared/queue-names';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import * as requestPromise from './request-helper';
import { config } from './config';
import { getTokenData } from './tokens';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { COROSAPIEventMetaData, SuuntoAppEventMetaData } from '@sports-alliance/sports-lib';



export async function parseQueueItems(serviceName: ServiceNames, fromHistoryQueue = false) {
  const RETRY_COUNT = MAX_RETRY_COUNT;
  const LIMIT = 200;
  // @todo add queue item sort date for creation
  const querySnapshot = await admin.firestore()
    .collection(getServiceWorkoutQueueName(serviceName, fromHistoryQueue))
    .where('processed', '==', false)
    .where('retryCount', '<', RETRY_COUNT)
    .limit(LIMIT).get(); // Max 10 retries
  logger.info(`Found ${querySnapshot.size} queue items to process`);
  let count = 0;
  logger.info('Starting timer: ParseQueueItems');

  const bulkWriter = admin.firestore().bulkWriter();
  const limit = pLimit(20);
  const tokenCache = new Map<string, Promise<admin.firestore.QuerySnapshot>>();
  const usageCache = new Map<string, Promise<{ role: string, limit: number, currentCount: number }>>();
  const pendingWrites = new Map<string, number>();

  const promises = querySnapshot.docs.map(async (queueItem) => {
    return limit(async () => {
      try {
        switch (serviceName) {
          default:
            throw new Error('Not Implemented');
          case ServiceNames.COROSAPI:
            await parseWorkoutQueueItemForServiceName(serviceName, <COROSAPIWorkoutQueueItemInterface>Object.assign({
              id: queueItem.id,
              ref: queueItem.ref,
            }, queueItem.data()), bulkWriter, tokenCache, usageCache, pendingWrites);
            break;
          case ServiceNames.SuuntoApp:
            await parseWorkoutQueueItemForServiceName(serviceName, <SuuntoAppWorkoutQueueItemInterface>Object.assign({
              id: queueItem.id,
              ref: queueItem.ref,
            }, queueItem.data()), bulkWriter, tokenCache, usageCache, pendingWrites);
            break;
          case ServiceNames.GarminHealthAPI:
            await processGarminHealthAPIActivityQueueItem(Object.assign({
              id: queueItem.id,
              ref: queueItem.ref,
            }, <GarminHealthAPIActivityQueueItemInterface>queueItem.data()), bulkWriter, tokenCache, usageCache, pendingWrites);
            break;
        }
        count++;
        logger.info(`Parsed queue item ${count}/${querySnapshot.size} and id ${queueItem.id}`);
        // console.timeLog('ParseQueueItems'); // timeLog might be noisy in parallel
      } catch (e: unknown) {
        const error = e as Error;
        logger.error(new Error(`Error parsing queue item ${queueItem.id}: ${error.message}`));
      }
    });
  });

  await Promise.all(promises);
  await bulkWriter.close();

  logger.info('Ending timer: ParseQueueItems');
  logger.info(`Parsed ${count} queue items out of ${querySnapshot.size}`);
}

const TIMEOUT_DEFAULT = 300;
const MEMORY_DEFAULT = '2GB';
const TIMEOUT_HIGH = 540;
const MEMORY_HIGH = '4GB';

export const parseGarminHealthAPIActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_HIGH,
  memory: MEMORY_HIGH,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await parseQueueItems(ServiceNames.GarminHealthAPI);
});

export const parseCOROSAPIWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_DEFAULT,
  memory: MEMORY_DEFAULT,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await parseQueueItems(ServiceNames.COROSAPI);
});

export const parseCOROSAPIHistoryImportWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_DEFAULT,
  memory: MEMORY_DEFAULT,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await parseQueueItems(ServiceNames.COROSAPI, true);
});

export const parseSuuntoAppActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_HIGH,
  memory: MEMORY_HIGH,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await parseQueueItems(ServiceNames.SuuntoApp);
});

export const parseSuuntoAppHistoryImportActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_HIGH,
  memory: MEMORY_HIGH,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await parseQueueItems(ServiceNames.SuuntoApp, true);
});



/**
 * Needed to create and stamp an id
 * @param queueItem
 */
export async function addToQueueForSuunto(queueItem: { userName: string, workoutID: string }): Promise<admin.firestore.DocumentReference> {
  logger.info(`Inserting to queue ${queueItem.userName} ${queueItem.workoutID}`);
  return addToWorkoutQueue({
    id: generateIDFromParts([queueItem.userName, queueItem.workoutID]),
    dateCreated: new Date().getTime(),
    userName: queueItem.userName,
    workoutID: queueItem.workoutID,
    retryCount: 0,
    processed: false,
  }, ServiceNames.SuuntoApp);
}

/**
 * Needed to create and stamp an id
 * @param queueItem
 */
export async function addToQueueForGarmin(queueItem: { userID: string, startTimeInSeconds: number, manual: boolean, activityFileID: string, activityFileType: 'FIT' | 'TCX' | 'GPX', token: string }): Promise<admin.firestore.DocumentReference> {
  logger.info(`Inserting to queue ${generateIDFromParts([queueItem.userID, queueItem.startTimeInSeconds.toString()])} for ${queueItem.userID} fileID ${queueItem.activityFileID}`);
  return addToWorkoutQueue({
    id: generateIDFromParts([queueItem.userID, queueItem.startTimeInSeconds.toString()]),
    dateCreated: new Date().getTime(),
    userID: queueItem.userID,
    startTimeInSeconds: queueItem.startTimeInSeconds,
    manual: queueItem.manual,
    activityFileID: queueItem.activityFileID,
    token: queueItem.token,
    activityFileType: queueItem.activityFileType,
    retryCount: 0,
    processed: false,
  }, ServiceNames.GarminHealthAPI);
}

/**
 * NOT Needed to create and stamp an id COROS workouts should already have a queue item with more data sorry....
 * @param queueItem
 */
export async function addToQueueForCOROS(queueItem: COROSAPIWorkoutQueueItemInterface): Promise<admin.firestore.DocumentReference> {
  logger.info(`Inserting to queue ${queueItem.openId} ${queueItem.workoutID}`);
  return addToWorkoutQueue(queueItem, ServiceNames.COROSAPI);
}

export function getWorkoutForService(
  serviceName: ServiceNames,
  workoutQueueItem: COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface | GarminHealthAPIActivityQueueItemInterface,
  serviceToken?: SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface): Promise<any> {
  switch (serviceName) {
    default:
      throw new Error('Not Implemented');
    case ServiceNames.COROSAPI:
      return requestPromise.get({
        encoding: null,
        // gzip: true,
        url: (workoutQueueItem as COROSAPIWorkoutQueueItemInterface).FITFileURI,
      });
    case ServiceNames.SuuntoApp:
      return requestPromise.get({
        headers: {
          'Authorization': (serviceToken as SuuntoAPIAuth2ServiceTokenInterface).accessToken,
          'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
        },
        encoding: null,
        // gzip: true,
        url: `https://cloudapi.suunto.com/v3/workouts/${(workoutQueueItem as SuuntoAppWorkoutQueueItemInterface).workoutID}/fit`,
      });
  }
}


export async function parseWorkoutQueueItemForServiceName(serviceName: ServiceNames, queueItem: COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface | GarminHealthAPIActivityQueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, tokenCache?: Map<string, Promise<admin.firestore.QuerySnapshot>>, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>) {
  if (serviceName === ServiceNames.GarminHealthAPI) {
    return processGarminHealthAPIActivityQueueItem(queueItem as GarminHealthAPIActivityQueueItemInterface, bulkWriter, tokenCache, usageCache, pendingWrites);
  }

  logger.info(`Processing queue item ${queueItem.id} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots: admin.firestore.QuerySnapshot | undefined;
  const userKey = `${serviceName}:${(queueItem as COROSAPIWorkoutQueueItemInterface).openId || (queueItem as SuuntoAppWorkoutQueueItemInterface).userName}`;

  if (tokenCache) {
    let tokenPromise = tokenCache.get(userKey);
    if (!tokenPromise) {
      tokenPromise = (async () => {
        switch (serviceName) {
          default:
            throw new Error('Not Implemented');
          case ServiceNames.COROSAPI:
            return admin.firestore().collectionGroup('tokens').where('openId', '==', (queueItem as COROSAPIWorkoutQueueItemInterface).openId).get();
          case ServiceNames.SuuntoApp:
            return admin.firestore().collectionGroup('tokens').where('userName', '==', (queueItem as SuuntoAppWorkoutQueueItemInterface).userName).get();
        }
      })();
      tokenCache.set(userKey, tokenPromise);
    }
    try {
      tokenQuerySnapshots = await tokenPromise;
    } catch (e: unknown) {
      const error = e as Error;
      logger.error(error);
      // If the promise fails, we might want to remove it from cache so next ones can retry,
      // but for this batch execution it might be better to just fail.
      return increaseRetryCountForQueueItem(queueItem, error, 1, bulkWriter);
    }
  } else {
    try {
      switch (serviceName) {
        default:
          throw new Error('Not Implemented');
        case ServiceNames.COROSAPI:
          tokenQuerySnapshots = await admin.firestore().collectionGroup('tokens').where('openId', '==', (queueItem as COROSAPIWorkoutQueueItemInterface).openId).get();
          break;
        case ServiceNames.SuuntoApp:
          tokenQuerySnapshots = await admin.firestore().collectionGroup('tokens').where('userName', '==', (queueItem as SuuntoAppWorkoutQueueItemInterface).userName).get();
          break;
      }
    } catch (e: unknown) {
      const error = e as Error;
      logger.error(error);
      return increaseRetryCountForQueueItem(queueItem, error, 1, bulkWriter);
    }
  }

  // If there is no token for the user, give them a few chances to reconnect
  if (!tokenQuerySnapshots.size) {
    logger.warn(QueueLogs.NO_TOKEN_FOUND.replace('${id}', queueItem.id));
    // return updateToProcessed(queueItem, bulkWriter, { processingError: 'NO_TOKEN_FOUND' });
    return moveToDeadLetterQueue(queueItem, new Error(QueueErrors.NO_TOKEN_FOUND), bulkWriter, 'NO_TOKEN_FOUND');
  }

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;

    // So if 2 tokens exist for 1 queue item then it will
    // IF refresh fails it will go and try to import the for the next token
    // If import fails for the next token it will increase count (fail ) and try from start.
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName);
    } catch (e: any) {
      logger.error(e);
      logger.error(new Error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`));
      continue;
    }

    const parent1 = tokenQueryDocumentSnapshot.ref.parent;
    if (!parent1) {
      throw new Error(`No parent found for ${tokenQueryDocumentSnapshot.id}`);
    }
    const parentID = parent1.parent!.id;

    logger.info(`Found user id ${parentID} for queue item ${queueItem.id}`);

    let result;
    try {
      logger.info('Starting timer: DownloadFit');
      result = await getWorkoutForService(serviceName, queueItem, serviceToken);
      logger.info(`Downloaded FIT file for ${queueItem.id}`);
    } catch (e: any) {
      logger.info('Ending timer: DownloadFit');
      if (e.statusCode === 401) {
        logger.warn(`Unauthorized to download workout for ${queueItem.id}, attempting to force refresh token and retry...`);
        try {
          // Force refresh token and save
          serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, true);
          result = await getWorkoutForService(serviceName, queueItem, serviceToken);
        } catch (retryError: any) {
          logger.error(new Error(`Could not get workout for ${queueItem.id} even after force refresh: ${retryError.message}`));
          await increaseRetryCountForQueueItem(queueItem, retryError, 1, bulkWriter);
          continue;
        }
      } else if (e.statusCode === 403) {
        logger.error(new Error(`Could not get workout for ${queueItem.id} due to 403, increasing retry by 20`));
        await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
        continue;
      } else if (e.statusCode === 500) {
        logger.error(new Error(`Could not get workout for ${queueItem.id} due to 500 increasing retry by 20`));
        await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
        continue;
      } else {
        logger.error(new Error(`Could not get workout for ${queueItem.id}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}`));
        await increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
        continue;
      }
    }
    logger.info('Ending timer: DownloadFit');
    try {
      logger.info('Starting timer: CreateEvent');
      const event = await EventImporterFIT.getFromArrayBuffer(result);
      logger.info('Ending timer: CreateEvent');
      event.name = event.startDate.toJSON(); // @todo improve
      logger.info(`Created Event from FIT file of ${queueItem.id}`);
      logger.info('Starting timer: InsertEvent');
      switch (serviceName) {
        default:
          throw new Error('Not Implemented');
        case ServiceNames.COROSAPI: {
          const corosWorkoutQueueItem = queueItem as COROSAPIWorkoutQueueItemInterface;
          const corosMetaData = new COROSAPIEventMetaData(corosWorkoutQueueItem.workoutID, corosWorkoutQueueItem.openId, corosWorkoutQueueItem.FITFileURI, new Date());
          await setEvent(parentID, generateIDFromParts([corosWorkoutQueueItem.openId, corosWorkoutQueueItem.workoutID, corosWorkoutQueueItem.FITFileURI]), event, corosMetaData, { data: result, extension: 'fit', startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
          break;
        }
        case ServiceNames.SuuntoApp: {
          const suuntoWorkoutQueueItem = queueItem as SuuntoAppWorkoutQueueItemInterface;
          const suuntoMetaData = new SuuntoAppEventMetaData(suuntoWorkoutQueueItem.workoutID, suuntoWorkoutQueueItem.userName, new Date());
          await setEvent(parentID, generateIDFromParts([suuntoWorkoutQueueItem.userName, suuntoWorkoutQueueItem.workoutID]), event, suuntoMetaData, { data: result, extension: 'fit', startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
        }
      }
      logger.info('Ending timer: InsertEvent');
      logger.info(`Created Event ${event.getID()} for ${queueItem.id} user id ${parentID} and token user ${serviceToken.openId || serviceToken.userName}`);
      logger.info(`Parsed item successfully for ${queueItem.id}`);
    } catch (e: any) {
      // @todo should delete event  or separate catch
      logger.error(e);
      if (e instanceof UsageLimitExceededError) {
        logger.error(new Error(`Usage limit exceeded for ${queueItem.id}. Aborting retries. ${e.message}`));
        await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter); // Stop retries
        continue;
      }
      logger.error(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.openId || serviceToken.userName} to ${queueItem.retryCount + 1} due to ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
      continue;
    }
    // If we made it here, the workout was processed successfully for at least one token.
    // We can stop and mark as processed.
    return updateToProcessed(queueItem, bulkWriter);
  }

  // If we finished the loop without returning, it means every token attempt failed.
  logger.error(new Error(`Could not process ANY tokens for ${queueItem.id} after checking all ${tokenQuerySnapshots.size} tokens. Increasing retry count.`));
  return increaseRetryCountForQueueItem(queueItem, new Error('All token processing attempts failed'), 1, bulkWriter);
}

async function addToWorkoutQueue(queueItem: SuuntoAppWorkoutQueueItemInterface | GarminHealthAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface, serviceName: ServiceNames): Promise<admin.firestore.DocumentReference> {
  const queueItemDocument = admin.firestore().collection(getServiceWorkoutQueueName(serviceName)).doc(queueItem.id);
  await queueItemDocument.set(Object.assign(queueItem, {
    expireAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + QUEUE_ITEM_TTL_MS)),
  }));
  // Dispatch a Cloud Task for immediate processing
  await enqueueWorkoutTask(serviceName, queueItem.id);
  return queueItemDocument;
}
