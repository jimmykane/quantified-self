'use strict';

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
  decodeManualRouteUpload,
  getManualRouteInputFormat,
  ManualRouteUploadRequest,
  parseManualRouteUpload,
} from '../routes/manual-route-upload';
import { ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import {
  GarminRouteSendPermissionRequiredError,
  GarminRouteValidationError,
  uploadManualRouteToGarminConnect,
} from './routes';
import { ServiceNames } from '@sports-alliance/sports-lib';

function getStatusCode(error: unknown): number | null {
  const directStatusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof directStatusCode === 'number') {
    return directStatusCode;
  }

  const responseStatusCode = (error as { response?: { statusCode?: unknown } } | null)?.response?.statusCode;
  return typeof responseStatusCode === 'number' ? responseStatusCode : null;
}

async function assertGarminManualRouteUploadAllowed(userID: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, 'garmin_manual_route_upload', error);
  }
  if (deletionGuard.shouldSkip) {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  if (await isServiceDisconnectPendingForUser(userID, ServiceNames.GarminAPI)) {
    throw new HttpsError('failed-precondition', 'Garmin disconnect is pending.');
  }
}

/** Sends a selected GPX or FIT route to Garmin Connect as a Course Import. */
export const importRouteToGarminAPI = onCall({
  region: FUNCTIONS_MANIFEST.importRouteToGarminAPI.region,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }
  enforceAppCheck(request);

  const userID = request.auth.uid;
  if (!(await hasProAccess(userID))) {
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  try {
    await assertGarminManualRouteUploadAllowed(userID);
    const payload = request.data as ManualRouteUploadRequest;
    const inputFormat = getManualRouteInputFormat(payload?.filename, 'Garmin');
    const routeFile = await parseManualRouteUpload(decodeManualRouteUpload(payload?.file), inputFormat);
    const result = await uploadManualRouteToGarminConnect(userID, routeFile, {
      beforeProviderRequest: () => assertGarminManualRouteUploadAllowed(userID),
    });
    return { status: 'success' as const, providerRouteId: result.providerRouteId };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (error instanceof GarminRouteSendPermissionRequiredError) {
      throw new HttpsError('failed-precondition', error.message);
    }
    if (error instanceof GarminRouteValidationError) {
      throw new HttpsError('invalid-argument', error.message);
    }
    if (error instanceof UserDeletionGuardReadError || (error instanceof Error && error.name === 'UserDeletionGuardReadError')) {
      logger.error('[importRouteToGarminAPI] Could not verify account deletion state', { userID, error });
      throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
    }

    const statusCode = getStatusCode(error);
    logger.warn('[importRouteToGarminAPI] Route upload failed', {
      userID,
      statusCode,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    if (statusCode === 401) {
      throw new HttpsError('unauthenticated', 'Reconnect Garmin before sending routes.');
    }
    if (statusCode === 429) {
      throw new HttpsError('resource-exhausted', 'Garmin is rate-limiting course uploads. Please retry shortly.');
    }
    if (statusCode !== null && statusCode >= 500) {
      throw new HttpsError('unavailable', 'Garmin is temporarily unavailable. Please retry.');
    }
    if (statusCode !== null) {
      throw new HttpsError('failed-precondition', 'Garmin rejected the route upload.');
    }
    throw new HttpsError('unavailable', 'Could not send route to Garmin. Please retry.');
  }
});
