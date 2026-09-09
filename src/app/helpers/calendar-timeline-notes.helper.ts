import { isTimelineNoteVisible, timelineNoteEnd, type TimelineNote, type TimelineNoteRange } from '@shared/timeline-notes';
import type { ActivityCalendarDayViewModel, ActivityCalendarViewModel } from './activity-calendar.helper';
import { TIMELINE_NOTE_ICONS, timelineNoteColor, timelineNoteGroupColor } from './timeline-note-appearance.helper';

export interface CalendarDayTimelineNotes {
  notes: readonly TimelineNote[];
  ariaLabel: string;
  icon: string;
  color: string | null;
  accentColors: readonly (string | null)[];
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
    .filter(isTimelineNoteVisible)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id))
    .map(note => ({ note, endDate: timelineNoteEnd(note, nowMs) }));
  const result = new Map<string, CalendarDayTimelineNotes>();
  for (const day of visibleDays(model)) {
    const matching = periods.filter(({ note, endDate }) => note.startDate <= day.dateKey && day.dateKey <= endDate)
      .map(({ note }) => note);
    if (matching.length) result.set(day.dateKey, {
      notes: matching,
      icon: matching.length === 1 ? TIMELINE_NOTE_ICONS[matching[0].category] : 'event_note',
      color: timelineNoteGroupColor(matching),
      // One segment per distinct palette colour, never a blend or an activity marker.
      accentColors: [...new Set(matching.map(timelineNoteColor))],
      ariaLabel: `${day.ariaLabel}. ${matching.length} Timeline ${matching.length === 1 ? 'note' : 'notes'}.`,
    });
  }
  return result;
}
