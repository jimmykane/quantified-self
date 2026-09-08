import * as admin from 'firebase-admin';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'crypto';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import {
  buildOperationalCleanupQueries,
  getExplicitFirebaseUidAssociation,
  getProviderOperationalCleanupConfig,
  OperationalCleanupQuery,
  ProviderOperationalCleanupConfig,
} from './service-operational-cleanup';
import { getServiceTokenRootDocumentRef } from './service-token-store';
import { getServiceDisconnectLifecycleGuardFromRootData, ServiceDisconnectLifecycleGuard } from './service-disconnect-pending-state';
import { getUserDeletionGuardStateInTransaction } from './shared/user-deletion-guard';
import { buildQueueCleanupTombstoneData, getQueueCleanupTombstoneDocumentRef, QUEUE_CLEANUP_TOMBSTONE_REASONS } from './queue/cleanup-tombstone';

// Server-only descendants of users: ordinary recursive account deletion owns these too.
export const SERVICE_DISCONNECT_CLEANUP_COLLECTION = 'serviceDisconnectCleanup';
const PAGE_SIZE = 25;
const LEASE_MS = 5 * 60_000;

interface CleanupTask {
  config: ProviderOperationalCleanupConfig;
  lifecycle: ServiceDisconnectLifecycleGuard;
  cutoffAt: Timestamp;
  nextAttemptAt: number;
  queryIndex: number;
  cursor: string | null;
  lease?: string;
}

export function stageServiceDisconnectCleanup(
  transaction: admin.firestore.Transaction,
  userID: string,
  serviceName: ServiceNames,
  tokenData: Record<string, unknown>,
  lifecycle: ServiceDisconnectLifecycleGuard,
): void {
  const config = getProviderOperationalCleanupConfig(serviceName, tokenData);
  if (!config) return;
  const id = createHash('sha256').update(JSON.stringify([
    serviceName, lifecycle.disconnectOperationGeneration, config.providerUserId,
  ])).digest('hex');
  const ref = admin.firestore().collection('users').doc(userID).collection(SERVICE_DISCONNECT_CLEANUP_COLLECTION).doc(id);
  // The caller has checked deletion, lifecycle and the credential version in this
  // transaction. No credentials, callback URLs, OAuth state or PKCE are copied.
  transaction.set(ref, {
    config, lifecycle, cutoffAt: FieldValue.serverTimestamp(),
    nextAttemptAt: Date.now(), queryIndex: 0, cursor: null,
  });
}

class CleanupSuperseded extends Error {}

function sameLifecycle(root: admin.firestore.DocumentSnapshot, task: CleanupTask): boolean {
  // The original explicit disconnect may already have removed its empty root.
  if (!root.exists) return true;
  const current = getServiceDisconnectLifecycleGuardFromRootData(root.data());
  // Finalization may have cleared an empty root's operation fields. A reconnect
  // changes either the flow or credential generation, so it cannot match this.
  if (!current.oauthFlowGeneration && !current.disconnectOperationGeneration
    && current.oauthCredentialGeneration === task.lifecycle.oauthCredentialGeneration
    && current.disconnectGeneration === task.lifecycle.disconnectGeneration) return true;
  return Object.entries(task.lifecycle).every(([key, value]) => current[key as keyof ServiceDisconnectLifecycleGuard] === value);
}

async function assertCleanupCurrent(
  db: admin.firestore.Firestore,
  transaction: admin.firestore.Transaction,
  taskRef: admin.firestore.DocumentReference,
  task: CleanupTask,
  lease: string,
): Promise<void> {
  const uid = taskRef.parent.parent!.id;
  const [deletion, currentTask, root] = await Promise.all([
    getUserDeletionGuardStateInTransaction(db, transaction, uid),
    transaction.get(taskRef),
    transaction.get(getServiceTokenRootDocumentRef(uid, task.config.serviceName)),
  ]);
  if (deletion.shouldSkip || currentTask.data()?.lease !== lease || !sameLifecycle(root, task)) {
    throw new CleanupSuperseded();
  }
}

