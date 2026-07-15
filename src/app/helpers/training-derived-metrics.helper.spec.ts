import { describe, expect, it } from 'vitest';
import {
  resolveTrainingDurabilityMetricPayload,
  resolveTrainingExplanationMetricPayload,
} from './training-derived-metrics.helper';

const loadCoverage = { totalCount: 2, loadedCount: 1, classifiedCount: 2, unclassifiedCount: 0, ratio: 0.5 };
const sportLoad = { sport: 'running', label: 'Running', activityCount: 2, loadActivityCount: 1, trainingStressScore: 100, loadSharePercent: 100 };
const explanationMetrics = {
  parentEventCount: 2, parentLoadEventCount: 1, parentTrainingStressScore: 100, parentLoadCoverage: loadCoverage,
  childActivityCount: 2, childLoadActivityCount: 1, childTrainingStressScore: 100, childLoadCoverage: loadCoverage,
  sportLoads: [sportLoad],
  rhythms: [{ discipline: 'running', sessionCount: 2, activeDayCount: 2, activeWeekCount: 2, longestInactivityGapDays: 7, longestSessionDurationSeconds: 3600 }],
};
const explanationWindow = { periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, ...explanationMetrics };

const context = { contextKey: 'running:power', scope: 'running', outputSource: 'power', outputUnit: 'W', poolLengthMeters: null, stroke: null };
const summary = {
  context, sampleCount: 3, medianDurationSeconds: 3600, medianCoverageRatio: 0.8,
  medianDecouplingPercent: 4, medianOutputRetentionPercent: 96, medianHeartRateDriftBpm: 5,
  medianPaceRetentionPercent: null, medianSwolfChange: null,
};
const coverage = {
  candidateActivityCount: 5, evidenceActivityCount: 4, eligibleActivityCount: 3,
  missingEvidenceActivityCount: 1, excludedActivityCount: 1, eligibilityRatio: 0.6,
  exclusions: [{ reason: 'too-variable', activityCount: 1 }],
};
const durabilityMetrics = { coverage, summaries: [summary] };
const window28 = { periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2, ...durabilityMetrics };
const window7 = { periodDays: 7, windowStartDayMs: 1, windowEndDayMs: 2, ...durabilityMetrics };
const supportingEvent = {
  activityId: 'activity-1', eventId: 'event-1', label: null, startDayMs: 1, contextKey: context.contextKey,
  decouplingPercent: 4, outputRetentionPercent: 96, heartRateDriftBpm: 5, paceRetentionPercent: null, swolfChange: null,
};

function durabilityPayload() {
  const makeScope = (scope: 'running' | 'cycling' | 'pool-swimming' | 'open-water-swimming') => ({
    scope,
    current: window28,
    baselineBlocks: [window28, window28, window28],
    usual: durabilityMetrics,
    weeks: Array.from({ length: 12 }, () => window7),
    recentSupportingEvents: [supportingEvent],
  });
  return {
    dayBoundary: 'UTC', asOfDayMs: 2, currentWindowDays: 28, baselineBlockCount: 3, weeklyPointCount: 12,
    excludesMergedEvents: true, excludesFutureEvents: true, evidenceSource: 'persisted-activity-stat',
    scopes: (['running', 'cycling', 'pool-swimming', 'open-water-swimming'] as const).map(makeScope),
  };
}

describe('training derived metric normalizers', () => {
  it('normalizes a complete training explanation payload', () => {
    const payload = {
      dayBoundary: 'UTC', asOfDayMs: 2, currentWindowDays: 28, baselineBlockCount: 3,
      excludesMergedEvents: true, excludesMissingDates: true, excludesFutureEvents: true,
      current: explanationWindow,
      baselineBlocks: [explanationWindow, explanationWindow, explanationWindow],
      baselineMedian: explanationMetrics,
      topContributors: [{
        eventId: 'event-1', label: 'Long run', startDayMs: 1, trainingStressScore: 80,
        loadSharePercent: 80, childComposition: [sportLoad],
      }],
    };
    expect(resolveTrainingExplanationMetricPayload(payload)).toEqual(payload);
  });

  it('rejects incomplete explanation payloads', () => {
    expect(resolveTrainingExplanationMetricPayload({
      dayBoundary: 'UTC', asOfDayMs: 2, currentWindowDays: 28, baselineBlockCount: 3,
      excludesMergedEvents: true, excludesMissingDates: true, excludesFutureEvents: true,
      current: explanationWindow, baselineBlocks: [explanationWindow], baselineMedian: explanationMetrics, topContributors: [],
    })).toBeNull();
  });

  it('normalizes four durability scopes with 28-day, usual, and weekly evidence', () => {
    const payload = durabilityPayload();
    expect(resolveTrainingDurabilityMetricPayload(payload)).toEqual(payload);
  });

  it('rejects impossible durability coverage arithmetic and context totals', () => {
    const invalidRatio = durabilityPayload();
    invalidRatio.scopes[0].current = {
      ...invalidRatio.scopes[0].current,
      coverage: { ...coverage, eligibilityRatio: 0.75 },
    };
    expect(resolveTrainingDurabilityMetricPayload(invalidRatio)).toBeNull();

    const invalidEvidenceCount = durabilityPayload();
    invalidEvidenceCount.scopes[0].current = {
      ...invalidEvidenceCount.scopes[0].current,
      coverage: { ...coverage, evidenceActivityCount: 5 },
    };
    expect(resolveTrainingDurabilityMetricPayload(invalidEvidenceCount)).toBeNull();

    const invalidSummaryCount = durabilityPayload();
    invalidSummaryCount.scopes[0].current = {
      ...invalidSummaryCount.scopes[0].current,
      summaries: [{ ...summary, sampleCount: 2 }],
    };
    expect(resolveTrainingDurabilityMetricPayload(invalidSummaryCount)).toBeNull();
  });

  it('rejects durability payloads missing a scope or weekly point', () => {
    expect(resolveTrainingDurabilityMetricPayload({
      dayBoundary: 'UTC', asOfDayMs: 2, currentWindowDays: 28, baselineBlockCount: 3, weeklyPointCount: 12,
      excludesMergedEvents: true, excludesFutureEvents: true, evidenceSource: 'persisted-activity-stat', scopes: [],
    })).toBeNull();
  });
});
