import {
  ActivityTypeGroups,
  ActivityTypes,
  ActivityTypesHelper,
  DataAltitude,
  DataAltitudeSmooth,
  DataCadence,
  DataDistance,
  DataGrade,
  DataGradeAdjustedPace,
  DataGradeAdjustedSpeed,
  DataGradeSmooth,
  DataHeartRate,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataPace,
  DataPower,
  DataSpeed,
  DataSwimPace,
  EventInterface,
  EventUtilities,
} from '@sports-alliance/sports-lib';
import { gunzipSync } from 'node:zlib';
import { OriginalFileMetaData } from '../../../shared/app-event.interface';
import { createParsingOptions } from '../../../shared/parsing-options';
import { parseActivityFilePayload } from '../shared/activity-file-parser';
import {
  ActivityIdentityLike,
  resolveActivityIdentityAssignments,
} from '../shared/activity-identity-matcher';

export const MCP_ACTIVITY_CHART_MAX_SOURCE_FILES = 4;
export const MCP_ACTIVITY_CHART_MAX_RAW_BYTES = 12 * 1024 * 1024;
export const MCP_ACTIVITY_CHART_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES = 250_000;
export const MCP_ACTIVITY_CHART_MAX_RUNTIME_MS = 20_000;
export const MCP_ACTIVITY_CHART_MAX_RESPONSE_BYTES = 256 * 1024;
export const MCP_ACTIVITY_CHART_DEFAULT_POINTS = 300;
export const MCP_ACTIVITY_CHART_MAX_POINTS = 400;
export const MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS = 500;
export const MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS = 1_000;

export type McpActivityChartXAxis = 'elapsed_time' | 'distance';

interface ChartMetricDefinition {
  id: string;
  label: string;
  streamType: string;
  unit: string;
  aliases: readonly string[];
  availability: 'always' | 'outdoor' | 'speed-derived';
  parserDependencyStreamTypes: readonly string[];
}

const POSITION_STREAM_TYPES = [
  DataLatitudeDegrees.type,
  DataLongitudeDegrees.type,
] as const;
const DISTANCE_DEPENDENCY_STREAM_TYPES = [
  ...POSITION_STREAM_TYPES,
] as const;
const SPEED_DEPENDENCY_STREAM_TYPES = [
  ...POSITION_STREAM_TYPES,
] as const;
const GRADE_DEPENDENCY_STREAM_TYPES = [
  DataDistance.type,
  DataAltitudeSmooth.type,
  DataAltitude.type,
  ...DISTANCE_DEPENDENCY_STREAM_TYPES,
] as const;
const GRADE_ADJUSTED_SPEED_DEPENDENCY_STREAM_TYPES = [
  DataSpeed.type,
  DataGradeSmooth.type,
  DataGrade.type,
  ...SPEED_DEPENDENCY_STREAM_TYPES,
  ...GRADE_DEPENDENCY_STREAM_TYPES,
] as const;

