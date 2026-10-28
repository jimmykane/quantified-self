import { afterEach, describe, expect, it, vi } from 'vitest';
import 'dayjs/locale/en-gb';
import { TimelineNoteDateAdapter, timelineNoteDateInput, timelineNoteDateLabel } from './timeline-note-date-adapter';

describe('Timeline note Material dates', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps calendar carriers independent of the browser time zone, including skipped local dates', () => {
    const adapter = new TimelineNoteDateAdapter('en-GB');
    for (const label of ['2011-12-30', '2026-03-29', '2026-10-25']) {
      const input = timelineNoteDateInput(label);
      expect(input.isUTC()).toBe(true);
      expect(timelineNoteDateLabel(input)).toBe(label);
    }
    expect(timelineNoteDateLabel(adapter.createDate(2011, 11, 30))).toBe('2011-12-30');
    expect(timelineNoteDateLabel(adapter.parse('30/12/2011', 'L'))).toBe('2011-12-30');
  });
  it('highlights today in the captured note zone, not the browser zone', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T12:30:00Z'));
    const adapter = new TimelineNoteDateAdapter('en-US');
    adapter.timeZone = 'Pacific/Kiritimati';
    expect(timelineNoteDateLabel(adapter.today())).toBe('2026-09-09');
    adapter.timeZone = 'Pacific/Honolulu';
    expect(timelineNoteDateLabel(adapter.today())).toBe('2026-09-08');
  });
  it('uses localized input while rejecting impossible dates instead of rolling them forward', () => {
    const adapter = new TimelineNoteDateAdapter('en-GB');
    expect(timelineNoteDateLabel(adapter.parse('29/02/2024', 'L'))).toBe('2024-02-29');
    for (const invalid of ['29/02/2023', '31/04/2026', 'garbage']) {
      expect(timelineNoteDateLabel(adapter.parse(invalid, 'L'))).toBe('');
    }
    expect(adapter.parse('', 'L')).toBeNull();
  });
  it('keeps numeric input ordering when another picker changes the global locale', () => {
    const british = new TimelineNoteDateAdapter('en-GB');
    const american = new TimelineNoteDateAdapter('en-US');
    expect(timelineNoteDateLabel(british.parse('09/08/2026', 'L'))).toBe('2026-08-09');
    expect(timelineNoteDateLabel(american.parse('09/08/2026', 'L'))).toBe('2026-09-08');
  });
  it.each(['2024-02-29', '2026-03-29', '2026-10-25', '2027-01-01'])('round-trips fixed labels without UTC conversion: %s', label => {
    expect(timelineNoteDateLabel(timelineNoteDateInput(label))).toBe(label);
  });
});
