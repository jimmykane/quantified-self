import { describe, expect, it } from 'vitest';
import type { DerivedTrainingDurabilityMetricPayload } from '@shared/derived-metrics';
import { buildTrainingDurabilityScopeViewModels } from './training-durability-view.helper';

const context = { contextKey: 'running:speed', scope: 'running' as const, outputSource: 'speed', outputUnit: 'm/s', poolLengthMeters: null, stroke: null };
const currentSummary = {
  context, sampleCount: 3, medianDurationSeconds: 3600, medianCoverageRatio: 0.8,
  medianDecouplingPercent: 4, medianOutputRetentionPercent: 96, medianHeartRateDriftBpm: 5,
  medianPaceRetentionPercent: null, medianSwolfChange: null,
};
const usualSummary = { ...currentSummary, medianDecouplingPercent: 5, medianOutputRetentionPercent: 95, medianHeartRateDriftBpm: 6 };
const coverage = {
  candidateActivityCount: 5, evidenceActivityCount: 4, eligibleActivityCount: 3,
  missingEvidenceActivityCount: 1, excludedActivityCount: 1, eligibilityRatio: 0.6,
  exclusions: [{ reason: 'too-variable', activityCount: 1 }],
};
const makeWindow = (periodDays: 28 | 7, summaries = [currentSummary]) => ({ periodDays, windowStartDayMs: 1, windowEndDayMs: 2, coverage, summaries });
const payload: DerivedTrainingDurabilityMetricPayload = {
  dayBoundary: 'UTC', asOfDayMs: 2, currentWindowDays: 28, baselineBlockCount: 3, weeklyPointCount: 12,
  excludesMergedEvents: true, excludesFutureEvents: true, evidenceSource: 'persisted-activity-stat',
  scopes: [{
    scope: 'running', current: makeWindow(28), baselineBlocks: Array.from({ length: 3 }, () => makeWindow(28)),
    usual: { coverage, summaries: [usualSummary] }, weeks: Array.from({ length: 12 }, () => makeWindow(7)),
    recentSupportingEvents: [{
      activityId: 'a1', eventId: 'e1', label: 'Long run', startDayMs: 1, contextKey: context.contextKey,
      decouplingPercent: 4, outputRetentionPercent: 96, heartRateDriftBpm: 5, paceRetentionPercent: null, swolfChange: null,
    }],
  }],
};

