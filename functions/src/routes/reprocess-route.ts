import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { buildFirestoreRoutePayload } from '../shared/route-writer';
import { ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS } from '../shared/route-processing-config';
import {
  assignRouteSegmentIDs,
  createRouteProcessingMetadataPayload,
  getRouteParsingFailureMessage,
  maybeDecompressPayloadForParsing,
  parseRoutePayload,
  resolveRouteSourceExtension,
  RouteProcessingHttpStatusError,
} from './route-processing';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import {
  buildManualRouteSourceMetadata,
  buildRouteDocumentForWrite,
  getRouteSourceMetadataRef,
  toRouteSourceMetadata,
} from './route-persistence';

interface ReprocessRouteRequest {
  routeId: string;
}

interface ReprocessRouteResult {
  routeId: string;
  status: 'completed' | 'skipped';
  reason?: 'NO_ORIGINAL_FILES';
  sourceFilesCount: number;
  routeCount: number;
  waypointCount: number;
  pointCount: number;
}

export const reprocessRoute = onCall({
  region: FUNCTIONS_MANIFEST.reprocessRoute.region,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<ReprocessRouteResult> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const userID = request.auth.uid;
  const routeId = `${(request.data as ReprocessRouteRequest | undefined)?.routeId || ''}`.trim();
  if (!routeId) {
    throw new HttpsError('invalid-argument', 'routeId is required.');
  }

  try {
    return await reprocessRouteFromOriginalFile(userID, routeId);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (isUserDeletionGuardReadError(error)) {
      logger.error('[reprocessRoute] Could not verify account deletion state', { userID, routeId, error });
      throw new HttpsError('unavailable', 'Could not verify account state. Please retry.');
    }
    if (error instanceof RouteProcessingHttpStatusError && error.status >= 400 && error.status < 500) {
      throw new HttpsError('invalid-argument', error.message);
    }

    logger.error('[reprocessRoute] Failed to reprocess route', { userID, routeId, error });
    throw new HttpsError('internal', 'Could not reprocess route.');
  }
});

export async function reprocessRouteFromOriginalFile(
  userID: string,
  routeId: string,
): Promise<ReprocessRouteResult> {
  const db = admin.firestore();
  const routeRef = db.doc(`users/${userID}/routes/${routeId}`);
  const routeSnapshot = await routeRef.get();
  if (!routeSnapshot.exists) {
    throw new HttpsError('not-found', `Route ${routeId} was not found for this user.`);
  }

  const routeDocument = routeSnapshot.data() as FirestoreRouteJSON;
  const sourceFile = getPrimaryOriginalRouteFile(routeDocument);
  if (!sourceFile) {
    return {
      routeId,
      status: 'skipped',
      reason: 'NO_ORIGINAL_FILES',
      sourceFilesCount: 0,
      routeCount: 0,
      waypointCount: 0,
      pointCount: 0,
    };
  }

  await assertRouteReprocessUserActive(db, userID, 'route_reprocess_before_download');

  const resolvedExtension = resolveRouteSourceExtension(sourceFile, routeDocument.srcFileType);
  const originalPayload = await downloadOriginalRouteFile(sourceFile);
  const payloadForParsing = maybeDecompressPayloadForParsing(originalPayload, resolvedExtension);
  const routeFile = await parseSavedRoutePayload(payloadForParsing, resolvedExtension);

  routeFile.setID(routeId);
  assignRouteSegmentIDs(routeFile, routeId, getExistingRouteSegmentIDs(routeDocument));

  const parsedPayload = buildFirestoreRoutePayload(userID, routeFile);
  const routeCount = parsedPayload.routeCount;
  const waypointCount = parsedPayload.waypointCount;
  const pointCount = parsedPayload.pointCount;
  const sourceMetadata = toRouteSourceMetadata(routeDocument.sourceSummary)
    || buildManualRouteSourceMetadata({
      routeName: routeDocument.name || parsedPayload.name,
      originalFile: sourceFile,
      importedAt: routeDocument.importedAt || parsedPayload.importedAt || new Date(),
      modifiedAt: routeDocument.createdAt || parsedPayload.createdAt || null,
    });

  await db.runTransaction(async (transaction) => {
    await assertRouteReprocessUserActiveInTransaction(db, transaction, userID, 'route_reprocess_write');

    const latestSnapshot = await transaction.get(routeRef);
    if (!latestSnapshot.exists) {
      throw new HttpsError('not-found', `Route ${routeId} was not found for this user.`);
    }

    const latestRouteDocument = latestSnapshot.data() as FirestoreRouteJSON;
    const finalPayload = buildRouteDocumentForWrite({
      routeId,
      userID,
      parsedPayload,
      existingRouteDocument: latestRouteDocument,
      originalFiles: getResolvedOriginalFiles(latestRouteDocument, sourceFile),
      sourceMetadata,
    });

    transaction.set(routeRef, finalPayload);
    transaction.set(
      db.doc(`users/${userID}/routes/${routeId}/metaData/processing`),
      createRouteProcessingMetadataPayload(),
      { merge: true },
    );
    transaction.set(
      getRouteSourceMetadataRef(db, userID, routeId),
      sourceMetadata,
      { merge: true },
    );
  });

  return {
    routeId,
    status: 'completed',
    sourceFilesCount: 1,
    routeCount,
    waypointCount,
    pointCount,
  };
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

async function downloadOriginalRouteFile(sourceFile: OriginalRouteFileMetaData): Promise<Buffer> {
  const bucket = sourceFile.bucket
    ? admin.storage().bucket(sourceFile.bucket)
    : admin.storage().bucket();
  const [data] = await bucket.file(sourceFile.path).download();
  return Buffer.from(data);
}

async function parseSavedRoutePayload(
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
      throw error;
    }
    throw new RouteProcessingHttpStatusError(400, getRouteParsingFailureMessage(error, resolvedExtension));
  }
}

function getExistingRouteSegmentIDs(routeDocument: FirestoreRouteJSON): Array<string | null | undefined> {
  return Array.isArray(routeDocument.routes)
    ? routeDocument.routes.map(route => route?.id)
    : [];
}

function getResolvedOriginalFiles(
  routeDocument: FirestoreRouteJSON,
  fallbackSourceFile: OriginalRouteFileMetaData,
): OriginalRouteFileMetaData[] {
  if (Array.isArray(routeDocument.originalFiles) && routeDocument.originalFiles.length > 0) {
    return routeDocument.originalFiles;
  }

  return [routeDocument.originalFile || fallbackSourceFile];
}

async function assertRouteReprocessUserActive(
  db: admin.firestore.Firestore,
  userID: string,
  phase: string,
): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(db, userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, phase, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn('[reprocessRoute] Skipping route reprocess because user is missing or deletion is in progress.', {
    userID,
    phase,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw buildAccountDeletionError();
}

async function assertRouteReprocessUserActiveInTransaction(
  db: admin.firestore.Firestore,
  transaction: admin.firestore.Transaction,
  userID: string,
  phase: string,
): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, phase, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn('[reprocessRoute] Skipping route reprocess write because user is missing or deletion is in progress.', {
    userID,
    phase,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw buildAccountDeletionError();
}

function buildAccountDeletionError(): HttpsError {
  return new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
}

function isUserDeletionGuardReadError(error: unknown): error is UserDeletionGuardReadError {
  return error instanceof UserDeletionGuardReadError
    || (error instanceof Error && error.name === 'UserDeletionGuardReadError');
}
