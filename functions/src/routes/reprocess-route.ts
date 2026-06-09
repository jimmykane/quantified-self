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

const SERVER_OWNED_ROUTE_FIELDS = [
  'id',
  'userID',
  'originalFile',
  'originalFiles',
  'srcFileType',
  'sourceFileType',
  'createdAt',
  'importedAt',
  'updatedAt',
  'creator',
  'stats',
  'routes',
  'routeCount',
  'waypointCount',
  'pointCount',
  'activityTypes',
  'streamTypes',
  'bounds',
] as const;

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

  await db.runTransaction(async (transaction) => {
    const latestSnapshot = await transaction.get(routeRef);
    if (!latestSnapshot.exists) {
      throw new HttpsError('not-found', `Route ${routeId} was not found for this user.`);
    }

    const latestRouteDocument = latestSnapshot.data() as FirestoreRouteJSON;
    const finalPayload = buildReprocessedRoutePayload(
      routeId,
      userID,
      parsedPayload,
      latestRouteDocument,
      sourceFile,
    );

    transaction.set(routeRef, finalPayload);
    transaction.set(
      db.doc(`users/${userID}/routes/${routeId}/metaData/processing`),
      createRouteProcessingMetadataPayload(),
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

function buildReprocessedRoutePayload(
  routeId: string,
  userID: string,
  parsedPayload: FirestoreRouteJSON,
  latestRouteDocument: FirestoreRouteJSON,
  parsedSourceFile: OriginalRouteFileMetaData,
): FirestoreRouteJSON {
  const originalFiles = Array.isArray(latestRouteDocument.originalFiles) && latestRouteDocument.originalFiles.length > 0
    ? latestRouteDocument.originalFiles
    : [latestRouteDocument.originalFile || parsedSourceFile];
  const originalFile = latestRouteDocument.originalFile || originalFiles[0] || parsedSourceFile;
  const preservedName = typeof latestRouteDocument.name === 'string' && latestRouteDocument.name.trim()
    ? latestRouteDocument.name
    : parsedPayload.name;

  return {
    ...getUserOwnedRouteFields(latestRouteDocument),
    ...parsedPayload,
    id: routeId,
    userID,
    name: preservedName,
    originalFile,
    originalFiles,
    importedAt: latestRouteDocument.importedAt || parsedPayload.importedAt,
    updatedAt: new Date(),
  };
}

function getUserOwnedRouteFields(routeDocument: FirestoreRouteJSON): Record<string, unknown> {
  const userOwnedFields: Record<string, unknown> = { ...routeDocument };
  for (const field of SERVER_OWNED_ROUTE_FIELDS) {
    delete userOwnedFields[field];
  }
  return userOwnedFields;
}
