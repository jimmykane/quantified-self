import { describe, expect, it, vi } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../shared/unit-aware-display';
import {
  getMcpHealthCatalog, queryMcpHealth, McpHealthInput, McpHealthReadDependencies,
  MCP_HEALTH_QUERY_SCHEMA,
} from './health.service';
import { HEALTH_METRIC_CATALOG, HealthMetricEntry } from '../../../shared/health';
import { encodeHealthMetricSportsLibData } from '../../../shared/sports-lib-health-data';

const input: McpHealthInput = { uid: 'owner', metricId: 'heart_rate', startDate: '2026-09-01',
  endDate: '2026-09-02', mode: 'summaries', maxPoints: 200, measurementsAllowed: false };
const revision = { order: 10, token: 'private-token', digest: 'private-digest' };
function entry(overrides = {}): HealthMetricEntry {
  return { kind: 'value', metricId: 'heart_rate', valueType: 'number',
    aggregation: 'average', semanticVariant: 'daily_average', origin: 'provider_summary',
    recordingMethod: 'provider_calculated', quality: { status: 'valid' },
    normalizationStatus: 'canonical', canonical: { value: 60, unit: 'bpm' },
    native: { metric: 'private-native-name', value: 60, qualifiers: { secret: 'private-qualifier' } }, ...overrides } as HealthMetricEntry;
}
function record(id = 'record-1', overrides: Record<string, unknown> = {}) {
  return { id, data: { userID: 'owner', schemaVersion: 1, calendarDate: '2026-09-01',
    kind: 'daily_summary', source: { provider: 'SuuntoApp', accountKey: 'private-account',
      revision, sourceRecordKey: 'private-source', receivedAtMs: 123 },
    metrics: [entry()], sampleChunkIds: ['chunk-1'], coverage: { status: 'complete' },
    device: { displayName: 'private-device' }, ...overrides }, cursor: id };
}
function chunk(id = 'chunk-1', overrides: Record<string, unknown> = {}) {
  return { id, data: { userID: 'owner', schemaVersion: 1, calendarDate: '2026-09-01',
    parentSourceRecordId: 'record-1', provider: 'SuuntoApp', accountKey: 'private-account',
    metricId: 'heart_rate', aggregation: 'sample', semanticVariant: 'activity_interval',
    origin: 'recorded', recordingMethod: 'device', normalizationStatus: 'canonical',
    canonicalUnit: 'bpm', startTimeMs: Date.parse('2026-09-01T00:00:00Z'),
    endTimeMs: Date.parse('2026-09-02T00:00:00Z'), offsetMs: [0, 60_000, 120_000],
    canonicalValues: [60, 70, 80], revision, coverage: { status: 'partial' }, ...overrides }, cursor: id };
}
type Doc = ReturnType<typeof record> | ReturnType<typeof chunk>;
function reads(records: Doc[] = [record()], chunks: Doc[] = []): McpHealthReadDependencies {
  return {
    fetchUnitSettings: vi.fn().mockResolvedValue(null),
    fetchPage: vi.fn(async (_input, collection, limit, cursor) => {
      const docs = collection === 'healthSourceRecords' ? records : chunks;
      const start = cursor ? docs.findIndex(doc => doc.cursor === cursor) + 1 : 0;
      return docs.slice(start, start + limit);
    }),
  };
}

