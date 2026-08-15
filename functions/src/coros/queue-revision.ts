import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';
import {
  getQueueRevisionIdentity,
  isCurrentQueueRevision,
} from '../queue/revision-identity';

type COROSQueueRevisionFields = Pick<
  COROSAPIWorkoutQueueItemInterface,
  'queueRevision' | 'dateCreated' | 'openId'
>;

export function getCOROSQueueRevisionIdentity(
  queueItem: Partial<COROSQueueRevisionFields>,
): string | null {
  const openId = typeof queueItem.openId === 'string' ? queueItem.openId.trim() : '';
  const dateCreated = Number(queueItem.dateCreated);
  const legacyIdentity = openId && Number.isFinite(dateCreated)
    ? `legacy:${dateCreated}:${openId}`
    : null;
  return getQueueRevisionIdentity(queueItem, legacyIdentity);
}

export function isSameCOROSQueueRevision(
  currentQueueItem: Partial<COROSQueueRevisionFields> & { processed?: unknown },
  attemptedQueueItem: Partial<COROSQueueRevisionFields>,
): boolean {
  return isCurrentQueueRevision({
    currentQueueItem,
    attemptedQueueItem,
    legacyIdentityMatches: currentQueueItem.dateCreated === attemptedQueueItem.dateCreated
      && currentQueueItem.openId === attemptedQueueItem.openId,
  });
}
