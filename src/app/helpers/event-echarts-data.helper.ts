import {
  ActivityInterface,
  ActivityUtilities,
  DataAscent,
  DataCadenceAvg,
  DataDistance,
  DataDuration,
  DataHeartRateAvg,
  DataInterface,
  DataGradeAdjustedSpeed,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataPaceAvg,
  DataPowerAvg,
  DataSpeedAvg,
  DataDescent,
  DataSpeed,
  DataStrydDistance,
  DynamicDataLoader,
  LapTypes,
  LapInterface,
  StreamInterface,
  UserUnitSettingsInterface,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../services/color/app.event.color.service';
import { isEventLapTypeAllowed, normalizeEventLapType } from './event-lap-type.helper';
import { applyEventChartCanonicalOrderOverride } from './event-chart-order.helper';
import {
  isEventPaceStreamType,
  resolveEventColorGroupKey,
  resolveEventSeriesColor
} from './event-echarts-style.helper';
import { EventChartRange, normalizeEventRange } from './event-echarts-xaxis.helper';
import { normalizeUnitDerivedTypeLabel } from './stat-label.helper';

export { normalizeEventLapType } from './event-lap-type.helper';

export interface EventChartPoint {
  x: number;
  y: number | null;
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
  lapNumber: number;
  activityID: string;
  activityName: string;
  tooltipTitle: string;
  tooltipDetails: Array<{
    label: string;
    value: string;
  }>;
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

const EMPTY_PANEL_DOMAIN = { minX: 0, maxX: 1 };
const EVENT_ZOOM_OVERVIEW_BUCKET_COUNT = 96;
const EVENT_ZOOM_OVERVIEW_MAX_SAMPLES_PER_SERIES = 720;
const PACE_MIN_MOVING_SPEED_MPS = 0.5;
const PACE_MAX_DISPLAY_SECONDS = 1800;
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

export function hasEventChartableData(
  activities: ActivityInterface[],
  xAxisType: XAxisTypes
): boolean {
  const safeActivities = Array.isArray(activities) ? activities : [];
  return safeActivities.some((activity) => canActivityRenderEventChart(activity, xAxisType));
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

export function buildEventZoomOverviewData(
  panels: EventChartPanelModel[],
  domain: EventChartRange | null | undefined,
  bucketCount = EVENT_ZOOM_OVERVIEW_BUCKET_COUNT
): Array<[number, number]> {
  const normalizedDomain = normalizeEventRange(domain);
  const safeBucketCount = Number.isFinite(bucketCount) ? Math.max(2, Math.round(bucketCount)) : EVENT_ZOOM_OVERVIEW_BUCKET_COUNT;

  if (!normalizedDomain) {
    return [];
  }

  const span = normalizedDomain.end - normalizedDomain.start;
  if (!Number.isFinite(span) || span <= 0) {
    return [
      [normalizedDomain.start, 0],
      [normalizedDomain.end, 0],
    ];
  }

  const buckets = new Array<number>(safeBucketCount).fill(0);
  let maxBucketValue = 0;

  for (let panelIndex = 0; panelIndex < panels.length; panelIndex += 1) {
    const panel = panels[panelIndex];
    for (let seriesIndex = 0; seriesIndex < panel.series.length; seriesIndex += 1) {
      const points = panel.series[seriesIndex]?.points || [];
      if (!points.length) {
        continue;
      }

      const stride = Math.max(1, Math.ceil(points.length / EVENT_ZOOM_OVERVIEW_MAX_SAMPLES_PER_SERIES));
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += stride) {
        const point = points[pointIndex];
        const xValue = Number(point?.x);
        if (!Number.isFinite(xValue) || xValue < normalizedDomain.start || xValue > normalizedDomain.end) {
          continue;
        }

        const ratio = span === 0 ? 0 : (xValue - normalizedDomain.start) / span;
        const bucketIndex = Math.min(
          safeBucketCount - 1,
          Math.max(0, Math.floor(ratio * (safeBucketCount - 1)))
        );
        buckets[bucketIndex] += 1;
        if (buckets[bucketIndex] > maxBucketValue) {
          maxBucketValue = buckets[bucketIndex];
        }
      }
    }
  }

  if (maxBucketValue <= 0) {
    return [
      [normalizedDomain.start, 0],
      [normalizedDomain.end, 0],
    ];
  }

  return buckets.map((count, index) => {
    const xValue = normalizedDomain.start + ((span * index) / (safeBucketCount - 1));
    const normalizedCount = Math.sqrt(count / maxBucketValue);
    return [xValue, normalizedCount] as [number, number];
  });
}

export function buildEventLapMarkers(input: {
  selectedActivities: ActivityInterface[];
  allActivities: ActivityInterface[];
  xAxisType: XAxisTypes;
  lapTypes: LapTypes[];
  eventColorService: AppEventColorService;
}): EventChartLapMarker[] {
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
      if (!isEventLapTypeAllowed(normalizedLapType, input.lapTypes || [])) {
        return;
      }

      const xValue = resolveLapAxisValue(activity, lap, input.xAxisType, activityCache, lapDistanceLookup);
      if (!Number.isFinite(xValue)) {
        return;
      }

      markers.push({
        xValue,
        label: `Lap ${index + 1}`,
        color: input.eventColorService.getActivityColor(input.allActivities, activity),
        lapType: normalizedLapType,
        lapNumber: index + 1,
        activityID: activity.getID() || '',
        activityName: activity.creator?.name || 'Activity',
        tooltipTitle: `Lap ${index + 1}`,
        tooltipDetails: buildLapTooltipDetails(lap),
      });
    });
  });

  return markers.sort((left, right) => left.xValue - right.xValue);
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

