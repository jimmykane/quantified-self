import {
  ActivityInterface,
  ActivityUtilities,
  DataDistance,
  DataDuration,
  DataGradeAdjustedSpeed,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataSpeed,
  DataStrydDistance,
  DynamicDataLoader,
  LapTypes,
  StreamInterface,
  UserUnitSettingsInterface,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../services/color/app.event.color.service';
import { applyEventChartCanonicalOrderOverride } from './event-chart-order.helper';
import { resolveEventColorGroupKey, resolveEventSeriesColor } from './event-echarts-style.helper';
import { normalizeUnitDerivedTypeLabel } from './stat-label.helper';

export interface EventChartPoint {
  x: number;
  y: number;
  time: number;
}

export interface EventChartPanelSeries {
  id: string;
  activityID: string;
  activityName: string;
  color: string;
  streamType: string;
  displayName: string;
  unit: string;
  points: EventChartPoint[];
}

export interface EventChartPanelModel {
  dataType: string;
  displayName: string;
  unit: string;
  colorGroupKey: string;
  series: EventChartPanelSeries[];
  minX: number;
  maxX: number;
}

export interface EventLegendItem {
  activityID: string;
  label: string;
  color: string;
}

export interface EventChartLapMarker {
  xValue: number;
  label: string;
  color: string;
  lapType: string;
}

export interface BuildEventChartPanelsInput {
  selectedActivities: ActivityInterface[];
  allActivities: ActivityInterface[];
  xAxisType: XAxisTypes;
  showAllData: boolean;
  dataTypesToUse: string[];
  userUnitSettings: UserUnitSettingsInterface;
  eventColorService: AppEventColorService;
}

const LAP_TYPE_ALIASES = LapTypes as unknown as Record<string, string>;
const NORMALIZED_LAP_TYPE_ALIASES = new Map<string, string>([
  ['auto', LapTypes.AutoLap],
  ['autolap', LapTypes.AutoLap],
  ['auto lap', LapTypes.AutoLap],
  ['manual', LapTypes.Manual],
  ['distance', LapTypes.Distance],
  ['time', LapTypes.Time],
  ['location', LapTypes.Location],
  ['interval', LapTypes.Interval],
  ['heart rate', LapTypes.HeartRate],
  ['heartrate', LapTypes.HeartRate],
]);

const EMPTY_PANEL_DOMAIN = { minX: 0, maxX: 1 };
const NEVER_RENDER_STREAM_TYPES = new Set<string>([
  DataDuration.type,
  XAxisTypes.Time,
  XAxisTypes.Duration,
]);
const ALL_KNOWN_UNIT_VARIANTS = new Set<string>(
  Object.values((DynamicDataLoader as unknown as { dataTypeUnitGroups?: Record<string, Record<string, unknown>> })
    .dataTypeUnitGroups ?? {})
    .flatMap((group) => Object.keys(group || {}))
);

interface ActivityNumericCache {
  startTimeMs: number;
  streamValuesByType: Map<string, number[]>;
  timeValues: number[] | null;
  distanceValues: number[] | null;
  absoluteTimeValues: number[] | null;
}

interface LapDistanceLookup {
  absoluteTimes: number[];
  distanceValues: number[];
  isMonotonic: boolean;
}

export function buildEventChartPanels(input: BuildEventChartPanelsInput): EventChartPanelModel[] {
  const selectedActivities = Array.isArray(input.selectedActivities) ? input.selectedActivities : [];
  if (!selectedActivities.length) {
    return [];
  }

  const panelsMap = new Map<string, EventChartPanelModel>();
  const preferredDataTypeOrder = buildPreferredDataTypeOrder(input.dataTypesToUse, input.userUnitSettings);

  selectedActivities.forEach((activity) => {
    const activityCache = createActivityNumericCache(activity);
    const streams = activity.getAllStreams() || [];
    if (!streams.length) {
      return;
    }

    const allowedStreams = getFilteredStreams({
      streams,
      showAllData: input.showAllData,
      dataTypesToUse: input.dataTypesToUse,
      userUnitSettings: input.userUnitSettings,
      activityType: activity.type
    });

    allowedStreams.forEach((stream) => {
      const points = toSeriesPoints(activity, stream, input.xAxisType, activityCache);
      if (!points.length) {
        return;
      }

      const streamDataClass = DynamicDataLoader.getDataClassFromDataType(stream.type);
      const displayName = normalizeUnitDerivedTypeLabel(
        stream.type,
        streamDataClass.displayType || streamDataClass.type
      );
      const unit = streamDataClass.unit || '';

      if (!panelsMap.has(stream.type)) {
        panelsMap.set(stream.type, {
          dataType: stream.type,
          displayName,
          unit,
          colorGroupKey: resolveEventColorGroupKey(stream.type),
          series: [],
          ...EMPTY_PANEL_DOMAIN
        });
      }

      const panel = panelsMap.get(stream.type) as EventChartPanelModel;
      const activityID = activity.getID() || '';
      panel.series.push({
        id: `${activityID}::${stream.type}`,
        activityID,
        activityName: activity.creator?.name || 'Activity',
        color: resolveEventSeriesColor(panel.colorGroupKey, panel.series.length, 1),
        streamType: stream.type,
        displayName,
        unit,
        points,
      });
    });
  });

  const panels = [...panelsMap.values()]
    .map((panel) => {
      const seriesCount = panel.series.length;
      const recoloredSeries = panel.series.map((series, index) => ({
        ...series,
        color: resolveEventSeriesColor(panel.colorGroupKey, index, seriesCount),
      }));
      return enrichPanelDomain({
        ...panel,
        series: recoloredSeries,
      });
    })
    .sort((left, right) => comparePanelsByPreference(left, right, preferredDataTypeOrder));

  return panels;
}

export function buildEventLegendItems(
  activities: ActivityInterface[],
  eventColorService: AppEventColorService,
  colorScopeActivities?: ActivityInterface[]
): EventLegendItem[] {
  const safeActivities = Array.isArray(activities) ? activities : [];
  const colorScope = Array.isArray(colorScopeActivities) && colorScopeActivities.length > 0
    ? colorScopeActivities
    : safeActivities;
  return safeActivities.map((activity) => ({
    activityID: activity.getID() || '',
    label: activity.creator?.name || activity.getID() || 'Activity',
    color: eventColorService.getActivityColor(colorScope, activity),
  }));
}

export function buildEventLapMarkers(input: {
  selectedActivities: ActivityInterface[];
  allActivities: ActivityInterface[];
  xAxisType: XAxisTypes;
  lapTypes: LapTypes[];
  eventColorService: AppEventColorService;
}): EventChartLapMarker[] {
  const lapTypeSet = new Set((input.lapTypes || []).map((lapType) => normalizeEventLapType(lapType)));
  const markers: EventChartLapMarker[] = [];

  input.selectedActivities.forEach((activity) => {
    const activityCache = createActivityNumericCache(activity);
    const lapDistanceLookup = input.xAxisType === XAxisTypes.Distance
      ? createLapDistanceLookup(activity, activityCache)
      : null;
    const laps = activity.getLaps() || [];
    if (!laps.length) {
      return;
    }

    laps.forEach((lap, index) => {
      if (index === laps.length - 1) {
        return;
      }

      const normalizedLapType = normalizeEventLapType(lap.type);
      if (lapTypeSet.size > 0 && !lapTypeSet.has(normalizedLapType)) {
        return;
      }

      const xValue = resolveLapAxisValue(activity, lap.endDate?.getTime(), input.xAxisType, lapDistanceLookup);
      if (!Number.isFinite(xValue)) {
        return;
      }

      markers.push({
        xValue,
        label: `Lap ${index + 1}`,
        color: input.eventColorService.getActivityColor(input.allActivities, activity),
        lapType: normalizedLapType,
      });
    });
  });

  return markers.sort((left, right) => left.xValue - right.xValue);
}

export function normalizeEventLapType(lapType: unknown): string {
  const rawValue = `${lapType ?? ''}`.trim();
  if (!rawValue) {
    return '';
  }

  const normalizedLookupKey = rawValue.toLowerCase();
  return NORMALIZED_LAP_TYPE_ALIASES.get(normalizedLookupKey)
    || LAP_TYPE_ALIASES[rawValue]
    || rawValue;
}

function getFilteredStreams(input: {
  streams: StreamInterface[];
  showAllData: boolean;
  dataTypesToUse: string[];
  userUnitSettings: UserUnitSettingsInterface;
  activityType: any;
}): StreamInterface[] {
  const includeDerivedTypes = !input.showAllData;
  const allowedDataTypes = input.showAllData
    ? null
    : DynamicDataLoader
      .getUnitBasedDataTypesFromDataTypes(input.dataTypesToUse, input.userUnitSettings, { includeDerivedTypes: true })
      .concat(input.dataTypesToUse);
  const allowedDataTypeSet = allowedDataTypes ? new Set(allowedDataTypes) : null;

  const shouldRemoveSpeed = DynamicDataLoader
    .getUnitBasedDataTypesFromDataType(DataSpeed.type, input.userUnitSettings)
    .indexOf(DataSpeed.type) === -1;
  const shouldRemoveGradeAdjustedSpeed = DynamicDataLoader
    .getUnitBasedDataTypesFromDataType(DataGradeAdjustedSpeed.type, input.userUnitSettings)
    .indexOf(DataGradeAdjustedSpeed.type) === -1;
  const shouldRemoveDistance = DynamicDataLoader
    .getNonUnitBasedDataTypes(input.showAllData, input.dataTypesToUse)
    .indexOf(DataDistance.type) === -1;

  const whitelistedUnitTypes = DynamicDataLoader.getUnitBasedDataTypesFromDataTypes(
    input.streams.map((stream) => stream.type),
    input.userUnitSettings,
    { includeDerivedTypes }
  );
  const whitelistedUnitTypeSet = new Set(whitelistedUnitTypes);

  const mergedStreams = ActivityUtilities
    .createUnitStreamsFromStreams(
      input.streams,
      input.activityType,
      whitelistedUnitTypes,
      { includeDerivedTypes, includeUnitVariants: true }
    )
    .concat(input.streams);

  const deduplicated = dedupeByType(mergedStreams);

  return deduplicated
    .filter((stream) => {
      if (NEVER_RENDER_STREAM_TYPES.has(stream.type)) {
        return false;
      }

      if (allowedDataTypeSet !== null && !allowedDataTypeSet.has(stream.type)) {
        return false;
      }

      if (ALL_KNOWN_UNIT_VARIANTS.has(stream.type) && !whitelistedUnitTypeSet.has(stream.type)) {
        return false;
      }

      switch (stream.type) {
        case DataDistance.type:
          return !shouldRemoveDistance;
        case DataSpeed.type:
          return !shouldRemoveSpeed;
        case DataGradeAdjustedSpeed.type:
          return !shouldRemoveGradeAdjustedSpeed;
        case DataLatitudeDegrees.type:
        case DataLongitudeDegrees.type:
          return false;
        default:
          return true;
      }
    })
    .sort((left, right) => left.type.localeCompare(right.type));
}

function dedupeByType(streams: StreamInterface[]): StreamInterface[] {
  const streamsByType = new Map<string, StreamInterface>();
  streams.forEach((stream) => {
    if (!streamsByType.has(stream.type)) {
      streamsByType.set(stream.type, stream);
    }
  });
  return [...streamsByType.values()];
}

function buildPreferredDataTypeOrder(
  dataTypesToUse: string[],
  userUnitSettings: UserUnitSettingsInterface
): Map<string, number> {
  const order = new Map<string, number>();
  const canonicalDataTypes = [
    ...DynamicDataLoader.basicDataTypes,
    ...DynamicDataLoader.advancedDataTypes.filter((dataType) => !DynamicDataLoader.basicDataTypes.includes(dataType)),
  ];
  const selectedDataTypeSet = new Set(dataTypesToUse || []);
  const canonicalSelectedDataTypes = canonicalDataTypes
    .filter((dataType) => selectedDataTypeSet.has(dataType))
    .concat(
      [...selectedDataTypeSet]
        .filter((dataType) => !canonicalDataTypes.includes(dataType))
        .sort((left, right) => left.localeCompare(right))
    );
  const orderedSelectedDataTypes = applyEventChartCanonicalOrderOverride(canonicalSelectedDataTypes);
  let index = 0;

  orderedSelectedDataTypes.forEach((dataType) => {
    const resolvedTypes = DynamicDataLoader
      .getUnitBasedDataTypesFromDataTypes([dataType], userUnitSettings, { includeDerivedTypes: true })
      .concat(dataType);

    resolvedTypes.forEach((resolvedType) => {
      if (!resolvedType || order.has(resolvedType)) {
        return;
      }

      order.set(resolvedType, index);
      index += 1;
    });
  });

  return order;
}

function comparePanelsByPreference(
  left: EventChartPanelModel,
  right: EventChartPanelModel,
  preferredDataTypeOrder: Map<string, number>
): number {
  const leftIndex = preferredDataTypeOrder.get(left.dataType);
  const rightIndex = preferredDataTypeOrder.get(right.dataType);

  if (leftIndex !== undefined || rightIndex !== undefined) {
    if (leftIndex === undefined) {
      return 1;
    }
    if (rightIndex === undefined) {
      return -1;
    }
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
  }

  return left.displayName.localeCompare(right.displayName);
}

function toSeriesPoints(
  activity: ActivityInterface,
  stream: StreamInterface,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache
): EventChartPoint[] {
  const streamValues = getStreamNumericValues(stream, activityCache);
  if (!streamValues.length) {
    return [];
  }

  if (xAxisType === XAxisTypes.Distance) {
    const distanceValues = getActivityDistanceValues(activity, activityCache);
    const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
    const length = Math.min(streamValues.length, distanceValues.length, absoluteTimes.length);

    const points: EventChartPoint[] = [];
    for (let index = 0; index < length; index += 1) {
      const y = streamValues[index];
      const x = distanceValues[index];
      const time = absoluteTimes[index];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)) {
        continue;
      }
      points.push({
        x,
        y,
        time
      });
    }
    return points;
  }

  const timeValues = getActivityTimeValues(activity, activityCache);
  const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
  const length = Math.min(streamValues.length, timeValues.length, absoluteTimes.length);
  const points: EventChartPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const y = streamValues[index];
    const seconds = timeValues[index];
    const time = absoluteTimes[index];
    if (!Number.isFinite(y) || !Number.isFinite(seconds)) {
      continue;
    }

    const x = xAxisType === XAxisTypes.Time
      ? time
      : seconds;

    points.push({
      x,
      y,
      time
    });
  }

  return points;
}

