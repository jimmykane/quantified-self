import {
  ActivityTypes,
  ActivityTypesHelper,
  DataCadenceAvg,
  DataHeartRateMax,
  DataPaceAvg,
  DataPowerAvg,
  DataSpeedAvg,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import {
  clamp,
  extractValidSamples,
  percentile,
  resolveConfidenceTierFromScore,
  resolveDateRangeEndTime,
  resolveRecencyDays,
  resolveTailQuality,
  resolveTrainingWeekCoverage,
  roundToInteger,
  trimIsolatedSpikes,
  type AdvisorySample,
} from './advisory-utils';
import type {
  AdvisoryEstimatorInput,
  AdvisoryEstimatorEstimateResult,
  AdvisoryEstimatorEligibilityResult,
  AdvisoryMetricEstimator,
} from '../advisory-estimator';

const MIN_HEART_RATE_SAMPLE_COUNT = 8;
const MIN_HEART_RATE_COVERAGE_WEEKS = 3;
const MAX_STALE_SAMPLE_DAYS = 120;
const BPM_MIN = 80;
const BPM_CAP = 230;
const ISOLATED_SPIKE_TRIM_FLOOR_BPM = 220;
const ISOLATED_SPIKE_TRIM_GAP_BPM = 6;
const TAIL_GAP_CONFIDENCE_PENALTY_BPM = 8;
const LOW_CONFIDENCE_RANGE_LOW_DELTA = 12;
const MEDIUM_CONFIDENCE_RANGE_LOW_DELTA = 9;
const HIGH_CONFIDENCE_RANGE_LOW_DELTA = 7;
const LOW_CONFIDENCE_RANGE_HIGH_MARGIN = 3;
const MEDIUM_CONFIDENCE_RANGE_HIGH_MARGIN = 2;
const HIGH_CONFIDENCE_RANGE_HIGH_MARGIN = 1;
const SAMPLE_VOLUME_WEIGHT = 0.35;
const COVERAGE_WEIGHT = 0.25;
const RECENCY_WEIGHT = 0.20;
const TAIL_STRENGTH_WEIGHT = 0.20;
const LOW_INTENSITY_MAX_HR_ACTIVITY_TYPES = new Set<ActivityTypes>([
  ActivityTypes.Walking,
  ActivityTypes.Hiking,
  ActivityTypes.NordicWalking,
  ActivityTypes.Yoga,
  ActivityTypes.Pilates,
  ActivityTypes.Stretching,
  ActivityTypes.FlexibilityTraining,
  ActivityTypes.WeightTraining,
  ActivityTypes.StrengthTraining,
  ActivityTypes.Training,
]);
const SUPPORT_SIGNAL_DATA_TYPES = [
  DataPowerAvg.type,
  DataSpeedAvg.type,
  DataPaceAvg.type,
  DataCadenceAvg.type,
] as const;
const DEFAULT_SUGGESTED_QUERY = 'Show my max heart rate over time this year.';

function resolveHeartRateMax(event: EventInterface): number | null {
  const stat = event.getStat?.(DataHeartRateMax.type);
  const rawValue = Number(stat?.getValue?.());
  if (!Number.isFinite(rawValue)) {
    return null;
  }

  return rawValue;
}

function collectHeartRateSamples(
  events: EventInterface[],
): AdvisorySample[] {
  const extractedSamples = extractValidSamples(events, {
    resolveValue: resolveHeartRateMax,
    minValue: BPM_MIN,
    maxValue: BPM_CAP,
  });
  return trimIsolatedSpikes(extractedSamples, {
    trimFloor: ISOLATED_SPIKE_TRIM_FLOOR_BPM,
    trimGap: ISOLATED_SPIKE_TRIM_GAP_BPM,
  });
}

function resolveCanonicalActivityTypes(
  event: EventInterface,
): ActivityTypes[] {
  const rawActivityTypes = event.getActivityTypesAsArray?.();
  if (!Array.isArray(rawActivityTypes)) {
    return [];
  }

  const resolved = rawActivityTypes
    .map(rawType => ActivityTypesHelper.resolveActivityType(`${rawType || ''}`))
    .filter((activityType): activityType is ActivityTypes => Boolean(activityType));
  return [...new Set(resolved)];
}

function resolveSampleActivityTypes(
  samples: AdvisorySample[],
): ActivityTypes[] {
  const resolved = new Set<ActivityTypes>();

  samples.forEach((sample) => {
    resolveCanonicalActivityTypes(sample.event).forEach(activityType => resolved.add(activityType));
  });

  return [...resolved];
}

function isLowIntensityScope(
  activityTypes: ActivityTypes[],
): boolean {
  if (!activityTypes.length) {
    return false;
  }

  return activityTypes.every(activityType => LOW_INTENSITY_MAX_HR_ACTIVITY_TYPES.has(activityType));
}

function resolveRangeLowDelta(
  confidenceTier: AdvisoryEstimatorEstimateResult['confidence']['tier'],
): number {
  if (confidenceTier === 'high') {
    return HIGH_CONFIDENCE_RANGE_LOW_DELTA;
  }
  if (confidenceTier === 'medium') {
    return MEDIUM_CONFIDENCE_RANGE_LOW_DELTA;
  }
  return LOW_CONFIDENCE_RANGE_LOW_DELTA;
}

function resolveRangeHighMargin(
  confidenceTier: AdvisoryEstimatorEstimateResult['confidence']['tier'],
): number {
  if (confidenceTier === 'high') {
    return HIGH_CONFIDENCE_RANGE_HIGH_MARGIN;
  }
  if (confidenceTier === 'medium') {
    return MEDIUM_CONFIDENCE_RANGE_HIGH_MARGIN;
  }
  return LOW_CONFIDENCE_RANGE_HIGH_MARGIN;
}

function hasSupportSignal(event: EventInterface, dataType: string): boolean {
  const stat = event.getStat?.(dataType);
  const value = Number(stat?.getValue?.());
  return Number.isFinite(value);
}

function resolveSupportSignalModifier(
  samples: AdvisorySample[],
  observedMax: number,
): {
  modifier: number;
  reason: string;
} {
  const tailSamples = samples.filter(sample => (observedMax - sample.value) <= 3);
  if (!tailSamples.length) {
    return {
      modifier: 0,
      reason: 'No tail sessions available for support-signal adjustment.',
    };
  }

  const supportCoverage = tailSamples
    .map((sample) => {
      const signalCount = SUPPORT_SIGNAL_DATA_TYPES
        .filter(dataType => hasSupportSignal(sample.event, dataType))
        .length;
      return signalCount / SUPPORT_SIGNAL_DATA_TYPES.length;
    })
    .reduce((sum, value) => sum + value, 0) / tailSamples.length;

  if (supportCoverage >= 0.75) {
    return {
      modifier: 0.05,
      reason: `Strong support-signal coverage in top-tail sessions (${roundToInteger(supportCoverage * 100)}%).`,
    };
  }

  if (supportCoverage >= 0.40) {
    return {
      modifier: 0.02,
      reason: `Moderate support-signal coverage in top-tail sessions (${roundToInteger(supportCoverage * 100)}%).`,
    };
  }

  if (supportCoverage > 0) {
    return {
      modifier: -0.02,
      reason: `Limited support-signal coverage in top-tail sessions (${roundToInteger(supportCoverage * 100)}%).`,
    };
  }

  return {
    modifier: -0.05,
    reason: 'No support-signal coverage in top-tail sessions (power/speed/pace/cadence missing).',
  };
}

function resolveEligibility(
  input: AdvisoryEstimatorInput,
  samples: AdvisorySample[],
): AdvisoryEstimatorEligibilityResult {
  if (!samples.length) {
    return {
      status: 'insufficient_data',
      reasonCode: 'no_samples',
      message: 'No events with max heart-rate samples were found in this scope.',
      suggestedQuery: DEFAULT_SUGGESTED_QUERY,
    };
  }

  const sampleActivityTypes = resolveSampleActivityTypes(samples);
  if (isLowIntensityScope(sampleActivityTypes)) {
    return {
      status: 'insufficient_data',
      reasonCode: 'low_intensity_scope',
      message: 'Selected activities are low-intensity for max-heart-rate estimation. Include higher-intensity workouts or ask across all activities.',
      suggestedQuery: DEFAULT_SUGGESTED_QUERY,
    };
  }

  const sampleCount = samples.length;
  if (sampleCount < MIN_HEART_RATE_SAMPLE_COUNT) {
    return {
      status: 'insufficient_data',
      reasonCode: 'too_few_samples',
      message: `At least ${MIN_HEART_RATE_SAMPLE_COUNT} valid max-heart-rate sessions are required.`,
      suggestedQuery: DEFAULT_SUGGESTED_QUERY,
      details: {
        sampleCount,
      },
    };
  }

  const trainingWeeks = resolveTrainingWeekCoverage(samples);
  if (trainingWeeks < MIN_HEART_RATE_COVERAGE_WEEKS) {
    return {
      status: 'insufficient_data',
      reasonCode: 'too_few_weeks',
      message: `At least ${MIN_HEART_RATE_COVERAGE_WEEKS} distinct training weeks with valid max-heart-rate samples are required.`,
      suggestedQuery: DEFAULT_SUGGESTED_QUERY,
      details: {
        trainingWeeks,
      },
    };
  }

  const dateRangeEndTime = resolveDateRangeEndTime(
    input.query.dateRange.kind === 'bounded' ? input.query.dateRange.endDate : null,
  );
  const recencyDays = resolveRecencyDays(samples, dateRangeEndTime);
  if (recencyDays !== null && recencyDays > MAX_STALE_SAMPLE_DAYS) {
    return {
      status: 'insufficient_data',
      reasonCode: 'stale_data',
      message: `Latest valid max-heart-rate sample is stale (${recencyDays} days old).`,
      suggestedQuery: DEFAULT_SUGGESTED_QUERY,
      details: {
        recencyDays,
      },
    };
  }

  const observedMax = samples[samples.length - 1]?.value ?? null;
  const tailQuality = observedMax === null
    ? {
      hasStrongTail: false,
    }
    : resolveTailQuality(samples, observedMax);
  if (!tailQuality.hasStrongTail) {
    return {
      status: 'insufficient_data',
      reasonCode: 'weak_tail_signal',
      message: 'Tail signal is weak: not enough sessions close to observed max and top-decile density is low.',
      suggestedQuery: DEFAULT_SUGGESTED_QUERY,
    };
  }

  return {
    status: 'eligible',
  };
}

function buildEstimateFromSamples(
  input: AdvisoryEstimatorInput,
  samples: AdvisorySample[],
): AdvisoryEstimatorEstimateResult {
  const sampleCount = samples.length;
  const observedSample = samples[samples.length - 1];
  const observedMax = observedSample?.value ?? BPM_MIN;
  const dateRangeEndTime = resolveDateRangeEndTime(
    input.query.dateRange.kind === 'bounded' ? input.query.dateRange.endDate : null,
  );
  const trainingWeeks = resolveTrainingWeekCoverage(samples);
  const recencyDays = resolveRecencyDays(samples, dateRangeEndTime);
  const tailQuality = resolveTailQuality(samples, observedMax);
  const sortedValues = samples.map(sample => sample.value).sort((left, right) => left - right);
  const p90 = percentile(sortedValues, 0.9);

  const sampleVolumeScore = clamp((sampleCount - MIN_HEART_RATE_SAMPLE_COUNT) / 16, 0, 1);
  const coverageScore = clamp((trainingWeeks - MIN_HEART_RATE_COVERAGE_WEEKS) / 9, 0, 1);
  const recencyScore = recencyDays === null
    ? 0
    : clamp((MAX_STALE_SAMPLE_DAYS - recencyDays) / MAX_STALE_SAMPLE_DAYS, 0, 1);
  const tailStrengthScore = clamp(
    ((tailQuality.qualifyingSampleCount / 5) * 0.7) + ((tailQuality.topDecileDensity / 0.25) * 0.3),
    0,
    1,
  );

  const tailGap = (() => {
    if (samples.length < 2) {
      return 0;
    }
    const secondHighest = samples[samples.length - 2]?.value ?? observedMax;
    return observedMax - secondHighest;
  })();
  const isolatedPeakPenalty = tailGap >= TAIL_GAP_CONFIDENCE_PENALTY_BPM ? 0.08 : 0;
  const supportSignalModifier = resolveSupportSignalModifier(samples, observedMax);

  const rawScore = (
    (sampleVolumeScore * SAMPLE_VOLUME_WEIGHT)
    + (coverageScore * COVERAGE_WEIGHT)
    + (recencyScore * RECENCY_WEIGHT)
    + (tailStrengthScore * TAIL_STRENGTH_WEIGHT)
  );
  const confidenceScore = clamp(
    rawScore - isolatedPeakPenalty + supportSignalModifier.modifier,
    0,
    1,
  );
  const confidenceTier = resolveConfidenceTierFromScore(confidenceScore);

  const rangeLow = roundToInteger(clamp(
    Math.max(p90, observedMax - resolveRangeLowDelta(confidenceTier)),
    BPM_MIN,
    BPM_CAP,
  ));
  const rangeHigh = roundToInteger(clamp(
    observedMax + resolveRangeHighMargin(confidenceTier),
    BPM_MIN,
    BPM_CAP,
  ));

  const roundedObservedMax = roundToInteger(observedMax);
  const roundedConfidenceScore = Math.round(confidenceScore * 1000) / 1000;

  return {
    semanticKind: 'current_ceiling',
    estimate: {
      value: roundedObservedMax,
      unit: 'bpm',
    },
    interval: {
      low: rangeLow,
      high: Math.max(rangeHigh, roundedObservedMax),
      kind: 'deterministic_range',
      confidenceLevel: confidenceTier,
    },
    observed: {
      bestValue: roundedObservedMax,
      bestDate: observedSample?.startTime === null || observedSample?.startTime === undefined
        ? null
        : new Date(observedSample.startTime).toISOString(),
      sampleCount,
      qualifyingSampleCount: tailQuality.qualifyingSampleCount,
      trainingWeeks,
      recencyDays,
    },
    confidence: {
      tier: confidenceTier,
      score: roundedConfidenceScore,
      reasons: [
        `Sample volume score ${Math.round(sampleVolumeScore * 100)}%.`,
        `Coverage score ${Math.round(coverageScore * 100)}%.`,
        `Recency score ${Math.round(recencyScore * 100)}%.`,
        `Tail-strength score ${Math.round(tailStrengthScore * 100)}%.`,
        isolatedPeakPenalty > 0
          ? `Isolated peak penalty applied (${Math.round(isolatedPeakPenalty * 100)}%).`
          : 'No isolated peak penalty applied.',
        supportSignalModifier.reason,
      ],
    },
    method: {
      id: 'heart_rate_current_ceiling_deterministic',
      version: 'v2',
      deterministic: true,
    },
    evidence: [
      {
        code: 'sample_count',
        label: 'Valid samples',
        value: `${sampleCount}`,
      },
      {
        code: 'observed_max',
        label: 'Observed max',
        value: `${roundedObservedMax} bpm`,
      },
      {
        code: 'tail_quality',
        label: 'Tail quality',
        value: `${tailQuality.qualifyingSampleCount} sessions within 3 bpm of observed max; top-decile density ${Math.round(tailQuality.topDecileDensity * 100)}%`,
      },
      {
        code: 'training_weeks',
        label: 'Training weeks',
        value: `${trainingWeeks}`,
      },
      {
        code: 'recency_days',
        label: 'Recency',
        value: recencyDays === null
          ? 'unavailable'
          : `${recencyDays} days before range end`,
      },
      {
        code: 'confidence_score',
        label: 'Confidence score',
        value: `${roundedConfidenceScore}`,
      },
    ],
  };
}

export const HEART_RATE_ADVISORY_ESTIMATOR: AdvisoryMetricEstimator = {
  metricKey: 'heart_rate',
  enabled: true,
  isEligible: (input) => {
    const heartRateSamples = collectHeartRateSamples(input.matchedEvents);
    return resolveEligibility(input, heartRateSamples);
  },
  estimate: (input) => {
    const heartRateSamples = collectHeartRateSamples(input.matchedEvents);
    return buildEstimateFromSamples(input, heartRateSamples);
  },
  explainability: (_input, output) => {
    const estimateValue = output.estimate.value;
    const intervalLow = output.interval.low;
    const intervalHigh = output.interval.high;
    const confidenceTier = output.confidence.tier;
    const sampleCount = output.observed.sampleCount;
    const trainingWeeks = output.observed.trainingWeeks;
    const recencySuffix = output.observed.recencyDays === null
      ? ''
      : ` Latest sample is ${output.observed.recencyDays} days before range end.`;

    return `Current achievable max heart rate is ${estimateValue} bpm (range ${intervalLow}-${intervalHigh} bpm, ${confidenceTier} confidence), based on ${sampleCount} valid sessions across ${trainingWeeks} training weeks.${recencySuffix}`;
  },
};
