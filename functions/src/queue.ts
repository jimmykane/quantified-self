import * as functions from 'firebase-functions/v1';
import { MAX_RETRY_COUNT, QUEUE_SCHEDULE, MAX_PENDING_TASKS, DISPATCH_SPREAD_SECONDS } from './shared/queue-config';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';
import { QueueErrors, QueueLogs } from './shared/constants';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { increaseRetryCountForQueueItem, markQueueItemSkipped, QUEUE_SKIPPED_REASONS, updateToProcessed, moveToDeadLetterQueue, QueueResult } from './queue-utils';
import { processGarminAPIActivityQueueItem } from './garmin/queue';
import {
  QueueItemInterface,
  COROSAPIWorkoutQueueItemInterface,
  GarminAPIActivityQueueItemInterface,
  SuuntoAppWorkoutQueueItemInterface,
} from './queue/queue-item.interface';
import { generateIDFromParts, generateEventID, setEvent, UsageLimitExceededError, enqueueWorkoutTask, UserNotFoundError, getCloudTaskQueueDepth, EventWriteSkippedForDeletedUserError } from './utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceWorkoutQueueName } from './shared/queue-names';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import * as requestPromise from './request-helper';
import { config } from './config';
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from './tokens';
import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { COROSAPIEventMetaData, SuuntoAppEventMetaData } from '@sports-alliance/sports-lib';
import { uploadDebugFile } from './debug-utils';
import { createParsingOptions } from '../../shared/parsing-options';
import { normalizeDownloadedFitPayload } from './shared/fit-payload';
import { enqueueActivitySyncJobsForImportedEvent } from './activity-sync/enqueue-imported-event';
import { shouldSkipQueueWorkForDeletedUser } from './queue/user-deletion-skip';
import { ProviderQueueUserDeletedOrDeletingError, ProviderQueueUserNotConnectedError } from './queue/provider-queue-errors';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from './shared/user-deletion-guard';
import {
  QueueItemUserGuardedUpdateResult,
  markQueueItemDispatchedIfUserActive,
  QueueDispatchMarkerResult,
  updateQueueItemIfUserActive,
} from './queue/dispatch-marker';
import {
  markQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from './queue/cleanup-tombstone';

export {
  ProviderQueueUserDeletedOrDeletingError,
  ProviderQueueUserNotConnectedError,
  isProviderQueueSkippedWithoutRetryError,
  isProviderQueueUserDeletedOrDeletingError,
  isProviderQueueUserNotConnectedError,
} from './queue/provider-queue-errors';

async function enqueueActivitySyncBestEffort(
  parentID: string,
  eventID: string,
  sourceServiceName: ServiceNames,
  sourceActivityID: string,
  setEventResult: unknown
): Promise<boolean> {
  if (await shouldSkipQueueWorkForDeletedUser(parentID, sourceServiceName, eventID, 'before_activity_sync_enqueue')) {
    return true;
  }

  try {
    const activitySyncEventID = `${(setEventResult as any)?.eventID || eventID}`;
    const activitySyncOriginalFiles = Array.isArray((setEventResult as any)?.savedOriginalFiles) ? (setEventResult as any).savedOriginalFiles : [];
    await enqueueActivitySyncJobsForImportedEvent({
      userID: parentID,
      eventID: activitySyncEventID,
      sourceServiceName,
      sourceActivityID,
      originalFiles: activitySyncOriginalFiles,
    });
  } catch (activitySyncError) {
    logger.error(`[ActivitySync] Failed to enqueue post-import sync for ${sourceServiceName} event ${eventID} and user ${parentID}. Import remains successful.`, activitySyncError);
  }
  return false;
}

function markWorkoutQueueItemSkippedForDeletedUser(
  queueItem: QueueItemInterface,
  bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult.Processed | QueueResult.Failed> {
  return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
    skippedContext: 'USER_DELETION_GUARD',
  });
}


function toArrayBuffer(payload: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(payload.byteLength);
  copy.set(payload);
  return copy.buffer;
}

function selectPreferredTerminalAuthError(
  current: TerminalServiceAuthError | null,
  candidate: TerminalServiceAuthError,
): TerminalServiceAuthError {
  if (!current) {
    return candidate;
  }
  if (candidate.dlqContext === 'INVALID_GRANT' && current.dlqContext !== 'INVALID_GRANT') {
    return candidate;
  }
  return current;
}

function isTokenRefreshSkippedForDeletedUserError(error: unknown): error is TokenRefreshSkippedForDeletedUserError {
  return error instanceof TokenRefreshSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'TokenRefreshSkippedForDeletedUserError');
}

function isEventWriteSkippedForDeletedUserError(error: unknown): error is EventWriteSkippedForDeletedUserError {
  return error instanceof EventWriteSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'EventWriteSkippedForDeletedUserError');
}

function isUserDeletionGuardReadError(error: unknown): boolean {
  return error instanceof Error && error.name === 'UserDeletionGuardReadError';
}

interface WorkoutQueueDispatchContext {
  firebaseUserID: string;
  providerUserID: string;
}

enum WorkoutQueueFirebaseUserIDBackfillResult {
  Updated = 'updated',
  SkippedDeletedUser = 'skipped_deleted_user',
  AlreadyMovedToFailedJobs = 'already_moved_to_failed_jobs',
}

