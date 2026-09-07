/** Private calendar context, never a metric, provider record, or workout. */
export const TIMELINE_NOTES_COLLECTION = 'timelineNotes';
export const TIMELINE_NOTE_DELETIONS_COLLECTION = 'timelineNoteDeletions';
export const TIMELINE_NOTE_CATEGORIES = ['sickness', 'injury', 'vacation', 'travel', 'stress', 'other'] as const;
export type TimelineNoteCategory = typeof TIMELINE_NOTE_CATEGORIES[number];
export const TIMELINE_NOTE_LABELS: Record<TimelineNoteCategory, string> = {
  sickness: 'Sickness', injury: 'Injury', vacation: 'Vacation', travel: 'Travel', stress: 'Stress', other: 'Other',
};
export const TIMELINE_NOTE_LIMITS = { page: 64, records: 512, bytes: 2 * 1024 * 1024, title: 120, details: 2_000 } as const;
export interface TimelineNoteFields {
  category: TimelineNoteCategory;
  title: string;
  details?: string;
  startDate: string;
  /** Inclusive; equal to startDate for a single day, null for an ongoing period. */
  endDate: string | null;
  timeZone: string;
}
export interface TimelineNote extends TimelineNoteFields {
  id: string;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
}
export type SaveTimelineNoteRequest = TimelineNoteFields & (
  { mode: 'create'; clientMutationId: string } | { mode: 'update'; noteId: string; expectedRevision: number }
);
export interface DeleteTimelineNoteRequest { noteId: string; expectedRevision: number }
export interface TimelineNoteRange { startDate: string; endDate: string }
export interface TimelineNotesLoad {
  notes: TimelineNote[];
  incomplete: 'records' | 'bytes' | null;
}
export class TimelineNoteValidationError extends Error { override name = 'TimelineNoteValidationError'; }

export function isTimelineDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function timelineToday(timeZone: string, nowMs = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(nowMs));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function validateTimelineFields(value: Record<string, unknown>, nowMs = Date.now()): TimelineNoteFields {
  if (!(TIMELINE_NOTE_CATEGORIES as readonly unknown[]).includes(value.category)) throw new TimelineNoteValidationError('Choose a note category.');
  const text = (value: unknown, maximum: number, required: boolean): string => {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())
      || [...value].some(character => {
        const code = character.charCodeAt(0);
        return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
      })) {
      throw new TimelineNoteValidationError('Note text is missing, too long, or contains unsupported characters.');
    }
    return value.trim();
  };
  const title = text(value.title, TIMELINE_NOTE_LIMITS.title, true);
  const details = value.details === undefined ? '' : text(value.details, TIMELINE_NOTE_LIMITS.details, false);
  if (!isTimelineDate(value.startDate) || (value.endDate !== null && !isTimelineDate(value.endDate))
    || (typeof value.endDate === 'string' && value.endDate < value.startDate)) {
    throw new TimelineNoteValidationError('Choose valid dates with the end on or after the start.');
  }
  if (typeof value.timeZone !== 'string' || !value.timeZone || value.timeZone.length > 100) {
    throw new TimelineNoteValidationError('Choose a valid time zone.');
  }
  let today: string;
  try { today = timelineToday(value.timeZone, nowMs); } catch { throw new TimelineNoteValidationError('Choose a valid time zone.'); }
  if (value.endDate === null && value.startDate > today) throw new TimelineNoteValidationError('An ongoing period must already have started.');
  return { category: value.category as TimelineNoteCategory, title, ...(details ? { details } : {}),
    startDate: value.startDate, endDate: value.endDate as string | null, timeZone: value.timeZone };
}

export function decodeTimelineNote(id: string, value: unknown): TimelineNote | null {
  if (!/^[a-f0-9]{64}$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 1
    || !Number.isSafeInteger(data.createdAtMs) || Number(data.createdAtMs) < 0
    || !Number.isSafeInteger(data.updatedAtMs) || Number(data.updatedAtMs) < Number(data.createdAtMs)) return null;
  try {
    // An old ongoing record stays readable even if this device's clock moves backwards.
    const fields = validateTimelineFields({ ...data, endDate: data.endDate ?? data.startDate });
    if (data.endDate !== null && !isTimelineDate(data.endDate)) return null;
    return { ...fields, endDate: data.endDate as string | null, id,
      revision: Number(data.revision), createdAtMs: Number(data.createdAtMs), updatedAtMs: Number(data.updatedAtMs) };
  } catch { return null; }
}

export function timelineNoteEnd(note: TimelineNoteFields, nowMs = Date.now()): string {
  return note.endDate ?? timelineToday(note.timeZone, nowMs);
}
export function timelineNoteOverlaps(note: TimelineNoteFields, range: TimelineNoteRange, nowMs = Date.now()): boolean {
  return note.startDate <= range.endDate && timelineNoteEnd(note, nowMs) >= range.startDate;
}
export function timelineNoteDates(note: TimelineNoteFields): string {
  return note.endDate === null ? `${note.startDate} – ongoing`
    : note.endDate === note.startDate ? note.startDate : `${note.startDate} – ${note.endDate}`;
}