export const MCP_ACTIVITY_CHART_METRICS = [
  {
    id: 'heart_rate',
    label: 'Heart rate',
    streamType: DataHeartRate.type,
    unit: 'beats_per_minute',
    aliases: ['heart rate', 'hr', DataHeartRate.type],
    availability: 'always',
    parserDependencyStreamTypes: [],
  },
  {
    id: 'power',
    label: 'Power',
    streamType: DataPower.type,
    unit: 'watts',
    aliases: ['watts', DataPower.type],
    availability: 'always',
    parserDependencyStreamTypes: [],
  },
  {
    id: 'cadence',
    label: 'Cadence',
    streamType: DataCadence.type,
    unit: 'revolutions_per_minute',
    aliases: ['rpm', DataCadence.type],
    availability: 'always',
    parserDependencyStreamTypes: [],
  },
  {
    id: 'altitude',
    label: 'Altitude',
    streamType: DataAltitude.type,
    unit: 'meters',
    aliases: ['elevation', DataAltitude.type],
    availability: 'outdoor',
    parserDependencyStreamTypes: [],
  },
  {
    id: 'grade',
    label: 'Grade',
    streamType: DataGrade.type,
    unit: 'percent',
    aliases: ['slope', DataGrade.type],
    availability: 'outdoor',
    parserDependencyStreamTypes: GRADE_DEPENDENCY_STREAM_TYPES,
  },
  {
    id: 'distance',
    label: 'Distance',
    streamType: DataDistance.type,
    unit: 'meters',
    aliases: [DataDistance.type],
    availability: 'always',
    parserDependencyStreamTypes: DISTANCE_DEPENDENCY_STREAM_TYPES,
  },
  {
    id: 'speed',
    label: 'Speed',
    streamType: DataSpeed.type,
    unit: 'meters_per_second',
    aliases: [DataSpeed.type],
    availability: 'speed-derived',
    parserDependencyStreamTypes: SPEED_DEPENDENCY_STREAM_TYPES,
  },
  {
    id: 'pace',
    label: 'Pace',
    streamType: DataPace.type,
    unit: 'seconds_per_kilometer',
    aliases: ['running pace', DataPace.type],
    availability: 'speed-derived',
    parserDependencyStreamTypes: [
      DataSpeed.type,
      ...SPEED_DEPENDENCY_STREAM_TYPES,
    ],
  },
  {
    id: 'swim_pace',
    label: 'Swim pace',
    streamType: DataSwimPace.type,
    unit: 'seconds_per_100_meters',
    aliases: ['swimming pace', DataSwimPace.type],
    availability: 'speed-derived',
    parserDependencyStreamTypes: [
      DataSpeed.type,
      ...SPEED_DEPENDENCY_STREAM_TYPES,
    ],
  },
  {
    id: 'grade_adjusted_speed',
    label: 'Grade-adjusted speed',
    streamType: DataGradeAdjustedSpeed.type,
    unit: 'meters_per_second',
    aliases: ['gap speed', DataGradeAdjustedSpeed.type],
    availability: 'speed-derived',
    parserDependencyStreamTypes:
      GRADE_ADJUSTED_SPEED_DEPENDENCY_STREAM_TYPES,
  },
  {
    id: 'grade_adjusted_pace',
    label: 'Grade-adjusted pace',
    streamType: DataGradeAdjustedPace.type,
    unit: 'seconds_per_kilometer',
    aliases: ['gap', 'grade adjusted pace', DataGradeAdjustedPace.type],
    availability: 'speed-derived',
    parserDependencyStreamTypes: [
      DataGradeAdjustedSpeed.type,
      ...GRADE_ADJUSTED_SPEED_DEPENDENCY_STREAM_TYPES,
    ],
  },
] as const satisfies readonly ChartMetricDefinition[];

function normalizeMetricName(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
}

export function resolveMetric(value: string): ChartMetricDefinition | null {
  const normalized = normalizeMetricName(value);
  return MCP_ACTIVITY_CHART_METRICS.find(metric => (
    normalizeMetricName(metric.id) === normalized
    || metric.aliases.some(alias => normalizeMetricName(alias) === normalized)
  )) || null;
}

function isChartMetricSupportedForActivityType(
  metric: ChartMetricDefinition,
  activityType: ActivityTypes,
): boolean {
  if (metric.streamType === DataCadence.type && ActivityTypesHelper.usesStrokeRate(activityType)) {
    return false;
  }
  if (metric.availability === 'always') {
    return true;
  }
  if (metric.availability === 'outdoor') {
    const activityGroup = ActivityTypesHelper.getActivityGroupForActivityType(
      activityType,
    );
    return !ActivityTypesHelper.isIndoorActivityType(activityType)
      && activityGroup !== ActivityTypeGroups.SwimmingGroup
      && activityGroup !== ActivityTypeGroups.WaterSportsGroup;
  }
  const supportedDerivedTypes = new Set([
    ...ActivityTypesHelper.speedDerivedDataTypesToUseForActivityType(activityType),
    ...ActivityTypesHelper.altiDistanceSpeedDerivedDataTypesToUseForActivityType(
      activityType,
    ),
  ]);
  return supportedDerivedTypes.has(metric.streamType);
}

export function getUnsupportedActivityChartMetrics(
  requestedMetrics: readonly string[],
  activityType: string,
): string[] {
  const resolvedActivityType = ActivityTypesHelper.resolveActivityType(
    activityType,
  );
  if (!resolvedActivityType) {
    return [...requestedMetrics];
  }
  return requestedMetrics.filter((requestedMetric) => {
    const metric = resolveMetric(requestedMetric);
    return !metric
      || !isChartMetricSupportedForActivityType(metric, resolvedActivityType);
  });
}

