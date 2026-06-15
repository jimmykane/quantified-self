import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  RouteExporterGPX,
  RouteFileInterface,
  ServiceNames,
} from '@sports-alliance/sports-lib';

import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
  SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS,
  SendRouteToServiceFailureReason,
  SendRouteToServiceItemResult,
  SendRoutesToServiceRequest,
  SendRoutesToServiceResponse,
} from '../../../shared/saved-route-send';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import {
  assignRouteSegmentIDs,
  getRouteParsingFailureMessage,
  maybeDecompressPayloadForParsing,
  parseRoutePayload,
  resolveRouteSourceExtension,
  RouteProcessingHttpStatusError,
} from './route-processing';
import { ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
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
import {
  setRouteDeliveryMetadata,
} from './route-persistence';
import { TokenRefreshSkippedForDeletedUserError } from '../tokens';

interface PreparedSavedRoute {
  routeId: string;
  routeDocument: FirestoreRouteJSON;
  sourceFile: OriginalRouteFileMetaData;
  routeFile: RouteFileInterface;
  gpxContent: string;
}

interface RouteSendDestinationAdapter<Context = unknown> {
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

class RouteSendItemError extends Error {
  constructor(
    public readonly reason: SendRouteToServiceFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'RouteSendItemError';
  }
}

class RouteSendSkippedForDeletedUserError extends Error {
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

export const sendRoutesToService = onCall({
  region: FUNCTIONS_MANIFEST.sendRoutesToService.region,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<SendRoutesToServiceResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;
  const payload = normalizeSendRoutesRequest(request.data as Partial<SendRoutesToServiceRequest> | undefined);
  const adapter = getRouteSendAdapter(payload.destinationServiceName);

  if (!(await hasProAccess(userID))) {
    logger.warn(`Blocking saved route send for non-pro user ${userID}`);
    throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  }

  try {
    await assertRouteSendUserActive(userID, 'before_destination_context');
    const results: SendRouteToServiceItemResult[] = [];
    let context;
    try {
      context = await adapter.createContext(userID);
    } catch (error) {
      return buildSendRoutesResponse(
        adapter.destinationServiceName,
        buildTerminalRouteSendResults(payload.routeIds, adapter.destinationServiceName, error),
      );
    }

    for (let index = 0; index < payload.routeIds.length; index++) {
      const routeId = payload.routeIds[index];
      try {
        await assertRouteSendUserActive(userID, 'before_route_prepare');
        const preparedRoute = await prepareSavedRouteForSending(userID, routeId);
        await assertRouteSendUserActive(userID, 'before_provider_upload');
        const providerResult = await adapter.sendRoute(userID, preparedRoute, context);
        await persistRouteDeliveryMetadataBestEffort({
          userID,
          routeID: routeId,
          destinationServiceName: adapter.destinationServiceName,
          providerRouteId: providerResult.providerRouteId,
          deliveries: providerResult.deliveries,
        });
        results.push({
          routeId,
          destinationServiceName: adapter.destinationServiceName,
          status: 'success',
          providerRouteId: providerResult.providerRouteId,
        });
      } catch (error) {
        if (isAccountDeletionSkipError(error) || isUserDeletionGuardReadError(error)) {
          results.push(...buildTerminalRouteSendResults(
            payload.routeIds.slice(index),
            adapter.destinationServiceName,
            error,
          ));
          break;
        }
        if (isDestinationAuthRequiredError(error)) {
          results.push(...buildTerminalRouteSendResults(
            payload.routeIds.slice(index),
            adapter.destinationServiceName,
            error,
          ));
          break;
        }
        if (isDestinationPermissionRequiredError(error)) {
          results.push(...buildTerminalRouteSendResults(
            payload.routeIds.slice(index),
            adapter.destinationServiceName,
            error,
          ));
          break;
        }
        results.push(buildRouteSendFailureResult(routeId, adapter.destinationServiceName, error));
      }
    }

    return buildSendRoutesResponse(adapter.destinationServiceName, results);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (isUserDeletionGuardReadError(error)) {
      logger.error('[sendRoutesToService] Could not verify account deletion state', {
        userID,
        destinationServiceName: payload.destinationServiceName,
        error,
      });
      throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
    }
    if (isAccountDeletionSkipError(error)) {
      throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    }

    logger.error('[sendRoutesToService] Failed to send saved routes', {
      userID,
      destinationServiceName: payload.destinationServiceName,
      routeCount: payload.routeIds.length,
      error,
    });
    throw new HttpsError('internal', 'Could not send routes to the selected service.');
  }
});

function normalizeSendRoutesRequest(payload: Partial<SendRoutesToServiceRequest> | undefined): SendRoutesToServiceRequest {
  const destinationServiceName = payload?.destinationServiceName;
  if (!destinationServiceName) {
    throw new HttpsError('invalid-argument', 'destinationServiceName is required.');
  }

  const routeIds = Array.from(new Set(
    (Array.isArray(payload?.routeIds) ? payload.routeIds : [])
      .map(routeId => `${routeId || ''}`.trim())
      .filter(Boolean),
  ));

  if (routeIds.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one routeId is required.');
  }

  if (routeIds.length > SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS) {
    throw new HttpsError('invalid-argument', `Send at most ${SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS} routes at a time.`);
  }

  return {
    destinationServiceName,
    routeIds,
  };
}

function getRouteSendAdapter(destinationServiceName: ServiceNames): RouteSendDestinationAdapter {
  const adapter = ROUTE_SEND_ADAPTERS.get(destinationServiceName);
  if (!adapter) {
    throw new HttpsError('failed-precondition', `Sending saved routes to ${destinationServiceName} is not supported yet.`);
  }
  return adapter;
}

async function assertRouteSendUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `route_send:${phase}`, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn('[sendRoutesToService] Skipping route send because user is missing or deletion is in progress.', {
    userID,
    phase,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw new RouteSendSkippedForDeletedUserError(userID, phase);
}

async function prepareSavedRouteForSending(
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
    logger.warn('[sendRoutesToService] Could not download saved route source file', {
      bucket: sourceFile.bucket,
      path: sourceFile.path,
      error,
    });
    throw new RouteSendItemError('SOURCE_FILE_UNAVAILABLE', 'Saved route source file could not be downloaded.');
  }
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

function buildRouteSendFailureResult(
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
      message: error.message,
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
  logger.error('[sendRoutesToService] Failed to send route item', {
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

function buildTerminalRouteSendResults(
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
    logger.error('[sendRoutesToService] Could not verify account deletion state during batch route send', {
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
    const message = error.message || 'Reconnect the selected service and try again.';
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

  return routeIds.map(routeId => buildRouteSendFailureResult(routeId, destinationServiceName, error));
}

function buildSendRoutesResponse(
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

function isAccountDeletionSkipError(error: unknown): boolean {
  return error instanceof RouteSendSkippedForDeletedUserError
    || error instanceof SuuntoRouteUploadSkippedForDeletedUserError
    || error instanceof TokenRefreshSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'RouteSendSkippedForDeletedUserError')
    || (error instanceof Error && error.name === 'SuuntoRouteUploadSkippedForDeletedUserError')
    || (error instanceof Error && error.name === 'TokenRefreshSkippedForDeletedUserError');
}

function isUserDeletionGuardReadError(error: unknown): error is UserDeletionGuardReadError {
  return error instanceof UserDeletionGuardReadError
    || (error instanceof Error && error.name === 'UserDeletionGuardReadError');
}

function isDestinationAuthRequiredError(error: unknown): error is HttpsError {
  return error instanceof HttpsError
    ? error.code === 'unauthenticated'
    : (error as { code?: unknown } | null)?.code === 'unauthenticated'
      || (error as { code?: unknown } | null)?.code === 'functions/unauthenticated';
}

function isDestinationPermissionRequiredError(error: unknown): error is GarminRouteSendPermissionRequiredError {
  return error instanceof GarminRouteSendPermissionRequiredError
    || (error instanceof Error && error.name === 'GarminRouteSendPermissionRequiredError');
}

async function persistRouteDeliveryMetadataBestEffort(params: {
  userID: string;
  routeID: string;
  destinationServiceName: ServiceNames;
  providerRouteId?: string;
  deliveries?: Array<{
    providerUserId?: string | null;
    providerRouteId?: string | null;
  }>;
}): Promise<void> {
  try {
    const deliveryEntries = params.deliveries && params.deliveries.length > 0
      ? params.deliveries
      : [{ providerRouteId: params.providerRouteId || null }];

    for (const delivery of deliveryEntries) {
      await setRouteDeliveryMetadata({
        userID: params.userID,
        routeID: params.routeID,
        deliveryMetadata: {
          serviceName: params.destinationServiceName,
          providerUserId: delivery.providerUserId || null,
          status: 'success',
          providerRouteId: delivery.providerRouteId || null,
          deliveredAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });
    }
  } catch (error) {
    logger.warn('[sendRoutesToService] Failed to persist route delivery metadata after successful send', {
      userID: params.userID,
      routeID: params.routeID,
      destinationServiceName: params.destinationServiceName,
      error,
    });
  }
}
