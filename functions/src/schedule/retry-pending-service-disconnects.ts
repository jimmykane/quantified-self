import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { getTokenData } from '../tokens';
import {
  cleanupServiceConnectionForUser,
  SERVICE_AUTH_CLEANUP_REASONS,
} from '../service-auth-lifecycle';
import {
  retryPendingServiceRouteRestore,
  retryWahooReconnectQueueRelease,
} from '../service-connection-meta';
import {
  clearServiceDisconnectPending,
  getServiceDisconnectLifecycleGuardFromRootData,
  isServiceDisconnectPendingData,
  PENDING_SERVICE_DISCONNECT_BATCH_LIMIT,
  PendingServiceDisconnectFailure,
  PendingServiceDisconnectRootData,
  recordServiceDisconnectRetryFailure,
} from '../service-disconnect-pending';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

interface PendingDisconnectCollectionConfig {
  serviceName: ServiceNames;
  collectionName: string;
}

type PendingDisconnectScanType = 'due_retry' | 'restored_entitlement';
type LifecycleRepairScanType = 'wahoo_reconnect_release' | 'route_restore';

interface PendingDisconnectScanCursorData {
  documentId?: string;
  disconnectNextAttemptAt?: FirebaseFirestore.Timestamp;
}

interface LifecycleRepairScanCursorData {
  documentPath?: string;
}

const PENDING_SERVICE_DISCONNECT_SCAN_CURSOR_COLLECTION = 'pendingServiceDisconnectRetryCursors';
const LIFECYCLE_REPAIR_BATCH_LIMIT = 25;
const LIFECYCLE_REPAIR_CONCURRENCY = 5;

const PENDING_DISCONNECT_COLLECTIONS: ReadonlyArray<PendingDisconnectCollectionConfig> = [
  {
    serviceName: ServiceNames.SuuntoApp,
    collectionName: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
  },
  {
    serviceName: ServiceNames.COROSAPI,
    collectionName: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME,
  },
  {
    serviceName: ServiceNames.GarminAPI,
    collectionName: GARMIN_API_TOKENS_COLLECTION_NAME,
  },
  {
    serviceName: ServiceNames.WahooAPI,
    collectionName: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
  },
];

async function isGracePeriodActive(uid: string): Promise<boolean> {
  const systemDoc = await admin.firestore().doc(`users/${uid}/system/status`).get();
  const gracePeriodUntil = systemDoc.data()?.gracePeriodUntil as FirebaseFirestore.Timestamp | undefined;
  return !!gracePeriodUntil && gracePeriodUntil.toMillis() > Timestamp.now().toMillis();
}

async function hasActiveProSubscription(uid: string): Promise<boolean> {
  const activeSubSnapshot = await admin.firestore().collection(`customers/${uid}/subscriptions`)
    .where('status', 'in', ['active', 'trialing'])
    .orderBy('created', 'desc')
    .limit(1)
    .get();
  const subscription = activeSubSnapshot.empty ? null : activeSubSnapshot.docs[0].data();
  return subscription?.role === 'pro';
}

async function shouldKeepConnectionForCurrentEntitlement(uid: string): Promise<boolean> {
  const [pro, gracePeriodActive] = await Promise.all([
    hasActiveProSubscription(uid),
    isGracePeriodActive(uid),
  ]);
  return pro || gracePeriodActive;
}

function getPendingDisconnectScanCursorRef(
  config: PendingDisconnectCollectionConfig,
  scanType: PendingDisconnectScanType,
): FirebaseFirestore.DocumentReference {
  return admin.firestore()
    .doc(`${PENDING_SERVICE_DISCONNECT_SCAN_CURSOR_COLLECTION}/${config.collectionName}_${scanType}`);
}

async function getPendingDisconnectScanCursor(
  config: PendingDisconnectCollectionConfig,
  scanType: PendingDisconnectScanType,
): Promise<PendingDisconnectScanCursorData | null> {
  const snapshot = await getPendingDisconnectScanCursorRef(config, scanType).get();
  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() as PendingDisconnectScanCursorData | undefined;
  return data?.documentId ? data : null;
}

