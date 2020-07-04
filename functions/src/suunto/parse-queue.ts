'use strict';

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as requestPromise from "request-promise-native";
import { generateIDFromParts, setEvent } from "../utils";
import { ServiceNames } from "@sports-alliance/sports-lib/lib/meta-data/meta-data.interface";
import { getTokenData } from "../service-tokens";
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { MetaData } from '@sports-alliance/sports-lib/lib/meta-data/meta-data';
import {
  increaseRetryCountForQueueItem,
  parseQueueItems,
  updateToProcessed
} from '../queue';
import { SuuntoAppWorkoutQueueItemInterface } from '../queue/queue-item.interface';

const TIMEOUT_IN_SECONDS = 540;
const MEMORY = "2GB";

export const parseSuuntoAppActivityQueue = functions.region('europe-west2').runWith({timeoutSeconds: TIMEOUT_IN_SECONDS, memory: MEMORY }).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(ServiceNames.SuuntoApp);
});

export async function processSuuntoAppActivityQueueItem(queueItem: SuuntoAppWorkoutQueueItemInterface) {

  console.log(`Processing queue item ${queueItem.id} and username ${queueItem.userName} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots;
  try {
    tokenQuerySnapshots = await admin.firestore().collectionGroup('tokens').where("userName", "==", queueItem.userName).get();
  }catch (e) {
    console.error(e)
    return increaseRetryCountForQueueItem(queueItem, ServiceNames.SuuntoApp, e);
  }

  // If there is no token for the user skip @todo or retry in case the user reconnects?
  if (!tokenQuerySnapshots.size) {
    console.error(`No token found for queue item ${queueItem.id} and username ${queueItem.userName} increasing count just in case`);
    return increaseRetryCountForQueueItem(queueItem, ServiceNames.SuuntoApp, new Error(`No tokens found`));
  }

  let processedCount = 0;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {

    let serviceToken;

    // So if 2 tokens exist for 1 queue item then it will
    // IF refresh fails it will go and try to import the for the next token
    // If import fails for the next token it will increase count (fail ) and try from start.
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot);
    }catch (e) {
      console.error(e);
      console.error(new Error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`));
      continue
    }

    const parent1 = tokenQueryDocumentSnapshot.ref.parent;
    if (!parent1) {
      throw new Error(`No parent found for ${tokenQueryDocumentSnapshot.id}`);
    }
    const parentID = parent1.parent!.id;

    console.log(`Found user id ${parentID} for queue item ${queueItem.id} and username ${queueItem.userName}`);

    let result;
    try {
      console.time('DownloadFit');
      result = await requestPromise.get({
        headers: {
          'Authorization': serviceToken.accessToken,
          'Ocp-Apim-Subscription-Key': functions.config().suuntoapp.subscription_key,
        },
        encoding: null,
        url: `https://cloudapi.suunto.com/v2/workout/exportFit/${queueItem.workoutID}`,
      });
      console.timeEnd('DownloadFit');
      console.log(`Downloaded FIT file for ${queueItem.id} and token user ${serviceToken.userName}`)
    } catch (e) {
      if (e.statusCode === 403){
        console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userName} due to 403, increasing retry by 20`))
        await increaseRetryCountForQueueItem(queueItem, ServiceNames.SuuntoApp, e, 20);
        continue;
      }
      if (e.statusCode === 500){
        console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userName} due to 500 increasing retry by 20`))
        await increaseRetryCountForQueueItem(queueItem, ServiceNames.SuuntoApp, e, 20);
        continue;
      }
      // @todo -> Update to max retry if 403 not found that happens quite often.
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userName}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.SuuntoApp, e);
      continue;
    }

    try {
      const event = await EventImporterFIT.getFromArrayBuffer(result);
      event.name = event.startDate.toJSON(); // @todo improve
      console.log(`Created Event from FIT file of ${queueItem.id} and token user ${serviceToken.userName} test`);
      // Id for the event should be serviceName + workoutID
      const metaData = new MetaData(ServiceNames.SuuntoApp, queueItem.workoutID, queueItem.userName, new Date());
      await setEvent(parentID, generateIDFromParts([queueItem.userName, queueItem.workoutID]), event, metaData);
      console.log(`Created Event ${event.getID()} for ${queueItem.id} user id ${parentID} and token user ${serviceToken.userName} test`);
      processedCount++;
      console.log(`Parsed ${processedCount}/${tokenQuerySnapshots.size} for ${queueItem.id}`);
      // await queueItem.ref.delete();
    } catch (e) {
      // @todo should delete event  or separate catch
      console.error(e);
      console.error(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.userName} to ${queueItem.retryCount + 1}`));
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.SuuntoApp, e);
      continue;
    }
  }

  if (processedCount !== tokenQuerySnapshots.size) {
    console.error(new Error(`Could not process all tokens for ${queueItem.id} will try again later. Processed ${processedCount}`));
    return;
  }

  // For each ended so we can set it to processed
  return updateToProcessed(queueItem, ServiceNames.SuuntoApp);

}