function canActivityRenderEventChart(activity: ActivityInterface, xAxisType: XAxisTypes): boolean {
  const streams = activity?.getAllStreams?.() || [];
  if (!streams.length) {
    return false;
  }

  if (!hasFiniteStreamData(activity?.getStream?.(XAxisTypes.Time) || streams.find((stream) => stream?.type === XAxisTypes.Time))) {
    return false;
  }

  if (
    xAxisType === XAxisTypes.Distance
    && !hasFiniteStreamData(
      activity?.getStream?.(DataDistance.type)
      || activity?.getStream?.(DataStrydDistance.type)
      || streams.find((stream) => stream?.type === DataDistance.type || stream?.type === DataStrydDistance.type)
    )
  ) {
    return false;
  }

  return streams.some((stream) => isEventChartableRawStream(stream) && hasFiniteStreamData(stream));
}

function isEventChartableRawStream(stream: StreamInterface | undefined | null): boolean {
  const streamType = `${stream?.type || ''}`;
  if (!streamType || NEVER_RENDER_STREAM_TYPES.has(streamType)) {
    return false;
  }

  switch (streamType) {
    case DataLatitudeDegrees.type:
    case DataLongitudeDegrees.type:
      return false;
    default:
      return true;
  }
}

function hasFiniteStreamData(stream: StreamInterface | undefined | null): boolean {
  if (!stream?.getData) {
    return false;
  }

  const values = toNumericArray(stream.getData());
  for (let index = 0; index < values.length; index += 1) {
    if (Number.isFinite(values[index])) {
      return true;
    }
  }

  return false;
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

  const shouldTreatAsPace = isEventPaceStreamType(stream.type);
  const speedValues = shouldTreatAsPace
    ? getActivityStreamNumericValues(activity, DataSpeed.type, activityCache)
    : null;

  if (xAxisType === XAxisTypes.Distance) {
    const distanceValues = getActivityDistanceValues(activity, activityCache);
    const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
    const length = Math.min(streamValues.length, distanceValues.length, absoluteTimes.length);

    const points: EventChartPoint[] = [];
    for (let index = 0; index < length; index += 1) {
      const y = shouldTreatAsPace
        ? getRenderablePaceValue(streamValues[index], speedValues, index)
        : streamValues[index];
      const x = distanceValues[index];
      const time = absoluteTimes[index];
      if (!Number.isFinite(x) || !Number.isFinite(time)) {
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
    const y = shouldTreatAsPace
      ? getRenderablePaceValue(streamValues[index], speedValues, index)
      : streamValues[index];
    const seconds = timeValues[index];
    const time = absoluteTimes[index];
    if (!Number.isFinite(seconds)) {
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

function getRenderablePaceValue(
  rawPaceValue: number,
  speedValues: number[] | null,
  index: number
): number | null {
  if (!Number.isFinite(rawPaceValue) || rawPaceValue <= 0 || rawPaceValue > PACE_MAX_DISPLAY_SECONDS) {
    return null;
  }

  if (Array.isArray(speedValues) && index < speedValues.length) {
    const speedValue = speedValues[index];
    if (!Number.isFinite(speedValue) || speedValue <= PACE_MIN_MOVING_SPEED_MPS) {
      return null;
    }
  }

  return rawPaceValue;
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
  lap: LapInterface,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache,
  lapDistanceLookup: LapDistanceLookup | null = null
): number {
  const lapEndIndex = resolveLapEndIndex(activity, lap);
  if (lapEndIndex !== null) {
    const indexedAxisValue = resolveLapAxisValueFromIndex(activity, lapEndIndex, xAxisType, activityCache);
    if (Number.isFinite(indexedAxisValue)) {
      return indexedAxisValue;
    }
  }

  const lapEndTimeMs = lap.endDate?.getTime();
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

function resolveLapEndIndex(activity: ActivityInterface, lap: LapInterface): number | null {
  if (typeof lap.getEndIndex !== 'function') {
    return null;
  }

  const index = lap.getEndIndex(activity);
  if (!Number.isFinite(index)) {
    return null;
  }

  return Math.max(0, Math.trunc(index));
}

function resolveLapAxisValueFromIndex(
  activity: ActivityInterface,
  lapEndIndex: number,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache
): number {
  if (xAxisType === XAxisTypes.Time) {
    return getFiniteValueNearIndex(getActivityAbsoluteTimes(activity, activityCache), lapEndIndex);
  }

  if (xAxisType === XAxisTypes.Duration) {
    return getFiniteValueNearIndex(getActivityTimeValues(activity, activityCache), lapEndIndex);
  }

  return getFiniteValueNearIndex(getActivityDistanceValues(activity, activityCache), lapEndIndex);
}

function getFiniteValueNearIndex(values: number[], index: number): number {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(index)) {
    return Number.NaN;
  }

  const clampedIndex = Math.min(values.length - 1, Math.max(0, Math.trunc(index)));
  const directValue = values[clampedIndex];
  if (Number.isFinite(directValue)) {
    return directValue;
  }

  for (let offset = 1; offset < values.length; offset += 1) {
    const backwardIndex = clampedIndex - offset;
    if (backwardIndex >= 0 && Number.isFinite(values[backwardIndex])) {
      return values[backwardIndex];
    }

    const forwardIndex = clampedIndex + offset;
    if (forwardIndex < values.length && Number.isFinite(values[forwardIndex])) {
      return values[forwardIndex];
    }
  }

  return Number.NaN;
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

function buildLapTooltipDetails(lap: LapInterface): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = [];

  const duration = lap.getDuration?.();
  const durationValue = formatLapDataValue(duration, { compactDuration: true });
  if (durationValue) {
    details.push({ label: 'Duration', value: durationValue });
  }

  const distanceValue = formatLapDataValue(lap.getDistance?.());
  if (distanceValue) {
    details.push({ label: 'Distance', value: distanceValue });
  }

  const averagePaceOrSpeed = lap.getStat(DataPaceAvg.type) || lap.getStat(DataSpeedAvg.type);
  const averagePaceOrSpeedLabel = averagePaceOrSpeed && averagePaceOrSpeed.getType() === DataPaceAvg.type
    ? 'Avg Pace'
    : 'Avg Speed';
  const averagePaceOrSpeedValue = formatLapDataValue(averagePaceOrSpeed);
  if (averagePaceOrSpeedValue) {
    details.push({ label: averagePaceOrSpeedLabel, value: averagePaceOrSpeedValue });
  }

  appendLapDetail(details, 'Avg Heart Rate', lap.getStat(DataHeartRateAvg.type));
  appendLapDetail(details, 'Avg Power', lap.getStat(DataPowerAvg.type));
  appendLapDetail(details, 'Ascent', lap.getStat(DataAscent.type));
  appendLapDetail(details, 'Descent', lap.getStat(DataDescent.type));
  appendLapDetail(details, 'Avg Cadence', lap.getStat(DataCadenceAvg.type));

  return details;
}

function appendLapDetail(
  details: Array<{ label: string; value: string }>,
  label: string,
  data: DataInterface | void
): void {
  const value = formatLapDataValue(data);
  if (!value) {
    return;
  }

  details.push({ label, value });
}

function formatLapDataValue(
  data: DataInterface | void,
  options?: { compactDuration?: boolean }
): string {
  if (!data) {
    return '';
  }

  const rawValue = data.getValue?.();
  if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
    return '';
  }

  if (data.getType?.() === DataDuration.type) {
    const duration = data as DataDuration;
    return `${duration.getDisplayValue(false, true, false, options?.compactDuration === true)}`.trim();
  }

  const displayValue = `${data.getDisplayValue?.() ?? ''}`.trim();
  if (!displayValue) {
    return '';
  }

  return `${displayValue}${data.getDisplayUnit?.() ?? ''}`.trim();
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
