import { resolveSleepDisplayDate, SLEEP_PROVIDERS, type SleepSession } from '../../../shared/sleep';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isAutomaticPushOrigin } from '../../../shared/web-push';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';

export const SLEEP_PUSH = { recentMs: 24 * 3600000, cooldownMs: 20 * 3600000,
  expiryMs: 10 * 60000, deviceLimit: 10 } as const;
export const SLEEP_SERVICE_NAMES = { [SLEEP_PROVIDERS.GarminAPI]: ServiceNames.GarminAPI,
  [SLEEP_PROVIDERS.SuuntoApp]: ServiceNames.SuuntoApp, [SLEEP_PROVIDERS.COROSAPI]: ServiceNames.COROSAPI } as const;

export interface SleepPushCandidate {
  sessionId: string; provider: SleepSession['source']['provider']; providerUserId: string;
  sleepDate: string; startMs: number; endMs: number; createdAtMs: number;
}

/** A positive server-owned marker distinguishes new live work from legacy/replayed history queues. */
export function liveSleepQueue(queue: Pick<SleepSyncQueueItemInterface, 'type' | 'connectionHistoryRunId'
  | 'fromHistory' | 'healthTrigger' | 'garminSummaryType'>): boolean {
  return queue.fromHistory !== true && queue.connectionHistoryRunId === undefined && queue.healthTrigger !== 'backfill'
    && (['suunto_webhook', 'suunto_poll', 'coros_poll'].includes(queue.type)
      || ['garmin_push', 'garmin_ping', 'garmin_ping_batch'].includes(queue.type)
        && (queue.garminSummaryType === undefined || queue.garminSummaryType === 'sleeps'));
}

export function sleepPushCandidate(session: SleepSession, now: number): SleepPushCandidate | null {
  const sleepDate = resolveSleepDisplayDate(session);
  if (!session.id || !Object.values(SLEEP_PROVIDERS).includes(session.source?.provider) || !session.source.providerUserId
    || session.isNap !== false || !sleepDate || !Number.isFinite(session.durationSeconds) || session.durationSeconds <= 0
    // A malformed provider calendar date must not poison the account's monotonic deduplication receipt.
    || Math.abs(Date.parse(`${sleepDate}T00:00:00Z`) - session.endTimeMs) > 48 * 3600000
    || ![session.startTimeMs, session.endTimeMs, session.createdAtMs].every(Number.isFinite)
    || session.startTimeMs <= 0 || session.endTimeMs <= session.startTimeMs || session.endTimeMs > now
    || session.endTimeMs < now - SLEEP_PUSH.recentMs || session.createdAtMs > now
    || session.createdAtMs < now - SLEEP_PUSH.expiryMs) return null;
  return { sessionId: session.id, provider: session.source.provider, providerUserId: session.source.providerUserId,
    sleepDate, startMs: session.startTimeMs, endMs: session.endTimeMs, createdAtMs: session.createdAtMs };
}

export function sleepNotificationPayload(origin: string) {
  if (!isAutomaticPushOrigin(origin)) throw new Error('Invalid sleep notification origin.');
  const readinessPath = '/dashboard?focus=readiness';
  const sleepPath = '/health?metric=sleep';
  return {
    web_push: 8030,
    notification: {
      title: 'Quantified Self',
      body: 'Your sleep is in. Open Today to see your readiness.',
      tag: 'qs-sleep-sync',
      renotify: true,
      icon: `${origin}/assets/favicons/android-chrome-192x192.png`,
      navigate: origin + readinessPath,
      actions: [
        { action: 'view-readiness', title: 'View readiness', navigate: origin + readinessPath },
        { action: 'view-sleep', title: 'View sleep', navigate: origin + sleepPath },
      ],
      data: {
        onActionClick: {
          default: { operation: 'openWindow', url: readinessPath },
          'view-readiness': { operation: 'openWindow', url: readinessPath },
          'view-sleep': { operation: 'openWindow', url: sleepPath },
        },
      },
    },
  };
}
