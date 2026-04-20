import type { EventInterface } from '@sports-alliance/sports-lib';
import type { AiInsightConfidenceTier } from '../../../../../shared/ai-insights.types';

export interface AdvisorySample {
  value: number;
  event: EventInterface;
  startTime: number | null;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundToInteger(value: number): number {
  return Math.round(value);
}

export function percentile(sortedValues: number[], ratio: number): number {
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

export function resolveConfidenceTierFromScore(
  score: number,
): AiInsightConfidenceTier {
  if (score < 0.45) {
    return 'low';
  }
  if (score < 0.75) {
    return 'medium';
  }
  return 'high';
}

export function resolveDateRangeEndTime(
  endDate: string | null | undefined,
): number {
  const endTime = Date.parse(`${endDate || ''}`);
  return Number.isFinite(endTime) ? endTime : Date.now();
}

export function resolveSampleStartTime(
  event: EventInterface,
): number | null {
  if (!(event.startDate instanceof Date)) {
    return null;
  }

  const time = event.startDate.getTime();
  return Number.isFinite(time) ? time : null;
}

export function extractValidSamples(
  events: EventInterface[],
  options: {
    resolveValue: (event: EventInterface) => number | null;
    minValue: number;
    maxValue: number;
  },
): AdvisorySample[] {
  return events
    .map((event) => {
      const value = options.resolveValue(event);
      if (!Number.isFinite(value) || value === null) {
        return null;
      }
      if (value < options.minValue || value > options.maxValue) {
        return null;
      }

      return {
        value,
        event,
        startTime: resolveSampleStartTime(event),
      } satisfies AdvisorySample;
    })
    .filter((sample): sample is AdvisorySample => Boolean(sample))
    .sort((left, right) => left.value - right.value);
}

export function trimIsolatedSpikes(
  sortedSamples: AdvisorySample[],
  options: {
    trimFloor: number;
    trimGap: number;
  },
): AdvisorySample[] {
  const trimmed = [...sortedSamples];
  while (trimmed.length >= 2) {
    const observedMax = trimmed[trimmed.length - 1];
    const secondHighest = trimmed[trimmed.length - 2] ?? observedMax;
    if (
      observedMax.value > options.trimFloor
      && (observedMax.value - secondHighest.value) >= options.trimGap
    ) {
      trimmed.pop();
      continue;
    }
    break;
  }

  return trimmed;
}

export function resolveTrainingWeekCoverage(
  samples: AdvisorySample[],
): number {
  const weekBuckets = new Set<number>();
  samples.forEach((sample) => {
    if (sample.startTime === null) {
      return;
    }

    weekBuckets.add(Math.floor(sample.startTime / MILLISECONDS_PER_WEEK));
  });

  return weekBuckets.size;
}

export function resolveRecencyDays(
  samples: AdvisorySample[],
  dateRangeEndTime: number,
): number | null {
  const latestSampleTime = samples.reduce<number | null>((latest, sample) => {
    if (sample.startTime === null) {
      return latest;
    }
    if (latest === null || sample.startTime > latest) {
      return sample.startTime;
    }
    return latest;
  }, null);

  if (latestSampleTime === null) {
    return null;
  }

  const rawDelta = Math.floor((dateRangeEndTime - latestSampleTime) / MILLISECONDS_PER_DAY);
  return Math.max(0, rawDelta);
}

export function resolveTailQuality(
  samples: AdvisorySample[],
  observedMax: number,
): {
  qualifyingSampleCount: number;
  topDecileDensity: number;
  hasStrongTail: boolean;
} {
  if (!samples.length) {
    return {
      qualifyingSampleCount: 0,
      topDecileDensity: 0,
      hasStrongTail: false,
    };
  }

  const sortedValues = samples.map(sample => sample.value).sort((left, right) => left - right);
  const p90 = percentile(sortedValues, 0.9);
  const qualifyingSampleCount = samples
    .filter(sample => (observedMax - sample.value) <= 3)
    .length;
  const topDecileCount = samples
    .filter(sample => sample.value >= p90)
    .length;
  const topDecileDensity = topDecileCount / samples.length;

  return {
    qualifyingSampleCount,
    topDecileDensity,
    hasStrongTail: qualifyingSampleCount >= 3 || topDecileDensity >= 0.15,
  };
}
