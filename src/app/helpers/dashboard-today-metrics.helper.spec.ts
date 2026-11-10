import { describe, expect, it, vi } from 'vitest';
import { AppEventSummary } from '@shared/event-summary';
import { ActivityTypes, DataDistance, DistanceUnits, FileType, Privacy } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildTodayActivityMetrics } from './dashboard-today-metrics.helper';

const event = (id: string, stats: Record<string, number> = {}) => new AppEventSummary({ id, name: '', description: null,
  startDate: 0, endDate: 3_600_000, srcFileType: FileType.FIT, privacy: Privacy.Private, isMerge: false,
  stats: { 'Activity Types': [ActivityTypes.Running], ...stats } });
describe('Today activity metrics', () => {
  it('deduplicates recordings and preserves zero, missing and partial coverage', () => {
    const run = event('run', { Duration: 3600, Distance: 10_000, Ascent: 0 });
    const values = buildTodayActivityMetrics([run, run, event('missing')], true);
    expect(values.activities.value).toBe('2');
    expect(values.distance.value).toBe('10.00 Km');
    expect(values.distance.detail).toBe('Recorded in 1 of 2 activities');
    expect(values.ascent.value).toBe('0 m');
    expect(values.ascent.hasData).toBe(true);
    expect(values.tss.value).toBe('—');
    expect(buildTodayActivityMetrics([], true).distance.value).not.toBe('—');
    expect(buildTodayActivityMetrics([], true).distance.hasData).toBe(false);
    expect(buildTodayActivityMetrics([], false).distance.value).toBe('—');
  });
  it('distinguishes partial totals from a completed day with missing metric values', () => {
    const partial = buildTodayActivityMetrics([event('run', { Distance: 1000 })], false);
    expect(partial.activities).toMatchObject({ value: '1', status: 'error', detail: 'Partial activity count' });
    expect(partial.distance).toMatchObject({ status: 'error', detail: 'Partial total · 1 activity' });
    expect(partial.tss).toMatchObject({ value: '—', status: 'error', detail: 'Activity data is incomplete for today' });
    expect(buildTodayActivityMetrics([event('missing')], true).tss).toMatchObject({ status: 'empty', detail: 'No value recorded today' });
    expect(buildTodayActivityMetrics([], true).activities.detail).toBe('No activities recorded today');
  });
  it('uses canonical units and existing elevation exclusions', () => {
    const run = event('run', { Distance: 10_000, Ascent: 100 });
    expect(buildTodayActivityMetrics([run], true, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })).distance.value).toBe('6.22 mi');
    expect(buildTodayActivityMetrics([run], true, null, { removeAscentForEventTypes: [ActivityTypes.Running] }).ascent).toMatchObject({ value: '—', detail: 'Ascent excluded by your settings' });
  });
  it('counts metadata without constructing metrics and avoids hidden metric reads', () => {
    const run = event('run', { [DataDistance.type]: 1000 });
    const read = vi.spyOn(run, 'getStat');
    expect(buildTodayActivityMetrics([run], true, null, null, 'en-US', ['activities'])).toHaveProperty('activities.value', '1');
    expect(read).not.toHaveBeenCalled();
    const distance = buildTodayActivityMetrics([run], true, null, null, 'en-US', ['distance']);
    expect(Object.keys(distance)).toEqual(['distance']);
    expect(read).toHaveBeenCalledExactlyOnceWith(DataDistance.type);
  });
});
