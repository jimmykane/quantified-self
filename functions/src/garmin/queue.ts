import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {
  addToQueueForGarmin,
  increaseRetryCountForQueueItem,
  parseQueueItems,
  updateToProcessed,
} from '../queue';
import { EventImporterFIT } from '@sports-alliance/sports-lib/lib/events/adapters/importers/fit/importer.fit';
import { generateIDFromParts, setEvent } from '../utils';
import { GarminHealthAPIAuth } from './auth/auth';
import * as requestPromise from '../request-helper';
import {
  GarminHealthAPIActivityQueueItemInterface,
} from '../queue/queue-item.interface';
import { EventImporterGPX } from '@sports-alliance/sports-lib/lib/events/adapters/importers/gpx/importer.gpx';
import { EventImporterTCX } from '@sports-alliance/sports-lib/lib/events/adapters/importers/tcx/importer.tcx';
import * as xmldom from 'xmldom';
import {
  GarminHealthAPIEventMetaData,
} from '@sports-alliance/sports-lib/lib/meta-data/meta-data';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';


const GARMIN_ACTIVITY_URI = 'https://apis.garmin.com/wellness-api/rest/activityFile';
const TIMEOUT_IN_SECONDS = 540;
const MEMORY = '4GB';

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
    } catch (e: any) {
      console.error(e);
      res.status(500).send();
      return;
    }
  }
  console.log(`Inserted to queue ${queueItemRefs.length}`);
  res.status(200).send();
});


export const parseGarminHealthAPIActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
  maxInstances: 1,
}).pubsub.schedule('every 20 minutes').onRun(async (context) => {
  await parseQueueItems(ServiceNames.GarminHealthAPI);
});

export async function processGarminHealthAPIActivityQueueItem(queueItem: GarminHealthAPIActivityQueueItemInterface) {
  console.log(`Processing queue item ${queueItem.id} and userID ${queueItem.userID} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  const tokenQuerySnapshots = await admin.firestore().collection('garminHealthAPITokens').where('userID', '==', queueItem['userID']).get();

  if (!tokenQuerySnapshots.size) {
    console.error(`No token found for queue item ${queueItem.id} and userID ${queueItem.userID} increasing count just in case`);
    return increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, new Error('No tokens found'), 20);
  }

  let serviceToken;
  serviceToken = tokenQuerySnapshots.docs[0].data();

  const oAuth = GarminHealthAPIAuth();

  let result;
  const url = `${GARMIN_ACTIVITY_URI}?id=${queueItem.activityFileID}&token=${queueItem.token}`;
  try {
    console.time('DownloadFile');
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
    console.timeEnd('DownloadFile');
    console.log(`Downloaded ${queueItem.activityFileType} for ${queueItem.id} and token user ${serviceToken.userID}`);
  } catch (e: any) {
    if (e.statusCode === 400) {
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 403, increasing retry by 20 URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, e, 20);
    } else if (e.statusCode === 500) {
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID} due to 500 increasing retry by 20 URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, e, 20);
    } else {
      console.error(new Error(`Could not get workout for ${queueItem.id} and token user ${serviceToken.userID}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}  URL: ${url}`));
      await increaseRetryCountForQueueItem(queueItem, ServiceNames.GarminHealthAPI, e);
    }
    console.timeEnd('DownloadFile');
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
        } catch (e: any) {
          console.error('Could not decode as GPX trying as FIT');
        }
        if (!event) {
          // Let it fail in any case
          // @todo extract or encode somehow
          // I hate this
          console.time('DownloadFile');
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
          console.timeEnd('DownloadFile');
          console.log(`Downloaded ${queueItem.activityFileType} for ${queueItem.id} and token user ${serviceToken.userID}`);
          event = await EventImporterFIT.getFromArrayBuffer(result); // Let it fail here
        }
        break;
      case 'TCX':
        event = await EventImporterTCX.getFromXML(new xmldom.DOMParser().parseFromString(result, 'application/xml'));
        break;
    }
    event.name = event.startDate.toJSON(); // @todo improve
    console.log(`Created Event from FIT file of ${queueItem.id} and token user ${serviceToken.userID}`);
    const metaData = new GarminHealthAPIEventMetaData(
      queueItem.userID,
      queueItem.activityFileID,
      queueItem.activityFileType,
      queueItem.manual || false,
      queueItem.startTimeInSeconds || 0, // 0 is ok here I suppose
      new Date());
    await setEvent(tokenQuerySnapshots.docs[0].id, generateIDFromParts([queueItem.userID, queueItem.startTimeInSeconds.toString()]), event, metaData);
    console.log(`Created Event ${event.getID()} for ${queueItem.id} user id ${tokenQuerySnapshots.docs[0].id} and token user ${serviceToken.userID}`);
    // For each ended so we can set it to processed
    return updateToProcessed(queueItem, ServiceNames.GarminHealthAPI);
  } catch (e: any) {
    // @todo should delete meta etc
    console.error(e);
    console.log(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.userID} to ${queueItem.retryCount + 1} due to ${e.message}`));
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
  token: string,
}