function getProviderUserIDForQueueItem(
  serviceName: ServiceNames,
  queueItem: SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface,
): { fieldName: 'userName' | 'openId' | 'userID'; value: string } | null {
  switch (serviceName) {
    case ServiceNames.SuuntoApp:
      return { fieldName: 'userName', value: `${(queueItem as SuuntoAppWorkoutQueueItemInterface).userName || ''}` };
    case ServiceNames.COROSAPI:
      return { fieldName: 'openId', value: `${(queueItem as COROSAPIWorkoutQueueItemInterface).openId || ''}` };
    case ServiceNames.GarminAPI:
      return { fieldName: 'userID', value: `${(queueItem as GarminAPIActivityQueueItemInterface).userID || ''}` };
    default:
      return null;
  }
}

async function resolveFirebaseUserIDForQueueItem(
  serviceName: ServiceNames,
  queueItem: SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface,
): Promise<string | null> {
  if (queueItem.firebaseUserID) {
    return queueItem.firebaseUserID;
  }

  const providerUserID = getProviderUserIDForQueueItem(serviceName, queueItem);
  if (!providerUserID || providerUserID.value.trim().length === 0) {
    return null;
  }

  try {
    const tokenSnapshot = await admin.firestore()
      .collectionGroup('tokens')
      .where(providerUserID.fieldName, '==', providerUserID.value.trim())
      .where('serviceName', '==', serviceName)
      .limit(1)
      .get();
    return tokenSnapshot.docs[0]?.ref.parent.parent?.id || null;
  } catch (error) {
    logger.error(`Could not resolve Firebase uid for ${serviceName} queue item ${queueItem.id}; rejecting enqueue so provider can retry instead of creating an orphan queue document.`, error);
    throw error;
  }
}

