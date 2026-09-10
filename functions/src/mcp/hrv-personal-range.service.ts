import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import { calculatePersonalMetricRange, calculatePersonalMetricPointRange, calculatePersonalMetricRangeTimeline, PersonalMetricRangeObservation,
  HRV_PERSONAL_RANGE_OPTIONS, HRV_PERSONAL_RANGE_VARIANTS } from '../../../shared/personal-metric-range';
import { decodeHealthMetricSportsLibData, decodeSleepSessionSportsLibData, formatCanonicalHealthMetricSportsLibValue } from '../../../shared/sports-lib-health-data';
import { HealthMetricEntry, HEALTH_UNITS } from '../../../shared/health';
import { SleepSession, SLEEP_SPORTS_LIB_METRIC_FIELDS } from '../../../shared/sleep';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { McpHealthError, firestoreHealthReads } from './health.service';

const DAY = 86400000;
const options = HRV_PERSONAL_RANGE_OPTIONS;
const variants = HRV_PERSONAL_RANGE_VARIANTS;
const reason = z.enum(['building_baseline', 'insufficient_current', 'within_range', 'outside_range', 'far_outside_range']);
const range = z.strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() }).nullable();
const display = z.strictObject({ value: z.string().max(100), unit: z.string().max(100) }).nullable();
export const MCP_HRV_RANGE_SCHEMA = z.strictObject({
  startTimeMs: z.number().int().safe(), endTimeMs: z.number().int().safe(),
  baselineWindowDays: z.literal(60), baselineMinimumObservationDays: z.literal(14),
  currentWindowDays: z.literal(7), currentMinimumObservationDays: z.literal(3),
  recordsRead: z.number().int().min(0).max(3048), excludedValues: z.number().int().nonnegative(),
  series: z.array(z.strictObject({
    source: z.enum(['health', 'sleep']), provider: z.enum(['GarminAPI', 'SuuntoApp', 'COROSAPI']),
    accountNumber: z.number().int().positive(), seriesNumber: z.number().int().positive(),
    semanticVariant: z.enum(variants), aggregation: z.enum(['average', 'measurement', 'latest', 'summary']),
    origin: z.enum(['provider_summary', 'recorded']), recordingMethod: z.enum(['provider_calculated', 'device', 'unknown']),
    unit: z.literal(HEALTH_UNITS.Millisecond),
    status: reason, currentAverage: z.number().nullable(), currentAverageDisplay: display, normalRange: range,
    observationDayCount: z.number().int().nonnegative(),
    readings: z.array(z.strictObject({ date: z.iso.date(), value: z.number().nonnegative(), display,
      status: reason, normalRange: range })).max(8192),
    rangePoints: z.array(z.strictObject({ timeMs: z.number().int().safe(), normalRange: range })).max(367),
  })).max(32),
});
export interface HrvRangeInput { uid: string; scopes: readonly string[]; startTimeMs: number; endTimeMs: number }
interface Document { data: Record<string, unknown>; cursor: unknown }
export interface HrvRangeReads {
  fetchUnitSettings: typeof firestoreHealthReads.fetchUnitSettings;
  activeOwner(uid: string): Promise<boolean>;
  fetchPage(uid: string, source: 'health' | 'sleep', start: number, end: number, limit: number, cursor?: unknown): Promise<Document[]>;
}
export const firestoreHrvRangeReads: HrvRangeReads = {
  fetchUnitSettings: firestoreHealthReads.fetchUnitSettings,
  async activeOwner(uid) { const state = await getUserDeletionGuardState(admin.firestore(), uid); return !state.shouldSkip; },
  async fetchPage(uid, source, start, end, limit, cursor) {
    const root = admin.firestore().collection('users').doc(uid);
    let query = source === 'health'
      ? root.collection('healthSourceRecords').where('metricIds', 'array-contains', 'heart_rate_variability')
        .where('calendarDate', '>=', new Date(start - DAY).toISOString().slice(0, 10))
        .where('calendarDate', '<=', new Date(end + DAY).toISOString().slice(0, 10))
        .orderBy('calendarDate').orderBy(FieldPath.documentId())
        .select('userID', 'schemaVersion', 'source.provider', 'source.accountKey', 'calendarDate', 'endTimeMs', 'metrics')
      : root.collection('sleepSessions').where('endTimeMs', '>=', start).where('endTimeMs', '<=', end)
        .orderBy('endTimeMs').orderBy(FieldPath.documentId())
        .select('source.provider', 'source.providerUserId', 'sleepDate', 'endTimeMs', 'isNap',
          'vitals.averageHrvMs', 'vitals.overnightHrvMs', 'sportsLibData.schemaVersion',
          new FieldPath('sportsLibData', 'metrics', SLEEP_SPORTS_LIB_METRIC_FIELDS.AverageHrv),
          new FieldPath('sportsLibData', 'metrics', SLEEP_SPORTS_LIB_METRIC_FIELDS.OvernightHrv));
    if (cursor) query = query.startAfter(cursor as admin.firestore.QueryDocumentSnapshot);
    return (await query.limit(limit).get()).docs.map(doc => ({ data: doc.data(), cursor: doc }));
  },
};

