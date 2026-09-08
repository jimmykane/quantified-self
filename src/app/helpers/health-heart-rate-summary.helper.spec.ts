import { describe, expect, it } from 'vitest';
import { HealthSampleChunk, HealthSourceRecord } from '@shared/health';
import { heartRateSemanticLabel, withDailyHeartRateSummaries } from './health-heart-rate-summary.helper';

function fixture(values: unknown[] = [60, 80, 100]) {
  const start = Date.UTC(2026, 8, 8);
  const record: HealthSourceRecord = {
    schemaVersion: 1, id: 'parent', userID: 'owner', kind: 'daily_summary',
    source: { provider: 'SuuntoApp', accountKey: 'account', sourceRecordType: 'suunto_247_activity',
      sourceRecordKey: 'opaque', revision: { order: 1, token: 'one', digest: 'digest' }, receivedAtMs: start + 86_400_000 },
    calendarDate: '2026-09-08', startTimeMs: start, endTimeMs: start + 86_399_999,
    metrics: [], metricIds: ['heart_rate'], sampleChunkIds: ['chunk'],
    coverage: { status: 'unknown' }, createdAtMs: start, updatedAtMs: start,
  };
  const chunk: HealthSampleChunk = {
    schemaVersion: 1, id: 'chunk', userID: 'owner', parentSourceRecordId: record.id,
    provider: 'SuuntoApp', accountKey: 'account', metricId: 'heart_rate', valueType: 'number',
    aggregation: 'average', semanticVariant: 'activity_interval_average', origin: 'recorded',
    recordingMethod: 'device', normalizationStatus: 'canonical', nativeMetric: 'HR', nativeUnit: 'bpm',
    canonicalUnit: 'bpm', calendarDate: record.calendarDate, startTimeMs: start, endTimeMs: start + (values.length - 1) * 60_000,
    receivedAtMs: start + 86_400_000, seriesKey: 'average', chunkIndex: 0,
    offsetMs: values.map((_, i) => i * 60_000), nativeValues: values as number[], canonicalValues: values as number[],
    coverage: { status: 'unknown' }, revision: record.source.revision, createdAtMs: start, updatedAtMs: start,
  };
  return { record, chunk };
}

