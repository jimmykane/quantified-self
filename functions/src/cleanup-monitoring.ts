import * as logger from 'firebase-functions/logger';

export type CleanupFlow = 'account' | 'disconnect' | 'operational' | 'recovery';
export type CleanupProvider = 'GarminAPI' | 'SuuntoApp' | 'COROSAPI' | 'WahooAPI' | 'all';
type CleanupOutcome = 'started' | 'acknowledged' | 'completed' | 'partial' | 'retry'
  | 'deferred' | 'superseded' | 'failed' | 'remote_unconfirmed' | 'manual_review';
export type CleanupLane = 'operational' | 'subscription' | 'explicit' | 'health_projection'
  | 'route_restore' | 'queue_release' | 'wahoo_release' | 'scheduler';

export function cleanupProvider(service: unknown): CleanupProvider {
  switch (service) {
    // Sports Lib names and the fixed legacy connection keys use different casing.
    case 'garminAPI': case 'Garmin API': return 'GarminAPI';
    case 'suuntoApp': case 'Suunto app': return 'SuuntoApp';
    case 'corosAPI': case 'COROS API': return 'COROSAPI';
    case 'wahooAPI': case 'Wahoo API': return 'WahooAPI';
    default: return 'all';
  }
}

/** Deliberately no arbitrary field bag, identity, exception or Firestore dependency. */
export function cleanupObservation(
  flow: CleanupFlow,
  provider: CleanupProvider,
  outcome: CleanupOutcome,
  lane: CleanupLane = 'scheduler',
  ageMs?: number,
): void {
  try {
    logger.info('[CleanupHealth]', {
      telemetryVersion: 1, event: 'outcome', flow, provider, outcome, lane,
      ...(typeof ageMs === 'number' && Number.isFinite(ageMs) && ageMs >= 0
        ? { ageMs: Math.floor(ageMs) } : {}),
    });
  } catch { /* Monitoring must not change cleanup, retries or acknowledgement. */ }
}

/** This is scheduler coverage, not a claim that every retained row was examined. */
export function cleanupHeartbeat(outcome: 'acknowledged' | 'failed'): void {
  try {
    logger.info('[CleanupHealth]', { telemetryVersion: 1, event: 'heartbeat',
      flow: 'recovery', provider: 'all', lane: 'scheduler', outcome });
  } catch { /* Logging has no authority over recovery. */ }
}

export function cleanupPage(lane: CleanupLane, provider: CleanupProvider, examined: number, cap: number): void {
  try {
    logger.info('[CleanupHealth]', { telemetryVersion: 1, event: 'page', flow: 'recovery', provider, lane,
      examined: Math.max(0, Math.floor(examined)), capped: examined >= cap });
  } catch { /* This reuses an existing page; it never reads or changes work. */ }
}

export async function observeCleanupSchedule(work: () => Promise<void>): Promise<void> {
  try {
    await work();
    cleanupHeartbeat('acknowledged');
  } catch (error) {
    cleanupHeartbeat('failed');
    throw error;
  }
}

export function cleanupAge(value: unknown, nowMs = Date.now()): number | undefined {
  try {
    const ms = typeof value === 'number' ? value
      : value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis() : NaN;
    return Number.isFinite(ms) && ms > 0 && ms <= nowMs ? nowMs - ms : undefined;
  } catch { return undefined; }
}

/** Event age is retry age, never the age of a retained deletion tombstone. */
export async function observeAccountCleanup<T>(timestamp: unknown, work: () => Promise<T>): Promise<T> {
  const eventMs = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  cleanupObservation('account', 'all', 'started', 'scheduler', cleanupAge(eventMs));
  try {
    const result = await work();
    // Helpers and the Delete User Data extension have independent obligations.
    cleanupObservation('account', 'all', 'acknowledged', 'scheduler', cleanupAge(eventMs));
    return result;
  } catch (error) {
    cleanupObservation('account', 'all', 'failed', 'scheduler', cleanupAge(eventMs));
    throw error;
  }
}

export function observeRemoteCleanup(service: unknown, outcome: {
  skippedByCondition?: boolean; partnerDeauthorizeFailed: number; localCleanupStatus: string;
  tokenCount?: number; partnerDeauthorizeAttempted?: number;
  preservedTokenCount?: number;
}, flow: 'account' | 'disconnect', lane: CleanupLane = 'scheduler'): void {
  if (outcome.skippedByCondition) return;
  const provider = cleanupProvider(service);
  if (outcome.partnerDeauthorizeFailed > 0
    || (typeof outcome.tokenCount === 'number' && typeof outcome.partnerDeauthorizeAttempted === 'number'
      && outcome.tokenCount > outcome.partnerDeauthorizeAttempted && !outcome.preservedTokenCount)) {
    cleanupObservation(flow, provider, 'remote_unconfirmed', lane);
  }
  if (!['partial', 'completed', 'no_tokens_found'].includes(outcome.localCleanupStatus)) return;
  cleanupObservation(flow, provider, outcome.preservedTokenCount && outcome.preservedTokenCount > 0 ? 'deferred'
    : outcome.localCleanupStatus === 'partial' ? 'partial'
    : lane === 'explicit' ? 'acknowledged' : 'completed', lane);
}
