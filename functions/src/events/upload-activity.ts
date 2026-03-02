import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import {
  EventImporterFIT,
  EventImporterGPX,
  EventImporterSuuntoJSON,
  EventImporterSuuntoSML,
  EventImporterTCX,
  EventInterface,
} from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as xmldom from 'xmldom';

import { ALLOWED_CORS_ORIGINS, ENFORCE_APP_CHECK, hasBasicAccess, hasProAccess } from '../utils';
import { createParsingOptions } from '../shared/parsing-options';
import { EventWriter, FirestoreAdapter, StorageAdapter, OriginalFile } from '../shared/event-writer';
import { generateActivityID } from '../shared/id-generator';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';
import { USAGE_LIMITS } from '../shared/limits';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Protect against gzip zip-bombs: input is capped at 10MB, but decompressed output
// could otherwise expand to hundreds of MB/GB and OOM the function instance.
const MAX_DECOMPRESSED_UPLOAD_BYTES = 150 * 1024 * 1024;
const SUPPORTED_BASE_EXTENSIONS = new Set(['fit', 'gpx', 'tcx', 'json', 'sml']);

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
    throw new HttpStatusError(400, `Unsupported file extension: ${baseExtension}. Supported: fit, gpx, tcx, json, sml.`);
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
  const shouldDecompress = resolvedExtension.endsWith('.gz')
    || hasGzipMagic(payload);

  if (!shouldDecompress) {
    return payload;
  }

  try {
    return gunzipSync(payload, { maxOutputLength: MAX_DECOMPRESSED_UPLOAD_BYTES });
  } catch (error) {
    logger.warn('[uploadActivity] Gzip decompression failed', error);
    throw new HttpStatusError(400, 'Could not decompress uploaded payload.');
  }
}

function resolveEventNameFromHeader(originalFilenameHeader?: string): string | null {
  if (!originalFilenameHeader) {
    return null;
  }

  const baseName = basename(originalFilenameHeader).trim();
  if (!baseName) {
    return null;
  }

  const noExtension = baseName.replace(/\.(fit|gpx|tcx|json|sml)(\.gz)?$/i, '').trim();
  return noExtension || null;
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
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    logger.warn('[uploadActivity] Firebase ID token verification failed', error);
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
    logger.warn('[uploadActivity] App Check verification failed', error);
    throw new HttpStatusError(401, 'Invalid App Check token.');
  }
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
  if (baseExtension === 'json') {
    try {
      return await EventImporterSuuntoJSON.getFromJSONString(text, parsingOptions);
    } catch (_jsonError) {
      return await EventImporterSuuntoSML.getFromJSONString(text, parsingOptions);
    }
  }
  if (baseExtension === 'sml') {
    return EventImporterSuuntoSML.getFromXML(text, parsingOptions);
  }

  throw new HttpStatusError(400, `Unsupported file extension: ${baseExtension}.`);
}

function generateUploadEventID(payload: Buffer, resolvedExtension: string): string {
  const baseExtension = getBaseExtension(resolvedExtension);

  return createHash('sha256')
    .update(baseExtension)
    .update(':')
    .update(payload)
    .digest('hex');
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

export const uploadActivity = onRequest({
  region: FUNCTIONS_MANIFEST.uploadActivity.region,
  memory: '1GiB',
  concurrency: 1,
  timeoutSeconds: 540,
  maxInstances: 20,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    return;
  }

  try {
    const userID = await verifyFirebaseUserIDFromAuthorizationHeader(request.header('authorization'));
    await verifyAppCheckHeader(request.header('X-Firebase-AppCheck') || request.header('x-firebase-appcheck'));
    const originalFilename = request.header('X-Original-Filename') || request.header('x-original-filename') || undefined;
    const resolvedExtension = resolveUploadExtension(
      request.header('X-File-Extension') || request.header('x-file-extension') || undefined,
      originalFilename,
    );

    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new HttpStatusError(400, 'File payload is empty.');
    }

    if (rawBody.length > MAX_UPLOAD_BYTES) {
      throw new HttpStatusError(400, `File is too large (${(rawBody.length / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`);
    }

    const currentCount = await getEventCountForUser(userID);
    const uploadLimit = await resolveUploadLimitForUser(userID);
    if (uploadLimit !== null && currentCount >= uploadLimit) {
      throw new HttpStatusError(429, `Upload limit reached for your tier. You have ${currentCount} events. Limit is ${uploadLimit}.`);
    }

    let event: EventInterface;
    let payloadForParsing: Buffer;
    try {
      payloadForParsing = maybeDecompressPayloadForParsing(rawBody, resolvedExtension);
      event = await parseUploadedEvent(payloadForParsing, resolvedExtension);
    } catch (error) {
      if (error instanceof HttpStatusError) {
        throw error;
      }
      logger.warn('[uploadActivity] Activity parsing failed', error);
      throw new HttpStatusError(400, 'Could not parse uploaded payload.');
    }

    const eventID = generateUploadEventID(payloadForParsing, resolvedExtension);
    event.setID(eventID);

    const resolvedEventName = resolveEventNameFromHeader(originalFilename);
    if (resolvedEventName) {
      event.name = resolvedEventName;
    }

    const activities = event.getActivities();
    for (let i = 0; i < activities.length; i++) {
      if (!activities[i].getID()) {
        activities[i].setID(await generateActivityID(eventID, i));
      }
    }

    const originalFile: OriginalFile = {
      data: rawBody,
      extension: resolveStoredExtension(resolvedExtension, rawBody),
      startDate: event.startDate,
      originalFilename,
    };

    const writer = new EventWriter(getFirestoreAdapter(), getStorageAdapter());
    await writer.writeAllEventData(userID, event, originalFile);
    await persistProcessingMetadata(userID, eventID);

    response.status(200).json({
      eventId: eventID,
      activitiesCount: activities.length,
      uploadLimit,
      uploadCountAfterWrite: currentCount + 1,
    });
  } catch (error) {
    if (error instanceof HttpStatusError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    logger.error('[uploadActivity] Upload failed', error);
    response.status(500).json({ error: 'Could not upload activity.' });
  }
});
