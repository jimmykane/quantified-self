import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
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

export const insertToQueueForGarmin = functions.region('europe-west2').https.onRequest(async (req, res) => {
  const userName = req.query.username ||  req.body.username;
  const workoutID = req.query.workoutid ||  req.body.workoutid;

  console.log(`Inserting to queue or processing ${workoutID} for ${userName}`);

  try {
    // Important -> keep the key based on username and workoutid to get updates on activity I suppose ....
    // @todo ask about this
    // const queueItemDocumentReference = await addToQueue(userName, workoutID);
    // await processQueueItem(await queueItemDocumentReference.get());
  }catch (e) {
    console.log(e);
    res.status(500);
  }
  res.status(200).send();
});


export const parseGarminActivityQueue = functions.region('europe-west2').runWith({timeoutSeconds: TIMEOUT_IN_SECONDS, memory: MEMORY }).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(ServiceNames.GarminHealthAPI);
});

export async function processGarminHealthAPIActivityQueueItem(queueItem: any) {

  console.log(`Processing queue item ${queueItem.id} and userID ${queueItem.data().userID} at retry count ${queueItem.data().retryCount}`);
  // queueItem.data() is never undefined for query queueItem snapshots
  const tokenQuerySnapshots = await admin.firestore().collection('garminHealthAPITokens').where("userID", "==", queueItem.data()['userID']).get();

  if (!tokenQuerySnapshots.size) {
    console.error(`No token found for queue item ${queueItem.id} and userID ${queueItem.data().userID} increasing count just in case`);
    return increaseRetryCountForQueueItem(queueItem, new Error(`No tokens found`));
  }


    let serviceToken;

    // So if 2 tokens exist for 1 queue item then it will
    // IF refresh fails it will go and try to import the for the next token
    // If import fails for the next token it will increase count (fail ) and try from start.
    serviceToken = tokenQuerySnapshots.docs[0].data();

    // @todo should here import the garmin auth and pass the token 

    let result;
    try {
      console.time('DownloadFit');
      // result = await requestPromise.get({
      //   headers: {
      //     'Authorization': serviceToken.accessToken,
      //     'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
      //   },
      //   encoding: null,
      //   url: `https://cloudapi.suunto.com/v2/workout/exportFit/${queueItem.data()['workoutID']}`,
      // });
      console.timeEnd('DownloadFit');
      console.log(`Downloaded FIT file for ${queueItem.id} and token user ${serviceToken.userID}`)
    } catch (e) {
      if (e.statusCode === 403){
        console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 403, increasing retry by 20`))
        await increaseRetryCountForQueueItem(queueItem, e, 20);
      }
      if (e.statusCode === 500){
        console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 500 increasing retry by 20`))
        await increaseRetryCountForQueueItem(queueItem, e, 20);
      }
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID}. Trying to refresh token and update retry count from ${queueItem.data().retryCount} to ${queueItem.data().retryCount + 1} -> ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, e);
    }

    if (!result){
      return false;
    }

    try {
      const event = await EventImporterFIT.getFromArrayBuffer(result);
      event.name = event.startDate.toJSON(); // @todo improve
      console.log(`Created Event from FIT file of ${queueItem.id} and token user ${serviceToken.userID} test`);
      // Id for the event should be serviceName + workoutID
      const metaData = new MetaData(ServiceNames.SuuntoApp, queueItem.data()['workoutID'], queueItem.data()['userID'], new Date());
      // @todo move metadata to its own document for firestore read/write rules
      await setEvent(tokenQuerySnapshots.docs[0].id, generateIDFromParts(['suuntoApp', queueItem.data()['workoutID']]), event, metaData);
      console.log(`Created Event ${event.getID()} for ${queueItem.id} user id ${tokenQuerySnapshots.docs[0].id} and token user ${serviceToken.userID} test`);
      // For each ended so we can set it to processed
      return updateToProcessed(queueItem);
    } catch (e) {
      // @todo should delete event  or separate catch
      console.error(e);
      console.error(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.data().retryCount} and token user ${serviceToken.userID} to ${queueItem.data().retryCount + 1}`));
      await increaseRetryCountForQueueItem(queueItem, e);
    }
}
