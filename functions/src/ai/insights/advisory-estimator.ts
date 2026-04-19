import type { EventInterface } from '@sports-alliance/sports-lib';
import type {
  AiInsightAdvisoryResult,
  AiInsightConfidenceTier,
  NormalizedInsightAdvisoryQuery,
} from '../../../../shared/ai-insights.types';
import type { AiInsightsPromptMetricKey } from '../../../../shared/ai-insights-prompts';
import {
  FTP_ADVISORY_ESTIMATOR,
} from './advisory-estimators/ftp.estimator';
import {
  HEART_RATE_ADVISORY_ESTIMATOR,
} from './advisory-estimators/heart-rate.estimator';

export type AdvisoryEstimatorEligibilityStatus =
  | 'eligible'
  | 'insufficient_data'
  | 'unsupported';

export interface AdvisoryEstimatorEligibilityResult {
  status: AdvisoryEstimatorEligibilityStatus;
  reason?: string;
}

export interface AdvisoryEstimatorEstimateResult {
  pointEstimate: number;
  rangeLow: number;
  rangeHigh: number;
  confidenceTier: AiInsightConfidenceTier;
  evidence: string[];
}

export interface AdvisoryEstimatorInput {
  query: NormalizedInsightAdvisoryQuery;
  matchedEvents: EventInterface[];
}

export interface AdvisoryMetricEstimator {
  metricKey: AiInsightsPromptMetricKey;
  enabled: boolean;
  isEligible: (input: AdvisoryEstimatorInput) => AdvisoryEstimatorEligibilityResult;
  estimate: (input: AdvisoryEstimatorInput) => AdvisoryEstimatorEstimateResult;
  explainability: (
    input: AdvisoryEstimatorInput,
    output: AdvisoryEstimatorEstimateResult,
  ) => string;
}

const ADVISORY_ESTIMATORS: Partial<Record<AiInsightsPromptMetricKey, AdvisoryMetricEstimator>> = {
  heart_rate: HEART_RATE_ADVISORY_ESTIMATOR,
  ftp: FTP_ADVISORY_ESTIMATOR,
};

export const ADVISORY_ESTIMATOR_KEYS = Object.freeze(
  Object.keys(ADVISORY_ESTIMATORS) as AiInsightsPromptMetricKey[],
);

export function resolveAdvisoryEstimator(
  metricKey: AiInsightsPromptMetricKey,
): AdvisoryMetricEstimator | null {
  return ADVISORY_ESTIMATORS[metricKey] ?? null;
}

function buildUnsupportedResult(
  metricKey: AiInsightsPromptMetricKey,
  reason: string,
): AiInsightAdvisoryResult {
  return {
    status: 'unsupported',
    metricKey,
    estimate: null,
    rangeLow: null,
    rangeHigh: null,
    confidenceTier: null,
    evidenceSummary: reason,
  };
}

function buildInsufficientDataResult(
  metricKey: AiInsightsPromptMetricKey,
  reason: string,
): AiInsightAdvisoryResult {
  return {
    status: 'insufficient_data',
    metricKey,
    estimate: null,
    rangeLow: null,
    rangeHigh: null,
    confidenceTier: null,
    evidenceSummary: reason,
    insufficientDataReason: reason,
  };
}

const CONFIDENCE_TIERS: ReadonlySet<AiInsightConfidenceTier> = new Set([
  'low',
  'medium',
  'high',
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeEstimateResult(
  estimate: AdvisoryEstimatorEstimateResult,
): AdvisoryEstimatorEstimateResult | null {
  if (
    !isFiniteNumber(estimate.pointEstimate)
    || !isFiniteNumber(estimate.rangeLow)
    || !isFiniteNumber(estimate.rangeHigh)
    || !CONFIDENCE_TIERS.has(estimate.confidenceTier)
  ) {
    return null;
  }

  const pointEstimate = estimate.pointEstimate;
  let rangeLow = Math.min(estimate.rangeLow, estimate.rangeHigh);
  let rangeHigh = Math.max(estimate.rangeLow, estimate.rangeHigh);
  if (pointEstimate < rangeLow) {
    rangeLow = pointEstimate;
  }
  if (pointEstimate > rangeHigh) {
    rangeHigh = pointEstimate;
  }

  const evidence = Array.isArray(estimate.evidence)
    ? estimate.evidence
      .map(value => `${value || ''}`.trim())
      .filter(value => value.length > 0)
    : [];

  return {
    pointEstimate,
    rangeLow,
    rangeHigh,
    confidenceTier: estimate.confidenceTier,
    evidence,
  };
}

export function executeAdvisoryEstimatorWithResolvedEstimator(
  input: AdvisoryEstimatorInput,
  estimator: AdvisoryMetricEstimator | null,
): AiInsightAdvisoryResult {
  if (!estimator || !estimator.enabled) {
    return buildUnsupportedResult(
      input.query.metricKey,
      `Advisory support for ${input.query.metricKey} is not enabled yet.`,
    );
  }

  const eligibility = estimator.isEligible(input);
  if (eligibility.status === 'unsupported') {
    return buildUnsupportedResult(
      input.query.metricKey,
      eligibility.reason || `Advisory support for ${input.query.metricKey} is not available.`,
    );
  }

  if (eligibility.status === 'insufficient_data') {
    return buildInsufficientDataResult(
      input.query.metricKey,
      eligibility.reason || `Not enough ${input.query.metricKey} data was found in the selected range.`,
    );
  }

  const estimate = normalizeEstimateResult(estimator.estimate(input));
  if (!estimate) {
    return buildUnsupportedResult(
      input.query.metricKey,
      `Advisory estimator for ${input.query.metricKey} returned invalid estimate output.`,
    );
  }

  const explainabilitySummary = `${estimator.explainability(input, estimate) || ''}`.trim();
  const evidenceSummary = explainabilitySummary
    || (estimate.evidence.length
      ? estimate.evidence.join('; ')
      : `Deterministic advisory estimate for ${input.query.metricKey}.`);
  return {
    status: 'available',
    metricKey: input.query.metricKey,
    estimate: estimate.pointEstimate,
    rangeLow: estimate.rangeLow,
    rangeHigh: estimate.rangeHigh,
    confidenceTier: estimate.confidenceTier,
    evidenceSummary,
  };
}

export function executeAdvisoryEstimator(
  input: AdvisoryEstimatorInput,
): AiInsightAdvisoryResult {
  return executeAdvisoryEstimatorWithResolvedEstimator(
    input,
    resolveAdvisoryEstimator(input.query.metricKey),
  );
}
