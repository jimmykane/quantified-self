import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as xmldom from 'xmldom';
import {
  EventImporterFIT,
  EventImporterGPX,
  EventImporterTCX,
  EventInterface,
  EventUtilities,
} from '@sports-alliance/sports-lib';

import { ALLOWED_CORS_ORIGINS, ENFORCE_APP_CHECK, hasBasicAccess, hasProAccess } from '../utils';
import { createParsingOptions } from '../../../shared/parsing-options';
import { EventWriter, FirestoreAdapter, OriginalFile, StorageAdapter } from '../shared/event-writer';
import { generateActivityID } from '../shared/id-generator';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';
import { USAGE_LIMITS } from '../../../shared/limits';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import {
  ACTIVITY_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  MAX_ACTIVITY_DECOMPRESSED_BYTES,
  MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL,
  MAX_ACTIVITY_UPLOAD_BYTES,
} from '../shared/activity-processing-config';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';

const FILE_MANIFEST_HEADER = 'X-Tool-Comparison-Files-Encoded';
const TITLE_HEADER = 'X-Tool-Comparison-Title-Encoded';
const SUPPORTED_BASE_EXTENSIONS = new Set(['fit', 'gpx', 'tcx']);
const MIN_COMPARISON_FILES = 2;
const MAX_COMPARISON_FILES = 10;
const MAX_TOOL_COMPARISON_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_TOOL_COMPARISON_DECOMPRESSED_BYTES = MAX_ACTIVITY_DECOMPRESSED_BYTES;
const MAX_FILE_MANIFEST_HEADER_BYTES = 16 * 1024;
const MAX_TITLE_HEADER_BYTES = 1024;
const MAX_ORIGINAL_FILENAME_LENGTH = 240;
const MAX_COMPARISON_TITLE_LENGTH = 120;
const GENERATED_MERGE_DESCRIPTION_PREFIX = 'a merge of 2 or more activit';
const DUPLICATE_FILE_CONTENT_MESSAGE = 'Selected files include identical file content. Remove duplicates and try again.';

interface ToolComparisonManifestFile {
  originalFilename?: unknown;
  extension?: unknown;
  byteLength?: unknown;
}

interface NormalizedComparisonFile {
  originalFilename?: string;
  extension: string;
  baseExtension: string;
  byteLength: number;
  startOffset: number;
  endOffset: number;
}

interface ParsedComparisonFile {
  event: EventInterface;
  originalFile: OriginalFile;
}

interface PreparedComparisonFile {
  file: NormalizedComparisonFile;
  rawBytes: Buffer;
  payloadForParsing: Buffer;
  contentHash: string;
}

interface ExistingComparisonEventData {
  exists: boolean;
  isBenchmarkComparison: boolean;
  isMerge: boolean;
  mergeType: string | null;
  toolSource: string | null;
  comparisonTitle: string | null;
  sourceFilesCount: number | null;
  activitiesCount: number | null;
  originalFilesCount: number;
  hasProcessingMetadata: boolean;
}

interface ExistingComparisonRepairResult {
  comparisonEvent: ExistingComparisonEventData;
  needsRewrite: boolean;
}

class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
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

  const name = sanitizeOriginalFilename(filename)?.toLowerCase().trim();
  if (!name || !name.includes('.')) {
    return null;
  }

  const parts = name.split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const extension = parts[parts.length - 1];
  if (extension === 'gz' && parts.length >= 3) {
    return `${parts[parts.length - 2]}.gz`;
  }
  return extension;
}

