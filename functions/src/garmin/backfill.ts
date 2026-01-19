import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { isProUser, PRO_REQUIRED_MESSAGE } from '../utils';

import * as requestPromise from '../request-helper';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS } from '../shared/history-import.constants';
import { getTokenData } from '../tokens';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './constants';
import { GarminAPIAuth2ServiceTokenInterface } from './auth/adapter';

const GARMIN_ACTIVITIES_BACKFILL_URI = 'https://apis.garmin.com/wellness-api/rest/backfill/activities';
const TIMEOUT_IN_SECONDS = 300;
const MEMORY = '256MB';

interface BackfillRequest {
  startDate: string; // ISO Dates
  endDate: string;
}

export const backfillGarminAPIActivities = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
}).https.onCall(async (data: BackfillRequest, context) => {
  // 1. App Check Verification
  if (context.app == undefined) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The function must be called from an App Check verified app.'
    );
  }

  // 2. Auth Verification
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const userID = context.auth.uid;

  if (!(await isProUser(userID))) {
    logger.warn(`Blocking history import for non-pro user ${userID}`);
    throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const startDate = new Date(data.startDate);
  const endDate = new Date(data.endDate);

  if (!startDate || !endDate) {
    throw new functions.https.HttpsError('invalid-argument', 'No start and/or end date');
  }

  if (startDate > endDate) {
    throw new functions.https.HttpsError('invalid-argument', 'Start date if after the end date');
  }

  try {
    await processGarminBackfill(userID, startDate, endDate);
  } catch (e: any) {
    if (e.message.includes('History import cannot happen')) {
      throw new functions.https.HttpsError('permission-denied', e.message);
    }
    if (e.message.includes('Duplicate backfill detected')) {
      throw new functions.https.HttpsError('already-exists', e.message);
    }
    logger.error('Error backfilling Garmin:', e);
    throw new functions.https.HttpsError('internal', e.message);
  }
});

export async function processGarminBackfill(userID: string, startDate: Date, endDate: Date) {
  // First check last history import
  const userServiceMetaDocumentSnapshot = await admin.firestore().collection('users').doc(userID).collection('meta').doc(ServiceNames.GarminAPI).get();
  if (userServiceMetaDocumentSnapshot.exists) {
    const data = <UserServiceMetaInterface>userServiceMetaDocumentSnapshot.data();
    if (data.didLastHistoryImport) {
      const nextHistoryImportAvailableDate = new Date(data.didLastHistoryImport + (GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)); // 3 days
      if ((nextHistoryImportAvailableDate > new Date())) {
        logger.error(`User ${userID} tried todo history import for ${ServiceNames.GarminAPI} while not allowed`);
        throw new Error(`History import cannot happen before ${nextHistoryImportAvailableDate}`);
      }
    }
  }

  const tokensQuerySnapshot = await admin.firestore().collection(GARMIN_API_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').limit(1).get();
  if (tokensQuerySnapshot.empty) {
    logger.error(`No token found for user ${userID}`);
    throw new Error('Bad request: No token found');
  }
  const tokenDoc = tokensQuerySnapshot.docs[0];

  // Use getTokenData for auto-refresh if expired
  let serviceToken;
  try {
    serviceToken = await getTokenData(tokenDoc, ServiceNames.GarminAPI);
  } catch (e: any) {
    logger.error(`Failed to get/refresh Garmin token for ${userID}: ${e.message}`);
    throw new Error('Token refresh failed');
  }

  // Check for required permissions
  const garminToken = serviceToken as GarminAPIAuth2ServiceTokenInterface;
  if (!garminToken.permissions ||
    !garminToken.permissions.includes('HISTORICAL_DATA_EXPORT') ||
    !garminToken.permissions.includes('ACTIVITY_EXPORT')) {
    logger.error(`User ${userID} missing required permissions for backfill`, { permissions: garminToken.permissions });
    throw new Error('Missing required Garmin permissions (Historical Data Export, Activity Export). Please reconnect your Garmin account and ensure all permissions are granted.');
  }

  // Garmin API limits backfill requests to 90 days (7776000 seconds) maximum per request.
  // We break down larger ranges into multiple batches.
  // Use slightly under 90 days (89 days) to ensure we never exceed the limit due to rounding.
  const maxDeltaInMS = 89 * 24 * 60 * 60 * 1000; // 89 days in milliseconds
  logger.info(`Starting backfill for Garmin User ID: ${(serviceToken as any).userID}`);
  const batchCount = Math.ceil((+endDate - +startDate) / maxDeltaInMS);

  for (let i = 0; i < batchCount; i++) {
    const batchStartDate = new Date(startDate.getTime() + (i * maxDeltaInMS));
    const batchEndDate = batchStartDate.getTime() + (maxDeltaInMS) >= endDate.getTime() ?
      endDate :
      new Date(batchStartDate.getTime() + maxDeltaInMS);
    try {
      await requestPromise.get({
        headers: {
          'Authorization': `Bearer ${serviceToken.accessToken}`,
        },
        url: `${GARMIN_ACTIVITIES_BACKFILL_URI}?summaryStartTimeInSeconds=${Math.floor(batchStartDate.getTime() / 1000)}&summaryEndTimeInSeconds=${Math.floor(batchEndDate.getTime() / 1000)}`,
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
      .doc(ServiceNames.GarminAPI).set({
        didLastHistoryImport: (new Date()).getTime(),
      });
  } catch (e: any) {
    logger.error(e);
    // noop all is sent to garmin
  }
}

