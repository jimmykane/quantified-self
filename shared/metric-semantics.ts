import { ChartDataCategoryTypes } from '@sports-alliance/sports-lib';

export type MetricSemanticsDirection = 'direct' | 'inverse';

export type MetricSemanticsFamilyKey =
  | 'pace'
  | 'grade_adjusted_pace'
  | 'effort_pace'
  | 'swim_pace'
  | 'speed'
  | 'grade_adjusted_speed'
  | 'power'
  | 'cadence'
  | 'heart_rate'
  | 'other';

export interface MetricSemantics {
  familyKey: MetricSemanticsFamilyKey;
  direction: MetricSemanticsDirection;
  highestValueLabel: string;
  lowestValueLabel: string;
  improvedVerb: string;
  declinedVerb: string;
}

export interface MetricSummarySemantics {
  highestLabel: string;
  lowestLabel: string;
  latestLabel: string;
  highestHelpText: string;
  lowestHelpText: string;
  latestHelpText: string;
}

const STAT_PREFIX_REGEX = /^(average|minimum|maximum)\s+/i;
const INVERSE_FAMILIES = new Set<MetricSemanticsFamilyKey>([
  'pace',
  'grade_adjusted_pace',
  'effort_pace',
  'swim_pace',
]);

function normalizeMetricFamilyInput(dataType: string | null | undefined): string {
  return `${dataType || ''}`
    .trim()
    .toLowerCase()
    .replace(STAT_PREFIX_REGEX, '');
}

function capitalize(text: string): string {
  if (!text) {
    return text;
  }

  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function resolveMetricSemanticsFamilyKey(
  dataType: string | null | undefined,
): MetricSemanticsFamilyKey {
  const normalized = normalizeMetricFamilyInput(dataType);

  if (normalized.startsWith('grade adjusted pace')) {
    return 'grade_adjusted_pace';
  }
  if (normalized.startsWith('effort pace')) {
    return 'effort_pace';
  }
  if (normalized.startsWith('swim pace')) {
    return 'swim_pace';
  }
  if (normalized.startsWith('pace')) {
    return 'pace';
  }
  if (normalized.startsWith('grade adjusted speed')) {
    return 'grade_adjusted_speed';
  }
  if (normalized.startsWith('speed')) {
    return 'speed';
  }
  if (normalized.startsWith('heart rate')) {
    return 'heart_rate';
  }
  if (normalized.startsWith('power')) {
    return 'power';
  }
  if (normalized.startsWith('cadence')) {
    return 'cadence';
  }

  return 'other';
}

export function resolveMetricSemantics(
  dataType: string | null | undefined,
): MetricSemantics {
  const familyKey = resolveMetricSemanticsFamilyKey(dataType);
  const direction: MetricSemanticsDirection = INVERSE_FAMILIES.has(familyKey)
    ? 'inverse'
    : 'direct';

  if (direction === 'inverse') {
    return {
      familyKey,
      direction,
      highestValueLabel: 'slowest',
      lowestValueLabel: 'fastest',
      improvedVerb: 'improved',
      declinedVerb: 'slowed',
    };
  }

  return {
    familyKey,
    direction,
    highestValueLabel: 'highest',
    lowestValueLabel: 'lowest',
    improvedVerb: 'increased',
    declinedVerb: 'decreased',
  };
}

export function isInverseMetric(
  dataType: string | null | undefined,
): boolean {
  return resolveMetricSemantics(dataType).direction === 'inverse';
}

export function resolveMetricSummarySemantics(
  dataType: string | null | undefined,
  categoryType: ChartDataCategoryTypes | null | undefined,
): MetricSummarySemantics {
  const semantics = resolveMetricSemantics(dataType);
  const isDateCategory = categoryType === ChartDataCategoryTypes.DateType;
  const subject = isDateCategory ? 'period' : 'group';
  const latestLabel = isDateCategory ? 'Latest period with data' : 'Latest group';
  const latestHelpText = isDateCategory
    ? 'The most recent chart period with data in this result. A period is one chart bucket, such as a day, week, or month.'
    : 'The final chart group in the current chart ordering.';

  if (semantics.direction === 'inverse') {
    return {
      highestLabel: capitalize(`${semantics.highestValueLabel} ${subject}`),
      lowestLabel: capitalize(`${semantics.lowestValueLabel} ${subject}`),
      latestLabel,
      highestHelpText: isDateCategory
        ? 'The chart period with the slowest value for this metric. For inverse metrics like pace, higher values mean slower periods.'
        : 'The chart group with the slowest value for this metric. For inverse metrics like pace, higher values mean slower groups.',
      lowestHelpText: isDateCategory
        ? 'The chart period with the fastest value for this metric. For inverse metrics like pace, lower values mean faster periods.'
        : 'The chart group with the fastest value for this metric. For inverse metrics like pace, lower values mean faster groups.',
      latestHelpText,
    };
  }

  return {
    highestLabel: capitalize(`${semantics.highestValueLabel} ${subject}`),
    lowestLabel: capitalize(`${semantics.lowestValueLabel} ${subject}`),
    latestLabel,
    highestHelpText: isDateCategory
      ? 'The chart period with the highest value for this metric. A period is one chart bucket, such as a day, week, or month.'
      : 'The chart group with the highest value for this metric.',
    lowestHelpText: isDateCategory
      ? 'The chart period with the lowest value for this metric. A period is one chart bucket, such as a day, week, or month.'
      : 'The chart group with the lowest value for this metric.',
    latestHelpText,
  };
}
