'use strict';

import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import * as zlib from 'zlib';
import { SERVICE_NAME, SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { toSuuntoAuthorizationHeader } from './authorization-header';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';


/**
 * Uploads a route to the Suunto app
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

export interface SuuntoRouteUploadTokenRef {
  id: string;
  ref: admin.firestore.DocumentReference;
  providerUserId: string;
}

export interface SuuntoRouteUploadContext {
  tokenRefs: SuuntoRouteUploadTokenRef[];
  userNames: string[];
}

export interface SuuntoRouteUploadResult {
  status: 'success';
  successCount: number;
  providerRouteIds: string[];
  deliveries: Array<{
    providerUserId: string;
    providerRouteId?: string | null;
  }>;
}

export interface SuuntoRouteSummary {
  providerUserId: string;
  id: string;
  description?: string | null;
  created?: number | null;
  modified?: number | null;
}

export class SuuntoRouteUploadSkippedForDeletedUserError extends Error {
  public readonly name = 'SuuntoRouteUploadSkippedForDeletedUserError';
  public readonly code = 'user_deleted_or_deleting';

  constructor(
    public readonly userID: string,
    public readonly phase: string,
  ) {
    super(`Skipping Suunto route upload for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  }
}

function isUserDeletionGuardReadError(error: unknown): boolean {
  return error instanceof UserDeletionGuardReadError
    || (error instanceof Error && error.name === 'UserDeletionGuardReadError');
}

async function assertSuuntoRouteUploadUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `suunto_route_upload:${phase}`, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn(`Skipping Suunto route upload for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  throw new SuuntoRouteUploadSkippedForDeletedUserError(userID, phase);
}

async function incrementUploadedRoutesCountIfUserActive(userID: string, incrementBy: number): Promise<boolean> {
  if (incrementBy <= 0) {
    return true;
  }

  const db = admin.firestore();
  const userServiceMetaDocumentSnapshot = db.collection('users').doc(userID).collection('meta').doc(SERVICE_NAME);

  return db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, 'suunto_route_upload_meta', error);
    }

    if (deletionGuard.shouldSkip) {
      logger.warn(`Skipping Suunto uploadedRoutesCount update because user ${userID} is missing or deletion is in progress.`);
      return false;
    }

    transaction.set(userServiceMetaDocumentSnapshot, {
      uploadedRoutesCount: FieldValue.increment(incrementBy),
    }, { merge: true });
    return true;
  });
}

function getSuuntoProviderRouteId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const value = (result as { id?: unknown; routeId?: unknown; routeID?: unknown }).id
    || (result as { routeId?: unknown }).routeId
    || (result as { routeID?: unknown }).routeID;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getStatusCode(error: unknown): number | undefined {
  const directStatusCode = (error as any)?.statusCode;
  if (typeof directStatusCode === 'number') {
    return directStatusCode;
  }

  const responseStatusCode = (error as any)?.response?.statusCode;
  return typeof responseStatusCode === 'number' ? responseStatusCode : undefined;
}

function getSuuntoErrorMessage(error: unknown): string | undefined {
  const errorPayload = (error as any)?.error;
  if (typeof errorPayload === 'string') {
    return errorPayload;
  }

  if (typeof errorPayload?.message === 'string') {
    return errorPayload.message;
  }

  if (typeof errorPayload?.error === 'string') {
    return errorPayload.error;
  }

  if (typeof errorPayload?.error_description === 'string') {
    return errorPayload.error_description;
  }

  return undefined;
}

function normalizeSuuntoProviderUserId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function createSuuntoRouteUploadContext(userID: string): Promise<SuuntoRouteUploadContext> {
  await assertSuuntoRouteUploadUserActive(userID, 'before_token_lookup');

  const tokenQuerySnapshots = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).doc(userID).collection('tokens').get();
  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  if (tokenQuerySnapshots.empty) {
    throw new HttpsError('unauthenticated', 'No connected Suunto account found');
  }

  const tokenRefs = tokenQuerySnapshots.docs
    .map((tokenSnapshot) => {
      const providerUserId = normalizeSuuntoProviderUserId(tokenSnapshot.data()?.userName);
      if (!providerUserId) {
        logger.warn('[SuuntoRoutes] Skipping token without provider user identity', {
          userID,
          tokenId: tokenSnapshot.id,
        });
        return null;
      }

      return {
        id: tokenSnapshot.id,
        ref: tokenSnapshot.ref,
        providerUserId,
      };
    })
    .filter((tokenRef): tokenRef is SuuntoRouteUploadTokenRef => tokenRef !== null);

  if (tokenRefs.length === 0) {
    throw new HttpsError('unauthenticated', 'No connected Suunto account found');
  }

  return {
    tokenRefs,
    userNames: Array.from(new Set(tokenRefs.map(tokenRef => tokenRef.providerUserId))),
  };
}

async function getLatestSuuntoTokenSnapshot(
  tokenRef: SuuntoRouteUploadTokenRef,
): Promise<admin.firestore.DocumentSnapshot> {
  const snapshot = await tokenRef.ref.get();
  if (!snapshot.exists) {
    throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
  }
  return snapshot;
}

function getSuuntoTokenRefsForReadOperation(
  context: SuuntoRouteUploadContext,
  providerUserId?: string | null,
): SuuntoRouteUploadTokenRef[] {
  const normalizedProviderUserId = normalizeSuuntoProviderUserId(providerUserId);
  if (!normalizedProviderUserId) {
    return context.tokenRefs;
  }

  const matchingTokenRefs = context.tokenRefs.filter(tokenRef => tokenRef.providerUserId === normalizedProviderUserId);
  return matchingTokenRefs.length > 0 ? matchingTokenRefs : context.tokenRefs;
}

function normalizeSuuntoRouteSummary(value: unknown): SuuntoRouteSummary | null {
  const providerUserId = normalizeSuuntoProviderUserId((value as { providerUserId?: unknown } | null)?.providerUserId);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const route = value as Record<string, unknown>;
  const id = typeof route.id === 'string' && route.id.trim() ? route.id.trim() : null;
  if (!id || !providerUserId) {
    return null;
  }

  return {
    providerUserId,
    id,
    description: typeof route.description === 'string' && route.description.trim() ? route.description.trim() : null,
    created: typeof route.created === 'number' && Number.isFinite(route.created) ? route.created : null,
    modified: typeof route.modified === 'number' && Number.isFinite(route.modified) ? route.modified : null,
  };
}

async function executeSuuntoRouteReadOperation<T>(
  userID: string,
  context: SuuntoRouteUploadContext,
  operationName: string,
  operation: (accessToken: string) => Promise<T>,
  providerUserId?: string | null,
): Promise<T> {
  let authFailures = 0;
  let lastError: unknown = null;

  for (const tokenRef of getSuuntoTokenRefsForReadOperation(context, providerUserId)) {
    try {
      const latestTokenSnapshot = await getLatestSuuntoTokenSnapshot(tokenRef);
      return await executeWithTokenRetry(
        latestTokenSnapshot,
        async (accessToken) => {
          await assertSuuntoRouteUploadUserActive(userID, `before_${operationName}`);
          return operation(accessToken);
        },
        `${operationName} for user ${userID}`,
      );
    } catch (error) {
      if (isUserDeletionGuardReadError(error) || error instanceof SuuntoRouteUploadSkippedForDeletedUserError) {
        throw error;
      }
      if (error instanceof HttpsError && error.code === 'unauthenticated') {
        authFailures++;
        lastError = error;
        continue;
      }
      if (getStatusCode(error) === 401) {
        authFailures++;
      }
      lastError = error;
      logger.warn(`[SuuntoRoutes] ${operationName} failed for token ${tokenRef.id}`, {
        userID,
        providerUserId: tokenRef.providerUserId,
        error,
      });
    }
  }

  if (authFailures > 0) {
    throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
  }

  throw lastError || new HttpsError('internal', 'Suunto route request failed.');
}

export async function listSuuntoRoutes(
  userID: string,
  context?: SuuntoRouteUploadContext,
): Promise<SuuntoRouteSummary[]> {
  const routeContext = context || await createSuuntoRouteUploadContext(userID);
  const routesByProviderKey = new Map<string, SuuntoRouteSummary>();
  let authFailures = 0;
  let lastError: unknown = null;

  for (const tokenRef of routeContext.tokenRefs) {
    try {
      const latestTokenSnapshot = await getLatestSuuntoTokenSnapshot(tokenRef);
      const result = await executeWithTokenRetry(
        latestTokenSnapshot,
        async (accessToken) => {
          await assertSuuntoRouteUploadUserActive(userID, 'before_list_suunto_routes');
          return requestPromise.get({
            headers: {
              'Authorization': toSuuntoAuthorizationHeader(accessToken),
              'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
            },
            json: true,
            url: 'https://cloudapi.suunto.com/v2/route',
          });
        },
        `list_suunto_routes for user ${userID}`,
      );

      if (!Array.isArray(result)) {
        logger.warn('[SuuntoRoutes] Route listing returned unexpected payload shape', {
          userID,
          providerUserId: tokenRef.providerUserId,
          payloadType: typeof result,
        });
        continue;
      }

      for (const route of result) {
        const normalizedRoute = normalizeSuuntoRouteSummary({
          ...route,
          providerUserId: tokenRef.providerUserId,
        });
        if (!normalizedRoute) {
          continue;
        }

        routesByProviderKey.set(
          `${normalizedRoute.providerUserId}:${normalizedRoute.id}`,
          normalizedRoute,
        );
      }
    } catch (error) {
      if (isUserDeletionGuardReadError(error) || error instanceof SuuntoRouteUploadSkippedForDeletedUserError) {
        throw error;
      }
      if (error instanceof HttpsError && error.code === 'unauthenticated') {
        authFailures++;
        lastError = error;
        continue;
      }
      if (getStatusCode(error) === 401) {
        authFailures++;
      }
      lastError = error;
      logger.warn('[SuuntoRoutes] list_suunto_routes failed for token', {
        userID,
        providerUserId: tokenRef.providerUserId,
        tokenId: tokenRef.id,
        error,
      });
    }
  }

  if (routesByProviderKey.size > 0) {
    return Array.from(routesByProviderKey.values());
  }

  if (authFailures > 0) {
    throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
  }

  throw lastError || new HttpsError('internal', 'Suunto route request failed.');
}

export async function exportSuuntoRouteAsGPX(
  userID: string,
  providerRouteId: string,
  options: {
    context?: SuuntoRouteUploadContext;
    providerUserId?: string | null;
  } = {},
): Promise<string> {
  const routeContext = options.context || await createSuuntoRouteUploadContext(userID);
  const result = await executeSuuntoRouteReadOperation(userID, routeContext, 'export_suunto_route', async (accessToken) => (
    requestPromise.get({
      headers: {
        'Accept': 'application/gpx+xml',
        'Authorization': toSuuntoAuthorizationHeader(accessToken),
        'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
      },
      url: `https://cloudapi.suunto.com/v2/route/${providerRouteId}/export`,
    })
  ), options.providerUserId);

  const gpxContent = typeof result === 'string' ? result : `${result || ''}`;
  if (!gpxContent.trim()) {
    throw new HttpsError('internal', 'Suunto route export returned an empty GPX payload.');
  }

  return gpxContent;
}

export async function uploadGPXRouteToSuuntoApp(
  userID: string,
  gpxContent: string,
  context?: SuuntoRouteUploadContext,
): Promise<SuuntoRouteUploadResult> {
  if (!gpxContent.trim()) {
    throw new HttpsError('invalid-argument', 'File content is empty');
  }

  const uploadContext = context || await createSuuntoRouteUploadContext(userID);
  let successCount = 0;
  let authFailures = 0;
  const providerRouteIds: string[] = [];
  const deliveries: Array<{ providerUserId: string; providerRouteId?: string | null }> = [];

  for (const tokenRef of uploadContext.tokenRefs) {
    let result: any;
    try {
      const latestTokenSnapshot = await getLatestSuuntoTokenSnapshot(tokenRef);
      result = await executeWithTokenRetry(
        latestTokenSnapshot,
        async (accessToken) => {
          await assertSuuntoRouteUploadUserActive(userID, 'before_provider_upload');
          const postResult = await requestPromise.post({
            headers: {
              'Authorization': toSuuntoAuthorizationHeader(accessToken),
              'Content-Type': 'application/gpx+xml',
              'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
            },
            body: gpxContent,
            url: 'https://cloudapi.suunto.com/v2/route/import',
          });
          return postResult;
        },
        `Upload route for user ${userID}`
      );

      logger.info('Suunto API raw response:', result);
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result);
        } catch (e) {
          logger.warn('Suunto API response is not JSON:', result);
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      if (isUserDeletionGuardReadError(error) || error instanceof SuuntoRouteUploadSkippedForDeletedUserError) {
        throw error;
      }
      if (error instanceof HttpsError && error.code === 'unauthenticated') {
        authFailures++;
        logger.warn(`Suunto token ${tokenRef.id} is no longer usable for user ${userID}`, {
          message: error.message,
        });
        continue;
      }

      logger.error(`Could not upload route for token ${tokenRef.id} for user ${userID}`, error);
      if (getStatusCode(error) === 401) {
        authFailures++;
      }
      continue;
    }

    if (result?.error) {
      logger.error(`Could not upload route for token ${tokenRef.id} for user ${userID} due to service error`, result.error);
      continue;
    }

    successCount++;
    const providerRouteId = getSuuntoProviderRouteId(result);
    if (providerRouteId) {
      providerRouteIds.push(providerRouteId);
    }
    deliveries.push({
      providerUserId: tokenRef.providerUserId,
      providerRouteId: providerRouteId || null,
    });
  }

  if (successCount > 0) {
    try {
      await incrementUploadedRoutesCountIfUserActive(userID, successCount);
    } catch (e: unknown) {
      logger.error('Could not update uploadedRoutes count', e);
    }
    return { status: 'success', successCount, providerRouteIds, deliveries };
  }

  if (authFailures > 0) {
    throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
  }

  throw new HttpsError('internal', 'Upload failed due to service errors.');
}

/**
 * Uploads a route to the Suunto app
 */
export const importRouteToSuuntoApp = onCall({
  region: FUNCTIONS_MANIFEST.importRouteToSuuntoApp.region,
  cors: ALLOWED_CORS_ORIGINS,
  timeoutSeconds: 300,
  maxInstances: 10,
}, async (request) => {

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;

  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking route upload for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  const base64File = request.data.file;

  if (!base64File) {
    logger.error('No file provided');
    throw new HttpsError('invalid-argument', 'File content missing');
  }

  try {
    const compressedData = Buffer.from(base64File, 'base64');
    const gpxContent = zlib.gunzipSync(compressedData).toString();
    await uploadGPXRouteToSuuntoApp(userID, gpxContent);
    return { status: 'success' };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (isUserDeletionGuardReadError(error)) {
      logger.error('[importRouteToSuuntoApp] Could not verify account deletion state', { userID, error });
      throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
    }
    if (error instanceof SuuntoRouteUploadSkippedForDeletedUserError) {
      throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    }

    const statusCode = getStatusCode(error);
    const providerMessage = getSuuntoErrorMessage(error);
    logger.error('[importRouteToSuuntoApp] Could not upload GPX route', {
      userID,
      statusCode,
      message: providerMessage || (error instanceof Error ? error.message : String(error)),
    });
    throw new HttpsError('internal', providerMessage || 'Upload failed due to service errors.');
  }
});
