import { DataHeartRateMax, type EventInterface } from '@sports-alliance/sports-lib';
import type {
  AdvisoryEstimatorEstimateResult,
  AdvisoryMetricEstimator,
} from '../advisory-estimator';

const MIN_HEART_RATE_SAMPLE_COUNT = 3;
const MEDIUM_CONFIDENCE_SAMPLE_COUNT = 8;
const HIGH_CONFIDENCE_SAMPLE_COUNT = 20;
const BPM_CAP = 230;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToInteger(value: number): number {
  return Math.round(value);
}

function resolveHeartRateMax(event: EventInterface): number | null {
  const stat = event.getStat?.(DataHeartRateMax.type);
  const rawValue = Number(stat?.getValue?.());
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return null;
  }

  return rawValue;
}

function collectHeartRateSamples(
  events: EventInterface[],
): number[] {
  return events
    .map(resolveHeartRateMax)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
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

function resolveConfidenceTier(sampleCount: number): AdvisoryEstimatorEstimateResult['confidenceTier'] {
  if (sampleCount >= HIGH_CONFIDENCE_SAMPLE_COUNT) {
    return 'high';
  }
  if (sampleCount >= MEDIUM_CONFIDENCE_SAMPLE_COUNT) {
    return 'medium';
  }
  return 'low';
}

function buildEstimateFromSamples(samples: number[]): AdvisoryEstimatorEstimateResult {
  const sampleCount = samples.length;
  const observedMax = samples[samples.length - 1] ?? 0;
  const p90 = percentile(samples, 0.9);
  const p50 = percentile(samples, 0.5);
  const spread = Math.max(2, observedMax - p90);
  const projectedLift = Math.max(1, Math.min(4, spread * 0.7));
  const pointEstimate = roundToInteger(clamp(observedMax + projectedLift, 80, BPM_CAP));
  const rangeLow = roundToInteger(clamp(Math.min(pointEstimate, p90), 70, BPM_CAP));
  const rangeHigh = roundToInteger(clamp(Math.max(pointEstimate, observedMax + Math.max(2, spread)), 80, BPM_CAP));

  return {
    pointEstimate,
    rangeLow,
    rangeHigh,
    confidenceTier: resolveConfidenceTier(sampleCount),
    evidence: [
      `${sampleCount} events with max heart-rate data`,
      `observed max ${roundToInteger(observedMax)} bpm`,
      `p90 ${roundToInteger(p90)} bpm`,
      `median ${roundToInteger(p50)} bpm`,
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

    if (heartRateSamples.length < MIN_HEART_RATE_SAMPLE_COUNT) {
      return {
        status: 'insufficient_data',
        reason: `At least ${MIN_HEART_RATE_SAMPLE_COUNT} events with max heart-rate samples are required. Try "Show my max heart rate over time this year."`,
      };
    }

    return {
      status: 'eligible',
    };
  },
  estimate: (input) => {
    const heartRateSamples = collectHeartRateSamples(input.matchedEvents);
    return buildEstimateFromSamples(heartRateSamples);
  },
  explainability: (input, output) => {
    const sampleCount = collectHeartRateSamples(input.matchedEvents).length;
    return `Based on ${sampleCount} events with max heart-rate samples, expected max heart rate is ${output.pointEstimate} bpm (range ${output.rangeLow}-${output.rangeHigh} bpm, ${output.confidenceTier} confidence).`;
  },
};
