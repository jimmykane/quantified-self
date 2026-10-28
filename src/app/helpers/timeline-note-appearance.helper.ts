import { type TimelineNoteCategory, type TimelineNoteColor, type TimelineNoteFields } from '@shared/timeline-notes';
import { AppColors } from '../services/color/app.colors';

export const TIMELINE_NOTE_ICONS: Record<TimelineNoteCategory, string> = {
  sickness: 'sick', injury: 'healing', vacation: 'beach_access', travel: 'flight', stress: 'psychology', other: 'event_note',
};
export const TIMELINE_NOTE_COLOR_LABELS: Record<TimelineNoteColor, string> = {
  default: 'Default', blue: 'Blue', purple: 'Purple', pink: 'Pink', orange: 'Orange', red: 'Red', green: 'Green',
};
// Explicit palette colour for canvas and DOM consumers: inheriting text/primary
// colours made the same Default note look different in charts and Calendar.
export const TIMELINE_NOTE_DEFAULT_COLOR = AppColors.DarkGray;
const COLORS: Record<TimelineNoteColor, string> = {
  default: TIMELINE_NOTE_DEFAULT_COLOR, blue: AppColors.Blue, purple: AppColors.Purple, pink: AppColors.Pink,
  orange: AppColors.StrongOrange, red: AppColors.LightRed, green: AppColors.Green,
};

export function timelineNoteColor(note: Pick<TimelineNoteFields, 'color'>): string {
  return COLORS[note.color ?? 'default'] ?? TIMELINE_NOTE_DEFAULT_COLOR;
}

/** Mixed groups stay neutral: never blend colors or imply that one note represents the others. */
export function timelineNoteGroupColor(notes: readonly Pick<TimelineNoteFields, 'color'>[]): string {
  const colors = new Set(notes.map(timelineNoteColor));
  return colors.size === 1 ? [...colors][0] : TIMELINE_NOTE_DEFAULT_COLOR;
}
