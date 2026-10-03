import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { QueueErrors, QueueLogs } from '../shared/constants';
import { addToQueueForGarmin, resolveFirebaseUserIDForGarminUserID } from '../queue';
import { isProviderQueueSkippedWithoutRetryError } from '../queue/provider-queue-errors';
import { deferQueueItemForPendingDisconnect, increaseRetryCountForQueueItem, markQueueItemSkipped, QUEUE_SKIPPED_REASONS, updateToProcessed, moveToDeadLetterQueue, QueueResult } from '../queue-utils';

import { EventImporterFIT } from '@sports-alliance/sports-lib';
import { EventWriteSkippedForDeletedUserError, setEvent, UsageLimitExceededError, UserNotFoundError } from '../utils';
import * as requestPromise from '../request-helper';
import {
  GarminAPIActivityQueueItemInterface,
} from '../queue/queue-item.interface';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  getTokenData,
  TerminalServiceAuthError,
  TokenRefreshInProgressError,
  TokenRefreshSkippedForDeletedUserError,
} from '../tokens';
import { EventImporterGPX } from '@sports-alliance/sports-lib';
import { EventImporterTCX } from '@sports-alliance/sports-lib';
import * as xmldom from 'xmldom';
import {
  GarminAPIEventMetaData,
} from '@sports-alliance/sports-lib';
import { uploadDebugFile } from '../debug-utils';
import { createParsingOptions } from '../../../shared/parsing-options';
import { enqueueActivitySyncJobsForImportedEvent } from '../activity-sync/enqueue-imported-event';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import { resolveProviderImportEventID } from '../queue/provider-event-id';
import {
  deferWorkoutQueueItemForTokenRefreshContention,
} from '../queue/token-refresh-contention';
import { retainGarminFITWorkoutReferences } from '../training-plans/completion/fit-workout-evidence';
import { fitActivityReferencesFromEvent } from '../suunto/guide-completion';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { authenticateGarminWebhook } from './webhook-auth';
import { normalizeGarminActivityCallbackURL } from './activity-callback-url';

interface RequestError extends Error {
  statusCode?: number;
}

const GARMIN_CALLBACK_QUEUE_CONCURRENCY = 10;
export const GARMIN_ACTIVITY_WEBHOOK_MAX_FILES = 10_000;
export const GARMIN_ACTIVITY_WEBHOOK_MAX_BYTES = 10 * 1024 * 1024;
// QS worker safety limits, not claimed Garmin API file-size guarantees.
export const GARMIN_ACTIVITY_MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
export const GARMIN_ACTIVITY_DOWNLOAD_TIMEOUT_MS = 60_000;

interface GarminActivityQueueInput {
  userID: string,
  startTimeInSeconds: number,
  manual: boolean,
  activityFileID: string,
  activityFileType: 'FIT' | 'TCX' | 'GPX',
  token: string,
  userAccessToken: string,
  callbackURL: string,
  firebaseUserID?: string,
}

function parseGarminActivityFileForQueue(activityFile: GarminAPIActivityFileInterface): GarminActivityQueueInput {
  const callbackURL = normalizeGarminActivityCallbackURL(activityFile?.callbackURL);
  if (!callbackURL || typeof activityFile.userId !== 'string' || !activityFile.userId
    || activityFile.userId.length > 512 || !['FIT', 'TCX', 'GPX'].includes(activityFile.fileType)) {
    throw new Error('Invalid Garmin activity file callback.');
  }
  const callbackParams = new URL(callbackURL).searchParams;
  const activityFileID = activityFile.summaryId || callbackParams.get('id');
  if (!activityFileID) {
    throw new Error('Garmin activity file callback is missing activity file id.');
  }

  return {
    userID: activityFile.userId,
    startTimeInSeconds: activityFile.startTimeInSeconds,
    manual: activityFile.manual,
    activityFileID,
    activityFileType: activityFile.fileType,
    token: callbackParams.get('token') || 'No token',
    userAccessToken: activityFile.userAccessToken,
    callbackURL,
  };
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let hasFatalError = false;
  let fatalError: unknown;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!hasFatalError) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      try {
        await mapper(items[index], index);
      } catch (error) {
        if (!hasFatalError) {
          hasFatalError = true;
          fatalError = error;
        }
      }
    }
  }));

  if (hasFatalError) {
    throw fatalError;
  }
}

