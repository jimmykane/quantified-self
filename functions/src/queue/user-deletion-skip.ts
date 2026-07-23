import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getUserDeletionGuardState, UserDeletionGuardReadError } from '../shared/user-deletion-guard';

export type QueueUserDeletionGuardPhase =
    | 'before_token_refresh'
    | 'before_event_write'
    | 'before_activity_sync_enqueue'
    | 'before_activity_sync_processing'
    | 'before_activity_sync_upload'
    | 'before_activity_sync_destination_upload'
    | 'before_activity_sync_wahoo_pending_upload_persist'
    | 'before_route_delivery_sync_enqueue'
    | 'before_route_delivery_sync_processing'
    | 'before_route_delivery_sync_prepare'
    | 'before_route_delivery_sync_destination_upload'
    | 'before_sleep_token_resolution'
    | 'before_sleep_provider_sync';

export async function shouldSkipQueueWorkForDeletedUser(
    userID: string,
    serviceName: ServiceNames,
    queueItemID: string,
    phase: QueueUserDeletionGuardPhase,
): Promise<boolean> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
    } catch (error) {
        throw new UserDeletionGuardReadError(userID, phase, error);
    }

    if (!deletionGuard.shouldSkip) {
        return false;
    }

    logger.warn(
        `[QueueDeletionGuard] Skipping ${serviceName} queue item ${queueItemID} during ${phase} because user ${userID} is missing or deletion is in progress.`,
    );
    return true;
}
