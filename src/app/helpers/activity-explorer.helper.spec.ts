import { describe, expect, it } from 'vitest';
import { ACTIVITY_EXPLORER_PERIODS, activityExplorerDateRange, activityExplorerSports, filterActivityExplorerEvents, type ActivityExplorerFilters } from './activity-explorer.helper';

const now = new Date(2026, 9, 21, 12);
const filters: ActivityExplorerFilters = { tag: '', untagged: false, sport: '', period: 'all' };
const event = (tags: string[], sports = ['Running'], date = new Date(2026, 9, 20)) => ({
  tags, startDate: date, getActivityTypesAsArray: () => sports,
});

describe('Activity explorer date-range filters', () => {
  it('places All dates after every bounded date range', () => {
    expect(ACTIVITY_EXPLORER_PERIODS.at(-1)).toEqual({ value: 'all', label: 'All dates' });
    for (const period of ACTIVITY_EXPLORER_PERIODS.slice(0, -1)) {
      expect(activityExplorerDateRange(period.value, now)).not.toBeNull();
    }
  });
  it('offers canonical sports beyond the current range', () => {
    expect(activityExplorerSports([], '', true)).toContain('Running');
  });
  it('defines familiar date ranges with an inclusive first day and exclusive tomorrow', () => {
    expect(activityExplorerDateRange('all', now)).toBeNull();
    expect(activityExplorerDateRange('month', now)).toEqual({ start: new Date(2026, 8, 22), end: new Date(2026, 9, 22) });
    expect(activityExplorerDateRange('quarter', now)).toEqual({ start: new Date(2026, 6, 24), end: new Date(2026, 9, 22) });
    expect(activityExplorerDateRange('year', new Date(2026, 11, 31, 23))).toEqual({ start: new Date(2026, 0, 1), end: new Date(2027, 0, 1) });
    const records = [event([], ['Running'], new Date(2026, 8, 21)), event([], ['Running'], new Date(2026, 8, 22))];
    expect(filterActivityExplorerEvents(records, { ...filters, period: 'month' }, now)).toEqual([records[1]]);
  });
  it('starts with all loaded events and combines tag and sport filters without changing the source', () => {
    const records = [event(['Endurance']), event(['ENDURANCE'], ['Cycling']), event(['Recovery'])];
    expect(filterActivityExplorerEvents(records, filters, now)).toEqual(records);
    expect(filterActivityExplorerEvents(records, { ...filters, tag: 'endurance', sport: 'Running' }, now)).toEqual([records[0]]);
    expect(records).toHaveLength(3);
    expect(records[0].tags).toEqual(['Endurance']);
  });

  it('respects canonical and legacy tags when selecting untagged activities', () => {
    const untagged = event([]);
    const legacy = { ...event([]), tags: undefined, benchmarkReviewTags: ['Race'] };
    const cleared = { ...event([]), benchmarkReviewTags: ['Old label'] };
    expect(filterActivityExplorerEvents([untagged, legacy, cleared], { ...filters, untagged: true }, now)).toEqual([untagged, cleared]);
    expect(filterActivityExplorerEvents([legacy], { ...filters, tag: 'race' }, now)).toEqual([legacy]);
  });

  it('uses seven local calendar days, including today, with exclusive tomorrow and valid dates', () => {
    const records = [
      event([], ['Running'], new Date(2026, 9, 14, 23, 59, 59)),
      event([], ['Running'], new Date(2026, 9, 15)),
      event([], ['Running'], new Date(2026, 9, 21, 23, 59, 59)),
      event([], ['Running'], new Date(2026, 9, 22)),
      event([], ['Running'], new Date(NaN)),
    ];
    expect(filterActivityExplorerEvents(records, { ...filters, period: 'week' }, now)).toEqual(records.slice(1, 3));
    expect(filterActivityExplorerEvents(records, filters, now)).toEqual(records);
  });

  it('matches individual sports in multi-sport events and retains an unloaded selected sport', () => {
    const records = [event([], ['Running', 'Cycling']), event([], ['Swimming'])];
    expect(filterActivityExplorerEvents(records, { ...filters, sport: 'Cycling' }, now)).toEqual([records[0]]);
    expect(activityExplorerSports(records, 'Rowing')).toEqual(['Cycling', 'Rowing', 'Running', 'Swimming']);
    expect(activityExplorerSports([], 'Rowing')).toEqual(['Rowing']);
  });

  it('matches legacy sport aliases using the same canonical names as the table', () => {
    const records = [event([], ['Run']), event([], ['Running']), event([], ['Ride']), event([], ['Cycling']), event([], ['trail_running'])];
    expect(activityExplorerSports(records, 'run')).toEqual(['Cycling', 'Running', 'Trail Running']);
    expect(filterActivityExplorerEvents(records, { ...filters, sport: 'Running' }, now)).toEqual(records.slice(0, 2));
    expect(filterActivityExplorerEvents(records, { ...filters, sport: 'Ride' }, now)).toEqual(records.slice(2, 4));
    expect(filterActivityExplorerEvents(records, { ...filters, sport: 'TrailRunning' }, now)).toEqual([records[4]]);
    expect(records[0].getActivityTypesAsArray()).toEqual(['Run']);
  });

  it('preserves unrecognized recorded sports and keeps exact canonical sports distinct', () => {
    const records = [event([], ['Custom sport']), event([], ['GravelCycling']), event([], ['Cycling'])];
    expect(activityExplorerSports(records)).toEqual(['Custom sport', 'Cycling', 'Gravel Cycling']);
    expect(filterActivityExplorerEvents(records, { ...filters, sport: 'Gravel Cycling' }, now)).toEqual([records[1]]);
    expect(filterActivityExplorerEvents(records, { ...filters, sport: 'Custom sport' }, now)).toEqual([records[0]]);
  });
});