function resolveComparisonExtension(extensionHeader?: string, originalFilename?: string): string {
  const fromHeader = extensionHeader ? normalizeExtension(extensionHeader) : '';
  const fromFilename = resolveExtensionFromFilename(originalFilename);
  const resolved = fromHeader || (fromFilename ? normalizeExtension(fromFilename) : '');

  if (!resolved) {
    throw new HttpStatusError(400, 'File extension is required.');
  }

  const baseExtension = getBaseExtension(resolved);
  if (!SUPPORTED_BASE_EXTENSIONS.has(baseExtension)) {
    throw new HttpStatusError(400, `Unsupported file extension: ${baseExtension}. Supported: fit, gpx, tcx.`);
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

function maybeDecompressPayloadForParsing(payload: Buffer, resolvedExtension: string): Buffer {
  const shouldDecompress = resolvedExtension.endsWith('.gz') || hasGzipMagic(payload);

  if (!shouldDecompress) {
    return payload;
  }

  try {
    return gunzipSync(payload, { maxOutputLength: MAX_ACTIVITY_DECOMPRESSED_BYTES });
  } catch (error) {
    logger.warn('[createToolComparisonEvent] Gzip decompression failed', {
      error,
      compressedBytes: payload.length,
      maxDecompressedBytes: MAX_ACTIVITY_DECOMPRESSED_BYTES,
      resolvedExtension,
    });
    if ((error as { code?: unknown } | undefined)?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new HttpStatusError(
        400,
        `File is too large after decompression. Maximum decompressed size is ${MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL}.`,
      );
    }
    throw new HttpStatusError(400, 'Could not decompress uploaded payload.');
  }
}

function sanitizeOriginalFilename(filename?: string): string | undefined {
  const trimmed = `${filename || ''}`.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalizedSeparators = trimmed.replace(/\\/g, '/');
  const baseName = basename(normalizedSeparators).trim();
  if (!baseName) {
    return undefined;
  }

  return baseName.slice(0, MAX_ORIGINAL_FILENAME_LENGTH);
}

function stripComparisonFileExtension(filename: string): string {
  return filename.replace(/\.(fit|gpx|tcx)(\.gz)?$/i, '').trim();
}

function decodeOptionalHeaderValue(encodedValue?: string): string | undefined {
  const trimmed = encodedValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (Buffer.byteLength(trimmed, 'utf8') > MAX_TITLE_HEADER_BYTES) {
    throw new HttpStatusError(400, 'Encoded request header is too large.');
  }

  try {
    return decodeURIComponent(trimmed).trim() || undefined;
  } catch (error) {
    logger.warn('[createToolComparisonEvent] Failed to decode header value', error);
    throw new HttpStatusError(400, 'Encoded request header is invalid.');
  }
}

function getRequestHeader(request: { header: (name: string) => string | undefined }, name: string): string | undefined {
  return request.header(name) || request.header(name.toLowerCase()) || undefined;
}

function parseFileManifest(encodedManifest?: string): ToolComparisonManifestFile[] {
  const trimmedManifest = encodedManifest?.trim();
  if (!trimmedManifest) {
    throw new HttpStatusError(400, `${FILE_MANIFEST_HEADER} header is required.`);
  }

  if (Buffer.byteLength(trimmedManifest, 'utf8') > MAX_FILE_MANIFEST_HEADER_BYTES) {
    throw new HttpStatusError(400, 'File manifest header is too large.');
  }

  let decodedManifest: string;
  try {
    decodedManifest = decodeURIComponent(trimmedManifest);
  } catch (error) {
    logger.warn('[createToolComparisonEvent] Failed to decode file manifest header', error);
    throw new HttpStatusError(400, 'File manifest header is invalid.');
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(decodedManifest);
  } catch (error) {
    logger.warn('[createToolComparisonEvent] Failed to parse file manifest JSON', error);
    throw new HttpStatusError(400, 'File manifest header is invalid JSON.');
  }

  if (!Array.isArray(parsedManifest)) {
    throw new HttpStatusError(400, 'File manifest must be an array.');
  }

  if (parsedManifest.length < MIN_COMPARISON_FILES) {
    throw new HttpStatusError(400, `At least ${MIN_COMPARISON_FILES} files are required for comparison.`);
  }

  if (parsedManifest.length > MAX_COMPARISON_FILES) {
    throw new HttpStatusError(400, `You can compare up to ${MAX_COMPARISON_FILES} files at once.`);
  }

  return parsedManifest as ToolComparisonManifestFile[];
}

function normalizeManifestFiles(
  manifestFiles: ToolComparisonManifestFile[],
  rawBodyLength: number,
): NormalizedComparisonFile[] {
  let currentOffset = 0;
  const normalizedFiles = manifestFiles.map((file, index) => {
    const byteLength = file?.byteLength;
    if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength <= 0) {
      throw new HttpStatusError(400, `File ${index + 1} has an invalid byte length.`);
    }
    if (byteLength > MAX_ACTIVITY_UPLOAD_BYTES) {
      throw new HttpStatusError(
        400,
        `File ${index + 1} is too large (${(byteLength / 1024 / 1024).toFixed(1)}MB). Maximum file size is 20MB.`,
      );
    }

    const originalFilename = sanitizeOriginalFilename(
      typeof file?.originalFilename === 'string' ? file.originalFilename : undefined,
    );
    const extension = resolveComparisonExtension(
      typeof file?.extension === 'string' ? file.extension : undefined,
      originalFilename,
    );
    const startOffset = currentOffset;
    const endOffset = startOffset + byteLength;
    currentOffset = endOffset;

    return {
      originalFilename,
      extension,
      baseExtension: getBaseExtension(extension),
      byteLength,
      startOffset,
      endOffset,
    };
  });

  if (currentOffset !== rawBodyLength) {
    throw new HttpStatusError(400, 'File manifest byte lengths do not match request payload.');
  }

  if (currentOffset > MAX_TOOL_COMPARISON_UPLOAD_BYTES) {
    throw new HttpStatusError(
      400,
      `Combined file payload is too large (${(currentOffset / 1024 / 1024).toFixed(1)}MB). Maximum combined size is 30MB.`,
    );
  }

  return normalizedFiles;
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
    logger.warn('[createToolComparisonEvent] Firebase ID token verification failed', error);
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
    logger.warn('[createToolComparisonEvent] App Check verification failed', error);
    throw new HttpStatusError(401, 'Invalid App Check token.');
  }
}