function toNumericArray(data: unknown): number[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((value) => {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return Number(value);
    }

    return Number.NaN;
  });
}

function resolveLapAxisValue(
  activity: ActivityInterface,
  lapEndTimeMs: number | undefined,
  xAxisType: XAxisTypes,
  lapDistanceLookup: LapDistanceLookup | null = null
): number {
  if (!Number.isFinite(lapEndTimeMs)) {
    return Number.NaN;
  }

  if (xAxisType === XAxisTypes.Time) {
    return lapEndTimeMs as number;
  }

  if (xAxisType === XAxisTypes.Duration) {
    return ((lapEndTimeMs as number) - activity.startDate.getTime()) / 1000;
  }

  const lookup = lapDistanceLookup ?? createLapDistanceLookup(activity);
  if (!lookup || !lookup.absoluteTimes.length) {
    return Number.NaN;
  }

  const closestIndex = lookup.isMonotonic
    ? findClosestMonotonicIndex(lookup.absoluteTimes, lapEndTimeMs as number)
    : findClosestLinearIndex(lookup.absoluteTimes, lapEndTimeMs as number);

  return lookup.distanceValues[closestIndex];
}

function createActivityNumericCache(activity: ActivityInterface): ActivityNumericCache {
  return {
    startTimeMs: activity.startDate.getTime(),
    streamValuesByType: new Map<string, number[]>(),
    timeValues: null,
    distanceValues: null,
    absoluteTimeValues: null,
  };
}

