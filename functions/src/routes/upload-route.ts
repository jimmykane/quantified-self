import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { SportsLib } from '@sports-alliance/sports-lib';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as xmldom from 'xmldom';

import {
  AppRouteInterface,
  AppRouteSegmentInterface,
  FirestoreRouteJSON,
  OriginalRouteFileMetaData,
} from '../../../shared/app-route.interface';
import { ALLOWED_CORS_ORIGINS, ENFORCE_APP_CHECK, hasBasicAccess, hasProAccess } from '../utils';
import { createRouteParsingOptions, RouteParsingOptionsLike } from '../../../shared/parsing-options';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { buildFirestoreRoutePayload, OriginalRouteFile } from '../shared/route-writer';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS, MAX_ROUTE_DECOMPRESSED_BYTES, MAX_ROUTE_DECOMPRESSED_BYTES_LABEL, MAX_ROUTE_UPLOAD_BYTES } from '../shared/route-processing-config';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';
import { ROUTE_USAGE_LIMITS } from '../../../shared/limits';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

const SUPPORTED_BASE_EXTENSIONS = new Set(['fit', 'gpx']);
const MAX_ROUTE_GZIP_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ROUTE_GZIP_DECOMPRESSED_BYTES_LABEL = '64MB';

type SportsLibRouteImporter = typeof SportsLib & {
  importRoutesFromGPX(gpxString: string, domParser?: unknown, options?: RouteParsingOptionsLike): Promise<AppRouteInterface>;
  importRoutesFromFit(arrayBuffer: ArrayBuffer, options?: RouteParsingOptionsLike): Promise<AppRouteInterface>;
};

class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

class RouteQuotaReconciliationRequiredError extends Error {
  constructor(
    public readonly counterRouteCount: number,
    public readonly uploadLimit: number,
    public readonly counterVersion: string | null,
  ) {
    super(`Route quota counter needs reconciliation before rejecting at ${counterRouteCount}/${uploadLimit}.`);
    this.name = 'RouteQuotaReconciliationRequiredError';
  }
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function decodeText(data: Buffer): string {
  return new TextDecoder().decode(toArrayBuffer(data));
}

function hasGzipMagic(data: Buffer): boolean {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b;
}

function shouldDecompressPayloadForParsing(payload: Buffer, resolvedExtension: string): boolean {
  return resolvedExtension.endsWith('.gz') || hasGzipMagic(payload);
}

function normalizeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  return normalized.startsWith('.') ? normalized.slice(1) : normalized;
}

function getBaseExtension(extension: string): string {
  return extension.endsWith('.gz') ? extension.slice(0, -3) : extension;
}

function resolveExtensionFromFilename(filename?: string): string | null {
  if (!filename) {
    return null;
  }

  const name = basename(filename).toLowerCase().trim();
  if (!name.includes('.')) {
    return null;
  }

  const parts = name.split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const ext = parts[parts.length - 1];
  if (ext === 'gz' && parts.length >= 3) {
    return `${parts[parts.length - 2]}.gz`;
  }
  return ext;
}

function resolveUploadExtension(
  extensionHeader?: string,
  originalFilenameHeader?: string,
): string {
  const fromHeader = extensionHeader ? normalizeExtension(extensionHeader) : '';
  const fromFilename = resolveExtensionFromFilename(originalFilenameHeader);
  const resolved = fromHeader || (fromFilename ? normalizeExtension(fromFilename) : '');

  if (!resolved) {
    throw new HttpStatusError(400, 'File extension is required.');
  }

  const baseExtension = getBaseExtension(resolved);
  if (!SUPPORTED_BASE_EXTENSIONS.has(baseExtension)) {
    throw new HttpStatusError(400, `Unsupported route file extension: ${baseExtension}. Supported: fit, gpx.`);
  }

  if (resolved.endsWith('.gz')) {
    return `${baseExtension}.gz`;
  }
  return baseExtension;
}

function resolveStoredExtension(resolvedExtension: string, payload: Buffer): string {
  const baseExtension = getBaseExtension(resolvedExtension);
  if (resolvedExtension.endsWith('.gz')) {
    return `${baseExtension}.gz`;
  }

  if (hasGzipMagic(payload)) {
    return `${baseExtension}.gz`;
  }
  return baseExtension;
}