async function attachFirebaseUserIDToQueueItem<T extends SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface>(
  queueItem: T,
  serviceName: ServiceNames,
): Promise<T> {
  const firebaseUserID = await resolveFirebaseUserIDForQueueItem(serviceName, queueItem);
  const providerUserID = getProviderUserIDForQueueItem(serviceName, queueItem)?.value.trim() || 'unknown';
  if (!firebaseUserID) {
    throw new ProviderQueueUserNotConnectedError(serviceName, providerUserID, queueItem.id);
  }
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), firebaseUserID);
  } catch (error) {
    throw new UserDeletionGuardReadError(firebaseUserID, `provider_workout_queue:${serviceName}`, error);
  }
  if (deletionGuard.shouldSkip) {
    logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} for provider user ${providerUserID} because Firebase user ${firebaseUserID} is missing or deletion is in progress.`);
    throw new ProviderQueueUserDeletedOrDeletingError(serviceName, firebaseUserID, providerUserID, queueItem.id);
  }
  return {
    ...queueItem,
    firebaseUserID,
  };
}


export async function dispatchQueueItemTasks(serviceName: ServiceNames) {
  // Check queue depth
  const pendingTasks = await getCloudTaskQueueDepth(true);
  if (pendingTasks >= MAX_PENDING_TASKS) {
    logger.info(`Queue busy (${pendingTasks} pending tasks), skipping dispatch to limit load.`);
    return;
  }

  const availableSlots = MAX_PENDING_TASKS - pendingTasks;
  // Use availableSlots as batch limit (effectively capping concurrent tasks)
  const batchSize = availableSlots; // Caps at 1000 max

  // @todo add queue item sort date for creation
  const querySnapshot = await admin.firestore()
    .collection(getServiceWorkoutQueueName(serviceName))
    .where('processed', '==', false)
    .where('dispatchedToCloudTask', '==', null)
    .where('retryCount', '<', MAX_RETRY_COUNT)
    .limit(batchSize)
    .get();

  if (querySnapshot.empty) {
    logger.info(`No undispatched items found for ${serviceName}`);
    return;
  }

  logger.info(`Dispatching ${querySnapshot.size} items for ${serviceName} (${pendingTasks} already pending)`);

  const delayPerItem = DISPATCH_SPREAD_SECONDS / querySnapshot.size;

  const promises = querySnapshot.docs.map(async (doc, index): Promise<boolean> => {
    const delay = Math.floor(index * delayPerItem);
    const data = doc.data() as QueueItemInterface;

    if (!data.dateCreated) {
      logger.error(`Queue item ${doc.id} missing dateCreated, skipping dispatch.`);
      return false;
    }

    try {
      await assertWorkoutQueueCanDispatch(
        doc.ref,
        Object.assign({}, data, { id: doc.id }) as SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface,
        serviceName,
        `workout_queue_scheduled_dispatch:${serviceName}`,
      );
    } catch (error) {
      if (error instanceof ProviderQueueUserDeletedOrDeletingError) {
        logger.info(`Skipped ${serviceName} queue item ${doc.id} dispatch because the owning user is missing or deletion is in progress.`);
        return false;
      }
      if (error instanceof ProviderQueueUserNotConnectedError) {
        logger.info(`Skipped ${serviceName} queue item ${doc.id} dispatch because the provider user no longer resolves to a local token.`);
        return false;
      }
      if (isUserDeletionGuardReadError(error)) {
        logger.error(`Could not check deletion guard for ${serviceName} queue item ${doc.id}; leaving item undispatched for a future run.`, error);
        return false;
      }
      throw error;
    }

    try {
      const wasTaskEnqueued = await enqueueWorkoutTask(serviceName, doc.id, data.dateCreated, delay, {
        recoveryTaskKey: workoutQueueRecoveryTaskKey(data),
      });
      if (!wasTaskEnqueued) {
        logger.info(`Task not enqueued for ${serviceName} queue item ${doc.id}; leaving dispatch marker unchanged.`);
        return false;
      }
      const markerContext = await assertWorkoutQueueCanDispatch(
        doc.ref,
        Object.assign({}, data, { id: doc.id }) as SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface,
        serviceName,
        `workout_queue_scheduled_mark_dispatched:${serviceName}`,
      );
      const didMarkDispatched = await markWorkoutQueueItemDispatched(
        doc.ref,
        doc.id,
        serviceName,
        markerContext.firebaseUserID,
      );
      if (!didMarkDispatched) {
        logger.info(`Skipped ${serviceName} queue item ${doc.id} dispatch marker because the owning user is missing or deletion is in progress.`);
        return false;
      }
      return true;
    } catch (error) {
      if (error instanceof ProviderQueueUserDeletedOrDeletingError) {
        logger.info(`Skipped ${serviceName} queue item ${doc.id} dispatch marker because the owning user is missing or deletion is in progress.`);
        return false;
      }
      if (error instanceof ProviderQueueUserNotConnectedError) {
        logger.info(`Skipped ${serviceName} queue item ${doc.id} dispatch marker because the provider user no longer resolves to a local token.`);
        return false;
      }
      if (isUserDeletionGuardReadError(error)) {
        logger.error(`Could not re-check deletion guard for ${serviceName} queue item ${doc.id}; leaving dispatch marker untouched for a future run.`, error);
        return false;
      }
      throw error;
    }
  });

  const dispatchResults = await Promise.all(promises);
  const dispatchedCount = dispatchResults.filter(Boolean).length;
  logger.info(`Dispatched ${dispatchedCount}/${querySnapshot.size} tasks spread over ${DISPATCH_SPREAD_SECONDS}s`);
}

const TIMEOUT_DEFAULT = 300;
const MEMORY_DEFAULT = '256MB';
const TIMEOUT_HIGH = 540;
const MEMORY_HIGH = '1GB';

export const parseGarminAPIActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_HIGH,
  memory: MEMORY_HIGH,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await dispatchQueueItemTasks(ServiceNames.GarminAPI);
});

export const parseCOROSAPIWorkoutQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_DEFAULT,
  memory: MEMORY_DEFAULT,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await dispatchQueueItemTasks(ServiceNames.COROSAPI);
});

export const parseSuuntoAppActivityQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: TIMEOUT_HIGH,
  memory: MEMORY_HIGH,
  maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
  await dispatchQueueItemTasks(ServiceNames.SuuntoApp);
});



/**
 * Needed to create and stamp an id
 * @param queueItem
 */
export async function addToQueueForSuunto(queueItem: { userName: string, workoutID: string }): Promise<admin.firestore.DocumentReference> {
  logger.info(`Inserting to queue ${queueItem.userName} ${queueItem.workoutID}`);
  return addToWorkoutQueue(await attachFirebaseUserIDToQueueItem({
    id: await generateIDFromParts([queueItem.userName, queueItem.workoutID]),
    dateCreated: new Date().getTime(),
    userName: queueItem.userName,
    workoutID: queueItem.workoutID,
    retryCount: 0,
    processed: false,
    dispatchedToCloudTask: null,
  }, ServiceNames.SuuntoApp), ServiceNames.SuuntoApp, false, true);
}

/**
 * Needed to create and stamp an id
 * @param queueItem
 */
export async function addToQueueForGarmin(queueItem: { userID: string, startTimeInSeconds: number, manual: boolean, activityFileID: string, activityFileType: 'FIT' | 'TCX' | 'GPX', token: string, userAccessToken: string, callbackURL: string }): Promise<admin.firestore.DocumentReference> {
  const queueID = await generateIDFromParts([queueItem.userID, queueItem.activityFileID]);
  logger.info(`Inserting to queue ${queueID} for ${queueItem.userID} fileID ${queueItem.activityFileID}`);
  return addToWorkoutQueue(await attachFirebaseUserIDToQueueItem({
    id: queueID,
    dateCreated: new Date().getTime(),
    userID: queueItem.userID,
    startTimeInSeconds: queueItem.startTimeInSeconds,
    manual: queueItem.manual,
    activityFileID: queueItem.activityFileID,
    token: queueItem.token,
    activityFileType: queueItem.activityFileType,
    retryCount: 0,
    processed: false,
    userAccessToken: queueItem.userAccessToken,
    callbackURL: queueItem.callbackURL,
    dispatchedToCloudTask: null,
  }, ServiceNames.GarminAPI), ServiceNames.GarminAPI, queueItem.manual);
}

/**
 * NOT Needed to create and stamp an id COROS workouts should already have a queue item with more data sorry....
 * @param queueItem
 */
export async function addToQueueForCOROS(queueItem: COROSAPIWorkoutQueueItemInterface): Promise<admin.firestore.DocumentReference> {
  logger.info(`Inserting to queue ${queueItem.openId} ${queueItem.workoutID}`);
  return addToWorkoutQueue(await attachFirebaseUserIDToQueueItem(queueItem, ServiceNames.COROSAPI), ServiceNames.COROSAPI);
}

export function getWorkoutForService(
  serviceName: ServiceNames,
  workoutQueueItem: COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface,
  serviceToken?: SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface): Promise<any> {
  switch (serviceName) {
    default:
      throw new Error('Not Implemented');
    case ServiceNames.COROSAPI:
      return requestPromise.get({
        encoding: null,
        // gzip: true,
        url: (workoutQueueItem as COROSAPIWorkoutQueueItemInterface).FITFileURI,
      });
    case ServiceNames.SuuntoApp:
      return requestPromise.get({
        headers: {
          'Authorization': (serviceToken as SuuntoAPIAuth2ServiceTokenInterface).accessToken,
          'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
        },
        encoding: null,
        // gzip: true,
        url: `https://cloudapi.suunto.com/v3/workouts/${(workoutQueueItem as SuuntoAppWorkoutQueueItemInterface).workoutID}/fit`,
      });
  }
}

