'use strict';

import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as requestPromise from '../request-helper';
import { executeWithTokenRetry } from './retry-helper';
import { hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { SERVICE_NAME, SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { toSuuntoAuthorizationHeader } from './authorization-header';
import {
  getSuuntoProviderUserIdFromTokenLike,
  getSuuntoRouteImportSourceKeyFromTokenLike,
} from '../../../shared/suunto-route-import-state';
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
import {
  decodeManualRouteUpload,
  exportManualRouteAsGPX,
  getManualRouteInputFormat,
  ManualRouteUploadRequest,
  parseManualRouteUpload,
} from '../routes/manual-route-upload';
import {
  maybeDecompressPayloadForParsing,
  RouteProcessingHttpStatusError,
} from '../routes/route-processing';
import { MAX_ROUTE_UPLOAD_BYTES, ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  extractRefreshFailureDetails,
  isTerminalRefreshFailureForService,
} from '../service-auth-lifecycle';
import {
  isProviderOperationError,
  isTerminalServiceAuthError,
  isTransientProviderTransportError,
  ProviderOperationError,
} from '../shared/provider-operation-error';
import { RouteProviderAcceptanceHandler } from '../routes/provider-acceptance';
import { ProviderPendingDisconnectError } from '../shared/provider-pending-disconnect-error';

export interface SuuntoRouteUploadTokenRef {
  id: string;
  ref: admin.firestore.DocumentReference;
  providerUserId: string;
  sourceKey: string;
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
  providerSourceKey: string;
  id: string;
  description?: string | null;
  created?: number | null;
  modified?: number | null;
}

export interface SuuntoRouteListResult {
  routes: SuuntoRouteSummary[];
  successfulProviderUserIds: string[];
  failedProviderUserIds: string[];
  successfulProviderSourceKeys: string[];
  failedProviderSourceKeys: string[];
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
    if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
      throw new ProviderPendingDisconnectError(
        userID,
        ServiceNames.SuuntoApp,
        phase,
      );
    }
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

class SuuntoRouteProviderRequestError extends Error {
  readonly statusCode?: number;
  readonly response?: { statusCode?: unknown };
  readonly error?: unknown;

  constructor(readonly providerError: unknown) {
    super(providerError instanceof Error ? providerError.message : 'Suunto route request failed.');
    this.name = 'SuuntoRouteProviderRequestError';
    this.statusCode = getStatusCode(providerError);
    this.response = (providerError as { response?: { statusCode?: unknown } } | null)?.response;
    this.error = (providerError as { error?: unknown } | null)?.error;
  }
}

function shouldPreserveSuuntoRouteLifecycleError(error: unknown): boolean {
  return isUserDeletionGuardReadError(error)
    || error instanceof SuuntoRouteUploadSkippedForDeletedUserError
    || (error instanceof Error && (
      error.name === 'TokenRefreshSkippedForDeletedUserError'
      || error.name === 'TokenUseSkippedForPendingDisconnectError'
    ));
}

function toSuuntoRouteProviderOperationError(
  error: unknown,
  providerUserId: string,
): ProviderOperationError | null {
  if (isProviderOperationError(error)) {
    return error;
  }

  const statusCode = getStatusCode(error);
  const refreshFailure = extractRefreshFailureDetails(error);
  const temporaryAuthFailure = refreshFailure.isTerminalAuthFailure
    && !isTerminalRefreshFailureForService(ServiceNames.SuuntoApp, refreshFailure);
  const common = {
    serviceName: ServiceNames.SuuntoApp,
    operation: 'route_create' as const,
    providerUserId,
    statusCode,
  };

  if (isTerminalServiceAuthError(error) || statusCode === 401) {
    return new ProviderOperationError({
      ...common,
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message: 'Authentication failed. Please re-connect your Suunto account.',
      providerCode: isTerminalServiceAuthError(error)
        ? error.providerErrorCode || undefined
        : refreshFailure.providerErrorCode || undefined,
      dlqContext: isTerminalServiceAuthError(error)
        ? error.dlqContext || 'SUUNTO_AUTH_REQUIRED'
        : 'SUUNTO_AUTH_REQUIRED',
    });
  }

  if (statusCode === 403) {
    return new ProviderOperationError({
      ...common,
      disposition: 'permission_required',
      retryMode: 'none',
      code: 'permission-denied',
      message: 'Suunto rejected the route upload because the connection lacks permission.',
      dlqContext: 'SUUNTO_PERMISSION_REQUIRED',
    });
  }

  if (temporaryAuthFailure || statusCode === 429) {
    return new ProviderOperationError({
      ...common,
      disposition: 'retryable',
      retryMode: 'restart',
      code: statusCode === 429 ? 'resource-exhausted' : 'unavailable',
      message: 'Suunto route upload is temporarily unavailable. Please retry.',
      dlqContext: 'SUUNTO_ROUTE_UPLOAD_RETRY_EXHAUSTED',
    });
  }

  if (
    statusCode === 408
    || (statusCode !== undefined && statusCode >= 500)
    || (statusCode === undefined && isTransientProviderTransportError(error))
  ) {
    return new ProviderOperationError({
      ...common,
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Suunto route creation had an ambiguous outcome and was not retried to avoid a duplicate route.',
      dlqContext: 'SUUNTO_ROUTE_CREATE_AMBIGUOUS',
    });
  }

  if (error instanceof HttpsError) {
    if (error.code === 'unauthenticated') {
      return new ProviderOperationError({
        ...common,
        disposition: 'auth_required',
        retryMode: 'none',
        code: 'unauthenticated',
        message: error.message,
        dlqContext: 'SUUNTO_AUTH_REQUIRED',
      });
    }
    if (error.code === 'permission-denied') {
      return new ProviderOperationError({
        ...common,
        disposition: 'permission_required',
        retryMode: 'none',
        code: 'permission-denied',
        message: error.message,
        dlqContext: 'SUUNTO_PERMISSION_REQUIRED',
      });
    }
    if (error.code === 'unavailable' || error.code === 'resource-exhausted' || error.code === 'deadline-exceeded') {
      return new ProviderOperationError({
        ...common,
        disposition: 'retryable',
        retryMode: 'restart',
        code: error.code,
        message: error.message,
        dlqContext: 'SUUNTO_ROUTE_UPLOAD_RETRY_EXHAUSTED',
      });
    }
  }

  if (statusCode !== undefined) {
    return new ProviderOperationError({
      ...common,
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Suunto rejected the route upload.',
      dlqContext: 'SUUNTO_ROUTE_UPLOAD_REJECTED',
    });
  }

  return null;
}

function selectSuuntoRouteUploadFailure(failures: unknown[]): unknown {
  const providerFailures = failures.filter(isProviderOperationError);
  return providerFailures.find(error => error.dlqContext === 'SUUNTO_ROUTE_CREATE_AMBIGUOUS')
    || failures.find(error => !isProviderOperationError(error))
    || providerFailures.find(error => error.disposition === 'retryable')
    || providerFailures.find(error => error.disposition === 'auth_required')
    || providerFailures.find(error => error.disposition === 'permission_required')
    || providerFailures[0]
    || new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'route_create',
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Suunto rejected the route upload.',
      dlqContext: 'SUUNTO_ROUTE_UPLOAD_REJECTED',
    });
}

