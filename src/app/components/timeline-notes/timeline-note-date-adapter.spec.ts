import { describe, expect, it } from 'vitest';
import 'dayjs/locale/en-gb';
import { TimelineNoteDateAdapter, timelineNoteDateInput, timelineNoteDateLabel } from './timeline-note-date-adapter';

describe('Timeline note Material dates', () => {
  it('uses localized input while rejecting impossible dates instead of rolling them forward', () => {
    const adapter = new TimelineNoteDateAdapter('en-GB');
    expect(timelineNoteDateLabel(adapter.parse('29/02/2024', 'L'))).toBe('2024-02-29');
    for (const invalid of ['29/02/2023', '31/04/2026', 'garbage']) {
      expect(timelineNoteDateLabel(adapter.parse(invalid, 'L'))).toBe('');
    }
    expect(adapter.parse('', 'L')).toBeNull();
  });
  it.each(['2024-02-29', '2026-03-29', '2026-10-25', '2027-01-01'])('round-trips fixed labels without UTC conversion: %s', label => {
    expect(timelineNoteDateLabel(timelineNoteDateInput(label))).toBe(label);
  });
});
