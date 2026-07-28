import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { createHash, randomUUID } from 'node:crypto';

import { setEventDocumentIfUserActive } from '../utils';

export type MergeType = 'benchmark' | 'multi';

export interface MergeEventResponse {
  eventId: string;
  mergeType: MergeType;
  sourceEventsCount: number;
  sourceFilesCount: number;
  activitiesCount: number;
  uploadLimit: number | null;
  uploadCountAfterWrite: number | null;
}

interface MergeOperationRecord {
  schemaVersion: 1;
  status: 'processing' | 'completed' | 'retryable';
  requestFingerprint: string;
  mergeType: MergeType;
  sourceEventsCount: number;
  resultEventId: string;
  attemptCount: number;
  ownerToken: string | null;
  leaseExpiresAtMs: number;
  response: MergeEventResponse | null;
  lastErrorCode: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  completedAt?: unknown;
}

export type MergeOperationClaim =
  | {
    kind: 'execute';
    requestFingerprint: string;
    resultEventId: string;
    ownerToken: string;
  }
  | {
    kind: 'completed';
    response: MergeEventResponse;
  }
  | {
    kind: 'in-progress';
  };

const MERGE_OPERATION_SCHEMA_VERSION = 1;
const MERGE_OPERATION_COLLECTION = 'eventMergeOperations';
const MERGE_OPERATION_LEASE_MS = 2 * 60 * 1000;
const SAFE_DOCUMENT_ID_MAX_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function isSafeMergeDocumentId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= SAFE_DOCUMENT_ID_MAX_LENGTH
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !hasControlCharacters(value);
}

function asMergeEventResponse(value: unknown): MergeEventResponse | null {
  if (!isRecord(value) || !isSafeMergeDocumentId(value.eventId)) {
    return null;
  }
  if (value.mergeType !== 'benchmark' && value.mergeType !== 'multi') {
    return null;
  }
  if (
    !isNonNegativeInteger(value.sourceEventsCount)
    || !isNonNegativeInteger(value.sourceFilesCount)
    || !isNonNegativeInteger(value.activitiesCount)
  ) {
    return null;
  }
  if (value.uploadLimit !== null && !isNonNegativeInteger(value.uploadLimit)) {
    return null;
  }
  if (value.uploadCountAfterWrite !== null && !isNonNegativeInteger(value.uploadCountAfterWrite)) {
    return null;
  }

  return {
    eventId: value.eventId,
    mergeType: value.mergeType,
    sourceEventsCount: value.sourceEventsCount,
    sourceFilesCount: value.sourceFilesCount,
    activitiesCount: value.activitiesCount,
    uploadLimit: value.uploadLimit,
    uploadCountAfterWrite: value.uploadCountAfterWrite,
  };
}

function asOperationRecord(value: unknown): MergeOperationRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.schemaVersion !== MERGE_OPERATION_SCHEMA_VERSION
    || (value.status !== 'processing' && value.status !== 'completed' && value.status !== 'retryable')
    || typeof value.requestFingerprint !== 'string'
    || (value.mergeType !== 'benchmark' && value.mergeType !== 'multi')
    || !isNonNegativeInteger(value.sourceEventsCount)
    || !isSafeMergeDocumentId(value.resultEventId)
    || !isNonNegativeInteger(value.attemptCount)
    || (value.ownerToken !== null && typeof value.ownerToken !== 'string')
    || typeof value.leaseExpiresAtMs !== 'number'
  ) {
    return null;
  }

  return value as unknown as MergeOperationRecord;
}

function operationDocumentPath(userID: string, requestFingerprint: string): string {
  return `users/${userID}/${MERGE_OPERATION_COLLECTION}/${requestFingerprint}`;
}

function resultEventDocumentPath(userID: string, resultEventId: string): string {
  return `users/${userID}/events/${resultEventId}`;
}

function safeErrorCode(error: unknown): string {
  const code = `${(error as { code?: unknown } | null)?.code || 'unknown'}`.trim();
  return code.slice(0, 64) || 'unknown';
}

function newProcessingRecord(
  existing: MergeOperationRecord | null,
  input: {
    requestFingerprint: string;
    mergeType: MergeType;
    sourceEventsCount: number;
    resultEventId: string;
    ownerToken: string;
    nowMs: number;
  },
): MergeOperationRecord {
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  return {
    schemaVersion: MERGE_OPERATION_SCHEMA_VERSION,
    status: 'processing',
    requestFingerprint: input.requestFingerprint,
    mergeType: input.mergeType,
    sourceEventsCount: input.sourceEventsCount,
    resultEventId: input.resultEventId,
    attemptCount: (existing?.attemptCount || 0) + 1,
    ownerToken: input.ownerToken,
    leaseExpiresAtMs: input.nowMs + MERGE_OPERATION_LEASE_MS,
    response: null,
    lastErrorCode: null,
    createdAt: existing?.createdAt || serverTimestamp,
    updatedAt: serverTimestamp,
  };
}

export function buildMergeRequestFingerprint(eventIDs: string[], mergeType: MergeType): string {
  const canonicalRequest = JSON.stringify({
    eventIDs: [...eventIDs].sort(),
    mergeType,
  });
  return createHash('sha256')
    .update(`mergeEvents:v${MERGE_OPERATION_SCHEMA_VERSION}:${canonicalRequest}`)
    .digest('hex');
}

