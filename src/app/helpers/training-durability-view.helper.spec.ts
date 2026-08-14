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
      label: 'Running', evidenceText: '3 eligible of 5 candidate workouts · 1 without processed evidence', coverageText: '60% eligible',
      conclusionText: 'Durability is based on 3 comparable current workouts; read it as a directional signal rather than a verdict.',
      evidenceQualityText: 'Evidence quality: usable — 3 of 4 processed candidate workouts supplied eligible evidence; 1 candidate workout still lacks processed durability evidence.',
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
      activityCountSummary: 'Across 12 weeks: 60 candidates · 36 eligible · 12 without processed evidence',
      exclusionSummary: 'Processed evidence missing 12 · Primary exclusions: Too variable 12',
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
      activityCountSummary: 'Across 12 weeks: 5 candidates · 3 eligible · 1 without processed evidence',
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

  it('keeps a Cycling trajectory when every recent week contains only exclusions', () => {
    const excludedCoverage = {
      candidateActivityCount: 3,
      evidenceActivityCount: 3,
      eligibleActivityCount: 0,
      missingEvidenceActivityCount: 0,
      excludedActivityCount: 3,
      eligibilityRatio: 0,
      exclusions: [
        { reason: 'missing-output', activityCount: 2 },
        { reason: 'insufficient-duration', activityCount: 1 },
      ],
    };
    const excludedWindow = {
      periodDays: 7 as const,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
      coverage: excludedCoverage,
      summaries: [],
    };
    const cyclingPayload: DerivedTrainingDurabilityMetricPayload = {
      ...payload,
      scopes: [{
        scope: 'cycling',
        current: { ...excludedWindow, periodDays: 28 },
        baselineBlocks: Array.from({ length: 3 }, () => ({ ...excludedWindow, periodDays: 28 as const })),
        usual: { coverage: excludedCoverage, summaries: [] },
        weeks: Array.from({ length: 12 }, () => excludedWindow),
        recentSupportingEvents: [],
      }],
    };

    const view = buildTrainingDurabilityScopeViewModels(cyclingPayload, ['cycling'])[0];

    expect(view.contexts).toHaveLength(1);
    expect(view.contexts[0]).toEqual(expect.objectContaining({
      contextKey: 'cycling|power|W|-|-',
      label: 'Cycling · Power',
      sampleText: 'No current comparable workouts',
    }));
    expect(view.contexts[0].trajectory).toEqual(expect.objectContaining({
      title: 'Cycling durability trend',
      activityCountSummary: 'Across 12 weeks: 36 candidates · 12 with power · 0 eligible',
      noEligibleWeekCount: 12,
      exclusionSummary: 'Primary exclusions: No recorded power 24 · Too short 12',
    }));
    expect(view.contexts[0].trajectory.points[0]).toEqual(expect.objectContaining({
      value: null,
      candidateActivityCount: 3,
      sourceActivityCount: 1,
      eligibleSampleCount: 0,
      hasEligibleSamples: false,
    }));
  });

  it('distinguishes missing processed Cycling evidence from confirmed no-power exclusions', () => {
    const missingCoverage = {
      candidateActivityCount: 2,
      evidenceActivityCount: 0,
      eligibleActivityCount: 0,
      missingEvidenceActivityCount: 2,
      excludedActivityCount: 0,
      eligibilityRatio: 0,
      exclusions: [],
    };
    const missingWindow = {
      periodDays: 7 as const,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
      coverage: missingCoverage,
      summaries: [],
    };
    const missingPayload: DerivedTrainingDurabilityMetricPayload = {
      ...payload,
      scopes: [{
        scope: 'cycling',
        current: { ...missingWindow, periodDays: 28 },
        baselineBlocks: Array.from({ length: 3 }, () => ({ ...missingWindow, periodDays: 28 as const })),
        usual: { coverage: missingCoverage, summaries: [] },
        weeks: Array.from({ length: 12 }, () => missingWindow),
        recentSupportingEvents: [],
      }],
    };

    const view = buildTrainingDurabilityScopeViewModels(missingPayload, ['cycling'])[0];

    expect(view).toEqual(expect.objectContaining({
      conclusionText: 'Recent workouts are present, but their processed durability evidence is not available yet.',
      evidenceQualityText: 'Evidence quality: unavailable — processed durability evidence is missing for 2 candidate workouts.',
      evidenceText: '0 eligible · 0 with power · 2 candidates · 2 without processed evidence',
      nextStepText: 'Workouts without processed durability evidence cannot produce a trend point.',
    }));
    expect(view.contexts[0].trajectory).toEqual(expect.objectContaining({
      activityCountSummary: 'Across 12 weeks: 24 candidates · 0 with power · 0 eligible · 24 without processed evidence',
      exclusionSummary: 'Processed evidence missing 24',
    }));
    expect(view.contexts[0].trajectory.points[0]).toEqual(expect.objectContaining({
      missingEvidenceActivityCount: 2,
    }));
  });

  it('does not describe unprocessed Cycling candidates as failed comparisons', () => {
    const mixedCoverage = {
      candidateActivityCount: 3,
      evidenceActivityCount: 2,
      eligibleActivityCount: 0,
      missingEvidenceActivityCount: 1,
      excludedActivityCount: 2,
      eligibilityRatio: 0,
      exclusions: [
        { reason: 'missing-output', activityCount: 1 },
        { reason: 'insufficient-duration', activityCount: 1 },
      ],
    };
    const mixedWindow = {
      periodDays: 7 as const,
      windowStartDayMs: 1,
      windowEndDayMs: 2,
      coverage: mixedCoverage,
      summaries: [],
    };
    const mixedPayload: DerivedTrainingDurabilityMetricPayload = {
      ...payload,
      scopes: [{
        scope: 'cycling',
        current: { ...mixedWindow, periodDays: 28 },
        baselineBlocks: Array.from({ length: 3 }, () => ({ ...mixedWindow, periodDays: 28 as const })),
        usual: { coverage: mixedCoverage, summaries: [] },
        weeks: Array.from({ length: 12 }, () => mixedWindow),
        recentSupportingEvents: [],
      }],
    };

    const view = buildTrainingDurabilityScopeViewModels(mixedPayload, ['cycling'])[0];

    expect(view).toEqual(expect.objectContaining({
      conclusionText: 'No processed current workout met the steady-effort comparison rules; 1 candidate workout still lacks processed durability evidence.',
      evidenceQualityText: 'Evidence quality: limited — 0 of 2 processed candidate workouts supplied eligible evidence; 1 candidate workout still lacks processed durability evidence.',
      evidenceText: '0 eligible · 1 with power · 3 candidates · 1 without processed evidence',
      nextStepText: 'Review the primary exclusions for processed workouts; workouts without processed durability evidence cannot produce a trend point yet.',
    }));
  });

  it('respects selected sport visibility', () => {
    expect(buildTrainingDurabilityScopeViewModels(payload, ['cycling'])).toEqual([]);
  });
});
