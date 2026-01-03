import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { getTokenData } from './tokens';
import * as requestPromise from './request-helper';
import { config } from './config';
import { generateIDFromParts, enqueueWorkoutTask } from './utils';
import { COROSAPIWorkoutQueueItemInterface, SuuntoAppWorkoutQueueItemInterface } from './queue/queue-item.interface';
import { getServiceConfig } from './OAuth2';
import { getServiceWorkoutQueueName } from './shared/queue-names';
import {
  PRODUCTION_URL,
  STAGING_URL,
  USE_STAGING,
} from './coros/constants';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import { convertCOROSWorkoutsToQueueItems } from './coros/queue';


const BATCH_SIZE = 450;

/**
 * Validates the history import request and enqueues a task to process it.
 */
export async function addToHistoryImportQueue(userID: string, serviceName: ServiceNames, startDate: Date, endDate: Date): Promise<void> {

  // @todo improve ?
  // Create a queue item for the *request* itself
  const queueItem: any = {
    id: await generateIDFromParts(['history-import', userID, serviceName, startDate.toISOString(), endDate.toISOString()]),
    dateCreated: new Date().getTime(),
    processed: false,
    retryCount: 0,
    type: 'import_request',
    // Specific fields for the request
    userID,
    serviceName,
    startDate: startDate.getTime(),
    endDate: endDate.getTime(),
  };

  const queueName = getServiceWorkoutQueueName(serviceName, true);
  await admin.firestore().collection(queueName).doc(queueItem.id).set(queueItem);

  // Dispatch the task (reusing the existing workout task dispatcher)
  // The worker will see type='import_request' and call processHistoryImportRequest
  await enqueueWorkoutTask(serviceName, queueItem.id);

  logger.info(`Enqueued history import request ${queueItem.id} for user ${userID} service ${serviceName}`);
}


/**
 * Processes the history import *request* (fetching the list of workouts).
 * This is called by the Cloud Task worker when it encounters an item with type='import_request'.
 */
export async function processHistoryImportRequest(userID: string, serviceName: ServiceNames, startDate: Date, endDate: Date): Promise<void> {
  const serviceConfig = getServiceConfig(serviceName);
  const tokenQuerySnapshots = await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).collection('tokens').get();

  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  // Get the history for those tokens
  let totalProcessedWorkoutsCount = 0;
  let processedBatchesCount = 0;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    const serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, false);

    let workoutQueueItems: any;
    try {
      workoutQueueItems = await getWorkoutQueueItems(serviceName, serviceToken, startDate, endDate);
    } catch (e: any) {
      logger.info(`Could not get history for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error: ${e}`);
      throw e;
    }

    // Filter on dates
    if (workoutQueueItems.length === 0) {
      logger.info(`No workouts to add to history for token ${tokenQueryDocumentSnapshot.id} for user ${userID} and for the dates of ${startDate} to ${endDate}`);
      continue;
    }

    logger.info(`Found ${workoutQueueItems.length} workouts for the dates of ${startDate} to ${endDate} for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`);

    const batchCount = Math.ceil(workoutQueueItems.length / BATCH_SIZE);
    const batchesToProcess: any[] = [];
    (Array(batchCount)).fill(null).forEach((justNull, index) => {
      const start = index * BATCH_SIZE;
      const end = (index + 1) * BATCH_SIZE;
      batchesToProcess.push(workoutQueueItems.slice(start, end));
    });

    logger.info(`Created ${batchCount} batches for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`);
    for (const batchToProcess of batchesToProcess) {
      const batch = admin.firestore().batch();
      let processedWorkoutsCount = 0;
      for (const workoutQueueItem of batchToProcess) {
        await enqueueWorkoutTask(serviceName, workoutQueueItem.id);
        // Explicitly set type to 'workout_item' (or rely on undefined being treated as such)
        // Helper to ensure consistency
        const item = {
          ...workoutQueueItem,
          type: 'workout_item',
        };

        batch.set(
          admin.firestore()
            .collection(getServiceWorkoutQueueName(serviceName, true))
            .doc(item.id), item);
        processedWorkoutsCount++;
      }
      // Try to commit it
      try {
        processedBatchesCount++;
        totalProcessedWorkoutsCount += processedWorkoutsCount;
        batch.set(
          admin.firestore().collection('users').doc(userID).collection('meta').doc(serviceName),
          <UserServiceMetaInterface>{
            didLastHistoryImport: (new Date()).getTime(),
            processedActivitiesFromLastHistoryImportCount: totalProcessedWorkoutsCount,
          }, { merge: true });

        await batch.commit();
        logger.info(`Batch #${processedBatchesCount} with ${processedWorkoutsCount} activities saved for token ${tokenQueryDocumentSnapshot.id} and user ${userID} `);
      } catch (e: any) {
        logger.error(`Could not save batch ${processedBatchesCount} for token ${tokenQueryDocumentSnapshot.id} and user ${userID} due to service error aborting`, e);
        processedBatchesCount--;
        totalProcessedWorkoutsCount -= processedWorkoutsCount;
        // Reading file via view_file in next step because I need to see the implementation first.
        // I will just use `view_file` now.
      }
    }
    logger.info(`${processedBatchesCount} out of ${batchesToProcess.length} processed and saved for token ${tokenQueryDocumentSnapshot.id} and user ${userID} `);
  }

  logger.info(`Total: ${totalProcessedWorkoutsCount} workouts via ${processedBatchesCount} batches added to queue for user ${userID}`);
}

