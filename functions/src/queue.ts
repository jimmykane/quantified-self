import * as admin from 'firebase-admin';
import { processGarminHealthAPIActivityQueueItem } from './garmin/queue';
import {
  COROSAPIWorkoutQueueItemInterface,
  GarminHealthAPIActivityQueueItemInterface,
  QueueItemInterface,
  SuuntoAppWorkoutQueueItemInterface,
} from './queue/queue-item.interface';
import { generateIDFromParts, setEvent } from './utils';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { getServiceWorkoutQueueName } from './history';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import * as requestPromise from './request-helper';
import * as functions from 'firebase-functions';
import { getTokenData } from './tokens';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { COROSAPIEventMetaData, SuuntoAppEventMetaData } from '@sports-alliance/sports-lib/lib/meta-data/meta-data';

export async function increaseRetryCountForQueueItem(queueItem: QueueItemInterface, serviceName: ServiceNames, error: Error, incrementBy = 1) {
  if (!queueItem.ref) {
    throw new Error(`No docuemnt reference supplied for queue item ${queueItem.id}`);
  }
  queueItem.retryCount += incrementBy;
  queueItem.totalRetryCount = queueItem.totalRetryCount || 0;
  queueItem.totalRetryCount += incrementBy;
  queueItem.errors = queueItem.errors || [];
  queueItem.errors.push({
    error: error.message,
    atRetryCount: queueItem.totalRetryCount,
    date: (new Date()).getTime(),
  });

  try {
    const ref = queueItem.ref;
    queueItem.ref = undefined;
    await ref.update(JSON.parse(JSON.stringify(queueItem)));
    console.info(`Updated retry count for ${queueItem.id} to ${queueItem.retryCount}`);
  } catch (e: any) {
    console.error(new Error(`Could not update retry count on ${queueItem.id}`));
  }
}

export async function updateToProcessed(queueItem: QueueItemInterface, serviceName: ServiceNames) {
  if (!queueItem.ref) {
    throw new Error(`No docuemnt reference supplied for queue item ${queueItem.id}`);
  }
  try {
    const ref = queueItem.ref;
    queueItem.ref = undefined;
    await ref.update({
      'processed': true,
      'processedAt': (new Date()).getTime(),
    });
    console.log(`Updated to processed  ${queueItem.id}`);
  } catch (e: any) {
    console.error(new Error(`Could not update processed state for ${queueItem.id}`));
  }
}

export async function parseQueueItems(serviceName: ServiceNames, fromHistoryQueue = false) {
  const RETRY_COUNT = 10;
  const LIMIT = 200;
  // @todo add queue item sort date for creation
  const querySnapshot = await admin.firestore()
    .collection(getServiceWorkoutQueueName(serviceName, fromHistoryQueue))
    .where('processed', '==', false)
    .where('retryCount', '<', RETRY_COUNT)
    .limit(LIMIT).get(); // Max 10 retries
  console.log(`Found ${querySnapshot.size} queue items to process`);
  let count = 0;
  console.time('ParseQueueItems');
  for (const queueItem of querySnapshot.docs) {
    try {
      switch (serviceName) {
        default:
          throw new Error('Not Implemented');
        case ServiceNames.COROSAPI:
          await parseWorkoutQueueItemForServiceName(serviceName, <COROSAPIWorkoutQueueItemInterface>Object.assign({
            id: queueItem.id,
            ref: queueItem.ref,
          }, queueItem.data()));
          break;
        case ServiceNames.SuuntoApp:
          await parseWorkoutQueueItemForServiceName(serviceName, <SuuntoAppWorkoutQueueItemInterface>Object.assign({
            id: queueItem.id,
            ref: queueItem.ref,
          }, queueItem.data()));
          break;
        case ServiceNames.GarminHealthAPI:
          await processGarminHealthAPIActivityQueueItem(Object.assign({
            id: queueItem.id,
            ref: queueItem.ref,
          }, <GarminHealthAPIActivityQueueItemInterface>queueItem.data()));
          break;
      }
      count++;
      console.log(`Parsed queue item ${count}/${querySnapshot.size} and id ${queueItem.id}`);
      console.timeLog('ParseQueueItems');
    } catch (e: any) {
      console.error(new Error(`Error parsing queue item #${count} of ${querySnapshot.size} and id ${queueItem.id}`));
    }
  }
  console.timeEnd('ParseQueueItems');
  console.log(`Parsed ${count} queue items out of ${querySnapshot.size}`);
}


/**
 * Needed to create and stamp an id
 * @param queueItem
 */
export async function addToQueueForSuunto(queueItem: { userName: string, workoutID: string }): Promise<admin.firestore.DocumentReference> {
  console.log(`Inserting to queue ${queueItem.userName} ${queueItem.workoutID}`);
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
  console.log(`Inserting to queue ${generateIDFromParts([queueItem.userID, queueItem.startTimeInSeconds.toString()])} for ${queueItem.userID} fileID ${queueItem.activityFileID}`);
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
  console.log(`Inserting to queue ${queueItem.openId} ${queueItem.workoutID}`);
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
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
        },
        encoding: null,
        // gzip: true,
        url: `https://cloudapi.suunto.com/v2/workout/exportFit/${(workoutQueueItem as SuuntoAppWorkoutQueueItemInterface).workoutID}`,
      });
  }
}


