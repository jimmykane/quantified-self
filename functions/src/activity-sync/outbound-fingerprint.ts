import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
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

export interface ActivitySyncOutboundFingerprintIds {
  exactFingerprintId: string;
  fingerprintIds: string[];
}

export interface ActivitySyncOutboundFingerprintRecord extends ActivitySyncOutboundFingerprintIds {
  operationId: string;
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

async function buildSemanticFingerprintId(fileBuffer: Buffer): Promise<string | null> {
  try {
    const event = await EventImporterFIT.getFromArrayBuffer(toArrayBuffer(fileBuffer), createParsingOptions());
    const activities = event.getActivities().map(activity => ({
      start: epochSecond(activity.startDate),
      end: epochSecond(activity.endDate),
      type: `${activity.type || ''}`.trim().toLowerCase(),
      duration: finiteRounded(activity.getDuration()?.getValue?.()),
      distance: finiteRounded(activity.getDistance()?.getValue?.()),
    }));
    if (activities.length === 0 || activities.every(activity => activity.start === null)) {
      return null;
    }

    const semanticDigest = sha256(`${SEMANTIC_FINGERPRINT_VERSION}\0${JSON.stringify({
      eventStart: epochSecond(event.startDate),
      eventEnd: epochSecond(event.endDate),
      activities,
    })}`);
    return `${SEMANTIC_FINGERPRINT_VERSION}-${semanticDigest}`;
  } catch (error) {
    // Exact-byte suppression remains available when an otherwise provider-
    // accepted FIT cannot be normalized by the local parser.
    logger.warn('[ActivitySync] Could not create a semantic outbound FIT fingerprint.', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

export async function buildActivitySyncOutboundFingerprintIds(fileBuffer: Buffer): Promise<ActivitySyncOutboundFingerprintIds> {
  const exactFingerprintId = `${EXACT_FINGERPRINT_VERSION}-${sha256(fileBuffer)}`;
  const semanticFingerprintId = await buildSemanticFingerprintId(fileBuffer);
  return {
    exactFingerprintId,
    fingerprintIds: semanticFingerprintId
      ? [exactFingerprintId, semanticFingerprintId]
      : [exactFingerprintId],
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
  /** Delay echo eligibility until the provider request is irrevocably about to start. */
  provisional?: boolean;
}): Promise<ActivitySyncOutboundFingerprintRecord> {
  const fingerprints = await buildActivitySyncOutboundFingerprintIds(params.fileBuffer);
  const record: ActivitySyncOutboundFingerprintRecord = {
    ...fingerprints,
    operationId: crypto.randomUUID(),
  };
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

    const refs = fingerprints.fingerprintIds.map(fingerprintId => collection.doc(
      getActivitySyncOutboundFingerprintDocumentId(
        params.destinationServiceName,
        fingerprintId,
      ),
    ));
    const snapshots = params.provisional === true
      ? await Promise.all(refs.map(ref => transaction.get(ref)))
      : [];
    for (let index = 0; index < fingerprints.fingerprintIds.length; index += 1) {
      const fingerprintId = fingerprints.fingerprintIds[index];
      const existingData = snapshots[index]?.data() || {};
      const hasLiveProviderReceipt = params.provisional === true
        && (toEpochMs(existingData.providerRequestStartedAt) || 0) > 0
        && (toEpochMs(existingData.expireAt) || 0) > recordedAt;
      transaction.set(refs[index], {
        version: 1,
        destinationServiceName: params.destinationServiceName,
        fingerprintKind: fingerprintId.startsWith(`${SEMANTIC_FINGERPRINT_VERSION}-`) ? 'semantic' : 'exact',
        ...(params.provisional === true ? {
          pendingOperationIds: FieldValue.arrayUnion(record.operationId),
          ...(hasLiveProviderReceipt ? {} : {
            providerRequestStartedAt: FieldValue.delete(),
            providerRequestReceiptPending: FieldValue.delete(),
            providerRequestStartingOperationIds: FieldValue.delete(),
            recordedAt,
            expireAt: getExpireAtTimestamp(TTL_CONFIG.ACTIVITY_SYNC_OUTBOUND_FINGERPRINT_IN_DAYS),
          }),
        } : {
          providerRequestStartedAt: recordedAt,
          providerRequestReceiptPending: FieldValue.delete(),
          providerRequestStartingOperationIds: FieldValue.delete(),
          recordedAt,
          expireAt: getExpireAtTimestamp(TTL_CONFIG.ACTIVITY_SYNC_OUTBOUND_FINGERPRINT_IN_DAYS),
        }),
      }, { merge: true });
    }
  });
  return record;
}

/**
 * Promotes one provisional operation into a durable provider-request receipt.
 * The operation remains attributable until the provider request is attempted,
 * so an account switch during the final ownership check can remove it safely.
 */
export async function markActivitySyncOutboundFingerprintProviderRequestStarted(params: {
  userID: string;
  destinationServiceName: ServiceNames;
  record: ActivitySyncOutboundFingerprintRecord;
}): Promise<void> {
  const db = admin.firestore();
  const collection = fingerprintCollection(params.userID);
  const refs = params.record.fingerprintIds.map(fingerprintId => collection.doc(
    getActivitySyncOutboundFingerprintDocumentId(params.destinationServiceName, fingerprintId),
  ));
  const providerRequestStartedAt = Date.now();
  await db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    if (deletionGuard.shouldSkip) {
      throw new ActivitySyncOutboundFingerprintSkippedForDeletedUserError(params.userID);
    }
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    if (snapshots.some(snapshot => {
      const pending = snapshot.data()?.pendingOperationIds;
      return !snapshot.exists
        || !Array.isArray(pending)
        || !pending.includes(params.record.operationId);
    })) {
      throw new Error('The outbound activity fingerprint operation is no longer current.');
    }
    for (let index = 0; index < refs.length; index += 1) {
      const data = snapshots[index].data() || {};
      const hasProviderReceipt = (toEpochMs(data.providerRequestStartedAt) || 0) > 0;
      transaction.set(refs[index], {
        pendingOperationIds: FieldValue.arrayRemove(params.record.operationId),
        providerRequestStartingOperationIds: FieldValue.arrayUnion(params.record.operationId),
        ...(hasProviderReceipt ? {} : {
          providerRequestStartedAt,
          providerRequestReceiptPending: true,
          recordedAt: providerRequestStartedAt,
          expireAt: getExpireAtTimestamp(TTL_CONFIG.ACTIVITY_SYNC_OUTBOUND_FINGERPRINT_IN_DAYS),
        }),
      }, { merge: true });
    }
  });
}

