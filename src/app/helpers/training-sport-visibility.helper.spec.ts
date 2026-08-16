import { describe, expect, it } from 'vitest';
import { TRAINING_DISCIPLINES, type TrainingDiscipline } from '@shared/training-disciplines';
import {
  formatTrainingVisibleDisciplinesActivityLabel,
  formatTrainingVisibleDisciplinesAccessibleLabel,
  formatTrainingVisibleDisciplinesCompactLabel,
  formatTrainingVisibleDisciplinesLabel,
  formatTrainingVisibleDisciplinesScopeLabel,
  TRAINING_VISIBLE_DISCIPLINE_OPTIONS,
  normalizeTrainingSportShortcuts,
  resolveStableTrainingShortcutDestinations,
  resolveTrainingShortcutDestinations,
  resolveTrainingSportShortcuts,
  resolveTrainingSportVisibility,
} from './training-sport-visibility.helper';

function summary(
  activityCounts: Partial<Record<TrainingDiscipline, number>>,
  durations: Partial<Record<TrainingDiscipline, number>> = {},
) {
  const window = (discipline: TrainingDiscipline, activityCount: number) => ({
    periodDays: 28,
    windowStartDayMs: 1,
    windowEndDayMs: 2,
    activityCount,
    durationSeconds: durations[discipline] || 0,
    easySeconds: 0,
    moderateSeconds: 0,
    hardSeconds: 0,
  });
  return {
    asOfDayMs: 2,
    currentWindowDays: 28,
    baselineWindowDays: 84,
    disciplines: TRAINING_DISCIPLINES.map(discipline => ({
      discipline,
      current28d: window(discipline, activityCounts[discipline] || 0),
      baseline28d: window(discipline, 20),
    })),
  };
}

