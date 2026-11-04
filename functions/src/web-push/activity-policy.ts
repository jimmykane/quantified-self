import { ServiceNames } from '@sports-alliance/sports-lib';
import { isAutomaticPushOrigin } from '../../../shared/web-push';
import type { ServiceConnectionMetaFields } from '../../../shared/service-connection';

export const ACTIVITY_PUSH = { recentMs: 48 * 3600000, groupMs: 120000, cooldownMs: 15 * 60000,
  dayMs: 86400000, dailyLimit: 4, batchLimit: 50, seenLimit: 256, deviceLimit: 10,
  batchExpiryMs: 10 * 60000, sweepLimit: 25 } as const;

export interface ActivityPushCandidate {
  eventID: string; service: ServiceNames; queueId: string; queueCreatedAt: number; queueRevision: string | null;
  startMs: number; endMs: number; connectedAtMs: number;
}
export interface ActivityPushEntry extends ActivityPushCandidate { connectionGeneration: string; }

export function timestampMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis(): number }).toMillis();
  return NaN;
}
export function recentActivity(candidate: ActivityPushCandidate, now: number): boolean {
  return [candidate.startMs, candidate.endMs, candidate.queueCreatedAt].every(Number.isFinite)
    && candidate.startMs > 0 && candidate.endMs >= candidate.startMs && candidate.endMs <= now
    && candidate.endMs >= now - ACTIVITY_PUSH.recentMs
    && candidate.queueCreatedAt <= now && candidate.queueCreatedAt >= now - ACTIVITY_PUSH.recentMs;
}

/** Positive webhook provenance is required. Missing flags on legacy/backfill work never imply live sync. */
export function liveActivitySource(uid: string, candidate: ActivityPushCandidate,
  queue: Record<string, unknown> | undefined, meta: ServiceConnectionMetaFields | undefined, now: number): boolean {
  if (!recentActivity(candidate, now) || !queue || !meta || queue.activityNotificationOrigin !== 'live'
    || queue.fromHistory === true || queue.connectionHistoryRunId !== undefined || queue.suppressAutomaticActivitySync === true
    || queue.manual === true || queue.edited === true
    || queue.dateCreated !== candidate.queueCreatedAt || (queue.queueRevision ?? null) !== candidate.queueRevision
    || (queue.firebaseUserID !== undefined && queue.firebaseUserID !== uid)
    || meta.connectionState !== 'connected' || typeof meta.connectionStateGeneration !== 'string' || !meta.connectionStateGeneration) return false;
  const providerField = { [ServiceNames.SuuntoApp]: 'userName', [ServiceNames.COROSAPI]: 'openId',
    [ServiceNames.GarminAPI]: 'userID', [ServiceNames.WahooAPI]: 'wahooUserID' }[candidate.service];
  if (!providerField || !queue[providerField] || String(queue[providerField]) !== meta.providerUserId) return false;
  // The lifecycle marker fences reconnects immediately; token creation supports existing connections.
  const connectedAt = Math.max(Number.isFinite(candidate.connectedAtMs) ? candidate.connectedAtMs : 0,
    typeof meta.activityNotificationConnectedAtMs === 'number' ? meta.activityNotificationConnectedAtMs : 0);
  if (!Number.isFinite(connectedAt) || connectedAt <= 0 || candidate.startMs <= connectedAt) return false;
  if (candidate.service === ServiceNames.GarminAPI) {
    const cutoff = Math.max(meta.activitySyncCutoffMs ?? 0, meta.activityNotificationHistoryEndMs ?? 0,
      meta.connectionHistoryImport?.endMs ?? 0);
    if (!Number.isFinite(cutoff) || candidate.startMs <= cutoff) return false;
  }
  return true;
}

export function activityNotificationPayload(origin: string, uid: string, entries: readonly ActivityPushEntry[]) {
  if (!isAutomaticPushOrigin(origin) || !entries.length) throw new Error('Invalid activity notification.');
  const path = entries.length === 1
    ? `/user/${encodeURIComponent(uid)}/event/${encodeURIComponent(entries[0].eventID)}` : '/activities';
  return { web_push: 8030, notification: { title: 'Quantified Self',
    body: entries.length === 1 ? 'A new activity has synced. Open Quantified Self to view it.' : `${entries.length} new activities have synced. Open Quantified Self to view them.`,
    tag: 'qs-activity-sync', renotify: false, icon: `${origin}/assets/favicons/android-chrome-192x192.png`, navigate: origin + path,
    data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: path } } },
  } };
}