export function listActivityChartMetrics(activityType?: string) {
  const resolvedType = activityType
    ? ActivityTypesHelper.resolveActivityType(activityType)
    : null;
  return {
    activityType: resolvedType ? String(resolvedType) : null,
    metrics: MCP_ACTIVITY_CHART_METRICS
      .filter(metric => (
        !resolvedType
        || isChartMetricSupportedForActivityType(metric, resolvedType)
      ))
      .map(metric => ({
        metric: metric.id,
        label: metric.label,
        canonicalUnit: metric.unit,
      })),
    xAxes: [
      { xAxis: 'elapsed_time', canonicalUnit: 'seconds' },
      { xAxis: 'distance', canonicalUnit: 'meters' },
    ],
    pointLimits: {
      defaultPerMetric: MCP_ACTIVITY_CHART_DEFAULT_POINTS,
      maximumPerMetric: MCP_ACTIVITY_CHART_MAX_POINTS,
      defaultLocation: MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS,
      maximumLocation: MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS,
    },
  };
}

export interface ActivityChartSourceContext {
  sourceFiles: OriginalFileMetaData[];
  existingActivities: ActivityIdentityLike[];
  targetExistingIndex: number;
}

export interface ActivityChartDataInput {
  metrics: readonly string[];
  xAxis: McpActivityChartXAxis;
  maxPoints?: number;
  includeLocation?: boolean;
  maxLocationPoints?: number;
}

export interface ActivityChartServiceDependencies {
  loadSource: (
    sourceFile: OriginalFileMetaData,
    maximumBytes: number,
  ) => Promise<Buffer>;
  parseSource?: typeof parseActivityFilePayload;
  now?: () => number;
}

export class ActivityChartBudgetError extends Error {}

export function assertRuntime(startedAtMs: number, now: () => number): void {
  if (now() - startedAtMs > MCP_ACTIVITY_CHART_MAX_RUNTIME_MS) {
    throw new ActivityChartBudgetError('Activity chart parsing exceeded its runtime limit.');
  }
}

function sourceExtension(path: string): string {
  const normalized = path.toLowerCase();
  const withoutGzip = normalized.endsWith('.gz')
    ? normalized.slice(0, -3)
    : normalized;
  const extension = withoutGzip.split('.').pop() || '';
  if (!['fit', 'gpx', 'tcx', 'json', 'sml'].includes(extension)) {
    throw new Error('The original activity format is not supported for charts.');
  }
  return extension;
}

function prepareSource(
  sourceFile: OriginalFileMetaData,
  raw: Buffer,
  remainingDecompressedBytes: number,
): Buffer {
  if (remainingDecompressedBytes <= 0) {
    throw new ActivityChartBudgetError(
      'Activity chart sources exceed the decompressed size limit.',
    );
  }
  const gzip = sourceFile.path.toLowerCase().endsWith('.gz')
    || (raw[0] === 0x1f && raw[1] === 0x8b);
  try {
    const prepared = gzip
      ? gunzipSync(raw, { maxOutputLength: remainingDecompressedBytes })
      : raw;
    if (prepared.byteLength > remainingDecompressedBytes) {
      throw new ActivityChartBudgetError(
        'Activity chart sources exceed the decompressed size limit.',
      );
    }
    return prepared;
  } catch (error) {
    if (error instanceof ActivityChartBudgetError) {
      throw error;
    }
    throw new ActivityChartBudgetError(
      'Activity chart source decompression exceeded its limit.',
    );
  }
}

export function finiteValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countMaterializedSamples(event: EventInterface): number {
  return event.getActivities().reduce(
    (eventSum, activity) => eventSum + activity.getAllStreams()
      .reduce((activitySum, stream) => (
        activitySum + stream.getData().length
      ), 0),
    0,
  );
}

function pruneUnselectedStreams(
  event: EventInterface,
  selectedStreamTypes: ReadonlySet<string>,
): void {
  event.getActivities().forEach((activity) => {
    [...activity.getAllStreams()].forEach((stream) => {
      if (!selectedStreamTypes.has(stream.type)) {
        activity.removeStream(stream);
      }
    });
  });
}

