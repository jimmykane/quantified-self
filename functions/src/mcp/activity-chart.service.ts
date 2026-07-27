import {
  ActivityInterface,
  ActivityTypesHelper,
  DataAltitude,
  DataCadence,
  DataDistance,
  DataGrade,
  DataGradeAdjustedPace,
  DataGradeAdjustedSpeed,
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
  families: readonly string[];
}

const CHART_METRICS: readonly ChartMetricDefinition[] = [
  {
    id: 'heart_rate',
    label: 'Heart rate',
    streamType: DataHeartRate.type,
    unit: 'beats_per_minute',
    aliases: ['heart rate', 'hr', DataHeartRate.type],
    families: ['all'],
  },
  {
    id: 'power',
    label: 'Power',
    streamType: DataPower.type,
    unit: 'watts',
    aliases: ['watts', DataPower.type],
    families: ['all'],
  },
  {
    id: 'cadence',
    label: 'Cadence',
    streamType: DataCadence.type,
    unit: 'revolutions_per_minute',
    aliases: ['rpm', DataCadence.type],
    families: ['all'],
  },
  {
    id: 'altitude',
    label: 'Altitude',
    streamType: DataAltitude.type,
    unit: 'meters',
    aliases: ['elevation', DataAltitude.type],
    families: ['outdoor'],
  },
  {
    id: 'grade',
    label: 'Grade',
    streamType: DataGrade.type,
    unit: 'percent',
    aliases: ['slope', DataGrade.type],
    families: ['outdoor'],
  },
  {
    id: 'distance',
    label: 'Distance',
    streamType: DataDistance.type,
    unit: 'meters',
    aliases: [DataDistance.type],
    families: ['all'],
  },
  {
    id: 'speed',
    label: 'Speed',
    streamType: DataSpeed.type,
    unit: 'meters_per_second',
    aliases: [DataSpeed.type],
    families: ['all'],
  },
  {
    id: 'pace',
    label: 'Pace',
    streamType: DataPace.type,
    unit: 'seconds_per_kilometer',
    aliases: ['running pace', DataPace.type],
    families: ['running'],
  },
  {
    id: 'swim_pace',
    label: 'Swim pace',
    streamType: DataSwimPace.type,
    unit: 'seconds_per_100_meters',
    aliases: ['swimming pace', DataSwimPace.type],
    families: ['swimming'],
  },
  {
    id: 'grade_adjusted_speed',
    label: 'Grade-adjusted speed',
    streamType: DataGradeAdjustedSpeed.type,
    unit: 'meters_per_second',
    aliases: ['gap speed', DataGradeAdjustedSpeed.type],
    families: ['trail'],
  },
  {
    id: 'grade_adjusted_pace',
    label: 'Grade-adjusted pace',
    streamType: DataGradeAdjustedPace.type,
    unit: 'seconds_per_kilometer',
    aliases: ['gap', 'grade adjusted pace', DataGradeAdjustedPace.type],
    families: ['trail'],
  },
] as const;

function normalizeMetricName(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
}

function resolveMetric(value: string): ChartMetricDefinition | null {
  const normalized = normalizeMetricName(value);
  return CHART_METRICS.find(metric => (
    normalizeMetricName(metric.id) === normalized
    || metric.aliases.some(alias => normalizeMetricName(alias) === normalized)
  )) || null;
}

function activityFamily(activityType: string | undefined): string {
  const normalized = `${activityType || ''}`.toLowerCase();
  if (normalized.includes('trail')) {
    return 'trail';
  }
  if (normalized.includes('run') || normalized.includes('walk') || normalized.includes('hike')) {
    return 'running';
  }
  if (normalized.includes('swim')) {
    return 'swimming';
  }
  return normalized ? 'outdoor' : 'all';
}

