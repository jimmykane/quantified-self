import type { TimelineNote } from '@shared/timeline-notes';
import { TIMELINE_NOTE_LABELS } from '@shared/timeline-notes';
import type { EventInterface } from '@sports-alliance/sports-lib';
import type { DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';
import type { CalendarDayHealthSummary } from './calendar-day-health.helper';
import type { PlannedWorkoutCalendarEntry } from './planned-workout-calendar.helper';
import {
  formatActivityCalendarDuration,
  resolveActivityCalendarEventDurationSeconds,
  resolveActivityCalendarEventLabel,
  resolveEventStartDate,
} from './activity-calendar.helper';
import { getDateTimeFormatter } from './date-time-format.helper';
import { TIMELINE_NOTE_ICONS, timelineNoteColor } from './timeline-note-appearance.helper';

export interface CalendarDayStoryItem {
  key: string;
  kind: 'sleep' | 'activity' | 'note' | 'plan';
  id: string;
  title: string;
  detail: string;
  timeLabel: string;
  timeMs: number | null;
  icon: string;
  activityType?: string;
  color?: string;
}

export interface CalendarDayStory {
  items: CalendarDayStoryItem[];
  highlights: string[];
}

interface CalendarDayStoryInput {
  dateKey: string;
  locale?: string;
  nowMs: number;
  activityStatus: 'loading' | 'ready' | 'error';
  events: readonly EventInterface[];
  notes: readonly TimelineNote[];
  planStatus: 'loading' | 'ready' | 'error';
  plans: readonly PlannedWorkoutCalendarEntry[];
  sleepPoint: DashboardSleepTrendPoint | null;
  health: CalendarDayHealthSummary | null;
}

/** A selected-day projection only. Date-only notes and plans never acquire invented times. */
export function buildCalendarDayStory(input: CalendarDayStoryInput): CalendarDayStory {
  const formatTime = getDateTimeFormatter(input.locale, { hour: 'numeric', minute: '2-digit' });
  const items: CalendarDayStoryItem[] = [];
  if (input.sleepPoint && input.health?.sleep.status === 'ready') {
    const timeMs = Number.isFinite(input.sleepPoint.endTimeMs) ? input.sleepPoint.endTimeMs : null;
    items.push({
      key: `sleep:${input.sleepPoint.id}`, kind: 'sleep', id: input.sleepPoint.id,
      title: 'Overnight sleep',
      detail: `${input.health.sleep.value} · ${input.sleepPoint.providerLabel}`,
      timeLabel: timeMs === null ? 'Overnight' : `Woke ${formatTime.format(timeMs)}`,
      timeMs, icon: 'bedtime',
    });
  }
  if (input.activityStatus === 'ready') {
    input.events.forEach((event, index) => {
      const start = resolveEventStartDate(event);
      const seconds = resolveActivityCalendarEventDurationSeconds(event);
      const id = `${event.getID?.() || ''}`;
      items.push({
        key: `activity:${id || index}`, kind: 'activity', id,
        title: resolveActivityCalendarEventLabel(event),
        detail: seconds === null ? 'Duration unavailable' : formatActivityCalendarDuration(seconds),
        timeLabel: start ? formatTime.format(start) : 'Time unavailable',
        timeMs: start?.getTime() ?? null, icon: 'fitness_center',
        activityType: `${event.getActivityTypesAsString?.() || ''}`,
      });
    });
  }
  for (const note of input.notes) {
    items.push({
      key: `note:${note.id}`, kind: 'note', id: note.id, title: note.title,
      detail: `${TIMELINE_NOTE_LABELS[note.category]} · ${formatNoteDates(note, input.dateKey, input.locale)}`,
      timeLabel: 'All day', timeMs: null, icon: TIMELINE_NOTE_ICONS[note.category], color: timelineNoteColor(note),
    });
  }
  if (input.planStatus === 'ready') {
    for (const plan of input.plans) {
      items.push({
        key: `plan:${plan.workout.id}`, kind: 'plan', id: plan.workout.id,
        title: plan.workout.title,
        detail: `${plan.planName || 'Standalone'} · ${plan.completed ? 'Activity linked' : plan.workout.lifecycle === 'skipped' ? 'Skipped' : 'Planned'}`,
        timeLabel: 'Date only', timeMs: null, icon: 'event_available',
        activityType: plan.workout.structure.sport, color: plan.color,
      });
    }
  }
  const kindOrder: Record<CalendarDayStoryItem['kind'], number> = { note: 0, plan: 1, sleep: 2, activity: 3 };
  items.sort((left, right) => {
    if (left.timeMs === null || right.timeMs === null) {
      if (left.timeMs === null && right.timeMs === null) return kindOrder[left.kind] - kindOrder[right.kind]
        || left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
      return left.timeMs === null ? -1 : 1;
    }
    return left.timeMs - right.timeMs || kindOrder[left.kind] - kindOrder[right.kind] || left.key.localeCompare(right.key);
  });

  const highlights: string[] = [];
  if (input.notes.length) {
    highlights.push(input.notes.length === 1
      ? `${TIMELINE_NOTE_LABELS[input.notes[0].category]} note on this day.`
      : `${input.notes.length} Timeline notes on this day.`);
  }
  if (input.planStatus === 'ready' && input.dateKey < localDateKey(input.nowMs)) {
    const unlinked = input.plans.filter(plan => !plan.completed && plan.workout.lifecycle === 'planned').length;
    if (unlinked) highlights.push(`${unlinked} planned workout${unlinked === 1 ? '' : 's'} without a linked activity.`);
  }
  return { items, highlights: highlights.slice(0, 2) };
}

function localDateKey(nowMs: number): string {
  const date = new Date(nowMs);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function formatNoteDates(note: TimelineNote, selectedDateKey: string, locale?: string): string {
  const showYear = note.startDate.slice(0, 4) !== selectedDateKey.slice(0, 4)
    || (note.endDate !== null && note.endDate.slice(0, 4) !== selectedDateKey.slice(0, 4));
  const formatter = getDateTimeFormatter(locale, { day: 'numeric', month: 'short', ...(showYear ? { year: 'numeric' as const } : {}) });
  const start = new Date(`${note.startDate}T12:00:00`);
  if (!note.endDate) return `Since ${formatter.format(start)}`;
  const end = new Date(`${note.endDate}T12:00:00`);
  return note.startDate === note.endDate ? formatter.format(start) : formatter.formatRange(start, end);
}