async function assertComparisonWriteAllowedForUser(userID: string): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    logger.error('[createToolComparisonEvent] Failed to read user deletion guard before comparison write', {
      userID,
      error: serializeError(error),
    });
    throw new HttpStatusError(503, 'Could not verify account state. Please try again shortly.');
  }

  if (!deletionGuard.shouldSkip) {
    return;
  }

  logger.warn('[createToolComparisonEvent] Skipping comparison write because user is missing or deletion is in progress', {
    userID,
    userExists: deletionGuard.userExists,
    deletionInProgress: deletionGuard.deletionInProgress,
  });
  throw new HttpStatusError(409, 'Account deletion is in progress. Please sign in again.');
}

async function resolveUploadLimitForUser(userID: string): Promise<number | null> {
  if (await hasProAccess(userID)) {
    return null;
  }
  if (await hasBasicAccess(userID)) {
    return USAGE_LIMITS.basic;
  }
  return USAGE_LIMITS.free;
}

async function getEventCountForUser(userID: string): Promise<number> {
  const countSnapshot = await admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('events')
    .count()
    .get();
  return countSnapshot.data().count;
}

function getNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasUsableOriginalFileStartDate(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value === 'string') {
    return !!value.trim() && !Number.isNaN(Date.parse(value));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeTimestamp = value as { seconds?: unknown; toDate?: unknown };
  if (typeof maybeTimestamp.toDate === 'function') {
    return true;
  }

  return typeof maybeTimestamp.seconds === 'number' && Number.isFinite(maybeTimestamp.seconds);
}

function hasUsableOriginalFileMetadata(value: unknown): boolean {
  return !!value
    && typeof value === 'object'
    && typeof (value as { path?: unknown }).path === 'string'
    && !!(value as { path: string }).path.trim()
    && hasUsableOriginalFileStartDate((value as { startDate?: unknown }).startDate);
}

function countUsableOriginalFileMetadata(data: Record<string, unknown> | undefined): number {
  const originalFiles = data?.originalFiles;
  if (Array.isArray(originalFiles)) {
    return originalFiles.filter(hasUsableOriginalFileMetadata).length;
  }

  return hasUsableOriginalFileMetadata(data?.originalFile) ? 1 : 0;
}

