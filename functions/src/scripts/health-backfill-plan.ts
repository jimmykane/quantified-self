import { createHash } from 'node:crypto';
import { SLEEP_PROVIDERS, SleepProvider } from '../../../shared/sleep';
import {
  getCorosSleepBackfillStartMs,
  getSleepBackfillWindowDays,
  SLEEP_BACKFILL_START_DATE_ISO,
} from '../../../shared/sleep-backfill';
import { chunkCOROSInclusiveTimestampRange } from '../coros/date-range';
import { countGarminHealthBackfillRequests } from '../garmin/health-backfill-range';
import { containsASCIIControlCharacter } from '../coros/input-validation';
import type { addSleepSyncQueueItem } from '../sleep/queue';

export type QueueInput = Parameters<typeof addSleepSyncQueueItem>[0];
export const PROVIDERS = {
  garmin: SLEEP_PROVIDERS.GarminAPI,
  suunto: SLEEP_PROVIDERS.SuuntoApp,
  coros: SLEEP_PROVIDERS.COROSAPI,
} as const;
export type ProviderName = keyof typeof PROVIDERS;
export const DAY_MS = 86_400_000;
export const CHECKPOINT_COLLECTION = 'adminHealthBackfills';

export interface BackfillOptions {
  project: string;
  providers: ProviderName[];
  startMs: number;
  endMs: number;
  uid?: string;
  execute: boolean;
  maxUsers: number;
  maxJobs: number;
  maxPending: number;
  scanLimit: number;
  /** Operator-only exception for the exact observed cooldown of one owner/provider. */
  overrideCooldownUntilMs?: number;
}

export function digest(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function date(value: string | undefined, name: string): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} requires YYYY-MM-DD.`);
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a valid calendar date.`);
  }
  return parsed;
}

