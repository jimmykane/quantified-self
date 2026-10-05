import { describe, expect, it } from 'vitest';
import { armMarketingSchedule, marketingScheduleGate, nextMarketingSendAt, validateMarketingSchedule } from '../../../../shared/marketing-schedule';

const utc = { time: '09:00', timeZone: 'UTC' };
const at = (iso: string) => new Date(iso);

describe('daily marketing schedule', () => {
  it('keeps legacy campaigns immediate and normalizes timezone names', () => {
    expect(validateMarketingSchedule(undefined)).toBeNull();
    expect(validateMarketingSchedule(null)).toBeNull();
    expect(validateMarketingSchedule({ time: '09:00', timeZone: 'US/Eastern' })).toEqual({ time: '09:00', timeZone: 'America/New_York' });
    expect(marketingScheduleGate(null, {}, at('2026-10-05T01:00:00Z')).due).toBe(true);
  });

  it.each([false, [], {}, { time: '24:00', timeZone: 'UTC' }, { time: '9:00', timeZone: 'UTC' },
    { time: '09:60', timeZone: 'UTC' }, { time: '09:00', timeZone: 'Invalid/Zone' },
    { time: '09:00', timeZone: '+03:00' }, { time: '09:00', timeZone: 'UTC', extra: true }])('rejects malformed schedules %#', value => {
    expect(() => validateMarketingSchedule(value)).toThrow();
  });

  it('arms the next occurrence, including the exact selected minute', () => {
    expect(nextMarketingSendAt(utc, at('2026-10-05T08:59:00Z'))).toBe('2026-10-05T09:00:00.000Z');
    expect(nextMarketingSendAt(utc, at('2026-10-05T09:00:00Z'))).toBe('2026-10-06T09:00:00.000Z');
    expect(armMarketingSchedule(utc, {}, at('2026-10-05T09:00:00Z')).nextScheduledSendAt).toBe('2026-10-05T09:00:00.000Z');
  });

  it('uses the selected local date and adjusts for summer/winter offsets', () => {
    const schedule = { time: '09:00', timeZone: 'Europe/Helsinki' };
    expect(nextMarketingSendAt(schedule, at('2026-07-04T22:00:00Z'))).toBe('2026-07-05T06:00:00.000Z');
    expect(nextMarketingSendAt(schedule, at('2026-12-04T23:00:00Z'))).toBe('2026-12-05T07:00:00.000Z');
  });

  it('shifts nonexistent times forward and uses repeated times only once', () => {
    expect(nextMarketingSendAt({ time: '02:30', timeZone: 'America/New_York' }, at('2026-03-08T00:00:00Z'))).toBe('2026-03-08T07:30:00.000Z');
    const repeated = { time: '01:30', timeZone: 'America/New_York' };
    expect(nextMarketingSendAt(repeated, at('2026-11-01T00:00:00Z'))).toBe('2026-11-01T05:30:00.000Z');
    expect(nextMarketingSendAt(repeated, at('2026-11-01T06:00:00Z'))).toBe('2026-11-02T06:30:00.000Z');
    expect(nextMarketingSendAt({ time: '02:15', timeZone: 'Australia/Lord_Howe' }, at('2026-10-03T00:00:00Z'))).toBe('2026-10-03T15:45:00.000Z');
  });

  it('waits, continues a batch across ticks, and waits again after UTC rollover', () => {
    const armed = armMarketingSchedule(utc, {}, at('2026-10-05T08:00:00Z'));
    expect(marketingScheduleGate(utc, armed, at('2026-10-05T08:55:00Z')).due).toBe(false);
    const opened = marketingScheduleGate(utc, armed, at('2026-10-05T09:03:00Z'));
    expect(opened).toEqual({ due: true, state: { scheduledDispatchUtcDate: '2026-10-05', nextScheduledSendAt: '2026-10-06T09:00:00.000Z' } });
    expect(marketingScheduleGate(utc, opened.state, at('2026-10-05T18:00:00Z')).due).toBe(true);
    expect(marketingScheduleGate(utc, opened.state, at('2026-10-06T00:00:00Z')).due).toBe(false);
    expect(marketingScheduleGate(utc, opened.state, at('2026-10-06T09:00:00Z')).due).toBe(true);
    expect(marketingScheduleGate(utc, {}, at('2026-10-06T09:00:00Z')).due).toBe(false);
  });

  it('resumes a current batch but skips a time missed while paused', () => {
    const state = { scheduledDispatchUtcDate: '2026-10-05', nextScheduledSendAt: '2026-10-06T09:00:00.000Z' };
    expect(armMarketingSchedule(utc, state, at('2026-10-05T13:00:00Z'))).toEqual(state);
    expect(armMarketingSchedule(utc, state, at('2026-10-06T13:00:00Z'))).toEqual({ scheduledDispatchUtcDate: null, nextScheduledSendAt: '2026-10-07T09:00:00.000Z' });
  });

  it('allows a cron tick after midnight but does not replay an expired occurrence', () => {
    const schedule = { time: '23:58', timeZone: 'UTC' };
    const state = { nextScheduledSendAt: '2026-10-05T23:58:00.000Z' };
    expect(marketingScheduleGate(schedule, state, at('2026-10-06T00:00:00Z')).state).toEqual({ scheduledDispatchUtcDate: '2026-10-06', nextScheduledSendAt: '2026-10-06T23:58:00.000Z' });
    expect(marketingScheduleGate(schedule, state, at('2026-10-06T00:04:00Z')).due).toBe(false);
    expect(marketingScheduleGate(schedule, state, at('2026-10-07T23:59:00Z')).due).toBe(true);
  });
});