// getServiceWorkoutQueueName moved to shared/queue-names.ts

export async function getWorkoutQueueItems(serviceName: ServiceNames, serviceToken: COROSAPIAuth2ServiceTokenInterface | SuuntoAPIAuth2ServiceTokenInterface, startDate: Date, endDate: Date): Promise<SuuntoAppWorkoutQueueItemInterface | COROSAPIWorkoutQueueItemInterface[]> {
  let result;
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      result = await requestPromise.get({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
          'json': true,
        },
        url: `https://cloudapi.suunto.com/v3/workouts?since=${startDate.getTime()}&until=${endDate.getTime()}&limit=1000000&filter-by-modification-time=false`,
      });
      result = JSON.parse(result);
      if (result.error) {
        throw new Error(result.error);
      }
      return await Promise.all(result.payload
        // .filter((item: any) => (new Date(item.startTime)) >= startDate && (new Date(item.startTime)) <= endDate)
        .filter((item: any) => !!item.workoutKey)
        .map(async (item: any) => {
          return {
            id: await generateIDFromParts([serviceToken.userName, item.workoutKey]),
            dateCreated: new Date().getTime(),
            userName: serviceToken.userName,
            workoutID: item.workoutKey,
            retryCount: 0, // So it can be re-processed
            processed: false, // So it can be re-processed
          };
        }));
    case ServiceNames.COROSAPI:
      result = await requestPromise.get({
        headers: {
          json: true,
        },
        url: `${USE_STAGING ? STAGING_URL : PRODUCTION_URL}/v2/coros/sport/list?token=${serviceToken.accessToken}&openId=${serviceToken.openId}&startDate=${startDate.toISOString().slice(0, 10).replace(/-/g, '')}&endDate=${endDate.toISOString().slice(0, 10).replace(/-/g, '')}`,
      });
      result = JSON.parse(result);
      if (result.message && result.message !== 'OK') {
        throw new Error(`COROS API Error with code ${result.result}`);
      }
      return await convertCOROSWorkoutsToQueueItems(result.data, (serviceToken as COROSAPIAuth2ServiceTokenInterface).openId);
  }
}

export async function isAllowedToDoHistoryImport(userID: string, serviceName: ServiceNames): Promise<boolean> {
  const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(userID).collection('meta').doc(serviceName).get();
  if (!userServiceMetaDocumentSnapshot.exists) {
    return true;
  }
  const data = <UserServiceMetaInterface>userServiceMetaDocumentSnapshot.data();
  const nextHistoryImportAvailableDate = new Date(data.didLastHistoryImport + ((data.processedActivitiesFromLastHistoryImportCount / 500) * 24 * 60 * 60 * 1000)); // 7 days for  285,7142857143 per day
  return !((nextHistoryImportAvailableDate > new Date()) && data.processedActivitiesFromLastHistoryImportCount !== 0);
}
