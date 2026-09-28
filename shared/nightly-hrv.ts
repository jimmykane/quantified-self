import { type HealthMetricEntry, HEALTH_UNITS } from './health';
import { decodeHealthMetricSportsLibData, decodeSleepSessionSportsLibData } from './sports-lib-health-data';
import {
  groupCanonicalSleepNightFragments,
  normalizeSleepProvider,
  resolveSleepDisplayDate,
  resolveSleepEffectiveStartTimeMs,
  SLEEP_PROVIDERS,
  type SleepProvider,
  type SleepSession,
} from './sleep';
import { HRV_PERSONAL_RANGE_VARIANTS } from './personal-metric-range';

/** Read-time evidence only. Never persist these identities or expose them through MCP. */
export type NightlyHrvSleepSession = SleepSession & { nightlyHrvSourceKey?: string };
export interface NightlyHrvRecord {
  userID: string;
  schemaVersion: number;
  kind: string;
  source: { provider: string; accountKey: string };
  calendarDate: string;
  startTimeMs: number;
  endTimeMs: number;
  metrics: HealthMetricEntry[];
}
export const NIGHTLY_HRV_LIMITS = Object.freeze({ records: 2048, bytes: 16 * 1024 * 1024, pageSize: 32 });

export function healthAccountIdentityParts(uid: string, provider: string, providerAccountId: string): string[] {
  return ['health-account-v1', uid, provider, providerAccountId];
}

/** Exactly the shared Health writer's JSON-framed, SHA-256 account identity. */
export async function nightlyHealthAccountKey(uid: string, provider: string, providerAccountId: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure Health account matching is unavailable.');
  const bytes = new TextEncoder().encode(JSON.stringify(healthAccountIdentityParts(uid, provider, providerAccountId)));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sleepEvidenceSourceKey(session: Pick<SleepSession, 'source'>): string {
  return JSON.stringify([session.source?.provider, session.source?.providerUserId || null]);
}

/** Fragment reconciliation requires a real provider-account identity. */
export function isIdentifiedSleepEvidenceSourceKey(
  provider: string | null | undefined,
  sourceKey: string | null | undefined,
): boolean {
  return Boolean(provider && sourceKey && sourceKey !== JSON.stringify([provider, null]));
}

export function positiveNightlyHrv(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function sleepHrvSourceKey(session: NightlyHrvSleepSession): string | undefined {
  if (session.nightlyHrvSourceKey) return session.nightlyHrvSourceKey;
  const field = positiveNightlyHrv(session.vitals?.averageHrvMs) ? 'average'
    : positiveNightlyHrv(session.vitals?.overnightHrvMs) ? 'overnight' : null;
  return field ? JSON.stringify(['sleep', sleepEvidenceSourceKey(session), field]) : undefined;
}

export function isSleepAverageHrvSourceKey(sourceKey: string | null | undefined): boolean {
  if (!sourceKey) return false;
  try {
    const parts = JSON.parse(sourceKey) as unknown;
    return Array.isArray(parts) && parts.length === 3 && parts[0] === 'sleep' && parts[2] === 'average';
  } catch {
    return false;
  }
}

/** A fragment without HRV must not erase the source of another fragment's reading. */
export function aggregateNightlyHrvEvidence<T extends {
  averageHrvMs: number | null;
  hrvSampleCount?: number | null;
  hrvSourceKey?: string;
}>(
  points: readonly T[],
  options: { requireEveryPoint?: boolean } = {},
): { averageHrvMs: number | null; hrvSampleCount?: number; hrvSourceKey?: string } {
  const values = points.filter(point => positiveNightlyHrv(point.averageHrvMs));
  if (options.requireEveryPoint && values.length !== points.length) return { averageHrvMs: null };
  const keys = new Set(values.map(point => point.hrvSourceKey));
  if (!values.length || keys.size !== 1) return { averageHrvMs: null };
  const hrvSourceKey = values[0].hrvSourceKey;
  const sampleCounts = values.map(point => point.hrvSampleCount)
    .filter((value): value is number => Number.isSafeInteger(value) && (value as number) > 0);
  if (values.length > 1 && sampleCounts.length !== values.length) {
    const distinctValues = new Set(values.map(point => point.averageHrvMs));
    if (distinctValues.size !== 1) return { averageHrvMs: null };
  }
  const hrvSampleCount = sampleCounts.length === values.length
    ? sampleCounts.reduce((sum, value) => sum + value, 0)
    : undefined;
  const averageHrvMs = hrvSampleCount
    ? values.reduce((sum, point, index) => sum + point.averageHrvMs! * sampleCounts[index], 0) / hrvSampleCount
    : values[0].averageHrvMs!;
  return {
    averageHrvMs,
    ...(hrvSampleCount !== undefined ? { hrvSampleCount } : {}),
    ...(hrvSourceKey ? { hrvSourceKey } : {}),
  };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value as number).getTime());
}

interface NightlyHrvSleepCandidate {
  index: number;
  provider: SleepProvider;
  providerUserId: string | null;
  sleepDate: string;
  isNap: false;
  startTimeMs: number;
  endTimeMs: number;
}

