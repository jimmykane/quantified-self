import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { QueueItemInterface } from './queue-item.interface';
import {
  deferQueueItemForTokenRefreshContentionIfCurrentUserActive,
  QueueResult,
} from '../queue-utils';
import { enqueueWorkoutRecoveryTask } from '../shared/cloud-tasks';
import { TOKEN_REFRESH_LEASE_MS } from '../token-refresh-coordinator';
import { normalizeQueueRevision } from './revision-identity';

const TOKEN_REFRESH_CONTENTION_RETRY_DELAY_SECONDS = Math.ceil(TOKEN_REFRESH_LEASE_MS / 1000) + 5;

export interface WorkoutQueueTaskContext {
  tokenRefreshRecoveryGeneration?: number;
}

export interface DeferWorkoutQueueItemForTokenRefreshContentionParams {
  serviceName: ServiceNames;
  queueItem: QueueItemInterface;
  userID: string;
  phase: string;
  logPrefix: string;
  isCurrent: (queueItem: Record<string, unknown>) => boolean;
  currentRecoveryGeneration?: number;
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
  const queueRevision = normalizeQueueRevision(params.queueItem.queueRevision);
  const persistedRecoveryGeneration = normalizeRecoveryGeneration(
    params.queueItem.tokenRefreshRecoveryGeneration,
  );
  const currentRecoveryGeneration = normalizeRecoveryGeneration(params.currentRecoveryGeneration);
  if (currentRecoveryGeneration < persistedRecoveryGeneration) {
    logger.info('[WorkoutQueue] Skipping stale token-refresh contention task because a later recovery is already pending.', {
      serviceName: params.serviceName,
      queueItemId: params.queueItem.id,
      currentRecoveryGeneration,
      persistedRecoveryGeneration,
    });
    return QueueResult.TokenRefreshDeferred;
  }

  const recoveryGeneration = Math.max(
    currentRecoveryGeneration,
    persistedRecoveryGeneration,
  ) + 1;
  if (!Number.isSafeInteger(recoveryGeneration)) {
    logger.error('[WorkoutQueue] Could not advance the token-refresh contention recovery generation.', {
      serviceName: params.serviceName,
      queueItemId: params.queueItem.id,
      currentRecoveryGeneration,
      persistedRecoveryGeneration,
    });
    return QueueResult.Failed;
  }
  const recoveryDispatchedAtMs = Date.now();
  const recoveryTaskCreated = await enqueueWorkoutRecoveryTask(
    params.serviceName,
    params.queueItem.id,
    params.queueItem.dateCreated,
    TOKEN_REFRESH_CONTENTION_RETRY_DELAY_SECONDS,
    {
      recoveryGeneration,
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

  const result = await deferQueueItemForTokenRefreshContentionIfCurrentUserActive({
    queueItem: params.queueItem,
    userID: params.userID,
    phase: params.phase,
    logPrefix: params.logPrefix,
    recoveryDispatchedAtMs,
    recoveryGeneration,
    isCurrent: currentQueueItem => params.isCurrent(currentQueueItem)
      && normalizeRecoveryGeneration(currentQueueItem.tokenRefreshRecoveryGeneration)
        === persistedRecoveryGeneration,
  });
  return result === QueueResult.Deferred
    ? QueueResult.TokenRefreshDeferred
    : result;
}