async function clearPendingDisconnectScanCursor(
  config: PendingDisconnectCollectionConfig,
  scanType: PendingDisconnectScanType,
): Promise<void> {
  // Cursor docs are flat scheduler-owned checkpoints; this feature never writes descendants under them.
  await getPendingDisconnectScanCursorRef(config, scanType).delete();
}

function getSnapshotField(snapshot: admin.firestore.QueryDocumentSnapshot, fieldName: string): unknown {
  const snapshotGetter = (snapshot as { get?: (fieldPath: string) => unknown }).get;
  if (typeof snapshotGetter === 'function') {
    return snapshotGetter.call(snapshot, fieldName);
  }

  return (snapshot.data() as Record<string, unknown>)[fieldName];
}

function getLifecycleRepairScanCursorRef(
  scanType: LifecycleRepairScanType,
): FirebaseFirestore.DocumentReference {
  return admin.firestore().doc(
    `${PENDING_SERVICE_DISCONNECT_SCAN_CURSOR_COLLECTION}/lifecycle_${scanType}`,
  );
}

async function getLifecycleRepairPage(
  scanType: LifecycleRepairScanType,
  markerField: 'wahooReconnectReleasePending' | 'routeRestorePending',
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const cursorRef = getLifecycleRepairScanCursorRef(scanType);
  const cursorSnapshot = await cursorRef.get();
  const cursor = cursorSnapshot.exists
    ? cursorSnapshot.data() as LifecycleRepairScanCursorData | undefined
    : undefined;

  const runQuery = async (documentPath?: string) => {
    let query = admin.firestore()
      .collectionGroup('meta')
      .where(markerField, '==', true)
      .orderBy(FieldPath.documentId())
      .limit(LIFECYCLE_REPAIR_BATCH_LIMIT);
    if (documentPath) {
      query = query.startAfter(admin.firestore().doc(documentPath));
    }
    return query.get();
  };

  let snapshot = await runQuery(cursor?.documentPath);
  if (snapshot.docs.length === 0 && cursor?.documentPath) {
    // Cursor docs are flat scheduler-owned checkpoints with no descendants.
    await cursorRef.delete();
    snapshot = await runQuery();
  }

  return snapshot.docs;
}

async function checkpointLifecycleRepairPage(
  scanType: LifecycleRepairScanType,
  docs: readonly admin.firestore.QueryDocumentSnapshot[],
): Promise<void> {
  const cursorRef = getLifecycleRepairScanCursorRef(scanType);
  if (docs.length < LIFECYCLE_REPAIR_BATCH_LIMIT) {
    // Reaching the end wraps the next scheduled run back to the first marker.
    await cursorRef.delete();
  } else {
    await cursorRef.set({
      documentPath: docs[docs.length - 1].ref.path,
    }, { merge: true });
  }
}

async function processWithBoundedConcurrency<T>(
  items: readonly T[],
  operation: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += LIFECYCLE_REPAIR_CONCURRENCY) {
    await Promise.all(items
      .slice(index, index + LIFECYCLE_REPAIR_CONCURRENCY)
      .map(operation));
  }
}

function getUserIDFromServiceMetaSnapshot(
  snapshot: admin.firestore.QueryDocumentSnapshot,
): string | null {
  const metaCollection = snapshot.ref.parent;
  const userRef = metaCollection.parent;
  if (
    metaCollection.id !== 'meta'
    || !userRef
    || userRef.parent.id !== 'users'
  ) {
    return null;
  }
  return userRef.id || null;
}

async function updatePendingDisconnectScanCursor(
  config: PendingDisconnectCollectionConfig,
  scanType: PendingDisconnectScanType,
  docs: admin.firestore.QueryDocumentSnapshot[],
): Promise<void> {
  if (docs.length < PENDING_SERVICE_DISCONNECT_BATCH_LIMIT) {
    await clearPendingDisconnectScanCursor(config, scanType);
    return;
  }

  const lastDoc = docs[docs.length - 1];
  const cursorData: PendingDisconnectScanCursorData = {
    documentId: lastDoc.id,
  };

  if (scanType === 'due_retry') {
    const disconnectNextAttemptAt = getSnapshotField(lastDoc, 'disconnectNextAttemptAt');
    if (!disconnectNextAttemptAt) {
      await clearPendingDisconnectScanCursor(config, scanType);
      return;
    }
    cursorData.disconnectNextAttemptAt = disconnectNextAttemptAt as FirebaseFirestore.Timestamp;
  }

  await getPendingDisconnectScanCursorRef(config, scanType).set(cursorData, { merge: true });
}