export async function loadActivityStreamsFromSources(
  context: ActivityChartSourceContext,
  input: Pick<ActivityChartDataInput, 'metrics' | 'xAxis' | 'includeLocation'>,
  dependencies: ActivityChartServiceDependencies,
) {
  if (!Array.isArray(input.metrics) || input.metrics.length < 1 || input.metrics.length > 4) {
    throw new Error('Choose between one and four activity chart metrics.');
  }
  const metrics = [...new Map(input.metrics.map((value) => {
    if (typeof value !== 'string' || value.length > 120) {
      throw new Error('An activity chart metric is invalid.');
    }
    const metric = resolveMetric(value);
    if (!metric) {
      throw new Error(`Unsupported activity chart metric: ${value}`);
    }
    return [metric.id, metric] as const;
  })).values()];
  if (input.xAxis !== 'elapsed_time' && input.xAxis !== 'distance') {
    throw new Error('xAxis must be elapsed_time or distance.');
  }
  if (
    context.sourceFiles.length === 0
    || context.sourceFiles.length > MCP_ACTIVITY_CHART_MAX_SOURCE_FILES
  ) {
    throw new ActivityChartBudgetError('The activity does not have a bounded source set.');
  }

  const now = dependencies.now || Date.now;
  const parseSource = dependencies.parseSource || parseActivityFilePayload;
  const startedAtMs = now();
  let rawBytes = 0;
  let decompressedBytes = 0;
  const events: EventInterface[] = [];
  const requestedStreams = [
    ...new Set([
      ...metrics.map(metric => metric.streamType),
      ...(input.xAxis === 'distance' ? [DataDistance.type] : []),
      ...(input.includeLocation
        ? POSITION_STREAM_TYPES
        : []),
    ]),
  ];
  const selectedStreamTypes = new Set(requestedStreams);
  const parserStreams = [
    ...new Set([
      ...requestedStreams,
      ...metrics.flatMap(metric => metric.parserDependencyStreamTypes),
      ...(input.xAxis === 'distance'
        ? DISTANCE_DEPENDENCY_STREAM_TYPES
        : []),
    ]),
  ];
  const parserStreamTypes = new Set(parserStreams);
  let materializedSampleCount = 0;
  for (const sourceFile of context.sourceFiles) {
    assertRuntime(startedAtMs, now);
    sourceExtension(sourceFile.path);
    const remainingRawBytes = MCP_ACTIVITY_CHART_MAX_RAW_BYTES - rawBytes;
    if (remainingRawBytes <= 0) {
      throw new ActivityChartBudgetError('Activity chart sources exceed the raw size limit.');
    }
    const raw = await dependencies.loadSource(sourceFile, remainingRawBytes);
    rawBytes += raw.byteLength;
    if (rawBytes > MCP_ACTIVITY_CHART_MAX_RAW_BYTES) {
      throw new ActivityChartBudgetError('Activity chart sources exceed the raw size limit.');
    }
    const prepared = prepareSource(
      sourceFile,
      raw,
      MCP_ACTIVITY_CHART_MAX_DECOMPRESSED_BYTES - decompressedBytes,
    );
    decompressedBytes += prepared.byteLength;
    assertRuntime(startedAtMs, now);
    const parsedSource = await parseSource(
      prepared,
      sourceFile.path,
      createParsingOptions({}, parserStreams),
    );
    materializedSampleCount += countMaterializedSamples(parsedSource);
    if (materializedSampleCount > MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES) {
      throw new ActivityChartBudgetError(
        'The requested activity streams exceed the selected-sample limit.',
      );
    }
    // Sports Lib prunes importer-only derivation dependencies to includeTypes
    // before returning. Keep the explicit dependency closure through merging so
    // every materialized chart/dependency sample remains budget-accounted.
    pruneUnselectedStreams(parsedSource, parserStreamTypes);
    events.push(parsedSource);
    assertRuntime(startedAtMs, now);
  }

  const parsedEvent = events.length === 1 ? events[0] : EventUtilities.mergeEvents(events);
  if (countMaterializedSamples(parsedEvent) > MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES) {
    throw new ActivityChartBudgetError(
      'The merged activity streams exceed the selected-sample limit.',
    );
  }
  pruneUnselectedStreams(parsedEvent, selectedStreamTypes);
  assertRuntime(startedAtMs, now);
  const parsedActivities = parsedEvent.getActivities();
  const assignments = resolveActivityIdentityAssignments(
    context.existingActivities,
    parsedActivities as unknown as ActivityIdentityLike[],
  );
  const parsedMatches = [...assignments.assignments.entries()]
    .filter(entry => entry[1] === context.targetExistingIndex)
    .map(([parsedIndex]) => parsedIndex);
  if (parsedMatches.length !== 1) {
    throw new Error('The source activity identity is missing or ambiguous.');
  }
  const activity = parsedActivities[parsedMatches[0]];
  if (!activity) {
    throw new Error('The source activity could not be matched.');
  }

  return { activity, metrics, startedAtMs, now };
}
