import { describe, expect, it } from 'vitest';
import { buildTrainingAnalysis, resolveTrainingComparisonState } from './training-analysis.helper';
import type { DashboardTrainingDisciplineSummary } from './dashboard-derived-metrics.helper';

function createDiscipline(overrides: Partial<DashboardTrainingDisciplineSummary> = {}): DashboardTrainingDisciplineSummary {
  return {
    discipline: 'running',
    current28d: {
      periodDays: 28,
      windowStartDayMs: 0,
      windowEndDayMs: 1,
      activityCount: 12,
      durationSeconds: 12 * 60 * 60,
      easySeconds: 8 * 60 * 60,
      moderateSeconds: 2 * 60 * 60,
      hardSeconds: 2 * 60 * 60,
    },
    baseline28d: {
      periodDays: 28,
      windowStartDayMs: 0,
      windowEndDayMs: 1,
      activityCount: 8,
      durationSeconds: 8 * 60 * 60,
      easySeconds: 6 * 60 * 60,
      moderateSeconds: 90 * 60,
      hardSeconds: 30 * 60,
    },
    ...overrides,
  };
}

describe('buildTrainingAnalysis', () => {
  it('distinguishes a snapshot that is preparing from empty and baseline-building comparisons', () => {
    expect(resolveTrainingComparisonState('missing', false, 0, 0)).toBe('preparing');
    expect(resolveTrainingComparisonState('processing', false, 0, 0)).toBe('preparing');
    expect(resolveTrainingComparisonState('failed', false, 0, 0)).toBe('unavailable');
    expect(resolveTrainingComparisonState('ready', true, 0, 8)).toBe('empty');
    expect(resolveTrainingComparisonState('ready', true, 4, 0)).toBe('building-baseline');
    expect(resolveTrainingComparisonState('stale', true, 4, 8)).toBe('updating');
  });

  it('compares the current window with the normalized baseline and produces descriptive changes', () => {
    const analysis = buildTrainingAnalysis({
      stateSignals: { form: 2, rampRate: 0, fitness: 80, fatigue: 78 },
      disciplines: [createDiscipline()],
    });

    expect(analysis.duration).toMatchObject({ current: 12 * 60 * 60, baseline: 8 * 60 * 60, deltaPercent: 50 });
    expect(analysis.activities).toMatchObject({ current: 12, baseline: 8, delta: 4 });
    expect(analysis.state).toEqual({ label: 'Balanced', caption: 'Stable load' });
    expect(analysis.insights).toEqual([
      { title: 'Volume', description: 'You trained 50% more time than in your usual 28 days.' },
      { title: 'Sessions', description: 'You logged 4 more sessions than in your usual 28 days.' },
      { title: 'Intensity mix', description: 'Hard work is 10 percentage points more prominent than in your usual 28 days.' },
    ]);
  });

});
