import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  RouteExporterGPX,
  RouteFileInterface,
  ServiceNames,
} from '@sports-alliance/sports-lib';

import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';
import {
  GARMIN_DELIVERY_METADATA_ABORT_MESSAGE,
  GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE,
  SendRouteToServiceFailureReason,
  SendRouteToServiceItemResult,
  SendRoutesToServiceResponse,
} from '../../../shared/saved-route-send';
import {
  assignRouteSegmentIDs,
  getRouteParsingFailureMessage,
  maybeDecompressPayloadForParsing,
  parseRoutePayload,
  resolveRouteSourceExtension,
  RouteProcessingHttpStatusError,
} from './route-processing';
import {
  getUserDeletionGuardState,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
  createSuuntoRouteUploadContext,
  SuuntoRouteUploadContext,
  SuuntoRouteUploadSkippedForDeletedUserError,
  uploadGPXRouteToSuuntoApp,
} from '../suunto/routes';
import {
  createGarminRouteSendContext,
  GarminRouteSendContext,
  GarminRouteSendPermissionRequiredError,
  sendRouteToGarminConnect,
} from '../garmin/routes';
import { setRouteDeliveryMetadata } from './route-persistence';
import { TokenRefreshSkippedForDeletedUserError } from '../tokens';

export interface PreparedSavedRoute {
  routeId: string;
  routeDocument: FirestoreRouteJSON;
  sourceFile: OriginalRouteFileMetaData;
  routeFile: RouteFileInterface;
  gpxContent: string;
}

export interface RouteSendDestinationAdapter<Context = unknown> {
  readonly destinationServiceName: ServiceNames;
  createContext(userID: string): Promise<Context>;
  sendRoute(
    userID: string,
    preparedRoute: PreparedSavedRoute,
    context: Context,
  ): Promise<{
    providerRouteId?: string;
    deliveries?: Array<{
      providerUserId?: string | null;
      providerRouteId?: string | null;
    }>;
  }>;
}

export class RouteSendItemError extends Error {
  constructor(
    public readonly reason: SendRouteToServiceFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'RouteSendItemError';
  }
}

export class RouteSendSkippedForDeletedUserError extends Error {
  public readonly name = 'RouteSendSkippedForDeletedUserError';
  public readonly code = 'user_deleted_or_deleting';