async function getExistingComparisonEventData(
  userID: string,
  eventID: string,
): Promise<ExistingComparisonEventData> {
  const snapshot = await admin.firestore()
    .doc(`users/${userID}/events/${eventID}`)
    .get();

  if (!snapshot.exists) {
    return {
      exists: false,
      isBenchmarkComparison: false,
      isMerge: false,
      mergeType: null,
      toolSource: null,
      comparisonTitle: null,
      sourceFilesCount: null,
      activitiesCount: null,
      originalFilesCount: 0,
      hasProcessingMetadata: false,
    };
  }

  const processingMetadataSnapshot = await admin.firestore()
    .doc(`users/${userID}/events/${eventID}/metaData/processing`)
    .get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const mergeType = getOptionalString(data?.mergeType);
  const isMerge = data?.isMerge === true;
  return {
    exists: true,
    // EventWriter persists isMerge before the metadata finalizer adds mergeType.
    // Treat a merge at this deterministic ID with no mergeType as a repairable
    // partial benchmark comparison instead of blocking retries forever.
    isBenchmarkComparison: mergeType === 'benchmark' || (!mergeType && isMerge),
    isMerge,
    mergeType,
    toolSource: getOptionalString(data?.toolSource),
    comparisonTitle: getOptionalString(data?.comparisonTitle),
    sourceFilesCount: getNonNegativeInteger(data?.sourceFilesCount),
    activitiesCount: getNonNegativeInteger(data?.activitiesCount),
    originalFilesCount: countUsableOriginalFileMetadata(data),
    hasProcessingMetadata: processingMetadataSnapshot.exists,
  };
}

async function countActivitiesForEvent(userID: string, eventID: string): Promise<number> {
  const countSnapshot = await admin.firestore()
    .collection('users')
    .doc(userID)
    .collection('activities')
    .where('eventID', '==', eventID)
    .count()
    .get();
  return getNonNegativeInteger(countSnapshot.data().count) ?? 0;
}

async function parseUploadedEvent(payload: Buffer, resolvedExtension: string): Promise<EventInterface> {
  const parsingOptions = createParsingOptions();
  const baseExtension = getBaseExtension(resolvedExtension);

  if (baseExtension === 'fit') {
    return EventImporterFIT.getFromArrayBuffer(toArrayBuffer(payload), parsingOptions);
  }

  const text = decodeText(payload);
  if (baseExtension === 'gpx') {
    return EventImporterGPX.getFromString(text, xmldom.DOMParser, parsingOptions);
  }
  if (baseExtension === 'tcx') {
    const xml = new xmldom.DOMParser().parseFromString(text, 'application/xml');
    return EventImporterTCX.getFromXML(xml, parsingOptions);
  }

  throw new HttpStatusError(400, `Unsupported file extension: ${baseExtension}.`);
}

function getFirestoreAdapter(): FirestoreAdapter {
  return {
    setDoc: async (path: string[], data: unknown) => {
      await admin.firestore().doc(path.join('/')).set(data as Record<string, unknown>);
    },
    createBlob: (data: Uint8Array) => Buffer.from(data),
    generateID: () => admin.firestore().collection('tmp').doc().id,
  };
}

function getStorageAdapter(): StorageAdapter {
  return {
    uploadFile: async (path: string, data: unknown) => {
      await admin.storage().bucket().file(path).save(data as Buffer);
    },
    getBucketName: () => admin.storage().bucket().name,
  };
}

async function persistProcessingMetadata(userID: string, eventID: string): Promise<void> {
  const processingPayload: ProcessingMetaData = {
    sportsLibVersion: SPORTS_LIB_VERSION,
    sportsLibVersionCode: sportsLibVersionToCode(SPORTS_LIB_VERSION),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await admin.firestore()
    .doc(`users/${userID}/events/${eventID}/metaData/processing`)
    .set(processingPayload, { merge: true });
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: `${error}` };
}

function clearGeneratedMergeDescription(event: EventInterface): void {
  const eventAny = event as { description?: unknown; setDescription?: (description: string) => unknown };
  const description = eventAny.description;
  if (typeof description !== 'string') {
    return;
  }

  const normalized = description.trim().toLowerCase();
  if (!normalized.startsWith(GENERATED_MERGE_DESCRIPTION_PREFIX)) {
    return;
  }

  if (typeof eventAny.setDescription === 'function') {
    eventAny.setDescription('');
    return;
  }

  eventAny.description = '';
}

function resolveComparisonTitle(
  encodedTitle: string | undefined,
  files: NormalizedComparisonFile[],
): string {
  const requestedTitle = decodeOptionalHeaderValue(encodedTitle);
  if (requestedTitle) {
    return requestedTitle.slice(0, MAX_COMPARISON_TITLE_LENGTH);
  }

  const fileNames = files
    .map(file => file.originalFilename)
    .filter((filename): filename is string => !!filename)
    .map(stripComparisonFileExtension)
    .filter(Boolean);

  if (fileNames.length >= 2) {
    const suffix = fileNames.length > 2 ? ` +${fileNames.length - 2}` : '';
    return `Benchmark comparison: ${fileNames[0]} vs ${fileNames[1]}${suffix}`.slice(0, MAX_COMPARISON_TITLE_LENGTH);
  }

  return 'Benchmark comparison';
}

