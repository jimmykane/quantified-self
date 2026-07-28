import { describe, expect, it } from 'vitest';
import { formatDashboardRelativeDay } from './dashboard-relative-date.helper';

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