function getTokenQueryForWorkoutQueueItem(
  serviceName: ServiceNames,
  queueItem: COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface,
): admin.firestore.Query {
  switch (serviceName) {
    default:
      throw new Error('Not Implemented');
    case ServiceNames.COROSAPI:
      return admin.firestore().collectionGroup('tokens')
        .where('openId', '==', (queueItem as COROSAPIWorkoutQueueItemInterface).openId)
        .where('serviceName', '==', ServiceNames.COROSAPI);
    case ServiceNames.SuuntoApp:
      return admin.firestore().collectionGroup('tokens')
        .where('userName', '==', (queueItem as SuuntoAppWorkoutQueueItemInterface).userName)
        .where('serviceName', '==', ServiceNames.SuuntoApp);
  }
}


export async function parseWorkoutQueueItemForServiceName(serviceName: ServiceNames, queueItem: COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, tokenCache?: Map<string, Promise<admin.firestore.QuerySnapshot>>, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>): Promise<QueueResult> {
  if (serviceName === ServiceNames.GarminAPI) {
    return processGarminAPIActivityQueueItem(queueItem as GarminAPIActivityQueueItemInterface, bulkWriter, tokenCache, usageCache, pendingWrites);
  }

  logger.info(`Processing queue item ${queueItem.id} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots: admin.firestore.QuerySnapshot | undefined;
  const userKey = `${serviceName}:${(queueItem as COROSAPIWorkoutQueueItemInterface).openId || (queueItem as SuuntoAppWorkoutQueueItemInterface).userName}`;

  if (tokenCache) {
    let tokenPromise = tokenCache.get(userKey);
    if (!tokenPromise) {
      tokenPromise = getTokenQueryForWorkoutQueueItem(serviceName, queueItem as COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface).get();
      tokenCache.set(userKey, tokenPromise);
    }
    try {
      tokenQuerySnapshots = await tokenPromise;
    } catch (e: unknown) {
      const error = e as Error;
      logger.error(error);
      // If the promise fails, we might want to remove it from cache so next ones can retry,
      // but for this batch execution it might be better to just fail.
      return increaseRetryCountForQueueItem(queueItem, error, 1, bulkWriter);
    }

  } else {
    try {
      tokenQuerySnapshots = await getTokenQueryForWorkoutQueueItem(serviceName, queueItem as COROSAPIWorkoutQueueItemInterface | SuuntoAppWorkoutQueueItemInterface).get();
    } catch (e: unknown) {
      const error = e as Error;
      logger.error(error);
      return increaseRetryCountForQueueItem(queueItem, error, 1, bulkWriter);
    }

  }

  // If there is no token for the user, give them a few chances to reconnect
  if (!tokenQuerySnapshots.size) {
    logger.warn(QueueLogs.NO_TOKEN_FOUND.replace('${id}', queueItem.id));
    // return updateToProcessed(queueItem, bulkWriter, { processingError: 'NO_TOKEN_FOUND' });
    return moveToDeadLetterQueue(queueItem, new Error(QueueErrors.NO_TOKEN_FOUND), bulkWriter, 'NO_TOKEN_FOUND');
  }

  let oneSuccess = false;
  let retryIncrement = 1;
  let lastError = new Error(QueueErrors.ALL_TOKENS_FAILED);
  let terminalAuthError: TerminalServiceAuthError | null = null;
  let sawRetryableFailure = false;
  let sawUserDeletionSkip = false;

  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    const parent1 = tokenQueryDocumentSnapshot.ref.parent;
    if (!parent1) {
      throw new Error(`No parent found for ${tokenQueryDocumentSnapshot.id}`);
    }
    const parentID = parent1.parent!.id;

    if (await shouldSkipQueueWorkForDeletedUser(parentID, serviceName, queueItem.id, 'before_token_refresh')) {
      sawUserDeletionSkip = true;
      continue;
    }

    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName);
    } catch (e: any) {
      if (isTokenRefreshSkippedForDeletedUserError(e)) {
        sawUserDeletionSkip = true;
        logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} for token ${tokenQueryDocumentSnapshot.id} because the owning user is missing or deletion is in progress.`);
        continue;
      }
      if (e instanceof TerminalServiceAuthError) {
        logger.warn(`Terminal auth failure for ${serviceName} token ${tokenQueryDocumentSnapshot.id} while processing ${queueItem.id}; trying any remaining matching tokens before DLQ.`);
        terminalAuthError = selectPreferredTerminalAuthError(terminalAuthError, e);
        continue;
      }
      const statusCode = e.statusCode || (e.output && e.output.statusCode);
      const errorDescription = e.message || (e.error && (e.error.error_description || e.error.error));
      const isTransientError = statusCode === 500 || statusCode === 502 || (statusCode === 406 && String(errorDescription).toLowerCase().includes('json compatible'));
      lastError = e instanceof Error ? e : new Error(`${e}`);
      sawRetryableFailure = true;

      if (isTransientError) {
        logger.warn(`Refreshing token failed with transient error (${statusCode}), skipping this token with id ${tokenQueryDocumentSnapshot.id}`);
      } else {
        logger.error(e);
        logger.error(new Error(`Refreshing token failed skipping this token with id ${tokenQueryDocumentSnapshot.id}`));
      }
      continue;
    }

    logger.info(`Found user id ${parentID} for queue item ${queueItem.id}`);

    let result: Buffer | undefined;
    try {
      logger.info(`Downloading ${serviceName} workoutID: ${(queueItem as any).workoutID} for queue item ${queueItem.id}`);
      logger.info('Starting timer: DownloadFit');
      const downloadedPayload = await getWorkoutForService(serviceName, queueItem, serviceToken as any);
      const normalizedPayload = normalizeDownloadedFitPayload(downloadedPayload);
      if (normalizedPayload.normalizedFromMultipart) {
        const downloadedSize = typeof downloadedPayload?.length === 'number' ? downloadedPayload.length : downloadedPayload?.byteLength;
        logger.warn(`[Queue] Unwrapped multipart payload for ${queueItem.id} (offset=${normalizedPayload.fitOffset}, size=${downloadedSize || normalizedPayload.data.length} -> ${normalizedPayload.data.length})`);
      }
      result = normalizedPayload.data;
      logger.info(`Downloaded FIT file for ${queueItem.id}`);
    } catch (e: any) {
      logger.info('Ending timer: DownloadFit');
      if (e.statusCode === 401) {
        logger.warn(`Unauthorized to download workout for ${queueItem.id}, attempting to force refresh token and retry...`);
        try {
          // Force refresh token and save
          serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, true);
          const downloadedPayload = await getWorkoutForService(serviceName, queueItem, serviceToken as any);
          const normalizedPayload = normalizeDownloadedFitPayload(downloadedPayload);
          if (normalizedPayload.normalizedFromMultipart) {
            const downloadedSize = typeof downloadedPayload?.length === 'number' ? downloadedPayload.length : downloadedPayload?.byteLength;
            logger.warn(`[Queue] Unwrapped multipart payload for ${queueItem.id} (offset=${normalizedPayload.fitOffset}, size=${downloadedSize || normalizedPayload.data.length} -> ${normalizedPayload.data.length})`);
          }
          result = normalizedPayload.data;
        } catch (retryError: any) {
          if (isTokenRefreshSkippedForDeletedUserError(retryError)) {
            sawUserDeletionSkip = true;
            logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} during forced refresh because user ${parentID} is missing or deletion is in progress.`);
            continue;
          }
          if (retryError instanceof TerminalServiceAuthError) {
            logger.warn(`Terminal auth failure during forced refresh for ${serviceName} token ${tokenQueryDocumentSnapshot.id} while processing ${queueItem.id}; trying any remaining matching tokens before DLQ.`);
            terminalAuthError = selectPreferredTerminalAuthError(terminalAuthError, retryError);
            continue;
          }
          lastError = retryError instanceof Error ? retryError : new Error(`${retryError}`);
          sawRetryableFailure = true;
          logger.error(new Error(`Could not get workout for ${queueItem.id} even after force refresh: ${retryError.message}`));
          // Continue to next token
          continue;
        }

      } else if (e.statusCode === 403) {
        logger.error(new Error(`Could not get workout for ${queueItem.id} due to 403, increasing retry by 20`));
        retryIncrement = 20;
        lastError = e;
        sawRetryableFailure = true;
        continue;
      } else if (e.statusCode === 500) {
        logger.warn(`Partner service internal error (500) for ${queueItem.id}, will retry soon.`);
        retryIncrement = 1;
        lastError = e;
        sawRetryableFailure = true;
        continue;
      } else if (e.statusCode === 502) {
        logger.warn(`Partner service unavailable (502) for ${queueItem.id}, will retry soon.`);
        retryIncrement = 1;
        lastError = e;
        sawRetryableFailure = true;
        continue;
      } else {
        logger.error(new Error(`Could not get workout for ${queueItem.id}. Trying to refresh token and update retry count from ${queueItem.retryCount} to ${queueItem.retryCount + 1} -> ${e.message}`));
        lastError = e instanceof Error ? e : new Error(`${e}`);
        sawRetryableFailure = true;
        continue;
      }

    }
    if (!result) {
      logger.error(new Error(`No FIT payload downloaded for ${queueItem.id}; skipping token.`));
      sawRetryableFailure = true;
      continue;
    }
    logger.info('Ending timer: DownloadFit');
    logger.info(`File size: ${result.byteLength || result.length} bytes for queue item ${queueItem.id}`);
    try {
      logger.info('Starting timer: CreateEvent');
      const event = await EventImporterFIT.getFromArrayBuffer(toArrayBuffer(result), createParsingOptions());
      logger.info('Ending timer: CreateEvent');
      event.name = event.startDate.toJSON(); // @todo improve
      logger.info(`Created Event from FIT file of ${queueItem.id}`);
      logger.info('Starting timer: InsertEvent');
      if (await shouldSkipQueueWorkForDeletedUser(parentID, serviceName, queueItem.id, 'before_event_write')) {
        sawUserDeletionSkip = true;
        continue;
      }
      switch (serviceName) {
        default:
          throw new Error('Not Implemented');
        case ServiceNames.COROSAPI: {
          const corosWorkoutQueueItem = queueItem as COROSAPIWorkoutQueueItemInterface;
          const corosMetaData = new COROSAPIEventMetaData(corosWorkoutQueueItem.workoutID, corosWorkoutQueueItem.openId, corosWorkoutQueueItem.FITFileURI, new Date());
          const deterministicID = await generateEventID(parentID, event.startDate);
          const setEventResult = await setEvent(parentID, deterministicID, event, corosMetaData, { data: result, extension: 'fit', startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
          if (!bulkWriter) {
            const skippedAfterDeletionStarted = await enqueueActivitySyncBestEffort(parentID, deterministicID, ServiceNames.COROSAPI, corosWorkoutQueueItem.workoutID, setEventResult);
            if (skippedAfterDeletionStarted) {
              return markWorkoutQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
            }
          }
          break;
        }
        case ServiceNames.SuuntoApp: {
          const suuntoWorkoutQueueItem = queueItem as SuuntoAppWorkoutQueueItemInterface;
          const suuntoMetaData = new SuuntoAppEventMetaData(suuntoWorkoutQueueItem.workoutID, suuntoWorkoutQueueItem.userName, new Date());
          const deterministicID = await generateEventID(parentID, event.startDate);
          const setEventResult = await setEvent(parentID, deterministicID, event, suuntoMetaData, { data: result, extension: 'fit', startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
          if (!bulkWriter) {
            const skippedAfterDeletionStarted = await enqueueActivitySyncBestEffort(parentID, deterministicID, ServiceNames.SuuntoApp, suuntoWorkoutQueueItem.workoutID, setEventResult);
            if (skippedAfterDeletionStarted) {
              return markWorkoutQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
            }
          }
        }
      }
      logger.info('Ending timer: InsertEvent');
      logger.info(`Created Event ${event.getID()} for ${queueItem.id} user id ${parentID} and token user ${serviceToken.openId || serviceToken.userName}`);
      logger.info(`Parsed item successfully for ${queueItem.id}`);
      oneSuccess = true;
      break;
    } catch (e: any) {
      // @todo should delete event  or separate catch
      logger.error(e);
      if (isEventWriteSkippedForDeletedUserError(e)) {
        sawUserDeletionSkip = true;
        logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} because event write detected user ${e.userID} is missing or deletion is in progress.`);
        continue;
      } else if (e instanceof UsageLimitExceededError) {
        logger.error(new Error(`Usage limit exceeded for ${queueItem.id}. Aborting retries. ${e.message}`));
        retryIncrement = 20;
        lastError = e;
        sawRetryableFailure = true;
        break; // Stop checking other tokens if usage limit exceeded
      } else if (e instanceof UserNotFoundError) {
        logger.error(new Error(`User for queue item ${queueItem.id} not found. Aborting retries. ${e.message}`));
        await moveToDeadLetterQueue(queueItem, e, bulkWriter, 'USER_NOT_FOUND');
        return QueueResult.MovedToDLQ;
      } else if ((e as any).code === 'EVENT_EMPTY_ERROR') {
        logger.error(new Error(`FIT file for ${queueItem.id} contains no activities. Aborting retries.`));
        await moveToDeadLetterQueue(queueItem, e, bulkWriter, 'EVENT_EMPTY_ERROR');
        return QueueResult.MovedToDLQ;
      }

      // Attempt to upload debug file
      if (result) {
        await uploadDebugFile(result, 'fit', queueItem.id, serviceName, parentID);
      }

      logger.error(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${serviceToken.openId || serviceToken.userName} to ${queueItem.retryCount + 1} due to ${e.message}`));
      lastError = e instanceof Error ? e : new Error(`${e}`);
      sawRetryableFailure = true;
      continue;
    }
  }

  if (oneSuccess) {
    // If we made it here, the workout was processed successfully for at least one token.
    // We can stop and mark as processed.
    return updateToProcessed(queueItem, bulkWriter);
  }

  if (terminalAuthError && !sawRetryableFailure) {
    logger.warn(`At least one matching ${serviceName} token for ${queueItem.id} failed with terminal auth and none succeeded; moving queue item to DLQ with ${terminalAuthError.dlqContext}`);
    return moveToDeadLetterQueue(queueItem, terminalAuthError, bulkWriter, terminalAuthError.dlqContext);
  }

  if (terminalAuthError) {
    logger.warn(`At least one matching ${serviceName} token for ${queueItem.id} failed with terminal auth, but another matching token only failed retryably. Keeping the queue item retryable.`);
  }

  if (sawUserDeletionSkip && !sawRetryableFailure) {
    logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} without retry because every usable token owner is missing or deletion is in progress.`);
    return markWorkoutQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
  }

  // If we finished the loop without returning, it means every token attempt failed.
  logger.error(new Error(`Could not process ANY tokens for ${queueItem.id} after checking all ${tokenQuerySnapshots.size} tokens. Last error: ${lastError.message}. Increasing retry count.`));
  return increaseRetryCountForQueueItem(queueItem, lastError, retryIncrement, bulkWriter);
}

