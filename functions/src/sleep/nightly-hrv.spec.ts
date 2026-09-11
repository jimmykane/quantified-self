import { describe, expect, it } from 'vitest';
import { enrichSleepWithNightlyHrv, nightlyHealthAccountKey, type NightlyHrvRecord, aggregateNightlyHrvEvidence } from '../../../shared/nightly-hrv';
import { encodeSleepSessionSportsLibData } from '../../../shared/sports-lib-health-data';
import { type SleepSession, type SleepProvider, SLEEP_PROVIDERS } from '../../../shared/sleep';
import { mapGarminHealthSummaries } from '../garmin/health';
import { buildHealthSourceRecordWrite } from '../health/writer';
import { mapGarminSleepSummary } from './provider-mappers';
import { supplementNightlyHrvSleepDocuments } from './nightly-hrv';

const uid = 'fixture-owner';
const start = Date.parse('2026-09-10T22:00:00Z');
const end = start + 8 * 3600000;
function sleep(provider: SleepProvider = SLEEP_PROVIDERS.GarminAPI): SleepSession {
  return { userID: uid, id: 'sleep', source: { provider, providerUserId: 'fixture-account', sourceSessionKey: 'fixture-sleep' },
    sleepDate: '2026-09-11', startTimeMs: start, endTimeMs: end, durationSeconds: 28800, isNap: false,
    stages: [], stageDurationsSeconds: {}, createdAtMs: end, updatedAtMs: end };
}
async function record(provider: string = SLEEP_PROVIDERS.GarminAPI): Promise<NightlyHrvRecord> {
  return { userID: uid, schemaVersion: 1, kind: 'interval_summary', source: {provider, accountKey: await nightlyHealthAccountKey(uid, provider, 'fixture-account')},
    calendarDate: '2026-09-11', startTimeMs: start, endTimeMs: end,
    metrics: [{ kind: 'value', metricId: 'heart_rate_variability', valueType: 'number', aggregation: 'average', semanticVariant: 'overnight_rmssd',
      normalizationStatus: 'canonical', origin: 'provider_summary', recordingMethod: 'provider_calculated', canonical: { value: 44, unit: 'ms' }, native: { metric: 'lastNightAvg', value: 44, unit: 'ms' } }] };
}
describe('shared nightly HRV', () => {
  it('retains a fragment HRV source and rejects mixtures of measurement semantics', () => {
    expect(aggregateNightlyHrvEvidence([{averageHrvMs: 44, hrvSourceKey: 'a'}, {averageHrvMs: null}]))
      .toEqual({averageHrvMs: 44, hrvSourceKey: 'a'});
    expect(aggregateNightlyHrvEvidence([{averageHrvMs: 44, hrvSourceKey: 'a'}, {averageHrvMs: 44, hrvSourceKey: 'b'}]))
      .toEqual({averageHrvMs: null});
  });
  it('feeds historical readiness from existing canonical Health and Sleep records', async () => {
    const { buildTrainingReadinessMetricPayload } = await import('../derived-metrics/derived-metrics.service');
    const inputs = [0, 1, 2, 3].map(offset => ({...sleep(), id: `night-${offset}`,
      sleepDate: `2026-09-${String(11 - offset).padStart(2, '0')}`, startTimeMs: start - offset * 86400000, endTimeMs: end - offset * 86400000}));
    const records = await Promise.all(inputs.map(async (session, offset) => {
      const r = await record();
      return {...r, calendarDate: session.sleepDate, startTimeMs: session.startTimeMs, endTimeMs: session.endTimeMs,
        metrics: r.metrics.map(m => m.kind === 'value' ? {...m, canonical: {value: offset === 0 ? 55 : 50, unit: 'ms' as const}} : m)};
    }));
    const documents = await supplementNightlyHrvSleepDocuments(uid, inputs.map(session => ({id: session.id!,
      data: encodeSleepSessionSportsLibData(session) as unknown as Record<string, unknown>})), async () => ({records}));
    const result = buildTrainingReadinessMetricPayload([], 0, documents.map(doc => ({id: doc.id, data: () => doc.data})), end + 3600000);
    expect(result.payload.evidenceVersion).toBe(1);
    expect(result.payload.points[result.payload.points.length - 1].hrvRatio).toBe(1.1);
    expect(JSON.stringify(result.payload)).not.toContain('fixture-account');
    expect(JSON.stringify(result.payload)).not.toContain('SourceKey');
  });
  it('keeps nightly HRV when recovery selects a longer fragment than the HRV-bearing fragment', async () => {
    const { buildTrainingBuildComparisonMetricPayload } = await import('../derived-metrics/derived-metrics.service');
    const sessions = Array.from({length: 5}, (_, offset) => {
      const night = {...sleep(), sleepDate: `2026-09-${String(11 - offset).padStart(2, '0')}`,
        startTimeMs: start - offset * 86400000, endTimeMs: end - offset * 86400000};
      return [{...night, id: `long-${offset}`, endTimeMs: night.endTimeMs - 7200000, durationSeconds: 21600},
        {...night, id: `short-${offset}`, startTimeMs: night.endTimeMs - 7200000, durationSeconds: 7200}];
    }).flat();
    const records = await Promise.all(sessions.filter(session => session.id.startsWith('long')).map(async session => ({
      ...await record(), calendarDate: session.sleepDate, startTimeMs: session.startTimeMs, endTimeMs: session.endTimeMs + 7200000,
    })));
    const enriched = await enrichSleepWithNightlyHrv(uid, sessions, records);
    const result = buildTrainingBuildComparisonMetricPayload([], {}, end + 3600000, enriched.map(session => ({id: session.id!, data: () => session})));
    expect(result.payload.recovery.current.medianOvernightHrvMs).toBe(44);
    expect(result.payload.recovery.current.overnightHrvNightCount).toBe(5);
  });
  it('never uses an incomplete page sequence to produce a nightly value', async () => {
    const documents = [{id: 'sleep', data: sleep() as unknown as Record<string, unknown>}];
    const r = await record();
    await expect(supplementNightlyHrvSleepDocuments(uid, documents, async () => ({records: Array(32).fill(r)})))
      .rejects.toThrow('cursor');
    await expect(supplementNightlyHrvSleepDocuments(uid, documents, async () => ({records: Array(33).fill(r)})))
      .rejects.toThrow('page');
  });
  it('loads every bounded page before enriching existing history', async () => {
    const r = await record();
    let calls = 0;
    const docs = await supplementNightlyHrvSleepDocuments(uid, [{id: 'sleep', data: sleep() as unknown as Record<string, unknown>}],
      async (_uid, startDate, endDate, limit, cursor) => {
        expect(startDate).toBe('2026-09-11'); expect(endDate).toBe(startDate); expect(limit).toBe(32);
        if (calls++ === 0) return { records: Array(32).fill(r), cursor: 'next' };
        expect(cursor).toBe('next'); return {records: []};
      });
    expect(calls).toBe(2);
    expect((docs[0].data.vitals as {overnightHrvMs: number}).overnightHrvMs).toBe(44);
  });
  it.each(Object.values(SLEEP_PROVIDERS))('supplements %s through canonical semantics and exact identity', async provider => {
    const input = encodeSleepSessionSportsLibData(sleep(provider));
    const [result] = await enrichSleepWithNightlyHrv(uid, [input], [await record(provider)]);
    expect(result.vitals?.overnightHrvMs).toBe(44);
    expect(result.nightlyHrvSourceKey).toContain('overnight_rmssd');
    expect(input.vitals).toBeUndefined();
    expect(result).not.toHaveProperty('sportsLibData');
  });
  it('matches the actual Garmin mapper and Health writer identity', async () => {
    const mapped = mapGarminHealthSummaries('hrv', [{ summaryId: 'hrv', calendarDate: '2026-09-11', startTimeInSeconds: start / 1000,
      durationInSeconds: 28800, lastNightAvg: 44 }], 'fixture-account', end, end)[0];
    const built = await buildHealthSourceRecordWrite(uid, mapped.input, end);
    const mappedSleep = mapGarminSleepSummary({ summaryId: 'sleep', calendarDate: '2026-09-11', startTimeInSeconds: start / 1000, durationInSeconds: 28800 }, 'fixture-account', end)!;
    const [result] = await enrichSleepWithNightlyHrv(uid, [{ ...sleep(), ...mappedSleep.session }], [built.sourceRecord]);
    expect(result.vitals?.overnightHrvMs).toBe(44);
  });
  it('preserves native values and attaches a missing night only once across fragments', async () => {
    const original = { ...sleep(), vitals: { averageHrvMs: 50 } };
    expect((await enrichSleepWithNightlyHrv(uid, [original], [await record()]))[0]).toEqual(original);
    const fragments = [sleep(), { ...sleep(), id: 'earlier', endTimeMs: end - 3600000 }];
    const result = await enrichSleepWithNightlyHrv(uid, fragments, [await record()]);
    expect(result.filter(s => s.vitals?.overnightHrvMs === 44)).toHaveLength(1);
    expect(result[0].vitals?.overnightHrvMs).toBe(44);
  });
  it.each(['owner', 'account', 'provider', 'date', 'interval', 'spot', 'maximum', 'manual', 'zero', 'nan', 'unknown'])('rejects %s mismatches', async kind => {
    const r = await record();
    const m = r.metrics[0];
    if (kind === 'owner') r.userID = 'other';
    if (kind === 'account') r.source.accountKey = 'other';
    if (kind === 'provider') r.source.provider = 'SuuntoApp';
    if (kind === 'date') r.calendarDate = '2026-09-10';
    if (kind === 'interval') { r.startTimeMs = end; r.endTimeMs = end + 1000; }
    if (kind === 'spot') m.semanticVariant = 'health_snapshot_rmssd';
    if (kind === 'maximum') m.aggregation = 'maximum';
    if (kind === 'manual') m.recordingMethod = 'manual';
    if (kind === 'unknown') m.semanticVariant = 'new_unknown';
    if (m.kind === 'value' && m.canonical && kind === 'zero') m.canonical.value = 0;
    if (m.kind === 'value' && m.canonical && kind === 'nan') m.canonical.value = NaN;
    expect((await enrichSleepWithNightlyHrv(uid, [sleep()], [r]))[0].vitals).toBeUndefined();
  });
  it('withholds conflicts but deduplicates identical observations', async () => {
    const a = await record(), b = await record();
    expect((await enrichSleepWithNightlyHrv(uid, [sleep()], [a, b]))[0].vitals?.overnightHrvMs).toBe(44);
    if (b.metrics[0].kind === 'value') b.metrics[0].canonical!.value = 45;
    expect((await enrichSleepWithNightlyHrv(uid, [sleep()], [a, b]))[0].vitals).toBeUndefined();
  });
  it('never uses naps, unknown providers, or unidentified legacy accounts for a join', async () => {
    const missing = sleep(); delete missing.source.providerUserId;
    const result = await enrichSleepWithNightlyHrv(uid, [{...sleep(), isNap: true}, missing], [await record()]);
    expect(result.every(s => !s.vitals)).toBe(true);
  });
  it('fails closed for oversized reads', async () => {
    await expect(enrichSleepWithNightlyHrv(uid, [sleep()], Array(2049).fill(await record()))).rejects.toThrow('bounded');
  });
});
