import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';

type EventPrivacy = 'public' | 'private';

interface SetEventSharingRequest {
  userID?: unknown;
  eventID?: unknown;
  enabled?: unknown;
}

const PUBLIC_EVENT_ROUTE_PREFIX = '/share/event';
const PUBLIC_COMPARISON_ROUTE_PREFIX = '/share/comparison';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requirePathSegment(value: unknown, fieldName: 'userID' | 'eventID'): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${fieldName} is required.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.includes('/')) {
    throw new HttpsError('invalid-argument', `${fieldName} is invalid.`);
  }

  return normalized;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', 'enabled must be a boolean.');
  }

  return value;
}

function buildSharePath(prefix: string, userID: string, eventID: string): string {
  return `${prefix}/${encodeURIComponent(userID)}/${encodeURIComponent(eventID)}`;
}

export const setEventSharing = onCall({
  region: FUNCTIONS_MANIFEST.setEventSharing.region,
  cors: ALLOWED_CORS_ORIGINS,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);

  const data = asRecord(request.data) as SetEventSharingRequest | null;
  const userID = requirePathSegment(data?.userID, 'userID');
  const eventID = requirePathSegment(data?.eventID, 'eventID');
  const enabled = requireBoolean(data?.enabled);

  if (request.auth.uid !== userID) {
    throw new HttpsError('permission-denied', 'You can only update sharing for your own events.');
  }

  const eventRef = admin.firestore().doc(`users/${userID}/events/${eventID}`);
  const eventSnapshot = await eventRef.get();
  if (!eventSnapshot.exists) {
    throw new HttpsError('not-found', `Event ${eventID} was not found for this user.`);
  }

  const privacy: EventPrivacy = enabled ? 'public' : 'private';
  const eventPatch = sanitizeEventFirestoreWritePayload({ privacy });

  try {
    await eventRef.update(eventPatch);
  } catch (error) {
    logger.error('[setEventSharing] Failed to update event sharing', { userID, eventID, enabled, error });
    throw new HttpsError('internal', 'Could not update event sharing.');
  }

  return {
    eventID,
    privacy,
    publicEventUrl: buildSharePath(PUBLIC_EVENT_ROUTE_PREFIX, userID, eventID),
    publicComparisonUrl: buildSharePath(PUBLIC_COMPARISON_ROUTE_PREFIX, userID, eventID),
  };
});