function isTokenRefreshSkippedForDeletedUserError(error: unknown): error is TokenRefreshSkippedForDeletedUserError {
  return error instanceof TokenRefreshSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'TokenRefreshSkippedForDeletedUserError');
}

function isTokenUseSkippedForPendingDisconnectError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TokenUseSkippedForPendingDisconnectError';
}

function isEventWriteSkippedForDeletedUserError(error: unknown): error is EventWriteSkippedForDeletedUserError {
  return error instanceof EventWriteSkippedForDeletedUserError
    || (error instanceof Error && error.name === 'EventWriteSkippedForDeletedUserError');
}

function markGarminQueueItemSkippedForDeletedUser(
  queueItem: GarminAPIActivityQueueItemInterface,
  bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult.Processed | QueueResult.Failed> {
  return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
    skippedContext: 'USER_DELETION_GUARD',
  });
}

function deferGarminQueueItemForPendingDisconnect(
  queueItem: GarminAPIActivityQueueItemInterface,
  firebaseUserID: string,
  bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
  return deferQueueItemForPendingDisconnect(queueItem, bulkWriter, {}, {
    userID: firebaseUserID,
    serviceName: ServiceNames.GarminAPI,
  });
}


export const insertGarminAPIActivityFileToQueue = functions.region('europe-west2').runWith({
  timeoutSeconds: 60,
  memory: '512MB',
  secrets: FUNCTION_SECRET_BINDINGS.insertGarminAPIActivityFileToQueue,
}).https.onRequest(async (req, res) => {
  if (!authenticateGarminWebhook(req, res, 'insertGarminAPIActivityFileToQueue')) return;
  const activityFiles: GarminAPIActivityFileInterface[] = req.body?.activityFiles;
  if ((req.rawBody && req.rawBody.length > GARMIN_ACTIVITY_WEBHOOK_MAX_BYTES)
    || !Array.isArray(activityFiles) || activityFiles.length > GARMIN_ACTIVITY_WEBHOOK_MAX_FILES) {
    logger.warn('[GarminWebhook] Dropped invalid or oversized activity delivery');
    res.status(200).send();
    return;
  }
  let queueItems: GarminActivityQueueInput[];
  try {
    queueItems = activityFiles.map(parseGarminActivityFileForQueue);
  } catch {
    logger.warn('[GarminWebhook] Dropped invalid activity callbacks');
    res.status(200).send();
    return;
  }

  const firebaseUserIDByGarminUserID = new Map<string, string | null>();
  const distinctGarminUserIDs = Array.from(new Set(queueItems.map((queueItem) => queueItem.userID)));
  try {
    await mapWithConcurrency(distinctGarminUserIDs, GARMIN_CALLBACK_QUEUE_CONCURRENCY, async (garminUserID) => {
      firebaseUserIDByGarminUserID.set(
        garminUserID,
        await resolveFirebaseUserIDForGarminUserID(garminUserID),
      );
    });
  } catch (e: unknown) {
    logger.error(e);
    res.status(500).send();
    return;
  }

  const queueableItems = queueItems.flatMap((queueItem) => {
    const firebaseUserID = firebaseUserIDByGarminUserID.get(queueItem.userID);
    if (!firebaseUserID) {
      logger.warn('Skipping Garmin activity file webhook because no local token/user is connected.', {
        provider: 'Garmin',
        userID: queueItem.userID,
        activityFileID: queueItem.activityFileID,
      });
      return [];
    }
    return [{
      ...queueItem,
      firebaseUserID,
    }];
  });

  const queueItemRefs: admin.firestore.DocumentReference[] = [];
  try {
    await mapWithConcurrency(queueableItems, GARMIN_CALLBACK_QUEUE_CONCURRENCY, async (queueItem) => {
      try {
        const queueItemDocumentReference = await addToQueueForGarmin(queueItem);
        queueItemRefs.push(queueItemDocumentReference);
      } catch (e: unknown) {
        if (isProviderQueueSkippedWithoutRetryError(e)) {
          logger.warn('Skipping Garmin activity file webhook because no local token/user is connected or the user is being deleted.', {
            provider: 'Garmin',
            reason: e.code,
            activityFileID: queueItem.activityFileID,
          });
          return;
        }
        throw e;
      }
    });
  } catch (e: unknown) {
    logger.error(e);
    res.status(500).send();
    return;
  }
  logger.info(`Inserted to queue ${queueItemRefs.length} Garmin activity files. Skipped ${queueItems.length - queueItemRefs.length} files.`);
  res.status(200).send();
});




