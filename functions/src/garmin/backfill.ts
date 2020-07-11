import * as functions from 'firebase-functions';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse } from '../utils';
import { GarminHealthAPIAuth } from './auth/auth';
import * as requestPromise from 'request-promise-native';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib/lib/users/user.service.meta.interface';

const GARMIN_ACTIVITIES_BACKFILL_URI = 'https://healthapi.garmin.com/wellness-api/rest/backfill/activities'
const TIMEOUT_IN_SECONDS = 300;
const MEMORY = "256MB";

export const backfillHealthAPIActivities = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY
}).https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    console.error(`Not allowed`);
    res.status(403);
    res.send('Unauthorized');
    return
  }

  setAccessControlHeadersOnResponse(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200);
    res.send();
    return;
  }

  const userID = await getUserIDFromFirebaseToken(req);
  if (!userID) {
    res.status(403).send('Unauthorized');
    return;
  }

  const startDate = new Date(req.body.startDate);
  const endDate = new Date(req.body.endDate);

  if (!startDate || !endDate) {
    res.status(500).send('No start and/or end date');
    return;
  }

  if (startDate > endDate) {
    res.status(500).send('Start date if after the end date');
    return;
  }

  // First check last history import
  const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(userID).collection('meta').doc(ServiceNames.GarminHealthAPI).get();
  if (userServiceMetaDocumentSnapshot.exists) {
    const data = <UserServiceMetaInterface>userServiceMetaDocumentSnapshot.data();
    const nextHistoryImportAvailableDate = new Date(data.didLastHistoryImport + (14 * 24 * 60 * 60 * 1000));   // 14 days
    if ((nextHistoryImportAvailableDate > new Date())) {
      console.error(`User ${userID} tried todo history import for ${ServiceNames.GarminHealthAPI} while not allowed`);
      res.status(403);
      res.send(`History import cannot happen before ${nextHistoryImportAvailableDate}`);
      return
    }
  }

  const tokensDocumentSnapshotData = (await admin.firestore().collection('garminHealthAPITokens').doc(userID).get()).data();
  if (!tokensDocumentSnapshotData || !tokensDocumentSnapshotData.accessToken || !tokensDocumentSnapshotData.accessTokenSecret) {
    res.status(500).send('Bad request');
    console.error('No token found');
    return;
  }

  const oAuth = GarminHealthAPIAuth();

  // We need to break down the requests to multiple of 90 days max. 7776000s
  // So if the date range the user sent is 179 days we need to send 2 request with the respective ranges
  const maxDeltaInMS = 7776000000
  const batchCount = Math.ceil((+endDate - +startDate) / maxDeltaInMS);

  console.log(batchCount)

  let summaryStartTimeInSeconds = startDate.getTime() / 1000;
  let summaryEndTimeInSeconds;
  for (let i = 0; i < batchCount; i++) {
    summaryStartTimeInSeconds = summaryStartTimeInSeconds + (i * (maxDeltaInMS / 1000));
    summaryEndTimeInSeconds = summaryStartTimeInSeconds + ( maxDeltaInMS / 1000) > (endDate.getTime() / 1000)
      ? endDate.getTime() / 1000
      : summaryStartTimeInSeconds + (maxDeltaInMS / 1000)
    try {
      await requestPromise.get({
        headers: oAuth.toHeader(oAuth.authorize({
          url: `${GARMIN_ACTIVITIES_BACKFILL_URI}?summaryStartTimeInSeconds=${summaryStartTimeInSeconds}&summaryEndTimeInSeconds=${summaryEndTimeInSeconds}`,
          method: 'GET',
        }, {
          key: tokensDocumentSnapshotData.accessToken,
          secret: tokensDocumentSnapshotData.accessTokenSecret
        })),
        url: `${GARMIN_ACTIVITIES_BACKFILL_URI}?summaryStartTimeInSeconds=${summaryStartTimeInSeconds}&summaryEndTimeInSeconds=${summaryEndTimeInSeconds}`,
      });
    } catch (e) {
      // Only if there is an api error in terms
      if (e.statusCode === 500) {
        console.error(e);
        res.status(500).send(`Could not import history for dates ${new Date(summaryStartTimeInSeconds * 1000)} to ${new Date(summaryEndTimeInSeconds * 1000)} due to ${e.message}`);
        return;
      }
    }
  }
  try {
    await admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('meta')
      .doc(ServiceNames.GarminHealthAPI).set({
        didLastHistoryImport: (new Date()).getTime(),
      })
  } catch (e) {
    console.error(e);
    // noop all is sent to garmin
  }

  res.status(200);
  res.send();
});
