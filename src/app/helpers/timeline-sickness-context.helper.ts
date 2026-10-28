import { isTimelineNoteVisible, timelineToday, type TimelineNote, type TimelineNoteRange } from '@shared/timeline-notes';
import { getDateTimeFormatter } from './date-time-format.helper';
import { getNumberFormatter } from './number-format.helper';

/** Calendar dates belong to each note's captured timezone, not the viewer's timezone. */
export function activeSicknessNotes(notes: readonly TimelineNote[], nowMs: number): TimelineNote[] {
  const todayByZone = new Map<string, string>();
  return notes.filter(note => {
    if (note.category !== 'sickness' || !isTimelineNoteVisible(note)) return false;
    let today = todayByZone.get(note.timeZone);
    if (!today) { today = timelineToday(note.timeZone, nowMs); todayByZone.set(note.timeZone, today); }
    return note.startDate <= today && (note.endDate === null || note.endDate >= today);
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}

/** Covers today in every captured timezone, including UTC-12 and UTC+14. */
export function currentSicknessNoteRange(nowMs: number): TimelineNoteRange {
  const day = 86_400_000;
  return { startDate: timelineToday('UTC', nowMs - day), endDate: timelineToday('UTC', nowMs + day) };
}

export function sicknessNoteLabel(notes: readonly TimelineNote[], nowMs: number, locale?: string): string {
  if (!notes.length) return '';
  const start = notes.map(note => note.startDate).sort()[0];
  const year = start.slice(0, 4) !== timelineToday(notes[0].timeZone, nowMs).slice(0, 4);
  const date = getDateTimeFormatter(locale, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
    .format(Date.parse(`${start}T00:00:00Z`));
  const label = notes.length === 1 ? 'Sickness noted' : `${getNumberFormatter(locale).format(notes.length)} sickness notes`;
  return `${label} · since ${date}`;
}