export async function processGarminAPIActivityQueueItem(queueItem: GarminAPIActivityQueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, tokenCache?: Map<string, Promise<admin.firestore.QuerySnapshot>>, usageCache?: Map<string, Promise<{ role: string, limit: number, currentCount: number }>>, pendingWrites?: Map<string, number>, taskRecoveryGeneration?: number): Promise<QueueResult> {
  // Capture the validated URL before any await, including for legacy queue rows.
  const url = normalizeGarminActivityCallbackURL(queueItem.callbackURL);
  logger.info(`Processing queue item ${queueItem.id} at retry count ${queueItem.retryCount}`);
  // queueItem is never undefined for query queueItem snapshots
  let tokenQuerySnapshots: admin.firestore.QuerySnapshot | undefined;
  // Use UserID for cache key as it's stable, unlike access tokens
  const userKey = `GarminAPI:${queueItem.userID}`;

  if (tokenCache) {
    let tokenPromise = tokenCache.get(userKey);
    if (!tokenPromise) {
      // Lookup by userID (Garmin User ID) which is stored in the 'userID' field of the token document
      // Since we don't know the Firebase User ID (the parent doc ID), we must use a Collection Group Query.
      tokenPromise = admin.firestore().collectionGroup('tokens')
        .where('userID', '==', queueItem.userID)
        .where('serviceName', '==', ServiceNames.GarminAPI)
        .limit(1)
        .get();
      tokenCache.set(userKey, tokenPromise);
    }
    try {
      tokenQuerySnapshots = await tokenPromise;
    } catch (e: any) {
      logger.error(e);
      return increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
    }
  } else {
    tokenQuerySnapshots = await admin.firestore().collectionGroup('tokens')
      .where('userID', '==', queueItem.userID)
      .where('serviceName', '==', ServiceNames.GarminAPI)
      .limit(1)
      .get();
  }

  if (!tokenQuerySnapshots.size) {
    logger.warn(QueueLogs.NO_TOKEN_FOUND.replace('${id}', queueItem.id));
    return moveToDeadLetterQueue(queueItem, new Error(QueueErrors.NO_TOKEN_FOUND), bulkWriter, 'NO_TOKEN_FOUND');
  }

  // The parent of the token document is the 'tokens' collection, and its parent is the User document.
  const firebaseUserID = tokenQuerySnapshots.docs[0].ref.parent.parent!.id;
  if (await shouldSkipQueueWorkForDeletedUser(firebaseUserID, ServiceNames.GarminAPI, queueItem.id, 'before_token_refresh')) {
    return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
  }

  if (!url) {
    return moveToDeadLetterQueue(queueItem, new Error('Untrusted Garmin activity callback URL'), bulkWriter, 'GARMIN_ACTIVITY_INVALID_CALLBACK_URL');
  }

  // Use getTokenData (Shared) to handle auto-refresh if needed
  let serviceToken;
  try {
    serviceToken = await getTokenData(tokenQuerySnapshots.docs[0], ServiceNames.GarminAPI);
  } catch (e: any) {
    if (e instanceof TokenRefreshInProgressError) {
      return deferWorkoutQueueItemForTokenRefreshContention({
        serviceName: ServiceNames.GarminAPI,
        queueItem,
        userID: firebaseUserID,
        phase: 'garmin_workout_queue_token_refresh_contention',
        logPrefix: 'GarminWorkoutQueue',
        isCurrent: currentQueueItem => currentQueueItem.processed !== true
          && currentQueueItem.dateCreated === queueItem.dateCreated
          && currentQueueItem.dispatchedToCloudTask === queueItem.dispatchedToCloudTask
          && (typeof currentQueueItem.firebaseUserID !== 'string'
            || currentQueueItem.firebaseUserID === firebaseUserID),
        taskRecoveryGeneration,
      });
    }
    if (isTokenRefreshSkippedForDeletedUserError(e)) {
      logger.warn(`Skipping Garmin queue item ${queueItem.id} because user ${firebaseUserID} is missing or deletion is in progress.`);
      return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
    }
    if (isTokenUseSkippedForPendingDisconnectError(e)) {
      logger.warn(`Deferring Garmin queue item ${queueItem.id} because service disconnect is pending for user ${firebaseUserID}.`);
      return deferGarminQueueItemForPendingDisconnect(queueItem, firebaseUserID, bulkWriter);
    }
    if (e instanceof TerminalServiceAuthError) {
      logger.warn(`Garmin token for queue item ${queueItem.id} requires reconnect; moving item to DLQ with ${e.dlqContext}.`, {
        queueItemID: queueItem.id,
        userID: queueItem.userID,
        firebaseUserID: e.firebaseUserID,
        providerUserId: e.providerUserId,
        dlqContext: e.dlqContext,
      });
      return moveToDeadLetterQueue(queueItem, e, bulkWriter, e.dlqContext);
    }
    logger.error(`Failed to get/refresh token for ${queueItem.id}: ${e.message}`);
    return increaseRetryCountForQueueItem(queueItem, e, 1, bulkWriter);
  }

  let result;
  const downloadActivity = (binary: boolean) => requestPromise.get({
    headers: { Authorization: `Bearer ${serviceToken.accessToken}` },
    encoding: binary ? null : undefined,
    url,
    redirect: 'error',
    timeout: GARMIN_ACTIVITY_DOWNLOAD_TIMEOUT_MS,
    maxResponseBytes: GARMIN_ACTIVITY_MAX_RESPONSE_BYTES,
  });
  const handleDownloadFailure = async (error: unknown): Promise<QueueResult> => {
    // Do not retain provider bodies, fetch error text or signed URLs.
    const safeError = new Error('Garmin activity download failed.');
    if (error instanceof requestPromise.ResponseBodyTooLargeError) {
      return moveToDeadLetterQueue(queueItem, safeError, bulkWriter, 'GARMIN_ACTIVITY_FILE_TOO_LARGE');
    }
    const status = (error as RequestError | null)?.statusCode;
    logger.warn('[GarminActivity] Download failed', { queueItemID: queueItem.id, status: typeof status === 'number' ? status : null });
    if (status === 410) {
      return moveToDeadLetterQueue(queueItem, safeError, bulkWriter, 'RESOURCE_GONE');
    }
    await increaseRetryCountForQueueItem(queueItem, safeError, status === 400 || status === 500 ? 20 : 1, bulkWriter);
    return QueueResult.RetryIncremented;
  };

  try {
    logger.info(`Downloading Garmin activityID: ${queueItem.activityFileID} for queue item ${queueItem.id}`);
    logger.info('Starting timer: DownloadFile');
    result = await downloadActivity(queueItem.activityFileType === 'FIT');
    logger.info('Ending timer: DownloadFile');
    logger.info(`Downloaded ${queueItem.activityFileType} for ${queueItem.id} and token user ${(serviceToken as any).userID}`);
  } catch (error: unknown) {
    return handleDownloadFailure(error);
  }


  try {
    logger.info(`File size: ${result.byteLength || result.length} bytes for queue item ${queueItem.id}`);
    let event;
    let parsedFromFIT = queueItem.activityFileType === 'FIT';
    switch (queueItem.activityFileType) {
      case 'FIT':
        event = await EventImporterFIT.getFromArrayBuffer(result, createParsingOptions());
        break;
      case 'GPX':
        try {
          event = await EventImporterGPX.getFromString(result, xmldom.DOMParser, createParsingOptions());
        } catch {
          logger.error('Could not decode as GPX trying as FIT');
        }
        if (!event) {
          logger.info('Starting timer: DownloadFileRetry');
          // Retry as FIT if GPX failed (Legacy fallback?)
          // Note: We use the same URL
          try {
            result = await downloadActivity(true);
          } catch (error) {
            return handleDownloadFailure(error);
          }
          logger.info('Ending timer: DownloadFileRetry');
          logger.info(`Downloaded ${queueItem.activityFileType} (retry as FIT) for ${queueItem.id}`);
          event = await EventImporterFIT.getFromArrayBuffer(result, createParsingOptions());
          parsedFromFIT = true;
        }
        break;
      case 'TCX':
        event = await EventImporterTCX.getFromXML(
          new xmldom.DOMParser().parseFromString(result, 'application/xml'),
          createParsingOptions(),
        );
        break;
    }
    event.name = event.startDate.toJSON(); // @todo improve
    logger.info(`Created Event from FIT file of ${queueItem.id} and token user ${(serviceToken as any).userID}`);
    const metaData = new GarminAPIEventMetaData(
      queueItem.userID,
      queueItem.activityFileID,
      queueItem.activityFileType,
      queueItem.manual || false,
      queueItem.startTimeInSeconds || 0, // 0 is ok here I suppose
      new Date());
    const eventID = await resolveProviderImportEventID({
      userID: firebaseUserID,
      startDate: event.startDate,
      serviceName: ServiceNames.GarminAPI,
      providerEventID: queueItem.activityFileID,
      providerEventIDField: 'serviceActivityFileID',
      providerEventSecondaryID: queueItem.activityFileType,
      providerEventSecondaryIDField: 'serviceActivityFileType',
    });
    if (await shouldSkipQueueWorkForDeletedUser(firebaseUserID, ServiceNames.GarminAPI, queueItem.id, 'before_event_write')) {
      return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
    }
    const setEventResult = await setEvent(firebaseUserID, eventID, event, metaData, { data: result, extension: queueItem.activityFileType.toLowerCase(), startDate: event.startDate }, bulkWriter, usageCache, pendingWrites);
    if (parsedFromFIT) {
      await retainGarminFITWorkoutReferences(
        admin.firestore(),
        firebaseUserID,
        eventID,
        queueItem.userID,
        String(tokenQuerySnapshots.docs[0].data().tokenCredentialGeneration ?? ''),
        { activityFileID: queueItem.activityFileID, activityFileType: queueItem.activityFileType },
        Buffer.from(result),
        fitActivityReferencesFromEvent(event),
      );
    }
    if (!bulkWriter) {
      if (await shouldSkipQueueWorkForDeletedUser(firebaseUserID, ServiceNames.GarminAPI, queueItem.id, 'before_activity_sync_enqueue')) {
        return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
      }

      try {
        const activitySyncEventID = `${(setEventResult as any)?.eventID || eventID}`;
        const activitySyncOriginalFiles = Array.isArray((setEventResult as any)?.savedOriginalFiles) ? (setEventResult as any).savedOriginalFiles : [];
        await enqueueActivitySyncJobsForImportedEvent({
          userID: firebaseUserID,
          eventID: activitySyncEventID,
          sourceServiceName: ServiceNames.GarminAPI,
          sourceActivityID: queueItem.activityFileID,
          originalFiles: activitySyncOriginalFiles,
        });
      } catch (activitySyncError) {
        logger.error(`[ActivitySync] Failed to enqueue Garmin->destination sync for event ${eventID} and user ${firebaseUserID}. Import remains successful.`, activitySyncError);
      }
    }
    logger.info(`Created Event ${event.getID()} for ${queueItem.id} user id ${firebaseUserID} and token user ${(serviceToken as any).userID}`);
    // For each ended so we can set it to processed
    return updateToProcessed(queueItem, bulkWriter);
  } catch (e: unknown) {
    logger.error(e);
    if (isEventWriteSkippedForDeletedUserError(e)) {
      logger.warn(`Skipping Garmin queue item ${queueItem.id} because event write detected user ${e.userID} is missing or deletion is in progress.`);
      return markGarminQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
    } else if (e instanceof UsageLimitExceededError) {
      logger.error(new Error(`Usage limit exceeded for ${queueItem.id}. Aborting retries. ${e.message}`));
      await increaseRetryCountForQueueItem(queueItem, e, 20, bulkWriter);
      return QueueResult.RetryIncremented;
    } else if (e instanceof UserNotFoundError) {
      logger.error(new Error(`User for queue item ${queueItem.id} not found. Aborting retries. ${e.message}`));
      await moveToDeadLetterQueue(queueItem, e, bulkWriter, 'USER_NOT_FOUND');
      return QueueResult.MovedToDLQ;
    }

    const err = e instanceof Error ? e : new Error(String(e));

    // Attempt to upload the debug file if we have the result (file data)
    if (result) {
      try {
        await uploadDebugFile(result, queueItem.activityFileType.toLowerCase(), queueItem.id, 'garmin', firebaseUserID);
      } catch (uploadError) {
        logger.error(`Failed to upload debug file for ${queueItem.id}:`, uploadError);
      }
    }

    logger.info(new Error(`Could not save event for ${queueItem.id} trying to update retry count from ${queueItem.retryCount} and token user ${(serviceToken as any).userID} to ${queueItem.retryCount + 1} due to ${err.message}`));
    await increaseRetryCountForQueueItem(queueItem, err, 1, bulkWriter);
    return QueueResult.RetryIncremented;
  }
}



export interface GarminAPIActivityFileInterface {
  userId: string,
  userAccessToken: string,
  fileType: 'FIT' | 'TCX' | 'GPX',
  callbackURL: string,
  startTimeInSeconds: number,
  manual: boolean,
  token: string,
  summaryId?: string,
}
