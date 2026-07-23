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
  SportsLib,
  WahooAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getRouteParsingFailureMessage, parseRoutePayload, RouteProcessingHttpStatusError } from '../routes/route-processing';
import {
  decodeManualRouteUpload,
  getManualRouteInputFormat,
  ManualRouteInputFormat,
} from '../routes/manual-route-upload';
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

interface UploadWahooRouteOptions {
  /**
   * A route that has already been parsed by a saved-route delivery worker.
   * Supplying it avoids a second parse and preserves the saved route's name.
   */
  routeFile?: RouteFileInterface;
  /** A stable provider key used when a saved Quantified Self route is updated. */
  externalId?: string;
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

function normalizeWahooFitFilename(value: unknown): string {
  const normalized = `${value || ''}`.trim().replace(/[\\/]/g, '_').slice(0, MAX_FILENAME_LENGTH);
  if (!normalized) return 'route.fit';
  if (normalized.toLowerCase().endsWith('.fit')) return normalized;
  const filenameWithoutExtension = normalized.replace(/\.[^./]+$/, '');
  return `${filenameWithoutExtension || 'route'}.fit`;
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
  name?: unknown;
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
  if (activityType.includes('bike') || activityType.includes('biking') || activityType.includes('cycl') || activityType.includes('road') || activityType.includes('gravel')) return 0;
  if (activityType.includes('walk') || activityType.includes('hike') || activityType.includes('mountain')) return 9;
  return 31;
}

function getWahooRouteName(routeFile: RouteFileInterface): string {
  const routeName = (routeFile.getRoutes() as WahooRouteSegment[])
    .map((route) => `${route.name || ''}`.trim())
    .find(Boolean);
  const fileName = `${routeFile.name || ''}`.trim();
  return (routeName || fileName || 'Quantified Self route').slice(0, 200);
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
  externalId?: string,
): WahooRoutePayload {
  const startPoint = getRouteStartPoint(routeFile);
  if (!startPoint) {
    throw new HttpsError('invalid-argument', 'This route is missing a valid starting coordinate.');
  }
  const distance = getRouteMetric(routeFile, DataDistance.type);
  if (distance === null || distance <= 0) {
    throw new HttpsError('invalid-argument', 'This route is missing distance data required by Wahoo.');
  }
  const ascent = getRouteMetric(routeFile, DataAscent.type) ?? 0;
  const descent = getRouteMetric(routeFile, DataDescent.type);

  return {
    externalId: externalId || createExternalId(userID, fileBuffer),
    filename: normalizeWahooFitFilename(filename),
    name: getWahooRouteName(routeFile),
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

async function parseWahooRoute(
  fileBuffer: Buffer,
  inputFormat: ManualRouteInputFormat,
): Promise<RouteFileInterface> {
  try {
    const routeFile = await parseRoutePayload(fileBuffer, inputFormat);
    if (!routeFile.hasRoutes()) {
      throw new RouteProcessingHttpStatusError(400, `No routes found in ${inputFormat.toUpperCase()} file.`);
    }
    return routeFile as RouteFileInterface;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('invalid-argument', getRouteParsingFailureMessage(error, inputFormat));
  }
}

async function convertWahooGpxRouteToFit(routeFile: RouteFileInterface): Promise<Buffer> {
  try {
    const fitBuffer = Buffer.from(await SportsLib.exportRoutesToFit(routeFile));
    if (fitBuffer.length === 0) {
      throw new Error('Generated FIT route is empty.');
    }
    if (fitBuffer.length > MAX_ROUTE_UPLOAD_BYTES) {
      throw new HttpsError('invalid-argument', 'Cannot upload route because the converted FIT file is greater than 20MB.');
    }
    return fitBuffer;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      'invalid-argument',
      'This GPX route could not be converted to a FIT course for Wahoo. It must contain exactly one route with valid coordinates.',
    );
  }
}

async function uploadWahooRoute(
  userID: string,
  fileBuffer: Buffer,
  inputFormat: ManualRouteInputFormat,
  filename?: unknown,
  options: UploadWahooRouteOptions = {},
): Promise<WahooRouteUploadResult> {
  if (fileBuffer.length === 0) {
    throw new HttpsError('invalid-argument', 'File content is empty.');
  }
  if (fileBuffer.length > MAX_ROUTE_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'Cannot upload route because the size is greater than 20MB.');
  }

  try {
    return await withWahooRouteAccessToken(userID, async (accessToken) => {
      const routeFile = options.routeFile || await parseWahooRoute(fileBuffer, inputFormat);
      const fitBuffer = inputFormat === 'gpx'
        ? await convertWahooGpxRouteToFit(routeFile)
        : fileBuffer;
      const payload = buildWahooRoutePayload(userID, fileBuffer, routeFile, filename, options.externalId);
      const form = buildWahooRouteForm(fitBuffer, payload);
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

/**
 * Verifies that the connected Wahoo account can receive routes. The queued
 * saved-route path calls this before the Wahoo route lookup or upload so a
 * missing connection or scope is reported as a skipped delivery, not a retry.
 */
export async function createWahooRouteSendContext(userID: string): Promise<void> {
  await withWahooRouteAccessToken(userID, async () => undefined);
}

function createSavedRouteExternalId(userID: string, savedRouteID: string): string {
  return createExternalId(userID, Buffer.from(`saved-route:${savedRouteID}`));
}

/**
 * Sends a route already stored by Quantified Self to Wahoo. Each saved-route
 * id maps to one opaque Wahoo external id, so later Suunto revisions update
 * the same Wahoo route instead of creating a duplicate.
 */
export async function sendSavedRouteToWahoo(
  userID: string,
  savedRouteID: string,
  routeFile: RouteFileInterface,
): Promise<WahooRouteUploadResult> {
  const fitBuffer = await convertWahooGpxRouteToFit(routeFile);
  return uploadWahooRoute(
    userID,
    fitBuffer,
    'fit',
    `${savedRouteID}.fit`,
    {
      routeFile,
      externalId: createSavedRouteExternalId(userID, savedRouteID),
    },
  );
}

/**
 * Sends a user-selected FIT or GPX route to Wahoo. GPX is converted to a FIT
 * course in memory because the Wahoo route endpoint accepts FIT payloads.
 */
export async function uploadRouteToWahoo(
  userID: string,
  fileBuffer: Buffer,
  filename?: unknown,
): Promise<WahooRouteUploadResult> {
  const inputFormat = filename
    ? getManualRouteInputFormat(filename, 'Wahoo', 'FIT or GPX')
    : 'fit';
  return uploadWahooRoute(userID, fileBuffer, inputFormat, filename);
}

/** @deprecated Use uploadRouteToWahoo for user-selected files. */
export async function uploadFitRouteToWahoo(
  userID: string,
  fileBuffer: Buffer,
  filename?: unknown,
): Promise<WahooRouteUploadResult> {
  return uploadWahooRoute(userID, fileBuffer, 'fit', filename);
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
  const fileBuffer = decodeManualRouteUpload(payload?.file);
  return uploadRouteToWahoo(userID, fileBuffer, payload?.filename);
});