async function getDuePendingDisconnectRoots(
  config: PendingDisconnectCollectionConfig,
  now: Timestamp,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const scanType: PendingDisconnectScanType = 'due_retry';
  const cursor = await getPendingDisconnectScanCursor(config, scanType);

  const runQuery = async (pageCursor: PendingDisconnectScanCursorData | null) => {
    let query = admin.firestore()
      .collection(config.collectionName)
      .where('disconnectState', '==', 'disconnect_pending')
      .where('disconnectManualReviewRequired', '==', false)
      .where('disconnectNextAttemptAt', '<=', now)
      .orderBy('disconnectNextAttemptAt')
      .orderBy(FieldPath.documentId())
      .limit(PENDING_SERVICE_DISCONNECT_BATCH_LIMIT);

    if (pageCursor?.documentId && pageCursor.disconnectNextAttemptAt) {
      query = query.startAfter(pageCursor.disconnectNextAttemptAt, pageCursor.documentId);
    }

    return query.get();
  };

  let snapshot = await runQuery(cursor);
  if (snapshot.docs.length === 0 && cursor?.documentId) {
    await clearPendingDisconnectScanCursor(config, scanType);
    snapshot = await runQuery(null);
  }

  await updatePendingDisconnectScanCursor(config, scanType, snapshot.docs);
  return snapshot.docs;
}

async function getPendingDisconnectRootsForEntitlementCheck(
  config: PendingDisconnectCollectionConfig,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const scanType: PendingDisconnectScanType = 'restored_entitlement';
  const cursor = await getPendingDisconnectScanCursor(config, scanType);

  const runQuery = async (pageCursor: PendingDisconnectScanCursorData | null) => {
    let query = admin.firestore()
      .collection(config.collectionName)
      .where('disconnectState', '==', 'disconnect_pending')
      .orderBy(FieldPath.documentId())
      .limit(PENDING_SERVICE_DISCONNECT_BATCH_LIMIT);

    if (pageCursor?.documentId) {
      query = query.startAfter(pageCursor.documentId);
    }

    return query.get();
  };

  let snapshot = await runQuery(cursor);
  if (snapshot.docs.length === 0 && cursor?.documentId) {
    await clearPendingDisconnectScanCursor(config, scanType);
    snapshot = await runQuery(null);
  }

  await updatePendingDisconnectScanCursor(config, scanType, snapshot.docs);
  return snapshot.docs;
}

async function clearPendingDisconnectRootIfEntitled(
  config: PendingDisconnectCollectionConfig,
  rootSnapshot: admin.firestore.QueryDocumentSnapshot,
): Promise<boolean> {
  const rootData = rootSnapshot.data() as PendingServiceDisconnectRootData;
  if (!isServiceDisconnectPendingData(rootData)) {
    return false;
  }

  const userID = rootSnapshot.id;
  if (!(await shouldKeepConnectionForCurrentEntitlement(userID))) {
    return false;
  }

  await clearServiceDisconnectPending(userID, config.serviceName);
  logger.info('[RetryPendingServiceDisconnects] Cleared pending disconnect because entitlement is active again.', {
    userID,
    serviceName: config.serviceName,
  });
  return true;
}

async function clearPendingDisconnectsForRestoredEntitlements(
  config: PendingDisconnectCollectionConfig,
): Promise<number> {
  const roots = await getPendingDisconnectRootsForEntitlementCheck(config);
  let clearedCount = 0;

  for (const rootSnapshot of roots) {
    try {
      if (await clearPendingDisconnectRootIfEntitled(config, rootSnapshot)) {
        clearedCount += 1;
      }
    } catch (error) {
      logger.error('[RetryPendingServiceDisconnects] Failed to check restored entitlement for pending disconnect root.', {
        userID: rootSnapshot.id,
        serviceName: config.serviceName,
        error: error instanceof Error ? error.message : `${error}`,
      });
    }
  }

  return clearedCount;
}