export async function claimMergeOperation(input: {
  userID: string;
  eventIDs: string[];
  mergeType: MergeType;
  requestFingerprint: string;
}): Promise<MergeOperationClaim> {
  const db = admin.firestore();
  const operationRef = db.doc(operationDocumentPath(input.userID, input.requestFingerprint));
  const preflightSnapshot = await operationRef.get();
  const preflightRecord = asOperationRecord(preflightSnapshot.data());

  let missingCompletedResultEventId: string | null = null;
  if (
    preflightRecord?.status === 'completed'
    && preflightRecord.requestFingerprint === input.requestFingerprint
  ) {
    const completedResponse = asMergeEventResponse(preflightRecord.response);
    if (completedResponse) {
      const resultSnapshot = await db
        .doc(resultEventDocumentPath(input.userID, completedResponse.eventId))
        .get();
      if (resultSnapshot.exists) {
        return { kind: 'completed', response: completedResponse };
      }
      missingCompletedResultEventId = completedResponse.eventId;
    }
  }

  const nowMs = Date.now();
  const ownerToken = randomUUID();
  const allocatedResultEventId = admin.firestore().collection('users').doc().id;
  let decision: MergeOperationClaim | null = null;

  await setEventDocumentIfUserActive(
    input.userID,
    'merge_event_operation_claim',
    operationRef,
    {},
    undefined,
    (_incomingData, existingData) => {
      const existing = asOperationRecord(existingData);
      if (existingData && !existing) {
        throw new HttpsError('internal', 'Stored merge operation state is invalid.');
      }
      if (existing && existing.requestFingerprint !== input.requestFingerprint) {
        throw new HttpsError('internal', 'Stored merge operation fingerprint does not match.');
      }

      if (existing?.status === 'completed') {
        const completedResponse = asMergeEventResponse(existing.response);
        const completedResultIsMissing = completedResponse
          && missingCompletedResultEventId === completedResponse.eventId
          && existing.attemptCount === preflightRecord?.attemptCount;
        if (completedResponse && !completedResultIsMissing) {
          decision = { kind: 'completed', response: completedResponse };
          return existing;
        }
      }

      if (
        existing?.status === 'processing'
        && existing.leaseExpiresAtMs > nowMs
      ) {
        decision = { kind: 'in-progress' };
        return existing;
      }

      const resultEventId = existing?.resultEventId || allocatedResultEventId;
      decision = {
        kind: 'execute',
        requestFingerprint: input.requestFingerprint,
        resultEventId,
        ownerToken,
      };
      return newProcessingRecord(existing, {
        requestFingerprint: input.requestFingerprint,
        mergeType: input.mergeType,
        sourceEventsCount: input.eventIDs.length,
        resultEventId,
        ownerToken,
        nowMs,
      });
    },
  );

  if (!decision) {
    throw new HttpsError('internal', 'Could not claim merge operation.');
  }
  return decision;
}

export async function completeMergeOperation(input: {
  userID: string;
  claim: Extract<MergeOperationClaim, { kind: 'execute' }>;
  response: MergeEventResponse;
}): Promise<void> {
  if (input.response.eventId !== input.claim.resultEventId) {
    throw new HttpsError('internal', 'Merge result does not match the claimed operation.');
  }

  const operationRef = admin.firestore()
    .doc(operationDocumentPath(input.userID, input.claim.requestFingerprint));

  await setEventDocumentIfUserActive(
    input.userID,
    'merge_event_operation_complete',
    operationRef,
    {},
    undefined,
    (_incomingData, existingData) => {
      const existing = asOperationRecord(existingData);
      if (!existing || existing.requestFingerprint !== input.claim.requestFingerprint) {
        throw new HttpsError('internal', 'Merge operation disappeared before completion.');
      }

      const completedResponse = asMergeEventResponse(existing.response);
      if (existing.status === 'completed' && completedResponse) {
        return existing;
      }
      if (
        existing.ownerToken !== input.claim.ownerToken
        || existing.resultEventId !== input.claim.resultEventId
      ) {
        throw new HttpsError('aborted', 'Merge operation ownership changed. Retry the same merge request.');
      }

      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      return {
        ...existing,
        status: 'completed',
        ownerToken: null,
        leaseExpiresAtMs: 0,
        response: input.response,
        lastErrorCode: null,
        updatedAt: serverTimestamp,
        completedAt: serverTimestamp,
      } satisfies MergeOperationRecord;
    },
  );
}

export async function markMergeOperationRetryable(input: {
  userID: string;
  claim: Extract<MergeOperationClaim, { kind: 'execute' }>;
  mergeType: MergeType;
  sourceEventsCount: number;
  error: unknown;
}): Promise<void> {
  const operationRef = admin.firestore()
    .doc(operationDocumentPath(input.userID, input.claim.requestFingerprint));

  await setEventDocumentIfUserActive(
    input.userID,
    'merge_event_operation_retryable',
    operationRef,
    {},
    undefined,
    (_incomingData, existingData) => {
      const existing = asOperationRecord(existingData);
      if (existing?.status === 'completed') {
        return existing;
      }
      if (existing && existing.ownerToken !== input.claim.ownerToken) {
        return existing;
      }

      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      return {
        schemaVersion: MERGE_OPERATION_SCHEMA_VERSION,
        status: 'retryable',
        requestFingerprint: input.claim.requestFingerprint,
        mergeType: input.mergeType,
        sourceEventsCount: input.sourceEventsCount,
        resultEventId: existing?.resultEventId || input.claim.resultEventId,
        attemptCount: existing?.attemptCount || 1,
        ownerToken: null,
        leaseExpiresAtMs: 0,
        response: null,
        lastErrorCode: safeErrorCode(input.error),
        createdAt: existing?.createdAt || serverTimestamp,
        updatedAt: serverTimestamp,
      } satisfies MergeOperationRecord;
    },
  );
}
