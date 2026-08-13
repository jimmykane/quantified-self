'use strict';

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  COROSAPIAuth2ServiceTokenInterface,
  DataAscent,
  DataDistance,
  DataDuration,
  RouteFileInterface,
  ServiceNames,
} from '@sports-alliance/sports-lib';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';
import * as requestPromise from '../request-helper';
import {
  decodeManualRouteUpload,
  exportManualRouteAsGPX,
  getManualRouteInputFormat,
  parseManualRouteUpload,
} from '../routes/manual-route-upload';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
import {
  isProviderOperationError,
  isTerminalServiceAuthError,
  isTransientProviderTransportError,
  ProviderOperationError,
} from '../shared/provider-operation-error';
import { ProviderPendingDisconnectError } from '../shared/provider-pending-disconnect-error';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { getTokenData } from '../tokens';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { getActiveCOROSTokenSnapshot } from './account';
import { PRODUCTION_URL, SERVICE_NAME, STAGING_URL, USE_STAGING } from './constants';

const COROS_SUCCESS_CODE = '0000';
const COROS_DUPLICATE_ROUTE_CODE = '13001';
const COROS_GPX_FILE_TYPE = '0';
const COROS_BIKE_ROUTE_TYPE = 1;
const COROS_RUNNING_ROUTE_TYPE = 2;
const MAX_COROS_ROUTE_NAME_LENGTH = 100;
const MAX_COROS_ROUTE_BYTES = 20 * 1024 * 1024;

interface COROSRouteResponse {
  result?: unknown;
  message?: unknown;
}

interface COROSRouteUploadRequest {
  file?: unknown;
  filename?: unknown;
}

export interface COROSRouteSendContext {
  providerUserId: string;
}

export interface COROSRouteUploadResult {
  status: 'success';
  providerRouteId: string;
  providerUserId: string;
  duplicate?: boolean;
  message: string;
}

export class COROSRouteUploadSkippedForDeletedUserError extends Error {
  readonly name = 'COROSRouteUploadSkippedForDeletedUserError';
  readonly code = 'user_deleted_or_deleting';

  constructor(public readonly userID: string, public readonly phase: string) {
    super(`Skipping COROS route upload for user ${userID} during ${phase} because the user is missing or being deleted.`);
  }
}

function getCOROSBaseUrl(): string {
  return USE_STAGING ? STAGING_URL : PRODUCTION_URL;
}

