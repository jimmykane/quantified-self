import { describe, expect, it } from 'vitest';
import {
  chunkCOROSInclusiveDateRange,
  chunkCOROSInclusiveTimestampRange,
  formatCOROSCalendarDate,
  parseCOROSCalendarDate,
  subtractUTCMonthsClamped,
} from './date-range';

describe('COROS calendar date ranges', () => {
  it('creates inclusive non-overlapping windows with at most 30 calendar dates', () => {
    const windows = chunkCOROSInclusiveDateRange('2026-01-01', '2026-02-09');

    expect(windows.map(window => [
      formatCOROSCalendarDate(window.startDate),
      formatCOROSCalendarDate(window.endDate),
    ])).toEqual([
      ['20260101', '20260130'],
      ['20260131', '20260209'],
    ]);
  });

  it('handles one, 30, and 31 date ranges without repeating a boundary', () => {
    expect(chunkCOROSInclusiveDateRange('2026-03-10', '2026-03-10')).toHaveLength(1);
    expect(chunkCOROSInclusiveDateRange('2026-03-01', '2026-03-30')).toHaveLength(1);
    const windows = chunkCOROSInclusiveDateRange('2026-03-01', '2026-03-31');
    expect(windows).toHaveLength(2);
    expect(formatCOROSCalendarDate(windows[0].endDate)).toBe('20260330');
    expect(formatCOROSCalendarDate(windows[1].startDate)).toBe('20260331');
  });

  it('uses UTC calendar arithmetic across leap days and DST-adjacent timestamps', () => {
    const windows = chunkCOROSInclusiveDateRange(
      '2024-02-29T23:30:00.000Z',
      '2024-03-31T00:30:00.000Z',
    );
    expect(windows.map(window => [
      formatCOROSCalendarDate(window.startDate),
      formatCOROSCalendarDate(window.endDate),
    ])).toEqual([
      ['20240229', '20240329'],
      ['20240330', '20240331'],
    ]);
  });

  it('returns UTC-midnight timestamp windows for COROS queue payloads', () => {
    expect(chunkCOROSInclusiveTimestampRange(
      Date.parse('2026-01-01T12:45:00.000Z'),
      Date.parse('2026-01-31T22:10:00.000Z'),
    )).toEqual([
      { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 30) },
      { startMs: Date.UTC(2026, 0, 31), endMs: Date.UTC(2026, 0, 31) },
    ]);
  });

  it('strictly validates date-only strings and clamps month subtraction', () => {
    expect(parseCOROSCalendarDate('2026-02-30')).toBeNull();
    expect(parseCOROSCalendarDate(null)).toBeNull();
    expect(parseCOROSCalendarDate(true)).toBeNull();
    expect(formatCOROSCalendarDate(subtractUTCMonthsClamped(
      new Date('2026-05-31T12:00:00.000Z'),
      3,
    ))).toBe('20260228');
  });
});
