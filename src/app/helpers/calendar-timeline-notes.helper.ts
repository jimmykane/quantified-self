import { timelineNoteEnd, type TimelineNote, type TimelineNoteRange } from '@shared/timeline-notes';
import type { ActivityCalendarDayViewModel, ActivityCalendarViewModel } from './activity-calendar.helper';

export interface CalendarDayTimelineNotes {
  notes: readonly TimelineNote[];
  ariaLabel: string;
}

function visibleDays(model: ActivityCalendarViewModel): ActivityCalendarDayViewModel[] {
  return model.months.flatMap(month => month.days)
    .filter(day => model.view !== 'year' || day.inPrimaryPeriod);
}

/** Use the calendar's fixed date labels, including the month grid's adjacent days. */
export function calendarTimelineNoteRange(model: ActivityCalendarViewModel): TimelineNoteRange | null {
  const dates = visibleDays(model).map(day => day.dateKey).sort();
  return dates.length ? { startDate: dates[0], endDate: dates.at(-1)! } : null;
}

/** Notes never become activities or contribute to calendar totals/marker sizing. */
export function calendarTimelineNotesByDate(
  model: ActivityCalendarViewModel,
  notes: readonly TimelineNote[],
  nowMs = Date.now(),
): ReadonlyMap<string, CalendarDayTimelineNotes> {
  const periods = [...new Map(notes.map(note => [note.id, note])).values()]
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id))
    .map(note => ({ note, endDate: timelineNoteEnd(note, nowMs) }));
  const result = new Map<string, CalendarDayTimelineNotes>();
  for (const day of visibleDays(model)) {
    const matching = periods.filter(({ note, endDate }) => note.startDate <= day.dateKey && day.dateKey <= endDate)
      .map(({ note }) => note);
    if (matching.length) result.set(day.dateKey, {
      notes: matching,
      ariaLabel: `${day.ariaLabel}. ${matching.length} Timeline ${matching.length === 1 ? 'note' : 'notes'}.`,
    });
  }
  return result;
}
