import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { EventImporterFIT, ServiceNames } from '@sports-alliance/sports-lib';

import { createParsingOptions } from '../../../shared/parsing-options';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

export const ACTIVITY_SYNC_OUTBOUND_FINGERPRINTS_COLLECTION_NAME = 'activitySyncOutboundFingerprints';

const EXACT_FINGERPRINT_VERSION = 'exact-v1';
const SEMANTIC_FINGERPRINT_VERSION = 'semantic-v1';
const DESTINATION_NAMESPACE_VERSION = 'destination-v1';

export interface ActivitySyncOutboundFingerprintRecord {
  exactFingerprintId: string;
  fingerprintIds: string[];
  activityTypes: string[];
}

export class ActivitySyncOutboundFingerprintSkippedForDeletedUserError extends Error {
  readonly name = 'ActivitySyncOutboundFingerprintSkippedForDeletedUserError';
  readonly code = 'user_deleted_or_deleting';

  constructor(public readonly userID: string) {
    super(`Skipping outbound activity fingerprint persistence for deleted or deleting user ${userID}.`);
  }
}

function toArrayBuffer(payload: Buffer): ArrayBuffer {
  return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
}

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function finiteRounded(value: unknown, precision = 1): number | null {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.round(numericValue / precision) * precision;
}

function epochSecond(value: unknown): number | null {
  const date = value instanceof Date ? value : new Date(`${value || ''}`);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? Math.round(timestamp / 1000) : null;
}

interface SemanticFingerprintDescriptor {
  fingerprintId: string | null;
  activityTypes: string[];
}

async function buildSemanticFingerprintDescriptor(fileBuffer: Buffer): Promise<SemanticFingerprintDescriptor> {
  try {
    const event = await EventImporterFIT.getFromArrayBuffer(toArrayBuffer(fileBuffer), createParsingOptions());
    const eventActivities = event.getActivities();
    const activityTypes = Array.from(new Set(eventActivities
      .map(activity => `${activity.type || ''}`.trim())
      .filter(activityType => activityType.length > 0)));
    const activities = eventActivities.map(activity => ({
      start: epochSecond(activity.startDate),
      end: epochSecond(activity.endDate),
      type: `${activity.type || ''}`.trim().toLowerCase(),
      duration: finiteRounded(activity.getDuration()?.getValue?.()),
      distance: finiteRounded(activity.getDistance()?.getValue?.()),
    }));
    if (activities.length === 0 || activities.every(activity => activity.start === null)) {
      return { fingerprintId: null, activityTypes };
    }

    const semanticDigest = sha256(`${SEMANTIC_FINGERPRINT_VERSION}\0${JSON.stringify({
      eventStart: epochSecond(event.startDate),
      eventEnd: epochSecond(event.endDate),
      activities,
    })}`);
    return {
      fingerprintId: `${SEMANTIC_FINGERPRINT_VERSION}-${semanticDigest}`,
      activityTypes,
    };
  } catch (error) {
    // Exact-byte suppression remains available when an otherwise provider-
    // accepted FIT cannot be normalized by the local parser.
    logger.warn('[ActivitySync] Could not create a semantic outbound FIT fingerprint.', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return { fingerprintId: null, activityTypes: [] };
  }
}

export async function buildActivitySyncOutboundFingerprintIds(fileBuffer: Buffer): Promise<ActivitySyncOutboundFingerprintRecord> {
  const exactFingerprintId = `${EXACT_FINGERPRINT_VERSION}-${sha256(fileBuffer)}`;
  const semanticFingerprint = await buildSemanticFingerprintDescriptor(fileBuffer);
  return {
    exactFingerprintId,
    fingerprintIds: semanticFingerprint.fingerprintId
      ? [exactFingerprintId, semanticFingerprint.fingerprintId]
      : [exactFingerprintId],
    activityTypes: semanticFingerprint.activityTypes,
  };
}

function fingerprintCollection(userID: string): admin.firestore.CollectionReference {
  return admin.firestore()
    .collection('users')
    .doc(userID)
    .collection(ACTIVITY_SYNC_OUTBOUND_FINGERPRINTS_COLLECTION_NAME);
}

/** Keeps one file receipt per destination so multi-provider fan-out cannot overwrite it. */
export function getActivitySyncOutboundFingerprintDocumentId(
  destinationServiceName: ServiceNames,
  fingerprintId: string,
): string {
  const destinationNamespace = sha256(
    `${DESTINATION_NAMESPACE_VERSION}\0${destinationServiceName}`,
  ).slice(0, 16);
  return `${destinationNamespace}-${fingerprintId}`;
}

/**
 * Persists a short-lived receipt before provider delivery. The provider call
 * must not start if this deletion-safe write fails, which makes echo
 * suppression durable across asynchronous upload retries.
 */
export async function recordActivitySyncOutboundFingerprint(params: {
  userID: string;
  destinationServiceName: ServiceNames;
  fileBuffer: Buffer;
}): Promise<ActivitySyncOutboundFingerprintRecord> {
  const fingerprints = await buildActivitySyncOutboundFingerprintIds(params.fileBuffer);
  const db = admin.firestore();
  const collection = fingerprintCollection(params.userID);
  const recordedAt = Date.now();
  await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(params.userID, 'activity_sync_outbound_fingerprint_transaction', error);
    }
    if (deletionGuard.shouldSkip) {
      throw new ActivitySyncOutboundFingerprintSkippedForDeletedUserError(params.userID);
    }

    for (const fingerprintId of fingerprints.fingerprintIds) {
      transaction.set(collection.doc(getActivitySyncOutboundFingerprintDocumentId(
        params.destinationServiceName,
        fingerprintId,
      )), {
        version: 1,
        destinationServiceName: params.destinationServiceName,
        fingerprintKind: fingerprintId.startsWith(`${SEMANTIC_FINGERPRINT_VERSION}-`) ? 'semantic' : 'exact',
        recordedAt,
        expireAt: getExpireAtTimestamp(TTL_CONFIG.ACTIVITY_SYNC_OUTBOUND_FINGERPRINT_IN_DAYS),
      }, { merge: true });
    }
  });
  return fingerprints;
}

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const timestamp = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Returns true only for an unexpired receipt written for the importing provider. */
export async function isActivitySyncOutboundEcho(params: {
  userID: string;
  sourceServiceName: ServiceNames;
  fileBuffer: Buffer;
}): Promise<boolean> {
  const fingerprints = await buildActivitySyncOutboundFingerprintIds(params.fileBuffer);
  const collection = fingerprintCollection(params.userID);
  const snapshots = await Promise.all(fingerprints.fingerprintIds.map(id => collection.doc(
    getActivitySyncOutboundFingerprintDocumentId(params.sourceServiceName, id),
  ).get()));
  const now = Date.now();
  return snapshots.some(snapshot => {
    if (!snapshot.exists) return false;
    const data = snapshot.data() || {};
    const expireAt = toEpochMs(data.expireAt);
    return data.version === 1
      && data.destinationServiceName === params.sourceServiceName
      && expireAt !== null
      && expireAt > now;
  });
}