/** Explicit end date makes a repeated command the same campaign, not another import. */
export function parseBackfillOptions(argv: string[], nowMs = Date.now()): BackfillOptions {
  const flags = new Set(['--execute', '--confirm-all-users']);
  const values = new Set(['--project', '--provider', '--start', '--end', '--uid', '--max-users', '--max-jobs', '--max-pending', '--scan-limit', '--override-cooldown-until']);
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const [key, ...rest] = argv[i].split('=');
    if (args.has(key) || (!flags.has(key) && !values.has(key))) throw new Error('Unknown or duplicate option. Use --help.');
    if (flags.has(key)) {
      if (rest.length) throw new Error('Boolean flags do not accept a value.');
      args.set(key, 'true');
    } else {
      const value = rest.length ? rest.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing option value. Use --help.');
      args.set(key, value);
    }
  }
  const project = args.get('--project') || '';
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('--project requires an explicit Firebase project ID.');
  const provider = args.get('--provider');
  if (!provider || !['all', ...Object.keys(PROVIDERS)].includes(provider)) throw new Error('--provider requires garmin, suunto, coros, or all.');
  const uid = args.get('--uid');
  if (uid && (uid.length > 128 || uid.includes('/') || containsASCIIControlCharacter(uid) || uid.trim() !== uid)) throw new Error('Invalid --uid.');
  const cooldown = args.get('--override-cooldown-until');
  const overrideCooldownUntilMs = cooldown === undefined ? undefined : Date.parse(cooldown);
  if (cooldown !== undefined && (!uid || provider === 'all'
    || !Number.isSafeInteger(overrideCooldownUntilMs) || overrideCooldownUntilMs! <= 0
    || new Date(overrideCooldownUntilMs!).toISOString() !== cooldown)) {
    throw new Error('--override-cooldown-until requires one --uid, one provider, and an exact UTC ISO timestamp.');
  }
  const execute = args.has('--execute');
  if (execute && !uid && !args.has('--confirm-all-users')) throw new Error('Bulk execution requires --confirm-all-users. Run a dry run first.');
  const startMs = args.has('--start') ? date(args.get('--start'), '--start') : Date.parse(SLEEP_BACKFILL_START_DATE_ISO);
  // Inclusive end date, never a partial future day.
  const endMs = date(args.get('--end'), '--end') + DAY_MS - 1000;
  if (endMs > nowMs || startMs > endMs || startMs < Date.parse(SLEEP_BACKFILL_START_DATE_ISO)) {
    throw new Error('Use a completed UTC end day and a range within the configured historical boundary.');
  }
  const integer = (key: string, fallback: number, maximum: number) => {
    const raw = args.get(key) ?? String(fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${key}.`);
    return value;
  };
  return {
    project, providers: provider === 'all' ? ['garmin', 'suunto', 'coros'] : [provider as ProviderName],
    startMs, endMs, uid, execute,
    maxUsers: integer('--max-users', 5, 100),
    maxJobs: integer('--max-jobs', 25, 250),
    maxPending: integer('--max-pending', 100, 1000),
    scanLimit: integer('--scan-limit', 1000, 10_000),
    ...(overrideCooldownUntilMs !== undefined ? { overrideCooldownUntilMs } : {}),
  };
}

export interface BackfillJob { key: string; queueId: string; input: QueueInput }

export function buildHealthBackfillJobs(
  provider: SleepProvider,
  userID: string,
  providerUserId: string,
  startMs: number,
  endMs: number,
  campaign: string,
): BackfillJob[] {
  if (startMs > endMs) return [];
  const windows: Array<{ startMs: number; endMs: number }> = [];
  if (provider === SLEEP_PROVIDERS.GarminAPI) {
    windows.push({ startMs, endMs });
  } else if (provider === SLEEP_PROVIDERS.COROSAPI) {
    windows.push(...chunkCOROSInclusiveTimestampRange(startMs, endMs, getSleepBackfillWindowDays(provider)!));
  } else {
    const width = getSleepBackfillWindowDays(provider)! * DAY_MS;
    // Suunto's existing poll contract uses touching range endpoints.
    for (let cursor = startMs; cursor < endMs; cursor += width) {
      windows.push({ startMs: cursor, endMs: Math.min(endMs, cursor + width) });
    }
  }
  return windows.reverse().map(window => {
    const type = provider === SLEEP_PROVIDERS.GarminAPI ? 'garmin_health_backfill'
      : provider === SLEEP_PROVIDERS.SuuntoApp ? 'suunto_health_poll' : 'coros_poll';
    const key = digest([campaign, userID, providerUserId, window.startMs, window.endMs]);
    const dedupeKey = `admin-health-backfill:${key}`;
    // Same algorithm as shared/id-generator; queue IDs never contain raw identity.
    const queueId = createHash('sha256').update([provider, type, providerUserId, dedupeKey].join(':')).digest('hex');
    return {
      key, queueId,
      input: {
        type, provider, userID, providerUserId, rangeStartMs: window.startMs, rangeEndMs: window.endMs,
        ...(type !== 'coros_poll' ? { healthTrigger: 'backfill' as const } : {}),
        dedupeKey, dispatchImmediately: false,
        ...(type === 'garmin_health_backfill' ? {
          garminHealthBackfillSummaryIndex: 0,
          garminHealthBackfillNextStartMs: window.startMs,
          garminHealthBackfillWindowsCompleted: 0,
          garminHealthBackfillWindowsTotal: countGarminHealthBackfillRequests(window.startMs, window.endMs),
        } : {}),
      },
    };
  });
}

export function earliestBackfillStart(provider: SleepProvider, requested: number, nowMs: number): number {
  return provider === SLEEP_PROVIDERS.COROSAPI
    ? Math.max(requested, Math.ceil(getCorosSleepBackfillStartMs(nowMs) / 1000) * 1000) : requested;
}

export type JobObservation = 'new' | 'reserved' | 'pending' | 'success' | 'skipped' | 'failed' | 'unknown';
export function observeBackfillJob(
  checkpoint: Record<string, unknown> | undefined,
  queue: Record<string, unknown> | undefined,
  failed: boolean,
  nowMs: number,
): JobObservation {
  if (failed) return 'failed';
  if (queue) return queue.processed === true
    ? queue.resultStatus === 'success' ? 'success' : queue.resultStatus === 'skipped' ? 'skipped' : 'unknown'
    : 'pending';
  if (!checkpoint) return 'new';
  if (['success', 'skipped', 'failed'].includes(String(checkpoint.observation))) return checkpoint.observation as JobObservation;
  // Never recreate a submitted job just because its seven-day queue TTL elapsed.
  if (checkpoint.submittedAtMs) return 'unknown';
  // An ambiguous queue write may have completed then expired. Fail closed well before TTL.
  return typeof checkpoint.reservedAtMs === 'number' && nowMs - checkpoint.reservedAtMs < DAY_MS
    ? 'reserved' : 'unknown';
}
