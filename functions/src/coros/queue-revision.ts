import { COROSAPIWorkoutQueueItemInterface } from '../queue/queue-item.interface';

type COROSQueueRevisionFields = Pick<
  COROSAPIWorkoutQueueItemInterface,
  'queueRevision' | 'dateCreated' | 'openId'
>;

export function getCOROSQueueRevisionIdentity(
  queueItem: Partial<COROSQueueRevisionFields>,
): string | null {
  const queueRevision = typeof queueItem.queueRevision === 'string'
    ? queueItem.queueRevision.trim()
    : '';
  if (queueRevision) return `revision:${queueRevision}`;

  const openId = typeof queueItem.openId === 'string' ? queueItem.openId.trim() : '';
  const dateCreated = Number(queueItem.dateCreated);
  if (!openId || !Number.isFinite(dateCreated)) return null;
  return `legacy:${dateCreated}:${openId}`;
}

export function isSameCOROSQueueRevision(
  currentQueueItem: Partial<COROSQueueRevisionFields> & { processed?: unknown },
  attemptedQueueItem: Partial<COROSQueueRevisionFields>,
): boolean {
  if (currentQueueItem.processed === true) return false;
  const attemptedRevision = typeof attemptedQueueItem.queueRevision === 'string'
    ? attemptedQueueItem.queueRevision.trim()
    : '';
  if (attemptedRevision) return currentQueueItem.queueRevision === attemptedRevision;

  const currentRevision = typeof currentQueueItem.queueRevision === 'string'
    ? currentQueueItem.queueRevision.trim()
    : '';
  return !currentRevision
    && currentQueueItem.dateCreated === attemptedQueueItem.dateCreated
    && currentQueueItem.openId === attemptedQueueItem.openId;
}
