import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { activityHistoryNextAllowedAt } from '../../../shared/history-import.constants';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { assertHistoryConnectionCurrent, assertHistoryReservation, HistoryLifecycleChangedError } from './execution';
import { CONNECTION_HISTORY_COLLECTION, createHistoryRun, historyProjection } from './model';

type ManualHistoryService = ServiceNames.GarminAPI | ServiceNames.SuuntoApp | ServiceNames.COROSAPI | ServiceNames.WahooAPI;
const TOKEN_COLLECTIONS: Record<ManualHistoryService, string> = {
  [ServiceNames.GarminAPI]: GARMIN_API_TOKENS_COLLECTION_NAME,
  [ServiceNames.SuuntoApp]: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
  [ServiceNames.COROSAPI]: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME,
  [ServiceNames.WahooAPI]: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
};
const PROVIDER_ID_FIELDS: Record<ManualHistoryService, string> = {
  [ServiceNames.GarminAPI]: 'userID',
  [ServiceNames.SuuntoApp]: 'userName',
  [ServiceNames.COROSAPI]: 'openId',
  [ServiceNames.WahooAPI]: 'wahooUserID',
};

/** Admission only: provider work is owned by the existing durable coordinator.
 * Older connections can recover a missing account ID from one verified current token.
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
  const rootRef = db.collection(TOKEN_COLLECTIONS[serviceName]).doc(userID);
  const runId = randomUUID();
  // A Firestore retry must not silently migrate this request onto a replacement connection.
  let recoveredIdentity: string | undefined;
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
    const nextAllowed = activityHistoryNextAllowedAt(Number(meta?.didLastHistoryImport), Number(meta?.processedActivitiesFromLastHistoryImportCount), serviceName === ServiceNames.GarminAPI);
    if (nextAllowed > nowMs) {
      throw new HttpsError('permission-denied', `History import is not allowed until ${new Date(nextAllowed).toISOString()}`);
    }
    const credentialGeneration = root?.activeOAuthCredentialGeneration;
    const connectionGeneration = meta?.connectionStateGeneration;
    let providerUserId = meta?.providerUserId;
    if (typeof credentialGeneration !== 'string' || typeof connectionGeneration !== 'string'
      || !credentialGeneration.trim() || !connectionGeneration.trim()) {
      throw new HttpsError('failed-precondition', 'Reconnect before importing history.');
    }
    const missingProviderId = providerUserId === undefined || providerUserId === null || providerUserId === '';
    if (missingProviderId) {
      const identityField = PROVIDER_ID_FIELDS[serviceName];
      const candidates = await tx.get(rootRef.collection('tokens')
        .where('tokenCredentialGeneration', '==', credentialGeneration).select(identityField).limit(2));
      if (candidates.size !== 1 || candidates.docs[0].data()[identityField] !== candidates.docs[0].id) {
        throw new HttpsError('failed-precondition', 'Reconnect before importing history.');
      }
      providerUserId = candidates.docs[0].id;
    }
    if (typeof providerUserId !== 'string' || providerUserId.includes('/') || !providerUserId.trim()) {
      throw new HttpsError('failed-precondition', 'Reconnect before importing history.');
    }
    const identity = JSON.stringify([credentialGeneration, connectionGeneration, providerUserId]);
    if (recoveredIdentity !== undefined && recoveredIdentity !== identity) {
      throw new HttpsError('failed-precondition', 'Connection changed. Please retry the history request.');
    }
    if (missingProviderId) recoveredIdentity = identity;
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
      ...(missingProviderId ? { providerUserId } : {}),
      connectionHistoryImport: projection, connectionHistoryReservation: run.id,
      connectionHistoryReservationExpiresAt: nowMs + 7 * 86400000,
    }, { merge: true });
    return projection;
  });
}