function prepareComparisonFilesForParsing(
  rawBody: Buffer,
  normalizedFiles: NormalizedComparisonFile[],
): PreparedComparisonFile[] {
  const preparedFiles: PreparedComparisonFile[] = [];
  const seenHashByFilename = new Map<string, string>();
  let totalDecompressedBytes = 0;

  for (const file of normalizedFiles) {
    const rawBytes = rawBody.subarray(file.startOffset, file.endOffset);
    const payloadForParsing = maybeDecompressPayloadForParsing(rawBytes, file.extension);
    totalDecompressedBytes += payloadForParsing.length;
    if (totalDecompressedBytes > MAX_TOOL_COMPARISON_DECOMPRESSED_BYTES) {
      throw new HttpStatusError(
        400,
        `Combined files are too large after decompression. Maximum decompressed size is ${MAX_ACTIVITY_DECOMPRESSED_BYTES_LABEL}.`,
      );
    }

    const contentHash = createHash('sha256')
      .update(file.baseExtension)
      .update(':')
      .update(payloadForParsing)
      .digest('hex');
    const duplicateFilename = seenHashByFilename.get(contentHash);
    if (duplicateFilename) {
      const currentName = file.originalFilename || `file ${preparedFiles.length + 1}`;
      throw new HttpStatusError(409, `${DUPLICATE_FILE_CONTENT_MESSAGE} Conflicting files: ${duplicateFilename} and ${currentName}.`);
    }
    seenHashByFilename.set(contentHash, file.originalFilename || `file ${preparedFiles.length + 1}`);

    preparedFiles.push({
      file,
      rawBytes,
      payloadForParsing,
      contentHash,
    });
  }

  return preparedFiles;
}

function generateComparisonEventID(userID: string, preparedFiles: PreparedComparisonFile[]): string {
  const hash = createHash('sha256')
    .update('benchmark-comparison')
    .update(':')
    .update(userID);

  const canonicalContentHashes = preparedFiles
    .map(preparedFile => preparedFile.contentHash)
    .sort();

  for (const contentHash of canonicalContentHashes) {
    hash
      .update(':')
      .update(contentHash);
  }

  return hash.digest('hex');
}

async function parseComparisonFiles(
  preparedFiles: PreparedComparisonFile[],
): Promise<ParsedComparisonFile[]> {
  const parsedFiles: ParsedComparisonFile[] = [];

  for (const preparedFile of preparedFiles) {
    const { file, payloadForParsing, rawBytes } = preparedFile;
    let event: EventInterface;
    try {
      event = await parseUploadedEvent(payloadForParsing, file.extension);
    } catch (error) {
      if (error instanceof HttpStatusError) {
        throw error;
      }
      logger.warn('[createToolComparisonEvent] Activity parsing failed', {
        originalFilename: file.originalFilename,
        extension: file.extension,
        error,
      });
      throw new HttpStatusError(400, `Could not parse uploaded file${file.originalFilename ? `: ${file.originalFilename}` : ''}.`);
    }

    const activities = event.getActivities?.() || [];
    if (activities.length === 0) {
      throw new HttpStatusError(400, `Uploaded file has no activities${file.originalFilename ? `: ${file.originalFilename}` : ''}.`);
    }

    parsedFiles.push({
      event,
      originalFile: {
        data: rawBytes,
        extension: resolveStoredExtension(file.extension, rawBytes),
        startDate: event.startDate || new Date(),
        originalFilename: file.originalFilename,
      },
    });
  }

  return parsedFiles;
}