export async function parseWorkoutQueueItemForServiceName(serviceName: ServiceNames, queueItem: COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface) {
  console.log(`Processing queue item ${queueItem.id} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots;
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
  } catch (e: any) {
    console.error(e);
    return increaseRetryCountForQueueItem(queueItem, serviceName, e);
  }

  // If there is no token for the user skip @todo or retry in case the user reconnects?
  if (!tokenQuerySnapshots.size) {
    console.error(`No token found for queue item ${queueItem.id} increasing count to max`);
    return increaseRetryCountForQueueItem(queueItem, serviceName, new Error('No tokens found'), 20);
  }

  let processedCount = 0;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;

    // So if 2 tokens exist for 1 queue item then it will
    // IF refresh fails it will go and try to import the for the next token
    // If import fails for the next token it will increase count (fail ) and try from start.
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName);
    } catch (e: any) {
      console.error(e);
      console.error(new Error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`));
      continue;
    }

    const parent1 = tokenQueryDocumentSnapshot.ref.parent;
    if (!parent1) {
      throw new Error(`No parent found for ${tokenQueryDocumentSnapshot.id}`);
    }
    const parentID = parent1.parent!.id;

    console.log(`Found user id ${parentID} for queue item ${queueItem.id}`);

    let result;
    try {
      console.time('DownloadFit');
      result = await getWorkoutForService(serviceName, queueItem, serviceToken);
      console.log(`Downloaded FIT file for ${queueItem.id}`);
    } catch (e: any) {
      console.timeEnd('DownloadFit');
      if (e.statusCode === 403) {
        console.error(new Error(`Could not get workout for ${queueItem.id} due to 403, increasing retry by 20`));
        await increaseRetryCountForQueueItem(queueItem, serviceName, e, 20);
        continue;
      }
      if (e.statusCode === 500) {
        console.error(new Error(`Could not get workout for ${queueItem.id} due to 500 increasing retry by 20`));
        await increaseRetryCountForQueueItem(queueItem, serviceName, e, 20);
        continue;
      }
      console.error(new Error(`Could not get workout for ${queueItem.id}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, serviceName, e);
      continue;
    }
    console.timeEnd('DownloadFit');
    try {
      console.time('CreateEvent');
      const event = await EventImporterFIT.getFromArrayBuffer(result);
      console.timeEnd('CreateEvent');
      event.name = event.startDate.toJSON(); // @todo improve
      console.log(`Created Event from FIT file of ${queueItem.id}`);
      console.time('InsertEvent');
      switch (serviceName) {
        default:
          throw new Error('Not Implemented');
        case ServiceNames.COROSAPI:
          const corosWorkoutQueueItem = queueItem as COROSAPIWorkoutQueueItemInterface;
          const corosMetaData = new COROSAPIEventMetaData(corosWorkoutQueueItem.workoutID, corosWorkoutQueueItem.openId, corosWorkoutQueueItem.FITFileURI, new Date());
          await setEvent(parentID, generateIDFromParts([corosWorkoutQueueItem.openId, corosWorkoutQueueItem.workoutID, corosWorkoutQueueItem.FITFileURI]), event, corosMetaData);
          break;
        case ServiceNames.SuuntoApp:
          const suuntoWorkoutQueueItem = queueItem as SuuntoAppWorkoutQueueItemInterface;
          const suuntoMetaData = new SuuntoAppEventMetaData(suuntoWorkoutQueueItem.workoutID, suuntoWorkoutQueueItem.userName, new Date());
          await setEvent(parentID, generateIDFromParts([suuntoWorkoutQueueItem.userName, suuntoWorkoutQueueItem.workoutID]), event, suuntoMetaData);
      }
      console.timeEnd('InsertEvent');
      console.log(`Created Event ${event.getID()} for ${queueItem.id} user id ${parentID} and token user ${serviceToken.openId || serviceToken.userName}`);
      processedCount++;
      console.log(`Parsed ${processedCount}/${tokenQuerySnapshots.size} for ${queueItem.id}`);
    } catch (e: any) {
      // @todo should delete event  or separate catch
      console.error(e);
      console.error(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.openId || serviceToken.userName} to ${queueItem.retryCount + 1} due to ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, serviceName, e);
      continue;
    }
  }

  if (processedCount !== tokenQuerySnapshots.size) {
    console.error(new Error(`Could not process all tokens for ${queueItem.id} will try again later. Processed ${processedCount}`));
    return;
  }

  // For each ended so we can set it to processed
  return updateToProcessed(queueItem, serviceName);
}

async function addToWorkoutQueue(queueItem: SuuntoAppWorkoutQueueItemInterface | GarminHealthAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface, serviceName: ServiceNames): Promise<admin.firestore.DocumentReference> {
  const queueItemDocument = admin.firestore().collection(getServiceWorkoutQueueName(serviceName)).doc(queueItem.id);
  await queueItemDocument.set(queueItem);
  return queueItemDocument;
}
