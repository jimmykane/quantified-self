import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import type { SleepSession } from '../../../shared/sleep';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { currentHistoryExecution } from '../connection-history/context';
import { admitSleepNotification } from './sleep-service';
import { automaticPushConfiguration } from './history-consent';
import { liveSleepQueue, sleepPushCandidate } from './sleep-policy';

/** Notification failure must never retry or fail a successful provider sleep import. */
export async function notifyNewSleepAfterPersistence(uid: string, queue: SleepSyncQueueItemInterface,
  sessions: readonly SleepSession[] | undefined): Promise<void> {
  if (!sessions?.length || currentHistoryExecution() || queue.sleepNotificationOrigin !== 'live' || !liveSleepQueue(queue)) return;
  const candidates = sessions.map(session => sleepPushCandidate(session, Date.now()))
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate).sort((a, b) => b.endMs - a.endMs);
  if (!candidates.length) return;
  try {
    // One operation per queue, even when polling returns many nights or several provider fragments.
    await admitSleepNotification(uid, candidates[0], queue, { db: getFirestore(), now: Date.now,
      configuration: () => automaticPushConfiguration('web_push_sleep_sync_enabled') });
  } catch { logger.error('[SleepSyncPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' }); }
}