function isFirestoreAlreadyExistsError(error: unknown): boolean {
  const code = (error as any)?.code;
  const message = `${(error as any)?.message || ''}`;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS' || message.includes('ALREADY_EXISTS');
}

function isFirestoreNotFoundError(error: unknown): boolean {
  const code = (error as any)?.code;
  const message = `${(error as any)?.message || ''}`;
  return code === 5 || code === 'not-found' || code === 'NOT_FOUND' || message.includes('NOT_FOUND') || message.includes('No document to update');
}

function workoutQueueRecoveryTaskKey(queueItem: { totalRetryCount?: unknown, retryCount?: unknown } | null | undefined): number {
  if (typeof queueItem?.totalRetryCount === 'number') {
    return queueItem.totalRetryCount;
  }
  if (typeof queueItem?.retryCount === 'number') {
    return queueItem.retryCount;
  }
  return 0;
}

async function wasQueueItemMovedToFailedJobs(
  queueItemId: string,
  serviceName: ServiceNames,
): Promise<boolean> {
  const failedJobSnapshot = await admin.firestore().collection('failed_jobs').doc(queueItemId).get();
  const failedJob = failedJobSnapshot.exists ? failedJobSnapshot.data() as { originalCollection?: unknown } : null;
  const originalCollection = typeof failedJob?.originalCollection === 'string' ? failedJob.originalCollection : null;
  return originalCollection === getServiceWorkoutQueueName(serviceName);
}

