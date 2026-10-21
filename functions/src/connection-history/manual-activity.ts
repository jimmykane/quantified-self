import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { activityHistoryNextAllowedAt } from '../../../shared/history-import.constants';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { assertHistoryConnectionCurrent, assertHistoryReservation, HistoryLifecycleChangedError } from './execution';
import { CONNECTION_HISTORY_COLLECTION, createHistoryRun, historyProjection } from './model';

type ManualHistoryService = ServiceNames.SuuntoApp | ServiceNames.COROSAPI;

/** Admission only: provider work is owned by the existing durable coordinator.
 * Unversioned legacy connections retain their existing callable implementation.
 */
export async function startManualActivityHistory(
  userID: string, serviceName: ManualHistoryService, startDate: Date, endDate: Date,
) {
  const startMs = startDate.getTime(), endMs = endDate.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new HttpsError('invalid-argument', 'Invalid history date range.');
  }
  const db = admin.firestore();
  const metaRef = db.doc(`users/${userID}/meta/${serviceName}`);
  const rootRef = db.collection(serviceName === ServiceNames.SuuntoApp
    ? SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME : COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).doc(userID);
  const runId = randomUUID();
  return db.runTransaction(async tx => {
    const deletion = await getUserDeletionGuardStateInTransaction(db, tx, userID);
    if (deletion.shouldSkip) throw new HttpsError('failed-precondition', 'Account is being deleted or no longer exists.');
    const [metaSnapshot, rootSnapshot] = await Promise.all([tx.get(metaRef), tx.get(rootRef)]);
    const meta = metaSnapshot.data(), root = rootSnapshot.data();
    if (!rootSnapshot.exists || isServiceUnavailableForSyncConnection(meta)
      || root?.disconnectOperationGeneration || root?.disconnectGeneration) {
      throw new HttpsError('failed-precondition', 'Reconnect before importing history.');
    }
    const nowMs = Date.now();
    // One visible coordinator per connection, including a pending automatic
    // run whose activity reservation has not been claimed yet.
    if (meta?.connectionHistoryImport?.active) {
      throw new HttpsError('already-exists', 'A history import is already running. Please wait for it to finish.');
    }
    assertHistoryReservation(meta);
    if (Number(meta?.historyImportLeaseExpiresAt) > nowMs) {
      throw new HttpsError('already-exists', 'Another history import is running.');
    }
    const nextAllowed = activityHistoryNextAllowedAt(Number(meta?.didLastHistoryImport), Number(meta?.processedActivitiesFromLastHistoryImportCount));
    if (nextAllowed > nowMs) {
      throw new HttpsError('permission-denied', `History import is not allowed until ${new Date(nextAllowed).toISOString()}`);
    }
    const credentialGeneration = root?.activeOAuthCredentialGeneration;
    const connectionGeneration = meta?.connectionStateGeneration;
    const providerUserId = meta?.providerUserId;
    if (!credentialGeneration || !connectionGeneration || !providerUserId) return null;
    if (typeof credentialGeneration !== 'string' || typeof connectionGeneration !== 'string'
      || typeof providerUserId !== 'string' || providerUserId.includes('/') || !providerUserId.trim()) {
      throw new HttpsError('failed-precondition', 'Reconnect before importing history.');
    }
    const run = createHistoryRun(userID, serviceName, {
      requested: true, rangePreset: '30_days', runId, providerUserId, credentialGeneration,
      rootPath: rootRef.path, tokenPath: rootRef.collection('tokens').doc(providerUserId).path,
    }, connectionGeneration, nowMs);
    run.rangePreset = 'custom'; run.startMs = startMs; run.endMs = endMs;
    run.steps = run.steps.filter(step => step.id === 'activities').map(step => ({ ...step, nextStartMs: startMs }));
    // Re-check the exact token and lifecycle in the same admission transaction.
    try { await assertHistoryConnectionCurrent(run, tx); }
    catch (error) {
      if (error instanceof HistoryLifecycleChangedError) throw new HttpsError('failed-precondition', 'Reconnect before importing history.');
      throw error;
    }
    const projection = historyProjection(run);
    tx.create(db.collection(CONNECTION_HISTORY_COLLECTION).doc(run.id), run);
    tx.set(metaRef, {
      connectionHistoryImport: projection, connectionHistoryReservation: run.id,
      connectionHistoryReservationExpiresAt: nowMs + 7 * 86400000,
    }, { merge: true });
    return projection;
  });
}
