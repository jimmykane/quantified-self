import { describe, expect, it } from 'vitest';
import { ACTIVITY_EXPLORER_PERIODS, activityExplorerDateRange, activityExplorerSports, filterActivityExplorerEvents, normalizeActivityExplorerCustomDates, normalizeActivityExplorerSports, type ActivityExplorerFilters } from './activity-explorer.helper';
import { activityRangeDates, currentActivityDateRange, resolveActivityDateRange, shiftActivityDateRange } from './activity-date-range.helper';

const now = new Date(2026, 9, 21, 12);
const filters: ActivityExplorerFilters = { tags: [], untagged: false, sports: [], period: 'all' };
const event = (tags: string[], sports = ['Running'], date = new Date(2026, 9, 20)) => ({
  tags, startDate: date, getActivityTypesAsArray: () => sports,
});

describe('Activity explorer date-range filters', () => {
  it.each(['week', 'month', 'quarter', 'calendar-week', 'calendar-month', 'year', 'custom'] as const)(
    'caps %s forward navigation at its current window, including fixed current and future ranges', preset => {
      const today = new Date(2026, 10, 10);
      const current = resolveActivityDateRange(preset, today, { startDate: '2026-11-03', endDate: '2026-11-10' }, 0)!;
      const previous = shiftActivityDateRange(preset, current, -1, current)!;
      expect(shiftActivityDateRange(preset, previous, 1, current)).toEqual(current);
      expect(shiftActivityDateRange(preset, current, 1, current)).toBeUndefined();
      const future = shiftActivityDateRange(preset, current, 1)!;
      expect(shiftActivityDateRange(preset, future, 1, current)).toBeUndefined();
      expect(shiftActivityDateRange(preset, future, -1, current)).toEqual(current);
    });
  it.each(['week', 'month', 'quarter', 'custom'] as const)(
    'lands an off-cycle %s window on the current period instead of overshooting it across DST', preset => {
      const previousTimezone = process.env.TZ; process.env.TZ = 'Europe/Helsinki';
      try {
        const today = new Date(2026, 9, 26);
        const range = resolveActivityDateRange(preset, today, { startDate: '2026-10-19', endDate: '2026-10-25' }, 1, '2026-10-25')!;
        const current = currentActivityDateRange(preset, today, range)!;
        expect(shiftActivityDateRange(preset, range, 1, current)).toEqual(current);
        expect(activityRangeDates(current).endDate).toBe('2026-10-26');
        expect(shiftActivityDateRange(preset, current, 1, current)).toBeUndefined();
      } finally { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; }
    });
  it.each([['week', 7], ['month', 30], ['quarter', 90]] as const)('steps %s windows by their complete calendar-day length', (preset, days) => {
    const current = resolveActivityDateRange(preset, new Date(2026, 10, 10))!;
    const previous = shiftActivityDateRange(preset, current, -1)!;
    expect(previous.end).toEqual(current.start);
    expect(shiftActivityDateRange(preset, previous, 1)).toEqual(current);
    const start = new Date(current.start); start.setDate(start.getDate() - days);
    expect(previous.start).toEqual(start);
  });
  it('navigates complete calendar years and months across leap years', () => {
    const year = resolveActivityDateRange('year', new Date(2024, 5, 10))!;
    expect(year).toEqual({ start: new Date(2024, 0, 1), end: new Date(2025, 0, 1) });
    expect(shiftActivityDateRange('year', year, -1)).toEqual({ start: new Date(2023, 0, 1), end: new Date(2024, 0, 1) });
    const march = resolveActivityDateRange('calendar-month', new Date(2024, 2, 31))!;
    expect(shiftActivityDateRange('calendar-month', march, -1)).toEqual({ start: new Date(2024, 1, 1), end: new Date(2024, 2, 1) });
  });
  it('keeps custom navigation inclusive and returns the same window length to today', () => {
    const range = resolveActivityDateRange('custom', now, { startDate: '2026-10-01', endDate: '2026-10-08' })!;
    expect(activityRangeDates(shiftActivityDateRange('custom', range, -1)!)).toEqual({ startDate: '2026-09-23', endDate: '2026-09-30' });
    expect(activityRangeDates(currentActivityDateRange('custom', new Date(2026, 10, 10), range)!)).toEqual({ startDate: '2026-11-03', endDate: '2026-11-10' });
  });
  it.each(['Europe/Helsinki', 'America/New_York'])('keeps adjacent windows and exact round trips across DST in %s', timezone => {
    const previous = process.env.TZ; process.env.TZ = timezone;
    try {
      for (const day of ['2026-03-30', '2026-11-02']) {
        const range = resolveActivityDateRange('week', now, null, 1, day)!;
        const before = shiftActivityDateRange('week', range, -1)!;
        expect(before.end).toEqual(range.start);
        expect(before.start.getHours()).toBe(0);
        expect(shiftActivityDateRange('week', before, 1)).toEqual(range);
      }
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it('keeps each calendar boundary at the start of its own day when DST skips midnight', () => {
    const previous = process.env.TZ; process.env.TZ = 'America/Santiago';
    try {
      const today = new Date(2026, 8, 6, 12);
      const range = resolveActivityDateRange('week', today)!;
      expect(range).toEqual({ start: new Date(2026, 7, 31), end: new Date(2026, 8, 7) });
      const custom = resolveActivityDateRange('custom', today, { startDate: '2026-09-06', endDate: '2026-09-06' })!;
      expect(custom).toEqual({ start: new Date(2026, 8, 6), end: new Date(2026, 8, 7) });
      expect(shiftActivityDateRange('custom', custom, 1)).toEqual({ start: new Date(2026, 8, 7), end: new Date(2026, 8, 8) });
      expect(currentActivityDateRange('custom', today, custom)).toEqual(custom);
      const month = resolveActivityDateRange('calendar-month', today)!;
      expect(month).toEqual({ start: new Date(2026, 8, 1), end: new Date(2026, 9, 1) });
      expect(resolveActivityDateRange('year', today)).toEqual({ start: new Date(2026, 0, 1), end: new Date(2027, 0, 1) });
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it('keeps calendar weeks separate from rolling seven-day ranges and honors the account week start', () => {
    const now = new Date(2026, 10, 4, 12);
    expect(activityExplorerDateRange('calendar-week', now, null, 0)).toEqual({ start: new Date(2026, 10, 1), end: new Date(2026, 10, 8) });
    expect(activityExplorerDateRange('calendar-week', now, null, 1)).toEqual({ start: new Date(2026, 10, 2), end: new Date(2026, 10, 9) });
    expect(activityExplorerDateRange('week', now)).toEqual({ start: new Date(2026, 9, 29), end: new Date(2026, 10, 5) });
  });

  it('places All dates after every bounded date range', () => {
    expect(ACTIVITY_EXPLORER_PERIODS.at(-1)).toEqual({ value: 'all', label: 'All dates' });
    for (const period of ACTIVITY_EXPLORER_PERIODS.slice(0, -1)) {
      expect(activityExplorerDateRange(period.value, now, { startDate: '2026-10-01', endDate: '2026-10-21' })).toBeTruthy();
    }
  });
  it('offers canonical sports beyond the current range', () => {
    expect(activityExplorerSports([], [], true)).toContain('Running');
  });
  it('includes both custom dates and uses the next local midnight as its exclusive bound', () => {
    const customDates = { startDate: '2026-10-24', endDate: '2026-10-25' };
    expect(activityExplorerDateRange('custom', now, customDates)).toEqual({
      start: new Date(2026, 9, 24), end: new Date(2026, 9, 26),
    });
    const records = [
      event([], ['Running'], new Date(2026, 9, 23, 23, 59, 59)),
      event([], ['Running'], new Date(2026, 9, 24)),
      event([], ['Running'], new Date(2026, 9, 25, 23, 59, 59, 999)),
      event([], ['Running'], new Date(2026, 9, 26)),
    ];
    expect(filterActivityExplorerEvents(records, { ...filters, period: 'custom', customDates }, now)).toEqual(records.slice(1, 3));
    expect(activityExplorerDateRange('custom', now, { startDate: '2024-02-29', endDate: '2024-02-29' }))
      .toEqual({ start: new Date(2024, 1, 29), end: new Date(2024, 2, 1) });
  });

  it('preserves local day boundaries across both daylight-saving transitions', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Helsinki';
    try {
      const autumn = activityExplorerDateRange('custom', now, { startDate: '2026-10-24', endDate: '2026-10-25' })!;
      const spring = activityExplorerDateRange('custom', now, { startDate: '2026-03-28', endDate: '2026-03-29' })!;
      expect(autumn.start).toEqual(new Date(2026, 9, 24)); expect(autumn.end).toEqual(new Date(2026, 9, 26));
      expect(spring.start).toEqual(new Date(2026, 2, 28)); expect(spring.end).toEqual(new Date(2026, 2, 30));
      expect(autumn.end.getTime() - autumn.start.getTime()).toBe(49 * 60 * 60 * 1000);
      expect(spring.end.getTime() - spring.start.getTime()).toBe(47 * 60 * 60 * 1000);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it.each([
    [null, null], ['2026-10-01', null], ['2026-10-22', '2026-10-21'],
    ['2026-02-29', '2026-03-01'], ['2026-13-01', '2026-13-02'],
    ['2026-10-01T00:00:00Z', '2026-10-21'], ['2026-1-1', '2026-10-21'],
  ])('rejects invalid or incomplete custom dates (%s, %s) without treating them as All dates', (startDate, endDate) => {
    expect(normalizeActivityExplorerCustomDates(startDate, endDate)).toBeNull();
    expect(activityExplorerDateRange('custom', now)).toBeUndefined();
    expect(filterActivityExplorerEvents([event([])], { ...filters, period: 'custom' }, now)).toEqual([]);
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
    expect(filterActivityExplorerEvents(records, { ...filters, tags: ['endurance'], sports: ['Running'] }, now)).toEqual([records[0]]);
    expect(records).toHaveLength(3);
    expect(records[0].tags).toEqual(['Endurance']);
  });

  it('respects canonical and legacy tags when selecting untagged activities', () => {
    const untagged = event([]);
    const legacy = { ...event([]), tags: undefined, benchmarkReviewTags: ['Race'] };
    const cleared = { ...event([]), benchmarkReviewTags: ['Old label'] };
    expect(filterActivityExplorerEvents([untagged, legacy, cleared], { ...filters, untagged: true }, now)).toEqual([untagged, cleared]);
    expect(filterActivityExplorerEvents([legacy], { ...filters, tags: ['race'] }, now)).toEqual([legacy]);
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
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['Cycling'] }, now)).toEqual([records[0]]);
    expect(activityExplorerSports(records, ['Rowing'])).toEqual(['Cycling', 'Rowing', 'Running', 'Swimming']);
    expect(activityExplorerSports([], ['Rowing'])).toEqual(['Rowing']);
  });

  it('matches legacy sport aliases using the same canonical names as the table', () => {
    const records = [event([], ['Run']), event([], ['Running']), event([], ['Ride']), event([], ['Cycling']), event([], ['trail_running'])];
    expect(activityExplorerSports(records, ['run'])).toEqual(['Cycling', 'Running', 'Trail Running']);
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['Running'] }, now)).toEqual(records.slice(0, 2));
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['Ride'] }, now)).toEqual(records.slice(2, 4));
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['TrailRunning'] }, now)).toEqual([records[4]]);
    expect(records[0].getActivityTypesAsArray()).toEqual(['Run']);
  });

  it('matches any selected sport and any selected tag, including Untagged, without duplicating multisport events', () => {
    const records = [event(['Endurance'], ['Run', 'Cycling']), event(['Race'], ['Swimming']), event([], ['Cycling']), event(['Recovery'], ['Rowing'])];
    expect(filterActivityExplorerEvents(records, { ...filters, tags: ['endurance', 'race'], sports: ['Running', 'Swimming'] }, now)).toEqual(records.slice(0, 2));
    expect(filterActivityExplorerEvents(records, { ...filters, tags: ['ENDURANCE'], untagged: true, sports: ['Cycling'] }, now)).toEqual([records[0], records[2]]);
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['Run', 'Ride'] }, now)).toEqual([records[0], records[2]]);
    expect(normalizeActivityExplorerSports(['Run', 'Running', 'Ride', '  Custom sport  '])).toEqual(['Custom sport', 'Cycling', 'Running']);
    expect(activityExplorerSports([], ['Rowing', 'Run'])).toEqual(['Rowing', 'Running']);
  });

  it('preserves unrecognized recorded sports and keeps exact canonical sports distinct', () => {
    const records = [event([], ['Custom sport']), event([], ['GravelCycling']), event([], ['Cycling'])];
    expect(activityExplorerSports(records)).toEqual(['Custom sport', 'Cycling', 'Gravel Cycling']);
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['Gravel Cycling'] }, now)).toEqual([records[1]]);
    expect(filterActivityExplorerEvents(records, { ...filters, sports: ['Custom sport'] }, now)).toEqual([records[0]]);
  });
});
