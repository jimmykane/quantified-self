import {
  ChartDataValueTypes,
  DataAscent,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataPaceAvg,
  DataPowerAvg,
  DataSpeedAvg,
  DynamicDataLoader,
} from '@sports-alliance/sports-lib';

export type InsightMetricKey =
  | 'distance'
  | 'duration'
  | 'ascent'
  | 'descent'
  | 'cadence'
  | 'power'
  | 'heart_rate'
  | 'speed'
  | 'pace'
  | 'calories';

export interface InsightMetricDefinition {
  key: InsightMetricKey;
  dataType: string;
  label: string;
  aliases: string[];
  defaultValueType: ChartDataValueTypes;
  allowedValueTypes: ChartDataValueTypes[];
  suggestedPrompt: string;
  familyType?: string;
}

function normalizeMetricText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export const SUPPORTED_INSIGHT_METRICS: readonly InsightMetricDefinition[] = [
  {
    key: 'distance',
    dataType: DataDistance.type,
    label: 'distance',
    aliases: ['distance', 'total distance', 'mileage', 'miles', 'mi', 'kilometers', 'kilometres', 'km'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my total distance by activity type this year.',
  },
  {
    key: 'duration',
    dataType: DataDuration.type,
    label: 'duration',
    aliases: ['duration', 'time spent', 'training time', 'workout duration'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my total training duration over time this year.',
  },
  {
    key: 'ascent',
    dataType: DataAscent.type,
    label: 'ascent',
    aliases: ['ascent', 'elevation gain', 'climbing', 'climb'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my total ascent over time for trail running this year.',
  },
  {
    key: 'descent',
    dataType: DataDescent.type,
    label: 'descent',
    aliases: ['descent', 'elevation loss', 'descending'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my total descent over time for skiing this year.',
  },
  {
    key: 'cadence',
    dataType: DataCadenceAvg.type,
    label: 'cadence',
    aliases: [
      'cadence',
      'average cadence',
      'avg cadence',
      'minimum cadence',
      'min cadence',
      'maximum cadence',
      'max cadence',
      'highest cadence',
      'lowest cadence',
      'rpm',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Tell me my average cadence for cycling over the last 3 months.',
    familyType: 'Cadence',
  },
  {
    key: 'power',
    dataType: DataPowerAvg.type,
    label: 'power',
    aliases: [
      'power',
      'average power',
      'avg power',
      'minimum power',
      'min power',
      'maximum power',
      'max power',
      'highest power',
      'lowest power',
      'watts',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my average power over time for cycling in the last 90 days.',
    familyType: 'Power',
  },
  {
    key: 'heart_rate',
    dataType: DataHeartRateAvg.type,
    label: 'heart rate',
    aliases: [
      'heart rate',
      'average heart rate',
      'avg heart rate',
      'minimum heart rate',
      'min heart rate',
      'maximum heart rate',
      'max heart rate',
      'highest heart rate',
      'lowest heart rate',
      'hr',
      'pulse',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my average heart rate over time for running in the last 90 days.',
    familyType: 'Heart Rate',
  },
  {
    key: 'speed',
    dataType: DataSpeedAvg.type,
    label: 'speed',
    aliases: [
      'speed',
      'average speed',
      'avg speed',
      'minimum speed',
      'min speed',
      'maximum speed',
      'max speed',
      'highest speed',
      'lowest speed',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my average speed over time for cycling in the last 3 months.',
    familyType: 'Speed',
  },
  {
    key: 'pace',
    dataType: DataPaceAvg.type,
    label: 'pace',
    aliases: [
      'pace',
      'average pace',
      'avg pace',
      'minimum pace',
      'min pace',
      'maximum pace',
      'max pace',
      'fastest pace',
      'slowest pace',
    ],
    defaultValueType: ChartDataValueTypes.Average,
    allowedValueTypes: [
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my average pace over time for running in the last 3 months.',
    familyType: 'Pace',
  },
  {
    key: 'calories',
    dataType: DataEnergy.type,
    label: 'calories',
    aliases: ['calories', 'calories burned', 'energy', 'energy burned'],
    defaultValueType: ChartDataValueTypes.Total,
    allowedValueTypes: [
      ChartDataValueTypes.Total,
      ChartDataValueTypes.Average,
      ChartDataValueTypes.Minimum,
      ChartDataValueTypes.Maximum,
    ],
    suggestedPrompt: 'Show my total calories burned over time in the last 90 days.',
  },
] as const;

const METRIC_INDEX = new Map<string, InsightMetricDefinition>(
  SUPPORTED_INSIGHT_METRICS.flatMap((metric) => {
    const searchTerms = new Set<string>([
      metric.key,
      metric.dataType,
      metric.label,
      ...metric.aliases,
    ].map(normalizeMetricText));

    return [...searchTerms].map((term) => [term, metric] as const);
  }),
);

function resolveExplicitVariantValueType(metricText: string): ChartDataValueTypes | null {
  const normalized = normalizeMetricText(metricText);
  if (!normalized) {
    return null;
  }

  if (/\b(max|maximum|highest|peak|top)\b/.test(normalized)) {
    return ChartDataValueTypes.Maximum;
  }
  if (/\b(min|minimum|lowest|bottom)\b/.test(normalized)) {
    return ChartDataValueTypes.Minimum;
  }
  if (/\b(avg|average|mean)\b/.test(normalized)) {
    return ChartDataValueTypes.Average;
  }

  return null;
}

function resolveFamilyVariantDataType(
  metric: InsightMetricDefinition,
  valueType: ChartDataValueTypes,
  explicitVariantValueType: ChartDataValueTypes | null,
): string {
  if (!metric.familyType) {
    return metric.dataType;
  }

  const resolvedValueType = explicitVariantValueType || valueType;
  switch (resolvedValueType) {
    case ChartDataValueTypes.Minimum:
      return DynamicDataLoader.dataTypeMinDataType?.[metric.familyType] || metric.dataType;
    case ChartDataValueTypes.Maximum:
      return DynamicDataLoader.dataTypeMaxDataType?.[metric.familyType] || metric.dataType;
    case ChartDataValueTypes.Average:
    default:
      return DynamicDataLoader.dataTypeAvgDataType?.[metric.familyType] || metric.dataType;
  }
}

export function getInsightMetricDefinition(metricKey: InsightMetricKey): InsightMetricDefinition | undefined {
  return SUPPORTED_INSIGHT_METRICS.find(metric => metric.key === metricKey);
}

export function resolveInsightMetric(
  metricOrAlias: string,
  valueType?: ChartDataValueTypes,
): InsightMetricDefinition | null {
  const normalized = normalizeMetricText(metricOrAlias);
  if (!normalized) {
    return null;
  }

  const metric = METRIC_INDEX.get(normalized) || null;
  if (!metric || valueType === undefined) {
    return metric;
  }

  return {
    ...metric,
    dataType: resolveFamilyVariantDataType(metric, valueType, resolveExplicitVariantValueType(metricOrAlias)),
  };
}

export function resolveMetricVariantAlias(
  metric: InsightMetricDefinition,
  sourceText: string,
): string | null {
  const normalizedSource = normalizeMetricText(sourceText);
  if (!normalizedSource) {
    return null;
  }

  const candidateAliases = [...new Set([metric.label, ...metric.aliases])]
    .map(alias => normalizeMetricText(alias))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return candidateAliases.find(alias => normalizedSource.includes(alias)) || null;
}

export function isAggregationAllowedForMetric(
  metricKey: InsightMetricKey,
  valueType: ChartDataValueTypes,
): boolean {
  const metric = getInsightMetricDefinition(metricKey);
  return metric?.allowedValueTypes.includes(valueType) === true;
}

export function buildMetricCatalogPromptText(): string {
  return SUPPORTED_INSIGHT_METRICS.map((metric) => {
    const aliases = metric.aliases.join(', ');
    const aggregations = metric.allowedValueTypes.join(', ');
    return `- ${metric.key}: dataType=${metric.dataType}; label=${metric.label}; aliases=${aliases}; allowed aggregations=${aggregations}`;
  }).join('\n');
}

export function getSuggestedInsightPrompts(limit = 3): string[] {
  return SUPPORTED_INSIGHT_METRICS
    .slice(0, Math.max(0, limit))
    .map(metric => metric.suggestedPrompt);
}
