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
import {refreshTokenIfNeeded} from "./service-tokens";
import {ServiceTokenInterface} from "quantified-self-lib/lib/service-tokens/service-token.interface";


export const parseQueue = functions.region('europe-west2').runWith({timeoutSeconds: 360}).pubsub.schedule('every 30 minutes').onRun(async (context) => {
  console.log('This will be run every 3 minutes!');
  // Suunto app refresh tokens should be refreshed every 180days we target at 15 days before 165 days
  const querySnapshot = await admin.firestore().collection('suuntoAppWorkoutQueue').where('processed', '==', false).where("retryCount", "<=", 10).limit(100).get(); // Max 10 retries
  // Async foreach is ok here
  querySnapshot.forEach(async (queueItem) => {
    await processQueueItem(queueItem);
  });
});

export async function processQueueItem(queueItem: any) {

  console.log(`Processing queue item ${queueItem.id} and username ${queueItem.data().userName} at retry count ${queueItem.data().retryCount}`);
  // queueItem.data() is never undefined for query queueItem snapshots
  const tokens = await admin.firestore().collectionGroup('tokens').where("userName", "==", queueItem.data()['userName']).get();

  // If there is no token for the user skip @todo or retry in case the user reconnects?
  if (!tokens.size) {
    console.error(`No token found for queue item ${queueItem.id} and username ${queueItem.data().userName} increasing count just in case`);
    await increaseRetryCountForQueueItem(queueItem, new Error(`No tokens found`));
    return;
  }

  let processedCount = 0;
  for (const doc of tokens.docs) {
    const data = <ServiceTokenInterface>doc.data();
    const parent1 = doc.ref.parent;
    if (!parent1) {
      throw new Error(`No parent found for ${doc.id}`);
    }
    const parentID = parent1.parent!.id;
    // Check the token if needed
    await refreshTokenIfNeeded(doc, false);
    let result;
    try {
      result = await requestPromise.get({
        headers: {
          'Authorization': data.accessToken,
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
        },
        encoding: null,
        url: `https://cloudapi.suunto.com/v2/workout/exportFit/${queueItem.data()['workoutID']}`,
      });
      console.log(`Downloaded FIT file for ${queueItem.id} and token user ${data.userName}`)
    } catch (e) {
      console.error(e);
      console.error(`Could not get workout for ${queueItem.id} and token user ${data.userName}. Trying to refresh token and update retry count from ${queueItem.data().retryCount} to ${queueItem.data().retryCount + 1}`);
      try {
        await refreshTokenIfNeeded(doc); // This should delete the token and break this loop eventually
      } catch (e) {
        console.error(e);
        console.error(`Could not refresh token for ${queueItem.id} and token user ${data.userName}`)
      }
      await increaseRetryCountForQueueItem(queueItem, e);
      return; // Next
    }

    try {
      const event = await EventImporterFIT.getFromArrayBuffer(result);
      console.log(`Created Event from FIT file of ${queueItem.id} and token user ${data.userName}`);
      // Id for the event should be serviceName + workoutID
      event.setID(generateIDFromParts(['suuntoApp', queueItem.data()['workoutID']]));
      event.metaData = new MetaData(ServiceNames.SuuntoApp, queueItem.data()['workoutID'], queueItem.data()['userName'], new Date());
      await setEvent(parentID, event);
      console.log(`Created Event ${event.getID()} for ${queueItem.id} and token user ${data.userName}`);
      processedCount++;
      console.log(`Parsed ${processedCount}/${tokens.size} for ${queueItem.id}`);
      // await queueItem.ref.delete();
    } catch (e) {
      // @todo should delete event  or separate catch
      console.error(e);
      console.error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.data().retryCount} and token user ${data.userName} to ${queueItem.data().retryCount + 1}`);
      await increaseRetryCountForQueueItem(queueItem, e);
      return;
    }
  }

  // If not all tokens are processed log it and increase the retry count
  if (processedCount !== tokens.size) {
    console.error(`Could not process all tokens for ${queueItem.id} will try again later`);
    await increaseRetryCountForQueueItem(queueItem, new Error('Not all tokens could be processed'));
    return;
  }

  // For each ended so we can set it to processed
  await updateToProcessed(queueItem);

}

async function increaseRetryCountForQueueItem(queueItem: any, error: Error) {
  const errors = queueItem.data().errors || [];
  errors.push({
    error: JSON.stringify(error),
    retryCount: queueItem.data().retryCount,
    date: (new Date()).toJSON(),
  });
  try {
    await queueItem.ref.update({
      retryCount: queueItem.data().retryCount + 1,
      errors: errors,
    });
    console.error(`Updated retry count for ${queueItem.id} to ${queueItem.data().retryCount + 1}`);
  } catch (e) {
    console.error(e);
    console.error(`Could not update retry count on ${queueItem.id}`)
  }
}

async function updateToProcessed(queueItem: any) {
  try {
    await queueItem.ref.update({
      'processed': true,
      'processedAt': new Date(),
    });
    console.log(`Updated to processed  ${queueItem.id}`);
  } catch (e) {
    console.error(e);
    console.error(`Could not update processed state for ${queueItem.id}`)
  }
}

// @todo fix the ids
async function setEvent(userID: string, event: EventInterface) {
  const writePromises: Promise<any>[] = [];
  event.setID(event.getID() || admin.firestore().collection('users').doc(userID).collection('events').doc().id);
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