/**
 * Finalizes an ownership claim once Wahoo was actually attempted. The receipt
 * stays eligible for echo suppression; only the reversible pre-request claim
 * is removed.
 */
export async function completeActivitySyncOutboundFingerprintProviderRequest(params: {
  userID: string;
  destinationServiceName: ServiceNames;
  record: ActivitySyncOutboundFingerprintRecord;
}): Promise<void> {
  const db = admin.firestore();
  const collection = fingerprintCollection(params.userID);
  await db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    if (deletionGuard.shouldSkip) return;
    const refs = params.record.fingerprintIds.map(fingerprintId => collection.doc(
      getActivitySyncOutboundFingerprintDocumentId(params.destinationServiceName, fingerprintId),
    ));
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    for (let index = 0; index < snapshots.length; index += 1) {
      const starting = snapshots[index].data()?.providerRequestStartingOperationIds;
      if (!snapshots[index].exists || !Array.isArray(starting) || !starting.includes(params.record.operationId)) {
        continue;
      }
      transaction.set(refs[index], {
        providerRequestStartingOperationIds: FieldValue.arrayRemove(params.record.operationId),
        providerRequestReceiptPending: FieldValue.delete(),
      }, { merge: true });
    }
  });
}

/** Removes only receipts written by a provider request that never started. */
export async function rollbackActivitySyncOutboundFingerprint(params: {
  userID: string;
  destinationServiceName: ServiceNames;
  record: ActivitySyncOutboundFingerprintRecord;
}): Promise<void> {
  const db = admin.firestore();
  const collection = fingerprintCollection(params.userID);
  await db.runTransaction(async transaction => {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, params.userID);
    if (deletionGuard.shouldSkip) return;
    const refs = params.record.fingerprintIds.map(fingerprintId => collection.doc(
      getActivitySyncOutboundFingerprintDocumentId(params.destinationServiceName, fingerprintId),
    ));
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    for (let index = 0; index < snapshots.length; index += 1) {
      const data = snapshots[index].data() || {};
      const originalPending = Array.isArray(data.pendingOperationIds)
        ? data.pendingOperationIds
        : [];
      const originalStarting = Array.isArray(data.providerRequestStartingOperationIds)
        ? data.providerRequestStartingOperationIds
        : [];
      const pending = originalPending.filter((value: unknown) => value !== params.record.operationId);
      const starting = originalStarting.filter((value: unknown) => value !== params.record.operationId);
      const removedPending = pending.length !== originalPending.length;
      const removedStarting = starting.length !== originalStarting.length;
      if (!snapshots[index].exists || (!removedPending && !removedStarting)) continue;
      const hasProviderReceipt = (toEpochMs(data.providerRequestStartedAt) || 0) > 0;
      const shouldDelete = (!hasProviderReceipt || data.providerRequestReceiptPending === true)
        && pending.length === 0
        && starting.length === 0;
      if (shouldDelete) {
        // Fingerprint documents never have descendants.
        transaction.delete(refs[index]);
      } else {
        transaction.set(refs[index], {
          ...(removedPending ? {
            pendingOperationIds: FieldValue.arrayRemove(params.record.operationId),
          } : {}),
          ...(removedStarting ? {
            providerRequestStartingOperationIds: FieldValue.arrayRemove(params.record.operationId),
          } : {}),
        }, { merge: true });
      }
    }
  });
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
    const providerRequestStartedAt = toEpochMs(data.providerRequestStartedAt);
    return data.version === 1
      && data.destinationServiceName === params.sourceServiceName
      && providerRequestStartedAt !== null
      && providerRequestStartedAt > 0
      && expireAt !== null
      && expireAt > now;
  });
}
