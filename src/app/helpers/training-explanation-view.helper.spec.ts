import { describe, expect, it } from 'vitest';
import type { DerivedTrainingExplanationMetricPayload } from '@shared/derived-metrics';
import { buildTrainingExplanationViewModel } from './training-explanation-view.helper';

const coverage = { totalCount: 4, loadedCount: 4, classifiedCount: 4, unclassifiedCount: 0, ratio: 1 };
const currentMetrics = {
  parentEventCount: 4, parentLoadEventCount: 4, parentTrainingStressScore: 300, parentLoadCoverage: coverage,
  childActivityCount: 4, childLoadActivityCount: 4, childTrainingStressScore: 300, childLoadCoverage: coverage,
  sportLoads: [{ sport: 'running' as const, label: 'Running', activityCount: 3, loadActivityCount: 3, trainingStressScore: 240, loadSharePercent: 80 }],
  rhythms: [{ discipline: 'running' as const, sessionCount: 3, activeDayCount: 10, activeWeekCount: 4, longestInactivityGapDays: 3, longestSessionDurationSeconds: 7200 }],
};
const usualMetrics = {
  ...currentMetrics,
  parentTrainingStressScore: 200,
  childTrainingStressScore: 200,
  sportLoads: [{ ...currentMetrics.sportLoads[0], activityCount: 2, trainingStressScore: 140, loadSharePercent: 70 }],
  rhythms: [{ ...currentMetrics.rhythms[0], activeDayCount: 8, longestInactivityGapDays: 5 }],
};
function payload(): DerivedTrainingExplanationMetricPayload {
  return {
    dayBoundary: 'UTC', asOfDayMs: 2, currentWindowDays: 28, baselineBlockCount: 3,
    excludesMergedEvents: true, excludesMissingDates: true, excludesFutureEvents: true,
    current: { periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, ...currentMetrics },
    baselineBlocks: Array.from({ length: 3 }, () => ({ periodDays: 28 as const, windowStartDayMs: 1, windowEndDayMs: 2, ...usualMetrics })),
    baselineMedian: usualMetrics,
    topContributors: [{
      eventId: 'event-1', label: 'Long run', startDayMs: 1, trainingStressScore: 120, loadSharePercent: 40,
      childComposition: currentMetrics.sportLoads,
    }],
  };
}

describe('buildTrainingExplanationViewModel', () => {
  it('explains load, contributors, sport load, rhythm, and coverage', () => {
    const view = buildTrainingExplanationViewModel(payload());
    expect(view?.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'load', valueText: '50% higher than usual', usesNumericTypography: true, tone: 'neutral' }),
      expect.objectContaining({ key: 'contributors', description: 'Long run (40%; mostly running)' }),
      expect.objectContaining({ key: 'mix', title: 'Running load', valueText: '100 TSS higher', tone: 'neutral' }),
      expect.objectContaining({ key: 'rhythm', valueText: '2 active days higher', tone: 'neutral' }),
    ]));
    expect(view?.coverageText).toContain('4/4 current parent events');
  });

  it('keeps text-only comparison values in the narrative typeface', () => {
    const input = payload();
    input.current.rhythms[0] = { ...input.current.rhythms[0], activeDayCount: input.baselineMedian.rhythms[0].activeDayCount };

    const view = buildTrainingExplanationViewModel(input);

    expect(view?.cards.find(card => card.key === 'rhythm')).toEqual(expect.objectContaining({
      valueText: 'Same active days',
      usesNumericTypography: false,
    }));
  });

  it('returns null without a normalized payload', () => {
    expect(buildTrainingExplanationViewModel(null)).toBeNull();
  });

  it('replaces generic event names with sport and date context and pluralizes rhythm copy', () => {
    const input = payload();
    input.topContributors[0] = {
      ...input.topContributors[0],
      label: 'New Event',
      startDayMs: Date.UTC(2026, 6, 10),
    };
    input.current.rhythms[0] = { ...input.current.rhythms[0], longestInactivityGapDays: 1 };

    const view = buildTrainingExplanationViewModel(input);

    expect(view?.cards.find(card => card.key === 'contributors')?.description).toMatch(/^Running · (Jul 10|10 Jul) \(40%\)$/);
    expect(view?.cards.find(card => card.key === 'rhythm')?.description).toContain('Longest inactivity gap: 1 day;');
  });
});
