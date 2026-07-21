import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SetEventResult } from '../utils';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import { enqueueActivitySyncJobsForImportedEvent } from './enqueue-imported-event';

export interface EnqueueActivitySyncAfterEventPersistenceParams {
  userID: string;
  eventID: string;
  sourceServiceName: ServiceNames;
  sourceActivityID: string;
  setEventResult: SetEventResult;
}

/**
 * Hands a newly persisted provider activity to enabled activity-sync routes.
 *
 * Importing remains successful when a follow-up delivery job cannot be queued;
 * the route can be retried later through its manual date-range backfill.
 */
export async function enqueueActivitySyncAfterEventPersistence(
  params: EnqueueActivitySyncAfterEventPersistenceParams,
): Promise<boolean> {
  if (await shouldSkipQueueWorkForDeletedUser(
    params.userID,
    params.sourceServiceName,
    params.eventID,
    'before_activity_sync_enqueue',
  )) {
    return true;
  }

  try {
    await enqueueActivitySyncJobsForImportedEvent({
      userID: params.userID,
      eventID: params.setEventResult.eventID || params.eventID,
      sourceServiceName: params.sourceServiceName,
      sourceActivityID: params.sourceActivityID,
      originalFiles: params.setEventResult.savedOriginalFiles,
    });
  } catch (error) {
    logger.error(
      `[ActivitySync] Failed to enqueue post-import sync for ${params.sourceServiceName} event ${params.eventID} and user ${params.userID}. Import remains successful.`,
      error,
    );
  }

  return false;
}