function getStreamNumericValues(stream: StreamInterface, cache: ActivityNumericCache): number[] {
  const streamType = `${stream?.type || ''}`;
  const cached = cache.streamValuesByType.get(streamType);
  if (cached) {
    return cached;
  }

  const values = toNumericArray(stream?.getData?.());
  cache.streamValuesByType.set(streamType, values);
  return values;
}

function getActivityStreamNumericValues(
  activity: ActivityInterface,
  streamType: string,
  cache: ActivityNumericCache
): number[] {
  const cached = cache.streamValuesByType.get(streamType);
  if (cached) {
    return cached;
  }

  const values = toNumericArray(activity.getStream(streamType)?.getData?.());
  cache.streamValuesByType.set(streamType, values);
  return values;
}

function getActivityTimeValues(activity: ActivityInterface, cache: ActivityNumericCache): number[] {
  if (cache.timeValues) {
    return cache.timeValues;
  }

  cache.timeValues = getActivityStreamNumericValues(activity, XAxisTypes.Time, cache);
  return cache.timeValues;
}

function getActivityDistanceValues(activity: ActivityInterface, cache: ActivityNumericCache): number[] {
  if (cache.distanceValues) {
    return cache.distanceValues;
  }

  const primaryDistance = getActivityStreamNumericValues(activity, DataDistance.type, cache);
  cache.distanceValues = primaryDistance.length > 0
    ? primaryDistance
    : getActivityStreamNumericValues(activity, DataStrydDistance.type, cache);
  return cache.distanceValues;
}