function sanitizeMultipartValue(value: unknown, fallback = ''): string {
  const normalized = `${value ?? ''}`.replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function getCOROSRouteName(routeFile: RouteFileInterface, fallbackName?: unknown): string {
  const routeName = routeFile.getRoutes()
    .map(route => sanitizeMultipartValue(route.name))
    .find(Boolean);
  const fileName = sanitizeMultipartValue(routeFile.name);
  const fallback = sanitizeMultipartValue(fallbackName, 'Quantified Self route')
    .replace(/\.(?:fit|gpx)$/i, '');
  return (routeName || fileName || fallback || 'Quantified Self route').slice(0, MAX_COROS_ROUTE_NAME_LENGTH);
}

function getRouteMetric(routeFile: RouteFileInterface, type: string): number | null {
  const value = routeFile.getStats().get(type)?.getValue?.();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRouteCreatedAtSeconds(routeFile: RouteFileInterface): number {
  const createdAt = routeFile.createdAt;
  const time = createdAt instanceof Date ? createdAt.getTime() : Number.NaN;
  return Math.floor((Number.isFinite(time) ? time : Date.now()) / 1000);
}

function getRouteActivityTypeCandidates(
  routeFile: RouteFileInterface,
  routeDocument?: Pick<FirestoreRouteJSON, 'activityTypes'>,
): string[] {
  return [
    ...routeFile.getRoutes().map(route => route.activityType),
    ...(Array.isArray(routeDocument?.activityTypes) ? routeDocument.activityTypes : []),
  ].map(value => `${value || ''}`.trim().toLowerCase()).filter(Boolean);
}

/** COROS supports only bike or running routes; non-cycling routes intentionally fall back to running. */
export function resolveCOROSRouteType(
  routeFile: RouteFileInterface,
  routeDocument?: Pick<FirestoreRouteJSON, 'activityTypes'>,
): 1 | 2 {
  const isCycling = getRouteActivityTypeCandidates(routeFile, routeDocument).some(activityType => (
    activityType.includes('bike')
    || activityType.includes('biking')
    || activityType.includes('bicycle')
    || activityType.includes('cycl')
    || activityType.includes('mtb')
    || activityType.includes('gravel')
    || activityType.includes('velo')
    || activityType.includes('spin')
  ));
  return isCycling ? COROS_BIKE_ROUTE_TYPE : COROS_RUNNING_ROUTE_TYPE;
}

/** Produces a stable positive signed 63-bit id that JavaScript never converts through Number. */
export function createCOROSRouteId(
  userID: string,
  providerUserId: string,
  stableRouteKey: string,
  gpxContent: string,
): string {
  const digest = crypto.createHash('sha256')
    .update('quantified-self:coros-route:v1\0')
    .update(userID)
    .update('\0')
    .update(providerUserId)
    .update('\0')
    .update(stableRouteKey)
    .update('\0')
    .update(gpxContent)
    .digest('hex');
  const routeId = BigInt(`0x${digest.slice(0, 16)}`) & ((1n << 63n) - 1n);
  return `${routeId === 0n ? 1n : routeId}`;
}

/** Stable provider-scoped partner identity that does not disclose the Firebase UID. */
export function createCOROSOpenUserId(userID: string): string {
  return crypto.createHash('sha256')
    .update('quantified-self:coros-open-user:v1\0')
    .update(userID)
    .digest('hex')
    .slice(0, 32);
}

function appendMultipartField(parts: Buffer[], boundary: string, name: string, value: unknown): void {
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${sanitizeMultipartValue(value)}\r\n`,
  ));
}

function buildCOROSRouteMultipartBody(params: {
  openId: string;
  openUserId: string;
  routeId: string;
  gpxContent: string;
  type: 1 | 2;
  name: string;
  distance: number;
  timestamp: number;
  duration?: number;
  elevationGain?: number;
}): { body: Buffer; contentType: string } {
  const boundary = `----qsCorosRouteBoundary${crypto.randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [];
  appendMultipartField(parts, boundary, 'openId', params.openId);
  appendMultipartField(parts, boundary, 'openUserId', params.openUserId);
  appendMultipartField(parts, boundary, 'routeId', params.routeId);
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="routeFile"; filename="route.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n`,
  ));
  parts.push(Buffer.from(params.gpxContent, 'utf8'));
  parts.push(Buffer.from('\r\n'));
  appendMultipartField(parts, boundary, 'routeFileType', COROS_GPX_FILE_TYPE);
  appendMultipartField(parts, boundary, 'type', params.type);
  appendMultipartField(parts, boundary, 'name', params.name);
  appendMultipartField(parts, boundary, 'distance', params.distance.toFixed(2));
  appendMultipartField(parts, boundary, 'timestamp', params.timestamp);
  appendMultipartField(parts, boundary, 'language', 'en-US');
  if (params.duration !== undefined) appendMultipartField(parts, boundary, 'duration', params.duration);
  if (params.elevationGain !== undefined) appendMultipartField(parts, boundary, 'elevationGain', params.elevationGain.toFixed(2));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function parseCOROSRouteResponse(rawResponse: unknown): COROSRouteResponse {
  if (typeof rawResponse === 'string') {
    try {
      return JSON.parse(rawResponse) as COROSRouteResponse;
    } catch {
      throw new ProviderOperationError({
        serviceName: ServiceNames.COROSAPI,
        operation: 'route_upload',
        disposition: 'permanent',
        code: 'invalid-provider-response',
        message: 'COROS returned an invalid route upload response.',
        dlqContext: 'COROS_ROUTE_UPLOAD_INVALID_RESPONSE',
      });
    }
  }
  if (rawResponse && typeof rawResponse === 'object') return rawResponse as COROSRouteResponse;
  throw new ProviderOperationError({
    serviceName: ServiceNames.COROSAPI,
    operation: 'route_upload',
    disposition: 'permanent',
    code: 'invalid-provider-response',
    message: 'COROS returned an invalid route upload response.',
    dlqContext: 'COROS_ROUTE_UPLOAD_INVALID_RESPONSE',
  });
}

function statusCodeFromError(error: unknown): number | undefined {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isFinite(statusCode) ? statusCode : undefined;
}

function toCOROSRouteRequestError(
  error: unknown,
  providerUserId: string,
  providerRouteId: string,
): ProviderOperationError {
  if (isProviderOperationError(error)) return error;
  const statusCode = statusCodeFromError(error);
  if (isTerminalServiceAuthError(error) || statusCode === 401) {
    return new ProviderOperationError({
      serviceName: ServiceNames.COROSAPI,
      operation: 'route_upload',
      disposition: 'auth_required',
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending routes.',
      statusCode,
      providerUserId,
      providerOperationId: providerRouteId,
      dlqContext: 'COROS_ROUTE_UPLOAD_AUTH_REQUIRED',
    });
  }
  if (statusCode === 403) {
    return new ProviderOperationError({
      serviceName: ServiceNames.COROSAPI,
      operation: 'route_upload',
      disposition: 'permission_required',
      code: 'permission-denied',
      message: 'COROS has not enabled route upload permission for this application.',
      statusCode,
      providerUserId,
      providerOperationId: providerRouteId,
      dlqContext: 'COROS_ROUTE_UPLOAD_PERMISSION_REQUIRED',
    });
  }
  const retryable = statusCode === 408
    || statusCode === 429
    || (statusCode !== undefined && statusCode >= 500)
    || isTransientProviderTransportError(error);
  return new ProviderOperationError({
    serviceName: ServiceNames.COROSAPI,
    operation: 'route_upload',
    disposition: retryable ? 'retryable' : 'permanent',
    retryMode: retryable ? 'restart' : 'none',
    code: statusCode === 429 ? 'resource-exhausted' : retryable ? 'unavailable' : 'failed-precondition',
    message: statusCode === 429
      ? 'COROS is rate-limiting route uploads. Please retry shortly.'
      : retryable
        ? 'COROS route uploads are temporarily unavailable. Please retry.'
        : 'COROS rejected the route upload.',
    statusCode,
    providerUserId,
    providerOperationId: providerRouteId,
    dlqContext: retryable ? 'COROS_ROUTE_UPLOAD_RETRY_EXHAUSTED' : 'COROS_ROUTE_UPLOAD_REJECTED',
  });
}

function toCOROSRouteResultError(
  response: COROSRouteResponse,
  providerUserId: string,
  providerRouteId: string,
): ProviderOperationError {
  const providerCode = `${response.result || ''}`.trim() || 'unknown';
  const common = {
    serviceName: ServiceNames.COROSAPI,
    operation: 'route_upload' as const,
    providerCode,
    providerUserId,
    providerOperationId: providerRouteId,
  };
  if (providerCode === '5006' || providerCode === '5010') {
    return new ProviderOperationError({
      ...common,
      disposition: 'auth_required',
      code: 'unauthenticated',
      message: 'Reconnect COROS before sending routes.',
      dlqContext: 'COROS_ROUTE_UPLOAD_AUTH_REQUIRED',
    });
  }
  if (providerCode === '30009') {
    return new ProviderOperationError({
      ...common,
      disposition: 'permission_required',
      code: 'permission-denied',
      message: 'COROS has not enabled route upload permission for this application.',
      dlqContext: 'COROS_ROUTE_UPLOAD_PERMISSION_REQUIRED',
    });
  }
  return new ProviderOperationError({
    ...common,
    disposition: 'permanent',
    code: providerCode === '1008' || providerCode === '1031' ? 'invalid-argument' : 'failed-precondition',
    message: providerCode === '1008'
      ? `COROS rejected the route because it exceeds the provider's size limit.`
      : providerCode === '1031'
        ? 'COROS rejected the route upload parameters.'
        : 'COROS rejected the route upload.',
    dlqContext: 'COROS_ROUTE_UPLOAD_REJECTED',
  });
}

async function assertCOROSRouteUploadAllowed(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `coros_route_upload:${phase}`, error);
  }
  if (deletionGuard.shouldSkip) throw new COROSRouteUploadSkippedForDeletedUserError(userID, phase);
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new ProviderPendingDisconnectError(userID, ServiceNames.COROSAPI, phase);
  }
}