describe('read-only MCP Health projection', () => {
  it('discovers the complete remaining catalog without replacing Weight or Sleep contracts', () => {
    const catalog = getMcpHealthCatalog();
    expect(catalog.metrics).toHaveLength(Object.keys(HEALTH_METRIC_CATALOG).length - 3);
    expect(catalog.metrics.map(metric => metric.id)).not.toContain('body_weight');
    expect(catalog.metrics.find(metric => metric.id === 'body_fat')?.requiredScopes)
      .toEqual(['health:read', 'measurements:read']);
    expect(catalog.weightTool).toBe('query_measurements');
    expect(catalog.sleepTool).toBe('get_sleep_trend');
  });
  it.each(getMcpHealthCatalog().metrics)('rehydrates and formats the supported metric $id', async metric => {
    const value = metric.valueType === 'category' ? 'relaxing' : 20;
    const body = metric.requiredScopes.includes('measurements:read');
    const result = await queryMcpHealth({ ...input, metricId: metric.id, measurementsAllowed: true }, reads([
      record('record-1', { kind: body ? 'point_measurement' : 'daily_summary', metrics: [entry({
        metricId: metric.id, valueType: metric.valueType, aggregation: body ? 'measurement' : 'average',
        semanticVariant: body ? 'point' : 'daily_average', canonical: { value, unit: metric.canonicalUnit },
      })] }),
    ]));
    expect(result.excludedValues).toBe(0);
    const reading = body ? result.measurementDays[0].readings[0] : result.series[0].points[0];
    expect(reading.value).toBe(value);
    expect(reading.display.value).not.toBe('—');
  });
  it('reads metric-first owner-scoped pages and computes coverage across page boundaries', async () => {
    const source = reads(Array.from({ length: 35 }, (_, i) => record(`r-${i}`, {
      calendarDate: i < 32 ? '2026-09-01' : '2026-09-02',
      coverage: { status: i === 34 ? 'partial' : 'complete' },
    })));
    const result = await queryMcpHealth(input, source);
    expect(source.fetchPage).toHaveBeenCalledTimes(2);
    expect(source.fetchPage).toHaveBeenNthCalledWith(1, input, 'healthSourceRecords', 32, undefined);
    expect(result.series[0]).toMatchObject({ readingCount: 35, recordedDays: 2, partialDays: 1 });
    expect(result.complete).toBe(true);
  });
  it('preserves each provider/account/semantic series and strips private neighboring fields', async () => {
    const result = await queryMcpHealth(input, reads([
      record(), record('r2', { source: { provider: 'GarminAPI', accountKey: 'private-account', revision } }),
      record('r3', { source: { provider: 'SuuntoApp', accountKey: 'private-second', revision } }),
      record('r4', { metrics: [entry({ semanticVariant: 'private-unknown-semantic' })] }),
    ]));
    expect(result.series.map(series => [series.provider, series.accountNumber, series.semanticVariant])).toEqual([
      ['SuuntoApp', 1, 'daily_average'], ['GarminAPI', 1, 'daily_average'],
      ['SuuntoApp', 2, 'daily_average'], ['SuuntoApp', 1, 'other'],
    ]);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(result.series[0].points[0]).toMatchObject({ value: 60, timeMs: null, display: { unit: 'bpm' } });
  });
  it.each([null, undefined, NaN, Infinity, '60', false])('does not coerce missing or invalid values: %s', async value => {
    const result = await queryMcpHealth(input, reads([record('r', {
      metrics: [entry({ canonical: { value, unit: 'bpm' } })],
    })]));
    expect(result.series).toEqual([]);
    expect(result.excludedValues).toBe(1);
  });
  it('validates Sports Lib envelope consistency and skips native-only values and Sleep references', async () => {
    const encoded = encodeHealthMetricSportsLibData(entry());
    const result = await queryMcpHealth(input, reads([record('r', { metrics: [
      { ...encoded, canonical: { value: 50, unit: 'bpm' } },
      entry({ normalizationStatus: 'native_only' }),
      { ...entry(), kind: 'sleep_reference', reference: { documentId: 'private-sleep-id' } },
    ] })]));
    expect(result.series).toEqual([]);
    expect(result.excludedValues).toBe(2);
    expect(result.sleepReferencesExcluded).toBe(1);
  });
  it('rejects unauthorized body composition before any reads', async () => {
    const source = reads();
    await expect(queryMcpHealth({ ...input, metricId: 'body_fat' }, source)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(source.fetchPage).not.toHaveBeenCalled();
    expect(source.fetchUnitSettings).not.toHaveBeenCalled();
  });
  it('returns only date-bucketed recorded body composition without any provenance or exact times', async () => {
    const fat = entry({ metricId: 'body_fat', aggregation: 'measurement', semanticVariant: 'point',
      canonical: { value: 20, unit: 'percent' } });
    const result = await queryMcpHealth({ ...input, metricId: 'body_fat', measurementsAllowed: true }, reads([
      record('r1', { kind: 'point_measurement', metrics: [fat] }),
      record('r2', { kind: 'profile_snapshot', metrics: [fat] }),
    ]));
    expect(result.series).toEqual([]);
    expect(result.measurementDays).toEqual([{ date: '2026-09-01', readings: [{ value: 20, display: { value: '20', unit: '%' } }] }]);
    expect(JSON.stringify(result.measurementDays)).not.toMatch(/private|provider|account|timeMs|source|device/);
    expect(result.excludedValues).toBe(1);
  });
  it('returns bounded complete-domain sample trends with revision checks, not raw chunks', async () => {
    const result = await queryMcpHealth({ ...input, mode: 'samples', maxPoints: 2 }, reads([record()], [chunk()]));
    expect(result.series[0]).toMatchObject({ readingCount: 3, returnedPointCount: 2, downsampled: true, partialDays: 1 });
    expect(result.series[0].points.map(point => point.value)).toEqual([60, 80]);
    expect(JSON.stringify(result)).not.toContain('private-');
  });
  it.each([
    [DistanceUnits.Kilometers, '10.00', 'Km'], [DistanceUnits.Miles, '6.22', 'mi'],
  ])('pairs Sports Lib values and units with the user preference: %s', async (distanceUnits, value, unit) => {
    const source = reads([record('r', { metrics: [entry({ metricId: 'distance', canonical: { value: 10_000, unit: 'm' } })] })]);
    source.fetchUnitSettings = vi.fn().mockResolvedValue(normalizeUserUnitSettings({ distanceUnits }));
    const result = await queryMcpHealth({ ...input, metricId: 'distance' }, source);
    expect(result.metric.canonicalUnit).toBe('m');
    expect(result.series[0].points[0]).toMatchObject({ value: 10_000, display: { value, unit } });
  });
  it('never reads outside the bearer owner or accepts mismatched embedded owners', async () => {
    const source = reads([record('r', { userID: 'other-user' })]);
    const result = await queryMcpHealth(input, source);
    expect(source.fetchPage).toHaveBeenCalledWith(input, 'healthSourceRecords', 32, undefined);
    expect(result.series).toEqual([]);
    expect(result.excludedValues).toBe(1);
  });
  it('bounds account keys before grouping repeated sample points', async () => {
    const result = await queryMcpHealth(input, reads([record('r', {
      source: { provider: 'SuuntoApp', accountKey: 'x'.repeat(129), revision },
    })]));
    expect(result.series).toEqual([]);
    expect(result.excludedValues).toBe(1);
  });
  it('caps chunks independently and retains a clear partial-scan indicator', async () => {
    const chunks = Array.from({ length: 257 }, (_, i) => chunk(`chunk-${i}`));
    const result = await queryMcpHealth({ ...input, mode: 'samples' }, reads([
      record('record-1', { sampleChunkIds: chunks.map(item => item.id) }),
    ], chunks));
    expect(result).toMatchObject({ complete: false, chunksRead: 256, limitsReached: ['chunks'] });
  });
  it('caps cumulative sample points before processing another chunk', async () => {
    const chunks = Array.from({ length: 70 }, (_, i) => chunk(`chunk-${i}`, {
      offsetMs: Array.from({ length: 1_440 }, (_, i) => i * 60_000),
      canonicalValues: Array(1_440).fill(60),
    }));
    const result = await queryMcpHealth({ ...input, mode: 'samples' }, reads([
      record('record-1', { sampleChunkIds: chunks.map(item => item.id) }),
    ], chunks));
    expect(result).toMatchObject({ complete: false, limitsReached: ['samplePoints'], samplesRead: 99_360 });
  });
  it.each([
    { revision: { ...revision, order: 9 } }, { revision: { ...revision, token: 'other' } },
    { revision: { ...revision, digest: 'other' } }, { accountKey: 'other' },
    { provider: 'GarminAPI' }, { parentSourceRecordId: 'missing' },
  ])('does not expose stale or mismatched samples: %j', async override => {
    const result = await queryMcpHealth({ ...input, mode: 'samples' }, reads([record()], [chunk('chunk-1', override)]));
    expect(result.series).toEqual([]);
    expect(result.revisionMismatches).toBe(1);
  });
  it('does not expose retired chunk IDs after a parent revision changes', async () => {
    const result = await queryMcpHealth({ ...input, mode: 'samples' }, reads([record('record-1', { sampleChunkIds: [] })], [chunk()]));
    expect(result.revisionMismatches).toBe(1);
  });
  it('keeps canonical categorical states, never arbitrary strings or native quality codes', async () => {
    const result = await queryMcpHealth({ ...input, metricId: 'stress_state', mode: 'samples' }, reads([record()], [
      chunk('chunk-1', { metricId: 'stress_state', canonicalUnit: 'category', canonicalValues: ['relaxing', 'private-canary', 'stressful'] }),
    ]));
    expect(result.series[0].points.map(point => point.value)).toEqual(['relaxing', 'stressful']);
    expect(result.excludedValues).toBe(1);
  });
  it('isolates the explicitly allowed native Garmin Body Battery scale from canonical resources', async () => {
    const source = { provider: 'GarminAPI', accountKey: 'private-account', revision };
    const result = await queryMcpHealth({ ...input, metricId: 'body_energy', mode: 'samples' }, reads([
      record('record-1', { source, sampleChunkIds: ['chunk-1', 'chunk-2'] }),
    ], [
      chunk('chunk-1', { provider: 'GarminAPI', metricId: 'body_energy', semanticVariant: 'garmin_body_battery',
        normalizationStatus: 'native_only', canonicalUnit: null, canonicalValues: null,
        nativeMetric: 'timeOffsetBodyBatteryValues', nativeUnit: 'garmin_body_battery_points', nativeValues: [0, 60, 100] }),
      chunk('chunk-2', { provider: 'GarminAPI', metricId: 'body_energy', semanticVariant: 'garmin_body_battery',
        canonicalUnit: 'percent', canonicalValues: [0, 60, 100] }),
    ]));
    expect(result.series).toHaveLength(2);
    expect(result.series[0]).toMatchObject({ normalizationStatus: 'native_only', unit: 'garmin_body_battery_points' });
    expect(result.series[0].points.map(point => point.value)).toEqual([0, 60, 100]);
    expect(result.series[0].points[0].display).toEqual({ value: '0', unit: 'Garmin Body Battery points' });
    expect(result.series[1]).toMatchObject({ normalizationStatus: 'canonical', unit: 'percent' });
    expect(result.series[1].points[0].display).toEqual({ value: '0', unit: '%' });
    expect(JSON.stringify(result)).not.toContain('private-');
  });
  it('reads a Garmin Body Battery summary with only the approved native value and labelled unit', async () => {
    const result = await queryMcpHealth({ ...input, metricId: 'body_energy' }, reads([record('r', {
      source: { provider: 'GarminAPI', accountKey: 'private-account', revision },
      metrics: [entry({ metricId: 'body_energy', aggregation: 'latest', semanticVariant: 'garmin_body_battery',
        normalizationStatus: 'native_only', canonical: null,
        native: { metric: 'timeOffsetBodyBatteryValues', unit: 'garmin_body_battery_points', value: 67 } })],
    })]));
    expect(result.series[0].points).toEqual([{ date: '2026-09-01', timeMs: null, value: 67,
      display: { value: '67', unit: 'Garmin Body Battery points' } }]);
    expect(result.metric.nativeVariants).toEqual([{ provider: 'GarminAPI', semanticVariant: 'garmin_body_battery',
      unit: 'garmin_body_battery_points' }]);
    expect(JSON.stringify(result)).not.toContain('private-');
  });
  it.each([
    { native: { metric: 'private-metric', unit: 'garmin_body_battery_points', value: 50 } },
    { native: { metric: 'timeOffsetBodyBatteryValues', unit: 'private-unit', value: 50 } },
    { native: { metric: 'timeOffsetBodyBatteryValues', unit: 'garmin_body_battery_points', value: 101 } },
    { native: { metric: 'timeOffsetBodyBatteryValues', unit: 'garmin_body_battery_points', value: null } },
  ])('does not widen native disclosure beyond the approved bounded scalar: %j', async overrides => {
    const result = await queryMcpHealth({ ...input, metricId: 'body_energy' }, reads([record('r', {
      source: { provider: 'GarminAPI', accountKey: 'private-account', revision },
      metrics: [entry({ metricId: 'body_energy', aggregation: 'latest', semanticVariant: 'garmin_body_battery',
        normalizationStatus: 'native_only', canonical: null, ...overrides })],
    })]));
    expect(result.series).toEqual([]);
    expect(result.excludedValues).toBe(1);
  });
  it('reports incomplete source-record scans and does not start sample reads with missing parents', async () => {
    const source = reads(Array.from({ length: 2_049 }, (_, i) => record(`r${i}`)));
    const result = await queryMcpHealth({ ...input, mode: 'samples' }, source);
    expect(result).toMatchObject({ complete: false, limitsReached: ['records'], recordsRead: 2_048 });
    expect(result.chunksRead).toBe(0);
  });
  it('enforces the cumulative serialized byte bound', async () => {
    const result = await queryMcpHealth(input, reads(Array.from({ length: 30 }, (_, i) => record(`r${i}`, { padding: 'x'.repeat(900_000) }))));
    expect(result.complete).toBe(false);
    expect(result.limitsReached).toContain('bytes');
    expect(result.recordsRead).toBeLessThan(30);
  });
  it.each([
    { startDate: '2026-02-30' }, { startDate: '2027-01-01' },
    { startDate: '2020-01-01' }, { mode: 'samples', startDate: '2026-01-01' },
    { maxPoints: 401 }, { maxPoints: 1 }, { metricId: 'body_weight' }, { metricId: 'sleep_score' },
  ])('rejects invalid input before reading: %j', async override => {
    const source = reads();
    await expect(queryMcpHealth({ ...input, ...override } as McpHealthInput, source)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(source.fetchPage).not.toHaveBeenCalled();
  });
  it('rejects extra output keys at every level', async () => {
    const result = await queryMcpHealth(input, reads());
    expect(MCP_HEALTH_QUERY_SCHEMA.safeParse({ ...result, private: 'secret' }).success).toBe(false);
    expect(MCP_HEALTH_QUERY_SCHEMA.safeParse({ ...result, series: [{ ...result.series[0], device: 'private' }] }).success).toBe(false);
    expect(MCP_HEALTH_QUERY_SCHEMA.safeParse({ ...result,
      metric: getMcpHealthCatalog().metrics.find(metric => metric.id === 'body_fat'),
    }).success).toBe(false);
  });
});