function buildUnexpectedPartialCleanupFailure(
  config: PendingDisconnectCollectionConfig,
  rootSnapshot: admin.firestore.QueryDocumentSnapshot,
): PendingServiceDisconnectFailure {
  return {
    tokenID: 'unknown',
    statusCode: null,
    errorMessage: `${config.serviceName} pending disconnect local cleanup remained partial for user ${rootSnapshot.id} without a retryable partner failure.`,
    lifecycleGuard: getServiceDisconnectLifecycleGuardFromRootData(
      rootSnapshot.data() as Record<string, unknown>,
    ),
  };
}

async function retryPendingDisconnectRoot(
  config: PendingDisconnectCollectionConfig,
  rootSnapshot: admin.firestore.QueryDocumentSnapshot,
): Promise<void> {
  const userID = rootSnapshot.id;
  const rootData = rootSnapshot.data() as PendingServiceDisconnectRootData;

  if (!isServiceDisconnectPendingData(rootData)) {
    return;
  }

  if (await shouldKeepConnectionForCurrentEntitlement(userID)) {
    await clearServiceDisconnectPending(userID, config.serviceName);
    logger.info('[RetryPendingServiceDisconnects] Cleared pending disconnect because entitlement is active again.', {
      userID,
      serviceName: config.serviceName,
    });
    return;
  }

  const disconnectLifecycleGuard = getServiceDisconnectLifecycleGuardFromRootData(
    rootSnapshot.data() as Record<string, unknown>,
  );

  const outcome = await cleanupServiceConnectionForUser(
    userID,
    config.serviceName,
    SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
    {
      missingTokensBehavior: 'ignore',
      tokenResolver: (doc) => getTokenData(doc, config.serviceName, false, {
        recoverTerminalAuthFailure: false,
        allowDisconnectPendingTokenUse: true,
      }),
      disconnectLifecycleGuard,
    },
  );

  const retryableFailure = outcome.retryableDisconnectFailures?.[0];
  if (!retryableFailure) {
    if (outcome.localCleanupStatus === 'partial') {
      const partialCleanupFailure = buildUnexpectedPartialCleanupFailure(config, rootSnapshot);
      const didRecordRetryFailure = await recordServiceDisconnectRetryFailure(userID, config.serviceName, partialCleanupFailure);
      if (!didRecordRetryFailure) {
        return;
      }
      logger.warn('[RetryPendingServiceDisconnects] Pending disconnect local cleanup remained partial without a recorded retryable failure; scheduled another attempt if retry budget remains.', {
        userID,
        serviceName: config.serviceName,
        localCleanupStatus: outcome.localCleanupStatus,
      });
      return;
    }

    logger.info('[RetryPendingServiceDisconnects] Pending disconnect completed or reached terminal local cleanup.', {
      userID,
      serviceName: config.serviceName,
      deletedTokenCount: outcome.deletedTokenCount,
      preservedTokenCount: outcome.preservedTokenCount,
      localCleanupStatus: outcome.localCleanupStatus,
    });
    return;
  }

  const guardedRetryableFailure = {
    ...retryableFailure,
    lifecycleGuard: disconnectLifecycleGuard,
  };
  const didRecordRetryFailure = await recordServiceDisconnectRetryFailure(
    userID,
    config.serviceName,
    guardedRetryableFailure,
  );
  if (!didRecordRetryFailure) {
    return;
  }
  logger.warn('[RetryPendingServiceDisconnects] Pending disconnect retry failed; scheduled another attempt if retry budget remains.', {
    userID,
    serviceName: config.serviceName,
    tokenID: guardedRetryableFailure.tokenID,
    statusCode: guardedRetryableFailure.statusCode,
  });
}

/**
 * Reconnect callbacks can release several independent queue collections. If
 * one write fails after earlier rows succeeded, the Wahoo meta marker keeps
 * the remainder durable until this scheduler finishes the idempotent release.
 * These markers only exist after a partial operational failure. Process one
 * cursor-checkpointed page per run so a large backlog cannot consume the
 * complete scheduler window or repeatedly starve later accounts.
 */
