import { describe, expect, it, vi } from 'vitest';
import { HrvRangeInput, HrvRangeReads, queryHrvPersonalRange, MCP_HRV_RANGE_SCHEMA, firestoreHrvRangeReads } from './hrv-personal-range.service';
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { encodeSleepSessionSportsLibData } from '../../../shared/sports-lib-health-data';
import { SleepSession, SLEEP_SPORTS_LIB_METRIC_FIELDS } from '../../../shared/sleep';
import { calculatePersonalMetricRange } from '../../../shared/personal-metric-range';
import { HEALTH_UNITS } from '../../../shared/health';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../shared/unit-aware-display';
const DAY = 86400000;
vi.mock('firebase-admin', () => ({ firestore: vi.fn() }));
const end = Date.parse('2026-09-10T23:59:59.999Z');
const input: HrvRangeInput = { uid: 'owner', scopes: ['health:read', 'sleep:read'], startTimeMs: end - 29 * DAY, endTimeMs: end };
function reads(count = 70): HrvRangeReads {
  const documents = Array.from({ length: count }, (_, i) => {
    const time = end - i * DAY;
    return { cursor: `private-${i}`, data: { endTimeMs: time, sleepDate: new Date(time).toISOString().slice(0, 10),
      source: { provider: 'SuuntoApp', providerUserId: 'private-account', callbackURL: 'private-url' },
      vitals: { averageHrvMs: 40 + i % 5 }, private: 'private-data' } };
  });
  return { fetchUnitSettings: vi.fn().mockResolvedValue(null), activeOwner: vi.fn().mockResolvedValue(true), fetchPage: vi.fn(async (_uid, source, _start, _end, limit, cursor) => {
    if (source === 'health') return [];
    const offset = cursor ? documents.findIndex(doc => doc.cursor === cursor) + 1 : 0;
    return documents.slice(offset, offset + limit);
  }) };
}
describe('MCP shared HRV personal range', () => {
  it('reads the required canonical duration alongside Sports Lib-only HRV through the Firestore mask', async () => {
    const encoded = encodeSleepSessionSportsLibData({ durationSeconds: 28800, vitals: { averageHrvMs: 42, overnightHrvMs: 44 } } as SleepSession);
    const selectedMetrics: Record<string, unknown> = {};
    const query = {
      where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      select: vi.fn((...fields: (string | FieldPath)[]) => {
        for (const field of Object.values(SLEEP_SPORTS_LIB_METRIC_FIELDS)) {
          if (fields.some(path => path instanceof FieldPath && path.isEqual(new FieldPath('sportsLibData', 'metrics', field)))) {
            selectedMetrics[field] = encoded.sportsLibData!.metrics[field];
          }
        }
        return query;
      }),
      get: vi.fn(async () => ({ docs: [{ data: () => ({
        endTimeMs: end, sleepDate: '2026-09-10', source: { provider: 'SuuntoApp', providerUserId: 'private-account' },
        sportsLibData: { schemaVersion: encoded.sportsLibData!.schemaVersion, metrics: selectedMetrics },
      }) }] })),
    };
    vi.mocked(admin.firestore).mockReturnValue({ collection: () => ({ doc: () => ({ collection: () => query }) }) } as never);
    const deps = reads(0);
    deps.fetchPage = async (...args) => args[1] === 'health' ? [] : firestoreHrvRangeReads.fetchPage(...args);
    const result = await queryHrvPersonalRange(input, deps);
    expect(result.excludedValues).toBe(0);
    expect(result.series.map(series => series.readings[0].value)).toEqual([42, 44]);
    expect(selectedMetrics).toHaveProperty(SLEEP_SPORTS_LIB_METRIC_FIELDS.Duration);
    expect(JSON.stringify(result)).not.toMatch(/duration|private-account|sportsLibData/);
  });
  it('keeps HRV in milliseconds with non-default unit preferences', async () => {
    const deps = reads(3);
    vi.mocked(deps.fetchUnitSettings).mockResolvedValue(normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }));
    const result = await queryHrvPersonalRange(input, deps);
    expect(deps.fetchUnitSettings).toHaveBeenCalledWith('owner');
    expect(result.series[0].readings.every(reading => reading.display?.unit === 'ms')).toBe(true);
  });
  it('retains a range across missing nights without manufacturing readings or a recent headline', async () => {
    const deps = reads(0);
    vi.mocked(deps.fetchPage).mockImplementation(async (_uid, source) => source === 'health' ? []
      : Array.from({ length: 20 }, (_, i) => ({ cursor: i + 1, data: {
        source: { provider: 'SuuntoApp', providerUserId: 'secret' }, endTimeMs: end - (i + 8) * DAY,
        sleepDate: new Date(end - (i + 8) * DAY).toISOString().slice(0, 10), vitals: { averageHrvMs: 40 + i % 3 },
      } })));
    const result = await queryHrvPersonalRange(input, deps);
    expect(result.series[0].status).toBe('insufficient_current');
    expect(result.series[0].currentAverage).toBeNull();
    expect(result.series[0].readings).toHaveLength(20);
    expect(result.series[0].rangePoints[result.series[0].rangePoints.length - 1].normalRange).not.toBeNull();
  });
  it('keeps Health accounts and Sleep separate and excludes spot HRV and nulls', async () => {
    const deps = reads(0);
    vi.mocked(deps.fetchPage).mockImplementation(async (_uid, source) => source === 'sleep' ? [
      { cursor: 's', data: { endTimeMs: end, sleepDate: '2026-09-10', source: { provider: 'SuuntoApp', providerUserId: 'secret' },
        vitals: { averageHrvMs: null, overnightHrvMs: 45 } } },
    ] : ['first-account', 'second-account'].map((accountKey, i) => ({ cursor: accountKey, data: {
      userID: 'owner', schemaVersion: 1, calendarDate: '2026-09-10', endTimeMs: end,
      source: { provider: 'GarminAPI', accountKey }, metrics: ['overnight_rmssd', 'health_snapshot_rmssd'].map(semanticVariant => ({
        kind: 'value', metricId: 'heart_rate_variability', normalizationStatus: 'canonical',
        canonical: { value: 40 + i * 10, unit: HEALTH_UNITS.Millisecond }, aggregation: 'average', semanticVariant,
        origin: 'provider_summary', recordingMethod: 'provider_calculated',
      })),
    } })));
    const result = await queryHrvPersonalRange(input, deps);
    expect(result.series).toHaveLength(3);
    expect(result.series.map(series => series.readings[0].value)).toEqual([40, 50, 45]);
    expect(new Set(result.series.map(series => series.accountNumber)).size).toBe(3);
    expect(result.series.map(series => series.semanticVariant)).not.toContain('health_snapshot_rmssd');
    expect(JSON.stringify(result)).not.toContain('accountKey');
  });
  it('uses the same baseline as the frontend and excludes private neighboring fields', async () => {
    const result = await queryHrvPersonalRange(input, reads());
    const observations = Array.from({ length: 70 }, (_, i) => ({ timestampMs: end - i * DAY,
      calendarDate: new Date(end - i * DAY).toISOString().slice(0, 10), value: 40 + i % 5 }));
    const expected = calculatePersonalMetricRange(observations, end, { baselineWindowDays: 60,
      baselineMinimumObservationDays: 14, currentWindowDays: 7, currentMinimumObservationDays: 3 });
    expect(result.series[0].normalRange).toEqual(expected.normalRange);
    expect(result.series[0].currentAverage).toBe(expected.currentAverage);
    expect(result.series[0].readings).toHaveLength(30);
    expect(result.series[0].rangePoints).toHaveLength(30);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.series[0].readings[0].display?.unit).toBe('ms');
    expect(MCP_HRV_RANGE_SCHEMA.safeParse({ ...result, sourceKey: 'private' }).success).toBe(false);
    expect(MCP_HRV_RANGE_SCHEMA.safeParse({ ...result, series: [{ ...result.series[0], accountKey: 'private' }] }).success).toBe(false);
  });
  it.each([{ scopes: [] }, { scopes: ['health:read'] }, { scopes: ['sleep:read'] }])('rejects missing permissions before reads: $scopes', async ({ scopes }) => {
    const deps = reads();
    await expect(queryHrvPersonalRange({ ...input, scopes }, deps)).rejects.toThrow('access');
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });
  it('stops before reading deleted accounts and withholds in-flight results after deletion', async () => {
    const deps = reads();
    vi.mocked(deps.activeOwner).mockResolvedValue(false);
    await expect(queryHrvPersonalRange(input, deps)).rejects.toThrow('Account');
    expect(deps.fetchPage).not.toHaveBeenCalled();
    vi.mocked(deps.activeOwner).mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(queryHrvPersonalRange(input, deps)).rejects.toThrow('Account');
  });
  it('returns an explicit building state without inventing missing values', async () => {
    const result = await queryHrvPersonalRange(input, reads(3));
    expect(result.series[0].status).toBe('building_baseline');
    expect(result.series[0].rangePoints.every(point => point.normalRange === null)).toBe(true);
  });
  it('fails on incomplete history rather than grading it', async () => {
    await expect(queryHrvPersonalRange(input, reads(1001))).rejects.toThrow('read limit');
  });
});
