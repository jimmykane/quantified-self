import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { getTokenData } from '../tokens';
import {
  cleanupServiceConnectionForUser,
  SERVICE_AUTH_CLEANUP_REASONS,
} from '../service-auth-lifecycle';
import {
  clearServiceDisconnectPending,
  isServiceDisconnectPendingData,
  PENDING_SERVICE_DISCONNECT_BATCH_LIMIT,
  PendingServiceDisconnectRootData,
  recordServiceDisconnectRetryFailure,
} from '../service-disconnect-pending';

interface PendingDisconnectCollectionConfig {
  serviceName: ServiceNames;
  collectionName: string;
}

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
];

async function isGracePeriodActive(uid: string): Promise<boolean> {
  const systemDoc = await admin.firestore().doc(`users/${uid}/system/status`).get();
  const gracePeriodUntil = systemDoc.data()?.gracePeriodUntil as FirebaseFirestore.Timestamp | undefined;
  return !!gracePeriodUntil && gracePeriodUntil.toMillis() > admin.firestore.Timestamp.now().toMillis();
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

async function getDuePendingDisconnectRoots(
  config: PendingDisconnectCollectionConfig,
  now: admin.firestore.Timestamp,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const snapshot = await admin.firestore()
    .collection(config.collectionName)
    .where('disconnectState', '==', 'disconnect_pending')
    .where('disconnectManualReviewRequired', '==', false)
    .where('disconnectNextAttemptAt', '<=', now)
    .limit(PENDING_SERVICE_DISCONNECT_BATCH_LIMIT)
    .get();
  return snapshot.docs;
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
    },
  );

  const retryableFailure = outcome.retryableDisconnectFailures?.[0];
  if (!retryableFailure) {
    logger.info('[RetryPendingServiceDisconnects] Pending disconnect completed or reached terminal local cleanup.', {
      userID,
      serviceName: config.serviceName,
      deletedTokenCount: outcome.deletedTokenCount,
      preservedTokenCount: outcome.preservedTokenCount,
      localCleanupStatus: outcome.localCleanupStatus,
    });
    return;
  }

  await recordServiceDisconnectRetryFailure(userID, config.serviceName, retryableFailure);
  logger.warn('[RetryPendingServiceDisconnects] Pending disconnect retry failed; scheduled another attempt if retry budget remains.', {
    userID,
    serviceName: config.serviceName,
    tokenID: retryableFailure.tokenID,
    statusCode: retryableFailure.statusCode,
  });
}

export const retryPendingServiceDisconnects = onSchedule({
  region: 'europe-west2',
  schedule: 'every 30 minutes',
  timeoutSeconds: 300,
  memory: '512MiB',
}, async () => {
  const now = admin.firestore.Timestamp.now();

  for (const config of PENDING_DISCONNECT_COLLECTIONS) {
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
  getDuePendingDisconnectRoots,
  retryPendingDisconnectRoot,
  shouldKeepConnectionForCurrentEntitlement,
};
