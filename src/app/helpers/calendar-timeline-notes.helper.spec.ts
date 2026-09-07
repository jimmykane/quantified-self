import { describe, expect, it } from 'vitest';
import type { TimelineNote } from '@shared/timeline-notes';
import { buildActivityCalendarViewModel } from './activity-calendar.helper';
import { calendarTimelineNoteRange, calendarTimelineNotesByDate } from './calendar-timeline-notes.helper';

const note: TimelineNote = { id: 'a'.repeat(64), category: 'travel', title: '<b>Private context</b>', startDate: '2024-02-28', endDate: '2024-03-01', timeZone: 'Pacific/Honolulu', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
const model = (view: 'week' | 'month' | 'year' = 'month') => buildActivityCalendarViewModel([], {
  view, anchorDate: new Date(2024, 1, 28), locale: 'en-US',
});

describe('calendar Timeline note projection', () => {
  it('covers the exact visible date labels, including adjacent month days but not hidden year cells', () => {
    for (const view of ['week', 'month', 'year'] as const) {
      const calendar = model(view);
      const days = calendar.months.flatMap(month => month.days).filter(day => view !== 'year' || day.inPrimaryPeriod);
      const dates = days.map(day => day.dateKey).sort();
      expect(calendarTimelineNoteRange(calendar)).toEqual({ startDate: dates[0], endDate: dates.at(-1) });
    }
    expect(calendarTimelineNoteRange(model('year'))).toEqual({ startDate: '2024-01-01', endDate: '2024-12-31' });
  });
  it('includes leap days and inclusive endpoints without moving dates to the viewer timezone or changing totals', () => {
    const calendar = model();
    const before = structuredClone(calendar);
    const result = calendarTimelineNotesByDate(calendar, [note]);
    expect([...result.keys()]).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(result.get('2024-02-29')?.ariaLabel).toContain('1 Timeline note');
    expect(result.get('2024-02-29')?.ariaLabel).not.toContain(note.title);
    expect(calendar).toEqual(before);
  });
  it('includes periods starting before the window and future bounded notes, deduplicating overlaps', () => {
    const long = { ...note, startDate: '2023-01-01', endDate: '2025-01-01' };
    const future = { ...note, id: 'b'.repeat(64), startDate: '2024-02-29', endDate: '2024-02-29' };
    const result = calendarTimelineNotesByDate(model(), [long, long, future], Date.parse('2024-01-01T00:00:00Z'));
    expect(result.get('2024-02-29')?.notes).toEqual([future, long]);
    expect(result.get('2024-02-29')?.ariaLabel).toContain('2 Timeline notes');
  });
  it('stops ongoing notes at today in their captured zone, not at the visible period end', () => {
    const result = calendarTimelineNotesByDate(model(), [{ ...note, endDate: null }], Date.parse('2024-03-01T03:00:00Z'));
    expect([...result.keys()]).toEqual(['2024-02-28', '2024-02-29']);
    expect(calendarTimelineNotesByDate(model(), []).size).toBe(0);
  });
});