describe('buildTrainingDurabilityScopeViewModels', () => {
  it('compares current durability with the prior-block median', () => {
    const views = buildTrainingDurabilityScopeViewModels(payload, ['running']);
    expect(views[0]).toEqual(expect.objectContaining({
      label: 'Running', evidenceText: '3 eligible of 5 candidate workouts', coverageText: '60% eligible',
      conclusionText: 'Durability is based on 3 comparable current workouts; read it as a directional signal rather than a verdict.',
      evidenceQualityText: 'Evidence quality: usable — 3 of 5 candidate workouts met the comparison rules.',
      exclusionText: 'Primary exclusions: Too variable 1', trendText: '12 of 12 recent weeks produced comparable workout evidence',
      supportingEventsText: 'Recent supporting workouts: Long run',
    }));
    expect(views[0].contexts[0].metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Aerobic decoupling', deltaText: '−1%', deltaTone: 'positive' }),
      expect.objectContaining({ label: 'Output retained', deltaText: '+1%', deltaTone: 'positive' }),
    ]));
    expect(views[0].contexts[0].trajectory).toEqual(expect.objectContaining({
      contextLabel: 'Running · Speed',
      title: 'Running durability trend',
      metricLabel: 'Aerobic decoupling',
      sourceActivityLabel: 'Candidates',
      activityCountSummary: 'Across 12 weeks: 60 candidates · 36 eligible',
      exclusionSummary: 'Primary exclusions: Too variable 12',
      noEligibleWeekCount: 0,
      unavailableMetricWeekCount: 0,
    }));
    expect(views[0].contexts[0].trajectory.points).toHaveLength(12);
    expect(views[0].contexts[0].trajectory.points[0]).toEqual(expect.objectContaining({
      value: 4,
      candidateActivityCount: 5,
      sourceActivityCount: 5,
      eligibleSampleCount: 3,
      hasEligibleSamples: true,
      exclusionReasons: [{ reason: 'too-variable', label: 'Too variable', activityCount: 1 }],
    }));
  });

  it('compares aerobic drift by absolute magnitude', () => {
    const driftPayload: DerivedTrainingDurabilityMetricPayload = {
      ...payload,
      scopes: [{
        ...payload.scopes[0],
        current: makeWindow(28, [{ ...currentSummary, medianDecouplingPercent: -5, medianHeartRateDriftBpm: -5 }]),
        usual: { coverage, summaries: [{ ...usualSummary, medianDecouplingPercent: 1, medianHeartRateDriftBpm: 1 }] },
      }],
    };
    const metrics = buildTrainingDurabilityScopeViewModels(driftPayload, ['running'])[0].contexts[0].metrics;
    expect(metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Aerobic decoupling', deltaText: '−6%', deltaTone: 'negative' }),
      expect.objectContaining({ label: 'Heart-rate drift', deltaText: '−6 bpm', deltaTone: 'negative' }),
    ]));
  });

  it('plots pool pace retention and preserves weeks without eligible samples', () => {
    const poolContext = { ...context, contextKey: 'pool:25:freestyle', scope: 'pool-swimming' as const, outputSource: 'pool-length-speed', outputUnit: 'm/s', poolLengthMeters: 25, stroke: 'freestyle' };
    const poolSummary = {
      ...currentSummary,
      context: poolContext,
      medianDecouplingPercent: null,
      medianOutputRetentionPercent: null,
      medianHeartRateDriftBpm: null,
      medianPaceRetentionPercent: 98,
      medianSwolfChange: 1,
    };
    const emptyCoverage = { ...coverage, candidateActivityCount: 0, evidenceActivityCount: 0, eligibleActivityCount: 0, missingEvidenceActivityCount: 0, excludedActivityCount: 0, eligibilityRatio: null, exclusions: [] };
    const emptyWeek = { ...makeWindow(7, []), coverage: emptyCoverage };
    const poolPayload: DerivedTrainingDurabilityMetricPayload = {
      ...payload,
      scopes: [{
        scope: 'pool-swimming',
        current: makeWindow(28, [poolSummary]),
        baselineBlocks: Array.from({ length: 3 }, () => makeWindow(28, [poolSummary])),
        usual: { coverage, summaries: [poolSummary] },
        weeks: [makeWindow(7, [poolSummary]), ...Array.from({ length: 11 }, () => emptyWeek)],
        recentSupportingEvents: [],
      }],
    };
    const trajectory = buildTrainingDurabilityScopeViewModels(poolPayload, ['swimming'])[0].contexts[0].trajectory;
    expect(trajectory).toEqual(expect.objectContaining({
      contextLabel: '25 m · freestyle',
      title: 'Pool durability trend',
      metricLabel: 'Pace retained',
      sourceActivityLabel: 'Candidates',
      activityCountSummary: 'Across 12 weeks: 5 candidates · 3 eligible',
      noEligibleWeekCount: 11,
    }));
    expect(trajectory.points[0]).toEqual(expect.objectContaining({ value: 98, eligibleSampleCount: 3, hasEligibleSamples: true }));
    expect(trajectory.points[1]).toEqual(expect.objectContaining({ value: null, eligibleSampleCount: 0, hasEligibleSamples: false }));
  });

  it('explains cycling power availability separately from durability eligibility', () => {
    const cyclingContext = {
      ...context,
      contextKey: 'cycling|power|W|-|-',
      scope: 'cycling' as const,
      outputSource: 'power',
      outputUnit: 'W',
    };
    const poweredSummary = { ...currentSummary, context: cyclingContext, sampleCount: 1 };
    const cyclingCoverage = {
      ...coverage,
      candidateActivityCount: 6,
      evidenceActivityCount: 6,
      eligibleActivityCount: 1,
      missingEvidenceActivityCount: 0,
      excludedActivityCount: 5,
      eligibilityRatio: 1 / 6,
      exclusions: [
        { reason: 'missing-output', activityCount: 4 },
        { reason: 'too-intense', activityCount: 1 },
      ],
    };
    const cyclingWeek = { ...makeWindow(7, [poweredSummary]), coverage: cyclingCoverage };
    const cyclingPayload: DerivedTrainingDurabilityMetricPayload = {
      ...payload,
      scopes: [{
        scope: 'cycling',
        current: { ...makeWindow(28, [poweredSummary]), coverage: cyclingCoverage },
        baselineBlocks: Array.from({ length: 3 }, () => ({ ...makeWindow(28, [poweredSummary]), coverage: cyclingCoverage })),
        usual: { coverage: cyclingCoverage, summaries: [poweredSummary] },
        weeks: Array.from({ length: 12 }, () => cyclingWeek),
        recentSupportingEvents: [],
      }],
    };

    const view = buildTrainingDurabilityScopeViewModels(cyclingPayload, ['cycling'])[0];
    expect(view).toEqual(expect.objectContaining({
      evidenceText: '1 eligible · 2 with power · 6 candidates',
      coverageText: '17% eligible',
      exclusionText: 'Primary exclusions: No recorded power 4 · Too intense 1',
    }));
    expect(view.contexts[0].trajectory).toEqual(expect.objectContaining({
      activityCountSummary: 'Across 12 weeks: 72 candidates · 24 with power · 12 eligible',
      exclusionSummary: 'Primary exclusions: No recorded power 48 · Too intense 12',
    }));
  });

  it('respects selected sport visibility', () => {
    expect(buildTrainingDurabilityScopeViewModels(payload, ['cycling'])).toEqual([]);
  });
});
