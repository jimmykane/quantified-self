import { describe, expect, it } from 'vitest';
import { buildTrainingAnalysis } from './training-analysis.helper';
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
    vo2Max: null,
    ftp: null,
    criticalPower: null,
    ...overrides,
  };
}

describe('buildTrainingAnalysis', () => {
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

  it('keeps capacity evidence conservative when a source-matched trend is unavailable', () => {
    const analysis = buildTrainingAnalysis({
      stateSignals: { form: null, rampRate: null, fitness: null, fatigue: null },
      disciplines: [createDiscipline({
        current28d: {
          periodDays: 28, windowStartDayMs: 0, windowEndDayMs: 1, activityCount: 0, durationSeconds: 0,
          easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
        },
        baseline28d: {
          periodDays: 28, windowStartDayMs: 0, windowEndDayMs: 1, activityCount: 0, durationSeconds: 0,
          easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
        },
        ftp: {
          sourceKey: null,
          latestAtMs: 1,
          latestValue: 250,
          currentMedian: null,
          baselineMedian: null,
          currentSampleCount: 1,
          baselineSampleCount: 0,
          deltaPct: null,
          trend: null,
        },
      })],
    });

    expect(analysis.insights).toEqual([{
      title: 'Capacity evidence',
      description: 'Latest capacity values are available, but a trend needs repeated readings from one named device.',
    }]);
  });
});
