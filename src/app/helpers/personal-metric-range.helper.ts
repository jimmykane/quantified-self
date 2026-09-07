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

export interface PersonalMetricPointRangeOptions {
  baselineWindowDays: number;
  baselineMinimumObservationDays: number;
}

export interface PersonalMetricPointRangeResult {
  tone: PersonalMetricRangeTone;
  reason: 'building_baseline' | 'within_range' | 'outside_range' | 'far_outside_range';
  observationDayCount: number;
  requiredObservationDayCount: number;
  baselineAverage: number | null;
  pointValue: number | null;
  normalRange: { min: number; max: number } | null;
}

interface PersonalMetricRangeClassification {
  tone: Exclude<PersonalMetricRangeTone, 'neutral'>;
  reason: 'within_range' | 'outside_range' | 'far_outside_range';
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
  const classification = classifyPersonalMetricValue(currentAverage, baselineAverage, standardDeviation);
  return {
    ...classification,
    observationDayCount,
    requiredObservationDayCount: baselineMinimumObservationDays,
    currentObservationDayCount: currentValues.length,
    requiredCurrentObservationDayCount: currentMinimumObservationDays,
    baselineAverage,
    currentAverage,
    normalRange,
  };
}

/**
 * Grades one daily observation against the rolling personal range that existed
 * at that observation. The current value is selected by calendar date rather
 * than a 24-hour window, so adjacent nights cannot be averaged together.
 */
export function calculatePersonalMetricPointRange(
  observations: readonly PersonalMetricRangeObservation[],
  point: PersonalMetricRangeObservation,
  options: PersonalMetricPointRangeOptions,
): PersonalMetricPointRangeResult {
  const baselineWindowDays = positiveInteger(options.baselineWindowDays);
  const requiredObservationDayCount = positiveInteger(options.baselineMinimumObservationDays);
  const baselineStartTimeMs = point.timestampMs - (baselineWindowDays * DAY_MS) + 1;
  const dailyValues = collapseByCalendarDate(observations.filter(observation =>
    observation.timestampMs >= baselineStartTimeMs && observation.timestampMs <= point.timestampMs));
  const pointValue = dailyValues.find(item => item.calendarDate === point.calendarDate)?.value ?? null;
  if (dailyValues.length < requiredObservationDayCount || pointValue === null) {
    return {
      tone: 'neutral',
      reason: 'building_baseline',
      observationDayCount: dailyValues.length,
      requiredObservationDayCount,
      baselineAverage: null,
      pointValue,
      normalRange: null,
    };
  }
  const values = dailyValues.map(item => item.value);
  const baselineAverage = average(values);
  const standardDeviation = Math.sqrt(average(values.map(value => (value - baselineAverage) ** 2)));
  return {
    ...classifyPersonalMetricValue(pointValue, baselineAverage, standardDeviation),
    observationDayCount: dailyValues.length,
    requiredObservationDayCount,
    baselineAverage,
    pointValue,
    normalRange: {
      min: baselineAverage - standardDeviation,
      max: baselineAverage + standardDeviation,
    },
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

function classifyPersonalMetricValue(
  value: number,
  baselineAverage: number,
  standardDeviation: number,
): PersonalMetricRangeClassification {
  const distance = Math.abs(value - baselineAverage);
  const reason = standardDeviation === 0 || distance <= standardDeviation
    ? 'within_range'
    : distance <= standardDeviation * 2
      ? 'outside_range'
      : 'far_outside_range';
  return {
    tone: reason === 'within_range' ? 'positive' : reason === 'outside_range' ? 'caution' : 'negative',
    reason,
  };
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.floor(Number(value) || 1));
}
