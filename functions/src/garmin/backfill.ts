import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';

import * as requestPromise from '../request-helper';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import {
  GARMIN_HISTORY_IMPORT_COOLDOWN_DAYS,
  GARMIN_HISTORY_IMPORT_LIMIT_YEARS,
} from '../../../shared/history-import.constants';
import { getTokenData } from '../tokens';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './constants';
import { GarminAPIAuth2ServiceTokenInterface } from './auth/adapter';

const GARMIN_ACTIVITIES_BACKFILL_URI = 'https://apis.garmin.com/wellness-api/rest/backfill/activities';
const TIMEOUT_IN_SECONDS = 300;
const MEMORY = '256MB';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface BackfillRequest {
  startDate: string; // ISO Dates
  endDate: string;
}

class GarminHistoryRangeUnavailableError extends Error {
  constructor(providerMessage?: string) {
    const minimumDate = getGarminProviderMinimumStartDate(providerMessage);
    const minimumDateLabel = minimumDate
      ? minimumDate.toISOString().slice(0, 10)
      : null;
    super(minimumDateLabel
      ? `Garmin does not provide activity history before ${minimumDateLabel}. Choose a later start date.`
      : 'Garmin does not provide activity history for this range. Choose a later start date.');
    this.name = 'GarminHistoryRangeUnavailableError';
  }
}

