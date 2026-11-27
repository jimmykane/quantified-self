import { SLEEP_PROVIDERS, type SleepSession } from '../../../shared/sleep';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isAutomaticPushOrigin } from '../../../shared/web-push';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';

export const MORNING_CHECK_IN = { recentMs: 24 * 3600000, cooldownMs: 20 * 3600000,
  expiryMs: 10 * 60000, deviceLimit: 10 } as const;
export const SLEEP_SERVICE_NAMES = { [SLEEP_PROVIDERS.GarminAPI]: ServiceNames.GarminAPI,
  [SLEEP_PROVIDERS.SuuntoApp]: ServiceNames.SuuntoApp, [SLEEP_PROVIDERS.COROSAPI]: ServiceNames.COROSAPI } as const;

export interface MorningCheckInCandidate {
  sessionId: string; provider: SleepSession['source']['provider']; providerUserId: string;
  startMs: number; endMs: number; createdAtMs: number;
}

/** A positive server-owned marker distinguishes new live work from legacy/replayed history queues. */
export function liveSleepQueue(queue: Pick<SleepSyncQueueItemInterface, 'type' | 'connectionHistoryRunId'
  | 'fromHistory' | 'healthTrigger' | 'garminSummaryType'>): boolean {
  return queue.fromHistory !== true && queue.connectionHistoryRunId === undefined && queue.healthTrigger !== 'backfill'
    && (['suunto_webhook', 'suunto_poll', 'coros_poll'].includes(queue.type)
      || ['garmin_push', 'garmin_ping', 'garmin_ping_batch'].includes(queue.type)
        && (queue.garminSummaryType === undefined || queue.garminSummaryType === 'sleeps'));
}

export function morningCheckInCandidate(session: SleepSession, now: number): MorningCheckInCandidate | null {
  if (!session.id || !Object.values(SLEEP_PROVIDERS).includes(session.source?.provider) || !session.source.providerUserId
    || session.isNap !== false || !Number.isFinite(session.durationSeconds) || session.durationSeconds <= 0
    || ![session.startTimeMs, session.endTimeMs, session.createdAtMs].every(Number.isFinite)
    || session.startTimeMs <= 0 || session.endTimeMs <= session.startTimeMs || session.endTimeMs > now
    || session.endTimeMs < now - MORNING_CHECK_IN.recentMs || session.createdAtMs > now
    || session.createdAtMs < now - MORNING_CHECK_IN.expiryMs) return null;
  return { sessionId: session.id, provider: session.source.provider, providerUserId: session.source.providerUserId,
    startMs: session.startTimeMs, endMs: session.endTimeMs, createdAtMs: session.createdAtMs };
}

/** Use the saved account zone for both the completed sleep and the dispatch window. */
export function morningCheckInWindow(endMs: number, nowMs: number, timeZone: string): { localDate: string; ttlSeconds: number } | null {
  if (!Number.isFinite(new Date(nowMs).getTime()) || !Number.isFinite(new Date(endMs).getTime()) || endMs > nowMs) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const parts = (ms: number) => Object.fromEntries(formatter.formatToParts(ms).map(({ type, value }) => [type, value]));
  const localDate = ({ year, month, day }: ReturnType<typeof parts>) => `${year}-${month}-${day}`;
  const now = parts(nowMs);
  const secondsSinceMidnight = Number(now.hour) * 3600 + Number(now.minute) * 60 + Number(now.second);
  const ttlSeconds = 12 * 3600 - secondsSinceMidnight - (nowMs % 1000 === 0 ? 0 : 1);
  const date = localDate(now);
  if (secondsSinceMidnight < 5 * 3600 || ttlSeconds < 1 || date !== localDate(parts(endMs))) return null;
  return { localDate: date, ttlSeconds };
}

export function morningCheckInPayload(origin: string) {
  if (!isAutomaticPushOrigin(origin)) throw new Error('Invalid Morning check-in origin.');
  const readinessPath = '/dashboard?focus=readiness';
  const sleepPath = '/health?metric=sleep';
  return {
    web_push: 8030,
    notification: {
      title: 'Good morning',
      body: 'Your sleep is in. Tap to see today’s readiness.',
      tag: 'qs-morning-check-in',
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
