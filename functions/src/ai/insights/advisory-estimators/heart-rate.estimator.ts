import {
  ActivityTypes,
  ActivityTypesHelper,
  DataHeartRateMax,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import type {
  AdvisoryEstimatorInput,
  AdvisoryEstimatorEstimateResult,
  AdvisoryMetricEstimator,
} from '../advisory-estimator';

const MIN_HEART_RATE_SAMPLE_COUNT = 8;
const MIN_HEART_RATE_COVERAGE_WEEKS = 3;
const MEDIUM_CONFIDENCE_SAMPLE_COUNT = 8;
const HIGH_CONFIDENCE_SAMPLE_COUNT = 20;
const MEDIUM_CONFIDENCE_COVERAGE_WEEKS = 3;
const HIGH_CONFIDENCE_COVERAGE_WEEKS = 8;
const HIGH_CONFIDENCE_MAX_RECENCY_DAYS = 45;
const MEDIUM_CONFIDENCE_MAX_RECENCY_DAYS = 90;
const BPM_CAP = 230;
const LOW_CONFIDENCE_RANGE_LOW_DELTA = 12;
const MEDIUM_CONFIDENCE_RANGE_LOW_DELTA = 9;
const HIGH_CONFIDENCE_RANGE_LOW_DELTA = 7;
const LOW_CONFIDENCE_RANGE_HIGH_MARGIN = 3;
const MEDIUM_CONFIDENCE_RANGE_HIGH_MARGIN = 2;
const HIGH_CONFIDENCE_RANGE_HIGH_MARGIN = 1;
const TAIL_GAP_CONFIDENCE_PENALTY_BPM = 8;
const ISOLATED_SPIKE_TRIM_FLOOR_BPM = 220;
const ISOLATED_SPIKE_TRIM_GAP_BPM = 6;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToInteger(value: number): number {
  return Math.round(value);
}

function resolveHeartRateMax(event: EventInterface): number | null {
  const stat = event.getStat?.(DataHeartRateMax.type);
  const rawValue = Number(stat?.getValue?.());
  if (!Number.isFinite(rawValue) || rawValue <= 0 || rawValue > BPM_CAP) {
    return null;
  }

  return rawValue;
}

function trimIsolatedHeartRateSpikes(
  sortedSamples: number[],
): number[] {
  const trimmedSamples = [...sortedSamples];
  while (trimmedSamples.length >= 2) {
    const observedMax = trimmedSamples[trimmedSamples.length - 1] ?? 0;
    const secondHighest = trimmedSamples[trimmedSamples.length - 2] ?? observedMax;
    if (
      observedMax > ISOLATED_SPIKE_TRIM_FLOOR_BPM
      && (observedMax - secondHighest) >= ISOLATED_SPIKE_TRIM_GAP_BPM
    ) {
      trimmedSamples.pop();
      continue;
    }
    break;
  }

  return trimmedSamples;
}

function collectHeartRateSamples(
  events: EventInterface[],
): number[] {
  const sortedSamples = events
    .map(resolveHeartRateMax)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  return trimIsolatedHeartRateSpikes(sortedSamples);
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
  events: EventInterface[],
): ActivityTypes[] {
  const resolved = new Set<ActivityTypes>();

  events.forEach((event) => {
    if (resolveHeartRateMax(event) === null) {
      return;
    }
    resolveCanonicalActivityTypes(event).forEach(activityType => resolved.add(activityType));
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

function resolveEventStartTime(event: EventInterface): number | null {
  if (!(event.startDate instanceof Date)) {
    return null;
  }
  const time = event.startDate.getTime();
  return Number.isFinite(time) ? time : null;
}

function resolveDateRangeEndTime(
  input: AdvisoryEstimatorInput,
): number {
  if (input.query.dateRange.kind !== 'bounded') {
    return Date.now();
  }
  const endTime = Date.parse(input.query.dateRange.endDate);
  return Number.isFinite(endTime) ? endTime : Date.now();
}

interface HeartRateCoverageSignals {
  distinctWeekCount: number;
  daysSinceLatestSample: number | null;
}

function resolveHeartRateCoverageSignals(
  input: AdvisoryEstimatorInput,
): HeartRateCoverageSignals {
  const distinctWeekBuckets = new Set<number>();
  let latestSampleTime: number | null = null;

  input.matchedEvents.forEach((event) => {
    const heartRateMax = resolveHeartRateMax(event);
    if (heartRateMax === null) {
      return;
    }
    const startTime = resolveEventStartTime(event);
    if (startTime === null) {
      return;
    }

    distinctWeekBuckets.add(Math.floor(startTime / MILLISECONDS_PER_WEEK));
    if (latestSampleTime === null || startTime > latestSampleTime) {
      latestSampleTime = startTime;
    }
  });

  if (latestSampleTime === null) {
    return {
      distinctWeekCount: distinctWeekBuckets.size,
      daysSinceLatestSample: null,
    };
  }

  const dateRangeEndTime = resolveDateRangeEndTime(input);
  const rawDayDelta = Math.floor((dateRangeEndTime - latestSampleTime) / MILLISECONDS_PER_DAY);
  return {
    distinctWeekCount: distinctWeekBuckets.size,
    daysSinceLatestSample: Math.max(0, rawDayDelta),
  };
}

function percentile(sortedValues: number[], ratio: number): number {
  if (!sortedValues.length) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = clamp(ratio, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex] ?? sortedValues[0];
  const upperValue = sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1];
  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const fraction = index - lowerIndex;
  return lowerValue + ((upperValue - lowerValue) * fraction);
}

function downgradeConfidenceTier(
  confidenceTier: AdvisoryEstimatorEstimateResult['confidenceTier'],
): AdvisoryEstimatorEstimateResult['confidenceTier'] {
  if (confidenceTier === 'high') {
    return 'medium';
  }
  if (confidenceTier === 'medium') {
    return 'low';
  }
  return 'low';
}

function resolveConfidenceTier(
  sampleCount: number,
  coverageSignals: HeartRateCoverageSignals,
): AdvisoryEstimatorEstimateResult['confidenceTier'] {
  const hasHighSampleVolume = sampleCount >= HIGH_CONFIDENCE_SAMPLE_COUNT;
  const hasMediumSampleVolume = sampleCount >= MEDIUM_CONFIDENCE_SAMPLE_COUNT;
  const hasHighCoverage = coverageSignals.distinctWeekCount >= HIGH_CONFIDENCE_COVERAGE_WEEKS;
  const hasMediumCoverage = coverageSignals.distinctWeekCount >= MEDIUM_CONFIDENCE_COVERAGE_WEEKS;

  if (hasHighSampleVolume && hasHighCoverage) {
    if (
      coverageSignals.daysSinceLatestSample !== null
      && coverageSignals.daysSinceLatestSample > HIGH_CONFIDENCE_MAX_RECENCY_DAYS
    ) {
      return 'medium';
    }
    return 'high';
  }
  if (hasMediumSampleVolume && hasMediumCoverage) {
    if (
      coverageSignals.daysSinceLatestSample !== null
      && coverageSignals.daysSinceLatestSample > MEDIUM_CONFIDENCE_MAX_RECENCY_DAYS
    ) {
      return 'low';
    }
    return 'medium';
  }
  return 'low';
}

function applyTailGapConfidencePenalty(
  confidenceTier: AdvisoryEstimatorEstimateResult['confidenceTier'],
  samples: number[],
): AdvisoryEstimatorEstimateResult['confidenceTier'] {
  if (samples.length < 2) {
    return confidenceTier;
  }

  const observedMax = samples[samples.length - 1] ?? 0;
  const secondHighest = samples[samples.length - 2] ?? observedMax;
  const tailGap = observedMax - secondHighest;
  if (!Number.isFinite(tailGap) || tailGap <= 0) {
    return confidenceTier;
  }

  // A single isolated peak can be a one-off maximal effort or measurement artifact.
  // Keep the peak as the point estimate, but downgrade confidence one tier.
  if (tailGap >= TAIL_GAP_CONFIDENCE_PENALTY_BPM) {
    return downgradeConfidenceTier(confidenceTier);
  }
  return confidenceTier;
}

function resolveRangeLowDelta(
  confidenceTier: AdvisoryEstimatorEstimateResult['confidenceTier'],
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
  confidenceTier: AdvisoryEstimatorEstimateResult['confidenceTier'],
): number {
  if (confidenceTier === 'high') {
    return HIGH_CONFIDENCE_RANGE_HIGH_MARGIN;
  }
  if (confidenceTier === 'medium') {
    return MEDIUM_CONFIDENCE_RANGE_HIGH_MARGIN;
  }
  return LOW_CONFIDENCE_RANGE_HIGH_MARGIN;
}

function buildEstimateFromSamples(
  samples: number[],
  input: AdvisoryEstimatorInput,
): AdvisoryEstimatorEstimateResult {
  const sampleCount = samples.length;
  const observedMax = samples[samples.length - 1] ?? 0;
  const coverageSignals = resolveHeartRateCoverageSignals(input);
  const p90 = percentile(samples, 0.9);
  const p95 = percentile(samples, 0.95);
  const p50 = percentile(samples, 0.5);
  const confidenceTier = applyTailGapConfidencePenalty(
    resolveConfidenceTier(sampleCount, coverageSignals),
    samples,
  );
  const rangeLowFloor = observedMax - resolveRangeLowDelta(confidenceTier);
  const rangeLow = roundToInteger(clamp(
    Math.max(p90, rangeLowFloor),
    70,
    BPM_CAP,
  ));
  // For individual-level advisory, measured maxima are more reliable than age-only equations.
  const pointEstimate = roundToInteger(clamp(observedMax, 80, BPM_CAP));
  const rangeHigh = roundToInteger(clamp(
    Math.max(pointEstimate, observedMax + resolveRangeHighMargin(confidenceTier)),
    80,
    BPM_CAP,
  ));

  return {
    pointEstimate,
    rangeLow,
    rangeHigh,
    confidenceTier,
    evidence: [
      `${sampleCount} events with max heart-rate data`,
      `observed max ${roundToInteger(observedMax)} bpm`,
      `p95 ${roundToInteger(p95)} bpm`,
      `p90 ${roundToInteger(p90)} bpm`,
      `median ${roundToInteger(p50)} bpm`,
      `${coverageSignals.distinctWeekCount} distinct training weeks`,
      coverageSignals.daysSinceLatestSample === null
        ? 'latest sample recency unavailable'
        : `latest sample ${coverageSignals.daysSinceLatestSample} days before range end`,
    ],
  };
}

export const HEART_RATE_ADVISORY_ESTIMATOR: AdvisoryMetricEstimator = {
  metricKey: 'heart_rate',
  enabled: true,
  isEligible: (input) => {
    const heartRateSamples = collectHeartRateSamples(input.matchedEvents);
    if (!heartRateSamples.length) {
      return {
        status: 'insufficient_data',
        reason: 'No events with max heart-rate samples were found. Try an executable query like "Show my max heart rate over time this year."',
      };
    }

    const sampleActivityTypes = resolveSampleActivityTypes(input.matchedEvents);
    if (isLowIntensityScope(sampleActivityTypes)) {
      return {
        status: 'insufficient_data',
        reason: 'Selected activities are low-intensity for max-heart-rate estimation (for example hiking or walking). Include higher-intensity workouts or ask across all activities.',
      };
    }

    if (heartRateSamples.length < MIN_HEART_RATE_SAMPLE_COUNT) {
      return {
        status: 'insufficient_data',
        reason: `At least ${MIN_HEART_RATE_SAMPLE_COUNT} events with max heart-rate samples are required. Try "Show my max heart rate over time this year."`,
      };
    }

    const coverageSignals = resolveHeartRateCoverageSignals(input);
    if (coverageSignals.distinctWeekCount < MIN_HEART_RATE_COVERAGE_WEEKS) {
      return {
        status: 'insufficient_data',
        reason: `At least ${MIN_HEART_RATE_COVERAGE_WEEKS} distinct training weeks with max heart-rate samples are required. Try a broader date range or "Show my max heart rate over time this year."`,
      };
    }

    return {
      status: 'eligible',
    };
  },
  estimate: (input) => {
    const heartRateSamples = collectHeartRateSamples(input.matchedEvents);
    return buildEstimateFromSamples(heartRateSamples, input);
  },
  explainability: (input, output) => {
    const heartRateSamples = collectHeartRateSamples(input.matchedEvents);
    const sampleCount = heartRateSamples.length;
    const coverageSignals = resolveHeartRateCoverageSignals(input);
    const observedMax = heartRateSamples[heartRateSamples.length - 1] ?? output.pointEstimate;
    const recencyClause = coverageSignals.daysSinceLatestSample === null
      ? ''
      : ` latest sample is ${coverageSignals.daysSinceLatestSample} days before range end.`;
    return `Based on ${sampleCount} events with max heart-rate samples across ${coverageSignals.distinctWeekCount} training weeks, observed max is ${roundToInteger(observedMax)} bpm and expected max heart rate is ${output.pointEstimate} bpm (range ${output.rangeLow}-${output.rangeHigh} bpm, ${output.confidenceTier} confidence).${recencyClause}`;
  },
};
