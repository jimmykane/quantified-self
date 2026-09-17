import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { QueueItemInterface } from './queue-item.interface';
import {
  QueueResult,
} from '../queue-utils';
import { enqueueWorkoutTask } from '../shared/cloud-tasks';
import { TOKEN_REFRESH_LEASE_MS } from '../token-refresh-coordinator';
import { normalizeQueueRevision } from './revision-identity';
import {
  QueueItemUserGuardedUpdateResult,
  updateQueueItemIfUserActive,
} from './dispatch-marker';
import { clearRevisionProcessingLeaseUpdate } from './revision-processing-lease';

const TOKEN_REFRESH_CONTENTION_RETRY_DELAY_SECONDS = Math.ceil(TOKEN_REFRESH_LEASE_MS / 1000) + 5;

export interface DeferWorkoutQueueItemForTokenRefreshContentionParams {
  serviceName: ServiceNames;
  queueItem: QueueItemInterface;
  userID: string;
  phase: string;
  logPrefix: string;
  isCurrent: (queueItem: Record<string, unknown>) => boolean;
  taskRecoveryGeneration?: number;
}

function normalizeRecoveryGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/**
 * Acknowledge expected refresh-lease contention only after a distinct delayed
 * task has been durably accepted. The task is bound to this queue incarnation,
 * so a stale recovery cannot process a replacement document with the same ID.
 */
export async function deferWorkoutQueueItemForTokenRefreshContention(
  params: DeferWorkoutQueueItemForTokenRefreshContentionParams,
): Promise<QueueResult.TokenRefreshDeferred | QueueResult.Processed | QueueResult.Failed> {
  if (!params.queueItem.ref) {
    logger.error(`[WorkoutQueue] Cannot defer queue item ${params.queueItem.id} without a document reference.`);
    return QueueResult.Failed;
  }
  const queueRevision = normalizeQueueRevision(params.queueItem.queueRevision);
  const persistedRecoveryGeneration = normalizeRecoveryGeneration(params.queueItem.dispatchRecoveryGeneration);
  const taskRecoveryGeneration = typeof params.taskRecoveryGeneration === 'number'
    ? normalizeRecoveryGeneration(params.taskRecoveryGeneration)
    : null;
  if (taskRecoveryGeneration !== null && taskRecoveryGeneration < persistedRecoveryGeneration) {
    logger.info('[WorkoutQueue] Skipping stale token-refresh contention task because a later recovery is already pending.', {
      serviceName: params.serviceName,
      queueItemId: params.queueItem.id,
      taskRecoveryGeneration,
      persistedRecoveryGeneration,
    });
    return QueueResult.TokenRefreshDeferred;
  }

  const recoveryGeneration = Math.max(taskRecoveryGeneration ?? 0, persistedRecoveryGeneration) + 1;
  if (!Number.isSafeInteger(recoveryGeneration)) {
    logger.error('[WorkoutQueue] Could not advance the token-refresh contention recovery generation.', {
      serviceName: params.serviceName,
      queueItemId: params.queueItem.id,
      taskRecoveryGeneration,
      persistedRecoveryGeneration,
    });
    return QueueResult.Failed;
  }
  const recoveryDispatchedAtMs = Date.now();
  const recoveryTaskCreated = await enqueueWorkoutTask(
    params.serviceName,
    params.queueItem.id,
    params.queueItem.dateCreated,
    TOKEN_REFRESH_CONTENTION_RETRY_DELAY_SECONDS,
    {
      recoveryTaskKey: `token-refresh-${recoveryGeneration}`,
      dispatchRecoveryGeneration: recoveryGeneration,
      recoveryTaskOnly: true,
      ...(queueRevision ? { queueRevision } : {}),
    },
  );
  if (!recoveryTaskCreated) {
    logger.error('[WorkoutQueue] Could not enqueue token-refresh contention recovery; retaining the current Cloud Task retry.', {
      serviceName: params.serviceName,
      queueItemId: params.queueItem.id,
    });
    return QueueResult.Failed;
  }

  try {
    const result = await updateQueueItemIfUserActive({
      queueItemDocument: params.queueItem.ref,
      queueItemId: params.queueItem.id,
      userID: params.userID,
      phase: params.phase,
      logPrefix: params.logPrefix,
      actionDescription: 'token-refresh-contention deferral',
      updateData: {
        dispatchedToCloudTask: recoveryDispatchedAtMs,
        dispatchRecoveryGeneration: recoveryGeneration,
        ...clearRevisionProcessingLeaseUpdate(),
      },
      isCurrent: currentQueueItem => params.isCurrent(currentQueueItem)
        && normalizeRecoveryGeneration(currentQueueItem.dispatchRecoveryGeneration)
          === persistedRecoveryGeneration,
    });
    return result === QueueItemUserGuardedUpdateResult.Updated
      ? QueueResult.TokenRefreshDeferred
      : QueueResult.Processed;
  } catch (error) {
    logger.error(`Could not record token-refresh contention recovery for queue item ${params.queueItem.id}.`, error);
    return QueueResult.Failed;
  }
}