async function finalizeToolComparisonMetadata(params: {
  userID: string;
  eventID: string;
  sourceFilesCount: number;
  activitiesCount: number;
  comparisonTitle: string;
}): Promise<void> {
  const comparisonMetadataPayload = sanitizeEventFirestoreWritePayload({
    isMerge: true,
    mergeType: 'benchmark',
    toolSource: 'tools/compare',
    sourceFilesCount: params.sourceFilesCount,
    activitiesCount: params.activitiesCount,
    comparisonTitle: params.comparisonTitle,
    benchmarkStatus: 'draft',
  });

  const results = await Promise.allSettled([
    admin.firestore().doc(`users/${params.userID}/events/${params.eventID}`).set(comparisonMetadataPayload, { merge: true }),
    persistProcessingMetadata(params.userID, params.eventID),
  ]);

  const failures = results
    .map((result, index) => ({ result, index }))
    .filter((entry): entry is { result: PromiseRejectedResult; index: number } => entry.result.status === 'rejected');

  if (!failures.length) {
    return;
  }

  logger.error('[createToolComparisonEvent] Comparison event was written but metadata finalization failed; returning failure.', {
    userID: params.userID,
    eventID: params.eventID,
    failures: failures.map(({ result, index }) => ({
      write: index === 0 ? 'comparisonMetadata' : 'processingMetadata',
      error: serializeError(result.reason),
    })),
  });

  throw new HttpStatusError(500, 'Could not create comparison.');
}

async function repairExistingComparisonMetadata(params: {
  userID: string;
  eventID: string;
  existingComparisonEvent: ExistingComparisonEventData;
  sourceFilesCount: number;
  comparisonTitle: string;
}): Promise<ExistingComparisonRepairResult> {
  const repairedComparisonEvent: ExistingComparisonEventData = {
    ...params.existingComparisonEvent,
  };
  const repairPayload: Record<string, unknown> = {};

  if (!repairedComparisonEvent.isMerge) {
    repairPayload.isMerge = true;
    repairedComparisonEvent.isMerge = true;
  }
  if (repairedComparisonEvent.mergeType !== 'benchmark') {
    repairPayload.mergeType = 'benchmark';
    repairedComparisonEvent.mergeType = 'benchmark';
  }
  if (!repairedComparisonEvent.toolSource) {
    repairPayload.toolSource = 'tools/compare';
    repairedComparisonEvent.toolSource = 'tools/compare';
  }
  if (repairedComparisonEvent.sourceFilesCount !== params.sourceFilesCount) {
    repairPayload.sourceFilesCount = params.sourceFilesCount;
    repairedComparisonEvent.sourceFilesCount = params.sourceFilesCount;
  }

  if (repairedComparisonEvent.originalFilesCount < params.sourceFilesCount) {
    return {
      comparisonEvent: repairedComparisonEvent,
      needsRewrite: true,
    };
  }

  const activitiesCount = await countActivitiesForEvent(params.userID, params.eventID);
  if (activitiesCount < params.sourceFilesCount) {
    return {
      comparisonEvent: repairedComparisonEvent,
      needsRewrite: true,
    };
  }
  if (repairedComparisonEvent.activitiesCount !== activitiesCount) {
    repairPayload.activitiesCount = activitiesCount;
    repairedComparisonEvent.activitiesCount = activitiesCount;
  }
  if (!repairedComparisonEvent.comparisonTitle) {
    repairPayload.comparisonTitle = params.comparisonTitle;
    repairedComparisonEvent.comparisonTitle = params.comparisonTitle;
  }

  if (Object.keys(repairPayload).length === 0) {
    if (repairedComparisonEvent.hasProcessingMetadata) {
      return {
        comparisonEvent: repairedComparisonEvent,
        needsRewrite: false,
      };
    }

    await persistProcessingMetadata(params.userID, params.eventID);
    repairedComparisonEvent.hasProcessingMetadata = true;
    return {
      comparisonEvent: repairedComparisonEvent,
      needsRewrite: false,
    };
  }

  await Promise.all([
    admin.firestore()
      .doc(`users/${params.userID}/events/${params.eventID}`)
      .set(sanitizeEventFirestoreWritePayload(repairPayload), { merge: true }),
    persistProcessingMetadata(params.userID, params.eventID),
  ]);
  repairedComparisonEvent.hasProcessingMetadata = true;

  return {
    comparisonEvent: repairedComparisonEvent,
    needsRewrite: false,
  };
}

