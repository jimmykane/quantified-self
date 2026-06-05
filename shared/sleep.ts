export const SLEEP_SESSIONS_COLLECTION_ID = 'sleepSessions';
export const SLEEP_SYNC_STATE_COLLECTION_ID = 'sleepSyncState';

export const SLEEP_PROVIDERS = {
  GarminAPI: 'GarminAPI',
  SuuntoApp: 'SuuntoApp',
  COROSAPI: 'COROSAPI',
} as const;

export type SleepProvider = typeof SLEEP_PROVIDERS[keyof typeof SLEEP_PROVIDERS];

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
  createdAtMs: number;
  updatedAtMs: number;
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
