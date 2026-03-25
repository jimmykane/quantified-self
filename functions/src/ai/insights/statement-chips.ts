import type {
  AiInsightConfidenceTier,
  AiInsightEvidenceRef,
  AiInsightEventLookup,
  AiInsightLatestEvent,
  AiInsightPowerCurve,
  AiInsightStatementChip,
  AiInsightSummary,
  AiInsightsMultiMetricAggregateMetricResult,
} from '../../../../shared/ai-insights.types';
import {
  AI_INSIGHTS_CONFIDENCE_COVERAGE_WEIGHT,
  AI_INSIGHTS_CONFIDENCE_LOW_MAX_SCORE,
  AI_INSIGHTS_CONFIDENCE_MEDIUM_MAX_SCORE,
  AI_INSIGHTS_CONFIDENCE_SAMPLE_WEIGHT,
  AI_INSIGHTS_CONFIDENCE_SIGNAL_WEIGHT,
} from '../../../../shared/ai-insights-anomaly.constants';

interface ConfidenceScoreInput {
  coverage: number;
  sample: number;
  signal: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function resolveConfidenceScore(input: ConfidenceScoreInput): number {
  return (
    (clamp01(input.coverage) * AI_INSIGHTS_CONFIDENCE_COVERAGE_WEIGHT)
    + (clamp01(input.sample) * AI_INSIGHTS_CONFIDENCE_SAMPLE_WEIGHT)
    + (clamp01(input.signal) * AI_INSIGHTS_CONFIDENCE_SIGNAL_WEIGHT)
  );
}

function resolveConfidenceTier(score: number): AiInsightConfidenceTier {
  if (score <= AI_INSIGHTS_CONFIDENCE_LOW_MAX_SCORE) {
    return 'low';
  }
  if (score <= AI_INSIGHTS_CONFIDENCE_MEDIUM_MAX_SCORE) {
    return 'medium';
  }
  return 'high';
}

function resolveCoverageRatio(summary: AiInsightSummary): number {
  if (summary.bucketCoverage?.totalBucketCount && summary.bucketCoverage.totalBucketCount > 0) {
    return summary.bucketCoverage.nonEmptyBucketCount / summary.bucketCoverage.totalBucketCount;
  }

  if (summary.latestBucket || summary.peakBucket || summary.lowestBucket) {
    return 0.65;
  }

  return 0;
}

function resolveSampleRatio(matchedEventCount: number, fullConfidenceCount = 20): number {
  return clamp01(matchedEventCount / Math.max(1, fullConfidenceCount));
}

function resolveSignalRatio(summary: AiInsightSummary): number {
  const trend = summary.trend;
  if (trend?.previousBucket) {
    const denominator = Math.max(Math.abs(trend.previousBucket.aggregateValue), 1e-9);
    return clamp01(Math.abs(trend.deltaAggregateValue) / denominator);
  }

  if (summary.periodDeltas?.length) {
    const maxRelativeDelta = Math.max(
      ...summary.periodDeltas.map((periodDelta) => {
        const denominator = Math.max(Math.abs(periodDelta.fromBucket.aggregateValue), 1e-9);
        return Math.abs(periodDelta.deltaAggregateValue) / denominator;
      }),
    );
    return clamp01(maxRelativeDelta);
  }

  if (summary.anomalyCallouts?.length) {
    const weightedSignal = summary.anomalyCallouts
      .reduce((sum, callout) => sum + Math.abs(callout.score), 0) / summary.anomalyCallouts.length;
    return clamp01(weightedSignal / 5);
  }

  return 0.4;
}

function buildConfidenceChip(
  statementId: string,
  confidenceTier: AiInsightConfidenceTier,
  label = `${confidenceTier[0]?.toUpperCase() || ''}${confidenceTier.slice(1)} confidence`,
): AiInsightStatementChip {
  return {
    statementId,
    chipType: 'confidence',
    label,
    confidenceTier,
  };
}

function dedupeEvidenceRefs(evidenceRefs: AiInsightEvidenceRef[]): AiInsightEvidenceRef[] {
  const seen = new Set<string>();
  const deduped: AiInsightEvidenceRef[] = [];
  evidenceRefs.forEach((evidenceRef) => {
    const key = JSON.stringify(evidenceRef);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(evidenceRef);
  });
  return deduped;
}

function buildEvidenceChip(
  statementId: string,
  evidenceRefs: AiInsightEvidenceRef[],
  label = 'Evidence linked',
): AiInsightStatementChip | null {
  const dedupedEvidenceRefs = dedupeEvidenceRefs(evidenceRefs);
  if (!dedupedEvidenceRefs.length) {
    return null;
  }

  return {
    statementId,
    chipType: 'evidence',
    label,
    evidenceRefs: dedupedEvidenceRefs,
  };
}

function dedupeStatementChips(chips: AiInsightStatementChip[]): AiInsightStatementChip[] {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    const key = `${chip.statementId}:${chip.chipType}:${chip.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildAggregateStatementChips(params: {
  summary: AiInsightSummary;
  eventRanking?: AiInsightEventLookup;
}): AiInsightStatementChip[] {
  const narrativeScore = resolveConfidenceScore({
    coverage: resolveCoverageRatio(params.summary),
    sample: resolveSampleRatio(params.summary.matchedEventCount),
    signal: resolveSignalRatio(params.summary),
  });
  const narrativeTier = resolveConfidenceTier(narrativeScore);

  const chips: AiInsightStatementChip[] = [
    buildConfidenceChip('aggregate:narrative', narrativeTier),
  ];

  if (params.eventRanking?.primaryEventId) {
    const narrativeEvidenceChip = buildEvidenceChip('aggregate:narrative', [{
      kind: 'event',
      label: `Primary event ${params.eventRanking.primaryEventId}`,
      eventId: params.eventRanking.primaryEventId,
    }]);
    if (narrativeEvidenceChip) {
      chips.push(narrativeEvidenceChip);
    }
  }

  if (params.summary.trend && params.summary.latestBucket) {
    const trendScore = resolveConfidenceScore({
      coverage: resolveCoverageRatio(params.summary),
      sample: resolveSampleRatio(params.summary.matchedEventCount),
      signal: resolveSignalRatio(params.summary),
    });
    const trendTier = resolveConfidenceTier(trendScore);
    chips.push(buildConfidenceChip('aggregate:trend', trendTier));
    const trendEvidenceChip = buildEvidenceChip('aggregate:trend', [
      {
        kind: 'bucket',
        label: `Previous ${params.summary.trend.previousBucket.bucketKey}`,
        bucketKey: params.summary.trend.previousBucket.bucketKey,
      },
      {
        kind: 'bucket',
        label: `Latest ${params.summary.latestBucket.bucketKey}`,
        bucketKey: params.summary.latestBucket.bucketKey,
      },
    ]);
    if (trendEvidenceChip) {
      chips.push(trendEvidenceChip);
    }
  }

  if (params.summary.periodDeltas?.length) {
    const largestPeriodDelta = Math.max(
      ...params.summary.periodDeltas.map((periodDelta) => {
        const denominator = Math.max(Math.abs(periodDelta.fromBucket.aggregateValue), 1e-9);
        return Math.abs(periodDelta.deltaAggregateValue) / denominator;
      }),
    );
    const compareScore = resolveConfidenceScore({
      coverage: resolveCoverageRatio(params.summary),
      sample: resolveSampleRatio(params.summary.matchedEventCount),
      signal: largestPeriodDelta,
    });
    chips.push(buildConfidenceChip('aggregate:compare', resolveConfidenceTier(compareScore)));
    const firstPeriodDelta = params.summary.periodDeltas[0];
    const compareEvidenceRefs: AiInsightEvidenceRef[] = [
      {
        kind: 'bucket',
        label: `From ${firstPeriodDelta.fromBucket.bucketKey}`,
        bucketKey: firstPeriodDelta.fromBucket.bucketKey,
      },
      {
        kind: 'bucket',
        label: `To ${firstPeriodDelta.toBucket.bucketKey}`,
        bucketKey: firstPeriodDelta.toBucket.bucketKey,
      },
      ...((firstPeriodDelta.eventContributors ?? []).slice(0, 1).map((eventContributor) => ({
        kind: 'event' as const,
        label: `Event ${eventContributor.eventId}`,
        eventId: eventContributor.eventId,
      }))),
    ];
    const compareEvidenceChip = buildEvidenceChip('aggregate:compare', compareEvidenceRefs);
    if (compareEvidenceChip) {
      chips.push(compareEvidenceChip);
    }
  }

  (params.summary.anomalyCallouts ?? []).forEach((callout) => {
    chips.push(buildConfidenceChip(callout.statementId, callout.confidenceTier));
    const anomalyEvidenceChip = buildEvidenceChip(callout.statementId, callout.evidenceRefs);
    if (anomalyEvidenceChip) {
      chips.push(anomalyEvidenceChip);
    }
  });

  return dedupeStatementChips(chips);
}

function buildSummaryMetricStatementChips(params: {
  statementId: string;
  summary: AiInsightSummary;
  evidenceLabel?: string;
}): AiInsightStatementChip[] {
  const score = resolveConfidenceScore({
    coverage: resolveCoverageRatio(params.summary),
    sample: resolveSampleRatio(params.summary.matchedEventCount),
    signal: resolveSignalRatio(params.summary),
  });
  const chips: AiInsightStatementChip[] = [
    buildConfidenceChip(params.statementId, resolveConfidenceTier(score)),
  ];

  const evidenceRefs: AiInsightEvidenceRef[] = [];
  if (params.summary.trend) {
    evidenceRefs.push({
      kind: 'bucket',
      label: `Previous ${params.summary.trend.previousBucket.bucketKey}`,
      bucketKey: params.summary.trend.previousBucket.bucketKey,
    });
    if (params.summary.latestBucket) {
      evidenceRefs.push({
        kind: 'bucket',
        label: `Latest ${params.summary.latestBucket.bucketKey}`,
        bucketKey: params.summary.latestBucket.bucketKey,
      });
    }
  }

  const anomalyEvidenceRefs = (params.summary.anomalyCallouts ?? [])
    .flatMap(callout => callout.evidenceRefs)
    .slice(0, 4);
  evidenceRefs.push(...anomalyEvidenceRefs);
  const evidenceChip = buildEvidenceChip(params.statementId, evidenceRefs, params.evidenceLabel);
  if (evidenceChip) {
    chips.push(evidenceChip);
  }

  (params.summary.anomalyCallouts ?? []).forEach((callout) => {
    chips.push(buildConfidenceChip(callout.statementId, callout.confidenceTier));
    const anomalyEvidenceChip = buildEvidenceChip(callout.statementId, callout.evidenceRefs);
    if (anomalyEvidenceChip) {
      chips.push(anomalyEvidenceChip);
    }
  });

  return chips;
}

export function buildMultiMetricStatementChips(params: {
  metricResults: AiInsightsMultiMetricAggregateMetricResult[];
}): AiInsightStatementChip[] {
  const metricChips = params.metricResults.flatMap((metricResult) => buildSummaryMetricStatementChips({
    statementId: `multi_metric:${metricResult.metricKey}`,
    summary: metricResult.summary,
    evidenceLabel: `${metricResult.metricLabel} evidence`,
  }));

  const confidenceScores = params.metricResults.map((metricResult) => resolveConfidenceScore({
    coverage: resolveCoverageRatio(metricResult.summary),
    sample: resolveSampleRatio(metricResult.summary.matchedEventCount),
    signal: resolveSignalRatio(metricResult.summary),
  }));
  const narrativeScore = confidenceScores.length
    ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
    : 0;
  const chips: AiInsightStatementChip[] = [
    buildConfidenceChip('multi_metric:narrative', resolveConfidenceTier(narrativeScore)),
    ...metricChips,
  ];
  return dedupeStatementChips(chips);
}

export function buildEventLookupStatementChips(eventLookup: AiInsightEventLookup): AiInsightStatementChip[] {
  const coverage = eventLookup.matchedEventCount > 0
    ? eventLookup.topEventIds.length / eventLookup.matchedEventCount
    : 0;
  const sample = resolveSampleRatio(eventLookup.matchedEventCount);
  const signal = eventLookup.primaryEventId ? 0.75 : 0.2;
  const score = resolveConfidenceScore({ coverage, sample, signal });
  const chips: AiInsightStatementChip[] = [
    buildConfidenceChip('event_lookup:narrative', resolveConfidenceTier(score)),
  ];

  if (eventLookup.primaryEventId) {
    const evidenceChip = buildEvidenceChip('event_lookup:narrative', [{
      kind: 'event',
      label: `Primary event ${eventLookup.primaryEventId}`,
      eventId: eventLookup.primaryEventId,
    }]);
    if (evidenceChip) {
      chips.push(evidenceChip);
    }
  }

  return chips;
}

export function buildLatestEventStatementChips(latestEvent: AiInsightLatestEvent): AiInsightStatementChip[] {
  const score = resolveConfidenceScore({
    coverage: latestEvent.matchedEventCount > 0 ? 1 : 0,
    sample: resolveSampleRatio(latestEvent.matchedEventCount),
    signal: latestEvent.eventId ? 0.7 : 0.2,
  });
  const chips: AiInsightStatementChip[] = [
    buildConfidenceChip('latest_event:narrative', resolveConfidenceTier(score)),
  ];

  if (latestEvent.eventId) {
    const evidenceChip = buildEvidenceChip('latest_event:narrative', [{
      kind: 'event',
      label: `Latest event ${latestEvent.eventId}`,
      eventId: latestEvent.eventId,
    }]);
    if (evidenceChip) {
      chips.push(evidenceChip);
    }
  }

  return chips;
}

export function buildPowerCurveStatementChips(powerCurve: AiInsightPowerCurve): AiInsightStatementChip[] {
  const coverage = powerCurve.requestedSeriesCount > 0
    ? powerCurve.returnedSeriesCount / powerCurve.requestedSeriesCount
    : 0;
  const sample = resolveSampleRatio(powerCurve.matchedEventCount);
  const signal = powerCurve.series.length > 0 ? 0.8 : 0;
  const score = resolveConfidenceScore({ coverage, sample, signal });
  const chips: AiInsightStatementChip[] = [
    buildConfidenceChip('power_curve:narrative', resolveConfidenceTier(score)),
  ];

  if (powerCurve.series.length > 0) {
    const evidenceChip = buildEvidenceChip(
      'power_curve:narrative',
      powerCurve.series.slice(0, 3).map((series) => ({
        kind: 'series' as const,
        label: series.label,
        seriesKey: series.seriesKey,
      })),
    );
    if (evidenceChip) {
      chips.push(evidenceChip);
    }
  }

  return chips;
}
