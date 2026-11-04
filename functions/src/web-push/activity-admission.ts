import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import type { ServiceNames } from '@sports-alliance/sports-lib';
import type { QueueItemInterface } from '../queue/queue-item.interface';
import type { SetEventResult } from '../utils';
import { admitActivityNotification } from './activity-service';
import { automaticPushConfiguration } from './history-consent';
import { recentActivity, timestampMs } from './activity-policy';

/** No provider persistence/retry semantics depend on this best-effort notification. */
export async function notifyNewActivityAfterPersistence(uid: string, service: ServiceNames, queue: QueueItemInterface,
  result: SetEventResult | undefined, startDate: Date, endDate: Date, connectedAt: unknown): Promise<void> {
  if (result?.created !== true || queue.activityNotificationOrigin !== 'live' || queue.fromHistory === true
    || queue.connectionHistoryRunId !== undefined) return;
  const candidate = { eventID: result.eventID, service, queueId: queue.id, queueCreatedAt: queue.dateCreated,
    queueRevision: queue.queueRevision ?? null, startMs: timestampMs(startDate), endMs: timestampMs(endDate),
    connectedAtMs: timestampMs(connectedAt) };
  if (!recentActivity(candidate, Date.now())) return;
  try { await admitActivityNotification(uid, candidate, { db: getFirestore(), now: Date.now,
    configuration: () => automaticPushConfiguration('web_push_activity_sync_enabled') }); }
  catch { logger.error('[ActivitySyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' }); }
}
