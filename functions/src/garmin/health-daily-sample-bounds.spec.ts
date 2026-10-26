import { describe, expect, it, vi } from 'vitest';
import { HEALTH_METRIC_IDS } from '../../../shared/health';
import { validateHealthSourceRecordInput } from '../health/validation';
import { GarminHealthValidationError, mapGarminHealthSummaries } from './health';

const START_SECONDS = 1_760_000_000;
const REVISION_ORDER = 1_760_100_000_000;
const RECEIVED_AT_MS = REVISION_ORDER + 1_000;

function daily(overrides: Record<string, unknown> = {}) {
  return {
    summaryId: 'synthetic-daily',
    calendarDate: '2025-10-09',
    startTimeInSeconds: START_SECONDS,
    startTimeOffsetInSeconds: 3_600,
    durationInSeconds: 60,
    steps: 123,
    restingHeartRateInBeatsPerMinute: 60,
    ...overrides,
  };
}

function map(payload: unknown[], diagnostic = vi.fn()) {
  const results = mapGarminHealthSummaries(
    'dailies', payload, 'synthetic-account', REVISION_ORDER, RECEIVED_AT_MS, diagnostic,
  );
  for (const result of results) validateHealthSourceRecordInput(result.input);
  return results;
}

describe('Garmin Daily heart-rate sample interval normalization', () => {
  it.each([12, 600, 3_600, 999_999_939])('preserves valid samples and metrics with a %s-second overrun', overrun => {
    const summary = daily({ timeOffsetHeartRateSamples: { 0: 60, 15: 61, 60: 62, [60 + overrun]: 75 } });
    const original = structuredClone(summary);
    const diagnostic = vi.fn();
    const [result] = map([summary], diagnostic);

    expect(result.input.startTimeMs).toBe(START_SECONDS * 1_000);
    expect(result.input.endTimeMs).toBe((START_SECONDS + 60) * 1_000);
    expect(result.input.timezoneOffsetSeconds).toBe(3_600);
    expect(result.input.metrics.map(metric => metric.metricId)).toEqual([
      HEALTH_METRIC_IDS.Steps, HEALTH_METRIC_IDS.RestingHeartRate,
    ]);
    expect(result.input.sampleSeries[0]).toMatchObject({
      offsetMs: [0, 15_000, 60_000], nativeValues: [60, 61, 62], canonicalValues: [60, 61, 62],
      coverage: { status: 'partial', sampleCount: 3, observedDurationSeconds: 60 },
    });
    expect(result.input.coverage).toMatchObject({ status: 'partial', sampleCount: 3, observedDurationSeconds: 60 });
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith({
      summaryType: 'dailies', field: 'timeOffsetHeartRateSamples', reason: 'samples_outside_summary_interval',
      affectedSummaryCount: 1, discardedSampleCount: 1,
    });
    expect(summary).toEqual(original);
  });

  it.each([0, 60, 86_400])('retains scalar metrics when every sample exceeds duration %s', duration => {
    const diagnostic = vi.fn();
    const [result] = map([daily({
      durationInSeconds: duration,
      timeOffsetHeartRateSamples: { [duration + 1]: 70, [duration + 15]: 71 },
    })], diagnostic);

    expect(result.input.metrics).toHaveLength(2);
    expect(result.input.sampleSeries).toEqual([]);
    expect(result.input.coverage?.sampleCount).toBe(0);
    expect(result.input.endTimeMs).toBe((START_SECONDS + duration) * 1_000);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discardedSampleCount: 2 }));
  });

  it('keeps the inclusive zero-duration endpoint', () => {
    const [result] = map([daily({ durationInSeconds: 0, timeOffsetHeartRateSamples: { 0: 60, 1: 70 } })]);
    expect(result.input.sampleSeries[0].offsetMs).toEqual([0]);
    expect(result.input.startTimeMs).toBe(result.input.endTimeMs);
  });

  it('reports discarded-only summaries even when there is no record to write', () => {
    const diagnostic = vi.fn();
    expect(map([daily({ steps: undefined, restingHeartRateInBeatsPerMinute: undefined,
      timeOffsetHeartRateSamples: { 61: 70 } })], diagnostic)).toEqual([]);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discardedSampleCount: 1 }));
  });

  it.each([undefined, null, {}, { 0: 60, 60: 70 }])('does not warn for missing or valid samples: %j', samples => {
    const diagnostic = vi.fn();
    expect(map([daily({ timeOffsetHeartRateSamples: samples })], diagnostic)).toHaveLength(1);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it.each([
    { '-1': 70 }, { '1.5': 70 }, { '01': 70 }, { '1000000000': 70 },
    { 61: 0 }, { 61: 301 }, { 61: NaN }, { 61: Infinity }, { 61: '70' }, { 61: null },
  ])('still rejects malformed samples before interval filtering: %j', samples => {
    const diagnostic = vi.fn();
    expect(() => map([daily({ timeOffsetHeartRateSamples: samples })], diagnostic)).toThrow(GarminHealthValidationError);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it('keeps normalization diagnostics out of content identity and stored records', () => {
    const baseline = daily({ timeOffsetHeartRateSamples: { 15: 70, 60: 72 } });
    const [expected] = map([baseline]);
    const [filtered] = map([daily({ timeOffsetHeartRateSamples: { 15: 70, 60: 72, 61: 80 } })]);
    const [differentDiscardedValue] = map([daily({ timeOffsetHeartRateSamples: { 15: 70, 60: 72, 90: 90 } })]);
    expect(filtered).toEqual(expected);
    expect(differentDiscardedValue).toEqual(expected);
    expect(map([daily({ timeOffsetHeartRateSamples: { 15: 71, 60: 72 } })])[0].input.revision.token)
      .not.toBe(expected.input.revision.token);
  });

  it('retains last-response revision ordering and counts diagnostics once per callback', () => {
    const diagnostic = vi.fn();
    const results = map([
      daily({ timeOffsetHeartRateSamples: { 15: 70, 61: 80 } }),
      daily({ steps: 456, timeOffsetHeartRateSamples: { 15: 72, 61: 80, 62: 81 } }),
    ], diagnostic);
    expect(results).toHaveLength(1);
    expect(results[0].input.sampleSeries[0].canonicalValues).toEqual([72]);
    expect(results[0].input.metrics[0]).toMatchObject({ canonical: { value: 456 } });
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      affectedSummaryCount: 2, discardedSampleCount: 3,
    }));
  });

  it('does not turn successful mapping into a retry when diagnostic logging fails', () => {
    const diagnostic = vi.fn(() => { throw new Error('synthetic diagnostic outage'); });
    expect(map([daily({ timeOffsetHeartRateSamples: { 15: 70, 61: 80 } })], diagnostic)).toHaveLength(1);
    expect(diagnostic).toHaveBeenCalledOnce();
  });

  it('stress-tests 512 deterministic mixed windows against the shared writer contract', () => {
    let seed = 0x51a7;
    const random = () => (seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0);
    for (let index = 0; index < 512; index++) {
      const duration = random() % 86_401;
      const samples: Record<string, number> = { 0: 60, [duration]: 61, [duration + 1]: 62 };
      for (let point = 0; point < 64; point++) samples[random() % 172_801] = (random() % 300) + 1;
      const diagnostic = vi.fn();
      const [result] = map([daily({ durationInSeconds: duration, timeOffsetHeartRateSamples: samples })], diagnostic);
      const expectedOffsets = Object.keys(samples).map(Number).filter(offset => offset <= duration).sort((a, b) => a - b);
      expect(result.input.sampleSeries[0].offsetMs).toEqual(expectedOffsets.map(offset => offset * 1_000));
      expect(result.input.sampleSeries[0].canonicalValues).toEqual(expectedOffsets.map(offset => samples[offset]));
      expect(result.input.coverage?.sampleCount).toBe(expectedOffsets.length);
      expect(result.input.endTimeMs).toBe((START_SECONDS + duration) * 1_000);
      expect(result.input.metrics).toHaveLength(2);
      expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        discardedSampleCount: Object.keys(samples).length - expectedOffsets.length,
      }));
    }
  });

  it('handles the 20,000-sample cap without relaxing the raw input bound', () => {
    const samples = Object.fromEntries(Array.from({ length: 20_000 }, (_, index) => [index * 15, 70]));
    const diagnostic = vi.fn();
    const [result] = map([daily({ timeOffsetHeartRateSamples: samples })], diagnostic);
    expect(result.input.sampleSeries[0].offsetMs).toEqual([0, 15_000, 30_000, 45_000, 60_000]);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ discardedSampleCount: 19_995 }));
    expect(() => map([daily({ timeOffsetHeartRateSamples: { ...samples, 300_000: 70 } })]))
      .toThrow('exceeds the bounded sample count');
  });

  it('handles 10,000 mixed summaries with one bounded diagnostic and no lost records', () => {
    const summaries = Array.from({ length: 10_000 }, (_, index) => daily({
      summaryId: `synthetic-daily-${index}`, startTimeInSeconds: START_SECONDS + index,
      timeOffsetHeartRateSamples: index % 2 ? { 15: 70 } : { 15: 70, 61: 80 },
    }));
    const diagnostic = vi.fn();
    const results = map(summaries, diagnostic);
    expect(results).toHaveLength(10_000);
    expect(new Set(results.map(result => result.input.sourceRecordKey)).size).toBe(10_000);
    expect(results.every(result => result.input.sampleSeries[0].offsetMs.length === 1)).toBe(true);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      affectedSummaryCount: 5_000, discardedSampleCount: 5_000,
    }));
  });
});