export function listActivityChartMetrics(activityType?: string) {
  const resolvedType = activityType
    ? ActivityTypesHelper.resolveActivityType(activityType)
    : null;
  const family = activityFamily(resolvedType ? String(resolvedType) : activityType);
  return {
    activityType: resolvedType ? String(resolvedType) : null,
    metrics: CHART_METRICS
      .filter(metric => (
        !activityType
        || metric.families.includes('all')
        || metric.families.includes(family)
        || (family === 'trail' && metric.families.includes('running'))
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

class ActivityChartBudgetError extends Error {}

function assertRuntime(startedAtMs: number, now: () => number): void {
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

function finiteValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface SamplePoint {
  sourceIndex: number;
  x: number;
  value: number;
}

function downsampleScalar(points: readonly SamplePoint[], maximum: number): SamplePoint[] {
  if (points.length <= maximum) {
    return [...points];
  }
  const first = points[0];
  const last = points[points.length - 1];
  const internal = points.slice(1, -1);
  const bucketCount = Math.max(1, Math.floor((maximum - 2) / 2));
  const selected: SamplePoint[] = [first];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * internal.length) / bucketCount);
    const end = Math.floor(((bucket + 1) * internal.length) / bucketCount);
    const values = internal.slice(start, end);
    if (values.length === 0) {
      continue;
    }
    const minimum = values.reduce((candidate, point) => (
      point.value < candidate.value ? point : candidate
    ));
    const maximumPoint = values.reduce((candidate, point) => (
      point.value > candidate.value ? point : candidate
    ));
    [minimum, maximumPoint]
      .sort((left, right) => left.sourceIndex - right.sourceIndex)
      .forEach((point) => {
        if (selected[selected.length - 1]?.sourceIndex !== point.sourceIndex) {
          selected.push(point);
        }
      });
  }
  if (selected[selected.length - 1]?.sourceIndex !== last.sourceIndex) {
    selected.push(last);
  }
  return selected.slice(0, maximum - 1).concat(last).filter(
    (point, index, all) => index === 0 || point.sourceIndex !== all[index - 1].sourceIndex,
  );
}

interface LocationPoint {
  sourceIndex: number;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

interface AreaHeapEntry {
  pointIndex: number;
  area: number;
  version: number;
}

function wrappedLongitudeDelta(value: number): number {
  return ((value + 540) % 360) - 180;
}

function locationTriangleArea(
  first: LocationPoint,
  middle: LocationPoint,
  last: LocationPoint,
): number {
  const latitudeScale = Math.cos(
    ((first.latitudeDegrees + middle.latitudeDegrees + last.latitudeDegrees) / 3)
      * (Math.PI / 180),
  );
  const middleX = wrappedLongitudeDelta(
    middle.longitudeDegrees - first.longitudeDegrees,
  ) * latitudeScale;
  const lastX = wrappedLongitudeDelta(
    last.longitudeDegrees - first.longitudeDegrees,
  ) * latitudeScale;
  const middleY = middle.latitudeDegrees - first.latitudeDegrees;
  const lastY = last.latitudeDegrees - first.latitudeDegrees;
  return Math.abs((middleX * lastY) - (lastX * middleY)) / 2;
}

function pushAreaHeap(heap: AreaHeapEntry[], entry: AreaHeapEntry): void {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].area <= entry.area) {
      break;
    }
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = entry;
}

function popAreaHeap(heap: AreaHeapEntry[]): AreaHeapEntry | null {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) {
    return first || null;
  }
  let index = 0;
  while (true) {
    const left = (index * 2) + 1;
    if (left >= heap.length) {
      break;
    }
    const right = left + 1;
    const child = right < heap.length && heap[right].area < heap[left].area
      ? right
      : left;
    if (heap[child].area >= last.area) {
      break;
    }
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

function simplifyLocationIndexes(
  points: readonly LocationPoint[],
  maximum: number,
): number[] {
  if (points.length <= maximum) {
    return points.map(point => point.sourceIndex);
  }
  const previous = points.map((_point, index) => index - 1);
  const next = points.map((_point, index) => index + 1);
  next[next.length - 1] = -1;
  const removed = Array(points.length).fill(false) as boolean[];
  const versions = Array(points.length).fill(0) as number[];
  const heap: AreaHeapEntry[] = [];
  const addCandidate = (pointIndex: number) => {
    if (
      pointIndex <= 0
      || pointIndex >= points.length - 1
      || removed[pointIndex]
    ) {
      return;
    }
    pushAreaHeap(heap, {
      pointIndex,
      area: locationTriangleArea(
        points[previous[pointIndex]],
        points[pointIndex],
        points[next[pointIndex]],
      ),
      version: versions[pointIndex],
    });
  };
  for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
    addCandidate(pointIndex);
  }

  let remaining = points.length;
  while (remaining > maximum) {
    const candidate = popAreaHeap(heap);
    if (!candidate) {
      break;
    }
    const pointIndex = candidate.pointIndex;
    if (
      removed[pointIndex]
      || candidate.version !== versions[pointIndex]
    ) {
      continue;
    }
    const previousIndex = previous[pointIndex];
    const nextIndex = next[pointIndex];
    if (previousIndex < 0 || nextIndex < 0) {
      continue;
    }
    removed[pointIndex] = true;
    next[previousIndex] = nextIndex;
    previous[nextIndex] = previousIndex;
    remaining -= 1;
    [previousIndex, nextIndex].forEach((neighborIndex) => {
      versions[neighborIndex] += 1;
      addCandidate(neighborIndex);
    });
  }
  return points.flatMap((point, index) => (
    removed[index] ? [] : [point.sourceIndex]
  ));
}

function valueAt(values: readonly (number | null)[], index: number): number | null {
  return finiteValue(values[index]);
}

function buildXAxis(
  activity: ActivityInterface,
  xAxis: McpActivityChartXAxis,
): (number | null)[] {
  if (xAxis === 'distance') {
    return activity.getStreamData(DataDistance.type).map(finiteValue);
  }
  const sourceLength = Math.max(
    0,
    ...activity.getAllStreams().map(stream => stream.getData().length),
  );
  return Array.from({ length: sourceLength }, (_unused, index) => index);
}

export async function getActivityChartDataFromSources(
  context: ActivityChartSourceContext,
  input: ActivityChartDataInput,
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
  const maxPoints = input.maxPoints ?? MCP_ACTIVITY_CHART_DEFAULT_POINTS;
  const maxLocationPoints = input.maxLocationPoints
    ?? MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS;
  if (!Number.isInteger(maxPoints) || maxPoints < 2 || maxPoints > MCP_ACTIVITY_CHART_MAX_POINTS) {
    throw new Error(`maxPoints must be between 2 and ${MCP_ACTIVITY_CHART_MAX_POINTS}.`);
  }
  if (
    !Number.isInteger(maxLocationPoints)
    || maxLocationPoints < 2
    || maxLocationPoints > MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS
  ) {
    throw new Error(
      `maxLocationPoints must be between 2 and ${MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS}.`,
    );
  }
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
        ? [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
        : []),
    ]),
  ];
  const selectedStreamTypes = new Set(requestedStreams);
  let selectedSampleCount = 0;
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
      createParsingOptions({}, requestedStreams),
    );
    selectedSampleCount += parsedSource.getActivities().reduce(
      (eventSum, parsedActivity) => eventSum + [...selectedStreamTypes].reduce(
        (activitySum, streamType) => (
          activitySum + parsedActivity.getStreamData(streamType).length
        ),
        0,
      ),
      0,
    );
    if (selectedSampleCount > MCP_ACTIVITY_CHART_MAX_SELECTED_SAMPLES) {
      throw new ActivityChartBudgetError(
        'The requested activity streams exceed the selected-sample limit.',
      );
    }
    events.push(parsedSource);
    assertRuntime(startedAtMs, now);
  }

  const parsedEvent = events.length === 1 ? events[0] : EventUtilities.mergeEvents(events);
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

  const xValues = buildXAxis(activity, input.xAxis);

  const series = metrics.map((metric) => {
    const values = activity.getStreamData(metric.streamType);
    const sourceSampleCount = values.length;
    const missingSampleCount = values.reduce<number>(
      (sum, value) => sum + (finiteValue(value) === null ? 1 : 0),
      0,
    );
    const points = values.flatMap((value, index) => {
      const numericValue = finiteValue(value);
      const x = input.xAxis === 'elapsed_time' ? index : valueAt(xValues, index);
      return numericValue !== null && x !== null
        ? [{ sourceIndex: index, x, value: numericValue }]
        : [];
    });
    const returned = downsampleScalar(points, maxPoints);
    return {
      metric: metric.id,
      canonicalUnit: metric.unit,
      xValues: returned.map(point => point.x),
      values: returned.map(point => point.value),
      sourceSampleCount,
      returnedSampleCount: returned.length,
      missingSampleCount,
    };
  });

  let location: Record<string, unknown> | null = null;
  if (input.includeLocation) {
    const latitudes = activity.getStreamData(DataLatitudeDegrees.type);
    const longitudes = activity.getStreamData(DataLongitudeDegrees.type);
    const sourceSampleCount = Math.max(latitudes.length, longitudes.length);
    const validPoints = Array.from(
      { length: sourceSampleCount },
      (_unused, index) => index,
    ).flatMap((index) => {
      const latitude = valueAt(latitudes, index);
      const longitude = valueAt(longitudes, index);
      const x = input.xAxis === 'elapsed_time' ? index : valueAt(xValues, index);
      return (
        latitude !== null
        && longitude !== null
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180
        && x !== null
      ) ? [{
          sourceIndex: index,
          latitudeDegrees: latitude,
          longitudeDegrees: longitude,
        }] : [];
    });
    const returnedIndexes = simplifyLocationIndexes(validPoints, maxLocationPoints);
    location = {
      xValues: returnedIndexes.map(index => (
        input.xAxis === 'elapsed_time' ? index : valueAt(xValues, index)
      )),
      latitudeDegrees: returnedIndexes.map(index => valueAt(latitudes, index)),
      longitudeDegrees: returnedIndexes.map(index => valueAt(longitudes, index)),
      sourceSampleCount,
      returnedSampleCount: returnedIndexes.length,
      missingSampleCount: sourceSampleCount - validPoints.length,
    };
  }

  assertRuntime(startedAtMs, now);
  const result = {
    activityType: String(activity.type),
    xAxis: input.xAxis,
    xAxisUnit: input.xAxis === 'elapsed_time' ? 'seconds' : 'meters',
    series,
    ...(input.includeLocation ? { location } : {}),
  };
  const responseBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (responseBytes > MCP_ACTIVITY_CHART_MAX_RESPONSE_BYTES) {
    throw new ActivityChartBudgetError(
      'The activity chart response exceeds the response size limit.',
    );
  }
  return result;
}
