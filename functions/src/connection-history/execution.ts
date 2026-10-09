import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD } from '../token-refresh-coordinator';
import { CONNECTION_HISTORY_COLLECTION, isConnectionHistoryRunId, type ConnectionHistoryRun } from './model';
import { withHistoryExecution } from './context';
import type { QueueItemInterface } from '../queue/queue-item.interface';
import type { QueueResult } from '../queue-utils';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';

/** Optional server-only execution context; never accepted from callable input. */
export interface HistoryExecution {
  runId: string;
  cooldownStartedAtMs: number;
  garminHealthSummaryTypes?: ConnectionHistoryRun['garminHealthSummaryTypes'];
  requiredDocumentFieldValues: ReadonlyArray<{ documentRef: admin.firestore.DocumentReference; expectedFields: Readonly<Record<string, unknown>> }>;
  tokenPath: string;
  providerUserId: string;
  beforeRequest(): Promise<void>;
  inTransaction(transaction: admin.firestore.Transaction): Promise<void>;
  onQueued(path: string): void;
}
export class HistoryLifecycleChangedError extends Error {
  constructor() { super('This history import belongs to an earlier connection.'); this.name = 'HistoryLifecycleChangedError'; }
}
export async function assertHistoryConnectionCurrent(run: ConnectionHistoryRun, transaction: admin.firestore.Transaction): Promise<void> {
  const db = admin.firestore();
  const deletion = await getUserDeletionGuardStateInTransaction(db, transaction, run.userID);
  const [root, token, meta] = await Promise.all([
    transaction.get(db.doc(run.rootPath)), transaction.get(db.doc(run.tokenPath)),
    transaction.get(db.doc(`users/${run.userID}/meta/${run.serviceName}`)),
  ]);
  if (deletion.shouldSkip || !root.exists || !token.exists || !meta.exists
    || root.data()?.[ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD] !== run.credentialGeneration
    || token.data()?.tokenCredentialGeneration !== run.credentialGeneration
    || root.data()?.disconnectOperationGeneration || root.data()?.disconnectGeneration
    || meta.data()?.connectionState !== 'connected'
    || meta.data()?.connectionStateGeneration !== run.connectionGeneration) throw new HistoryLifecycleChangedError();
}
export function historyExecution(run: ConnectionHistoryRun, paths: string[], lease?: { owner: string; revision: number }): HistoryExecution {
  const assertAuthorized = async (tx: admin.firestore.Transaction) => {
    const { hasProAccess } = await import('../utils');
    if (!(await hasProAccess(run.userID))) throw new HistoryLifecycleChangedError();
    await assertHistoryConnectionCurrent(run, tx);
    if (lease) {
      const snapshot = await tx.get(admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).doc(run.id));
      if (snapshot.data()?.leaseOwner !== lease.owner || snapshot.data()?.revision !== lease.revision || Number(snapshot.data()?.leaseExpiresAt) <= Date.now()) throw new HistoryLifecycleChangedError();
    }
  };
  return { runId: run.id, cooldownStartedAtMs: run.dateCreated,
    garminHealthSummaryTypes: run.garminHealthSummaryTypes,
    requiredDocumentFieldValues: [
      { documentRef: admin.firestore().doc(run.rootPath), expectedFields: { [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: run.credentialGeneration } },
      { documentRef: admin.firestore().doc(run.tokenPath), expectedFields: { tokenCredentialGeneration: run.credentialGeneration } },
      { documentRef: admin.firestore().doc(`users/${run.userID}/meta/${run.serviceName}`), expectedFields: { connectionState: 'connected', connectionStateGeneration: run.connectionGeneration } },
    ], tokenPath: run.tokenPath, providerUserId: run.providerUserId,
    beforeRequest: () => admin.firestore().runTransaction(assertAuthorized),
    inTransaction: assertAuthorized,
    onQueued: path => { if (!paths.includes(path)) paths.push(path); },
  };
}
export class HistoryUnavailableError extends Error {
  constructor(message: string, public readonly earliestStartMs?: number) { super(message); this.name = 'HistoryUnavailableError'; }
}
export class HistoryWindowTooLargeError extends Error {
  constructor() { super('History window must be subdivided.'); this.name = 'HistoryWindowTooLargeError'; }
}
/** Called inside the import's write/claim transaction, including manual paths. */
export function assertHistoryReservation(meta: Record<string, unknown> | undefined, runId?: string): void {
  const owner = meta?.connectionHistoryReservation;
  if (typeof owner === 'string' && owner !== runId && Number(meta?.connectionHistoryReservationExpiresAt) > Date.now()) {
    throw new HttpsError('already-exists', 'A recent-history import is already running. Please wait for it to finish.');
  }
}

export async function withHistoryQueueExecution(item: QueueItemInterface & { userID?: string }, operation: () => Promise<QueueResult>): Promise<QueueResult> {
  if (!item.connectionHistoryRunId) return operation();
  let started = false;
  try {
    if (!isConnectionHistoryRunId(item.connectionHistoryRunId)) throw new HistoryLifecycleChangedError();
    const snapshot = await admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).doc(item.connectionHistoryRunId).get();
    const run = snapshot.data() as ConnectionHistoryRun | undefined;
    if (!run || (item.firebaseUserID || item.userID) !== run.userID) throw new HistoryLifecycleChangedError();
    const execution = historyExecution(run, []);
    await execution.beforeRequest();
    started = true;
    return await withHistoryExecution(execution, operation);
  } catch (error) {
    if (!(error instanceof HistoryLifecycleChangedError)) throw error;
    const transitionItem = { ...item };
    if (!started && item.ref?.parent.id === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
      // A fetched Sleep snapshot can carry another worker's lease. It is not
      // proof that this invocation may complete that leased revision.
      delete transitionItem.processingOwner;
      delete transitionItem.processingRevision;
      delete transitionItem.processingLeaseExpiresAt;
    }
    const { markQueueItemSkipped } = await import('../queue-utils');
    return markQueueItemSkipped(transitionItem, undefined, 'connection_history_superseded', {
      skippedContext: 'CONNECTION_HISTORY_LIFECYCLE_GUARD',
    });
  }
}