function resolveMaxRouteDecompressedBytes(): number {
  return Math.min(
    MAX_ROUTE_DECOMPRESSED_BYTES,
    MAX_ROUTE_GZIP_DECOMPRESSED_BYTES,
  );
}

function resolveRouteDecompressedBytesLabel(maxOutputLength: number): string {
  if (maxOutputLength === MAX_ROUTE_DECOMPRESSED_BYTES) {
    return MAX_ROUTE_DECOMPRESSED_BYTES_LABEL;
  }
  if (maxOutputLength === MAX_ROUTE_GZIP_DECOMPRESSED_BYTES) {
    return MAX_ROUTE_GZIP_DECOMPRESSED_BYTES_LABEL;
  }
  return `${Math.floor(maxOutputLength / 1024)}KB`;
}

function maybeDecompressPayloadForParsing(payload: Buffer, resolvedExtension: string): Buffer {
  if (!shouldDecompressPayloadForParsing(payload, resolvedExtension)) {
    return payload;
  }

  const maxOutputLength = resolveMaxRouteDecompressedBytes();
  try {
    return gunzipSync(payload, { maxOutputLength });
  } catch (error) {
    logger.warn('[uploadRoute] Gzip decompression failed', {
      error,
      compressedBytes: payload.length,
      maxDecompressedBytes: maxOutputLength,
      maxConfiguredDecompressedBytes: MAX_ROUTE_DECOMPRESSED_BYTES,
      maxGzipDecompressedBytes: MAX_ROUTE_GZIP_DECOMPRESSED_BYTES,
      resolvedExtension,
    });
    if ((error as { code?: unknown } | undefined)?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new HttpStatusError(
        400,
        `Route file is too large after decompression. Maximum decompressed size is ${resolveRouteDecompressedBytesLabel(maxOutputLength)} for this upload.`,
      );
    }
    throw new HttpStatusError(400, 'Could not decompress uploaded route payload.');
  }
}

function resolveRouteNameFromHeader(originalFilenameHeader?: string): string | null {
  if (!originalFilenameHeader) {
    return null;
  }

  const baseName = basename(originalFilenameHeader).trim();
  if (!baseName) {
    return null;
  }

  const noExtension = baseName.replace(/\.(fit|gpx)(\.gz)?$/i, '').trim();
  return noExtension || null;
}

function resolveOriginalFilename(
  encodedOriginalFilenameHeader?: string,
  originalFilenameHeader?: string,
): string | undefined {
  const trimmedEncodedHeader = encodedOriginalFilenameHeader?.trim();
  if (trimmedEncodedHeader) {
    try {
      const decodedFilename = decodeURIComponent(trimmedEncodedHeader).trim();
      if (decodedFilename) {
        return decodedFilename;
      }
    } catch (error) {
      logger.warn('[uploadRoute] Failed to decode original filename header', error);
    }
  }

  const trimmedOriginalFilename = originalFilenameHeader?.trim();
  return trimmedOriginalFilename || undefined;
}

async function verifyFirebaseUserIDFromAuthorizationHeader(
  authorizationHeader?: string,
): Promise<string> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new HttpStatusError(401, 'Missing or invalid Authorization header.');
  }

  const token = authorizationHeader.substring('Bearer '.length).trim();
  if (!token) {
    throw new HttpStatusError(401, 'Missing Firebase ID token.');
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token, true);
    return decodedToken.uid;
  } catch (error) {
    logger.warn('[uploadRoute] Firebase ID token verification failed', error);
    const authErrorCode = (error as { code?: string } | undefined)?.code;
    if (authErrorCode === 'auth/id-token-revoked' || authErrorCode === 'auth/user-disabled') {
      throw new HttpStatusError(401, 'Session expired. Please sign in again.');
    }
    throw new HttpStatusError(401, 'Unauthenticated request.');
  }
}

