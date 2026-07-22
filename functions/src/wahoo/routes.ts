'use strict';

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  DataAscent,
  DataDescent,
  DataDistance,
  RouteFileInterface,
  ServiceNames,
  WahooAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getRouteParsingFailureMessage, parseRoutePayload, RouteProcessingHttpStatusError } from '../routes/route-processing';
import { isServiceDisconnectPendingForUser } from '../service-disconnect-pending';
import { MAX_ROUTE_UPLOAD_BYTES, ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
import {
  getUserDeletionGuardState,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { getTokenData } from '../tokens';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import {
  SERVICE_NAME,
  WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
  WAHOO_API_ROUTES_READ_SCOPE,
  WAHOO_API_ROUTES_WRITE_SCOPE,
} from './constants';
import { WahooAPIRequestError, WahooAPITransportError, requestWahooAPI } from './auth/api';
import { getWahooErrorLogDetails, getWahooProviderErrorMessage, isWahooDuplicateError } from './error-details';

const MAX_BASE64_ROUTE_UPLOAD_LENGTH = Math.ceil(MAX_ROUTE_UPLOAD_BYTES / 3) * 4 + 4;
const MAX_FILENAME_LENGTH = 200;
const WAHOO_ROUTE_ALREADY_TAKEN_MESSAGE_PATTERN = /\balready\b.*\btaken\b/i;

interface WahooRouteRecord {
  id?: unknown;
}

interface WahooRoutePayload {
  externalId: string;
  filename: string;
  name: string;
  workoutTypeFamilyId: number;
  startLatitude: number;
  startLongitude: number;
  distance: number;
  ascent: number;
  descent?: number;
  providerUpdatedAt: string;
}

interface WahooRouteUploadRequest {
  file?: unknown;
  filename?: unknown;
}

export interface WahooRouteUploadResult {
  status: 'success';
  providerRouteId?: string;
  message: string;
}

export class WahooRouteWriteScopeRequiredError extends HttpsError {
  public override readonly name = 'WahooRouteWriteScopeRequiredError';

  constructor() {
    super('failed-precondition', 'Reconnect Wahoo and allow route access before sending routes.');
  }
}

export class WahooRouteUploadSkippedForDeletedUserError extends Error {
  public readonly name = 'WahooRouteUploadSkippedForDeletedUserError';

  constructor(
    public readonly userID: string,
    public readonly phase: string,
  ) {
    super(`Skipping Wahoo route upload for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  }
}

function hasScope(scope: unknown, requiredScope: string): boolean {
  return `${scope || ''}`
    .split(/\s+/)
    .some((value) => value.trim() === requiredScope);
}

function normalizeFilename(value: unknown): string {
  const normalized = `${value || ''}`.trim().replace(/[\\/]/g, '_').slice(0, MAX_FILENAME_LENGTH);
  if (!normalized) return 'route.fit';
  return normalized.toLowerCase().endsWith('.fit') ? normalized : `${normalized}.fit`;
}

function toUploadBuffer(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpsError('invalid-argument', 'File content missing.');
  }
  if (value.length > MAX_BASE64_ROUTE_UPLOAD_LENGTH
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'File content is not valid base64.');
  }

  const fileBuffer = Buffer.from(value, 'base64');
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  if (fileBuffer.length > MAX_ROUTE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload route because the size is greater than 20MB.');
  }
  return fileBuffer;
}

async function assertWahooRouteUploadUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `wahoo_route_upload:${phase}`, error);
  }

  if (!deletionGuard.shouldSkip) return;
  throw new WahooRouteUploadSkippedForDeletedUserError(userID, phase);
}

async function assertWahooRouteUploadProviderActionAllowed(userID: string, phase: string): Promise<void> {
  await assertWahooRouteUploadUserActive(userID, phase);
  if (await isServiceDisconnectPendingForUser(userID, SERVICE_NAME)) {
    throw new HttpsError('failed-precondition', 'Wahoo disconnect is pending.');
  }
}

async function withWahooRouteAccessToken<T>(
  userID: string,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
  await assertWahooRouteUploadProviderActionAllowed(userID, 'before_token_lookup');

  const initialTokenSnapshots = await admin.firestore()
    .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
    .doc(userID)
    .collection('tokens')
    .limit(1)
    .get();
  const initialTokenSnapshot = initialTokenSnapshots.docs[0];
  if (!initialTokenSnapshot) {
    throw new HttpsError('unauthenticated', 'Connect Wahoo before sending routes.');
  }

  const execute = async (forceRefresh: boolean): Promise<T> => {
    const currentTokenSnapshot = await initialTokenSnapshot.ref.get();
    if (!currentTokenSnapshot.exists) {
      throw new HttpsError('unauthenticated', 'Connect Wahoo before sending routes.');
    }
    const token = await getTokenData(
      currentTokenSnapshot,
      ServiceNames.WahooAPI,
      forceRefresh,
    ) as WahooAPIAuth2ServiceTokenInterface;
    if (!hasScope(token.scope, WAHOO_API_ROUTES_READ_SCOPE) || !hasScope(token.scope, WAHOO_API_ROUTES_WRITE_SCOPE)) {
      throw new WahooRouteWriteScopeRequiredError();
    }
    return operation(token.accessToken);
  };

  try {
    return await execute(false);
  } catch (error) {
    if (error instanceof WahooAPIRequestError && error.statusCode === 401) {
      return execute(true);
    }
    throw error;
  }
}

function getRouteMetric(routeFile: RouteFileInterface, type: string): number | null {
  const value = routeFile.getStats().get(type)?.getValue?.();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface WahooRoutePoint {
  latitudeDegrees?: unknown;
  longitudeDegrees?: unknown;
}

interface WahooRouteSegment {
  activityType?: unknown;
  getPointData?: () => WahooRoutePoint[];
}

function getRouteStartPoint(routeFile: RouteFileInterface): { latitude: number; longitude: number } | null {
  for (const route of routeFile.getRoutes() as WahooRouteSegment[]) {
    for (const point of route.getPointData?.() || []) {
      const { latitudeDegrees: latitude, longitudeDegrees: longitude } = point;
      if (typeof latitude === 'number'
        && typeof longitude === 'number'
        && Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180) {
        return { latitude, longitude };
      }
    }
  }
  return null;
}

function getWorkoutTypeFamilyId(routeFile: RouteFileInterface): number {
  const activityTypes = (routeFile.getRoutes() as WahooRouteSegment[])
    .map((route) => `${route.activityType || ''}`.trim().toLowerCase())
    .filter(Boolean);
  const activityType = activityTypes[0] || '';

  if (activityType.includes('run')) return 1;
  if (activityType.includes('swim')) return 2;
  if (activityType.includes('water')) return 3;
  if (activityType.includes('snow') || activityType.includes('ski')) return 4;
  if (activityType.includes('skate')) return 5;
  if (activityType.includes('gym') || activityType.includes('yoga')) return 6;
  if (activityType.includes('walk') || activityType.includes('hike') || activityType.includes('mountain')) return 9;
  if (activityType.includes('bike') || activityType.includes('cycl') || activityType.includes('road') || activityType.includes('gravel')) return 0;
  return 31;
}

function getRouteCreatedAt(routeFile: RouteFileInterface): Date {
  const candidate = routeFile.createdAt;
  return candidate instanceof Date && Number.isFinite(candidate.getTime()) ? candidate : new Date();
}

function createExternalId(userID: string, fileBuffer: Buffer): string {
  const fingerprint = crypto.createHash('sha256')
    .update(userID)
    .update(':')
    .update(fileBuffer)
    .digest('hex');
  return `qs-route-${fingerprint.slice(0, 48)}`;
}

export function buildWahooRoutePayload(
  userID: string,
  fileBuffer: Buffer,
  routeFile: RouteFileInterface,
  filename?: unknown,
): WahooRoutePayload {
  const startPoint = getRouteStartPoint(routeFile);
  if (!startPoint) {
    throw new HttpsError('invalid-argument', 'This FIT route is missing a valid starting coordinate.');
  }
  const distance = getRouteMetric(routeFile, DataDistance.type);
  if (distance === null || distance <= 0) {
    throw new HttpsError('invalid-argument', 'This FIT route is missing distance data required by Wahoo.');
  }
  const routeName = `${routeFile.name || ''}`.trim() || 'Quantified Self route';
  const ascent = getRouteMetric(routeFile, DataAscent.type) ?? 0;
  const descent = getRouteMetric(routeFile, DataDescent.type);

  return {
    externalId: createExternalId(userID, fileBuffer),
    filename: normalizeFilename(filename),
    name: routeName.slice(0, 200),
    workoutTypeFamilyId: getWorkoutTypeFamilyId(routeFile),
    startLatitude: startPoint.latitude,
    startLongitude: startPoint.longitude,
    distance,
    ascent,
    ...(descent !== null && descent >= 0 ? { descent } : {}),
    providerUpdatedAt: getRouteCreatedAt(routeFile).toISOString(),
  };
}

function buildWahooRouteForm(fileBuffer: Buffer, payload: WahooRoutePayload): URLSearchParams {
  const form = new URLSearchParams();
  form.set('route[file]', `data:application/vnd.fit;base64,${fileBuffer.toString('base64')}`);
  form.set('route[filename]', payload.filename);
  form.set('route[external_id]', payload.externalId);
  form.set('route[provider_updated_at]', payload.providerUpdatedAt);
  form.set('route[name]', payload.name);
  form.set('route[workout_type_family_id]', `${payload.workoutTypeFamilyId}`);
  form.set('route[start_lat]', `${payload.startLatitude}`);
  form.set('route[start_lng]', `${payload.startLongitude}`);
  form.set('route[distance]', `${payload.distance}`);
  form.set('route[ascent]', `${payload.ascent}`);
  if (payload.descent !== undefined) form.set('route[descent]', `${payload.descent}`);
  return form;
}

function getRouteRecords(value: unknown): WahooRouteRecord[] {
  if (Array.isArray(value)) return value as WahooRouteRecord[];
  if (value && typeof value === 'object' && Array.isArray((value as { routes?: unknown }).routes)) {
    return (value as { routes: WahooRouteRecord[] }).routes;
  }
  return [];
}

function getProviderRouteId(value: unknown): string | undefined {
  const normalized = `${(value as WahooRouteRecord | null)?.id ?? ''}`.trim();
  return normalized || undefined;
}

async function findWahooRouteByExternalId(accessToken: string, externalId: string): Promise<WahooRouteRecord | undefined> {
  const existingResponse = await requestWahooAPI<unknown>(
    accessToken,
    `/v1/routes?external_id=${encodeURIComponent(externalId)}`,
  );
  return getRouteRecords(existingResponse.data)[0];
}

function isWahooRouteCreateConflict(error: unknown): boolean {
  if (!(error instanceof WahooAPIRequestError)) return false;
  if (error.statusCode === 409 || isWahooDuplicateError(error)) return true;
  return error.statusCode === 422
    && WAHOO_ROUTE_ALREADY_TAKEN_MESSAGE_PATTERN.test(getWahooProviderErrorMessage(error) || '');
}

async function updateWahooRoute(
  userID: string,
  accessToken: string,
  providerRouteId: string,
  form: URLSearchParams,
  phase: string,
): Promise<{ providerRouteId?: string; message: string }> {
  await assertWahooRouteUploadProviderActionAllowed(userID, phase);
  const response = await requestWahooAPI<WahooRouteRecord>(
    accessToken,
    `/v1/routes/${encodeURIComponent(providerRouteId)}`,
    { method: 'PUT', form },
  );
  return {
    providerRouteId: getProviderRouteId(response.data) || providerRouteId,
    message: 'Route updated in Wahoo.',
  };
}

function toWahooRouteHttpsError(error: unknown): never {
  if (error instanceof WahooAPITransportError) {
    throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable. Please retry.');
  }
  if (!(error instanceof WahooAPIRequestError)) throw error;
  if (error.statusCode === 401) {
    throw new HttpsError('unauthenticated', 'Reconnect Wahoo before sending routes.');
  }
  if (error.statusCode === 403) {
    throw new WahooRouteWriteScopeRequiredError();
  }
  if (error.statusCode === 429) {
    throw new HttpsError('resource-exhausted', 'Wahoo is rate-limiting route uploads. Please retry shortly.', {
      retryAfterSeconds: error.resetAfterSeconds,
    });
  }
  if (error.statusCode >= 500) {
    throw new HttpsError('unavailable', 'Wahoo is temporarily unavailable. Please retry.');
  }
  const providerMessage = getWahooProviderErrorMessage(error);
  throw new HttpsError(
    'failed-precondition',
    providerMessage ? `Wahoo rejected the route upload: ${providerMessage}` : 'Wahoo rejected the route upload.',
  );
}

async function parseWahooFitRoute(fileBuffer: Buffer): Promise<RouteFileInterface> {
  try {
    const routeFile = await parseRoutePayload(fileBuffer, 'fit');
    if (!routeFile.hasRoutes()) {
      throw new RouteProcessingHttpStatusError(400, 'No routes found in FIT file.');
    }
    return routeFile as RouteFileInterface;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('invalid-argument', getRouteParsingFailureMessage(error, 'fit'));
  }
}

export async function uploadFitRouteToWahoo(
  userID: string,
  fileBuffer: Buffer,
  filename?: unknown,
): Promise<WahooRouteUploadResult> {
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  if (fileBuffer.length > MAX_ROUTE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload route because the size is greater than 20MB.');
  }

  try {
    return await withWahooRouteAccessToken(userID, async (accessToken) => {
      const routeFile = await parseWahooFitRoute(fileBuffer);
      const payload = buildWahooRoutePayload(userID, fileBuffer, routeFile, filename);
      const form = buildWahooRouteForm(fileBuffer, payload);
      await assertWahooRouteUploadProviderActionAllowed(userID, 'before_route_lookup');
      const existingRoute = await findWahooRouteByExternalId(accessToken, payload.externalId);
      const existingRouteId = getProviderRouteId(existingRoute);
      if (existingRouteId) {
        return {
          status: 'success',
          ...await updateWahooRoute(userID, accessToken, existingRouteId, form, 'before_route_update'),
        };
      }

      await assertWahooRouteUploadProviderActionAllowed(userID, 'before_route_create');
      try {
        const response = await requestWahooAPI<WahooRouteRecord>(accessToken, '/v1/routes', { method: 'POST', form });
        return {
          status: 'success',
          providerRouteId: getProviderRouteId(response.data),
          message: 'Route uploaded to Wahoo.',
        };
      } catch (error) {
        if (!isWahooRouteCreateConflict(error)) throw error;

        await assertWahooRouteUploadProviderActionAllowed(userID, 'before_conflict_route_lookup');
        const conflictRoute = await findWahooRouteByExternalId(accessToken, payload.externalId);
        const conflictRouteId = getProviderRouteId(conflictRoute);
        if (!conflictRouteId) throw error;

        return {
          status: 'success',
          ...await updateWahooRoute(userID, accessToken, conflictRouteId, form, 'before_conflict_route_update'),
        };
      }
    });
  } catch (error) {
    logger.warn('Wahoo route upload failed', getWahooErrorLogDetails(error));
    return toWahooRouteHttpsError(error);
  }
}

async function requireWahooRouteUploadAccess(request: { auth?: { uid: string } | null }): Promise<string> {
  enforceAppCheck(request as Parameters<typeof enforceAppCheck>[0]);
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  if (!(await hasProAccess(request.auth.uid))) {
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }
  return request.auth.uid;
}

export const importRouteToWahooAPI = onCall({
  region: FUNCTIONS_MANIFEST.importRouteToWahooAPI.region,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<WahooRouteUploadResult> => {
  const userID = await requireWahooRouteUploadAccess(request);
  const payload = request.data as WahooRouteUploadRequest;
  const fileBuffer = toUploadBuffer(payload?.file);
  return uploadFitRouteToWahoo(userID, fileBuffer, payload?.filename);
});
