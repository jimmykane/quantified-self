import { ServiceNames } from '@sports-alliance/sports-lib';
import * as admin from 'firebase-admin';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { getTokenData } from './tokens';
import {
  SUUNTOAPP_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME,
  SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
} from './suunto/constants';
import * as requestPromise from './request-helper';
import * as functions from 'firebase-functions/v1';
import { generateIDFromParts } from './utils';
import { COROSAPIWorkoutQueueItemInterface, SuuntoAppWorkoutQueueItemInterface } from './queue/queue-item.interface';
import { getServiceConfig } from './OAuth2';
import {
  COROSAPI_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME,
  COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
  PRODUCTION_URL,
  STAGING_URL,
  USE_STAGING,
} from './coros/constants';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import { GARMIN_HEALTHAPI_WORKOUT_QUEUE_COLLECTION_NAME } from './garmin/constants';
import { convertCOROSWorkoutsToQueueItems } from './coros/queue';

const BATCH_SIZE = 450;

export async function addHistoryToQueue(userID: string, serviceName: ServiceNames, startDate: Date, endDate: Date) {
  const serviceConfig = getServiceConfig(serviceName);
  const tokenQuerySnapshots = await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).collection('tokens').get();

  console.log(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  // Get the history for those tokens
  let totalProcessedWorkoutsCount = 0;
  let processedBatchesCount = 0;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    const serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, false);

    let workoutQueueItems: any;
    try {
      workoutQueueItems = await getWorkoutQueueItems(serviceName, serviceToken, startDate, endDate);
    } catch (e: any) {
      console.log(`Could not get history for token ${tokenQueryDocumentSnapshot.id} for user ${userID} due to service error: ${e}`);
      throw e;
    }

    // Filter on dates
    if (workoutQueueItems.length === 0) {
      console.log(`No workouts to add to history for token ${tokenQueryDocumentSnapshot.id} for user ${userID} and for the dates of ${startDate} to ${endDate}`);
      continue;
    }

    console.log(`Found ${workoutQueueItems.length} workouts for the dates of ${startDate} to ${endDate} for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`);

    const batchCount = Math.ceil(workoutQueueItems.length / BATCH_SIZE);
    const batchesToProcess: any[] = [];
    (Array(batchCount)).fill(null).forEach((justNull, index) => {
      const start = index * BATCH_SIZE;
      const end = (index + 1) * BATCH_SIZE;
      batchesToProcess.push(workoutQueueItems.slice(start, end));
    });

    console.log(`Created ${batchCount} batches for token ${tokenQueryDocumentSnapshot.id} for user ${userID}`);
    for (const batchToProcess of batchesToProcess) {
      const batch = admin.firestore().batch();
      let processedWorkoutsCount = 0;
      for (const workoutQueueItem of batchToProcess) {
        // Maybe do a get or insert it at another queue (Done for Suunto app so far)
        batch.set(
          admin.firestore()
            .collection(getServiceWorkoutQueueName(serviceName, true))
            .doc(workoutQueueItem.id), workoutQueueItem);
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
        console.log(`Batch #${processedBatchesCount} with ${processedWorkoutsCount} activities saved for token ${tokenQueryDocumentSnapshot.id} and user ${userID} `);
      } catch (e: any) {
        console.error(`Could not save batch ${processedBatchesCount} for token ${tokenQueryDocumentSnapshot.id} and user ${userID} due to service error aborting`, e);
        processedBatchesCount--;
        totalProcessedWorkoutsCount -= processedWorkoutsCount;
        continue; // Unnecessary but clear to the dev that it will continue
      }
    }
    console.log(`${processedBatchesCount} out of ${batchesToProcess.length} processed and saved for token ${tokenQueryDocumentSnapshot.id} and user ${userID} `);
  }

  console.log(`Total: ${totalProcessedWorkoutsCount} workouts via ${processedBatchesCount} batches added to queue for user ${userID}`);
}

function getServiceHistoryImportWorkoutQueueName(serviceName: ServiceNames): string {
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      return SUUNTOAPP_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME;
    case ServiceNames.COROSAPI:
      return COROSAPI_HISTORY_IMPORT_WORKOUT_QUEUE_COLLECTION_NAME;
  }
}

export function getServiceWorkoutQueueName(serviceName: ServiceNames, historyQueue = false): string {
  if (historyQueue) {
    return getServiceHistoryImportWorkoutQueueName(serviceName);
  }
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.GarminHealthAPI:
      return GARMIN_HEALTHAPI_WORKOUT_QUEUE_COLLECTION_NAME;
    case ServiceNames.SuuntoApp:
      return SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME;
    case ServiceNames.COROSAPI:
      return COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME;
  }
}

export async function getWorkoutQueueItems(serviceName: ServiceNames, serviceToken: COROSAPIAuth2ServiceTokenInterface | SuuntoAPIAuth2ServiceTokenInterface, startDate: Date, endDate: Date): Promise<SuuntoAppWorkoutQueueItemInterface | COROSAPIWorkoutQueueItemInterface[]> {
  let result;
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      result = await requestPromise.get({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
          'json': true,
        },
        url: `https://cloudapi.suunto.com/v2/workouts?since=${startDate.getTime()}&until=${endDate.getTime()}&limit=1000000&filter-by-modification-time=false`,
      });
      result = JSON.parse(result);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.payload
        // .filter((item: any) => (new Date(item.startTime)) >= startDate && (new Date(item.startTime)) <= endDate)
        .filter((item: any) => !!item.workoutKey)
        .map((item: any) => {
          return {
            id: generateIDFromParts([serviceToken.userName, item.workoutKey]),
            dateCreated: new Date().getTime(),
            userName: serviceToken.userName,
            workoutID: item.workoutKey,
            retryCount: 0, // So it can be re-processed
            processed: false, // So it can be re-processed
          };
        });
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
      return convertCOROSWorkoutsToQueueItems(result.data, (serviceToken as COROSAPIAuth2ServiceTokenInterface).openId);
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