async function withActiveCOROSRouteToken<T>(
  userID: string,
  expectedProviderUserId: string | undefined,
  operation: (token: COROSAPIAuth2ServiceTokenInterface, providerUserId: string) => Promise<T>,
): Promise<T> {
  await assertCOROSRouteUploadAllowed(userID, 'before_token_lookup');
  const selectedSnapshot = await getActiveCOROSTokenSnapshot(userID);
  const providerUserId = selectedSnapshot.id;
  if (expectedProviderUserId && providerUserId !== expectedProviderUserId) {
    throw new HttpsError('unauthenticated', 'The selected COROS account changed before the route could be sent.');
  }

  const execute = async (forceRefresh: boolean): Promise<T> => {
    const currentSnapshot = await selectedSnapshot.ref.get();
    if (!currentSnapshot.exists) throw new HttpsError('unauthenticated', 'Reconnect COROS before sending routes.');
    let token: COROSAPIAuth2ServiceTokenInterface;
    try {
      token = await getTokenData(currentSnapshot, ServiceNames.COROSAPI, forceRefresh) as COROSAPIAuth2ServiceTokenInterface;
    } catch (error) {
      if (isTerminalServiceAuthError(error)) throw new HttpsError('unauthenticated', 'Reconnect COROS before sending routes.');
      throw error;
    }
    const openId = `${token.openId || providerUserId}`.trim();
    if (!openId || openId !== providerUserId) throw new HttpsError('unauthenticated', 'Reconnect COROS before sending routes.');
    await assertCOROSRouteUploadAllowed(userID, 'before_provider_request');
    return operation(token, providerUserId);
  };

  try {
    return await execute(false);
  } catch (error) {
    if (statusCodeFromError(error) === 401 || (isProviderOperationError(error) && error.providerCode === '5006')) {
      return execute(true);
    }
    throw error;
  }
}

