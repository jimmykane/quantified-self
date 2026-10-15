import { describe, expect, it } from 'vitest';
import { buildDashboardTodaySleepStatus, formatDashboardRelativeDay } from './dashboard-relative-date.helper';

describe('buildDashboardTodaySleepStatus', () => {
  const nowMs = new Date(2026, 9, 15, 7, 12).getTime();

  it('waits for today even when yesterday’s night is less than 24 hours old', () => {
    expect(buildDashboardTodaySleepStatus(new Date(2026, 9, 14, 8).getTime(), { nowMs, locale: 'en-GB' }))
      .toMatchObject({ awaitingSleep: true, contextText: 'Last available · 14 Oct' });
    expect(buildDashboardTodaySleepStatus(new Date(2026, 9, 15, 7).getTime(), { nowMs }))
      .toMatchObject({ awaitingSleep: false, contextText: 'Today' });
  });

  it('uses local midnight even when recent readings fall on the same UTC day', () => {
    const midnightNowMs = new Date(2026, 9, 15, 0, 10).getTime();
    expect(buildDashboardTodaySleepStatus(new Date(2026, 9, 14, 23, 55).getTime(), { nowMs: midnightNowMs }).awaitingSleep)
      .toBe(true);
    expect(buildDashboardTodaySleepStatus(new Date(2026, 9, 15, 0, 5).getTime(), { nowMs: midnightNowMs }).awaitingSleep)
      .toBe(false);
  });

  it.each([null, undefined, NaN, Infinity, nowMs + 1])('does not accept missing or unfinished sleep (%s)', timestamp => {
    expect(buildDashboardTodaySleepStatus(timestamp, { nowMs }))
      .toMatchObject({ awaitingSleep: true, contextText: 'No completed night' });
  });

  it('dates prior-year evidence and uses the app’s locale', () => {
    expect(buildDashboardTodaySleepStatus(new Date(2025, 11, 31, 8).getTime(), { nowMs, locale: 'en-GB' }).contextText)
      .toBe('Last available · 31 Dec 2025');
    expect(buildDashboardTodaySleepStatus(new Date(2026, 9, 14, 8).getTime(), { nowMs, locale: 'de-DE' }).contextText)
      .toBe('Last available · 14. Okt.');
  });

  it.each([[2026, 2, 29], [2026, 9, 25], [2026, 11, 31]])('refreshes at local midnight across DST/year boundaries (%s %s %s)', (year, month, day) => {
    const before = new Date(year, month, day, 0, 1).getTime();
    const midnight = new Date(year, month, day + 1).getTime();
    expect(buildDashboardTodaySleepStatus(before, { nowMs: before }).refreshAtMs).toBe(midnight);
    expect(buildDashboardTodaySleepStatus(before, { nowMs: midnight }).awaitingSleep).toBe(true);
  });
});

describe('formatDashboardRelativeDay', () => {
  const nowMs = new Date(2026, 6, 28, 12).getTime();

  it('uses calendar-relative labels for the latest eligible night', () => {
    expect(formatDashboardRelativeDay(new Date(2026, 6, 28, 7).getTime(), { nowMs, locale: 'en' })).toBe('Today');
    expect(formatDashboardRelativeDay(new Date(2026, 6, 27, 7).getTime(), { nowMs, locale: 'en' })).toBe('Yesterday');
    expect(formatDashboardRelativeDay(new Date(2026, 6, 26, 7).getTime(), { nowMs, locale: 'en' })).toBe('2 days ago');
  });

  it('does not invent a date when no eligible night is available', () => {
    expect(formatDashboardRelativeDay(null, { nowMs })).toBe('No eligible night');
  });
});
