import { describe, expect, it } from 'vitest';
import {
  formatDashboardGreeting,
  resolveNextDashboardGreetingBoundaryMs,
} from './dashboard-greeting.helper';

function localDate(hour: number, minute = 0, second = 0, millisecond = 0): Date {
  return new Date(2026, 7, 14, hour, minute, second, millisecond);
}

describe('dashboard greeting helper', () => {
  it.each([
    [localDate(0), 'Good morning'],
    [localDate(11, 59, 59, 999), 'Good morning'],
    [localDate(12), 'Good afternoon'],
    [localDate(17, 59, 59, 999), 'Good afternoon'],
    [localDate(18), 'Good evening'],
    [localDate(23, 59, 59, 999), 'Good evening'],
  ])('formats the local greeting period for %s', (date, expected) => {
    expect(formatDashboardGreeting(date)).toBe(expected);
  });

  it('uses the first trimmed display-name part', () => {
    expect(formatDashboardGreeting(localDate(9), '  Morgan   Lee  ')).toBe('Good morning, Morgan');
    expect(formatDashboardGreeting(localDate(13), '\tAna María\n')).toBe('Good afternoon, Ana');
  });

  it.each([null, undefined, '', '   ', '\t\n'])('uses generic copy for an unusable display name', (displayName) => {
    expect(formatDashboardGreeting(localDate(19), displayName)).toBe('Good evening');
  });

  it.each([
    [localDate(0), localDate(12)],
    [localDate(11, 59, 59, 999), localDate(12)],
    [localDate(12), localDate(18)],
    [localDate(17, 59, 59, 999), localDate(18)],
    [localDate(18), new Date(2026, 7, 15, 0, 0, 0, 0)],
    [localDate(23, 59, 59, 999), new Date(2026, 7, 15, 0, 0, 0, 0)],
  ])('resolves the next local refresh boundary after %s', (date, expected) => {
    expect(resolveNextDashboardGreetingBoundaryMs(date)).toBe(expected.getTime());
  });
});