async function markWorkoutQueueItemDispatched(
  queueItemDocument: admin.firestore.DocumentReference,
  queueItemId: string,
  serviceName: ServiceNames,
  firebaseUserID: string,
): Promise<boolean> {
  try {
    const result = await markQueueItemDispatchedIfUserActive({
      queueItemDocument,
      queueItemId,
      userID: firebaseUserID,
      phase: `workout_queue_dispatch_marker:${serviceName}`,
      dispatchedAtMs: Date.now(),
      logPrefix: 'WorkoutQueue',
    });
    return result === QueueDispatchMarkerResult.Marked;
  } catch (error) {
    if (!isFirestoreNotFoundError(error)) {
      throw error;
    }

    if (await wasQueueItemMovedToFailedJobs(queueItemId, serviceName)) {
      logger.info(`Queue item ${queueItemId} for ${serviceName} was already moved to failed_jobs before dispatch timestamp update.`);
      return true;
    }

    throw error;
  }
}

async function backfillWorkoutQueueFirebaseUserID(
  queueItemDocument: admin.firestore.DocumentReference,
  queueItemId: string,
  serviceName: ServiceNames,
  firebaseUserID: string,
): Promise<WorkoutQueueFirebaseUserIDBackfillResult> {
  try {
    const result = await updateQueueItemIfUserActive({
      queueItemDocument,
      queueItemId,
      userID: firebaseUserID,
      phase: `workout_queue_duplicate_uid_backfill:${serviceName}`,
      updateData: { firebaseUserID },
      logPrefix: 'WorkoutQueue',
      actionDescription: 'duplicate Firebase uid backfill',
    });
    return result === QueueItemUserGuardedUpdateResult.Updated
      ? WorkoutQueueFirebaseUserIDBackfillResult.Updated
      : WorkoutQueueFirebaseUserIDBackfillResult.SkippedDeletedUser;
  } catch (error) {
    if (!isFirestoreNotFoundError(error)) {
      throw error;
    }

    if (await wasQueueItemMovedToFailedJobs(queueItemId, serviceName)) {
      logger.info(`Queue item ${queueItemId} for ${serviceName} was already moved to failed_jobs before duplicate uid backfill.`);
      return WorkoutQueueFirebaseUserIDBackfillResult.AlreadyMovedToFailedJobs;
    }

    throw error;
  }
}