function toSuuntoRouteHttpsError(error: ProviderOperationError): HttpsError {
  if (error.disposition === 'auth_required') {
    return new HttpsError('unauthenticated', error.message);
  }
  if (error.disposition === 'permission_required') {
    return new HttpsError('permission-denied', error.message);
  }
  if (error.disposition === 'retryable') {
    return new HttpsError(
      error.code === 'resource-exhausted' ? 'resource-exhausted' : 'unavailable',
      error.message,
    );
  }
  return new HttpsError('failed-precondition', error.message);
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
      const providerUserId = getSuuntoProviderUserIdFromTokenLike(tokenSnapshot.data());
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
        sourceKey: getSuuntoRouteImportSourceKeyFromTokenLike(tokenSnapshot.data()) || `${providerUserId}:unknown-created`,
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
  return matchingTokenRefs;
}

function normalizeSuuntoRouteSummary(value: unknown): SuuntoRouteSummary | null {
  const providerUserId = normalizeSuuntoProviderUserId((value as { providerUserId?: unknown } | null)?.providerUserId);
  const providerSourceKey = typeof (value as { providerSourceKey?: unknown } | null)?.providerSourceKey === 'string'
    && (value as { providerSourceKey: string }).providerSourceKey.trim().length > 0
    ? (value as { providerSourceKey: string }).providerSourceKey.trim()
    : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const route = value as Record<string, unknown>;
  const id = typeof route.id === 'string' && route.id.trim() ? route.id.trim() : null;
  if (!id || !providerUserId || !providerSourceKey) {
    return null;
  }

  return {
    providerUserId,
    providerSourceKey,
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
  const tokenRefs = getSuuntoTokenRefsForReadOperation(context, providerUserId);
  if (tokenRefs.length === 0) {
    throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
  }

  let authFailures = 0;
  let lastError: unknown = null;

  for (const tokenRef of tokenRefs) {
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
): Promise<SuuntoRouteListResult> {
  const routeContext = context || await createSuuntoRouteUploadContext(userID);
  const routesByProviderKey = new Map<string, SuuntoRouteSummary>();
  const successfulProviderUserIds = new Set<string>();
  const failedProviderUserIds = new Set<string>();
  const successfulProviderSourceKeys = new Set<string>();
  const failedProviderSourceKeys = new Set<string>();
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
        failedProviderUserIds.add(tokenRef.providerUserId);
        failedProviderSourceKeys.add(tokenRef.sourceKey);
        continue;
      }

      successfulProviderUserIds.add(tokenRef.providerUserId);
      successfulProviderSourceKeys.add(tokenRef.sourceKey);
      failedProviderUserIds.delete(tokenRef.providerUserId);
      failedProviderSourceKeys.delete(tokenRef.sourceKey);

      for (const route of result) {
        const normalizedRoute = normalizeSuuntoRouteSummary({
          ...route,
          providerUserId: tokenRef.providerUserId,
          providerSourceKey: tokenRef.sourceKey,
        });
        if (!normalizedRoute) {
          continue;
        }

        routesByProviderKey.set(
          `${normalizedRoute.providerSourceKey}:${normalizedRoute.id}`,
          normalizedRoute,
        );
      }
    } catch (error) {
      if (isUserDeletionGuardReadError(error) || error instanceof SuuntoRouteUploadSkippedForDeletedUserError) {
        throw error;
      }
      failedProviderUserIds.add(tokenRef.providerUserId);
      failedProviderSourceKeys.add(tokenRef.sourceKey);
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

  if (routesByProviderKey.size > 0 || successfulProviderUserIds.size > 0) {
    return {
      routes: Array.from(routesByProviderKey.values()),
      successfulProviderUserIds: Array.from(successfulProviderUserIds.values()),
      failedProviderUserIds: Array.from(failedProviderUserIds.values()),
      successfulProviderSourceKeys: Array.from(successfulProviderSourceKeys.values()),
      failedProviderSourceKeys: Array.from(failedProviderSourceKeys.values()),
    };
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
  const normalizedProviderRouteId = `${providerRouteId || ''}`.trim();
  if (!normalizedProviderRouteId) {
    throw new HttpsError('invalid-argument', 'Suunto route id is required.');
  }
  const routeContext = options.context || await createSuuntoRouteUploadContext(userID);
  const result = await executeSuuntoRouteReadOperation(userID, routeContext, 'export_suunto_route', async (accessToken) => (
    requestPromise.get({
      headers: {
        'Accept': 'application/gpx+xml',
        'Authorization': toSuuntoAuthorizationHeader(accessToken),
        'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
      },
      url: `https://cloudapi.suunto.com/v2/route/${encodeURIComponent(normalizedProviderRouteId)}/export`,
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
  onProviderAccepted?: RouteProviderAcceptanceHandler,
): Promise<SuuntoRouteUploadResult> {
  if (!gpxContent.trim()) {
    throw new HttpsError('invalid-argument', 'File content is empty');
  }

  const uploadContext = context || await createSuuntoRouteUploadContext(userID);
  let successCount = 0;
  const failures: unknown[] = [];
  const providerRouteIds: string[] = [];
  const deliveries: Array<{ providerUserId: string; providerRouteId?: string | null }> = [];

  for (const [tokenIndex, tokenRef] of uploadContext.tokenRefs.entries()) {
    let result: any;
    try {
      const latestTokenSnapshot = await getLatestSuuntoTokenSnapshot(tokenRef);
      result = await executeWithTokenRetry(
        latestTokenSnapshot,
        async (accessToken) => {
          await assertSuuntoRouteUploadUserActive(userID, 'before_provider_upload');
          try {
            return await requestPromise.post({
              headers: {
                'Authorization': toSuuntoAuthorizationHeader(accessToken),
                'Content-Type': 'application/gpx+xml',
                'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
              },
              body: gpxContent,
              url: 'https://cloudapi.suunto.com/v2/route/import',
            });
          } catch (error) {
            throw new SuuntoRouteProviderRequestError(error);
          }
        },
        `Upload route for user ${userID}`
      );

      if (typeof result === 'string') {
        try {
          result = JSON.parse(result);
        } catch {
          logger.warn('[SuuntoRoutes] Route upload response was not JSON.', {
            userID,
            providerUserId: tokenRef.providerUserId,
            tokenId: tokenRef.id,
            responseLength: result.length,
          });
        }
      }
      logger.info('[SuuntoRoutes] Route upload response received.', {
        userID,
        providerUserId: tokenRef.providerUserId,
        tokenId: tokenRef.id,
        hasProviderRouteId: !!getSuuntoProviderRouteId(result),
        hasProviderError: !!(result as { error?: unknown } | null)?.error,
      });
    } catch (e: unknown) {
      if (shouldPreserveSuuntoRouteLifecycleError(e)) {
        throw e;
      }

      const isProviderRequestFailure = e instanceof SuuntoRouteProviderRequestError;
      const providerRequestError = isProviderRequestFailure ? e.providerError : e;
      const refreshFailure = extractRefreshFailureDetails(e);
      const shouldNormalize = isProviderRequestFailure
        || isProviderOperationError(e)
        || isTerminalServiceAuthError(e)
        || refreshFailure.isTerminalAuthFailure
        || e instanceof HttpsError;
      const normalizedError = shouldNormalize
        ? toSuuntoRouteProviderOperationError(providerRequestError, tokenRef.providerUserId)
        : null;

      logger.error('[SuuntoRoutes] Could not upload route for provider token.', {
        userID,
        providerUserId: tokenRef.providerUserId,
        tokenId: tokenRef.id,
        statusCode: getStatusCode(providerRequestError),
        errorName: e instanceof Error ? e.name : typeof e,
        disposition: normalizedError?.disposition,
        dlqContext: normalizedError?.dlqContext,
      });
      failures.push(normalizedError || e);
      continue;
    }

    if (result?.error) {
      logger.error('[SuuntoRoutes] Route upload returned a provider error.', {
        userID,
        providerUserId: tokenRef.providerUserId,
        tokenId: tokenRef.id,
      });
      failures.push(new ProviderOperationError({
        serviceName: ServiceNames.SuuntoApp,
        operation: 'route_create',
        disposition: 'permanent',
        retryMode: 'none',
        code: 'failed-precondition',
        message: 'Suunto rejected the route upload.',
        providerUserId: tokenRef.providerUserId,
        dlqContext: 'SUUNTO_ROUTE_UPLOAD_REJECTED',
      }));
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
    if (tokenIndex < uploadContext.tokenRefs.length - 1) {
      await onProviderAccepted?.({
        providerRouteId: providerRouteIds[0],
        complete: false,
        deliveries: [...deliveries],
      });
    }
  }

  if (successCount > 0) {
    const complete = failures.length === 0;
    await onProviderAccepted?.({
      providerRouteId: providerRouteIds[0],
      // A successful account must remain durable, but another failed account
      // means the provider batch cannot be finalized as a complete delivery.
      complete,
      deliveries: [...deliveries],
    });
    try {
      await incrementUploadedRoutesCountIfUserActive(userID, successCount);
    } catch (e: unknown) {
      logger.error('Could not update uploadedRoutes count', e);
    }
    if (complete) {
      return { status: 'success', successCount, providerRouteIds, deliveries };
    }
  }

  throw selectSuuntoRouteUploadFailure(failures);
}

/**
 * Uploads a route to the Suunto app
 */
export const importRouteToSuuntoApp = onCall({
  region: FUNCTIONS_MANIFEST.importRouteToSuuntoApp.region,
  cors: ALLOWED_CORS_ORIGINS,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
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

  try {
    await assertSuuntoRouteUploadUserActive(userID, 'before_manual_route_parsing');
    const gpxContent = await getSuuntoManualRouteGPXContent(request.data as SuuntoRouteUploadRequest);
    await uploadGPXRouteToSuuntoApp(userID, gpxContent);
    return { status: 'success' };
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenUseSkippedForPendingDisconnectError') {
      throw new HttpsError('failed-precondition', 'Suunto disconnect is pending.');
    }
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
    if (isProviderOperationError(error)) {
      throw toSuuntoRouteHttpsError(error);
    }

    const statusCode = getStatusCode(error);
    logger.error('[importRouteToSuuntoApp] Could not upload route', {
      userID,
      statusCode,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    if (statusCode === 401) {
      throw new HttpsError('unauthenticated', 'Authentication failed. Please re-connect your Suunto account.');
    }
    if (statusCode === 429) {
      throw new HttpsError('resource-exhausted', 'Suunto is rate-limiting route uploads. Please retry shortly.');
    }
    if (statusCode !== undefined && statusCode >= 500) {
      throw new HttpsError('unavailable', 'Suunto is temporarily unavailable. Please retry.');
    }
    if (statusCode !== undefined) {
      throw new HttpsError('failed-precondition', 'Suunto rejected the route upload.');
    }
    throw new HttpsError('internal', 'Upload failed due to service errors.');
  }
});

type SuuntoRouteUploadRequest = ManualRouteUploadRequest;

async function getSuuntoManualRouteGPXContent(payload: SuuntoRouteUploadRequest): Promise<string> {
  const sourcePayload = decodeManualRouteUpload(payload?.file);

  // Older browser clients gzip their GPX and omit a filename. Keep accepting that
  // wire format until every deployed client sends the source filename. Unlike
  // saved-route processing, this direct upload is constrained to the same 20MB
  // source/output limit as the current uploader.
  if (!payload?.filename) {
    try {
      const gpxPayload = maybeDecompressPayloadForParsing(sourcePayload, 'gpx.gz', {
        maxOutputLength: MAX_ROUTE_UPLOAD_BYTES,
        maxOutputLengthLabel: '20MB',
      });
      return exportManualRouteAsGPX(await parseManualRouteUpload(gpxPayload, 'gpx'));
    } catch (error) {
      if (error instanceof RouteProcessingHttpStatusError) {
        throw new HttpsError('invalid-argument', error.message);
      }
      throw error;
    }
  }

  const inputFormat = getManualRouteInputFormat(payload.filename, 'Suunto');
  const routeFile = await parseManualRouteUpload(sourcePayload, inputFormat);
  return exportManualRouteAsGPX(routeFile);
}
