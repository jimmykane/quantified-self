import { describe, expect, it } from 'vitest';
import { parseWahooWorkout } from './workout-payload';

const workout = {
  id: 56519,
  starts: '2026-07-18T09:00:00Z',
  workout_summary: {
    id: 8297,
    updated_at: '2026-07-18T10:00:00Z',
    manual: false,
    edited: true,
    fitness_app_id: 7,
    file: { url: 'https://cdn.wahooligan.com/activity.fit' },
  },
};

describe('parseWahooWorkout', () => {
  it('normalizes an importable workout', () => {
    expect(parseWahooWorkout(60462, workout)).toEqual({
      wahooUserID: '60462',
      workoutID: '56519',
      workoutSummaryID: '8297',
      summaryUpdatedAt: '2026-07-18T10:00:00.000Z',
      FITFileURI: 'https://cdn.wahooligan.com/activity.fit',
      starts: '2026-07-18T09:00:00.000Z',
      manual: false,
      edited: true,
      fitnessAppID: 7,
    });
  });

  it('skips records without a FIT file', () => {
    expect(parseWahooWorkout(60462, { ...workout, workout_summary: { ...workout.workout_summary, file: null } })).toBeNull();
  });

  it('skips workouts originating from third-party apps', () => {
    expect(parseWahooWorkout(60462, {
      ...workout,
      workout_summary: { ...workout.workout_summary, fitness_app_id: 1001 },
    })).toBeNull();
  });

  it.each([null, undefined, ''])('keeps an unknown fitness app id absent for %s', (fitnessAppID) => {
    const parsed = parseWahooWorkout(60462, {
      ...workout,
      workout_summary: { ...workout.workout_summary, fitness_app_id: fitnessAppID },
    });

    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('fitnessAppID');
  });
});
