import { describe, expect, it } from 'vitest';
import {
  formatTrainingVisibleDisciplinesActivityLabel,
  formatTrainingVisibleDisciplinesAccessibleLabel,
  formatTrainingVisibleDisciplinesCompactLabel,
  formatTrainingVisibleDisciplinesLabel,
  formatTrainingVisibleDisciplinesScopeLabel,
  TRAINING_VISIBLE_DISCIPLINE_OPTIONS,
  resolveTrainingSportVisibility,
} from './training-sport-visibility.helper';

function summary(runningActivities: number, cyclingActivities: number, swimmingActivities = 0) {
  const window = (activityCount: number) => ({
    periodDays: 28,
    windowStartDayMs: 1,
    windowEndDayMs: 2,
    activityCount,
    durationSeconds: 0,
    easySeconds: 0,
    moderateSeconds: 0,
    hardSeconds: 0,
  });
  return {
    asOfDayMs: 2,
    currentWindowDays: 28,
    baselineWindowDays: 84,
    disciplines: [
      { discipline: 'running' as const, current28d: window(runningActivities), baseline28d: window(20) },
      { discipline: 'cycling' as const, current28d: window(cyclingActivities), baseline28d: window(20) },
      { discipline: 'swimming' as const, current28d: window(swimmingActivities), baseline28d: window(20) },
    ],
  };
}

describe('resolveTrainingSportVisibility', () => {
  it('keeps supported sport presentation complete and canonically ordered', () => {
    expect(TRAINING_VISIBLE_DISCIPLINE_OPTIONS).toEqual([
      { discipline: 'running', label: 'Running', details: 'Build, training mix, capacity, and power curve' },
      { discipline: 'cycling', label: 'Cycling', details: 'Road, indoor, virtual, e-bike, and mountain biking' },
      { discipline: 'swimming', label: 'Swimming', details: 'Pool and open-water build, pace, and comparable SWOLF' },
    ]);
    expect(formatTrainingVisibleDisciplinesLabel(['running', 'cycling'])).toBe('Running + Cycling');
    expect(formatTrainingVisibleDisciplinesScopeLabel(['cycling'])).toBe('Cycling/MTB');
    expect(formatTrainingVisibleDisciplinesScopeLabel(['running', 'swimming'])).toBe('Running and Swimming');
    expect(formatTrainingVisibleDisciplinesScopeLabel(['running', 'cycling', 'swimming']))
      .toBe('Running, Cycling/MTB, and Swimming');
    expect(formatTrainingVisibleDisciplinesActivityLabel(['running'])).toBe('running workouts');
    expect(formatTrainingVisibleDisciplinesActivityLabel(['running', 'cycling']))
      .toBe('running or cycling workouts');
    expect(formatTrainingVisibleDisciplinesCompactLabel(['running', 'cycling', 'swimming'])).toBe('All 3');
    expect(formatTrainingVisibleDisciplinesCompactLabel(['running', 'swimming'])).toBe('2 sports');
    expect(formatTrainingVisibleDisciplinesAccessibleLabel(['cycling', 'swimming'], false))
      .toBe('Choose sports shown. Fixed selection: Cycling + Swimming.');
  });

  it('honors a valid explicit selection regardless of recent activity', () => {
    expect(resolveTrainingSportVisibility(['cycling'], summary(12, 0), true, {})).toEqual({
      disciplines: ['cycling'],
      isAutomatic: false,
    });
  });

  it('uses only current 28-day activity for automatic visibility', () => {
    expect(resolveTrainingSportVisibility(undefined, summary(0, 7), true, {})).toEqual({
      disciplines: ['cycling'],
      isAutomatic: true,
    });
  });

  it('keeps a sport visible automatically when it has a valid saved benchmark', () => {
    expect(resolveTrainingSportVisibility(undefined, summary(0, 4), true, {
      running: { mode: 'period', durationWeeks: 12, endDayMs: 1_700_000_000_000 },
    })).toEqual({
      disciplines: ['running', 'cycling'],
      isAutomatic: true,
    });
  });

  it('falls back to automatic mode for invalid preferences and to both sports when inference is unavailable or empty', () => {
    expect(resolveTrainingSportVisibility(['rowing'], summary(3, 0), true, {})).toEqual({
      disciplines: ['running'],
      isAutomatic: true,
    });
    expect(resolveTrainingSportVisibility(undefined, summary(3, 0), false, {})).toEqual({
      disciplines: ['running', 'cycling', 'swimming'],
      isAutomatic: true,
    });
    expect(resolveTrainingSportVisibility(undefined, summary(0, 0), true, {})).toEqual({
      disciplines: ['running', 'cycling', 'swimming'],
      isAutomatic: true,
    });
  });
});