/** Complete bounded reads only: never calculate a baseline from a truncated or downsampled series. */
export async function queryHrvPersonalRange(input: HrvRangeInput, reads: HrvRangeReads) {
  if (!input.scopes.includes('health:read') || !input.scopes.includes('sleep:read'))
    throw new McpHealthError('invalid_request', 'Health and Sleep access are required. Reconnect to grant both.');
  const { startTimeMs: start, endTimeMs: end } = input;
  if (![start, end].every(Number.isSafeInteger) || end < start || end - start >= 366 * DAY
    || !Number.isFinite(new Date(start - 61 * DAY).getTime()) || !Number.isFinite(new Date(end + DAY).getTime()))
    throw new McpHealthError('invalid_request', 'Use an explicit range of at most 366 days.');
  if (!await reads.activeOwner(input.uid)) throw new McpHealthError('temporarily_unavailable', 'Account is unavailable.');
  const unitSettings = await reads.fetchUnitSettings(input.uid);
  const historyStart = start - 60 * DAY;
  let recordsRead = 0, bytes = 0, excludedValues = 0, values = 0;
  type Series = { source: 'health' | 'sleep'; provider: 'GarminAPI' | 'SuuntoApp' | 'COROSAPI'; accountNumber: number;
    seriesNumber: number; semanticVariant: typeof variants[number]; aggregation: string; origin: string; recordingMethod: string;
    observations: PersonalMetricRangeObservation[] };
  const series = new Map<string, Series>();
  const accounts = new Map<string, number>();
  function add(source: 'health' | 'sleep', provider: unknown, account: unknown, date: unknown, timestamp: unknown,
    variant: unknown, value: unknown, aggregation: unknown, origin: unknown, method: unknown) {
    if (!['GarminAPI', 'SuuntoApp', 'COROSAPI'].includes(String(provider)) || typeof account !== 'string' || !account || account.length > 1024
      || !z.iso.date().safeParse(date).success || typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)
      || timestamp < historyStart || timestamp > end || !variants.includes(variant as typeof variants[number])
      || typeof value !== 'number' || !Number.isFinite(value) || value <= 0
      || !['average', 'measurement', 'latest', 'summary'].includes(String(aggregation))
      || !['provider_summary', 'recorded'].includes(String(origin))
      || !['provider_calculated', 'device', 'unknown'].includes(String(method))) { excludedValues++; return; }
    const formatted = formatCanonicalHealthMetricSportsLibValue('heart_rate_variability', value, unitSettings);
    if (!formatted) { excludedValues++; return; }
    if (++values > 8192) throw new McpHealthError('query_too_large', 'Too many HRV readings. Narrow the range.');
    const accountKey = JSON.stringify([source, provider, account]);
    if (!accounts.has(accountKey)) accounts.set(accountKey, accounts.size + 1);
    const key = JSON.stringify([accountKey, variant, aggregation, origin, method]);
    if (!series.has(key)) {
      if (series.size === 32) throw new McpHealthError('query_too_large', 'Too many HRV series. Narrow the range.');
      series.set(key, { source, provider: provider as Series['provider'], accountNumber: accounts.get(accountKey)!,
        seriesNumber: series.size + 1, semanticVariant: variant as Series['semanticVariant'], aggregation: String(aggregation),
        origin: String(origin), recordingMethod: String(method), observations: [] });
    }
    series.get(key)!.observations.push({ timestampMs: timestamp, calendarDate: date as string, value });
  }
  for (const source of ['health', 'sleep'] as const) {
    let cursor: unknown, count = 0;
    const cap = source === 'health' ? 2048 : 1000;
    while (true) {
      const limit = Math.min(32, cap - count + 1);
      const page = await reads.fetchPage(input.uid, source, historyStart, end, limit, cursor);
      if (page.length > limit) throw new McpHealthError('temporarily_unavailable', 'HRV read failed.');
      for (const doc of page) {
        bytes += Buffer.byteLength(JSON.stringify(doc.data), 'utf8');
        if (++count > cap || bytes > 16 * 1024 * 1024) throw new McpHealthError('query_too_large', 'HRV history exceeds the read limit. Narrow the range.');
        recordsRead++;
        const d = doc.data;
        if (source === 'health') {
          if (d.userID !== input.uid || d.schemaVersion !== 1 || !Array.isArray(d.metrics)) { excludedValues++; continue; }
          const identity = d.source as { provider?: unknown; accountKey?: unknown } | undefined;
          for (const raw of d.metrics) {
            let entry: HealthMetricEntry;
            try { entry = decodeHealthMetricSportsLibData(raw); } catch { excludedValues++; continue; }
            if (entry.metricId !== 'heart_rate_variability' || entry.kind !== 'value'
              || entry.normalizationStatus !== 'canonical' || entry.canonical?.unit !== HEALTH_UNITS.Millisecond) continue;
            add(source, identity?.provider, identity?.accountKey, d.calendarDate, d.endTimeMs, entry.semanticVariant,
              entry.canonical.value, entry.aggregation, entry.origin, entry.recordingMethod);
          }
        } else {
          let session: SleepSession;
          try { session = decodeSleepSessionSportsLibData(d as unknown as SleepSession); } catch { excludedValues++; continue; }
          if (session.isNap) continue;
          for (const [field, variant] of [['averageHrvMs', 'sleep_session_average_hrv'], ['overnightHrvMs', 'sleep_overnight_hrv']] as const) {
            const value = session.vitals?.[field];
            if (value === null || value === undefined) continue;
            add(source, session.source?.provider, session.source?.providerUserId || 'default', session.sleepDate,
              session.endTimeMs, variant, value, 'average', 'provider_summary', 'provider_calculated');
          }
        }
      }
      if (page.length < limit) break;
      const next = page[page.length - 1]?.cursor;
      if (!next || next === cursor) throw new McpHealthError('temporarily_unavailable', 'HRV pagination failed.');
      cursor = next;
    }
  }
  const clamp = (value: { min: number; max: number } | null) => value ? { min: Math.max(0, value.min), max: value.max } : null;
  const format = (value: number | null) => value === null ? null : formatCanonicalHealthMetricSportsLibValue('heart_rate_variability', value, unitSettings);
  const result = { startTimeMs: start, endTimeMs: end, ...options, recordsRead, excludedValues,
    series: [...series.values()].map(({ observations, ...identity }) => {
      observations.sort((a, b) => a.timestampMs - b.timestampMs);
      const current = calculatePersonalMetricRange(observations, end, options);
      const rangePoints = calculatePersonalMetricRangeTimeline(observations, start, end, options)
        .map(({ timestampMs, normalRange }) => ({ timeMs: timestampMs, normalRange }));
      return { ...identity, unit: HEALTH_UNITS.Millisecond, status: current.reason, currentAverage: current.currentAverage,
        currentAverageDisplay: format(current.currentAverage), normalRange: clamp(current.normalRange), observationDayCount: current.observationDayCount,
        readings: observations.filter(point => point.timestampMs >= start).map(point => {
          const status = calculatePersonalMetricPointRange(observations, point, options);
          return { date: point.calendarDate, value: point.value, display: format(point.value), status: status.reason, normalRange: clamp(status.normalRange) };
        }), rangePoints };
    }) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 512 * 1024) throw new McpHealthError('query_too_large', 'HRV output is too large. Narrow the range.');
  if (!await reads.activeOwner(input.uid)) throw new McpHealthError('temporarily_unavailable', 'Account is unavailable.');
  return MCP_HRV_RANGE_SCHEMA.parse(result);
}
