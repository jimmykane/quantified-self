import { describe, expect, it } from 'vitest';
import type { HealthSourceRecord } from '@shared/health';
import { projectLoadedHealthRange } from '@shared/health-query';
import { selectLatestHealthReading } from './health-latest-reading.helper';

function reading(accountKey: string, date: string, value: number, metricId: 'body_weight' | 'steps' = 'body_weight') {
  const time = Date.parse(date), unit = metricId === 'body_weight' ? 'kg' : 'count';
  const record: HealthSourceRecord = { schemaVersion: 1, id: accountKey + date, userID: 'owner', kind: metricId === 'steps' ? 'daily_summary' : 'point_measurement',
    calendarDate: date, startTimeMs: time, endTimeMs: time, source: { provider: 'GarminAPI', accountKey, sourceRecordType: 'measurement',
      sourceRecordKey: accountKey + date, revision: { order: 1, token: '1', digest: '1' }, receivedAtMs: time },
    metricIds: [metricId], metrics: [{ kind: 'value', metricId, valueType: 'number', aggregation: metricId === 'steps' ? 'total' : 'measurement',
      semanticVariant: 'recorded', origin: 'recorded', recordingMethod: 'device', quality: { status: 'valid' }, normalizationStatus: 'canonical',
      native: { metric: metricId, value, unit }, canonical: { value, unit } }], coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: time, updatedAtMs: time };
  return projectLoadedHealthRange([record], [], { startDate: date, endDate: date, metricIds: [metricId], includeSamples: false }, { sourceRecordsComplete: true, samplesComplete: true });
}
describe('latest Health reading', () => {
  it('selects one latest measurement across date windows, while retaining a pinned older source', () => {
    const old = reading('older-scale', '2024-01-01', 68), recent = reading('new-scale', '2026-11-09', 71);
    const pin = selectLatestHealthReading([old])!.series.id;
    expect(selectLatestHealthReading([recent, old])?.point.value).toBe(71);
    expect(selectLatestHealthReading([recent, old], pin)?.point.value).toBe(68);
    expect(selectLatestHealthReading([recent], pin)).toBeNull();
  });
  it('takes the latest cumulative step reading instead of adding providers or successive totals', () => {
    const ranges = [reading('watch', '2026-11-08', 1000, 'steps'), reading('watch', '2026-11-09', 2000, 'steps'), reading('other', '2026-11-08', 5000, 'steps')];
    expect(selectLatestHealthReading(ranges)?.point.value).toBe(2000);
  });
});
