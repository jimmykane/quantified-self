import { describe, expect, it } from 'vitest';
import type {
  DashboardTrainingBuildComparisonDiscipline,
  DashboardTrainingDisciplineSummary,
} from './dashboard-derived-metrics.helper';
import {
  buildTrainingBuildGuidance,
  buildTrainingLoadGuidance,
  buildTrainingMixGuidance,
} from './training-card-guidance.helper';

function window(overrides: Partial<DashboardTrainingDisciplineSummary['current28d']> = {}) {
  return {
    periodDays: 28,
    windowStartDayMs: 1,
    windowEndDayMs: 2,
    activityCount: 8,
    durationSeconds: 10 * 60 * 60,
    easySeconds: 6 * 60 * 60,
    moderateSeconds: 3 * 60 * 60,
    hardSeconds: 60 * 60,
    ...overrides,
  };
}

function summary(): DashboardTrainingDisciplineSummary {
  return {
    discipline: 'cycling',
    current28d: window(),
    baseline28d: window(),
  };
}

function buildSource(): DashboardTrainingBuildComparisonDiscipline {
  const buildWindow = (durationSeconds: number, activityCount: number) => ({
    periodWeeks: 8 as const,
    windowStartDayMs: 1,
    windowEndDayMs: 2,
    activityCount,
    durationSeconds,
    distanceMeters: null,
    distanceEventCount: 0,
    trainingStressScore: 100,
    trainingStressScoreEventCount: activityCount,
    activeWeekCount: 8,
    longestActivityDurationSeconds: null,
    easySeconds: null,
    moderateSeconds: null,
    hardSeconds: null,
    intensitySourceEventCount: 4,
    durability: null,
    poolAveragePaceSecondsPer100m: null,
    poolPaceActivityCount: 0,
    openWaterAveragePaceSecondsPer100m: null,
    openWaterPaceActivityCount: 0,
  });
  return {
    discipline: 'cycling',
    selection: null,
    current: buildWindow(12 * 60 * 60, 8),
    benchmark: buildWindow(8 * 60 * 60, 6),
    durabilityComparisons: [],
    suggestedRaces: [],
    suggestedEvents: [],
  };
}

describe('training-card-guidance.helper', () => {
  it('states the build outcome before its evidence and only adds a supported follow-up', () => {
    const view = buildTrainingBuildGuidance(buildSource());

    expect(view).toEqual(expect.objectContaining({
      conclusionText: 'This build is longer so far: 12h 00m of training versus 8h 00m in the reference.',
      evidenceText: 'Evidence quality: 8 current workouts and 6 reference workouts; TSS is available for 8 current workouts and 6 reference workouts.',
      nextStepText: expect.stringContaining('intensity mix'),
    }));
  });

  it('does not pretend that a missing zone baseline is comparable', () => {
    const view = buildTrainingMixGuidance({
      ...summary(),
      baseline28d: window({ easySeconds: 0, moderateSeconds: 0, hardSeconds: 0 }),
    }, 'Cycling');

    expect(view.conclusionText).toContain('not enough recorded zone time');
    expect(view.nextStepText).toBeNull();
  });

  it('describes a sustained intensity difference and a TSS-only load model plainly', () => {
    const mix = buildTrainingMixGuidance({
      ...summary(),
      current28d: window({ easySeconds: 4 * 60 * 60, moderateSeconds: 2 * 60 * 60, hardSeconds: 4 * 60 * 60 }),
    }, 'Cycling');

    expect(mix.conclusionText).toBe('Hard work makes up more of your cycling training than usual.');
    expect(mix.nextStepText).toContain('weekly distribution');
    expect(buildTrainingLoadGuidance(-4, 8)).toEqual(expect.objectContaining({
      conclusionText: 'Recent fatigue is currently higher than your longer-term fitness level.',
      evidenceText: expect.stringContaining('TSS-backed workouts only'),
      nextStepText: expect.stringContaining('no-workout forecast'),
    }));
  });
});
