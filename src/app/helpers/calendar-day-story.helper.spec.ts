import { DataDuration, type EventInterface } from '@sports-alliance/sports-lib';
import type { TimelineNote } from '@shared/timeline-notes';
import type { PlannedWorkoutCalendarEntry } from './planned-workout-calendar.helper';
import type { DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';
import { buildCalendarDayStory } from './calendar-day-story.helper';

const note: TimelineNote = {
  id: 'note-1', title: 'Travel', category: 'travel', startDate: '2026-09-15', endDate: '2026-09-16',
  timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1,
};
const plan = {
  workout: { id: 'plan-1', title: 'Easy run', lifecycle: 'planned', structure: { sport: 'Running' } },
  planName: 'Autumn plan', completed: false,
} as PlannedWorkoutCalendarEntry;
const sleepPoint = {
  id: 'sleep-1', sleepDate: '2026-09-15', providerLabel: 'Suunto',
  endTimeMs: new Date(2026, 8, 15, 7).getTime(),
} as DashboardSleepTrendPoint;
const activity = {
  startDate: new Date(2026, 8, 15, 10), name: 'Morning run', getID: () => 'activity-1',
  getStat: (type: string) => type === DataDuration.type ? { getValue: () => 3600 } : null,
  getActivityTypesAsString: () => 'Running',
} as EventInterface;
const health = {
  sleep: { status: 'ready' as const, value: '74/100', detail: 'Suunto · overnight score' },
  readiness: { status: 'empty' as const, value: '—', detail: 'No stored score' },
  hrv: { status: 'empty' as const, value: '—', detail: 'No HRV' }, recovery: null,
};
const base = {
  dateKey: '2026-09-15', locale: 'en-US', nowMs: new Date(2026, 8, 16, 12).getTime(),
  activityStatus: 'ready' as const, events: [activity], notes: [note],
  planStatus: 'ready' as const, plans: [plan], sleepPoint, health,
};

describe('buildCalendarDayStory', () => {
  it('orders dated items by actual time and leaves notes and plans without invented times', () => {
    const story = buildCalendarDayStory(base);
    expect(story.items.map(item => item.kind)).toEqual(['note', 'plan', 'sleep', 'activity']);
    expect(story.items.map(item => item.timeLabel)).toEqual(['All day', 'No time set', 'Woke 7:00 AM', '10:00 AM']);
    expect(story.items[2].detail).toBe('74/100 · Suunto');
    expect(story.items[3].detail).toBe('1h');
    expect(story.items[3].activityType).toBe('Running');
    expect(story.items[0].icon).toBeTruthy();
    expect(story.items[0].detail).toContain('Sep');
    expect(story.items[0].detail).not.toContain('2026-09');
    expect(story.highlights).toEqual([
      'Travel note on this day.', '1 planned workout without a linked activity.',
    ]);
  });

  it('shows factual activity context only after a successful read and does not flag future plans', () => {
    const pending = buildCalendarDayStory({ ...base, dateKey: '2026-09-17', activityStatus: 'loading',
      events: [], notes: [], sleepPoint: null, health: null });
    expect(pending.items.map(item => item.kind)).toEqual(['plan']);
    expect(pending.highlights).toEqual([]);
    const completed = buildCalendarDayStory({ ...base, notes: [], plans: [], sleepPoint: null, health: null });
    expect(completed.highlights).toEqual([]);
  });

  it('does not use sleep from a failed health state or imply a baseline', () => {
    const story = buildCalendarDayStory({ ...base, notes: [], plans: [], events: [],
      health: { ...health, sleep: { status: 'error', value: '—', detail: 'Could not load sleep' } },
    });
    expect(story.items).toEqual([]);
    expect(story.highlights).toEqual([]);
  });
});
