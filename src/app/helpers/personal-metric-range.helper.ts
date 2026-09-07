export type PersonalMetricRangeTone = 'neutral' | 'positive' | 'caution' | 'negative';

export interface PersonalMetricRangeObservation {
  timestampMs: number;
  calendarDate: string;
  value: number;
}

export interface PersonalMetricRangeOptions {
  baselineWindowDays: number;
  baselineMinimumObservationDays: number;
  currentWindowDays: number;
  currentMinimumObservationDays: number;
}

interface PersonalMetricRangeResultBase {
  observationDayCount: number;
  requiredObservationDayCount: number;
  currentObservationDayCount: number;
  requiredCurrentObservationDayCount: number;
}

export type PersonalMetricRangeResult = PersonalMetricRangeResultBase & (
  | {
    tone: 'neutral';
    reason: 'building_baseline' | 'insufficient_current';
    baselineAverage: null;
    currentAverage: null;
    normalRange: null;
  }
  | {
    tone: Exclude<PersonalMetricRangeTone, 'neutral'>;
    reason: 'within_range' | 'outside_range' | 'far_outside_range';
    baselineAverage: number;
    currentAverage: number;
    normalRange: { min: number; max: number };
  }
);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compares a recent daily average with a longer personal range. Multiple
 * readings on one calendar day reduce to a median so dense samples cannot
 * outweigh daily measurements. The personal range is one population standard
 * deviation around the baseline mean; one-to-two deviations is cautionary and
 * beyond two is far outside.
 */
export function calculatePersonalMetricRange(
  observations: readonly PersonalMetricRangeObservation[],
  endTimeMs: number,
  options: PersonalMetricRangeOptions,
): PersonalMetricRangeResult {
  const baselineWindowDays = positiveInteger(options.baselineWindowDays);
  const baselineMinimumObservationDays = positiveInteger(options.baselineMinimumObservationDays);
  const currentWindowDays = positiveInteger(options.currentWindowDays);
  const currentMinimumObservationDays = positiveInteger(options.currentMinimumObservationDays);
  const baselineStartTimeMs = endTimeMs - (baselineWindowDays * DAY_MS) + 1;
  const dailyValues = collapseByCalendarDate(observations.filter(observation =>
    observation.timestampMs >= baselineStartTimeMs && observation.timestampMs <= endTimeMs));
  const observationDayCount = dailyValues.length;
  const baseResult = {
    observationDayCount,
    requiredObservationDayCount: baselineMinimumObservationDays,
    currentObservationDayCount: 0,
    requiredCurrentObservationDayCount: currentMinimumObservationDays,
    baselineAverage: null,
    currentAverage: null,
    normalRange: null,
  };
  if (observationDayCount < baselineMinimumObservationDays) {
    return { ...baseResult, tone: 'neutral', reason: 'building_baseline' };
  }

  const currentStartTimeMs = endTimeMs - (currentWindowDays * DAY_MS) + 1;
  const currentValues = dailyValues.filter(item => item.timestampMs >= currentStartTimeMs);
  if (currentValues.length < currentMinimumObservationDays) {
    return {
      ...baseResult,
      tone: 'neutral',
      reason: 'insufficient_current',
      currentObservationDayCount: currentValues.length,
    };
  }

  const values = dailyValues.map(item => item.value);
  const baselineAverage = average(values);
  const standardDeviation = Math.sqrt(average(values.map(value => (value - baselineAverage) ** 2)));
  const currentAverage = average(currentValues.map(item => item.value));
  const normalRange = {
    min: baselineAverage - standardDeviation,
    max: baselineAverage + standardDeviation,
  };
  const distance = Math.abs(currentAverage - baselineAverage);
  const reason = standardDeviation === 0 || distance <= standardDeviation
    ? 'within_range'
    : distance <= standardDeviation * 2
      ? 'outside_range'
      : 'far_outside_range';
  return {
    tone: reason === 'within_range' ? 'positive' : reason === 'outside_range' ? 'caution' : 'negative',
    reason,
    observationDayCount,
    requiredObservationDayCount: baselineMinimumObservationDays,
    currentObservationDayCount: currentValues.length,
    requiredCurrentObservationDayCount: currentMinimumObservationDays,
    baselineAverage,
    currentAverage,
    normalRange,
  };
}

function collapseByCalendarDate(
  observations: readonly PersonalMetricRangeObservation[],
): PersonalMetricRangeObservation[] {
  const valuesByDate = new Map<string, PersonalMetricRangeObservation[]>();
  for (const observation of observations) {
    if (!Number.isFinite(observation.timestampMs) || !Number.isFinite(observation.value)) {
      continue;
    }
    valuesByDate.set(observation.calendarDate, [
      ...(valuesByDate.get(observation.calendarDate) || []),
      observation,
    ]);
  }
  return [...valuesByDate.values()].map(values => {
    const sorted = [...values].sort((left, right) => left.value - right.value);
    const middle = Math.floor(sorted.length / 2);
    return {
      timestampMs: Math.max(...values.map(item => item.timestampMs)),
      calendarDate: values[0].calendarDate,
      value: sorted.length % 2 === 0
        ? (sorted[middle - 1].value + sorted[middle].value) / 2
        : sorted[middle].value,
    };
  }).sort((left, right) => left.timestampMs - right.timestampMs);
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.floor(Number(value) || 1));
}