async function deleteWorkoutQueueDocBeforeDispatch(
  queueItemDocument: admin.firestore.DocumentReference,
  queueItemId: string,
  serviceName: ServiceNames,
  reason: string,
): Promise<void> {
  try {
    const tombstoneWritten = await markQueueItemDeletedForUserCleanup(
      getServiceWorkoutQueueName(serviceName),
      queueItemId,
      QUEUE_CLEANUP_TOMBSTONE_REASONS.UserDeletionGuard,
    );
    if (!tombstoneWritten) {
      logger.error(`Failed to write cleanup tombstone for ${serviceName} queue item ${queueItemId}; leaving item in place to avoid missing-doc Cloud Task retries.`);
      return;
    }
    await admin.firestore().recursiveDelete(queueItemDocument);
    logger.info(`Deleted ${serviceName} queue item ${queueItemId} before Cloud Task dispatch: ${reason}.`);
  } catch (error) {
    logger.error(`Failed to delete ${serviceName} queue item ${queueItemId} before dispatch after ${reason}`, error);
  }
}

async function assertWorkoutQueueCanDispatch(
  queueItemDocument: admin.firestore.DocumentReference,
  queueItem: SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface,
  serviceName: ServiceNames,
  phase: string,
): Promise<WorkoutQueueDispatchContext> {
  const providerUserID = getProviderUserIDForQueueItem(serviceName, queueItem)?.value.trim() || 'unknown';
  let firebaseUserID: string | null | undefined = (queueItem as QueueItemInterface).firebaseUserID;
  if (!firebaseUserID) {
    if (providerUserID === 'unknown') {
      logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} dispatch because it has neither firebaseUserID nor provider user id.`);
      await deleteWorkoutQueueDocBeforeDispatch(
        queueItemDocument,
        queueItem.id,
        serviceName,
        'missing firebaseUserID and provider user id',
      );
      throw new ProviderQueueUserNotConnectedError(serviceName, providerUserID, queueItem.id);
    }
    try {
      firebaseUserID = await resolveFirebaseUserIDForQueueItem(serviceName, queueItem);
    } catch (error) {
      throw new UserDeletionGuardReadError(providerUserID, `${phase}:resolve_legacy_firebase_uid`, error);
    }
    if (!firebaseUserID) {
      logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} dispatch because provider user ${providerUserID} no longer resolves to a local token.`);
      await deleteWorkoutQueueDocBeforeDispatch(
        queueItemDocument,
        queueItem.id,
        serviceName,
        `provider user ${providerUserID} no longer resolves to a local token`,
      );
      throw new ProviderQueueUserNotConnectedError(serviceName, providerUserID, queueItem.id);
    }
  }

  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), firebaseUserID);
  } catch (error) {
    throw new UserDeletionGuardReadError(firebaseUserID, phase, error);
  }

  if (!deletionGuard.shouldSkip) {
    return {
      firebaseUserID,
      providerUserID,
    };
  }

  logger.warn(`Skipping ${serviceName} queue item ${queueItem.id} dispatch because Firebase user ${firebaseUserID} is missing or deletion is in progress.`);
  await deleteWorkoutQueueDocBeforeDispatch(
    queueItemDocument,
    queueItem.id,
    serviceName,
    `Firebase user ${firebaseUserID} is missing or deletion is in progress`,
  );
  throw new ProviderQueueUserDeletedOrDeletingError(serviceName, firebaseUserID, providerUserID, queueItem.id);
}

