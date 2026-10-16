import type { HealthRangeQuery, HealthRangeResult, HealthSampleChunk } from './health';
import { nightlyHealthAccountKey } from './nightly-hrv';
import { decodeSleepSessionSportsLibData } from './sports-lib-health-data';
import { resolveSleepDisplayDate, SLEEP_PROVIDERS, type SleepSession } from './sleep';

/** Read-time provenance only. Never persist this annotation or forward it through MCP. */
export type CalculatedSleepHeartRateSession = SleepSession & {
  qsCalculatedHeartRate?: { average: boolean; minimum: boolean };
};
export const NIGHTLY_HEART_RATE_LIMITS = Object.freeze({
  days: 93, windowDays: 1, chunks: 512, points: 550_000, bytes: 16 * 1024 * 1024,
  minimumCoverage: 0.9, maximumGapMs: 5 * 60_000,
});
const DAY_MS = 86_400_000;
const SAMPLE_MS = 15_000;
const GARMIN_SLEEP_HR_METHOD = 'qs_garmin_sleep_15_second';
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function calculatedHeartRateSourceKeys(session: CalculatedSleepHeartRateSession): {
  averageHeartRateSourceKey?: string; minimumHeartRateSourceKey?: string;
} {
  return {
    ...(session.qsCalculatedHeartRate?.average === true ? { averageHeartRateSourceKey: GARMIN_SLEEP_HR_METHOD } : {}),
    ...(session.qsCalculatedHeartRate?.minimum === true ? { minimumHeartRateSourceKey: GARMIN_SLEEP_HR_METHOD } : {}),
  };
}

function candidates(uid: string, sessions: readonly SleepSession[]): SleepSession[] {
  return sessions.filter(s => {
    const decoded = decodeSleepSessionSportsLibData(s);
    return s.source?.provider === SLEEP_PROVIDERS.GarminAPI && !s.isNap
    && (!s.userID || s.userID === uid) && typeof s.source.providerUserId === 'string'
    && s.source.providerUserId.trim().length > 0 && s.source.providerUserId.length <= 1024
    && Number.isSafeInteger(s.startTimeMs) && Number.isSafeInteger(s.endTimeMs)
    && Number.isFinite(new Date(s.startTimeMs).getTime()) && Number.isFinite(new Date(s.endTimeMs).getTime())
    && resolveSleepDisplayDate(s) !== null
    && s.endTimeMs - s.startTimeMs >= 60 * 60_000 && s.endTimeMs - s.startTimeMs <= 18 * 60 * 60_000
    && (!positive(decoded.vitals?.averageHeartRateBpm) || !positive(decoded.vitals?.minimumHeartRateBpm));
  });
}

/** Include adjacent provider dates: a night can cross local midnight and UTC boundaries. */
export function nightlyHeartRateQueries(uid: string, sessions: readonly SleepSession[], nowMs = Date.now()): HealthRangeQuery[] {
  // Readiness can retain future records for its eligibility timer. A far-future outlier must not suppress current HR.
  const missing = candidates(uid, sessions).filter(s => s.endTimeMs <= nowMs + 18 * 60 * 60_000);
  if (!uid?.trim() || !missing.length) return [];
  const start = Math.floor(Math.min(...missing.map(s => s.startTimeMs)) / DAY_MS) * DAY_MS - DAY_MS;
  const end = Math.floor(Math.max(...missing.map(s => s.endTimeMs)) / DAY_MS) * DAY_MS + DAY_MS;
  if (start < 0 || !Number.isFinite(new Date(end).getTime())
    || (end - start) / DAY_MS + 1 > NIGHTLY_HEART_RATE_LIMITS.days) return [];
  const days = new Set<number>();
  for (const session of missing) {
    const first = Math.floor(session.startTimeMs / DAY_MS) * DAY_MS - DAY_MS;
    const last = Math.floor(session.endTimeMs / DAY_MS) * DAY_MS + DAY_MS;
    for (let day = first; day <= last; day += NIGHTLY_HEART_RATE_LIMITS.windowDays * DAY_MS) days.add(day);
  }
  return [...days].sort((a, b) => a - b).map(day => ({ startDate: date(day), endDate: date(day),
      // Metric-first avoids spending this bounded sample page on Garmin's other feeds.
      providers: [], metricIds: ['heart_rate'], includeSamples: true,
      sourceRecordLimit: 32, chunkLimit: 8, samplePointLimit: 11_520 }));
}

function eligibleChunk(uid: string, chunk: HealthSampleChunk): boolean {
  return chunk.userID === uid && chunk.schemaVersion === 1 && chunk.provider === SLEEP_PROVIDERS.GarminAPI
    && chunk.metricId === 'heart_rate' && chunk.valueType === 'number'
    && chunk.aggregation === 'representative_sample' && chunk.semanticVariant === 'daily_15_second'
    && chunk.seriesKey === 'heart_rate_15_second_representative'
    && chunk.origin === 'recorded' && chunk.recordingMethod === 'device'
    && chunk.normalizationStatus === 'canonical' && chunk.canonicalUnit === 'bpm'
    && Number.isSafeInteger(chunk.startTimeMs) && Number.isSafeInteger(chunk.endTimeMs)
    && Array.isArray(chunk.offsetMs) && Array.isArray(chunk.canonicalValues)
    && chunk.offsetMs.length === chunk.canonicalValues.length;
}