function nightlyHrvSleepCandidateGroups(
  sessions: readonly SleepSession[],
): NightlyHrvSleepCandidate[][] {
  const suunto: NightlyHrvSleepCandidate[] = [];
  const other = new Map<string, NightlyHrvSleepCandidate[]>();
  sessions.forEach((session, index) => {
    const provider = normalizeSleepProvider(session.source?.provider);
    const sleepDate = resolveSleepDisplayDate(session);
    const startTimeMs = resolveSleepEffectiveStartTimeMs(session);
    const endTimeMs = session.endTimeMs;
    if (session.isNap || !provider || !validDate(sleepDate)
      || !validTimestamp(startTimeMs) || !validTimestamp(endTimeMs)
      || endTimeMs <= startTimeMs) return;
    const candidate: NightlyHrvSleepCandidate = {
      index,
      provider,
      providerUserId: typeof session.source?.providerUserId === 'string'
        ? session.source.providerUserId.trim() || null
        : null,
      sleepDate,
      isNap: false,
      startTimeMs,
      endTimeMs,
    };
    if (provider === SLEEP_PROVIDERS.SuuntoApp) {
      suunto.push(candidate);
      return;
    }
    const key = JSON.stringify([sleepEvidenceSourceKey(session), sleepDate]);
    other.set(key, [...(other.get(key) || []), candidate]);
  });
  return [
    ...other.values(),
    ...groupCanonicalSleepNightFragments(suunto),
  ];
}

export function nightlyHrvDateRange(sessions: readonly SleepSession[]): { startDate: string; endDate: string } | null {
  const dates = nightlyHrvSleepCandidateGroups(sessions).flatMap(group => {
    if (!group[0]?.providerUserId || group.some(candidate => {
      const session = sessions[candidate.index];
      return positiveNightlyHrv(session.vitals?.averageHrvMs)
        || positiveNightlyHrv(session.vitals?.overnightHrvMs);
    })) return [];
    return [group[0].sleepDate];
  }).sort();
  return dates.length ? { startDate: dates[0], endDate: dates[dates.length - 1] } : null;
}

export function assertNightlyHrvRecordBudget(records: readonly NightlyHrvRecord[]): void {
  if (records.length > NIGHTLY_HRV_LIMITS.records
    || new TextEncoder().encode(JSON.stringify(records)).byteLength > NIGHTLY_HRV_LIMITS.bytes) {
    throw new Error('Nightly HRV exceeds the bounded Health read limit.');
  }
}

/**
 * Supplements missing main-sleep HRV from a complete, owner-scoped Health read.
 * Known canonical overnight semantics are the extension point, never provider names.
 * Native Sleep values win. Conflicting sources are unavailable, not averaged.
 * A nightly reading is attached once, to the latest fragment of that account/night.
 */
export async function enrichSleepWithNightlyHrv(
  uid: string,
  input: readonly SleepSession[],
  records: readonly NightlyHrvRecord[],
): Promise<NightlyHrvSleepSession[]> {
  assertNightlyHrvRecordBudget(records);
  const sessions = input.map(session => decodeSleepSessionSportsLibData(session));
  if (!records.length) return sessions;
  const accountKeys = new Map<string, Promise<string>>();
  const result: NightlyHrvSleepSession[] = [...sessions];
  for (const group of nightlyHrvSleepCandidateGroups(sessions)) {
    const indexes = group.map(candidate => candidate.index);
    if (indexes.some(index => positiveNightlyHrv(sessions[index].vitals?.averageHrvMs)
      || positiveNightlyHrv(sessions[index].vitals?.overnightHrvMs))) continue;
    const candidate = [...group].sort((left, right) => right.endTimeMs - left.endTimeMs
      || right.startTimeMs - left.startTimeMs
      || (sessions[right.index].id || '').localeCompare(sessions[left.index].id || ''))[0];
    const index = candidate.index;
    const session = sessions[index];
    const providerAccountId = session.source.providerUserId;
    if (!providerAccountId || providerAccountId.length > 1024 || (session.userID && session.userID !== uid)) continue;
    const identity = sleepEvidenceSourceKey(session);
    if (!accountKeys.has(identity)) accountKeys.set(identity, nightlyHealthAccountKey(uid, session.source.provider, providerAccountId));
    const accountKey = await accountKeys.get(identity)!;
    const candidates = new Map<string, Set<number>>();
    for (const record of records) {
      if (record.userID !== uid || record.schemaVersion !== 1 || record.source?.provider !== session.source.provider
        || record.source.accountKey !== accountKey || record.calendarDate !== candidate.sleepDate
        || !['interval_summary', 'daily_summary'].includes(record.kind) || !Array.isArray(record.metrics)
        || !Number.isSafeInteger(record.startTimeMs) || !Number.isSafeInteger(record.endTimeMs)
        || record.endTimeMs <= record.startTimeMs) continue;
      // An overnight interval must overlap this night's real sleep, not just share its date.
      if (!group.some(item => record.startTimeMs < item.endTimeMs && record.endTimeMs > item.startTimeMs)) continue;
      for (const raw of record.metrics) {
        let entry: HealthMetricEntry;
        try { entry = decodeHealthMetricSportsLibData(raw); } catch { continue; }
        if (entry.kind !== 'value' || entry.metricId !== 'heart_rate_variability'
          || entry.normalizationStatus !== 'canonical' || entry.valueType !== 'number'
          || entry.canonical?.unit !== HEALTH_UNITS.Millisecond || !positiveNightlyHrv(entry.canonical.value)
          || entry.aggregation !== 'average' || !(HRV_PERSONAL_RANGE_VARIANTS as readonly string[]).includes(entry.semanticVariant)
          || !['provider_summary', 'recorded'].includes(entry.origin)
          || !['provider_calculated', 'device'].includes(entry.recordingMethod)) continue;
        const key = JSON.stringify(['health', identity, entry.semanticVariant, entry.aggregation, entry.origin, entry.recordingMethod]);
        if (!candidates.has(key)) candidates.set(key, new Set());
        candidates.get(key)!.add(entry.canonical.value);
      }
    }
    if (candidates.size !== 1) continue;
    const [sourceKey, values] = [...candidates][0];
    if (values.size !== 1) continue;
    result[index] = { ...session, nightlyHrvSourceKey: sourceKey,
      vitals: { ...session.vitals, overnightHrvMs: [...values][0] } };
  }
  return result;
}