async function addToWorkoutQueue(queueItem: SuuntoAppWorkoutQueueItemInterface | GarminAPIActivityQueueItemInterface | COROSAPIWorkoutQueueItemInterface, serviceName: ServiceNames, deferDispatch: boolean = false, createOnly: boolean = false): Promise<admin.firestore.DocumentReference> {
  const queueItemDocument = admin.firestore().collection(getServiceWorkoutQueueName(serviceName)).doc(queueItem.id);
  const queuePayload = Object.assign(queueItem, {
    expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
    dispatchedToCloudTask: null,
  });

  if (createOnly) {
    try {
      await queueItemDocument.create(queuePayload);
    } catch (error) {
      if (isFirestoreAlreadyExistsError(error)) {
        const existingSnapshot = await queueItemDocument.get();
        const existingQueueItem = existingSnapshot.data() as ({ dateCreated?: number, processed?: boolean, retryCount?: number, totalRetryCount?: number } | undefined);
        if (existingQueueItem?.processed === true) {
          logger.info(`Queue item ${queueItem.id} already processed for ${serviceName}; skipping duplicate enqueue.`);
          return queueItemDocument;
        }

        const dateCreated = typeof existingQueueItem?.dateCreated === 'number'
          ? existingQueueItem.dateCreated
          : queueItem.dateCreated;
        logger.info(`Queue item ${queueItem.id} already exists for ${serviceName}; ensuring duplicate webhook is dispatched.`);
        const duplicateDispatchContext = await assertWorkoutQueueCanDispatch(queueItemDocument, queuePayload, serviceName, `workout_queue_duplicate_dispatch:${serviceName}`);

        const firebaseUserID = (queuePayload as QueueItemInterface).firebaseUserID;
        if (firebaseUserID && existingQueueItem && (existingQueueItem as QueueItemInterface).firebaseUserID !== firebaseUserID) {
          const backfillFirebaseUserIDResult = await backfillWorkoutQueueFirebaseUserID(
            queueItemDocument,
            queueItem.id,
            serviceName,
            firebaseUserID,
          );
          if (backfillFirebaseUserIDResult === WorkoutQueueFirebaseUserIDBackfillResult.AlreadyMovedToFailedJobs) {
            return queueItemDocument;
          }
          if (backfillFirebaseUserIDResult === WorkoutQueueFirebaseUserIDBackfillResult.SkippedDeletedUser) {
            throw new ProviderQueueUserDeletedOrDeletingError(
              serviceName,
              duplicateDispatchContext.firebaseUserID,
              duplicateDispatchContext.providerUserID,
              queueItem.id,
            );
          }
        }

        const wasDuplicateTaskEnqueued = await enqueueWorkoutTask(serviceName, queueItem.id, dateCreated, undefined, {
          recoveryTaskKey: workoutQueueRecoveryTaskKey(existingQueueItem || queueItem),
        });
        if (wasDuplicateTaskEnqueued) {
          const didMarkDuplicateDispatched = await markWorkoutQueueItemDispatched(
            queueItemDocument,
            queueItem.id,
            serviceName,
            duplicateDispatchContext.firebaseUserID,
          );
          if (!didMarkDuplicateDispatched) {
            throw new ProviderQueueUserDeletedOrDeletingError(
              serviceName,
              duplicateDispatchContext.firebaseUserID,
              duplicateDispatchContext.providerUserID,
              queueItem.id,
            );
          }
        } else {
          logger.info(`Task not enqueued for duplicate ${serviceName} queue item ${queueItem.id}; leaving dispatch marker unchanged.`);
        }
        return queueItemDocument;
      }
      throw error;
    }
  } else {
    await queueItemDocument.set(queuePayload);
  }

  const dispatchContext = await assertWorkoutQueueCanDispatch(queueItemDocument, queuePayload, serviceName, `workout_queue_after_write:${serviceName}`);

  if (!deferDispatch) {
    // Dispatch a Cloud Task for immediate processing
    const wasTaskEnqueued = await enqueueWorkoutTask(serviceName, queueItem.id, queueItem.dateCreated, undefined, {
      recoveryTaskKey: workoutQueueRecoveryTaskKey(queueItem),
    });
    if (wasTaskEnqueued) {
      const didMarkDispatched = await markWorkoutQueueItemDispatched(
        queueItemDocument,
        queueItem.id,
        serviceName,
        dispatchContext.firebaseUserID,
      );
      if (!didMarkDispatched) {
        throw new ProviderQueueUserDeletedOrDeletingError(
          serviceName,
          dispatchContext.firebaseUserID,
          dispatchContext.providerUserID,
          queueItem.id,
        );
      }
    } else {
      logger.info(`Task not enqueued for immediate ${serviceName} queue item ${queueItem.id}; leaving dispatch marker unchanged.`);
    }
  }
  return queueItemDocument;
}
