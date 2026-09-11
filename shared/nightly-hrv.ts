import { type HealthMetricEntry, HEALTH_UNITS } from './health';
import { decodeHealthMetricSportsLibData, decodeSleepSessionSportsLibData } from './sports-lib-health-data';
import { normalizeSleepProvider, type SleepSession } from './sleep';
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

export function positiveNightlyHrv(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function sleepHrvSourceKey(session: NightlyHrvSleepSession): string | undefined {
  if (session.nightlyHrvSourceKey) return session.nightlyHrvSourceKey;
  const field = positiveNightlyHrv(session.vitals?.averageHrvMs) ? 'average'
    : positiveNightlyHrv(session.vitals?.overnightHrvMs) ? 'overnight' : null;
  return field ? JSON.stringify(['sleep', sleepEvidenceSourceKey(session), field]) : undefined;
}

/** A fragment without HRV must not erase the source of another fragment's reading. */
export function aggregateNightlyHrvEvidence<T extends { averageHrvMs: number | null; hrvSourceKey?: string }>(
  points: readonly T[],
): { averageHrvMs: number | null; hrvSourceKey?: string } {
  const values = points.filter(point => positiveNightlyHrv(point.averageHrvMs));
  const keys = new Set(values.map(point => point.hrvSourceKey));
  if (!values.length || keys.size !== 1) return { averageHrvMs: null };
  const hrvSourceKey = values[0].hrvSourceKey;
  return { averageHrvMs: values.reduce((sum, point) => sum + point.averageHrvMs!, 0) / values.length,
    ...(hrvSourceKey ? { hrvSourceKey } : {}) };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function nightlyHrvDateRange(sessions: readonly SleepSession[]): { startDate: string; endDate: string } | null {
  const dates = sessions.filter(session => !session.isNap && normalizeSleepProvider(session.source?.provider)
    && session.source?.providerUserId && validDate(session.sleepDate)
    && !positiveNightlyHrv(session.vitals?.averageHrvMs) && !positiveNightlyHrv(session.vitals?.overnightHrvMs))
    .map(session => session.sleepDate).sort();
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
  const groups = new Map<string, number[]>();
  sessions.forEach((session, index) => {
    if (session.isNap || !normalizeSleepProvider(session.source?.provider) || !validDate(session.sleepDate)
      || !Number.isSafeInteger(session.startTimeMs) || !Number.isSafeInteger(session.endTimeMs)
      || session.endTimeMs <= session.startTimeMs) return;
    const key = JSON.stringify([sleepEvidenceSourceKey(session), session.sleepDate]);
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  const accountKeys = new Map<string, Promise<string>>();
  const result: NightlyHrvSleepSession[] = [...sessions];
  for (const indexes of groups.values()) {
    if (indexes.some(index => positiveNightlyHrv(sessions[index].vitals?.averageHrvMs)
      || positiveNightlyHrv(sessions[index].vitals?.overnightHrvMs))) continue;
    const index = [...indexes].sort((a, b) => sessions[b].endTimeMs - sessions[a].endTimeMs
      || sessions[b].startTimeMs - sessions[a].startTimeMs || (sessions[b].id || '').localeCompare(sessions[a].id || ''))[0];
    const session = sessions[index];
    const providerAccountId = session.source.providerUserId;
    if (!providerAccountId || providerAccountId.length > 1024 || (session.userID && session.userID !== uid)) continue;
    const identity = sleepEvidenceSourceKey(session);
    if (!accountKeys.has(identity)) accountKeys.set(identity, nightlyHealthAccountKey(uid, session.source.provider, providerAccountId));
    const accountKey = await accountKeys.get(identity)!;
    const candidates = new Map<string, Set<number>>();
    for (const record of records) {
      if (record.userID !== uid || record.schemaVersion !== 1 || record.source?.provider !== session.source.provider
        || record.source.accountKey !== accountKey || record.calendarDate !== session.sleepDate
        || !['interval_summary', 'daily_summary'].includes(record.kind) || !Array.isArray(record.metrics)
        || !Number.isSafeInteger(record.startTimeMs) || !Number.isSafeInteger(record.endTimeMs)
        || record.endTimeMs <= record.startTimeMs) continue;
      // An overnight interval must overlap this night's real sleep, not just share its date.
      if (!indexes.some(i => record.startTimeMs < sessions[i].endTimeMs && record.endTimeMs > sessions[i].startTimeMs)) continue;
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