async function verifyAppCheckHeader(appCheckHeader?: string): Promise<void> {
  if (!ENFORCE_APP_CHECK) {
    return;
  }

  if (!appCheckHeader) {
    throw new HttpStatusError(401, 'Missing App Check token.');
  }

  try {
    await admin.appCheck().verifyToken(appCheckHeader);
  } catch (error) {
    logger.warn('[uploadRoute] App Check verification failed', error);
    throw new HttpStatusError(401, 'Invalid App Check token.');
  }
}

async function resolveUploadLimitForUser(userID: string): Promise<number | null> {
  if (await hasProAccess(userID)) {
    return null;
  }
  if (await hasBasicAccess(userID)) {
    return ROUTE_USAGE_LIMITS.basic;
  }
  return ROUTE_USAGE_LIMITS.free;
}

async function getRouteCountForUser(userID: string): Promise<number> {
  const countSnapshot = await admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('routes')
    .count()
    .get();
  return countSnapshot.data().count;
}

function getRouteImporter(): SportsLibRouteImporter {
  const routeImporter = SportsLib as SportsLibRouteImporter;
  if (typeof routeImporter.importRoutesFromFit !== 'function' || typeof routeImporter.importRoutesFromGPX !== 'function') {
    throw new HttpStatusError(500, 'Route parsing is not available in the installed sports-lib version.');
  }
  return routeImporter;
}

async function parseUploadedRoute(payload: Buffer, resolvedExtension: string): Promise<AppRouteInterface> {
  const parsingOptions = createRouteParsingOptions();
  const baseExtension = getBaseExtension(resolvedExtension);
  const routeImporter = getRouteImporter();

  if (baseExtension === 'fit') {
    return routeImporter.importRoutesFromFit(toArrayBuffer(payload), parsingOptions);
  }

  if (baseExtension === 'gpx') {
    return routeImporter.importRoutesFromGPX(decodeText(payload), xmldom.DOMParser, parsingOptions);
  }

  throw new HttpStatusError(400, `Unsupported route file extension: ${baseExtension}.`);
}

function generateUploadRouteID(userID: string, payload: Buffer, resolvedExtension: string): string {
  const baseExtension = getBaseExtension(resolvedExtension);

  return createHash('sha256')
    .update(baseExtension)
    .update(':')
    .update(userID)
    .update(':')
    .update(payload)
    .digest('hex');
}

function generateRouteSegmentID(routeID: string, routeIndex: number): string {
  return createHash('sha256')
    .update(routeID)
    .update(':route:')
    .update(`${routeIndex}`)
    .digest('hex');
}

function assignRouteSegmentIDs(routeFile: AppRouteInterface, routeID: string): void {
  const routes = routeFile.getRoutes();
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i] as AppRouteSegmentInterface;
    if (!route.getID?.() && typeof route.setID === 'function') {
      route.setID(generateRouteSegmentID(routeID, i));
    }
  }
}

function createProcessingMetadataPayload(): ProcessingMetaData {
  return {
    sportsLibVersion: SPORTS_LIB_VERSION,
    sportsLibVersionCode: sportsLibVersionToCode(SPORTS_LIB_VERSION),
    processedAt: FieldValue.serverTimestamp(),
  };
}

function normalizeRouteCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function readRouteCountCounter(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function buildRouteLimitError(currentRouteCount: number, uploadLimit: number): HttpStatusError {
  return new HttpStatusError(429, `Upload limit reached for your tier. You have ${currentRouteCount} routes. Limit is ${uploadLimit}.`);
}

function buildAccountDeletionError(): HttpStatusError {
  return new HttpStatusError(410, 'Account is being deleted or no longer exists.');
}

function getCounterSnapshotVersion(snapshot: admin.firestore.DocumentSnapshot): string | null {
  const updateTime = snapshot.updateTime;
  if (!updateTime) {
    return null;
  }

  const structuredTime = updateTime as { seconds?: unknown; nanoseconds?: unknown };
  if (typeof structuredTime.seconds === 'number' && typeof structuredTime.nanoseconds === 'number') {
    return `${structuredTime.seconds}:${structuredTime.nanoseconds}`;
  }

  if (typeof updateTime.toMillis === 'function') {
    return `${updateTime.toMillis()}`;
  }

  return null;
}

function getRouteQuotaCounterPath(userID: string): string {
  return `users/${userID}/metaData/routeQuota`;
}

async function getInitialRouteCountForMissingOrInvalidCounter(
  userID: string,
  counterRef: admin.firestore.DocumentReference,
): Promise<number | null> {
  const counterSnapshot = await counterRef.get();
  if (counterSnapshot.exists && readRouteCountCounter(counterSnapshot.data()?.routeCount) !== null) {
    return null;
  }
  return getRouteCountForUser(userID);
}

async function assertRouteUploadUserActive(userID: string, phase: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, phase, error);
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn('[uploadRoute] Skipping route upload because user is missing or deletion is in progress.', {
    userID,
    phase,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw buildAccountDeletionError();
}

async function assertRouteUploadUserActiveInTransaction(
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

  logger.warn('[uploadRoute] Skipping route upload write because user is missing or deletion is in progress.', {
    userID,
    phase,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw buildAccountDeletionError();
}

function buildOriginalRouteFileMetadata(
  userID: string,
  routeID: string,
  originalFile: OriginalRouteFile,
  bucketName?: string,
  uploadAttemptID = randomUUID(),
): OriginalRouteFileMetaData {
  const metadata: OriginalRouteFileMetaData = {
    path: `users/${userID}/routes/${routeID}/uploads/${uploadAttemptID}/original.${originalFile.extension}`,
    startDate: originalFile.startDate,
    extension: originalFile.extension,
  };

  if (bucketName) {
    metadata.bucket = bucketName;
  }
  if (originalFile.originalFilename) {
    metadata.originalFilename = originalFile.originalFilename;
  }

  return metadata;
}

async function uploadOriginalRouteFile(
  userID: string,
  routeID: string,
  originalFile: OriginalRouteFile,
): Promise<OriginalRouteFileMetaData> {
  const bucket = admin.storage().bucket();
  const metadata = buildOriginalRouteFileMetadata(userID, routeID, originalFile, bucket.name);
  await bucket.file(metadata.path).save(originalFile.data as Buffer);
  return metadata;
}

async function deleteUploadedOriginalRouteFile(metadata: OriginalRouteFileMetaData): Promise<void> {
  try {
    await admin.storage().bucket().file(metadata.path).delete({ ignoreNotFound: true });
  } catch (error) {
    logger.warn('[uploadRoute] Failed to remove uncommitted route original file', {
      path: metadata.path,
      bucket: metadata.bucket,
      error,
    });
  }
}

interface RouteQuotaWriteResult {
  duplicate: boolean;
  routesCount: number;
  routeCountAfterWrite: number;
}

interface RouteQuotaReconciliation {
  routeCount: number;
  counterVersion: string;
}

interface RouteQuotaPreExpansionResult {
  routeID: string | null;
  reconciliation: RouteQuotaReconciliation | null;
}

interface DuplicateRouteUploadResult {
  routesCount: number;
  routeCountAfterWrite: number | null;
}

function readRouteSegmentCountFromSnapshot(snapshot: admin.firestore.DocumentSnapshot): number {
  const data = snapshot.data();
  const routeCount = normalizeRouteCount(data?.routeCount);
  if (routeCount > 0) {
    return routeCount;
  }
  return Array.isArray(data?.routes) ? data.routes.length : 0;
}

async function preflightDuplicateRouteUpload(
  userID: string,
  routeID: string,
): Promise<DuplicateRouteUploadResult | null> {
  const db = admin.firestore();
  const routeRef = db.doc(`users/${userID}/routes/${routeID}`);
  const counterRef = db.doc(getRouteQuotaCounterPath(userID));
  const [routeSnapshot, counterSnapshot] = await Promise.all([
    routeRef.get(),
    counterRef.get(),
  ]);

  if (!routeSnapshot.exists) {
    return null;
  }

  const counterRouteCount = counterSnapshot.exists
    ? readRouteCountCounter(counterSnapshot.data()?.routeCount)
    : null;

  return {
    routesCount: readRouteSegmentCountFromSnapshot(routeSnapshot),
    routeCountAfterWrite: counterRouteCount !== null ? counterRouteCount : await getRouteCountForUser(userID),
  };
}

async function preflightCompressedRouteQuotaBeforeExpansion(
  userID: string,
  uploadLimit: number | null,
): Promise<void> {
  if (uploadLimit === null) {
    return;
  }

  const counterSnapshot = await admin.firestore().doc(getRouteQuotaCounterPath(userID)).get();
  const counterRouteCount = counterSnapshot.exists
    ? readRouteCountCounter(counterSnapshot.data()?.routeCount)
    : null;

  if (counterRouteCount !== null && counterRouteCount < uploadLimit) {
    return;
  }

  logger.info('[uploadRoute] Deferring compressed route quota rejection until duplicate-aware preflight', {
    userID,
    uploadLimit,
    counterRouteCount,
  });
}

async function preflightRouteQuotaBeforeExpansion(
  userID: string,
  payload: Buffer,
  resolvedExtension: string,
  uploadLimit: number | null,
): Promise<RouteQuotaPreExpansionResult> {
  if (shouldDecompressPayloadForParsing(payload, resolvedExtension)) {
    await preflightCompressedRouteQuotaBeforeExpansion(userID, uploadLimit);
    return {
      routeID: null,
      reconciliation: null,
    };
  }

  const routeID = generateUploadRouteID(userID, payload, resolvedExtension);
  return {
    routeID,
    reconciliation: await preflightRouteQuotaReservation(userID, routeID, uploadLimit),
  };
}

async function preflightRouteQuotaReservation(
  userID: string,
  routeID: string,
  uploadLimit: number | null,
): Promise<RouteQuotaReconciliation | null> {
  if (uploadLimit === null) {
    return null;
  }

  const db = admin.firestore();
  const routeRef = db.doc(`users/${userID}/routes/${routeID}`);
  const counterRef = db.doc(getRouteQuotaCounterPath(userID));
  const [routeSnapshot, counterSnapshot] = await Promise.all([
    routeRef.get(),
    counterRef.get(),
  ]);

  if (routeSnapshot.exists) {
    return null;
  }

  const counterRouteCount = counterSnapshot.exists
    ? readRouteCountCounter(counterSnapshot.data()?.routeCount)
    : null;
  if (counterRouteCount !== null && counterRouteCount < uploadLimit) {
    return null;
  }

  const authoritativeRouteCount = await getRouteCountForUser(userID);
  if (authoritativeRouteCount >= uploadLimit) {
    throw buildRouteLimitError(authoritativeRouteCount, uploadLimit);
  }

  if (counterRouteCount === null || !counterSnapshot.exists) {
    return null;
  }

  const counterVersion = getCounterSnapshotVersion(counterSnapshot);
  if (!counterVersion) {
    return null;
  }

  return {
    routeCount: authoritativeRouteCount,
    counterVersion,
  };
}

async function writeRouteWithQuotaReservation(
  userID: string,
  routeFile: AppRouteInterface,
  originalFileMetadata: OriginalRouteFileMetaData,
  uploadLimit: number | null,
  initialReconciliation: RouteQuotaReconciliation | null = null,
): Promise<RouteQuotaWriteResult> {
  const routeID = routeFile.getID();
  if (!routeID) {
    throw new Error('Route ID is required before writing route data.');
  }

  const db = admin.firestore();
  const routeRef = db.doc(`users/${userID}/routes/${routeID}`);
  const counterRef = db.doc(getRouteQuotaCounterPath(userID));
  const processingRef = db.doc(`users/${userID}/routes/${routeID}/metaData/processing`);
  const initialRouteCount = await getInitialRouteCountForMissingOrInvalidCounter(userID, counterRef);
  const routePayload: FirestoreRouteJSON = {
    ...buildFirestoreRoutePayload(userID, routeFile),
    originalFile: originalFileMetadata,
    originalFiles: [originalFileMetadata],
  };

  let reconciliation: RouteQuotaReconciliation | null = initialReconciliation;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.runTransaction(async (transaction) => {
        await assertRouteUploadUserActiveInTransaction(db, transaction, userID, 'route_upload_write');

        const [routeSnapshot, counterSnapshot] = await Promise.all([
          transaction.get(routeRef),
          transaction.get(counterRef),
        ]);
        const routeAlreadyExists = routeSnapshot.exists;
        const counterRouteCount = counterSnapshot.exists
          ? readRouteCountCounter(counterSnapshot.data()?.routeCount)
          : null;

        if (counterRouteCount === null && initialRouteCount === null) {
          throw new Error(`Route quota counter was removed or invalidated while writing ${routeID}.`);
        }

        let currentRouteCount = counterRouteCount !== null
          ? counterRouteCount
          : normalizeRouteCount(initialRouteCount);
        let routeCountBeforeReconcile: number | null = null;
        let reconciledRouteCount: number | null = null;

        if (uploadLimit !== null && currentRouteCount >= uploadLimit && !routeAlreadyExists) {
          const counterVersion = counterSnapshot.exists ? getCounterSnapshotVersion(counterSnapshot) : null;
          if (
            reconciliation
            && counterVersion !== null
            && reconciliation.counterVersion === counterVersion
            && reconciliation.routeCount < currentRouteCount
          ) {
            routeCountBeforeReconcile = currentRouteCount;
            reconciledRouteCount = normalizeRouteCount(reconciliation.routeCount);
            currentRouteCount = reconciledRouteCount;
          } else {
            throw new RouteQuotaReconciliationRequiredError(currentRouteCount, uploadLimit, counterVersion);
          }
        }

        if (uploadLimit !== null && currentRouteCount >= uploadLimit && !routeAlreadyExists) {
          throw buildRouteLimitError(currentRouteCount, uploadLimit);
        }

        const routeCountAfterWrite = routeAlreadyExists ? currentRouteCount : currentRouteCount + 1;
        const serverTimestamp = FieldValue.serverTimestamp();
        const counterPayload: Record<string, unknown> = {
          routeCount: routeCountAfterWrite,
          updatedAt: serverTimestamp,
        };
        if (!counterSnapshot.exists) {
          counterPayload.initializedAt = serverTimestamp;
        }
        if (counterSnapshot.exists && counterRouteCount === null) {
          counterPayload.repairedAt = serverTimestamp;
        }
        if (routeCountBeforeReconcile !== null && reconciledRouteCount !== null) {
          counterPayload.reconciledAt = serverTimestamp;
          counterPayload.reconciledFromRouteCount = routeCountBeforeReconcile;
          counterPayload.reconciledActualRouteCount = reconciledRouteCount;
        }

        if (!routeAlreadyExists) {
          transaction.set(routeRef, routePayload);
          transaction.set(processingRef, createProcessingMetadataPayload(), { merge: true });
        }
        transaction.set(counterRef, counterPayload, { merge: true });

        const routesCount = routeAlreadyExists
          ? readRouteSegmentCountFromSnapshot(routeSnapshot)
          : routeFile.getRoutes().length;

        return {
          duplicate: routeAlreadyExists,
          routesCount,
          routeCountAfterWrite,
        };
      });
    } catch (error) {
      if (!(error instanceof RouteQuotaReconciliationRequiredError)) {
        throw error;
      }

      if (!error.counterVersion) {
        throw buildRouteLimitError(error.counterRouteCount, error.uploadLimit);
      }

      const authoritativeRouteCount = await getRouteCountForUser(userID);
      if (authoritativeRouteCount >= error.uploadLimit) {
        throw buildRouteLimitError(authoritativeRouteCount, error.uploadLimit);
      }

      reconciliation = {
        routeCount: authoritativeRouteCount,
        counterVersion: error.counterVersion,
      };
    }
  }

  throw new HttpStatusError(409, 'Route quota changed while uploading. Please retry.');
}

export const uploadRoute = onRequest({
  region: FUNCTIONS_MANIFEST.uploadRoute.region,
  ...ROUTE_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    return;
  }

  try {
    const userID = await verifyFirebaseUserIDFromAuthorizationHeader(request.header('authorization'));
    await verifyAppCheckHeader(request.header('X-Firebase-AppCheck') || request.header('x-firebase-appcheck'));
    const originalFilename = resolveOriginalFilename(
      request.header('X-Original-Filename-Encoded') || request.header('x-original-filename-encoded') || undefined,
      request.header('X-Original-Filename') || request.header('x-original-filename') || undefined,
    );
    const resolvedExtension = resolveUploadExtension(
      request.header('X-File-Extension') || request.header('x-file-extension') || undefined,
      originalFilename,
    );

    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new HttpStatusError(400, 'Route file payload is empty.');
    }

    if (rawBody.length > MAX_ROUTE_UPLOAD_BYTES) {
      throw new HttpStatusError(400, `Route file is too large (${(rawBody.length / 1024 / 1024).toFixed(1)}MB). Maximum size is 20MB.`);
    }

    await assertRouteUploadUserActive(userID, 'route_upload_before_decompression');
    const uploadLimit = await resolveUploadLimitForUser(userID);
    const preExpansionPreflight = await preflightRouteQuotaBeforeExpansion(
      userID,
      rawBody,
      resolvedExtension,
      uploadLimit,
    );
    const payloadForParsing = maybeDecompressPayloadForParsing(rawBody, resolvedExtension);
    const routeID = preExpansionPreflight.routeID || generateUploadRouteID(userID, payloadForParsing, resolvedExtension);
    const duplicateRouteUpload = await preflightDuplicateRouteUpload(userID, routeID);
    if (duplicateRouteUpload) {
      response.status(200).json({
        routeId: routeID,
        routesCount: duplicateRouteUpload.routesCount,
        routeCount: duplicateRouteUpload.routesCount,
        duplicate: true,
        uploadLimit,
        uploadCountAfterWrite: duplicateRouteUpload.routeCountAfterWrite,
      });
      return;
    }
    const preflightReconciliation = preExpansionPreflight.routeID
      ? preExpansionPreflight.reconciliation
      : await preflightRouteQuotaReservation(userID, routeID, uploadLimit);

    let routeFile: AppRouteInterface;
    try {
      routeFile = await parseUploadedRoute(payloadForParsing, resolvedExtension);
    } catch (error) {
      if (error instanceof HttpStatusError) {
        throw error;
      }
      logger.warn('[uploadRoute] Route parsing failed', error);
      throw new HttpStatusError(400, 'Could not parse uploaded route payload.');
    }

    if (!routeFile.hasRoutes()) {
      throw new HttpStatusError(400, 'No routes were found in the uploaded file.');
    }

    routeFile.setID(routeID);
    const resolvedRouteName = resolveRouteNameFromHeader(originalFilename);
    if (resolvedRouteName) {
      routeFile.name = resolvedRouteName;
    }
    if (!routeFile.createdAt) {
      routeFile.createdAt = new Date();
    }
    assignRouteSegmentIDs(routeFile, routeID);

    const originalFile: OriginalRouteFile = {
      data: rawBody,
      extension: resolveStoredExtension(resolvedExtension, rawBody),
      startDate: routeFile.createdAt || new Date(),
      originalFilename,
    };

    const originalFileMetadata = await uploadOriginalRouteFile(userID, routeID, originalFile);
    let quotaWriteResult: RouteQuotaWriteResult;
    try {
      quotaWriteResult = await writeRouteWithQuotaReservation(
        userID,
        routeFile,
        originalFileMetadata,
        uploadLimit,
        preflightReconciliation,
      );
    } catch (error) {
      await deleteUploadedOriginalRouteFile(originalFileMetadata);
      throw error;
    }
    if (quotaWriteResult.duplicate) {
      await deleteUploadedOriginalRouteFile(originalFileMetadata);
    }

    response.status(200).json({
      routeId: routeID,
      routesCount: quotaWriteResult.routesCount,
      routeCount: quotaWriteResult.routesCount,
      duplicate: quotaWriteResult.duplicate,
      uploadLimit,
      uploadCountAfterWrite: quotaWriteResult.routeCountAfterWrite,
    });
  } catch (error) {
    if (error instanceof HttpStatusError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    if (error instanceof UserDeletionGuardReadError) {
      response.status(error.statusCode).json({ error: 'Could not verify account state. Please retry.' });
      return;
    }

    logger.error('[uploadRoute] Upload failed', error);
    response.status(500).json({ error: 'Could not upload route.' });
  }
});
