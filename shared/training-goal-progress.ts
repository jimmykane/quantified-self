import { trainingGoalMatchesSport, type TrainingGoalV1 } from './training-goals';
import { normalizeTrainingLocalDate } from './training-plans';

export interface TrainingGoalProgressActivity {
  /** Internal grouping only. Never exposed by the progress response. */
  recordingId: string;
  activityId: string;
  recordingStartMs: number;
  sport: string;
  duration: number | null;
  distance: number | null;
}
export interface TrainingGoalProgress {
  goalId: string;
  goalRevision: number;
  startLocalDate: string;
  endLocalDate: string;
  partialWeek: boolean;
  value: number;
  target: number;
  kind: 'workouts' | 'days' | 'duration' | 'distance';
  complete: boolean;
  met: boolean;
}
export function trainingGoalWeek(localDate: string, weekStartsOn: number): { startLocalDate: string; endLocalDate: string } {
  normalizeTrainingLocalDate(localDate);
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) throw Error('Choose a valid week start.');
  const date = new Date(`${localDate}T00:00:00Z`);
  const start = date.getTime() - ((date.getUTCDay() - weekStartsOn + 7) % 7) * 86400000;
  return { startLocalDate: new Date(start).toISOString().slice(0, 10), endLocalDate: new Date(start + 6 * 86400000).toISOString().slice(0, 10) };
}
export function calculateTrainingGoalProgress(input: { goals: TrainingGoalV1[]; activities: TrainingGoalProgressActivity[];
  localDate: string; timeZone: string; weekStartsOn: number; complete: boolean }): TrainingGoalProgress[] {
  const week = trainingGoalWeek(input.localDate, input.weekStartsOn);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const activities = [...new Map(input.activities.map(activity => [activity.activityId, activity])).values()].map(activity => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(activity.recordingStartMs)).map(part => [part.type, part.value]));
    return { ...activity, localDate: `${parts.year}-${parts.month}-${parts.day}` };
  });
  return input.goals.filter(goal => goal.weeklyTarget && goal.startLocalDate <= input.localDate).map(goal => {
    const startLocalDate = goal.startLocalDate > week.startLocalDate ? goal.startLocalDate : week.startLocalDate;
    const selected = activities.filter(activity => activity.localDate >= startLocalDate && activity.localDate <= week.endLocalDate
      && activity.localDate <= input.localDate && trainingGoalMatchesSport(goal, activity.sport));
    const target = goal.weeklyTarget!;
    let complete = input.complete;
    const value = target.kind === 'workouts' ? new Set(selected.map(activity => activity.recordingId)).size
      : target.kind === 'days' ? new Set(selected.map(activity => activity.localDate)).size
        : selected.reduce((sum, activity) => {
          const metric = activity[target.kind as 'duration' | 'distance'];
          if (metric === null || !Number.isFinite(metric) || metric < 0) { complete = false; return sum; }
          return sum + metric;
        }, 0);
    return { goalId: goal.id, goalRevision: goal.revision, startLocalDate, endLocalDate: week.endLocalDate,
      partialWeek: startLocalDate !== week.startLocalDate, value, target: target.value, kind: target.kind,
      complete, met: complete && value >= target.value };
  });
}
