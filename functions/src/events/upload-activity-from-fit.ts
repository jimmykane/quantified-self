import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { basename } from 'node:path';

import { ALLOWED_CORS_ORIGINS, hasBasicAccess, hasProAccess } from '../utils';
import { createParsingOptions } from '../shared/parsing-options';
import { EventWriter, FirestoreAdapter, StorageAdapter, OriginalFile } from '../shared/event-writer';
import { generateActivityID, generateEventID } from '../shared/id-generator';
import { ProcessingMetaData } from '../shared/processing-metadata.interface';
import { SPORTS_LIB_VERSION } from '../shared/sports-lib-version.node';
import { sportsLibVersionToCode } from '../reparse/sports-lib-reparse.service';
import { USAGE_LIMITS } from '../shared/limits';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function resolveEventNameFromHeader(originalFilenameHeader?: string): string | null {
  if (!originalFilenameHeader) {
    return null;
  }

  const baseName = basename(originalFilenameHeader).trim();
  if (!baseName) {
    return null;
  }

  const noExtension = baseName.replace(/\.[^/.]+$/, '').trim();
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
    logger.warn('[uploadActivityFromFit] Firebase ID token verification failed', error);
    throw new HttpStatusError(401, 'Unauthenticated request.');
  }
}

async function verifyAppCheckHeader(appCheckHeader?: string): Promise<void> {
  if (!appCheckHeader) {
    throw new HttpStatusError(401, 'Missing App Check token.');
  }

  try {
    await admin.appCheck().verifyToken(appCheckHeader);
  } catch (error) {
    logger.warn('[uploadActivityFromFit] App Check verification failed', error);
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

export const uploadActivityFromFit = onRequest({
  region: FUNCTIONS_MANIFEST.uploadActivityFromFit.region,
  timeoutSeconds: 300,
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

    let event;
    try {
      event = await EventImporterFIT.getFromArrayBuffer(toArrayBuffer(rawBody), createParsingOptions());
    } catch (error) {
      logger.warn('[uploadActivityFromFit] FIT parsing failed', error);
      throw new HttpStatusError(400, 'Could not parse FIT payload.');
    }

    const eventID = await generateEventID(userID, event.startDate, 0);
    event.setID(eventID);

    const resolvedEventName = resolveEventNameFromHeader(request.header('X-Original-Filename') || undefined);
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
      extension: 'fit',
      startDate: event.startDate,
      originalFilename: request.header('X-Original-Filename') || undefined,
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

    logger.error('[uploadActivityFromFit] Upload failed', error);
    response.status(500).json({ error: 'Could not upload FIT activity.' });
  }
});