async function retryPendingWahooReconnectQueueReleases(): Promise<number> {
  const docs = await getLifecycleRepairPage(
    'wahoo_reconnect_release',
    'wahooReconnectReleasePending',
  );
  let repairedCount = 0;

  await processWithBoundedConcurrency(docs, async metaSnapshot => {
    if (metaSnapshot.id !== ServiceNames.WahooAPI) return;
    const userID = getUserIDFromServiceMetaSnapshot(metaSnapshot);
    if (!userID) return;

    try {
      if (await retryWahooReconnectQueueRelease(userID)) {
        repairedCount += 1;
      }
    } catch (error) {
      logger.error('[RetryPendingServiceDisconnects] Failed to repair a Wahoo reconnect queue release.', {
        userID,
        serviceName: ServiceNames.WahooAPI,
        error: error instanceof Error ? error.message : `${error}`,
      });
    }
  });
  await checkpointLifecycleRepairPage('wahoo_reconnect_release', docs);

  return repairedCount;
}

async function retryPendingServiceRouteRestorations(): Promise<number> {
  const docs = await getLifecycleRepairPage('route_restore', 'routeRestorePending');
  const knownServiceNames = new Set<string>(Object.values(ServiceNames));
  let repairedCount = 0;

  await processWithBoundedConcurrency(docs, async metaSnapshot => {
    if (!knownServiceNames.has(metaSnapshot.id)) return;
    const userID = getUserIDFromServiceMetaSnapshot(metaSnapshot);
    if (!userID) return;

    try {
      if (await retryPendingServiceRouteRestore(userID, metaSnapshot.id as ServiceNames)) {
        repairedCount += 1;
      }
    } catch (error) {
      logger.error('[RetryPendingServiceDisconnects] Failed to repair route restoration.', {
        userID,
        serviceName: metaSnapshot.id,
        error: error instanceof Error ? error.message : `${error}`,
      });
    }
  });
  await checkpointLifecycleRepairPage('route_restore', docs);

  return repairedCount;
}

export const retryPendingServiceDisconnects = onSchedule({
  region: 'europe-west2',
  secrets: FUNCTION_SECRET_BINDINGS.retryPendingServiceDisconnects,
  schedule: 'every 30 minutes',
  timeoutSeconds: 300,
  memory: '512MiB',
}, async () => {
  const now = Timestamp.now();

  // Repair already-connected accounts first. Pending-disconnect scans can
  // involve provider I/O, so putting these bounded pages first prevents a
  // slow provider batch from starving queue release or route restoration.
  const repairedWahooReconnectReleaseCount = await retryPendingWahooReconnectQueueReleases();
  logger.info('[RetryPendingServiceDisconnects] Repaired pending Wahoo reconnect queue releases.', {
    serviceName: ServiceNames.WahooAPI,
    repairedCount: repairedWahooReconnectReleaseCount,
  });

  const repairedRouteRestoreCount = await retryPendingServiceRouteRestorations();
  logger.info('[RetryPendingServiceDisconnects] Repaired pending service route restorations.', {
    repairedCount: repairedRouteRestoreCount,
  });

  for (const config of PENDING_DISCONNECT_COLLECTIONS) {
    const restoredEntitlementClearedCount = await clearPendingDisconnectsForRestoredEntitlements(config);
    logger.info('[RetryPendingServiceDisconnects] Checked pending disconnect roots for restored entitlements.', {
      serviceName: config.serviceName,
      clearedCount: restoredEntitlementClearedCount,
    });

    const roots = await getDuePendingDisconnectRoots(config, now);
    logger.info('[RetryPendingServiceDisconnects] Found due pending disconnect roots.', {
      serviceName: config.serviceName,
      count: roots.length,
    });

    for (const rootSnapshot of roots) {
      try {
        await retryPendingDisconnectRoot(config, rootSnapshot);
      } catch (error) {
        logger.error('[RetryPendingServiceDisconnects] Failed to process pending disconnect root.', {
          userID: rootSnapshot.id,
          serviceName: config.serviceName,
          error: error instanceof Error ? error.message : `${error}`,
        });
      }
    }
  }
});

export const retryPendingServiceDisconnectsTestInternals = {
  clearPendingDisconnectRootIfEntitled,
  clearPendingDisconnectsForRestoredEntitlements,
  checkpointLifecycleRepairPage,
  getDuePendingDisconnectRoots,
  getLifecycleRepairPage,
  getPendingDisconnectRootsForEntitlementCheck,
  retryPendingDisconnectRoot,
  retryPendingServiceRouteRestorations,
  retryPendingWahooReconnectQueueReleases,
  shouldKeepConnectionForCurrentEntitlement,
};