  constructor(
    public readonly userID: string,
    public readonly phase: string,
  ) {
    super(`Skipping route send for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  }
}

class SuuntoRouteSendAdapter implements RouteSendDestinationAdapter<SuuntoRouteUploadContext> {
  readonly destinationServiceName = ServiceNames.SuuntoApp;

  createContext(userID: string): Promise<SuuntoRouteUploadContext> {
    return createSuuntoRouteUploadContext(userID);
  }

  async sendRoute(
    userID: string,
    preparedRoute: PreparedSavedRoute,
    context: SuuntoRouteUploadContext,
  ): Promise<{ providerRouteId?: string; deliveries?: Array<{ providerUserId?: string | null; providerRouteId?: string | null }> }> {
    const uploadContext = getSuuntoRouteSendContext(preparedRoute.routeDocument, context);
    const result = await uploadGPXRouteToSuuntoApp(userID, preparedRoute.gpxContent, uploadContext);
    return {
      providerRouteId: result.providerRouteIds[0],
      deliveries: result.deliveries,
    };
  }
}

class GarminRouteSendAdapter implements RouteSendDestinationAdapter<GarminRouteSendContext> {
  readonly destinationServiceName = ServiceNames.GarminAPI;

  createContext(userID: string): Promise<GarminRouteSendContext> {
    return createGarminRouteSendContext(userID);
  }

  sendRoute(
    userID: string,
    preparedRoute: PreparedSavedRoute,
    context: GarminRouteSendContext,
  ): Promise<{ providerRouteId?: string; deliveries?: Array<{ providerUserId?: string | null; providerRouteId?: string | null }> }> {
    return sendRouteToGarminConnect(
      userID,
      preparedRoute.routeId,
      preparedRoute.routeDocument,
      preparedRoute.routeFile,
      context,
    );
  }
}

const ROUTE_SEND_ADAPTERS = new Map<ServiceNames, RouteSendDestinationAdapter>([
  [ServiceNames.SuuntoApp, new SuuntoRouteSendAdapter()],
  [ServiceNames.GarminAPI, new GarminRouteSendAdapter()],
]);

const STRICT_ROUTE_DELIVERY_METADATA_DESTINATIONS = new Set<ServiceNames>([
  ServiceNames.GarminAPI,
]);
const ROUTE_DELIVERY_METADATA_MAX_ATTEMPTS = 3;

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getRouteSourceServiceName(routeDocument: FirestoreRouteJSON): string | null {
  if (!routeDocument?.sourceSummary || typeof routeDocument.sourceSummary !== 'object' || Array.isArray(routeDocument.sourceSummary)) {
    return null;
  }

  return normalizeNonEmptyString(routeDocument.sourceSummary.sourceServiceName);
}

function getRouteSourceProviderUserId(routeDocument: FirestoreRouteJSON): string | null {
  if (!routeDocument?.sourceSummary || typeof routeDocument.sourceSummary !== 'object' || Array.isArray(routeDocument.sourceSummary)) {
    return null;
  }

  return normalizeNonEmptyString(routeDocument.sourceSummary.providerUserId);
}

function getSuuntoRouteSendContext(
  routeDocument: FirestoreRouteJSON,
  context: SuuntoRouteUploadContext,
): SuuntoRouteUploadContext {
  if (getRouteSourceServiceName(routeDocument) !== ServiceNames.SuuntoApp) {
    return context;
  }

  const sourceProviderUserId = getRouteSourceProviderUserId(routeDocument);
  if (!sourceProviderUserId) {
    throw new RouteSendItemError(
      'SOURCE_SERVICE_BLOCKED',
      'Routes imported from Suunto can only be sent to a different connected Suunto account once the source account is known.',
    );
  }

  const eligibleTokenRefs = context.tokenRefs.filter(tokenRef => tokenRef.providerUserId !== sourceProviderUserId);
  if (eligibleTokenRefs.length === 0) {
    throw new RouteSendItemError(
      'SOURCE_SERVICE_BLOCKED',
      'Routes imported from Suunto are already in the connected Suunto account and cannot be sent back there.',
    );
  }

  return {
    tokenRefs: eligibleTokenRefs,
    userNames: Array.from(new Set(eligibleTokenRefs.map(tokenRef => tokenRef.providerUserId))),
  };
}

export function getRouteSendAdapter(destinationServiceName: ServiceNames): RouteSendDestinationAdapter | null {
  return ROUTE_SEND_ADAPTERS.get(destinationServiceName) || null;
}

export async function assertRouteSendUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `route_send:${phase}`, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn('[RouteSendCore] Skipping route send because user is missing or deletion is in progress.', {
    userID,
    phase,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw new RouteSendSkippedForDeletedUserError(userID, phase);
}

export async function prepareSavedRouteForSending(
  userID: string,
  routeId: string,
): Promise<PreparedSavedRoute> {
  const routeSnapshot = await admin.firestore().doc(`users/${userID}/routes/${routeId}`).get();
  if (!routeSnapshot.exists) {
    throw new RouteSendItemError('NOT_FOUND', `Route ${routeId} was not found.`);
  }

  const routeDocument = routeSnapshot.data() as FirestoreRouteJSON;
  const sourceFile = getPrimaryOriginalRouteFile(routeDocument);
  if (!sourceFile) {
    throw new RouteSendItemError('NO_ORIGINAL_FILES', 'Saved route is missing its original source file.');
  }

  const resolvedExtension = resolveSavedRouteSourceExtension(sourceFile, routeDocument.srcFileType);
  const originalPayload = await downloadOriginalRouteFile(sourceFile);
  const payloadForParsing = maybeDecompressSavedRoutePayloadForSending(originalPayload, resolvedExtension);
  const routeFile = await parseSavedRoutePayloadForSending(payloadForParsing, resolvedExtension);

  routeFile.setID(routeId);
  assignRouteSegmentIDs(routeFile, routeId, getExistingRouteSegmentIDs(routeDocument));
  applySavedRouteNameForSending(routeFile as RouteFileInterface, routeDocument, routeId);

  const exporter = new RouteExporterGPX();
  const gpxContent = await exporter.getAsString(routeFile as RouteFileInterface);
  if (!gpxContent.trim()) {
    throw new RouteSendItemError('PARSE_FAILED', 'Generated GPX route content is empty.');
  }

  return {
    routeId,
    routeDocument,
    sourceFile,
    routeFile: routeFile as RouteFileInterface,
    gpxContent,
  };
}

function applySavedRouteNameForSending(
  routeFile: RouteFileInterface,
  routeDocument: FirestoreRouteJSON,
  routeId: string,
): void {
  const routeName = getSavedRouteNameForSending(routeDocument, routeId);
  routeFile.name = routeName;

  const routes = routeFile.getRoutes();
  if (routes.length === 1) {
    routes[0].name = routeName;
  }
}

function getSavedRouteNameForSending(routeDocument: FirestoreRouteJSON, routeId: string): string {
  const candidates = [
    routeDocument.name,
    routeDocument.id,
    routeId,
    'Saved route',
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (value) {
      return value;
    }
  }

  return 'Saved route';
}

function getPrimaryOriginalRouteFile(routeDocument: FirestoreRouteJSON): OriginalRouteFileMetaData | null {
  if (Array.isArray(routeDocument.originalFiles)) {
    const sourceFile = routeDocument.originalFiles.find(file => !!file?.path);
    if (sourceFile) {
      return sourceFile;
    }
  }

  return routeDocument.originalFile?.path ? routeDocument.originalFile : null;
}

function resolveSavedRouteSourceExtension(
  sourceFile: OriginalRouteFileMetaData,
  fallbackExtension?: string,
): string {
  try {
    return resolveRouteSourceExtension(sourceFile, fallbackExtension);
  } catch (error) {
    if (error instanceof RouteProcessingHttpStatusError) {
      throw new RouteSendItemError('PARSE_FAILED', error.message);
    }
    throw error;
  }
}

async function downloadOriginalRouteFile(sourceFile: OriginalRouteFileMetaData): Promise<Buffer> {
  const bucket = sourceFile.bucket
    ? admin.storage().bucket(sourceFile.bucket)
    : admin.storage().bucket();
  try {
    const [data] = await bucket.file(sourceFile.path).download();
    return Buffer.from(data);
  } catch (error) {
    logger.warn('[RouteSendCore] Could not download saved route source file', {
      bucket: sourceFile.bucket,
      path: sourceFile.path,
      error,
    });
    if (isRetryableStorageDownloadError(error)) {
      throw Object.assign(new Error('Saved route source file could not be downloaded.'), {
        code: 'unavailable',
        statusCode: getStorageErrorStatusCode(error),
      });
    }
    throw new RouteSendItemError('SOURCE_FILE_UNAVAILABLE', 'Saved route source file could not be downloaded.');
  }
}

function getStorageErrorStatusCode(error: unknown): number | undefined {
  const directCode = Number((error as { code?: unknown } | null)?.code);
  if (Number.isFinite(directCode)) {
    return directCode;
  }

  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isFinite(statusCode) ? statusCode : undefined;
}

function isRetryableStorageDownloadError(error: unknown): boolean {
  const code = `${(error as { code?: unknown } | null)?.code || ''}`.trim().toLowerCase();
  const message = `${(error as { message?: unknown } | null)?.message || ''}`.toLowerCase();
  const statusCode = getStorageErrorStatusCode(error);

  return code === 'unavailable'
    || code === 'deadline-exceeded'
    || code === 'aborted'
    || message.includes('econnreset')
    || message.includes('unavailable')
    || (typeof statusCode === 'number' && [408, 429, 500, 502, 503, 504].includes(statusCode));
}

function maybeDecompressSavedRoutePayloadForSending(
  originalPayload: Buffer,
  resolvedExtension: string,
): Buffer {
  try {
    return maybeDecompressPayloadForParsing(originalPayload, resolvedExtension);
  } catch (error) {
    if (error instanceof RouteProcessingHttpStatusError) {
      throw new RouteSendItemError('PARSE_FAILED', error.message);
    }
    throw error;
  }
}

async function parseSavedRoutePayloadForSending(
  payloadForParsing: Buffer,
  resolvedExtension: string,
) {
  try {
    const routeFile = await parseRoutePayload(payloadForParsing, resolvedExtension);
    if (!routeFile.hasRoutes()) {
      throw new RouteProcessingHttpStatusError(400, 'No routes were found in the saved source file.');
    }
    return routeFile;
  } catch (error) {
    if (error instanceof RouteProcessingHttpStatusError) {
      throw new RouteSendItemError('PARSE_FAILED', error.message);
    }
    throw new RouteSendItemError('PARSE_FAILED', getRouteParsingFailureMessage(error, resolvedExtension));
  }
}

function getExistingRouteSegmentIDs(routeDocument: FirestoreRouteJSON): Array<string | null | undefined> {
  return Array.isArray(routeDocument.routes)
    ? routeDocument.routes.map(route => route?.id)
    : [];
}

export async function persistRouteDeliveryMetadataAfterSend(params: {
  userID: string;
  routeID: string;
  destinationServiceName: ServiceNames;
  providerRouteId?: string;
  routeSyncRouteId?: string | null;
  sourceRevisionKey?: string | null;
  deliveries?: Array<{
    providerUserId?: string | null;
    providerRouteId?: string | null;
  }>;
}): Promise<void> {
  const deliveryEntries = params.deliveries && params.deliveries.length > 0
    ? params.deliveries
    : [{ providerRouteId: params.providerRouteId || null }];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ROUTE_DELIVERY_METADATA_MAX_ATTEMPTS; attempt++) {
    try {
      for (const delivery of deliveryEntries) {
        const persisted = await setRouteDeliveryMetadata({
          userID: params.userID,
          routeID: params.routeID,
          deliveryMetadata: {
            serviceName: params.destinationServiceName,
            providerUserId: delivery.providerUserId || null,
            status: 'success',
            routeSyncRouteId: params.routeSyncRouteId || null,
            sourceRevisionKey: params.sourceRevisionKey || null,
            providerRouteId: delivery.providerRouteId || null,
            deliveredAt: new Date(),
            lastAttemptAt: new Date(),
          },
        });
        if (!persisted) {
          throw new RouteSendItemError('DELIVERY_METADATA_PERSIST_FAILED', GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE);
        }
      }
      return;
    } catch (error) {
      lastError = error;
      logger.warn('[RouteSendCore] Failed to persist route delivery metadata after successful send', {
        userID: params.userID,
        routeID: params.routeID,
        destinationServiceName: params.destinationServiceName,
        attempt,
        maxAttempts: ROUTE_DELIVERY_METADATA_MAX_ATTEMPTS,
        error,
      });
    }
  }

  if (STRICT_ROUTE_DELIVERY_METADATA_DESTINATIONS.has(params.destinationServiceName)) {
    logger.error('[RouteSendCore] Route delivery metadata persistence failed for a strict destination', {
      userID: params.userID,
      routeID: params.routeID,
      destinationServiceName: params.destinationServiceName,
      maxAttempts: ROUTE_DELIVERY_METADATA_MAX_ATTEMPTS,
      error: lastError,
    });
    throw new RouteSendItemError('DELIVERY_METADATA_PERSIST_FAILED', GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE);
  }
}

export async function sendPreparedRouteToDestination(
  userID: string,
  preparedRoute: PreparedSavedRoute,
  adapter: RouteSendDestinationAdapter,
  context: unknown,
): Promise<{
  providerRouteId?: string;
  deliveries?: Array<{
    providerUserId?: string | null;
    providerRouteId?: string | null;
  }>;
}> {
  return adapter.sendRoute(userID, preparedRoute, context);
}

export function buildRouteSendFailureResult(
  routeId: string,
  destinationServiceName: ServiceNames,
  error: unknown,
): SendRouteToServiceItemResult {
  if (error instanceof RouteSendItemError) {
    return {
      routeId,
      destinationServiceName,
      status: error.reason === 'NO_ORIGINAL_FILES' || error.reason === 'SOURCE_SERVICE_BLOCKED' ? 'skipped' : 'failure',
      reason: error.reason,
      message: error.message,
    };
  }
  if (isDestinationAuthRequiredError(error)) {
    return {
      routeId,
      destinationServiceName,
      status: 'failure',
      reason: 'DESTINATION_AUTH_REQUIRED',
      message: error instanceof Error ? error.message : 'Reconnect the selected service and try again.',
    };
  }
  if (isDestinationPermissionRequiredError(error)) {
    return {
      routeId,
      destinationServiceName,
      status: 'failure',
      reason: 'DESTINATION_PERMISSION_REQUIRED',
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : 'Could not send route.';
  logger.error('[RouteSendCore] Failed to send route item', {
    routeId,
    destinationServiceName,
    error,
  });
  return {
    routeId,
    destinationServiceName,
    status: 'failure',
    reason: 'PROVIDER_ERROR',
    message,
  };
}

export function buildTerminalRouteSendResults(
  routeIds: string[],
  destinationServiceName: ServiceNames,
  error: unknown,
): SendRouteToServiceItemResult[] {
  if (routeIds.length === 0) {
    return [];
  }

  if (isAccountDeletionSkipError(error)) {
    return routeIds.map(routeId => ({
      routeId,
      destinationServiceName,
      status: 'skipped',
      reason: 'ACCOUNT_DELETION_IN_PROGRESS',
      message: 'Account is being deleted or no longer exists.',
    }));
  }

  if (isUserDeletionGuardReadError(error)) {
    logger.error('[RouteSendCore] Could not verify account deletion state during batch route send', {
      destinationServiceName,
      routeIds,
      error,
    });
    return routeIds.map(routeId => ({
      routeId,
      destinationServiceName,
      status: 'failure',
      reason: 'ACCOUNT_STATE_UNAVAILABLE',
      message: 'Could not verify account state. Please retry.',
    }));
  }

  if (isDestinationAuthRequiredError(error)) {
    const message = error instanceof Error ? error.message : 'Reconnect the selected service and try again.';
    return routeIds.map(routeId => ({
      routeId,
      destinationServiceName,
      status: 'failure',
      reason: 'DESTINATION_AUTH_REQUIRED',
      message,
    }));
  }
  if (isDestinationPermissionRequiredError(error)) {
    const message = error.message || 'Grant the required destination permissions and reconnect before sending routes.';
    return routeIds.map(routeId => ({
      routeId,
      destinationServiceName,
      status: 'failure',
      reason: 'DESTINATION_PERMISSION_REQUIRED',
      message,
    }));
  }
  if (isDeliveryMetadataPersistenceError(error)) {
    return routeIds.map(routeId => ({
      routeId,
      destinationServiceName,
      status: 'failure',
      reason: 'DELIVERY_METADATA_PERSIST_FAILED',
      message: error.message,
    }));
  }

  return routeIds.map(routeId => buildRouteSendFailureResult(routeId, destinationServiceName, error));
}

export function buildUnattemptedRouteSendResultsAfterDeliveryMetadataFailure(
  routeIds: string[],
  destinationServiceName: ServiceNames,
): SendRouteToServiceItemResult[] {
  return routeIds.map(routeId => ({
    routeId,
    destinationServiceName,
    status: 'failure',
    reason: 'SEND_REQUEST_FAILED',
    message: GARMIN_DELIVERY_METADATA_ABORT_MESSAGE,
  }));
}

export function buildSendRoutesResponse(
  destinationServiceName: ServiceNames,
  results: SendRouteToServiceItemResult[],
): SendRoutesToServiceResponse {
  const successCount = results.filter(result => result.status === 'success').length;
  const skippedCount = results.filter(result => result.status === 'skipped').length;
  const failureCount = results.length - successCount - skippedCount;
  const status = successCount === results.length
    ? 'success'
    : successCount > 0 ? 'partial_success' : 'failure';

  return {
    destinationServiceName,
    status,
    routeCount: results.length,
    successCount,
    failureCount,
    skippedCount,
    results,
  };
}

export function isAccountDeletionSkipError(error: unknown): boolean {
  return error instanceof RouteSendSkippedForDeletedUserError
    || error instanceof SuuntoRouteUploadSkippedForDeletedUserError
    || error instanceof TokenRefreshSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'RouteSendSkippedForDeletedUserError')
    || (error instanceof Error && error.name === 'SuuntoRouteUploadSkippedForDeletedUserError')
    || (error instanceof Error && error.name === 'TokenRefreshSkippedForDeletedUserError');
}

export function isUserDeletionGuardReadError(error: unknown): error is UserDeletionGuardReadError {
  return error instanceof UserDeletionGuardReadError
    || (error instanceof Error && error.name === 'UserDeletionGuardReadError');
}

export function isDestinationAuthRequiredError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'unauthenticated'
    || (error as { code?: unknown } | null)?.code === 'functions/unauthenticated';
}

export function isDestinationPermissionRequiredError(error: unknown): error is GarminRouteSendPermissionRequiredError {
  return error instanceof GarminRouteSendPermissionRequiredError
    || (error instanceof Error && error.name === 'GarminRouteSendPermissionRequiredError');
}

export function isDeliveryMetadataPersistenceError(error: unknown): error is RouteSendItemError {
  return error instanceof RouteSendItemError
    ? error.reason === 'DELIVERY_METADATA_PERSIST_FAILED'
    : false;
}