describe('resolveTrainingSportVisibility', () => {
  it('derives complete, canonically ordered presentation from the sport registry', () => {
    expect(TRAINING_VISIBLE_DISCIPLINE_OPTIONS.map(({ discipline, label }) => ({ discipline, label }))).toEqual([
      { discipline: 'running', label: 'Running' },
      { discipline: 'cycling', label: 'Cycling' },
      { discipline: 'swimming', label: 'Swimming' },
      { discipline: 'rowing', label: 'Rowing' },
      { discipline: 'walking-hiking', label: 'Walking & Hiking' },
      { discipline: 'nordic-skiing', label: 'Nordic Skiing' },
      { discipline: 'strength', label: 'Strength' },
      { discipline: 'paddling', label: 'Paddling' },
    ]);
    expect(formatTrainingVisibleDisciplinesLabel(['rowing', 'strength'])).toBe('Rowing + Strength');
    expect(formatTrainingVisibleDisciplinesScopeLabel(['cycling'])).toBe('Cycling/MTB');
    expect(formatTrainingVisibleDisciplinesScopeLabel(['walking-hiking', 'nordic-skiing']))
      .toBe('Walking/Hiking and Nordic Skiing');
    expect(formatTrainingVisibleDisciplinesScopeLabel([])).toBe('No sport-specific');
    expect(formatTrainingVisibleDisciplinesActivityLabel(['rowing'])).toBe('rowing workouts');
    expect(formatTrainingVisibleDisciplinesCompactLabel([...TRAINING_DISCIPLINES])).toBe('All sports');
    expect(formatTrainingVisibleDisciplinesCompactLabel([])).toBe('No sports');
    expect(formatTrainingVisibleDisciplinesCompactLabel(['running', 'swimming'])).toBe('2 sports');
    expect(formatTrainingVisibleDisciplinesAccessibleLabel(['rowing', 'paddling'], false))
      .toBe('Choose sports shown. Fixed selection: Rowing + Paddling.');
    expect(formatTrainingVisibleDisciplinesAccessibleLabel([], true))
      .toBe('Choose sports shown. Automatic selection: no sport-specific cards.');
  });

  it('honors a valid explicit selection regardless of recent activity', () => {
    expect(resolveTrainingSportVisibility(['strength'], summary({ running: 12 }), true, {})).toEqual({
      disciplines: ['strength'],
      isAutomatic: false,
    });
  });

  it('uses all current 28-day sport families for automatic visibility', () => {
    expect(resolveTrainingSportVisibility(undefined, summary({ rowing: 7, 'walking-hiking': 4 }), true, {})).toEqual({
      disciplines: ['rowing', 'walking-hiking'],
      isAutomatic: true,
    });
  });

  it('ranks automatic shortcuts by duration, workouts, benchmark eligibility, and registry order', () => {
    const result = resolveTrainingSportShortcuts(
      null,
      undefined,
      summary(
        { running: 2, cycling: 4, swimming: 5, rowing: 5, strength: 1 },
        { running: 5_000, cycling: 4_000, swimming: 4_000, rowing: 4_000, strength: 3_000 },
      ),
      true,
      {},
    );

    expect(result).toMatchObject({
      disciplines: ['running', 'swimming', 'rowing', 'cycling'],
      isAutomatic: true,
      source: 'automatic',
    });
  });

  it('uses a valid new preference before legacy data and caps both at four', () => {
    expect(resolveTrainingSportShortcuts(
      ['paddling', 'strength', 'rowing', 'swimming', 'cycling'],
      ['running'],
      null,
      false,
      {},
    )).toMatchObject({
      disciplines: ['cycling', 'swimming', 'rowing', 'strength'],
      isAutomatic: false,
      source: 'saved',
    });
    expect(resolveTrainingSportShortcuts(
      undefined,
      ['paddling', 'strength', 'rowing', 'swimming', 'cycling'],
      null,
      false,
      {},
    )).toMatchObject({
      disciplines: ['cycling', 'swimming', 'rowing', 'strength'],
      source: 'legacy',
    });
  });

  it('distinguishes automatic, malformed, and fixed shortcut preferences', () => {
    expect(normalizeTrainingSportShortcuts(null)).toBeNull();
    expect(normalizeTrainingSportShortcuts([])).toBeUndefined();
    expect(normalizeTrainingSportShortcuts(['cycling', 'running'])).toEqual(['running', 'cycling']);
  });

  it('temporarily places a selected off-shortcut sport in the four desktop slots', () => {
    expect(resolveTrainingShortcutDestinations(
      ['running', 'cycling', 'swimming', 'rowing'],
      'strength',
    )).toEqual(['strength', 'running', 'cycling', 'swimming']);
    expect(resolveTrainingShortcutDestinations(['running', 'cycling'], 'overview'))
      .toEqual(['running', 'cycling']);
  });

  it('keeps retained shortcut destinations in stable slots while automatic evidence hydrates', () => {
    expect(resolveStableTrainingShortcutDestinations(
      ['strength'],
      ['cycling', 'strength', 'swimming', 'running'],
      'strength',
    )).toEqual(['strength', 'cycling', 'swimming', 'running']);

    expect(resolveStableTrainingShortcutDestinations(
      ['cycling', 'strength', 'swimming', 'running'],
      ['cycling', 'rowing', 'strength', 'swimming'],
      'overview',
    )).toEqual(['cycling', 'strength', 'swimming', 'rowing']);
  });

  it('keeps a selected destination in its existing slot when it leaves the automatic top four', () => {
    expect(resolveStableTrainingShortcutDestinations(
      ['cycling', 'strength', 'swimming', 'running'],
      ['cycling', 'rowing', 'swimming', 'paddling'],
      'running',
    )).toEqual(['cycling', 'rowing', 'swimming', 'running']);
  });

  it('keeps a sport visible automatically when it has a valid saved benchmark', () => {
    expect(resolveTrainingSportVisibility(undefined, summary({ cycling: 4 }), true, {
      paddling: { mode: 'period', durationWeeks: 12, endDayMs: 1_700_000_000_000 },
    })).toEqual({
      disciplines: ['cycling', 'paddling'],
      isAutomatic: true,
    });
    expect(resolveTrainingSportVisibility(undefined, null, false, {
      rowing: { mode: 'event', durationWeeks: 12, eventId: 'benchmark-event' },
    })).toEqual({
      disciplines: ['rowing'],
      isAutomatic: true,
    });
  });

  it('shows no sport-specific cards while automatic evidence is unavailable or empty', () => {
    expect(resolveTrainingSportVisibility(['not-a-sport'], summary({ running: 3 }), true, {})).toEqual({
      disciplines: ['running'],
      isAutomatic: true,
    });
    expect(resolveTrainingSportVisibility(undefined, summary({ running: 3 }), false, {})).toEqual({
      disciplines: [],
      isAutomatic: true,
    });
    expect(resolveTrainingSportVisibility(undefined, summary({}), true, {})).toEqual({
      disciplines: [],
      isAutomatic: true,
    });
  });
});
