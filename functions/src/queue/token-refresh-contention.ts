import * as crypto from 'crypto';
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

export interface DeferWorkoutQueueItemForTokenRefreshContentionParams {
  serviceName: ServiceNames;
  queueItem: QueueItemInterface;
  userID: string;
  phase: string;
  logPrefix: string;
  isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

/**
 * Acknowledge expected refresh-lease contention only after a distinct delayed
 * task has been durably accepted. The task is bound to this queue incarnation,
 * so a stale recovery cannot process a replacement document with the same ID.
 */
export async function deferWorkoutQueueItemForTokenRefreshContention(
  params: DeferWorkoutQueueItemForTokenRefreshContentionParams,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
  const queueRevision = normalizeQueueRevision(params.queueItem.queueRevision);
  const recoveryDispatchedAtMs = Date.now();
  const recoveryTaskCreated = await enqueueWorkoutRecoveryTask(
    params.serviceName,
    params.queueItem.id,
    params.queueItem.dateCreated,
    TOKEN_REFRESH_CONTENTION_RETRY_DELAY_SECONDS,
    {
      recoveryTaskKey: crypto.randomUUID(),
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

  return deferQueueItemForTokenRefreshContentionIfCurrentUserActive({
    queueItem: params.queueItem,
    userID: params.userID,
    phase: params.phase,
    logPrefix: params.logPrefix,
    recoveryDispatchedAtMs,
    isCurrent: params.isCurrent,
  });
}
