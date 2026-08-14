import { describe, expect, it } from 'vitest';
import {
  buildDashboardGreeting,
  getDashboardGreetingName,
  getDashboardGreetingPeriod,
  getNextDashboardGreetingRefreshTime,
} from './dashboard-greeting.helper';

describe('getDashboardGreetingPeriod', () => {
  it('returns morning from midnight until 11:59', () => {
    expect(getDashboardGreetingPeriod(new Date(2026, 7, 14, 0, 0))).toBe('morning');
    expect(getDashboardGreetingPeriod(new Date(2026, 7, 14, 11, 59, 59))).toBe('morning');
  });

  it('returns afternoon from 12:00 until 17:59', () => {
    expect(getDashboardGreetingPeriod(new Date(2026, 7, 14, 12, 0))).toBe('afternoon');
    expect(getDashboardGreetingPeriod(new Date(2026, 7, 14, 17, 59, 59))).toBe('afternoon');
  });

  it('returns evening from 18:00 until 23:59', () => {
    expect(getDashboardGreetingPeriod(new Date(2026, 7, 14, 18, 0))).toBe('evening');
    expect(getDashboardGreetingPeriod(new Date(2026, 7, 14, 23, 59, 59))).toBe('evening');
  });
});

describe('getDashboardGreetingName', () => {
  it('returns the first part of a multi-part display name', () => {
    expect(getDashboardGreetingName('Dimitrios Kanellopoulos')).toBe('Dimitrios');
  });

  it('trims surrounding whitespace before splitting', () => {
    expect(getDashboardGreetingName('  Morgan   Lee ')).toBe('Morgan');
  });

  it('returns null for null, undefined, empty, and whitespace-only names', () => {
    expect(getDashboardGreetingName(null)).toBeNull();
    expect(getDashboardGreetingName(undefined)).toBeNull();
    expect(getDashboardGreetingName('')).toBeNull();
    expect(getDashboardGreetingName('   ')).toBeNull();
  });
});

describe('buildDashboardGreeting', () => {
  it('combines the period greeting with the first name', () => {
    expect(buildDashboardGreeting(new Date(2026, 7, 14, 9, 30), 'Morgan Lee')).toBe('Good morning, Morgan');
    expect(buildDashboardGreeting(new Date(2026, 7, 14, 15, 0), 'Dimitrios')).toBe('Good afternoon, Dimitrios');
    expect(buildDashboardGreeting(new Date(2026, 7, 14, 21, 0), 'Alex')).toBe('Good evening, Alex');
  });

  it('falls back to the plain greeting without dangling punctuation when no usable name exists', () => {
    expect(buildDashboardGreeting(new Date(2026, 7, 14, 15, 0), null)).toBe('Good afternoon');
    expect(buildDashboardGreeting(new Date(2026, 7, 14, 15, 0), '   ')).toBe('Good afternoon');
    expect(buildDashboardGreeting(new Date(2026, 7, 14, 15, 0))).toBe('Good afternoon');
  });
});

describe('getNextDashboardGreetingRefreshTime', () => {
  it('targets 12:00 during the morning', () => {
    expect(getNextDashboardGreetingRefreshTime(new Date(2026, 7, 14, 8, 15)))
      .toEqual(new Date(2026, 7, 14, 12, 0, 0, 0));
  });

  it('targets 18:00 during the afternoon', () => {
    expect(getNextDashboardGreetingRefreshTime(new Date(2026, 7, 14, 12, 0)))
      .toEqual(new Date(2026, 7, 14, 18, 0, 0, 0));
  });

  it('targets the next midnight during the evening so the date subtitle also refreshes', () => {
    expect(getNextDashboardGreetingRefreshTime(new Date(2026, 7, 14, 23, 59)))
      .toEqual(new Date(2026, 7, 15, 0, 0, 0, 0));
  });

  it('rolls over month boundaries at midnight', () => {
    expect(getNextDashboardGreetingRefreshTime(new Date(2026, 7, 31, 22, 0)))
      .toEqual(new Date(2026, 8, 1, 0, 0, 0, 0));
  });
});
