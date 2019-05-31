'use strict';

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as requestPromise from "request-promise-native";
import {EventImporterFIT} from "quantified-self-lib/lib/events/adapters/importers/fit/importer.fit";
import {EventInterface} from "quantified-self-lib/lib/events/event.interface";
import * as Pako from "pako";
import {generateIDFromParts} from "./utils";
import {MetaData} from "quantified-self-lib/lib/meta-data/meta-data";
import {ServiceNames} from "quantified-self-lib/lib/meta-data/meta-data.interface";
import {getTokenData} from "./service-tokens";
import {QueueItemInterface} from "quantified-self-lib/lib/queue-item/queue-item.interface";


export const parseQueue = functions.region('europe-west2').runWith({timeoutSeconds: 240}).pubsub.schedule('every 5 minutes').onRun(async (context) => {
  // @todo add queue item sort date for creation
  const querySnapshot = await admin.firestore().collection('suuntoAppWorkoutQueue').where('processed', '==', false).where("retryCount", "<=", 10).limit(40).get(); // Max 10 retries
  console.log(`Found ${querySnapshot.size} queue items to process`);
  let count = 0;
  for (const queueItem of querySnapshot.docs) {
    try {
      await processQueueItem(queueItem);
      count++;
    } catch (e) {
      console.error(`Error parsing queue item #${count} of ${querySnapshot.size} and id ${queueItem.id}`, e)
    }
  }
  console.log(`Parsed ${count} queue items out of ${querySnapshot.size}`);
});

export async function processQueueItem(queueItem: any) {

  console.log(`Processing queue item ${queueItem.id} and username ${queueItem.data().userName} at retry count ${queueItem.data().retryCount}`);
  // queueItem.data() is never undefined for query queueItem snapshots
  const tokenQuerySnapshots = await admin.firestore().collectionGroup('tokens').where("userName", "==", queueItem.data()['userName']).get();

  // If there is no token for the user skip @todo or retry in case the user reconnects?
  if (!tokenQuerySnapshots.size) {
    console.error(`No token found for queue item ${queueItem.id} and username ${queueItem.data().userName} increasing count just in case`);
    return increaseRetryCountForQueueItem(queueItem, new Error(`No tokens found`));
  }

  let processedCount = 0;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {

    const serviceToken = await getTokenData(tokenQueryDocumentSnapshot);

    const parent1 = tokenQueryDocumentSnapshot.ref.parent;
    if (!parent1) {
      throw new Error(`No parent found for ${tokenQueryDocumentSnapshot.id}`);
    }
    const parentID = parent1.parent!.id;
    let result;
    try {
      result = await requestPromise.get({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
        },
        encoding: null,
        url: `https://cloudapi.suunto.com/v2/workout/exportFit/${queueItem.data()['workoutID']}`,
      });
      console.log(`Downloaded FIT file for ${queueItem.id} and token user ${serviceToken.userName}`)
    } catch (e) {
      console.error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userName}. Trying to refresh token and update retry count from ${queueItem.data().retryCount} to ${queueItem.data().retryCount + 1}`, e);
      await increaseRetryCountForQueueItem(queueItem, e);
      continue;
    }

    try {
      const event = await EventImporterFIT.getFromArrayBuffer(result);
      event.name = event.startDate.toJSON(); // @todo improve
      console.log(`Created Event from FIT file of ${queueItem.id} and token user ${serviceToken.userName}`);
      // Id for the event should be serviceName + workoutID
      event.metaData = new MetaData(ServiceNames.SuuntoApp, queueItem.data()['workoutID'], queueItem.data()['userName'], new Date());
      await setEvent(parentID, generateIDFromParts(['suuntoApp', queueItem.data()['workoutID']]), event);
      console.log(`Created Event ${event.getID()} for ${queueItem.id} and token user ${serviceToken.userName}`);
      processedCount++;
      console.log(`Parsed ${processedCount}/${tokenQuerySnapshots.size} for ${queueItem.id}`);
      // await queueItem.ref.delete();
    } catch (e) {
      // @todo should delete event  or separate catch
      console.error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.data().retryCount} and token user ${serviceToken.userName} to ${queueItem.data().retryCount + 1}`, e);
      await increaseRetryCountForQueueItem(queueItem, e);
      continue;
    }
  }

  // If not all tokens are processed log it and increase the retry count
  if (processedCount !== tokenQuerySnapshots.size) {
    console.error(`Could not process all tokens for ${queueItem.id} will try again later`);
    return increaseRetryCountForQueueItem(queueItem, new Error('Not all tokens could be processed'));
  }

  // For each ended so we can set it to processed
  return updateToProcessed(queueItem);

}

async function increaseRetryCountForQueueItem(queueItem: any, error: Error ) {
  const data: QueueItemInterface = queueItem.data();
  data.retryCount++;
  data.totalRetryCount = (data.totalRetryCount + 1) || 1;
  data.errors = data.errors || [];
  data.errors.push({
    error: error.message,
    atRetryCount: data.totalRetryCount,
    date: (new Date()).getTime(),
  });

  try {
    await queueItem.ref.update(JSON.parse(JSON.stringify(data)));
    console.info(`Updated retry count for ${queueItem.id} to ${data.retryCount + 1}`);
  } catch (e) {
    console.error(`Could not update retry count on ${queueItem.id}`, e)
  }
}

async function updateToProcessed(queueItem: any) {
  try {
    await queueItem.ref.update({
      'processed': true,
      'processedAt': (new Date()).getTime(),
    });
    console.log(`Updated to processed  ${queueItem.id}`);
  } catch (e) {
    console.error(e);
    console.error(`Could not update processed state for ${queueItem.id}`)
  }
}

async function setEvent(userID: string, eventID:string , event: EventInterface) {
  const writePromises: Promise<any>[] = [];
  event.setID(eventID);
  event.getActivities()
    .forEach((activity, index) => {
      activity.setID(generateIDFromParts([<string>event.getID(), index.toString()]));
      writePromises.push(
        admin.firestore().collection('users')
          .doc(userID)
          .collection('events')
          .doc(<string>event.getID())
          .collection('activities')
          .doc(<string>activity.getID())
          .set(activity.toJSON()));

      activity.getAllStreams().forEach((stream) => {
        // console.log(`Stream ${stream.type} has size of GZIP ${getSize(Buffer.from((Pako.gzip(JSON.stringify(stream.data), {to: 'string'})), 'binary'))}`);
        writePromises.push(
          admin.firestore()
            .collection('users')
            .doc(userID)
            .collection('events')
            .doc(<string>event.getID())
            .collection('activities')
            .doc(<string>activity.getID())
            .collection('streams')
            .doc(stream.type)
            .set({
              type: stream.type,
              data: Buffer.from((Pako.gzip(JSON.stringify(stream.data), {to: 'string'})), 'binary'),
            }))
      });
    });
  try {
    await Promise.all(writePromises);
    return admin.firestore().collection('users').doc(userID).collection('events').doc(<string>event.getID()).set(event.toJSON());
  } catch (e) {
    console.error(e);
    debugger;
    return
    // Try to delete the parent entity and all subdata
    // await this.deleteAllEventData(user, event.getID());
  }
}