/** Recursive semantics with every delete ordered against reconnect and account deletion. */
async function deleteOperationalTree(
  db: admin.firestore.Firestore,
  taskRef: admin.firestore.DocumentReference,
  task: CleanupTask,
  lease: string,
  query: OperationalCleanupQuery,
  candidate: admin.firestore.QueryDocumentSnapshot,
): Promise<void> {
  const uid = taskRef.parent.parent!.id;
  const data = candidate.data();
  const owner = getExplicitFirebaseUidAssociation(query.collectionName, data);
  if ((owner && owner !== uid) || !query.matches(data) || candidate.createTime.valueOf() > task.cutoffAt.valueOf()) return;
  const source = typeof query.sourceCollectionName === 'function' ? query.sourceCollectionName(data) : query.sourceCollectionName;
  if (query.collectionName === 'failed_jobs' && !source) return;
  const connectedQuery = db.collectionGroup('tokens')
    .where(task.config.providerUserIdField, '==', task.config.providerUserId)
    .where('serviceName', '==', task.config.serviceName).limit(1);
  // Provider-only rows can belong to another connected user. Skip those rows
  // without blocking progress on the disconnecting user's own queue entries.
  if (!owner && !(await connectedQuery.get()).empty) return;

  const writer = db.bulkWriter();
  const pending: Promise<admin.firestore.WriteResult>[] = [];
  const flush = writer.flush.bind(writer);
  // recursiveDelete streams descendants through the public BulkWriter methods.
  // Use transactions here so a reconnect cannot race an unguarded bulk delete.
  writer.delete = (ref) => {
    const isRoot = ref.path === candidate.ref.path;
    const prior = isRoot ? Promise.all(pending) : Promise.resolve();
    const operation = prior.then(() => db.runTransaction(async transaction => {
      await assertCleanupCurrent(db, transaction, taskRef, task, lease);
      const current = await transaction.get(candidate.ref);
      if (!current.exists || !current.updateTime!.isEqual(candidate.updateTime)) throw new CleanupSuperseded();
      if (!owner) {
        const connected = await transaction.get(connectedQuery);
        if (!connected.empty) throw new CleanupSuperseded();
      }
      if (isRoot && source) {
        transaction.set(getQueueCleanupTombstoneDocumentRef(db, source, candidate.id),
          buildQueueCleanupTombstoneData(source, candidate.id, QUEUE_CLEANUP_TOMBSTONE_REASONS.ServiceDisconnectCleanup));
      }
      transaction.delete(ref);
      // recursiveDelete only consumes completion/failure, not the write time.
      const writeTime = Timestamp.now();
      return { writeTime, isEqual: (other: admin.firestore.WriteResult) => writeTime.isEqual(other.writeTime) };
    }));
    pending.push(operation);
    return operation;
  };
  writer.flush = async () => { await Promise.allSettled(pending); await flush(); };
  try {
    await db.recursiveDelete(candidate.ref, writer);
  } finally {
    // close() must call the synchronous SDK flush before it marks itself closed.
    writer.flush = flush;
    await writer.close();
  }
}

export async function processServiceDisconnectCleanup(ref: admin.firestore.DocumentReference): Promise<void> {
  const db = admin.firestore();
  const lease = randomUUID();
  const task = await db.runTransaction(async transaction => {
    const [snapshot, deletion] = await Promise.all([
      transaction.get(ref), getUserDeletionGuardStateInTransaction(db, transaction, ref.parent.parent!.id),
    ]);
    if (!snapshot.exists) return null;
    if (deletion.shouldSkip) {
      // These task documents are leaves by design; no writer creates descendants.
      transaction.delete(ref);
      return null;
    }
    const data = snapshot.data() as CleanupTask;
    if (data.nextAttemptAt > Date.now()) return null;
    transaction.update(ref, { lease, nextAttemptAt: Date.now() + LEASE_MS });
    return data;
  });
  if (!task) return;

  try {
    const queries = buildOperationalCleanupQueries(task.config);
    let remaining = PAGE_SIZE;
    const deadline = Date.now() + 15_000;
    while (task.queryIndex < queries.length && remaining > 0 && Date.now() < deadline) {
      const query = queries[task.queryIndex];
      let pageQuery = db.collection(query.collectionName).where(query.fieldName, '==', task.config.providerUserId)
        .orderBy(FieldPath.documentId()).limit(remaining);
      if (task.cursor) pageQuery = pageQuery.startAfter(task.cursor);
      const page = await pageQuery.get();
      for (const doc of page.docs) {
        await deleteOperationalTree(db, ref, task, lease, query, doc);
      }
      if (page.size < remaining) { task.queryIndex++; task.cursor = null; }
      else task.cursor = page.docs[page.docs.length - 1].id;
      remaining -= page.size;
    }
    await db.runTransaction(async transaction => {
      await assertCleanupCurrent(db, transaction, ref, task, lease);
      if (task.queryIndex === queries.length) transaction.delete(ref); // Leaf task, no descendants.
      else transaction.update(ref, { queryIndex: task.queryIndex, cursor: task.cursor, nextAttemptAt: Date.now() });
    });
    logger.info('[ExplicitDisconnectCleanup] Cleanup page completed.', {
      serviceName: task.config.serviceName, examinedCount: PAGE_SIZE - remaining,
      completed: task.queryIndex === queries.length,
    });
  } catch (error) {
    // A replaced lifecycle retires only this operation's task. Transient errors
    // retain the page cursor and lease delay, so the scheduler retries it forever.
    await db.runTransaction(async transaction => {
      const [snapshot, root, deletion] = await Promise.all([
        transaction.get(ref), transaction.get(getServiceTokenRootDocumentRef(ref.parent.parent!.id, task.config.serviceName)),
        getUserDeletionGuardStateInTransaction(db, transaction, ref.parent.parent!.id),
      ]);
      if (snapshot.data()?.lease !== lease) return;
      if (deletion.shouldSkip || !sameLifecycle(root, task)) transaction.delete(ref); // Leaf task.
    });
    logger.warn('[ExplicitDisconnectCleanup] Page deferred or superseded.', {
      serviceName: task.config.serviceName,
      reason: error instanceof CleanupSuperseded ? 'lifecycle_or_document_changed' : 'cleanup_retry',
    });
  }
}

export async function retryServiceDisconnectCleanup(): Promise<void> {
  const page = await admin.firestore().collectionGroup(SERVICE_DISCONNECT_CLEANUP_COLLECTION)
    .where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(10).get();
  await Promise.all(page.docs.map(async doc => {
    try { await processServiceDisconnectCleanup(doc.ref); }
    catch { logger.error('[ExplicitDisconnectCleanup] Could not claim or checkpoint cleanup.'); }
  }));
}
