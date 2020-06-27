import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  addToQueueForGarmin,
  increaseRetryCountForQueueItem,
  MEMORY,
  parseQueueItems,
  TIMEOUT_IN_SECONDS,
  updateToProcessed
} from '../queue';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { MetaData } from '@sports-alliance/sports-lib/lib/meta-data/meta-data';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/meta-data.interface';
import { generateIDFromParts, setEvent } from '../utils';
import { GarminHealthAPIAuth } from './auth/auth';
import * as requestPromise from 'request-promise-native';
import {
  GarminHealthAPIActivityQueueItemInterface,
} from '../queue/queue-item.interface';

const GARMIN_ACTIVITY_URI = 'https://healthapi.garmin.com/wellness-api/rest/activityFile'

export const insertToQueueForGarmin = functions.region('europe-west2').https.onRequest(async (req, res) => {
  const activityFiles: GarminHealthAPIActivityFileInterface[] = req.body.activityFiles
  const queueItemRefs:admin.firestore.DocumentReference[] = [];
  for (const activityFile of activityFiles){
    console.log(activityFile.userId)
    console.log(activityFile.userAccessToken)
    console.log(activityFile.callbackURL)
    console.log((new URLSearchParams(activityFile.callbackURL.split('?')[1])).get('activityFile'));
    let queueItemDocumentReference
    try{
      const activityFileID = new URLSearchParams(activityFile.callbackURL.split('?')[1]).get('id');
      if (!activityFileID){
        res.status(500).send();
        return;
      }
      queueItemDocumentReference = await addToQueueForGarmin(
        {
          userID: activityFile.userId,
          activityFileID: activityFileID,
          activityFileType: activityFile.fileType,
      });
      queueItemRefs.push(queueItemDocumentReference);
    }catch (e) {
      console.log(e);
      res.status(500).send();
      return
    }
  }

  res.status(200).send();

  for (const queueItemRef of queueItemRefs){
    try{
      await processGarminHealthAPIActivityQueueItem(<GarminHealthAPIActivityQueueItemInterface>Object.assign({id: queueItemRef.id}, (await queueItemRef.get()).data()));
    }catch (e) {
      console.error(e);
    }
  }
});


export const parseGarminHealthAPIActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY
}).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(ServiceNames.GarminHealthAPI);
});

export async function processGarminHealthAPIActivityQueueItem(queueItem: GarminHealthAPIActivityQueueItemInterface) {

  console.log(`Processing queue item ${queueItem.id} and userID ${queueItem.userID} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  const tokenQuerySnapshots = await admin.firestore().collection('garminHealthAPITokens').where("userID", "==", queueItem['userID']).get();

  if (!tokenQuerySnapshots.size) {
    console.error(`No token found for queue item ${queueItem.id} and userID ${queueItem.userID} increasing count just in case`);
    return increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, new Error(`No tokens found`));
  }


  let serviceToken;
  serviceToken = tokenQuerySnapshots.docs[0].data();

  // @todo should here import the garmin auth and pass the token

  const oAuth = GarminHealthAPIAuth();


  let result;
  try {
    console.time('DownloadFit');
    result = await requestPromise.get({
      headers: oAuth.toHeader(oAuth.authorize({
          url: `${GARMIN_ACTIVITY_URI}?id=${queueItem.activityFileID}`,
          method: 'get',
        },
        {
          key: serviceToken.accessToken,
          secret: serviceToken.accessTokenSecret
        })),
      encoding: null,
      url: `${GARMIN_ACTIVITY_URI}?id=${queueItem.activityFileID}`,
    });
    console.timeEnd('DownloadFit');
    console.log(`Downloaded FIT file for ${queueItem.id} and token user ${serviceToken.userID}`)
  } catch (e) {
    if (e.statusCode === 400) {
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 403, increasing retry by 20`))
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, e, 20);
    }
    if (e.statusCode === 500) {
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 500 increasing retry by 20`))
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, e, 20);
    }
    console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}`));
    await increaseRetryCountForQueueItem(queueItem,ServiceNames.GarminHealthAPI, e);
  }

  if (!result) {
    return false;
  }

  try {
    const event = await EventImporterFIT.getFromArrayBuffer(result);
    event.name = event.startDate.toJSON(); // @todo improve
    console.log(`Created Event from FIT file of ${queueItem.id} and token user ${serviceToken.userID} test`);
    // Id for the event should be serviceName + activityID
    const metaData = new MetaData(ServiceNames.GarminHealthAPI, queueItem.activityFileID, queueItem['userID'], new Date());
    await setEvent(tokenQuerySnapshots.docs[0].id, generateIDFromParts([ServiceNames.GarminHealthAPI, queueItem.activityFileID]), event, metaData);
    console.log(`Created Event ${event.getID()} for ${queueItem.id} user id ${tokenQuerySnapshots.docs[0].id} and token user ${serviceToken.userID} test`);
    // For each ended so we can set it to processed
    return updateToProcessed(queueItem, ServiceNames.GarminHealthAPI);
  } catch (e) {
    // @todo should delete meta etc
    console.error(e);
    console.error(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.userID} to ${queueItem.retryCount + 1}`));
    await increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, e);
  }
}


export interface GarminHealthAPIActivityFileInterface {
  userId: string,
  userAccessToken: string,
  fileType: 'FIT' | 'TCX' | 'GPX',
  callbackURL: string,
  startTimeInSeconds: number,
  manual: boolean,
}