function getGarminHistoryMinimumStartDate(now = new Date()): Date {
  const minimum = new Date(Date.UTC(
    now.getUTCFullYear() - GARMIN_HISTORY_IMPORT_LIMIT_YEARS,
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  return minimum;
}

function getGarminProviderMinimumStartDate(providerMessage?: string | null): Date | null {
  const minimumMatch = providerMessage?.match(/min start time of\s+['"]?([^\s'"]+)/i);
  if (!minimumMatch) {
    return null;
  }
  const minimumDate = new Date(minimumMatch[1].replace(/[,.]+$/, ''));
  return Number.isFinite(minimumDate.getTime()) ? minimumDate : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function getNestedValue(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => asRecord(current)?.[key], value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const message = asRecord(error)?.message;
  return typeof message === 'string' ? message : String(error);
}

function getErrorStatusCode(error: unknown): number | undefined {
  const statusCode = asRecord(error)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function getGarminProviderErrorMessage(error: unknown): string | null {
  const paths = [
    ['error', 'errorMessage'],
    ['error', 'error', 'errorMessage'],
    ['response', 'body', 'errorMessage'],
    ['response', 'body', 'error', 'errorMessage'],
  ];
  for (const path of paths) {
    const message = getNestedValue(error, path);
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
  }
  return null;
}

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

export const backfillGarminAPIActivities = functions.region(FUNCTIONS_MANIFEST.backfillGarminAPIActivities.region).runWith({
  timeoutSeconds: TIMEOUT_IN_SECONDS,
  memory: MEMORY,
  secrets: FUNCTION_SECRET_BINDINGS.backfillGarminAPIActivities,
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

  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking history import for non-pro user ${userID}`);
    throw new functions.https.HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const startDate = new Date(data?.startDate);
  const endDate = new Date(data?.endDate);

  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    throw new functions.https.HttpsError('invalid-argument', 'No start and/or end date');
  }

  if (startDate > endDate) {
    throw new functions.https.HttpsError('invalid-argument', 'Start date if after the end date');
  }

  // The UI submits today's local end-of-day, which can be ahead of UTC now.
  // One day covers all time zones without allowing unbounded future batching.
  if (endDate.getTime() > Date.now() + DAY_IN_MS) {
    throw new functions.https.HttpsError('invalid-argument', 'End date must be today or earlier');
  }

  const minimumStartDate = getGarminHistoryMinimumStartDate();
  // The browser submits local midnight as UTC. Allow one day at the boundary so
  // valid users east of UTC are not rejected before Garmin applies its exact cutoff.
  const validationMinimumStartMs = minimumStartDate.getTime() - DAY_IN_MS;
  if (startDate.getTime() < validationMinimumStartMs) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Garmin activity history is limited to the latest ${GARMIN_HISTORY_IMPORT_LIMIT_YEARS} years. Choose a start date on or after ${minimumStartDate.toISOString().slice(0, 10)}.`,
    );
  }

  try {
    await processGarminBackfill(userID, startDate, endDate);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes('History import cannot happen')) {
      throw new functions.https.HttpsError('permission-denied', errorMessage);
    }
    if (errorMessage.includes('Duplicate backfill detected')) {
      throw new functions.https.HttpsError('already-exists', errorMessage);
    }
    if (error instanceof GarminHistoryRangeUnavailableError) {
      throw new functions.https.HttpsError('invalid-argument', error.message);
    }
    logger.error('Error backfilling Garmin:', error);
    throw new functions.https.HttpsError('internal', errorMessage);
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
        logger.error(`User ${userID} tried todo history import for ${ServiceNames.GarminAPI} while not allowed. (Requested: ${startDate.toISOString()} - ${endDate.toISOString()}, Available on: ${nextHistoryImportAvailableDate.toISOString()})`);
        throw new Error(`History import cannot happen before ${nextHistoryImportAvailableDate.toISOString()}`);
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
  let garminToken: GarminAPIAuth2ServiceTokenInterface;
  try {
    garminToken = await getTokenData(tokenDoc, ServiceNames.GarminAPI) as GarminAPIAuth2ServiceTokenInterface;
  } catch (error: unknown) {
    logger.error(`Failed to get/refresh Garmin token for ${userID}: ${getErrorMessage(error)}`);
    throw new Error('Token refresh failed');
  }

  // Check for required permissions
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
  logger.info(`Starting backfill for Garmin User ID: ${garminToken.userID}`);
  const batchCount = Math.max(1, Math.ceil((+endDate - +startDate) / maxDeltaInMS));
  let acceptedBatchCount = 0;
  let firstAcceptedStartMs: number | null = null;
  let lastAcceptedEndMs: number | null = null;
  let unavailableRangeMessage: string | null = null;
  let providerMinimumStartDate: Date | null = null;

  for (let i = 0; i < batchCount; i++) {
    const batchStartDate = new Date(startDate.getTime() + (i * maxDeltaInMS));
    const batchEndDate = batchStartDate.getTime() + (maxDeltaInMS) >= endDate.getTime() ?
      endDate :
      new Date(batchStartDate.getTime() + maxDeltaInMS);
    if (providerMinimumStartDate && providerMinimumStartDate >= batchEndDate) {
      continue;
    }
    let requestedBatchStartDate = providerMinimumStartDate && providerMinimumStartDate > batchStartDate
      ? providerMinimumStartDate
      : batchStartDate;

    while (true) {
      try {
        await requestPromise.get({
          headers: {
            'Authorization': `Bearer ${garminToken.accessToken}`,
          },
          url: `${GARMIN_ACTIVITIES_BACKFILL_URI}?summaryStartTimeInSeconds=${Math.floor(requestedBatchStartDate.getTime() / 1000)}&summaryEndTimeInSeconds=${Math.floor(batchEndDate.getTime() / 1000)}`,
        });
        acceptedBatchCount += 1;
        firstAcceptedStartMs ??= requestedBatchStartDate.getTime();
        lastAcceptedEndMs = batchEndDate.getTime();
        break;
      } catch (error: unknown) {
        const statusCode = getErrorStatusCode(error);
        if (statusCode === 409) {
          throw new Error('Duplicate backfill detected by Garmin for this time range. Please try a different range or contact support.');
        }

        const providerErrorMessage = getGarminProviderErrorMessage(error);
        if (statusCode === 400 && providerErrorMessage?.toLowerCase().includes('before min start time')) {
          unavailableRangeMessage = providerErrorMessage;
          const parsedProviderMinimumStartDate = getGarminProviderMinimumStartDate(providerErrorMessage);
          const adjustedBatchStartDate = parsedProviderMinimumStartDate
            ? new Date(Math.ceil(parsedProviderMinimumStartDate.getTime() / 1000) * 1000)
            : null;
          if (adjustedBatchStartDate) {
            providerMinimumStartDate = adjustedBatchStartDate;
          }
          if (adjustedBatchStartDate
            && adjustedBatchStartDate > requestedBatchStartDate
            && adjustedBatchStartDate < batchEndDate) {
            logger.warn(`Garmin backfill batch start adjusted to provider minimum: ${providerErrorMessage}`);
            requestedBatchStartDate = adjustedBatchStartDate;
            continue;
          }
          logger.warn(`Garmin backfill batch skipped: ${providerErrorMessage}`);
          break;
        }

        logger.error(`Error requesting Garmin backfill for range ${requestedBatchStartDate} - ${batchEndDate}:`, error);

        if (statusCode === 500) {
          throw new Error(`Garmin API error (500) for dates ${requestedBatchStartDate} to ${batchEndDate}`);
        }

        throw error;
      }
    }
  }

  if (acceptedBatchCount === 0) {
    throw new GarminHistoryRangeUnavailableError(unavailableRangeMessage || undefined);
  }

  try {
    await admin.firestore()
      .collection('users')
      .doc(userID)
      .collection('meta')
      .doc(ServiceNames.GarminAPI).set({
        didLastHistoryImport: (new Date()).getTime(),
        lastHistoryImportStartDate: firstAcceptedStartMs,
        lastHistoryImportEndDate: lastAcceptedEndMs,
      }, { merge: true });
  } catch (error: unknown) {
    logger.error(error);
    // noop all is sent to garmin
  }
}
