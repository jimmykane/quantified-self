import {
  DataWeight,
} from '@sports-alliance/sports-lib';
import {
  DERIVED_METRIC_KINDS,
  type DerivedMetricKind,
} from '../../../shared/derived-metrics';
import {
  type McpMetricDescriptor,
  resolveSportsLibNumericMetric,
} from './metric-catalog';

export const MCP_MEASUREMENT_TYPE_IDS = [
  'body_weight',
] as const;

export type McpMeasurementType = typeof MCP_MEASUREMENT_TYPE_IDS[number];
export type McpMeasurementAggregation =
  | 'median'
  | 'average'
  | 'minimum'
  | 'maximum'
  | 'latest';
export type McpMeasurementInterval = 'day' | 'week' | 'month';

interface McpMeasurementDefinition {
  id: McpMeasurementType;
  canonicalMetricType: string;
  displayName: string;
  description: string;
  aliases: readonly string[];
  minimumExclusive: number | null;
  defaultAggregation: McpMeasurementAggregation;
  supportedAggregations: readonly McpMeasurementAggregation[];
  defaultInterval: McpMeasurementInterval;
  supportedIntervals: readonly McpMeasurementInterval[];
  currentTrend: {
    tool: 'get_training_metric';
    metricKind: DerivedMetricKind;
    windowDays: number;
    readiness: 'ready_snapshot_required';
  };
}

export interface McpMeasurementDescriptor {
  id: McpMeasurementType;
  displayName: string;
  description: string;
  canonicalMetric: McpMetricDescriptor;
  defaultAggregation: McpMeasurementAggregation;
  supportedAggregations: readonly McpMeasurementAggregation[];
  defaultInterval: McpMeasurementInterval;
  supportedIntervals: readonly McpMeasurementInterval[];
  maximumRangeDays: 366;
  currentTrend: McpMeasurementDefinition['currentTrend'];
}

const MCP_MEASUREMENT_DEFINITIONS: Record<
  McpMeasurementType,
  McpMeasurementDefinition
> = {
  body_weight: {
    id: 'body_weight',
    canonicalMetricType: DataWeight.type,
    displayName: 'Body weight',
    description: 'Recorded body-weight measurements, not a medical or health assessment. Values are normalized to kilograms and exclude event, activity, provider, device, and source identity.',
    aliases: [
      'body weight',
      'body mass',
      'weight',
      'weigh in',
      'weigh-in',
    ],
    minimumExclusive: 0,
    defaultAggregation: 'median',
    supportedAggregations: [
      'median',
      'average',
      'minimum',
      'maximum',
      'latest',
    ],
    defaultInterval: 'day',
    supportedIntervals: ['day', 'week', 'month'],
    currentTrend: {
      tool: 'get_training_metric',
      metricKind: DERIVED_METRIC_KINDS.BodyWeightTrend,
      windowDays: 28,
      readiness: 'ready_snapshot_required',
    },
  },
};

function normalizeMeasurementType(value: string): string {
  return `${value || ''}`
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getMcpMeasurementCatalog(): McpMeasurementDescriptor[] {
  return MCP_MEASUREMENT_TYPE_IDS.flatMap((id) => {
    const definition = MCP_MEASUREMENT_DEFINITIONS[id];
    const canonicalMetric = resolveSportsLibNumericMetric(
      definition.canonicalMetricType,
    );
    if (!canonicalMetric) {
      return [];
    }
    return [{
      id: definition.id,
      displayName: definition.displayName,
      description: definition.description,
      canonicalMetric,
      defaultAggregation: definition.defaultAggregation,
      supportedAggregations: definition.supportedAggregations,
      defaultInterval: definition.defaultInterval,
      supportedIntervals: definition.supportedIntervals,
      maximumRangeDays: 366,
      currentTrend: definition.currentTrend,
    }];
  });
}

export function resolveMcpMeasurementDefinition(
  requestedType: string,
): McpMeasurementDefinition | null {
  const normalized = normalizeMeasurementType(requestedType);
  return MCP_MEASUREMENT_TYPE_IDS
    .map(id => MCP_MEASUREMENT_DEFINITIONS[id])
    .find(definition => (
      normalizeMeasurementType(definition.id) === normalized
      || definition.aliases.some(alias => normalizeMeasurementType(alias) === normalized)
    )) || null;
}

export function isMcpMeasurementValueAllowed(
  definition: McpMeasurementDefinition,
  value: number,
): boolean {
  return Number.isFinite(value)
    && (
      definition.minimumExclusive === null
      || value > definition.minimumExclusive
    );
}
