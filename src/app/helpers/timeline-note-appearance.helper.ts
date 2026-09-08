import { type TimelineNoteCategory, type TimelineNoteColor, type TimelineNoteFields } from '@shared/timeline-notes';
import { AppColors } from '../services/color/app.colors';

export const TIMELINE_NOTE_ICONS: Record<TimelineNoteCategory, string> = {
  sickness: 'sick', injury: 'healing', vacation: 'beach_access', travel: 'flight', stress: 'psychology', other: 'event_note',
};
export const TIMELINE_NOTE_COLOR_LABELS: Record<TimelineNoteColor, string> = {
  default: 'Default', blue: 'Blue', purple: 'Purple', pink: 'Pink', orange: 'Orange', red: 'Red', green: 'Green',
};
const COLORS: Record<TimelineNoteColor, string | null> = {
  default: null, blue: AppColors.Blue, purple: AppColors.Purple, pink: AppColors.Pink,
  orange: AppColors.StrongOrange, red: AppColors.LightRed, green: AppColors.Green,
};

export function timelineNoteColor(note: Pick<TimelineNoteFields, 'color'>): string | null {
  return COLORS[note.color ?? 'default'] ?? null;
}

/** Mixed groups stay neutral: never blend colors or imply that one note represents the others. */
export function timelineNoteGroupColor(notes: readonly Pick<TimelineNoteFields, 'color'>[]): string | null {
  const colors = new Set(notes.map(timelineNoteColor));
  return colors.size === 1 ? [...colors][0] : null;
}
