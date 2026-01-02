import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { getUserIDFromFirebaseToken, isCorsAllowed, setAccessControlHeadersOnResponse, isProUser, PRO_REQUIRED_MESSAGE } from '../utils';
import { GarminHealthAPIAuth } from './auth/auth';
import * as requestPromise from '../request-helper';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';

const GARMIN_ACTIVITIES_BACKFILL_URI = 'https://healthapi.garmin.com/wellness-api/rest/backfill/activities';
const TIMEOUT_IN_SECONDS = 300;
const MEMORY = '256MB';

export const backfillHealthAPIActivities = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
}).https.onRequest(async (req, res) => {
  // Directly set the CORS header
  if (!isCorsAllowed(req) || (req.method !== 'OPTIONS' && req.method !== 'POST')) {
    logger.error('Not allowed');
    res.status(403);
    res.send('Unauthorized');
    return;
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

  if (!(await isProUser(userID))) {
    logger.warn(`Blocking history import for non-pro user ${userID}`);
    res.status(403).send(PRO_REQUIRED_MESSAGE);
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

  try {
    await processGarminBackfill(userID, startDate, endDate);
  } catch (e: any) {
    if (e.message.includes('History import cannot happen')) {
      res.status(403).send(e.message);
      return;
    }
    if (e.message.includes('Duplicate backfill detected')) {
      res.status(409).send(e.message);
      return;
    }
    logger.error(e);
    res.status(e.statusCode || 500).send(e.message);
    return;
  }

  res.status(200);
  res.send();
});

export async function processGarminBackfill(userID: string, startDate: Date, endDate: Date) {
  // First check last history import
  const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(userID).collection('meta').doc(ServiceNames.GarminHealthAPI).get();
  if (userServiceMetaDocumentSnapshot.exists) {
    const data = <UserServiceMetaInterface>userServiceMetaDocumentSnapshot.data();
    if (data.didLastHistoryImport) {
      const nextHistoryImportAvailableDate = new Date(data.didLastHistoryImport + (3 * 24 * 60 * 60 * 1000)); // 3 days
      if ((nextHistoryImportAvailableDate > new Date())) {
        logger.error(`User ${userID} tried todo history import for ${ServiceNames.GarminHealthAPI} while not allowed`);
        throw new Error(`History import cannot happen before ${nextHistoryImportAvailableDate}`);
      }
    }
  }

  const tokensDocumentSnapshotData = (await admin.firestore().collection('garminHealthAPITokens').doc(userID).get()).data();
  if (!tokensDocumentSnapshotData || !tokensDocumentSnapshotData.accessToken || !tokensDocumentSnapshotData.accessTokenSecret) {
    logger.error('No token found');
    throw new Error('Bad request: No token found');
  }

  const oAuth = GarminHealthAPIAuth();

  // We need to break down the requests to multiple of 90 days max. 7776000s
  // So if the date range the user sent is 179 days we need to send 2 request with the respective ranges
  const maxDeltaInMS = 7776000000;
  logger.info(`Starting backfill for Garmin User ID: ${tokensDocumentSnapshotData.userID}`);
  const batchCount = Math.ceil((+endDate - +startDate) / maxDeltaInMS);

  for (let i = 0; i < batchCount; i++) {
    const batchStartDate = new Date(startDate.getTime() + (i * maxDeltaInMS));
    const batchEndDate = batchStartDate.getTime() + (maxDeltaInMS) >= endDate.getTime() ?
      endDate :
      new Date(batchStartDate.getTime() + maxDeltaInMS);
    try {
      await requestPromise.get({
        headers: oAuth.toHeader(oAuth.authorize({
          url: `${GARMIN_ACTIVITIES_BACKFILL_URI}?summaryStartTimeInSeconds=${Math.floor(batchStartDate.getTime() / 1000)}&summaryEndTimeInSeconds=${Math.ceil(batchEndDate.getTime() / 1000)}`,
          method: 'GET',
        }, {
          key: tokensDocumentSnapshotData.accessToken,
          secret: tokensDocumentSnapshotData.accessTokenSecret,
        })),
        url: `${GARMIN_ACTIVITIES_BACKFILL_URI}?summaryStartTimeInSeconds=${Math.floor(batchStartDate.getTime() / 1000)}&summaryEndTimeInSeconds=${Math.ceil(batchEndDate.getTime() / 1000)}`,
      });
    } catch (e: any) {
      // Log the full error for debugging
      logger.error(`Error requesting Garmin backfill for range ${batchStartDate} - ${batchEndDate}:`, e);

      // Handle specific API errors
      if (e.statusCode === 409) {
        throw new Error('Duplicate backfill detected by Garmin for this time range. Please try a different range or contact support.');
      }

      if (e.statusCode === 500) {
        throw new Error(`Garmin API error (500) for dates ${batchStartDate} to ${batchEndDate}`);
      }

      // Re-throw if it wasn't a handled non-fatal error
      throw e;
    }
  }
  try {
    await admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('meta')
      .doc(ServiceNames.GarminHealthAPI).set({
        didLastHistoryImport: (new Date()).getTime(),
      });
  } catch (e: any) {
    logger.error(e);
    // noop all is sent to garmin
  }
}

