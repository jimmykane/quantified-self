import type { SportsLibDataEnvelope } from './sports-lib-data';

export const SLEEP_SESSIONS_COLLECTION_ID = 'sleepSessions';
export const SLEEP_SYNC_STATE_COLLECTION_ID = 'sleepSyncState';

export const SLEEP_PROVIDERS = {
  GarminAPI: 'GarminAPI',
  SuuntoApp: 'SuuntoApp',
  COROSAPI: 'COROSAPI',
} as const;

export type SleepProvider = typeof SLEEP_PROVIDERS[keyof typeof SLEEP_PROVIDERS];

/**
 * Suunto can finalize one night as adjacent provider-owned SleepIds. Keep the
 * raw records, but only reconcile records that overlap or have a short interruption. A
 * larger gap remains a distinct sleep session even when the wake date matches.
 */
export const SUUNTO_SLEEP_FRAGMENT_MAX_GAP_MS = 30 * 60 * 1000;

export const SLEEP_STAGES = {
  Deep: 'deep',
  Light: 'light',
  Rem: 'rem',
  Awake: 'awake',
  Unmeasurable: 'unmeasurable',
  Unknown: 'unknown',
} as const;

export type SleepStage = typeof SLEEP_STAGES[keyof typeof SLEEP_STAGES];

export const SLEEP_SYNC_STATUSES = {
  Ready: 'ready',
  PermissionMissing: 'permission_missing',
  Failed: 'failed',
} as const;

export type SleepSyncStatus = typeof SLEEP_SYNC_STATUSES[keyof typeof SLEEP_SYNC_STATUSES];

export interface SleepSourceMetadata {
  provider: SleepProvider;
  sourceSessionKey: string;
  providerUserId: string;
  callbackURL?: string | null;
  receivedAtMs?: number | null;
}

export interface SleepStageInterval {
  stage: SleepStage;
  startTimeMs: number;
  endTimeMs: number;
}

export type SleepStageDurationsSeconds = Partial<Record<SleepStage, number>>;

export interface SleepScore {
  value?: number | null;
  qualifier?: string | null;
  components?: Record<string, unknown> | null;
}

export interface SleepVitals {
  averageHeartRateBpm?: number | null;
  minimumHeartRateBpm?: number | null;
  restingHeartRateBpm?: number | null;
  averageHrvMs?: number | null;
  hrvSampleCount?: number | null;
  overnightHrvMs?: number | null;
  maxSpo2Percent?: number | null;
  averageRespirationBrpm?: number | null;
}

export interface SleepSamplePoint {
  offsetSeconds?: number | null;
  timestampMs?: number | null;
  value: number;
}

export interface SleepProviderFields {
  garmin?: Record<string, unknown>;
  suunto?: Record<string, unknown>;
  coros?: Record<string, unknown>;
}

export const SLEEP_SPORTS_LIB_METRIC_FIELDS = {
  Duration: 'duration',
  InBedDuration: 'inBedDuration',
  DeepDuration: 'deepDuration',
  LightDuration: 'lightDuration',
  RemDuration: 'remDuration',
  AwakeDuration: 'awakeDuration',
  UnmeasurableDuration: 'unmeasurableDuration',
  UnknownDuration: 'unknownDuration',
  Score: 'score',
  AverageHeartRate: 'averageHeartRate',
  MinimumHeartRate: 'minimumHeartRate',
  RestingHeartRate: 'restingHeartRate',
  AverageHrv: 'averageHrv',
  OvernightHrv: 'overnightHrv',
  HrvSampleCount: 'hrvSampleCount',
  MaximumSpo2: 'maximumSpo2',
  AverageRespiration: 'averageRespiration',
} as const;

export type SleepSportsLibMetricField = typeof SLEEP_SPORTS_LIB_METRIC_FIELDS[
  keyof typeof SLEEP_SPORTS_LIB_METRIC_FIELDS
];

export interface SleepSession {
  id?: string;
  userID: string;
  source: SleepSourceMetadata;
  sleepDate: string;
  startTimeMs: number;
  endTimeMs: number;
  timezoneOffsetSeconds?: number | null;
  durationSeconds: number;
  inBedDurationSeconds?: number | null;
  isNap: boolean;
  validation?: string | null;
  stages: SleepStageInterval[];
  stageDurationsSeconds: SleepStageDurationsSeconds;
  score?: SleepScore | null;
  vitals?: SleepVitals | null;
  respirationSamples?: SleepSamplePoint[] | null;
  spo2Samples?: SleepSamplePoint[] | null;
  hrvSamples?: SleepSamplePoint[] | null;
  providerFields?: SleepProviderFields | null;
  /** Canonical aggregate JSON produced and validated by Sports Lib. */
  sportsLibData?: SportsLibDataEnvelope<SleepSportsLibMetricField>;
  createdAtMs: number;
  updatedAtMs: number;
}

function finiteSleepTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Suunto's app displays sleep onset, not the earlier in-bed timestamp. */
export function resolveSleepEffectiveStartTimeMs(
  session: Pick<SleepSession, 'source' | 'startTimeMs' | 'endTimeMs' | 'isNap' | 'providerFields'>,
): number {
  const startTimeMs = finiteSleepTime(session.startTimeMs) ?? 0;
  const endTimeMs = finiteSleepTime(session.endTimeMs);
  if (session.source?.provider !== SLEEP_PROVIDERS.SuuntoApp || session.isNap || endTimeMs === null) {
    return startTimeMs;
  }
  const suunto = session.providerFields?.suunto;
  const latencySeconds = finiteSleepTime(suunto?.SleepOnsetLatencyDuration);
  if (latencySeconds === null || latencySeconds < 0) return startTimeMs;
  const effectiveStartTimeMs = startTimeMs + Math.floor(latencySeconds * 1000);
  return effectiveStartTimeMs < endTimeMs ? effectiveStartTimeMs : startTimeMs;
}

/**
 * Partition one provider/account/date group into canonical nights. Existing
 * provider behavior is preserved except for Suunto, where only overlapping or
 * adjacent fragments are combined.
 */
export function partitionSleepNightFragments<T extends { startTimeMs: number | null; endTimeMs: number | null }>(
  provider: SleepProvider | null,
  input: readonly T[],
): T[][] {
  const sorted = [...input].sort((left, right) =>
    (left.startTimeMs ?? 0) - (right.startTimeMs ?? 0)
    || (left.endTimeMs ?? 0) - (right.endTimeMs ?? 0));
  if (provider !== SLEEP_PROVIDERS.SuuntoApp || sorted.length <= 1) return sorted.length ? [sorted] : [];

  return sorted.reduce<T[][]>((groups, point) => {
    const current = groups[groups.length - 1];
    const currentEndTimeMs = current?.reduce((latestEndTimeMs, member) =>
      member.endTimeMs === null ? latestEndTimeMs : Math.max(latestEndTimeMs, member.endTimeMs),
    Number.NEGATIVE_INFINITY);
    const gapMs = currentEndTimeMs !== undefined && Number.isFinite(currentEndTimeMs)
      && point.startTimeMs !== null
      ? point.startTimeMs - currentEndTimeMs
      : Number.POSITIVE_INFINITY;
    if (current && gapMs <= SUUNTO_SLEEP_FRAGMENT_MAX_GAP_MS) {
      current.push(point);
    } else {
      groups.push([point]);
    }
    return groups;
  }, []);
}

/** Awake time between canonical fragments, excluding overlap and nested records. */
export function sumSleepFragmentInterruptionSeconds<T extends {
  startTimeMs: number | null;
  endTimeMs: number | null;
}>(input: readonly T[]): number {
  const sorted = [...input].sort((left, right) =>
    (left.startTimeMs ?? 0) - (right.startTimeMs ?? 0)
    || (left.endTimeMs ?? 0) - (right.endTimeMs ?? 0));
  let latestEndTimeMs: number | null = null;
  return sorted.reduce((total, point) => {
    if (point.startTimeMs === null || point.endTimeMs === null) return total;
    const interruptionMs = latestEndTimeMs === null ? 0 : Math.max(0, point.startTimeMs - latestEndTimeMs);
    latestEndTimeMs = latestEndTimeMs === null
      ? point.endTimeMs
      : Math.max(latestEndTimeMs, point.endTimeMs);
    return total + Math.round(interruptionMs / 1000);
  }, 0);
}

export interface SleepSyncState {
  provider: SleepProvider;
  status: SleepSyncStatus;
  lastWebhookAtMs?: number | null;
  lastPollAtMs?: number | null;
  nextPollFromMs?: number | null;
  lastSyncedAtMs?: number | null;
  lastBackfillQueuedAtMs?: number | null;
  lastBackfillStartMs?: number | null;
  lastBackfillEndMs?: number | null;
  lastBackfillQueueItems?: number | null;
  nextBackfillAllowedAtMs?: number | null;
  providerMinBackfillStartMs?: number | null;
  providerMinBackfillStartProviderUserId?: string | null;
  healthBackfillStatus?: 'queued' | 'running' | 'complete' | 'failed' | 'skipped' | null;
  healthBackfillWindowsCompleted?: number | null;
  healthBackfillWindowsTotal?: number | null;
  healthBackfillSummaryType?: string | null;
  lastError?: string | null;
  updatedAtMs: number;
}

export interface SleepMapperResult {
  sourceSessionKey: string;
  session: Omit<SleepSession, 'id' | 'userID' | 'createdAtMs' | 'updatedAtMs'>;
}

export function normalizeSleepProvider(value: unknown): SleepProvider | null {
  const provider = `${value || ''}`;
  if (provider === SLEEP_PROVIDERS.GarminAPI) {
    return SLEEP_PROVIDERS.GarminAPI;
  }
  if (provider === SLEEP_PROVIDERS.SuuntoApp) {
    return SLEEP_PROVIDERS.SuuntoApp;
  }
  if (provider === SLEEP_PROVIDERS.COROSAPI) {
    return SLEEP_PROVIDERS.COROSAPI;
  }
  return null;
}

export function resolveSleepSessionEndTimeMs(startTimeMs: number, durationSeconds: number): number {
  return startTimeMs + Math.max(0, Math.floor(durationSeconds || 0)) * 1000;
}