export async function createCOROSRouteSendContext(userID: string): Promise<COROSRouteSendContext> {
  await assertCOROSRouteUploadAllowed(userID, 'before_context');
  const snapshot = await getActiveCOROSTokenSnapshot(userID);
  return { providerUserId: snapshot.id };
}

export async function uploadGPXRouteToCOROS(params: {
  userID: string;
  gpxContent: string;
  routeFile: RouteFileInterface;
  stableRouteKey: string;
  fallbackName?: unknown;
  routeDocument?: Pick<FirestoreRouteJSON, 'activityTypes'>;
  expectedProviderUserId?: string;
}): Promise<COROSRouteUploadResult> {
  const gpxBytes = Buffer.byteLength(params.gpxContent, 'utf8');
  if (gpxBytes === 0) throw new HttpsError('invalid-argument', 'Generated GPX route content is empty.');
  if (gpxBytes > MAX_COROS_ROUTE_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload route because the converted GPX file is greater than 20MB.');
  }
  const distance = getRouteMetric(params.routeFile, DataDistance.type);
  if (distance === null || distance <= 0) {
    throw new HttpsError('invalid-argument', 'This route is missing distance data required by COROS.');
  }

  return withActiveCOROSRouteToken(params.userID, params.expectedProviderUserId, async (token, providerUserId) => {
    const providerRouteId = createCOROSRouteId(
      params.userID,
      providerUserId,
      params.stableRouteKey,
      params.gpxContent,
    );
    const duration = getRouteMetric(params.routeFile, DataDuration.type);
    const elevationGain = getRouteMetric(params.routeFile, DataAscent.type);
    const multipart = buildCOROSRouteMultipartBody({
      openId: providerUserId,
      openUserId: createCOROSOpenUserId(params.userID),
      routeId: providerRouteId,
      gpxContent: params.gpxContent,
      type: resolveCOROSRouteType(params.routeFile, params.routeDocument),
      name: getCOROSRouteName(params.routeFile, params.fallbackName),
      distance,
      timestamp: getRouteCreatedAtSeconds(params.routeFile),
      ...(duration !== null && duration >= 0 ? { duration: Math.round(duration) } : {}),
      ...(elevationGain !== null && elevationGain >= 0 ? { elevationGain } : {}),
    });

    let response: COROSRouteResponse;
    try {
      response = parseCOROSRouteResponse(await requestPromise.post({
        url: `${getCOROSBaseUrl()}/coros/route/push`,
        headers: { token: token.accessToken, 'Content-Type': multipart.contentType },
        json: false,
        body: multipart.body,
      }));
    } catch (error) {
      throw toCOROSRouteRequestError(error, providerUserId, providerRouteId);
    }

    const resultCode = `${response.result || ''}`.trim();
    if (resultCode === COROS_SUCCESS_CODE || resultCode === COROS_DUPLICATE_ROUTE_CODE) {
      const duplicate = resultCode === COROS_DUPLICATE_ROUTE_CODE;
      return {
        status: 'success',
        providerRouteId,
        providerUserId,
        ...(duplicate ? { duplicate: true } : {}),
        message: duplicate ? 'Route already exists in COROS.' : 'Route uploaded to COROS.',
      };
    }
    throw toCOROSRouteResultError(response, providerUserId, providerRouteId);
  });
}