function getActivityAbsoluteTimes(activity: ActivityInterface, cache: ActivityNumericCache): number[] {
  if (cache.absoluteTimeValues) {
    return cache.absoluteTimeValues;
  }

  const startTimeMs = Number.isFinite(cache.startTimeMs) ? cache.startTimeMs : activity.startDate.getTime();
  const timeValues = getActivityTimeValues(activity, cache);
  const absoluteTimes = new Array<number>(timeValues.length);
  for (let index = 0; index < timeValues.length; index += 1) {
    const seconds = timeValues[index];
    absoluteTimes[index] = Number.isFinite(seconds)
      ? startTimeMs + (seconds * 1000)
      : Number.NaN;
  }

  cache.absoluteTimeValues = absoluteTimes;
  return cache.absoluteTimeValues;
}

function createLapDistanceLookup(
  activity: ActivityInterface,
  activityCache: ActivityNumericCache = createActivityNumericCache(activity)
): LapDistanceLookup | null {
  const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
  const distanceValues = getActivityDistanceValues(activity, activityCache);
  const length = Math.min(absoluteTimes.length, distanceValues.length);
  if (!length) {
    return null;
  }

  const filteredTimes: number[] = [];
  const filteredDistances: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const time = absoluteTimes[index];
    const distance = distanceValues[index];
    if (!Number.isFinite(time) || !Number.isFinite(distance)) {
      continue;
    }

    filteredTimes.push(time);
    filteredDistances.push(distance);
  }

  if (!filteredTimes.length) {
    return null;
  }

  return {
    absoluteTimes: filteredTimes,
    distanceValues: filteredDistances,
    isMonotonic: isMonotonicAscending(filteredTimes),
  };
}

