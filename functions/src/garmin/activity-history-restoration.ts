import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isConnectionHistoryRunId } from '../connection-history/model';
import { isReimportableCompletedActivity } from '../connection-history/queue-replacement';
import { getActiveRevisionProcessingLease } from '../queue/revision-processing-lease';
import type { GarminAPIActivityQueueItemInterface } from '../queue/queue-item.interface';
import { getUserDeletionGuardStateInTransaction, UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './constants';

/** Permission to refetch a selected range, not proof of a callback's history origin. */
export interface GarminActivityHistoryRestoration {
  id: string;
  startMs: number;
  endMs: number;
  providerUserId: string;
  connectionGeneration: string;
  credentialGeneration: string;
  runId?: string;
}

interface RestorationMeta {
  activityHistoryRestoration?: unknown;
  providerUserId?: unknown;
  connectionState?: unknown;
  connectionStateGeneration?: unknown;
}

export function getGarminActivityHistoryRestoration(
  meta: RestorationMeta | null | undefined, providerUserId: string, startTimeInSeconds: number,
): GarminActivityHistoryRestoration | undefined {
  const value = meta?.activityHistoryRestoration as Partial<GarminActivityHistoryRestoration> | undefined;
  const startMs = startTimeInSeconds * 1000;
  if (!value || !isConnectionHistoryRunId(value.id) || typeof startTimeInSeconds !== 'number' || !Number.isFinite(startMs)
    || typeof value.startMs !== 'number' || !Number.isFinite(value.startMs)
    || typeof value.endMs !== 'number' || !Number.isFinite(value.endMs) || value.startMs > value.endMs
    || startMs < value.startMs || startMs > value.endMs
    || value.providerUserId !== providerUserId || meta?.providerUserId !== providerUserId
    || meta?.connectionState !== 'connected' || typeof value.connectionGeneration !== 'string' || !value.connectionGeneration
    || meta.connectionStateGeneration !== value.connectionGeneration
    || typeof value.credentialGeneration !== 'string' || !value.credentialGeneration
    || (value.runId !== undefined && value.runId !== value.id)) return undefined;
  return value as GarminActivityHistoryRestoration;
}

export function createGarminActivityHistoryRestoration(
  meta: RestorationMeta | undefined, root: Record<string, unknown> | undefined,
  id: string, startMs: number, endMs: number, runId?: string,
): GarminActivityHistoryRestoration | undefined {
  if (root?.disconnectOperationGeneration || root?.disconnectGeneration) return undefined;
  const previous = meta?.activityHistoryRestoration as Partial<GarminActivityHistoryRestoration> | undefined;
  const sameRequest = previous?.id === id && previous?.connectionGeneration === meta?.connectionStateGeneration
    && previous?.credentialGeneration === root?.activeOAuthCredentialGeneration && previous?.providerUserId === meta?.providerUserId;
  const value = {
    id, startMs: sameRequest ? Math.min(previous.startMs!, startMs) : startMs,
    endMs: sameRequest ? Math.max(previous.endMs!, endMs) : endMs,
    providerUserId: meta?.providerUserId, connectionGeneration: meta?.connectionStateGeneration,
    credentialGeneration: root?.activeOAuthCredentialGeneration, ...(runId ? { runId } : {}),
  };
  if (typeof value.providerUserId !== 'string' || !value.providerUserId) return undefined;
  return getGarminActivityHistoryRestoration({ ...meta, activityHistoryRestoration: value }, value.providerUserId, startMs / 1000);
}

/** Recheck authority and replace only a completed receipt; pending work keeps its retry state. */
export async function restoreCompletedGarminActivity(
  ref: admin.firestore.DocumentReference, payload: GarminAPIActivityQueueItemInterface,
  expected: GarminActivityHistoryRestoration,
): Promise<boolean> {
  const userID = payload.firebaseUserID;
  if (!userID) return false;
  const db = admin.firestore();
  return db.runTransaction(async transaction => {
    const current = await transaction.get(ref);
    const existing = current.data();
    if (!current.exists || !existing || existing.firebaseUserID !== userID || existing.userID !== payload.userID
      || existing.activityFileID !== payload.activityFileID || existing.queueRevision === expected.id
      || !isReimportableCompletedActivity(existing) || getActiveRevisionProcessingLease(existing)) return false;
    let deletion;
    try { deletion = await getUserDeletionGuardStateInTransaction(db, transaction, userID); }
    catch (error) { throw new UserDeletionGuardReadError(userID, 'garmin_history_restoration', error); }
    if (deletion.shouldSkip) return false;
    const [meta, root] = await Promise.all([
      transaction.get(db.doc(`users/${userID}/meta/${ServiceNames.GarminAPI}`)),
      transaction.get(db.collection(GARMIN_API_TOKENS_COLLECTION_NAME).doc(userID)),
    ]);
    const permission = getGarminActivityHistoryRestoration(meta.data(), payload.userID, payload.startTimeInSeconds);
    if (!meta.exists || !root.exists || !permission || permission.id !== expected.id
      || permission.connectionGeneration !== expected.connectionGeneration || permission.credentialGeneration !== expected.credentialGeneration
      || root.data()?.activeOAuthCredentialGeneration !== permission.credentialGeneration
      || root.data()?.disconnectOperationGeneration || root.data()?.disconnectGeneration) return false;
    transaction.set(ref, payload);
    return true;
  });
}