export async function sendSavedRouteToCOROS(
  userID: string,
  savedRouteID: string,
  routeFile: RouteFileInterface,
  gpxContent: string,
  routeDocument: FirestoreRouteJSON,
  context: COROSRouteSendContext,
): Promise<COROSRouteUploadResult> {
  return uploadGPXRouteToCOROS({
    userID,
    gpxContent,
    routeFile,
    stableRouteKey: `saved-route:${savedRouteID}`,
    fallbackName: routeDocument.name || savedRouteID,
    routeDocument,
    expectedProviderUserId: context.providerUserId,
  });
}

export async function uploadRouteToCOROS(
  userID: string,
  fileBuffer: Buffer,
  filename: unknown,
): Promise<COROSRouteUploadResult> {
  const inputFormat = getManualRouteInputFormat(filename, 'COROS', 'FIT or GPX');
  const routeFile = await parseManualRouteUpload(fileBuffer, inputFormat);
  const gpxContent = await exportManualRouteAsGPX(routeFile);
  return uploadGPXRouteToCOROS({
    userID,
    gpxContent,
    routeFile,
    stableRouteKey: `manual:${crypto.createHash('sha256').update(fileBuffer).digest('hex')}`,
    fallbackName: filename,
  });
}

function toCallableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof UserDeletionGuardReadError) {
    throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
  }
  if (error instanceof COROSRouteUploadSkippedForDeletedUserError) {
    throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
  }
  if (error instanceof ProviderPendingDisconnectError) {
    throw new HttpsError('failed-precondition', 'COROS is being disconnected. Please retry after reconnecting.');
  }
  if (!isProviderOperationError(error)) {
    logger.warn('[COROSRouteUpload] Unexpected route upload failure', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw new HttpsError('unavailable', 'COROS route uploads are temporarily unavailable. Please retry.');
  }
  if (error.disposition === 'auth_required') throw new HttpsError('unauthenticated', error.message);
  if (error.disposition === 'permission_required') throw new HttpsError('permission-denied', error.message);
  if (error.disposition === 'retryable') {
    throw new HttpsError(error.code === 'resource-exhausted' ? 'resource-exhausted' : 'unavailable', error.message);
  }
  throw new HttpsError(error.code === 'invalid-argument' ? 'invalid-argument' : 'failed-precondition', error.message);
}

export const importRouteToCOROSAPI = onCall({
  region: FUNCTIONS_MANIFEST.importRouteToCOROSAPI.region,
  secrets: FUNCTION_SECRET_BINDINGS.importRouteToCOROSAPI,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<COROSRouteUploadResult> => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  if (!(await hasProAccess(request.auth.uid))) throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  try {
    const payload = request.data as COROSRouteUploadRequest;
    return await uploadRouteToCOROS(
      request.auth.uid,
      decodeManualRouteUpload(payload?.file),
      payload?.filename,
    );
  } catch (error) {
    return toCallableError(error);
  }
});