function isMonotonicAscending(values: number[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) {
      return false;
    }
  }
  return true;
}

function findClosestMonotonicIndex(values: number[], target: number): number {
  if (values.length <= 1) {
    return 0;
  }

  if (target <= values[0]) {
    return 0;
  }

  const lastIndex = values.length - 1;
  if (target >= values[lastIndex]) {
    return lastIndex;
  }

  let low = 0;
  let high = lastIndex;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = values[mid];
    if (current === target) {
      return mid;
    }
    if (current < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const upper = Math.min(lastIndex, low);
  const lower = Math.max(0, upper - 1);
  return Math.abs(values[upper] - target) < Math.abs(values[lower] - target)
    ? upper
    : lower;
}

function findClosestLinearIndex(values: number[], target: number): number {
  if (!values.length) {
    return 0;
  }

  let closestIndex = 0;
  let smallestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const delta = Math.abs(target - values[index]);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closestIndex = index;
    }
  }

  return closestIndex;
}

function enrichPanelDomain(panel: EventChartPanelModel): EventChartPanelModel {
  const allPoints = panel.series.flatMap((series) => series.points);
  if (!allPoints.length) {
    return {
      ...panel,
      ...EMPTY_PANEL_DOMAIN,
    };
  }

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
    return {
      ...panel,
      minX,
      maxX: minX + 1,
    };
  }

  return {
    ...panel,
    minX,
    maxX,
  };
}
