import { describe, expect, it } from 'vitest';
import { WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { formatCanonicalHealthMetricSportsLibValue, formatCanonicalSleepMetricSportsLibValue } from '@shared/sports-lib-health-data';
import type { HealthWorkspaceSeries } from './health-workspace.helper';
import { addComparisonDays, buildNoteComparisonRows, comparisonValueText, noteComparisonWindow } from './timeline-note-comparison.helper';

const note = { startDate: '2026-09-30', timeZone: 'Europe/Helsinki' };
const now = Date.parse('2026-10-15T10:00:00Z');
const complete = { sleep_duration: true, heart_rate_variability: true, resting_heart_rate: true };
function series(id = 'a', variant = 'daily_resting', metricId = 'resting_heart_rate'): HealthWorkspaceSeries {
  return { id, sourceSelectionKey: id, metricId, provider: 'GarminAPI', providerLabel: 'Garmin', sourceLabel: 'Garmin',
    accountLabel: null, semanticLabel: variant, aggregation: 'average', semanticVariant: variant, origin: 'provider_summary',
    recordingMethod: 'provider_calculated', unit: 'bpm', normalizationStatus: 'canonical', nativeOnly: false,
    valueType: 'number', chartKind: 'line', sampleBased: false, deviceLabel: null, coverageText: '', freshnessText: '', hasConflict: false,
    points: Array.from({ length: 29 }, (_, i) => { const date = addComparisonDays(note.startDate, i - 14);
      return { timestampMs: Date.parse(`${date}T08:00:00Z`), calendarDate: date, value: i < 14 ? 60 : 64, qualityCode: null }; }) } as HealthWorkspaceSeries;
}
const row = (values: HealthWorkspaceSeries[], days: 7 | 14 | 28 = 14, selected = {}) =>
  buildNoteComparisonRows(values, noteComparisonWindow(note, days, now), complete, selected)[2];
describe('Timeline note comparisons', () => {
  it('excludes the change day and requires complete calendar days in the captured zone', () => {
    const w = noteComparisonWindow(note, 14, now);
    expect(w.before).toEqual({ startDate: '2026-09-16', endDate: '2026-09-29' });
    expect(w.after).toEqual({ startDate: '2026-10-01', endDate: '2026-10-14' });
    expect(w.incomplete).toBe(false);
    expect(noteComparisonWindow(note, 14, Date.parse('2026-10-14T20:59:59Z')).incomplete).toBe(true);
    expect(noteComparisonWindow(note, 14, Date.parse('2026-10-14T21:00:00Z')).incomplete).toBe(false);
  });
  it('uses calendar labels across spring/fall DST and the year boundary', () => {
    for (const startDate of ['2026-03-29', '2026-10-25', '2026-01-01']) {
      const w = noteComparisonWindow({ ...note, startDate }, 7, now);
      expect(addComparisonDays(w.before.startDate, 7)).toBe(startDate);
      expect(addComparisonDays(startDate, 7)).toBe(w.after.endDate);
    }
    expect(() => noteComparisonWindow({ ...note, startDate: '2026-02-30' }, 7, now)).toThrow();
    expect(() => noteComparisonWindow({ ...note, startDate: '0001-01-01' }, 7, now)).toThrow('supported calendar');
  });
  it('calculates equal-weight daily medians without mutating or using downsampled readings', () => {
    const s = series(); s.points.push(...Array.from({ length: 1000 }, () => ({ ...s.points[0], value: 80 })));
    const result = row([s]);
    expect(result.before).toBe(60); expect(result.after).toBe(64); expect(result.difference).toBe(4);
    expect(result.beforeCount).toBe(14); expect(result.afterCount).toBe(14);
    expect(s.points).toHaveLength(1029); expect(result.dailySeries?.points).toHaveLength(28);
    expect(result.dailySeries?.points.some(p => p.calendarDate === note.startDate)).toBe(false);
  });
  it('does not combine sources, accounts or semantic readings across windows', () => {
    const before = series('before'), after = series('after');
    before.points = before.points.filter(p => p.calendarDate < note.startDate);
    after.points = after.points.filter(p => p.calendarDate > note.startDate);
    const result = row([before, after]);
    expect(result.difference).toBeNull(); expect(result.status).toBe('insufficient');
    expect(row([series('sleep-rhr', 'sleep_session_resting_heart_rate')]).status).toBe('no-source');
    expect(row([{ ...series(), nativeOnly: true }]).status).toBe('no-source');
    expect(row([{ ...series(), sampleBased: true }]).status).toBe('no-source');
  });
  it('prefers a shared source and retains an explicitly unavailable choice', () => {
    const s = series('one-sided'); s.points = s.points.filter(p => p.calendarDate < note.startDate);
    expect(row([s, series('matching')]).selectedKey).toBe('matching');
    expect(row([series()], 14, { resting_heart_rate: 'missing' }).status).toBe('source-unavailable');
    expect(row([{ ...series(), points: [] }]).choices).toEqual([]);
    expect(row([{ ...series(), points: [{ ...series().points[0], timestampMs: 1e100 }] }]).status).toBe('no-source');
  });
  it('keeps missing values missing and withholds incomplete, sparse, failed and conflicting results', () => {
    expect(row([series()], 28).difference).toBeNull();
    const s = series(); s.points = s.points.filter(p => p.calendarDate < note.startDate || p.calendarDate === '2026-10-01');
    expect(row([s]).status).toBe('insufficient'); expect(row([s]).afterCount).toBe(1);
    expect(row([{ ...series(), hasConflict: true }]).status).toBe('conflicting');
    expect(buildNoteComparisonRows([series()], noteComparisonWindow(note, 14, now), {})[2].status).toBe('unavailable');
  });
  it('retains valid zero values and rejects invalid dates, numbers, quality and partial current days', () => {
    const s = series(); s.points[0].value = 0;
    s.points.push({ ...s.points[0], calendarDate: '2026-02-30', value: 99 },
      { ...s.points[0], value: NaN }, { ...s.points[0], calendarDate: '2026-10-15' });
    expect(row([s]).beforeCount).toBe(14); expect(row([s]).afterCount).toBe(14);
    s.points[1].qualityCode = 'invalid'; expect(row([s]).beforeCount).toBe(13);
  });
  it('does not substitute naps, daytime HRV or sleep HR for the three supported metrics', () => {
    const rows = buildNoteComparisonRows([series('nap', 'nap_duration', 'sleep_duration'),
      series('day', 'activity_interval_rmssd', 'heart_rate_variability'), series('hr', 'sleep_session_average_heart_rate', 'heart_rate')],
    noteComparisonWindow(note, 14, now), complete);
    expect(rows.every(r => r.status === 'no-source')).toBe(true);
  });
  it('withholds differences for mixed devices or known timezone calendar ambiguity instead of shifting days', () => {
    expect(row([{ ...series(), deviceLabel: 'Multiple devices' }]).status).toBe('mixed-devices');
    const s = series();
    s.points[0] = { ...s.points[0], timestampMs: Date.parse('2026-09-17T00:00:00Z'), timezoneOffsetSeconds: -10 * 3600 };
    expect(row([s]).status).toBe('calendar-mismatch');
    expect(row([s]).beforeCount).toBe(14);
    expect(row([s]).dailySeries?.points[0].calendarDate).toBe('2026-09-16');
  });
  it('uses canonical Sports Lib displays for values, differences and alternate unit settings', () => {
    for (const units of [null, normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds })]) {
      for (const metric of ['sleep_duration', 'heart_rate_variability', 'resting_heart_rate'] as const) {
        const d = metric === 'sleep_duration' ? formatCanonicalSleepMetricSportsLibValue('duration', 60, units, { compactDuration: true })!
          : formatCanonicalHealthMetricSportsLibValue(metric, 60, units)!;
        expect(comparisonValueText(metric, 60, units)).toBe(`${d.value} ${d.unit}`.trim());
        expect(comparisonValueText(metric, -60, units, true)).toBe(`−${d.value} ${d.unit}`.trim());
      }
    }
    expect(comparisonValueText('heart_rate_variability', null)).toBe('—');
  });
});
