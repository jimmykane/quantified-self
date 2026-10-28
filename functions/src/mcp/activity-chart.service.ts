import { ActivityInterface, DataDistance, DataLatitudeDegrees, DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import {
  ActivityChartSourceContext, ActivityChartDataInput, ActivityChartServiceDependencies,
  McpActivityChartXAxis, MCP_ACTIVITY_CHART_DEFAULT_POINTS, MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_MAX_POINTS, MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS, MCP_ACTIVITY_CHART_MAX_RESPONSE_BYTES,
  finiteValue, assertRuntime, ActivityChartBudgetError, loadActivityStreamsFromSources,
} from './activity-stream.service';

// Keep the existing import surface and registered chart contract stable.
export * from './activity-stream.service';

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
  const { activity, metrics, startedAtMs, now } = await loadActivityStreamsFromSources(context, input, dependencies);
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
