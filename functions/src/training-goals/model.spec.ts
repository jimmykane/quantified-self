import { describe, expect, it } from 'vitest';
import { ActivityTypes, ActivityTypeGroups } from '@sports-alliance/sports-lib';
import { parseTrainingGoalV1, relevantTrainingGoals, trainingGoalMarkers, trainingGoalMatchesSport, type TrainingGoalV1 } from '../../../shared/training-goals';
import { calculateTrainingGoalProgress, trainingGoalWeek, type TrainingGoalProgressActivity } from '../../../shared/training-goal-progress';

const goal = (patch: Partial<TrainingGoalV1> = {}): TrainingGoalV1 => ({ schemaVersion: 1, id: 'goal', name: 'Run consistently',
  kind: 'ongoing', lifecycle: 'active', priority: 'normal', startLocalDate: '2026-10-01', targetLocalDate: null,
  sportScope: 'sport', sport: ActivityTypes.Running, objective: '', planId: null, weeklyTarget: { kind: 'workouts', value: 3 },
  revision: 1, createdAtMs: 1, updatedAtMs: 1, ...patch });
const activity = (id: string, time: string, patch: Partial<TrainingGoalProgressActivity> = {}): TrainingGoalProgressActivity => ({
  recordingId: id, activityId: id, recordingStartMs: Date.parse(time), sport: ActivityTypes.Running, duration: 1800, distance: 5000, ...patch });
describe('Training goals', () => {
  it('rejects ASCII control characters while preserving multiline objectives', () => {
    for (let code = 0; code < 32; code++) {
      const objective = `Before${String.fromCharCode(code)}after`;
      if ([9, 10, 13].includes(code)) expect(parseTrainingGoalV1(goal({ objective })).objective).toBe(objective);
      else expect(() => parseTrainingGoalV1(goal({ objective }))).toThrow('Invalid goal text.');
    }
  });
  it('strictly round trips stored goals and rejects unexpected or inconsistent fields', () => {
    expect(parseTrainingGoalV1(goal(), 'goal')).toEqual(goal());
    for (const patch of [{ uid: 'private' }, { kind: 'event' }, { revision: 0 }, { sport: 'invented' },
      { weeklyTarget: { kind: 'days', value: 8 } }, { startLocalDate: '2026-02-30' }]) {
      expect(() => parseTrainingGoalV1({ ...goal(), ...patch })).toThrow();
    }
    expect(() => parseTrainingGoalV1(goal(), 'other')).toThrow();
  });
  it('sorts active relevant goals by priority then target and preserves multiple goals', () => {
    const event = goal({ id: 'race', kind: 'event', targetLocalDate: '2026-11-07', weeklyTarget: null });
    expect(relevantTrainingGoals([goal({ id: 'paused', lifecycle: 'paused' }), goal(), event,
      goal({ id: 'high', priority: 'high' }), goal({ id: 'bike', sport: ActivityTypes.Cycling })], '2026-11-03', ActivityTypes.Running)
      .map(item => item.id)).toEqual(['high', 'race', 'goal']);
    expect(relevantTrainingGoals([event], '2026-11-08', ActivityTypes.Running)).toEqual([]);
  });
  it('marks fixed event dates and only the ongoing start, grouping goals and omitting archives', () => {
    const marks = trainingGoalMarkers([goal(), goal({ id: 'event', kind: 'event', startLocalDate: '2026-10-01', targetLocalDate: '2026-11-08', weeklyTarget: null }),
      goal({ id: 'second', lifecycle: 'paused' }), goal({ id: 'hidden', lifecycle: 'archived' })]);
    expect(Object.keys(marks).sort()).toEqual(['2026-10-01', '2026-11-08']);
    expect(marks['2026-10-01'].count).toBe(2); expect(marks['2026-11-08'].count).toBe(1);
  });
  it('uses canonical sport families', () => {
    expect(trainingGoalMatchesSport(goal({ sportScope: 'family', sport: ActivityTypeGroups.RunningGroup }), ActivityTypes.Running)).toBe(true);
    expect(trainingGoalMatchesSport(goal({ sportScope: 'family', sport: ActivityTypeGroups.RunningGroup }), ActivityTypes.Cycling)).toBe(false);
  });
  it('uses the configured week start and correct year rollover', () => {
    expect(trainingGoalWeek('2026-01-01', 1)).toEqual({ startLocalDate: '2025-12-29', endLocalDate: '2026-01-04' });
    expect(trainingGoalWeek('2026-11-01', 0).startLocalDate).toBe('2026-11-01');
  });
  it('distinguishes workouts, days and multisport contributions, and deduplicates child records', () => {
    const activities = [activity('one', '2026-11-02T08:00Z'), activity('two', '2026-11-02T18:00Z'),
      activity('leg', '2026-11-02T08:00Z', { recordingId: 'one', sport: ActivityTypes.Cycling }), activity('one', '2026-11-02T08:00Z')];
    const results = calculateTrainingGoalProgress({ goals: ['workouts', 'days', 'duration', 'distance'].map(kind =>
      goal({ weeklyTarget: { kind: kind as 'workouts', value: 3 } })), activities,
    localDate: '2026-11-03', timeZone: 'Europe/Athens', weekStartsOn: 1, complete: true });
    expect(results.map(result => result.value)).toEqual([2, 1, 3600, 10000]);
  });
  it('buckets DST instants and labels partial weeks without treating missing metrics as zero', () => {
    const results = calculateTrainingGoalProgress({ goals: [goal({ startLocalDate: '2026-10-25', weeklyTarget: { kind: 'duration', value: 100 } })],
      activities: [activity('one', '2026-10-24T22:30Z', { duration: null }), activity('two', '2026-10-25T02:00Z')],
      localDate: '2026-10-25', timeZone: 'Europe/Athens', weekStartsOn: 1, complete: true });
    expect(results[0]).toMatchObject({ value: 1800, complete: false, met: false, partialWeek: true, startLocalDate: '2026-10-25' });
  });
  it('does not call an incomplete import a met target', () => {
    expect(calculateTrainingGoalProgress({ goals: [goal({ weeklyTarget: { kind: 'workouts', value: 1 } })],
      activities: [activity('one', '2026-11-02T08:00Z')], localDate: '2026-11-03', timeZone: 'UTC', weekStartsOn: 1,
      complete: false })[0]).toMatchObject({ value: 1, met: false, complete: false });
  });
  it('starts weekly progress on the goal start date, even when it begins in the current week', () => {
    const input = { goals: [goal({ startLocalDate: '2026-11-05' })],
      activities: [activity('before', '2026-11-04T08:00Z'), activity('start', '2026-11-05T08:00Z')],
      localDate: '2026-11-03', timeZone: 'Europe/Athens', weekStartsOn: 1, complete: true };
    expect(calculateTrainingGoalProgress(input)).toEqual([]);
    expect(calculateTrainingGoalProgress({ ...input, localDate: '2026-11-05' })).toEqual([
      expect.objectContaining({ value: 1, partialWeek: true, startLocalDate: '2026-11-05' }),
    ]);
  });
});