export const createToolComparisonEvent = onRequest({
  region: FUNCTIONS_MANIFEST.createToolComparisonEvent.region,
  ...ACTIVITY_PROCESSING_HTTPS_RUNTIME_OPTIONS,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    return;
  }

  try {
    const userID = await verifyFirebaseUserIDFromAuthorizationHeader(getRequestHeader(request, 'authorization'));
    await verifyAppCheckHeader(getRequestHeader(request, 'X-Firebase-AppCheck'));
    await assertComparisonWriteAllowedForUser(userID);

    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new HttpStatusError(400, 'File payload is empty.');
    }

    if (rawBody.length > MAX_TOOL_COMPARISON_UPLOAD_BYTES) {
      throw new HttpStatusError(
        400,
        `Combined file payload is too large (${(rawBody.length / 1024 / 1024).toFixed(1)}MB). Maximum combined size is 30MB.`,
      );
    }

    const manifest = parseFileManifest(getRequestHeader(request, FILE_MANIFEST_HEADER));
    const normalizedFiles = normalizeManifestFiles(manifest, rawBody.length);
    const comparisonTitle = resolveComparisonTitle(getRequestHeader(request, TITLE_HEADER), normalizedFiles);
    const preparedFiles = prepareComparisonFilesForParsing(rawBody, normalizedFiles);
    const mergedEventID = generateComparisonEventID(userID, preparedFiles);
    const existingComparisonEvent = await getExistingComparisonEventData(userID, mergedEventID);

    const currentCount = await getEventCountForUser(userID);
    const uploadLimit = await resolveUploadLimitForUser(userID);
    if (uploadLimit !== null && currentCount >= uploadLimit && !existingComparisonEvent.exists) {
      throw new HttpStatusError(429, `Upload limit reached for your tier. You have ${currentCount} events. Limit is ${uploadLimit}.`);
    }

    if (existingComparisonEvent.exists) {
      if (!existingComparisonEvent.isBenchmarkComparison) {
        logger.error('[createToolComparisonEvent] Deterministic comparison ID points to a non-benchmark event.', {
          userID,
          eventID: mergedEventID,
        });
        throw new HttpStatusError(409, 'A different event already exists for this comparison.');
      }

      await assertComparisonWriteAllowedForUser(userID);
      const repairResult = await repairExistingComparisonMetadata({
        userID,
        eventID: mergedEventID,
        existingComparisonEvent,
        sourceFilesCount: normalizedFiles.length,
        comparisonTitle,
      });

      if (!repairResult.needsRewrite) {
        response.status(200).json({
          eventId: mergedEventID,
          mergeType: 'benchmark',
          sourceFilesCount: repairResult.comparisonEvent.sourceFilesCount ?? normalizedFiles.length,
          activitiesCount: repairResult.comparisonEvent.activitiesCount ?? 0,
          uploadLimit,
          uploadCountAfterWrite: currentCount,
          alreadyExists: true,
        });
        return;
      }

      logger.warn('[createToolComparisonEvent] Rewriting incomplete existing comparison.', {
        userID,
        eventID: mergedEventID,
      });
    }

    const parsedFiles = await parseComparisonFiles(preparedFiles);
    const sourceEvents = parsedFiles.map(file => file.event);
    const originalFiles = parsedFiles.map(file => file.originalFile);

    const mergedEvent = EventUtilities.mergeEvents(sourceEvents);
    mergedEvent.setID(mergedEventID);
    mergedEvent.name = comparisonTitle;
    (mergedEvent as { isMerge?: boolean; mergeType?: 'benchmark' }).isMerge = true;
    (mergedEvent as { isMerge?: boolean; mergeType?: 'benchmark' }).mergeType = 'benchmark';
    clearGeneratedMergeDescription(mergedEvent);

    const activities = mergedEvent.getActivities();
    for (let i = 0; i < activities.length; i++) {
      activities[i].setID(await generateActivityID(mergedEventID, i));
    }

    await assertComparisonWriteAllowedForUser(userID);
    const writer = new EventWriter(getFirestoreAdapter(), getStorageAdapter());
    await writer.writeAllEventData(userID, mergedEvent as any, originalFiles);
    await finalizeToolComparisonMetadata({
      userID,
      eventID: mergedEventID,
      sourceFilesCount: originalFiles.length,
      activitiesCount: activities.length,
      comparisonTitle,
    });

    response.status(200).json({
      eventId: mergedEventID,
      mergeType: 'benchmark',
      sourceFilesCount: originalFiles.length,
      activitiesCount: activities.length,
      uploadLimit,
      uploadCountAfterWrite: existingComparisonEvent.exists ? currentCount : currentCount + 1,
      alreadyExists: false,
    });
  } catch (error) {
    if (error instanceof HttpStatusError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    logger.error('[createToolComparisonEvent] Comparison creation failed', error);
    response.status(500).json({ error: 'Could not create comparison.' });
  }
});