describe('daily Heart rate summaries', () => {
  it('projects mean/lowest/highest interval averages without changing stored data or claiming full-day extremes', () => {
    const { record, chunk } = fixture();
    const [result] = withDailyHeartRateSummaries([record], [chunk]);
    expect(result.metrics.map(entry => entry.kind === 'value' && entry.canonical?.value)).toEqual([80, 60, 100]);
    expect(result.metrics.map(entry => entry.semanticVariant)).toEqual([
      'qs_daily_interval_mean', 'qs_daily_interval_low', 'qs_daily_interval_high',
    ]);
    expect(result.metrics.every(entry => entry.origin === 'quantified_self_derived'
      && entry.coverage?.status === 'unknown' && entry.coverage.sampleCount === 3)).toBe(true);
    expect(record.metrics).toEqual([]);
  });

  it('combines pages by sample count, not by averaging chunk averages', () => {
    const { record, chunk } = fixture([60, 90]);
    const second = { ...chunk, id: 'second', chunkIndex: 1, startTimeMs: chunk.endTimeMs + 60_000,
      endTimeMs: chunk.endTimeMs + 60_000, offsetMs: [0], canonicalValues: [120], nativeValues: [120] };
    record.sampleChunkIds.push('second');
    const [result] = withDailyHeartRateSummaries([record], [second, chunk]);
    expect(result.metrics[0]).toMatchObject({ canonical: { value: 90 }, coverage: { sampleCount: 3 } });
  });

  it('never blends accounts, source records or native-only series', () => {
    const { record, chunk } = fixture();
    const other = { ...record, id: 'other', source: { ...record.source, accountKey: 'other' }, sampleChunkIds: ['other-chunk'] };
    const otherChunk = { ...chunk, id: 'other-chunk', parentSourceRecordId: other.id, accountKey: 'other',
      canonicalValues: [120, 120, 120] };
    const results = withDailyHeartRateSummaries([record, other], [chunk, otherChunk]);
    expect(results.map(r => r.metrics[0])).toMatchObject([{ canonical: { value: 80 } }, { canonical: { value: 120 } }]);
    expect(withDailyHeartRateSummaries([record], [{ ...chunk, normalizationStatus: 'native_only' }])[0].metrics).toEqual([]);
  });

  it.each(['order', 'token', 'digest'] as const)('rejects stale %s revisions and mixed revisions', field => {
    const { record, chunk } = fixture();
    const stale = { ...chunk, id: 'stale', revision: { ...chunk.revision, [field]: field === 'order' ? 0 : 'old' } };
    record.sampleChunkIds.push('stale');
    expect(withDailyHeartRateSummaries([record], [chunk, stale])[0].metrics).toEqual([]);
  });

  it('omits an incomplete boundary day while retaining earlier completed days', () => {
    const { record, chunk } = fixture();
    expect(withDailyHeartRateSummaries([record], [chunk], '2026-09-08')[0].metrics).toEqual([]);
    expect(withDailyHeartRateSummaries([record], [chunk], '2026-09-09')[0].metrics).toHaveLength(3);
  });

  it('does not fabricate zero values and excludes invalid samples', () => {
    const { record, chunk } = fixture([null, undefined, 0, NaN, '80', 80, 100]);
    chunk.qualityCodes = ['valid', 'valid', 'valid', 'valid', 'valid', 'invalid', 'estimated'];
    expect(withDailyHeartRateSummaries([record], [chunk])[0].metrics[0]).toMatchObject({
      canonical: { value: 100 }, coverage: { sampleCount: 1 }, quality: { status: 'estimated' },
    });
  });

  it('requires contiguous chunks and rejects conflicting duplicate timestamps', () => {
    const { record, chunk } = fixture();
    expect(withDailyHeartRateSummaries([record], [{ ...chunk, chunkIndex: 1 }])[0].metrics).toEqual([]);
    record.sampleChunkIds.push('second');
    expect(withDailyHeartRateSummaries([record], [chunk, { ...chunk, id: 'second', chunkIndex: 1,
      canonicalValues: [90, 80, 100] }])[0].metrics).toEqual([]);
  });

  it('keeps Garmin provider summaries and adds a daily mean instead of duplicating its extrema', () => {
    const { record, chunk } = fixture();
    const [daily] = withDailyHeartRateSummaries([record], [chunk]);
    record.metrics = daily.metrics.slice(1).map((entry, i) => ({ ...entry, origin: 'provider_summary',
      semanticVariant: i === 0 ? 'daily_minimum' : 'daily_maximum' }));
    const [result] = withDailyHeartRateSummaries([record], [{ ...chunk,
      semanticVariant: 'daily_15_second', aggregation: 'representative_sample' }]);
    expect(result.metrics.map(m => m.semanticVariant)).toEqual(['daily_minimum', 'daily_maximum', 'qs_daily_sample_mean']);
    expect(result.metrics.slice(0, 2)).toEqual(record.metrics);
  });

  it('only summarizes explicitly supported all-day HR semantics, not snapshots or HRV', () => {
    const { record, chunk } = fixture();
    expect(withDailyHeartRateSummaries([record], [{ ...chunk, semanticVariant: 'health_snapshot_heart_rate' }])[0].metrics).toEqual([]);
    expect(withDailyHeartRateSummaries([record], [{ ...chunk, metricId: 'heart_rate_variability' }])[0].metrics).toEqual([]);
    expect(heartRateSemanticLabel('rolling_7_day_average')).toContain('7-day average');
    expect(heartRateSemanticLabel('qs_daily_interval_low')).toContain('lowest interval average');
    expect(heartRateSemanticLabel('unknown')).toBeNull();
  });
});
