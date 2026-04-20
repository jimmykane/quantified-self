import {
  DataHeartRateMax,
  type EventInterface,
} from '@sports-alliance/sports-lib';
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

export type AdvisoryEstimatorReasonCode =
  | 'no_samples'
  | 'low_intensity_scope'
  | 'too_few_samples'
  | 'too_few_weeks'
  | 'stale_data'
  | 'weak_tail_signal';

export interface AdvisoryEstimatorEligibilityResult {
  status: AdvisoryEstimatorEligibilityStatus;
  reasonCode?: AdvisoryEstimatorReasonCode;
  message?: string;
  suggestedQuery?: string;
  details?: Record<string, string | number | boolean>;
}

export interface AdvisoryEstimatorEstimateResult {
  semanticKind: 'current_ceiling' | 'potential_ceiling';
  estimate: {
    value: number;
    unit: string;
  };
  interval: {
    low: number;
    high: number;
    kind: 'deterministic_range';
    confidenceLevel: AiInsightConfidenceTier;
  };
  observed: {
    bestValue: number | null;
    bestDate: string | null;
    sampleCount: number;
    qualifyingSampleCount: number;
    trainingWeeks: number;
    recencyDays: number | null;
  };
  confidence: {
    tier: AiInsightConfidenceTier;
    score: number;
    reasons: string[];
  };
  method: {
    id: string;
    version: string;
    deterministic: true;
  };
  evidence: Array<{
    code: string;
    label: string;
    value: string;
  }>;
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

const CONFIDENCE_TIERS: ReadonlySet<AiInsightConfidenceTier> = new Set([
  'low',
  'medium',
  'high',
]);
const HEART_RATE_INVARIANT_MAX_BPM = 230;
const HEART_RATE_INVARIANT_SPIKE_TRIM_FLOOR_BPM = 220;
const HEART_RATE_INVARIANT_SPIKE_TRIM_GAP_BPM = 6;
const DEFAULT_METHOD_VERSION = 'v2';
const DEFAULT_INSUFFICIENT_QUERY = 'Show my max heart rate over time this year.';
const ADVISORY_SEMANTIC_KIND_BY_KIND = {
  expected_value: 'current_ceiling',
  potential_value: 'potential_ceiling',
} as const;

function resolveExpectedSemanticKind(
  query: NormalizedInsightAdvisoryQuery,
): AiInsightAdvisoryResult['semanticKind'] {
  return ADVISORY_SEMANTIC_KIND_BY_KIND[query.advisoryKind] ?? 'current_ceiling';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeConfidenceTier(
  value: unknown,
): AiInsightConfidenceTier | null {
  return CONFIDENCE_TIERS.has(value as AiInsightConfidenceTier)
    ? value as AiInsightConfidenceTier
    : null;
}

function normalizeIsoDateOrNull(
  value: string,
): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveFiniteDetailNumber(
  details: AdvisoryEstimatorEligibilityResult['details'],
  key: string,
): number | null {
  if (!details) {
    return null;
  }

  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function resolveStringDetail(
  details: AdvisoryEstimatorEligibilityResult['details'],
  key: string,
): string | null {
  if (!details) {
    return null;
  }

  const value = details[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function resolveObservedDiagnosticsFromDetails(
  details: AdvisoryEstimatorEligibilityResult['details'],
): AiInsightAdvisoryResult['observed'] {
  const sampleCount = resolveFiniteDetailNumber(details, 'sampleCount');
  const qualifyingSampleCount = resolveFiniteDetailNumber(details, 'qualifyingSampleCount');
  const trainingWeeks = resolveFiniteDetailNumber(details, 'trainingWeeks')
    ?? resolveFiniteDetailNumber(details, 'distinctWeekCount');
  const recencyDays = resolveFiniteDetailNumber(details, 'recencyDays');
  const bestValue = resolveFiniteDetailNumber(details, 'bestValue')
    ?? resolveFiniteDetailNumber(details, 'observedMax');
  const bestDate = resolveStringDetail(details, 'bestDate')
    ?? resolveStringDetail(details, 'latestSampleDate');

  return {
    bestValue: bestValue === null ? null : bestValue,
    bestDate: bestDate ? normalizeIsoDateOrNull(bestDate) : null,
    sampleCount: sampleCount === null ? 0 : Math.max(0, Math.floor(sampleCount)),
    qualifyingSampleCount: qualifyingSampleCount === null ? 0 : Math.max(0, Math.floor(qualifyingSampleCount)),
    trainingWeeks: trainingWeeks === null ? 0 : Math.max(0, Math.floor(trainingWeeks)),
    recencyDays: recencyDays === null ? null : Math.max(0, Math.floor(recencyDays)),
  };
}

function buildBaseResult(
  query: NormalizedInsightAdvisoryQuery,
  status: AiInsightAdvisoryResult['status'],
): AiInsightAdvisoryResult {
  return {
    status,
    metricKey: query.metricKey,
    semanticKind: resolveExpectedSemanticKind(query),
    estimate: null,
    interval: null,
    observed: {
      bestValue: null,
      bestDate: null,
      sampleCount: 0,
      qualifyingSampleCount: 0,
      trainingWeeks: 0,
      recencyDays: null,
    },
    confidence: {
      tier: null,
      score: null,
      reasons: [],
    },
    method: {
      id: `advisory-${query.metricKey}`,
      version: DEFAULT_METHOD_VERSION,
      deterministic: true,
    },
    evidence: [],
  };
}

function buildUnsupportedResult(
  query: NormalizedInsightAdvisoryQuery,
  message: string,
): AiInsightAdvisoryResult {
  const result = buildBaseResult(query, 'unsupported');
  result.evidence = [{
    code: 'unsupported',
    label: 'Unsupported',
    value: message,
  }];
  result.method = {
    id: `advisory-${query.metricKey}-unsupported`,
    version: DEFAULT_METHOD_VERSION,
    deterministic: true,
  };
  return result;
}

function buildInsufficientDataResult(
  query: NormalizedInsightAdvisoryQuery,
  reasonCode: AdvisoryEstimatorReasonCode,
  message: string,
  suggestedQuery: string,
  details: AdvisoryEstimatorEligibilityResult['details'] | undefined,
): AiInsightAdvisoryResult {
  const result = buildBaseResult(query, 'insufficient_data');
  result.observed = resolveObservedDiagnosticsFromDetails(details);
  result.insufficientData = {
    reasonCode,
    message,
    suggestedQuery,
  };
  const observedDiagnosticsEvidence: AiInsightAdvisoryResult['evidence'] = [];
  if (result.observed.sampleCount > 0) {
    observedDiagnosticsEvidence.push({
      code: 'sample_count',
      label: 'Valid samples',
      value: `${result.observed.sampleCount}`,
    });
  }
  if (result.observed.trainingWeeks > 0) {
    observedDiagnosticsEvidence.push({
      code: 'training_weeks',
      label: 'Training weeks',
      value: `${result.observed.trainingWeeks}`,
    });
  }
  if (result.observed.qualifyingSampleCount > 0) {
    observedDiagnosticsEvidence.push({
      code: 'qualifying_samples',
      label: 'Qualifying samples',
      value: `${result.observed.qualifyingSampleCount}`,
    });
  }
  if (result.observed.recencyDays !== null) {
    observedDiagnosticsEvidence.push({
      code: 'recency_days',
      label: 'Recency',
      value: `${result.observed.recencyDays} days`,
    });
  }
  if (result.observed.bestValue !== null) {
    observedDiagnosticsEvidence.push({
      code: 'best_value',
      label: 'Observed best value',
      value: `${result.observed.bestValue}`,
    });
  }

  result.evidence = [{
    code: reasonCode,
    label: 'Insufficient data',
    value: message,
  }, ...observedDiagnosticsEvidence];
  result.method = {
    id: `advisory-${query.metricKey}-insufficient`,
    version: DEFAULT_METHOD_VERSION,
    deterministic: true,
  };
  return result;
}

function normalizeEvidence(
  evidence: AdvisoryEstimatorEstimateResult['evidence'],
): AdvisoryEstimatorEstimateResult['evidence'] {
  if (!Array.isArray(evidence)) {
    return [];
  }

  const seenEntries = new Set<string>();
  return evidence
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const code = `${entry.code || ''}`.trim();
      const label = `${entry.label || ''}`.trim();
      const value = `${entry.value || ''}`.trim();
      if (!code || !label || !value) {
        return null;
      }
      const dedupeKey = `${code}|${label}|${value}`;
      if (seenEntries.has(dedupeKey)) {
        return null;
      }
      seenEntries.add(dedupeKey);
      return {
        code,
        label,
        value,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeEstimateResult(
  estimate: AdvisoryEstimatorEstimateResult,
): AdvisoryEstimatorEstimateResult | null {
  if (
    !estimate
    || (estimate.semanticKind !== 'current_ceiling' && estimate.semanticKind !== 'potential_ceiling')
  ) {
    return null;
  }
  if (
    !isRecord(estimate.estimate)
    || !isRecord(estimate.interval)
    || !isRecord(estimate.observed)
    || !isRecord(estimate.confidence)
    || !isRecord(estimate.method)
  ) {
    return null;
  }

  if (
    !isFiniteNumber(estimate.estimate?.value)
    || !`${estimate.estimate?.unit || ''}`.trim()
    || !isFiniteNumber(estimate.interval?.low)
    || !isFiniteNumber(estimate.interval?.high)
    || estimate.interval?.kind !== 'deterministic_range'
  ) {
    return null;
  }

  const confidenceLevel = normalizeConfidenceTier(estimate.interval.confidenceLevel);
  const confidenceTier = normalizeConfidenceTier(estimate.confidence?.tier);
  if (!confidenceLevel || !confidenceTier) {
    return null;
  }

  const rangeLow = Math.min(estimate.interval.low, estimate.interval.high);
  const rangeHigh = Math.max(estimate.interval.low, estimate.interval.high);
  const pointEstimate = estimate.estimate.value;
  const coercedRangeLow = Math.min(rangeLow, pointEstimate);
  const coercedRangeHigh = Math.max(rangeHigh, pointEstimate);

  const confidenceScore = isFiniteNumber(estimate.confidence.score)
    ? clamp(estimate.confidence.score, 0, 1)
    : null;
  if (confidenceScore === null) {
    return null;
  }

  const reasons = Array.isArray(estimate.confidence.reasons)
    ? estimate.confidence.reasons
      .map(reason => `${reason || ''}`.trim())
      .filter(reason => reason.length > 0)
    : [];

  const observedSampleCount = Number.isFinite(estimate.observed.sampleCount)
    ? Math.max(0, Math.floor(estimate.observed.sampleCount))
    : 0;
  const qualifyingSampleCount = Number.isFinite(estimate.observed.qualifyingSampleCount)
    ? Math.max(0, Math.floor(estimate.observed.qualifyingSampleCount))
    : 0;
  const trainingWeeks = Number.isFinite(estimate.observed.trainingWeeks)
    ? Math.max(0, Math.floor(estimate.observed.trainingWeeks))
    : 0;
  const recencyDays = estimate.observed.recencyDays === null
    ? null
    : Number.isFinite(estimate.observed.recencyDays)
      ? Math.max(0, Math.floor(estimate.observed.recencyDays))
      : null;
  const bestDate = `${estimate.observed.bestDate || ''}`.trim();

  const methodId = `${estimate.method.id || ''}`.trim();
  const methodVersion = `${estimate.method.version || ''}`.trim();
  if (!methodId || !methodVersion || estimate.method.deterministic !== true) {
    return null;
  }

  return {
    semanticKind: estimate.semanticKind,
    estimate: {
      value: pointEstimate,
      unit: `${estimate.estimate.unit}`.trim(),
    },
    interval: {
      low: coercedRangeLow,
      high: coercedRangeHigh,
      kind: 'deterministic_range',
      confidenceLevel,
    },
    observed: {
      bestValue: isFiniteNumber(estimate.observed.bestValue)
        ? estimate.observed.bestValue
        : null,
      bestDate: bestDate ? normalizeIsoDateOrNull(bestDate) : null,
      sampleCount: observedSampleCount,
      qualifyingSampleCount,
      trainingWeeks,
      recencyDays,
    },
    confidence: {
      tier: confidenceTier,
      score: confidenceScore,
      reasons,
    },
    method: {
      id: methodId,
      version: methodVersion,
      deterministic: true,
    },
    evidence: normalizeEvidence(estimate.evidence),
  };
}

function resolveObservedHeartRateMax(
  matchedEvents: EventInterface[],
): number | null {
  const observedValues = matchedEvents
    .map((event) => {
      const stat = event.getStat?.(DataHeartRateMax.type);
      const value = Number(stat?.getValue?.());
      return Number.isFinite(value) && value >= 80 && value <= HEART_RATE_INVARIANT_MAX_BPM
        ? value
        : null;
    })
    .filter((value): value is number => value !== null);

  if (!observedValues.length) {
    return null;
  }

  const sortedObservedValues = observedValues.sort((left, right) => left - right);
  while (sortedObservedValues.length >= 2) {
    const observedMax = sortedObservedValues[sortedObservedValues.length - 1] ?? 0;
    const secondHighest = sortedObservedValues[sortedObservedValues.length - 2] ?? observedMax;
    if (
      observedMax > HEART_RATE_INVARIANT_SPIKE_TRIM_FLOOR_BPM
      && (observedMax - secondHighest) >= HEART_RATE_INVARIANT_SPIKE_TRIM_GAP_BPM
    ) {
      sortedObservedValues.pop();
      continue;
    }
    break;
  }

  return sortedObservedValues[sortedObservedValues.length - 1] ?? null;
}

function applyMetricSpecificInvariants(
  input: AdvisoryEstimatorInput,
  estimate: AdvisoryEstimatorEstimateResult,
): AdvisoryEstimatorEstimateResult {
  if (input.query.metricKey !== 'heart_rate') {
    return estimate;
  }

  const observedMax = resolveObservedHeartRateMax(input.matchedEvents);
  if (observedMax === null) {
    return estimate;
  }

  const pointEstimate = Math.max(estimate.estimate.value, observedMax);
  const intervalLow = Math.min(estimate.interval.low, pointEstimate);
  const intervalHigh = Math.max(estimate.interval.high, pointEstimate, observedMax);

  return {
    ...estimate,
    estimate: {
      ...estimate.estimate,
      value: pointEstimate,
    },
    interval: {
      ...estimate.interval,
      low: intervalLow,
      high: intervalHigh,
    },
    observed: {
      ...estimate.observed,
      bestValue: observedMax,
    },
  };
}

export function executeAdvisoryEstimatorWithResolvedEstimator(
  input: AdvisoryEstimatorInput,
  estimator: AdvisoryMetricEstimator | null,
): AiInsightAdvisoryResult {
  if (!estimator || !estimator.enabled) {
    return buildUnsupportedResult(
      input.query,
      `Advisory support for ${input.query.metricKey} is not enabled yet.`,
    );
  }

  let eligibility: AdvisoryEstimatorEligibilityResult;
  try {
    eligibility = estimator.isEligible(input);
  } catch {
    return buildUnsupportedResult(
      input.query,
      `Advisory estimator for ${input.query.metricKey} failed eligibility checks.`,
    );
  }

  if (eligibility.status === 'unsupported') {
    return buildUnsupportedResult(
      input.query,
      eligibility.message || `Advisory support for ${input.query.metricKey} is not available.`,
    );
  }

  if (eligibility.status === 'insufficient_data') {
    return buildInsufficientDataResult(
      input.query,
      eligibility.reasonCode || 'too_few_samples',
      eligibility.message || `Not enough ${input.query.metricKey} data was found in the selected range.`,
      eligibility.suggestedQuery || DEFAULT_INSUFFICIENT_QUERY,
      eligibility.details,
    );
  }

  let rawEstimate: AdvisoryEstimatorEstimateResult;
  try {
    rawEstimate = estimator.estimate(input);
  } catch {
    return buildUnsupportedResult(
      input.query,
      `Advisory estimator for ${input.query.metricKey} failed while estimating.`,
    );
  }

  const normalizedEstimate = normalizeEstimateResult(rawEstimate);
  if (!normalizedEstimate) {
    return buildUnsupportedResult(
      input.query,
      `Advisory estimator for ${input.query.metricKey} returned invalid estimate output.`,
    );
  }
  if (normalizedEstimate.semanticKind !== resolveExpectedSemanticKind(input.query)) {
    return buildUnsupportedResult(
      input.query,
      `Advisory estimator for ${input.query.metricKey} returned mismatched semantic output.`,
    );
  }
  const estimate = applyMetricSpecificInvariants(input, normalizedEstimate);

  let explainabilitySummary = '';
  try {
    explainabilitySummary = `${estimator.explainability(input, estimate) || ''}`.trim();
  } catch {
    explainabilitySummary = '';
  }
  const evidence = explainabilitySummary
    ? [{
      code: 'summary',
      label: 'Summary',
      value: explainabilitySummary,
    }, ...estimate.evidence]
    : estimate.evidence;

  return {
    status: 'available',
    metricKey: input.query.metricKey,
    semanticKind: estimate.semanticKind,
    estimate: estimate.estimate,
    interval: estimate.interval,
    observed: estimate.observed,
    confidence: estimate.confidence,
    method: estimate.method,
    evidence,
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
