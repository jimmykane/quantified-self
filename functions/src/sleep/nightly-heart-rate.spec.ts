import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichSleepWithNightlyHeartRate, loadNightlyHeartRate, nightlyHeartRateQueries } from '../../../shared/nightly-heart-rate';
import { projectHealthRange } from '../../../shared/health-query';
import type { HealthRangeResult, HealthSampleChunk } from '../../../shared/health';
import { encodeSleepSessionSportsLibData } from '../../../shared/sports-lib-health-data';
import type { SleepSession } from '../../../shared/sleep';
import { mapGarminHealthSummaries } from '../garmin/health';
import { buildHealthSourceRecordWrite } from '../health/writer';
import { supplementNightlyHealthSleepDocuments } from './nightly-hrv';
import * as deletionGuard from '../shared/user-deletion-guard';
import { buildTrainingReadinessMetricPayload } from '../derived-metrics/derived-metrics.service';
import { buildReadinessEvaluation } from '../../../shared/readiness';

const uid = 'fixture-owner', account = 'fixture-account';
const start = Date.parse('2026-10-14T22:00:00Z'), end = start + 8 * 3_600_000;
function sleep(): SleepSession {
  return { userID: uid, id: 'night', source: { provider: 'GarminAPI', providerUserId: account, sourceSessionKey: 'night' },
    sleepDate: '2026-10-15', startTimeMs: start, endTimeMs: end, durationSeconds: 28800, isNap: false,
    stages: [], stageDurationsSeconds: {}, createdAtMs: end, updatedAtMs: end };
}
async function fixture(): Promise<{ range: HealthRangeResult; chunks: HealthSampleChunk[] }> {
  const summaries = ['2026-10-14', '2026-10-15'].map(calendarDate => {
    const day = Date.parse(calendarDate), samples: Record<string, number> = {};
    for (let t = start + 15_000; t <= end; t += 15_000) {
      if (t >= day && t < day + 86_400_000) samples[String((t - day) / 1000)] = t === start + 15_000 ? 50 : 60;
    }
    return { summaryId: calendarDate, calendarDate, startTimeInSeconds: day / 1000,
      durationInSeconds: 86400, timeOffsetHeartRateSamples: samples };
  });
  const mapped = mapGarminHealthSummaries('dailies', summaries, account, end, end);
  const built = await Promise.all(mapped.map(m => buildHealthSourceRecordWrite(uid, m.input, end)));
  const chunks = built.flatMap(b => b.chunks);
  return { chunks, range: projectHealthRange(built.map(b => b.sourceRecord), chunks, {
    startDate: '2026-10-14', endDate: '2026-10-15', metricIds: ['heart_rate'], includeSamples: true,
    sourceRecordLimit: 32, chunkLimit: 8, samplePointLimit: 11_520,
  }, end) };
}
describe('QS-calculated Garmin sleep heart rate', () => {
  afterEach(() => vi.restoreAllMocks());
  it('joins real Garmin mapper/writer output across midnight without changing stored records', async () => {
    const { range } = await fixture();
    const original = encodeSleepSessionSportsLibData(sleep());
    const [result] = await enrichSleepWithNightlyHeartRate(uid, [original], [range]);
    expect(result.vitals?.averageHeartRateBpm).toBeCloseTo(60 - 10 / 1920);
    expect(result.vitals?.minimumHeartRateBpm).toBe(50);
    expect(result.qsCalculatedHeartRate).toEqual({ average: true, minimum: true });
    expect(original.vitals).toBeUndefined();
    expect(result).not.toHaveProperty('sportsLibData');
  });
  it('preserves native values independently', async () => {
    const { range } = await fixture();
    const original = { ...sleep(), vitals: { averageHeartRateBpm: 65 } };
    const [result] = await enrichSleepWithNightlyHeartRate(uid, [original], [range]);
    expect(result.vitals).toEqual({ averageHeartRateBpm: 65, minimumHeartRateBpm: 50 });
    expect(result.qsCalculatedHeartRate).toEqual({ average: false, minimum: true });
  });
  it('does not read Health for canonical native HR and never invents an empty owner', async () => {
    const s = encodeSleepSessionSportsLibData({ ...sleep(), vitals: { averageHeartRateBpm: 64, minimumHeartRateBpm: 48 } });
    const read = vi.fn();
    expect(await loadNightlyHeartRate(uid, [s], read)).toEqual([s]);
    expect(read).not.toHaveBeenCalled();
    expect(nightlyHeartRateQueries('', [sleep()])).toEqual([]);
  });
  it('clips the first representative interval to the sleep boundary before averaging', async () => {
    const { range } = await fixture();
    const [result] = await enrichSleepWithNightlyHeartRate(uid, [{ ...sleep(), startTimeMs: start + 5000 }], [range]);
    expect(result.vitals?.averageHeartRateBpm).toBeCloseTo(60 - 10 * 10_000 / (end - start - 5000));
  });
  it('never uses a reading recorded after the sleep ended', async () => {
    const { range } = await fixture();
    range.sampleChunks.push({ ...range.sampleChunks[0], startTimeMs: end + 5000, endTimeMs: end + 5000, offsetMs: [0], canonicalValues: [1] });
    const [result] = await enrichSleepWithNightlyHeartRate(uid, [sleep()], [range]);
    expect(result.vitals?.minimumHeartRateBpm).toBe(50);
  });
  it('keeps the current calculated baseline separate from native values and the frozen legacy history', () => {
    const sessions = Array.from({ length: 4 }, (_, i) => ({ ...sleep(), id: `night-${i}`,
      sleepDate: new Date(end - i * 86400000).toISOString().slice(0, 10),
      startTimeMs: start - i * 86400000, endTimeMs: end - i * 86400000,
      qsCalculatedHeartRate: { average: true, minimum: true },
      vitals: { averageHeartRateBpm: i ? 60 : 54, minimumHeartRateBpm: i ? 50 : 45 } }));
    const result = buildTrainingReadinessMetricPayload([], 0, sessions.map(s => ({ id: s.id, data: () => s })), end + 3600000);
    expect(result.payload.points.at(-1)?.overnightHeartRateRatio).toBeCloseTo(0.9);
    expect(result.payload.legacyPoints?.at(-1)?.overnightHeartRateRatio).toBeNull();
    expect(JSON.stringify(result.payload)).not.toMatch(/qsCalculatedHeartRate|SourceKey|fixture-account/);
    const points = sessions.map(s => ({ id: s.id, sleepDate: s.sleepDate, provider: s.source.provider, startTimeMs: s.startTimeMs,
      endTimeMs: s.endTimeMs, totalSeconds: s.durationSeconds, score: null, averageHrvMs: null,
      averageHeartRateBpm: s.vitals.averageHeartRateBpm, minimumHeartRateBpm: s.vitals.minimumHeartRateBpm,
      averageHeartRateSourceKey: s.id === 'night-0' ? 'qs_garmin_sleep_15_second' : undefined,
      minimumHeartRateSourceKey: s.id === 'night-0' ? 'qs_garmin_sleep_15_second' : undefined }));
    expect(buildReadinessEvaluation({ sleepPoints: points, nowMs: end + 3600000 })?.signals.overnightHeartRateRatio).toBeNull();
  });
  it('joins through the backend supplement and refuses a result after account deletion begins', async () => {
    const { range } = await fixture();
    const guard = vi.spyOn(deletionGuard, 'getUserDeletionGuardState').mockResolvedValue({ shouldSkip: false } as never);
    const docs = [{ id: 'night', data: sleep() as unknown as Record<string, unknown> }];
    const enriched = await supplementNightlyHealthSleepDocuments(uid, docs, async () => ({ records: [] }), async () => range);
    expect((enriched[0].data.vitals as { averageHeartRateBpm: number }).averageHeartRateBpm).toBeGreaterThan(50);
    expect(guard).toHaveBeenCalledTimes(2);
    guard.mockResolvedValueOnce({ shouldSkip: false } as never).mockResolvedValueOnce({ shouldSkip: true } as never);
    await expect(supplementNightlyHealthSleepDocuments(uid, docs, async () => ({ records: [] }), async () => range)).rejects.toThrow('owner');
  });
  it('stops at the cumulative chunk budget', async () => {
    const { range } = await fixture();
    range.sampleChunks = Array.from({ length: 513 }, () => ({ ...range.sampleChunks[0], offsetMs: [0], canonicalValues: [60] }));
    await expect(enrichSleepWithNightlyHeartRate(uid, [sleep()], [range])).rejects.toThrow('bounded');
  });
  it.each(['nap', 'provider', 'owner', 'account', 'identity'])('does not supplement an ineligible %s', async reason => {
    const { range } = await fixture();
    const s = sleep();
    if (reason === 'nap') s.isNap = true;
    if (reason === 'provider') s.source.provider = 'SuuntoApp';
    if (reason === 'owner') s.userID = 'another-owner';
    if (reason === 'account') s.source.providerUserId = 'another-account';
    if (reason === 'identity') s.source.providerUserId = '';
    expect((await enrichSleepWithNightlyHeartRate(uid, [s], [range]))[0]).toEqual(s);
  });
  it.each(['samples', 'sources', 'revision'])('withholds incomplete %s evidence', async reason => {
    const { range } = await fixture();
    if (reason === 'samples') range.pageInfo.sampleAggregateComplete = false;
    if (reason === 'sources') range.pageInfo.sourceRecordAggregateComplete = false;
    if (reason === 'revision') range.pageInfo.sampleRevisionMismatchCount = 1;
    expect((await enrichSleepWithNightlyHeartRate(uid, [sleep()], [range]))[0].vitals).toBeUndefined();
  });
  it.each(['foreign_owner', 'wrong_semantic', 'wrong_unit', 'wrong_method', 'conflicting'])('rejects %s samples', async reason => {
    const { range } = await fixture();
    if (reason === 'conflicting') range.sampleChunks.push({ ...range.sampleChunks[0],
      canonicalValues: range.sampleChunks[0].canonicalValues!.map(() => 90) });
    else range.sampleChunks.forEach(c => {
      if (reason === 'foreign_owner') c.userID = 'another-owner';
      if (reason === 'wrong_semantic') c.semanticVariant = 'health_snapshot';
      if (reason === 'wrong_unit') c.canonicalUnit = 'ms';
      if (reason === 'wrong_method') c.recordingMethod = 'manual';
    });
    expect((await enrichSleepWithNightlyHeartRate(uid, [sleep()], [range]))[0].vitals).toBeUndefined();
  });
  it.each(['gap', 'coverage', 'invalid'])('withholds %s rather than inventing a complete night', async reason => {
    const { range } = await fixture();
    range.sampleChunks.forEach(c => c.canonicalValues = c.canonicalValues!.map((v, i) => {
      const t = c.startTimeMs + c.offsetMs[i];
      return reason === 'invalid' ? 0 : reason === 'gap' && t >= start + 3600000 && t < start + 3960000 ? null
        : reason === 'coverage' && i % 5 === 0 ? null : v;
    }));
    expect((await enrichSleepWithNightlyHeartRate(uid, [sleep()], [range]))[0].vitals).toBeUndefined();
  });
  it('accepts exactly 90 percent coverage without filling its gaps', async () => {
    const { range } = await fixture();
    let index = 0;
    range.sampleChunks.forEach(c => c.canonicalValues = c.canonicalValues!.map(v => index++ % 10 === 0 ? null : v));
    const [result] = await enrichSleepWithNightlyHeartRate(uid, [sleep()], [range]);
    expect(result.vitals).toMatchObject({ averageHeartRateBpm: 60, minimumHeartRateBpm: 60 });
  });
  it('deduplicates identical readings and excludes values outside sleep', async () => {
    const { range } = await fixture();
    range.sampleChunks.push(...range.sampleChunks.map(c => ({ ...c })));
    const s = { ...sleep(), startTimeMs: start + 3600000 };
    const [result] = await enrichSleepWithNightlyHeartRate(uid, [s], [range]);
    expect(result.vitals).toMatchObject({ averageHeartRateBpm: 60, minimumHeartRateBpm: 60 });
  });
  it('selects each night independently from one sorted account history', async () => {
    const { range } = await fixture();
    const previous = { ...range, sampleChunks: range.sampleChunks.map(c => ({ ...c, startTimeMs: c.startTimeMs - 86400000,
      endTimeMs: c.endTimeMs - 86400000, canonicalValues: c.canonicalValues!.map(() => 70) })) };
    const priorSleep = { ...sleep(), id: 'previous', startTimeMs: start - 86400000, endTimeMs: end - 86400000 };
    const result = await enrichSleepWithNightlyHeartRate(uid, [priorSleep, sleep()], [range, previous]);
    expect(result[0].vitals?.averageHeartRateBpm).toBe(70);
    expect(result[1].vitals?.averageHeartRateBpm).toBeCloseTo(60 - 10 / 1920);
  });
  it('plans adjacent dates in bounded nonoverlapping windows and avoids reads for native HR', () => {
    const qs = nightlyHeartRateQueries(uid, [sleep()]);
    expect(qs).toHaveLength(4);
    expect(qs[0]).toMatchObject({ startDate: '2026-10-13', endDate: '2026-10-13', providers: [], metricIds: ['heart_rate'] });
    expect(qs[3].endDate).toBe('2026-10-16');
    expect(nightlyHeartRateQueries(uid, [{ ...sleep(), vitals: { averageHeartRateBpm: 60, minimumHeartRateBpm: 50 } }])).toEqual([]);
    expect(nightlyHeartRateQueries(uid, [sleep(), { ...sleep(), startTimeMs: start - 100 * 86400000, endTimeMs: end - 100 * 86400000 }])).toEqual([]);
  });
  it('ignores invalid and far-future sessions when planning current evidence', () => {
    const now = end + 3600000;
    const future = { ...sleep(), startTimeMs: start + 365 * 86400000, endTimeMs: end + 365 * 86400000 };
    expect(nightlyHeartRateQueries(uid, [sleep(), future, { ...sleep(), sleepDate: 'invalid' }], now))
      .toEqual(nightlyHeartRateQueries(uid, [sleep()], now));
  });
  it('uses the injected existing Health reader and propagates optional read failures', async () => {
    const { range } = await fixture();
    const read = vi.fn().mockResolvedValue(range);
    expect((await loadNightlyHeartRate(uid, [sleep()], read))[0].vitals?.minimumHeartRateBpm).toBe(50);
    expect(read).toHaveBeenCalledTimes(4);
    await expect(loadNightlyHeartRate(uid, [sleep()], vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('offline');
  });
});