function accountForRange(budget: { chunks: number; points: number; bytes: number }, range: HealthRangeResult): void {
  budget.chunks += range.sampleChunks.length;
  budget.points += range.sampleChunks.reduce((sum, chunk) => sum + chunk.offsetMs.length, 0);
  budget.bytes += new TextEncoder().encode(JSON.stringify(range)).byteLength;
  if (budget.chunks > NIGHTLY_HEART_RATE_LIMITS.chunks || budget.points > NIGHTLY_HEART_RATE_LIMITS.points
    || budget.bytes > NIGHTLY_HEART_RATE_LIMITS.bytes) throw new Error('Nightly heart rate exceeds the bounded read limit.');
}

function firstAfter(samples: readonly [number, number | null][], time: number): number {
  let low = 0, high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle][0] <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Only accept complete results from the existing parent/revision-checked Health reader. */
export async function enrichSleepWithNightlyHeartRate(
  uid: string, sessions: readonly SleepSession[], ranges: readonly HealthRangeResult[],
): Promise<CalculatedSleepHeartRateSession[]> {
  const missing = new Set(candidates(uid, sessions));
  if (!uid?.trim() || !missing.size || !ranges.length) return [...sessions];
  const chunks: HealthSampleChunk[] = [];
  const budget = { chunks: 0, points: 0, bytes: 0 };
  for (const range of ranges) {
    if (!range.pageInfo.sourceRecordAggregateComplete || !range.pageInfo.sampleAggregateComplete
      || range.pageInfo.sampleRevisionMismatchCount !== 0) return [...sessions];
    accountForRange(budget, range);
    chunks.push(...range.sampleChunks);
  }
  const samples = new Map<string, Map<number, number | null>>();
  for (const chunk of chunks) {
    if (!eligibleChunk(uid, chunk)) continue;
    const series = samples.get(chunk.accountKey) || new Map<number, number | null>();
    samples.set(chunk.accountKey, series);
    chunk.offsetMs.forEach((offset, i) => {
      const time = chunk.startTimeMs + offset, value = chunk.canonicalValues![i];
      if (!Number.isSafeInteger(offset) || offset < 0 || time > chunk.endTimeMs
        || !positive(value) || value > 300) return;
      // Identical redeliveries count once; conflicting overlapping readings remain unavailable.
      if (series.has(time) && series.get(time) !== value) series.set(time, null);
      else if (!series.has(time)) series.set(time, value);
    });
  }
  // Sort each account once, then select each night's interval without rescanning the full history.
  const ordered = new Map([...samples].map(([account, values]) => [account, [...values].sort((a, b) => a[0] - b[0])]));
  samples.clear();
  const accounts = new Map<string, Promise<string>>();
  return Promise.all(sessions.map(async original => {
    if (!missing.has(original)) return original;
    const account = original.source.providerUserId;
    if (!accounts.has(account)) accounts.set(account, nightlyHealthAccountKey(uid, SLEEP_PROVIDERS.GarminAPI, account));
    const values = ordered.get(await accounts.get(account)!);
    if (!values) return original;
    const selected = values.slice(firstAfter(values, original.startTimeMs), firstAfter(values, original.endTimeMs));
    let covered = 0, weighted = 0, minimum = Infinity, cursor = original.startTimeMs;
    for (const [time, value] of selected) {
      if (value === null) return original;
      const start = Math.max(original.startTimeMs, time - SAMPLE_MS), end = Math.min(original.endTimeMs, time);
      if (start < cursor || start - cursor > NIGHTLY_HEART_RATE_LIMITS.maximumGapMs) return original;
      const duration = end - start;
      covered += duration; weighted += value * duration; minimum = Math.min(minimum, value); cursor = end;
    }
    if (!covered || original.endTimeMs - cursor > NIGHTLY_HEART_RATE_LIMITS.maximumGapMs
      || covered / (original.endTimeMs - original.startTimeMs) < NIGHTLY_HEART_RATE_LIMITS.minimumCoverage) return original;
    const session = decodeSleepSessionSportsLibData(original);
    const average = !positive(session.vitals?.averageHeartRateBpm), low = !positive(session.vitals?.minimumHeartRateBpm);
    return { ...session, qsCalculatedHeartRate: { average, minimum: low }, vitals: { ...session.vitals,
      ...(average ? { averageHeartRateBpm: weighted / covered } : {}), ...(low ? { minimumHeartRateBpm: minimum } : {}) } };
  }));
}

/** At most four read-only requests in flight, with one cumulative budget across windows. */
export async function loadNightlyHeartRate(
  uid: string, sessions: readonly SleepSession[], read: (query: HealthRangeQuery) => Promise<HealthRangeResult>,
): Promise<CalculatedSleepHeartRateSession[]> {
  const results: HealthRangeResult[] = [];
  const queries = nightlyHeartRateQueries(uid, sessions), budget = { chunks: 0, points: 0, bytes: 0 };
  for (let index = 0; index < queries.length; index += 4) {
    const batch = await Promise.all(queries.slice(index, index + 4).map(read));
    for (const result of batch) { accountForRange(budget, result); results.push(result); }
  }
  return enrichSleepWithNightlyHeartRate(uid, sessions, results);
}
