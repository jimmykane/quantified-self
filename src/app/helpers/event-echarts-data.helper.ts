import {
  ActivityInterface,
  ActivityUtilities,
  convertSpeedToSwimPace,
  DataAltitude,
  DataAscent,
  DataCadenceAvg,
  DataDistance,
  DataDuration,
  DataGPSAltitude,
  DataGrade,
  DataHeartRate,
  DataHeartRateAvg,
  DataInterface,
  DataGradeAdjustedSpeed,
  DataGradeAdjustedPace,
  DataGradeSmooth,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataPaceAvg,
  DataPace,
  DataPower,
  DataPowerAvg,
  DataPoolLength,
  DataSpeedAvg,
  DataDescent,
  DataSpeed,
  DataStrydDistance,
  DataStrydAltitude,
  DataSwimPace,
  DynamicDataLoader,
  LapTypes,
  LapInterface,
  StreamInterface,
  UserUnitSettingsInterface,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import type { AppEventColorService } from '../services/color/app.event.color.service';
import { isEventLapTypeAllowed, normalizeEventLapType } from './event-lap-type.helper';
import { applyEventChartCanonicalOrderOverride } from './event-chart-order.helper';
import {
  isEventPaceStreamType,
  resolveEventColorGroupKey,
  resolveEventSeriesColor
} from './event-echarts-style.helper';
import { EventChartRange, normalizeEventRange } from './event-chart-range.helper';
import { normalizeUnitDerivedTypeLabel } from './stat-label.helper';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { AppSwimLength, getActivitySwimLengths } from './event-swim-length.helper';
import { getAppCanonicalChartDataTypes } from './app-chart-data-types.helper';
import type {
  TrackChartPanelModel,
  TrackChartPanelSeries,
  TrackChartPoint,
  TrackChartZoneColorPiece,
} from './track-chart-panel.model';

export { normalizeEventLapType } from './event-lap-type.helper';

export type EventChartPoint = TrackChartPoint;
export type EventChartZoneColorPiece = TrackChartZoneColorPiece;
export type EventChartPanelSeries = TrackChartPanelSeries;
export type EventChartPanelModel = TrackChartPanelModel;

export interface EventLegendItem {
  activityID: string;
  label: string;
  color: string;
}

export type EventChartMarkerType = 'lap' | 'swimLength';

export interface EventChartMarkerTooltipDetail {
  label: string;
  value: string;
}

export interface EventChartMarkerBase {
  markerType: EventChartMarkerType;
  xValue: number;
  label: string;
  color: string;
  activityID: string;
  activityName: string;
  tooltipTitle: string;
  tooltipDetails: EventChartMarkerTooltipDetail[];
}

export interface EventChartLapMarker extends EventChartMarkerBase {
  markerType: 'lap';
  lapType: string;
  lapNumber: number;
}

export interface EventChartSwimLengthMarker extends EventChartMarkerBase {
  markerType: 'swimLength';
  swimLengthIndex: number;
  swimLengthType: string;
  isIdle: boolean;
}

export type EventChartTimelineMarker = EventChartLapMarker | EventChartSwimLengthMarker;

export interface BuildEventChartPanelsInput {
  selectedActivities: ActivityInterface[];
  allActivities: ActivityInterface[];
  xAxisType: XAxisTypes;
  showAllData: boolean;
  dataTypesToUse: string[];
  userUnitSettings: UserUnitSettingsInterface;
  eventColorService: AppEventColorService;
  colorIntensityZoneLines?: boolean;
}

export interface EventChartStreamSnapshot {
  type: string;
  values: Float64Array;
}

export interface EventChartIntensityZoneSnapshot {
  type?: string;
  [key: string]: unknown;
}

export interface EventChartActivitySnapshot {
  id: string;
  activityName: string;
  activityType: unknown;
  startTimeMs: number;
  intensityZones: EventChartIntensityZoneSnapshot[];
  streams: EventChartStreamSnapshot[];
}

export interface EventChartPanelBuildSnapshotInput {
  selectedActivities: EventChartActivitySnapshot[];
  xAxisType: XAxisTypes;
  showAllData: boolean;
  dataTypesToUse: string[];
  userUnitSettings: UserUnitSettingsInterface;
  colorIntensityZoneLines?: boolean;
  zoneColors: Record<string, string>;
}

export interface EventChartPanelWorkerRequest {
  requestID: number;
  input: EventChartPanelBuildSnapshotInput;
}

export interface EventChartPanelWorkerSuccessResponse {
  requestID: number;
  panels: EventChartPanelModel[];
}

export interface EventChartPanelWorkerErrorResponse {
  requestID: number;
  error: string;
}

export type EventChartPanelWorkerResponse = EventChartPanelWorkerSuccessResponse | EventChartPanelWorkerErrorResponse;

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
export const EVENT_CHART_INTENSITY_ZONE_LINE_DATA_TYPES = [
  DataHeartRate.type,
  DataPower.type,
] as const;
export const EVENT_CHART_INTENSITY_ZONE_LOWER_LIMIT_KEYS = [
  'zone2LowerLimit',
  'zone3LowerLimit',
  'zone4LowerLimit',
  'zone5LowerLimit',
  'zone6LowerLimit',
  'zone7LowerLimit',
] as const;
const EVENT_CHART_INTENSITY_ZONE_LINE_DATA_TYPE_SET = new Set<string>(EVENT_CHART_INTENSITY_ZONE_LINE_DATA_TYPES);
export const EVENT_CHART_ALTITUDE_GRADE_COLOR_STREAM_TYPES = [
  DataGradeSmooth.type,
  DataGrade.type,
] as const;
const EVENT_CHART_ALTITUDE_STREAM_TYPE_SET = new Set<string>([
  DataAltitude.type,
  DataGPSAltitude.type,
  DataStrydAltitude.type,
]);
const MIN_INTENSITY_ZONE_LOWER_LIMIT_COUNT = 2;

type ActivityIntensityZone = ActivityInterface['intensityZones'][number];
export type EventChartNumericValues = number[] | Float64Array;

interface ActivityNumericCache {
  startTimeMs: number;
  streamByType: Map<string, StreamInterface>;
  streamValuesByType: Map<string, EventChartNumericValues>;
  timeValues: EventChartNumericValues | null;
  distanceValues: EventChartNumericValues | null;
  absoluteTimeValues: EventChartNumericValues | null;
}

interface LapDistanceLookup {
  absoluteTimes: number[];
  distanceValues: number[];
  isMonotonic: boolean;
}

interface EventChartSeriesPointResult {
  lineValues: Float64Array;
  timeValues: Float64Array;
  pointCount: number;
  minX: number;
  maxX: number;
}

interface BuildEventChartPanelsCoreInput {
  selectedActivities: ActivityInterface[];
  xAxisType: XAxisTypes;
  showAllData: boolean;
  dataTypesToUse: string[];
  userUnitSettings: UserUnitSettingsInterface;
  colorIntensityZoneLines?: boolean;
  zoneColors: Record<string, string>;
}

export function buildEventChartPanels(input: BuildEventChartPanelsInput): EventChartPanelModel[] {
  return buildEventChartPanelsFromActivities({
    selectedActivities: Array.isArray(input.selectedActivities) ? input.selectedActivities : [],
    xAxisType: input.xAxisType,
    showAllData: input.showAllData,
    dataTypesToUse: input.dataTypesToUse,
    userUnitSettings: input.userUnitSettings,
    colorIntensityZoneLines: input.colorIntensityZoneLines,
    zoneColors: input.colorIntensityZoneLines === true
      ? buildEventChartZoneColorMap(input.eventColorService)
      : {},
  });
}

export function createEventChartPanelBuildSnapshot(input: BuildEventChartPanelsInput): EventChartPanelBuildSnapshotInput {
  const selectedActivities = Array.isArray(input.selectedActivities) ? input.selectedActivities : [];
  return {
    selectedActivities: selectedActivities.map((activity) => snapshotEventChartActivity(activity, input)),
    xAxisType: input.xAxisType,
    showAllData: input.showAllData,
    dataTypesToUse: input.dataTypesToUse,
    userUnitSettings: input.userUnitSettings,
    colorIntensityZoneLines: input.colorIntensityZoneLines,
    zoneColors: input.colorIntensityZoneLines === true
      ? buildEventChartZoneColorMap(input.eventColorService)
      : {},
  };
}

export function buildEventChartPanelsFromSnapshot(input: EventChartPanelBuildSnapshotInput): EventChartPanelModel[] {
  return buildEventChartPanelsFromActivities({
    selectedActivities: Array.isArray(input.selectedActivities)
      ? input.selectedActivities.map((activitySnapshot) => createSnapshotActivity(activitySnapshot))
      : [],
    xAxisType: input.xAxisType,
    showAllData: input.showAllData,
    dataTypesToUse: input.dataTypesToUse,
    userUnitSettings: input.userUnitSettings,
    colorIntensityZoneLines: input.colorIntensityZoneLines,
    zoneColors: input.zoneColors || {},
  });
}

function buildEventChartPanelsFromActivities(input: BuildEventChartPanelsCoreInput): EventChartPanelModel[] {
  const selectedActivities = Array.isArray(input.selectedActivities) ? input.selectedActivities : [];
  if (!selectedActivities.length) {
    return [];
  }

  const panelsMap = new Map<string, EventChartPanelModel>();
  const preferredDataTypeOrder = buildPreferredDataTypeOrder(input.dataTypesToUse, input.userUnitSettings);

  selectedActivities.forEach((activity) => {
    const streams = activity.getAllStreams() || [];
    const activityCache = createActivityNumericCache(activity, streams);
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
      const pointResult = toSeriesPoints(activity, stream, input.xAxisType, activityCache);
      if (!pointResult.pointCount) {
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
          minX: pointResult.minX,
          maxX: pointResult.maxX,
        });
      }

      const panel = panelsMap.get(stream.type) as EventChartPanelModel;
      panel.minX = Math.min(panel.minX, pointResult.minX);
      panel.maxX = Math.max(panel.maxX, pointResult.maxX);
      const activityID = activity.getID() || '';
      const zoneColorPieces = input.colorIntensityZoneLines === true
        ? buildIntensityZoneColorPieces(activity, stream.type, input.zoneColors)
        : [];
      const gradeColorData = buildAltitudeGradeColorData(activity, stream, input.xAxisType, activityCache);
      panel.series.push({
        id: `${activityID}::${stream.type}`,
        activityID,
        activityName: activity.creator?.name || 'Activity',
        color: resolveEventSeriesColor(panel.colorGroupKey, panel.series.length, 1),
        streamType: stream.type,
        displayName,
        unit,
        lineValues: pointResult.lineValues,
        timeValues: pointResult.timeValues,
        pointCount: pointResult.pointCount,
        ...(gradeColorData ? {
          gradeColorValues: gradeColorData.values,
          gradeColorSourceType: gradeColorData.sourceType,
        } : {}),
        ...(zoneColorPieces.length > 0 ? { zoneColorPieces } : {}),
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

function buildEventChartZoneColorMap(eventColorService: Pick<AppEventColorService, 'getColorForZoneHex'>): Record<string, string> {
  const colors: Record<string, string> = {};
  if (typeof eventColorService?.getColorForZoneHex !== 'function') {
    return colors;
  }

  for (let zoneNumber = 1; zoneNumber <= 7; zoneNumber += 1) {
    const zone = `Zone ${zoneNumber}`;
    colors[zone] = eventColorService.getColorForZoneHex(zone);
  }
  return colors;
}

function snapshotEventChartActivity(
  activity: ActivityInterface,
  input: Pick<BuildEventChartPanelsInput, 'showAllData' | 'dataTypesToUse' | 'userUnitSettings' | 'xAxisType'>
): EventChartActivitySnapshot {
  const streams: EventChartStreamSnapshot[] = [];
  const streamTypes = new Set<string>();
  const selectedStreamTypes = input.showAllData
    ? null
    : buildEventChartSnapshotStreamTypeSet(input);
  const appendStream = (stream: StreamInterface | null | undefined, preserveDuplicateType: boolean) => {
    const streamType = `${stream?.type || ''}`;
    if (!streamType || (!preserveDuplicateType && streamTypes.has(streamType))) {
      return;
    }
    streamTypes.add(streamType);
    streams.push({
      type: streamType,
      values: toFloat64NumericArray(stream?.getData?.()),
    });
  };

  const allStreams = activity.getAllStreams?.() || [];
  allStreams.forEach((stream) => {
    if (selectedStreamTypes === null || selectedStreamTypes.has(stream?.type || '')) {
      appendStream(stream, true);
    }
  });

  const supplementalStreamTypes = selectedStreamTypes === null
    ? [XAxisTypes.Time, DataDistance.type, DataStrydDistance.type, DataSpeed.type]
    : [...selectedStreamTypes];
  supplementalStreamTypes.forEach((streamType) => {
    appendStream(getActivityStreamByType(activity, streamType, allStreams), false);
  });

  return {
    id: activity.getID?.() || '',
    activityName: activity.creator?.name || 'Activity',
    activityType: activity.type,
    startTimeMs: activity.startDate?.getTime?.() ?? Number.NaN,
    intensityZones: (activity.intensityZones || []).map((zone) => ({ ...(zone as unknown as Record<string, unknown>) })),
    streams,
  };
}

function buildEventChartSnapshotStreamTypeSet(
  input: Pick<BuildEventChartPanelsInput, 'dataTypesToUse' | 'userUnitSettings' | 'xAxisType'>
): Set<string> {
  const streamTypes = new Set<string>();
  const appendExpandedType = (streamType: string | null | undefined) => {
    const normalizedType = `${streamType || ''}`;
    if (!normalizedType) {
      return;
    }

    streamTypes.add(normalizedType);
    const unitBaseTypes = getUnitBaseDataTypes(normalizedType);
    unitBaseTypes.forEach((baseType) => {
      streamTypes.add(baseType);
      getDerivedStreamDependencyTypes(baseType).forEach((dependencyType) => streamTypes.add(dependencyType));
    });
    getDerivedStreamDependencyTypes(normalizedType).forEach((dependencyType) => streamTypes.add(dependencyType));

    if (isEventPaceStreamType(normalizedType)) {
      streamTypes.add(DataSpeed.type);
    }
  };

  streamTypes.add(XAxisTypes.Time);
  if (input.xAxisType === XAxisTypes.Distance) {
    streamTypes.add(DataDistance.type);
    streamTypes.add(DataStrydDistance.type);
  }

  const selectedDataTypes = Array.isArray(input.dataTypesToUse) ? input.dataTypesToUse : [];
  selectedDataTypes.forEach((streamType) => appendExpandedType(streamType));
  DynamicDataLoader
    .getUnitBasedDataTypesFromDataTypes(selectedDataTypes, input.userUnitSettings, { includeDerivedTypes: true })
    .forEach((streamType) => appendExpandedType(streamType));

  return streamTypes;
}

function getUnitBaseDataTypes(dataType: string): string[] {
  const unitGroups = (DynamicDataLoader as unknown as {
    dataTypeUnitGroups?: Record<string, Record<string, unknown>>;
  }).dataTypeUnitGroups || {};
  const baseTypes = Object.entries(unitGroups)
    .filter(([baseType, unitGroup]) => baseType === dataType || Object.prototype.hasOwnProperty.call(unitGroup, dataType))
    .map(([baseType]) => baseType);
  return baseTypes.length > 0 ? baseTypes : [dataType];
}

function getDerivedStreamDependencyTypes(dataType: string): string[] {
  if (EVENT_CHART_ALTITUDE_STREAM_TYPE_SET.has(dataType)) {
    return [...EVENT_CHART_ALTITUDE_GRADE_COLOR_STREAM_TYPES];
  }

  switch (dataType) {
    case DataPace.type:
    case DataSwimPace.type:
      return [DataSpeed.type];
    case DataGradeAdjustedPace.type:
      return [DataGradeAdjustedSpeed.type, DataSpeed.type];
    default:
      return [];
  }
}

function createSnapshotActivity(snapshot: EventChartActivitySnapshot): ActivityInterface {
  const streams = (snapshot.streams || []).map((stream) => createSnapshotStream(stream));
  const streamsByType = new Map(streams.map((stream) => [stream.type, stream]));
  return {
    type: snapshot.activityType,
    startDate: new Date(snapshot.startTimeMs),
    creator: { name: snapshot.activityName },
    intensityZones: snapshot.intensityZones || [],
    getID: () => snapshot.id,
    getAllStreams: () => streams,
    getStream: (streamType: string) => streamsByType.get(streamType) || null,
  } as unknown as ActivityInterface;
}

function createSnapshotStream(snapshot: EventChartStreamSnapshot): StreamInterface {
  const values = toNullableNumberArray(snapshot.values);
  return {
    type: snapshot.type,
    getData: () => values,
  } as unknown as StreamInterface;
}

function buildIntensityZoneColorPieces(
  activity: ActivityInterface,
  streamType: string,
  zoneColors: Record<string, string>
): EventChartZoneColorPiece[] {
  if (!EVENT_CHART_INTENSITY_ZONE_LINE_DATA_TYPE_SET.has(streamType)) {
    return [];
  }

  const intensityZones = activity.intensityZones
    ?.find((zone) => zone?.type === streamType);
  if (!intensityZones) {
    return [];
  }

  const lowerLimits = readIntensityZoneLowerLimits(intensityZones);
  if (!lowerLimits.length) {
    return [];
  }

  const pieces: EventChartZoneColorPiece[] = [
    {
      zone: 'Zone 1',
      color: zoneColors['Zone 1'] || '',
      lt: lowerLimits[0],
    },
  ];

  for (let index = 0; index < lowerLimits.length; index += 1) {
    const zoneNumber = index + 2;
    const nextLowerLimit = lowerLimits[index + 1];
    pieces.push({
      zone: `Zone ${zoneNumber}`,
      color: zoneColors[`Zone ${zoneNumber}`] || '',
      gte: lowerLimits[index],
      ...(Number.isFinite(nextLowerLimit) ? { lt: nextLowerLimit } : {}),
    });
  }

  return pieces;
}

function buildAltitudeGradeColorData(
  activity: ActivityInterface,
  targetStream: StreamInterface,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache
): { values: Float64Array; sourceType: string } | null {
  if (!EVENT_CHART_ALTITUDE_STREAM_TYPE_SET.has(targetStream.type)) {
    return null;
  }

  for (const sourceType of EVENT_CHART_ALTITUDE_GRADE_COLOR_STREAM_TYPES) {
    const values = buildAlignedGradeColorValues(activity, targetStream, sourceType, xAxisType, activityCache);
    if (values) {
      return { values, sourceType };
    }
  }

  return null;
}

function buildAlignedGradeColorValues(
  activity: ActivityInterface,
  targetStream: StreamInterface,
  sourceType: string,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache
): Float64Array | null {
  const targetValues = getStreamNumericValues(targetStream, activityCache);
  const sourceValues = getActivityStreamNumericValues(activity, sourceType, activityCache);
  if (!targetValues.length || !sourceValues.length) {
    return null;
  }

  if (xAxisType === XAxisTypes.Distance) {
    return buildDistanceAlignedGradeColorValues(activity, targetValues, sourceValues, activityCache);
  }

  return buildTimeAlignedGradeColorValues(activity, targetValues, sourceValues, xAxisType, activityCache);
}

function buildDistanceAlignedGradeColorValues(
  activity: ActivityInterface,
  targetValues: EventChartNumericValues,
  sourceValues: EventChartNumericValues,
  activityCache: ActivityNumericCache
): Float64Array | null {
  const distanceValues = getActivityDistanceValues(activity, activityCache);
  const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
  const length = Math.min(targetValues.length, distanceValues.length, absoluteTimes.length);
  const gradeValues = new Float64Array(length);
  let pointCount = 0;
  let finiteSourceCount = 0;

  for (let index = 0; index < length; index += 1) {
    const x = distanceValues[index];
    const time = absoluteTimes[index];
    if (!Number.isFinite(x) || !Number.isFinite(time)) {
      continue;
    }

    const sourceValue = sourceValues[index];
    gradeValues[pointCount] = Number.isFinite(sourceValue) ? sourceValue : Number.NaN;
    if (Number.isFinite(sourceValue)) {
      finiteSourceCount += 1;
    }
    pointCount += 1;
  }

  return pointCount > 0 && finiteSourceCount > 0 ? gradeValues.slice(0, pointCount) : null;
}

function buildTimeAlignedGradeColorValues(
  activity: ActivityInterface,
  targetValues: EventChartNumericValues,
  sourceValues: EventChartNumericValues,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache
): Float64Array | null {
  const timeValues = getActivityTimeValues(activity, activityCache);
  const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
  const length = Math.min(targetValues.length, timeValues.length, absoluteTimes.length);
  const gradeValues = new Float64Array(length);
  let pointCount = 0;
  let finiteSourceCount = 0;

  for (let index = 0; index < length; index += 1) {
    const seconds = timeValues[index];
    const absoluteTime = absoluteTimes[index];
    if (!Number.isFinite(seconds)) {
      continue;
    }

    const x = xAxisType === XAxisTypes.Time ? absoluteTime : seconds;
    if (!Number.isFinite(x)) {
      continue;
    }

    const sourceValue = sourceValues[index];
    gradeValues[pointCount] = Number.isFinite(sourceValue) ? sourceValue : Number.NaN;
    if (Number.isFinite(sourceValue)) {
      finiteSourceCount += 1;
    }
    pointCount += 1;
  }

  return pointCount > 0 && finiteSourceCount > 0 ? gradeValues.slice(0, pointCount) : null;
}

export function collectEventChartPanelBuildSnapshotTransferables(
  input: EventChartPanelBuildSnapshotInput
): Transferable[] {
  const transferables: Transferable[] = [];

  (input.selectedActivities || []).forEach((activity) => {
    (activity.streams || []).forEach((stream) => {
      appendFloat64ArrayTransferable(transferables, stream.values);
    });
  });

  return transferables;
}

export function collectEventChartPanelTransferables(panels: EventChartPanelModel[]): Transferable[] {
  const transferables: Transferable[] = [];

  (panels || []).forEach((panel) => {
    (panel.series || []).forEach((series) => {
      appendFloat64ArrayTransferable(transferables, series.lineValues);
      appendFloat64ArrayTransferable(transferables, series.timeValues);
      appendFloat64ArrayTransferable(transferables, series.gradeColorValues);
    });
  });

  return transferables;
}

function appendFloat64ArrayTransferable(transferables: Transferable[], values: Float64Array | null | undefined): void {
  if (!values || values.byteLength <= 0) {
    return;
  }

  transferables.push(values.buffer);
}

export function getEventChartSeriesPointCount(series: EventChartPanelSeries | null | undefined): number {
  const declaredPointCount = Number(series?.pointCount ?? 0);
  const packedPointCount = Math.floor((series?.lineValues?.length ?? 0) / 2);
  const timePointCount = series?.timeValues?.length ?? 0;
  if (!Number.isFinite(declaredPointCount) || declaredPointCount <= 0 || !packedPointCount || !timePointCount) {
    return Array.isArray(series?.points) ? series.points.length : 0;
  }

  return Math.min(Math.trunc(declaredPointCount), packedPointCount, timePointCount);
}

function hasPackedEventChartSeriesData(series: EventChartPanelSeries | null | undefined): series is EventChartPanelSeries & {
  lineValues: Float64Array;
  timeValues: Float64Array;
  pointCount: number;
} {
  const declaredPointCount = Number(series?.pointCount ?? 0);
  const packedPointCount = Math.floor((series?.lineValues?.length ?? 0) / 2);
  const timePointCount = series?.timeValues?.length ?? 0;
  return !!series
    && series.lineValues instanceof Float64Array
    && series.timeValues instanceof Float64Array
    && Number.isFinite(declaredPointCount)
    && declaredPointCount > 0
    && packedPointCount > 0
    && timePointCount > 0;
}

export function getEventChartSeriesPackedLineValues(series: EventChartPanelSeries): Float64Array | null {
  const pointCount = getEventChartSeriesPointCount(series);
  if (!hasPackedEventChartSeriesData(series) || !pointCount) {
    return null;
  }

  if (series.lineValues.length === pointCount * 2) {
    return series.lineValues;
  }

  return series.lineValues.slice(0, pointCount * 2);
}

function getLegacyEventChartPoint(series: EventChartPanelSeries | null | undefined, index: number): EventChartPoint | null {
  if (!Array.isArray(series?.points)) {
    return null;
  }

  const point = series.points[Math.trunc(index)];
  return point && Number.isFinite(point.x) ? point : null;
}

export function getEventChartSeriesX(series: EventChartPanelSeries, index: number): number {
  if (!isEventChartSeriesIndexInRange(series, index)) {
    return Number.NaN;
  }

  if (hasPackedEventChartSeriesData(series)) {
    return series.lineValues[Math.trunc(index) * 2];
  }

  return getLegacyEventChartPoint(series, index)?.x ?? Number.NaN;
}

export function getEventChartSeriesY(series: EventChartPanelSeries, index: number): number | null {
  if (!isEventChartSeriesIndexInRange(series, index)) {
    return null;
  }

  if (!hasPackedEventChartSeriesData(series)) {
    const value = getLegacyEventChartPoint(series, index)?.y;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  const value = series.lineValues[(Math.trunc(index) * 2) + 1];
  return Number.isFinite(value) ? value : null;
}

export function getEventChartSeriesTime(series: EventChartPanelSeries, index: number): number {
  if (!isEventChartSeriesIndexInRange(series, index)) {
    return Number.NaN;
  }

  if (hasPackedEventChartSeriesData(series)) {
    return series.timeValues[Math.trunc(index)];
  }

  return getLegacyEventChartPoint(series, index)?.time ?? Number.NaN;
}

export function getEventChartSeriesGradeColorValue(series: EventChartPanelSeries, index: number): number | null {
  if (!isEventChartSeriesIndexInRange(series, index)) {
    return null;
  }

  const value = series.gradeColorValues?.[Math.trunc(index)];
  return Number.isFinite(value) ? value as number : null;
}

export function getEventChartSeriesPoint(series: EventChartPanelSeries, index: number): EventChartPoint | null {
  if (!isEventChartSeriesIndexInRange(series, index)) {
    return null;
  }

  const normalizedIndex = Math.trunc(index);
  return {
    x: getEventChartSeriesX(series, normalizedIndex),
    y: getEventChartSeriesY(series, normalizedIndex),
    time: getEventChartSeriesTime(series, normalizedIndex),
  };
}

export function eventChartSeriesToPoints(series: EventChartPanelSeries): EventChartPoint[] {
  const pointCount = getEventChartSeriesPointCount(series);
  const points = new Array<EventChartPoint>(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    points[index] = getEventChartSeriesPoint(series, index) as EventChartPoint;
  }
  return points;
}

export function findFirstEventChartSeriesPointAtOrAfter(
  series: EventChartPanelSeries,
  xValue: number
): number {
  return findFirstEventChartSeriesPointByX(series, xValue, false);
}

export function findFirstEventChartSeriesPointAfter(
  series: EventChartPanelSeries,
  xValue: number
): number {
  return findFirstEventChartSeriesPointByX(series, xValue, true);
}

function findFirstEventChartSeriesPointByX(
  series: EventChartPanelSeries,
  xValue: number,
  exclusive: boolean
): number {
  let low = 0;
  let high = getEventChartSeriesPointCount(series);

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midX = getEventChartSeriesX(series, mid);
    if (exclusive ? midX <= xValue : midX < xValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function isEventChartSeriesIndexInRange(series: EventChartPanelSeries | null | undefined, index: number): boolean {
  return !!series
    && Number.isFinite(index)
    && index >= 0
    && Math.trunc(index) < getEventChartSeriesPointCount(series);
}

function readIntensityZoneLowerLimits(intensityZones: ActivityIntensityZone): number[] {
  const lowerLimits: number[] = [];
  let foundMissingBoundary = false;

  for (const key of EVENT_CHART_INTENSITY_ZONE_LOWER_LIMIT_KEYS) {
    const rawLimit = intensityZones[key];
    if (isMissingIntensityZoneLowerLimit(rawLimit)) {
      foundMissingBoundary = true;
      continue;
    }

    if (foundMissingBoundary) {
      return [];
    }

    const limit = toFiniteIntensityZoneLowerLimit(rawLimit);
    if (limit === null) {
      return [];
    }

    if (lowerLimits.length > 0 && limit <= lowerLimits[lowerLimits.length - 1]) {
      return [];
    }

    lowerLimits.push(limit);
  }

  return lowerLimits.length >= MIN_INTENSITY_ZONE_LOWER_LIMIT_COUNT ? lowerLimits : [];
}

function isMissingIntensityZoneLowerLimit(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
}

function toFiniteIntensityZoneLowerLimit(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }

  const limit = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(limit) ? limit : null;
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
      const series = panel.series[seriesIndex];
      const pointCount = getEventChartSeriesPointCount(series);
      if (!pointCount) {
        continue;
      }

      const stride = Math.max(1, Math.ceil(pointCount / EVENT_ZOOM_OVERVIEW_MAX_SAMPLES_PER_SERIES));
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += stride) {
        const xValue = getEventChartSeriesX(series, pointIndex);
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
  userUnitSettings?: UserUnitSettingsInterface | null;
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
        markerType: 'lap',
        xValue,
        label: `Lap ${index + 1}`,
        color: input.eventColorService.getActivityColor(input.allActivities, activity),
        lapType: normalizedLapType,
        lapNumber: index + 1,
        activityID: activity.getID() || '',
        activityName: activity.creator?.name || 'Activity',
        tooltipTitle: `Lap ${index + 1}`,
        tooltipDetails: buildLapTooltipDetails(lap, input.userUnitSettings),
      });
    });
  });

  return markers.sort((left, right) => left.xValue - right.xValue);
}

export function buildEventSwimLengthMarkers(input: {
  selectedActivities: ActivityInterface[];
  allActivities: ActivityInterface[];
  xAxisType: XAxisTypes;
  eventColorService: AppEventColorService;
  userUnitSettings?: UserUnitSettingsInterface | null;
}): EventChartSwimLengthMarker[] {
  const markers: EventChartSwimLengthMarker[] = [];

  input.selectedActivities.forEach((activity) => {
    const swimLengths = getActivitySwimLengths(activity);
    if (!swimLengths.length) {
      return;
    }

    const activityCache = createActivityNumericCache(activity);
    const distanceLookup = input.xAxisType === XAxisTypes.Distance
      ? createLapDistanceLookup(activity, activityCache)
      : null;
    const activityColor = input.eventColorService.getActivityColor(input.allActivities, activity);

    swimLengths.forEach((swimLength) => {
      const xValue = resolveSwimLengthAxisValue(activity, swimLength, input.xAxisType, activityCache, distanceLookup);
      if (!Number.isFinite(xValue)) {
        return;
      }

      const typeLabel = formatSwimLengthLabel(swimLength.type);
      const label = `Length ${swimLength.index}`;
      markers.push({
        markerType: 'swimLength',
        xValue,
        label,
        color: activityColor,
        swimLengthIndex: swimLength.index,
        swimLengthType: swimLength.type,
        isIdle: isIdleSwimLength(swimLength),
        activityID: activity.getID() || '',
        activityName: activity.creator?.name || 'Activity',
        tooltipTitle: typeLabel ? `${label} (${typeLabel})` : label,
        tooltipDetails: buildSwimLengthTooltipDetails(swimLength, input.userUnitSettings),
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
  // TODO(quantified-self): remove this fallback once sports-lib guarantees canonical stream emission per type
  // (notably FIT vendor aliases for speed/distance fields) so the app never receives duplicate-type candidates.
  const streamsByType = new Map<string, {
    stream: StreamInterface;
    finiteCount: number;
    dataLength: number;
    sourceIndex: number;
  }>();

  streams.forEach((stream, sourceIndex) => {
    const streamType = `${stream?.type || ''}`;
    if (!streamType) {
      return;
    }

    const { finiteCount, dataLength } = getStreamQualityMetrics(stream);
    const existing = streamsByType.get(streamType);
    if (!existing) {
      streamsByType.set(streamType, {
        stream,
        finiteCount,
        dataLength,
        sourceIndex,
      });
      return;
    }

    const hasBetterFiniteCoverage = finiteCount > existing.finiteCount;
    const hasSameFiniteCoverageButMoreData = finiteCount === existing.finiteCount && dataLength > existing.dataLength;
    const isTieButLaterSource = finiteCount === existing.finiteCount
      && dataLength === existing.dataLength
      && sourceIndex > existing.sourceIndex;

    if (hasBetterFiniteCoverage || hasSameFiniteCoverageButMoreData || isTieButLaterSource) {
      streamsByType.set(streamType, {
        stream,
        finiteCount,
        dataLength,
        sourceIndex,
      });
    }
  });

  return [...streamsByType.values()]
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map((entry) => entry.stream);
}

function getStreamQualityMetrics(stream: StreamInterface): { finiteCount: number; dataLength: number } {
  const rawData = stream?.getData?.();
  if (!isNumericValueArrayLike(rawData) || rawData.length === 0) {
    return { finiteCount: 0, dataLength: 0 };
  }

  let finiteCount = 0;
  for (let index = 0; index < rawData.length; index += 1) {
    const numericValue = toNumericValueOrNaN(rawData[index] as unknown);
    if (Number.isFinite(numericValue)) {
      finiteCount += 1;
    }
  }

  return {
    finiteCount,
    dataLength: rawData.length,
  };
}

function canActivityRenderEventChart(activity: ActivityInterface, xAxisType: XAxisTypes): boolean {
  const streams = activity?.getAllStreams?.() || [];
  if (!streams.length) {
    return false;
  }

  if (!hasFiniteStreamData(getActivityStreamByType(activity, XAxisTypes.Time, streams))) {
    return false;
  }

  if (
    xAxisType === XAxisTypes.Distance
    && !hasFiniteStreamData(
      getActivityStreamByType(activity, DataDistance.type, streams)
      || getActivityStreamByType(activity, DataStrydDistance.type, streams)
    )
  ) {
    return false;
  }

  return streams.some((stream) => isEventChartableRawStream(stream) && hasFiniteStreamData(stream));
}

function getActivityStreamByType(
  activity: ActivityInterface | undefined | null,
  streamType: string,
  knownStreams: Map<string, StreamInterface> | StreamInterface[] | null = null
): StreamInterface | null {
  if (!activity || !streamType) {
    return null;
  }

  const hasKnownStreams = (knownStreams instanceof Map && knownStreams.size > 0)
    || (Array.isArray(knownStreams) && knownStreams.length > 0);
  const streamFromKnown = knownStreams instanceof Map
    ? (knownStreams.get(streamType) || null)
    : (Array.isArray(knownStreams) ? knownStreams.find((stream) => stream?.type === streamType) || null : null);
  if (streamFromKnown) {
    return streamFromKnown;
  }

  if (
    hasKnownStreams
    && (streamType === DataDistance.type || streamType === DataStrydDistance.type)
  ) {
    return null;
  }

  if (typeof activity.getStream === 'function') {
    try {
      const stream = activity.getStream(streamType);
      if (stream) {
        return stream;
      }
    } catch {
      // Some providers throw when a requested stream is unavailable.
    }
  }

  const streams = Array.isArray(knownStreams) ? knownStreams : activity.getAllStreams?.() || [];
  return streams.find((stream) => stream?.type === streamType) || null;
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
  const canonicalDataTypes = getAppCanonicalChartDataTypes();
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
): EventChartSeriesPointResult {
  const streamValues = getStreamNumericValues(stream, activityCache);
  if (!streamValues.length) {
    return createEmptySeriesPointResult();
  }

  const shouldTreatAsPace = isEventPaceStreamType(stream.type);
  const speedValues = shouldTreatAsPace
    ? getActivityStreamNumericValues(activity, DataSpeed.type, activityCache)
    : null;

  if (xAxisType === XAxisTypes.Distance) {
    const distanceValues = getActivityDistanceValues(activity, activityCache);
    const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
    const length = Math.min(streamValues.length, distanceValues.length, absoluteTimes.length);

    const lineValues = new Float64Array(length * 2);
    const pointTimes = new Float64Array(length);
    let pointCount = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < length; index += 1) {
      const y = shouldTreatAsPace
        ? getRenderablePaceValue(streamValues[index], speedValues, index)
        : streamValues[index];
      const x = distanceValues[index];
      const time = absoluteTimes[index];
      if (!Number.isFinite(x) || !Number.isFinite(time)) {
        continue;
      }
      const writeOffset = pointCount * 2;
      lineValues[writeOffset] = x;
      lineValues[writeOffset + 1] = typeof y === 'number' && Number.isFinite(y) ? y : Number.NaN;
      pointTimes[pointCount] = time;
      pointCount += 1;
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
    }
    return normalizeSeriesPointResult(lineValues, pointTimes, pointCount, minX, maxX);
  }

  const timeValues = getActivityTimeValues(activity, activityCache);
  const absoluteTimes = getActivityAbsoluteTimes(activity, activityCache);
  const length = Math.min(streamValues.length, timeValues.length, absoluteTimes.length);
  const lineValues = new Float64Array(length * 2);
  const pointTimes = new Float64Array(length);
  let pointCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

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
    if (!Number.isFinite(x)) {
      continue;
    }

    const writeOffset = pointCount * 2;
    lineValues[writeOffset] = x;
    lineValues[writeOffset + 1] = typeof y === 'number' && Number.isFinite(y) ? y : Number.NaN;
    pointTimes[pointCount] = time;
    pointCount += 1;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
  }

  return normalizeSeriesPointResult(lineValues, pointTimes, pointCount, minX, maxX);
}

function createEmptySeriesPointResult(): EventChartSeriesPointResult {
  return {
    lineValues: new Float64Array(0),
    timeValues: new Float64Array(0),
    pointCount: 0,
    ...EMPTY_PANEL_DOMAIN,
  };
}

function normalizeSeriesPointResult(
  lineValues: Float64Array,
  timeValues: Float64Array,
  pointCount: number,
  minX: number,
  maxX: number
): EventChartSeriesPointResult {
  if (!pointCount || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return createEmptySeriesPointResult();
  }

  return {
    lineValues: pointCount * 2 === lineValues.length ? lineValues : lineValues.slice(0, pointCount * 2),
    timeValues: pointCount === timeValues.length ? timeValues : timeValues.slice(0, pointCount),
    pointCount,
    minX,
    maxX,
  };
}

function getRenderablePaceValue(
  rawPaceValue: number,
  speedValues: EventChartNumericValues | null,
  index: number
): number | null {
  if (!Number.isFinite(rawPaceValue) || rawPaceValue <= 0 || rawPaceValue > PACE_MAX_DISPLAY_SECONDS) {
    return null;
  }

  if (isNumericValueArrayLike(speedValues) && index < speedValues.length) {
    const speedValue = speedValues[index];
    if (!Number.isFinite(speedValue) || speedValue <= PACE_MIN_MOVING_SPEED_MPS) {
      return null;
    }
  }

  return rawPaceValue;
}

function toNumericArray(data: unknown): EventChartNumericValues {
  if (data instanceof Float64Array) {
    return data;
  }

  if (!isNumericValueArrayLike(data)) {
    return [];
  }

  const values = new Array<number>(data.length);
  for (let index = 0; index < data.length; index += 1) {
    values[index] = toNumericValueOrNaN(data[index]);
  }
  return values;
}

function toFloat64NumericArray(data: unknown): Float64Array {
  if (data instanceof Float64Array) {
    return data.slice();
  }

  if (!isNumericValueArrayLike(data)) {
    return new Float64Array(0);
  }

  const values = new Float64Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    values[index] = toNumericValueOrNaN(data[index]);
  }
  return values;
}

function toNullableNumberArray(values: Float64Array): Array<number | null> {
  const normalizedValues = new Array<number | null>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    normalizedValues[index] = Number.isFinite(value) ? value : null;
  }
  return normalizedValues;
}

function isNumericValueArrayLike(data: unknown): data is ArrayLike<unknown> {
  if (!data || typeof data === 'string') {
    return false;
  }

  if (Array.isArray(data)) {
    return true;
  }

  return ArrayBuffer.isView(data)
    && typeof (data as unknown as ArrayLike<unknown>).length === 'number';
}

function toNumericValueOrNaN(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? Number(trimmedValue) : Number.NaN;
  }

  return Number.NaN;
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

function resolveSwimLengthAxisValue(
  activity: ActivityInterface,
  swimLength: AppSwimLength,
  xAxisType: XAxisTypes,
  activityCache: ActivityNumericCache,
  distanceLookup: LapDistanceLookup | null = null
): number {
  const endTimeMs = swimLength.endDate?.getTime();
  if (!Number.isFinite(endTimeMs)) {
    return Number.NaN;
  }

  if (xAxisType === XAxisTypes.Time) {
    return endTimeMs as number;
  }

  if (xAxisType === XAxisTypes.Duration) {
    return ((endTimeMs as number) - activity.startDate.getTime()) / 1000;
  }

  const lookup = distanceLookup ?? createLapDistanceLookup(activity, activityCache);
  if (!lookup || !lookup.absoluteTimes.length) {
    return Number.NaN;
  }

  const closestIndex = lookup.isMonotonic
    ? findClosestMonotonicIndex(lookup.absoluteTimes, endTimeMs as number)
    : findClosestLinearIndex(lookup.absoluteTimes, endTimeMs as number);

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

function getFiniteValueNearIndex(values: EventChartNumericValues, index: number): number {
  if (!isNumericValueArrayLike(values) || values.length === 0 || !Number.isFinite(index)) {
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

function createActivityNumericCache(
  activity: ActivityInterface,
  knownStreams: StreamInterface[] | null = null
): ActivityNumericCache {
  const streams = Array.isArray(knownStreams) ? knownStreams : activity.getAllStreams?.() || [];
  const streamByType = new Map<string, StreamInterface>();
  for (let index = 0; index < streams.length; index += 1) {
    const stream = streams[index];
    const streamType = `${stream?.type || ''}`;
    if (!streamType || streamByType.has(streamType)) {
      continue;
    }
    streamByType.set(streamType, stream);
  }

  return {
    startTimeMs: activity.startDate.getTime(),
    streamByType,
    streamValuesByType: new Map<string, EventChartNumericValues>(),
    timeValues: null,
    distanceValues: null,
    absoluteTimeValues: null,
  };
}

function buildLapTooltipDetails(
  lap: LapInterface,
  unitSettings?: UserUnitSettingsInterface | null
): EventChartMarkerTooltipDetail[] {
  const details: EventChartMarkerTooltipDetail[] = [];

  const duration = lap.getDuration?.();
  const durationValue = formatLapDataValue(duration, { compactDuration: true });
  if (durationValue) {
    details.push({ label: 'Duration', value: durationValue });
  }

  const distanceValue = formatLapDataValue(lap.getDistance?.(), undefined, unitSettings);
  if (distanceValue) {
    details.push({ label: 'Distance', value: distanceValue });
  }

  const averagePaceOrSpeed = lap.getStat(DataPaceAvg.type) || lap.getStat(DataSpeedAvg.type);
  const averagePaceOrSpeedLabel = averagePaceOrSpeed && averagePaceOrSpeed.getType() === DataPaceAvg.type
    ? 'Avg Pace'
    : 'Avg Speed';
  const averagePaceOrSpeedValue = formatLapDataValue(averagePaceOrSpeed, undefined, unitSettings);
  if (averagePaceOrSpeedValue) {
    details.push({ label: averagePaceOrSpeedLabel, value: averagePaceOrSpeedValue });
  }

  appendLapDetail(details, 'Avg Heart Rate', lap.getStat(DataHeartRateAvg.type));
  appendLapDetail(details, 'Avg Power', lap.getStat(DataPowerAvg.type));
  appendLapDetail(details, 'Ascent', lap.getStat(DataAscent.type), unitSettings);
  appendLapDetail(details, 'Descent', lap.getStat(DataDescent.type), unitSettings);
  appendLapDetail(details, 'Avg Cadence', lap.getStat(DataCadenceAvg.type));

  return details;
}

function buildSwimLengthTooltipDetails(
  swimLength: AppSwimLength,
  unitSettings?: UserUnitSettingsInterface | null
): EventChartMarkerTooltipDetail[] {
  const details: EventChartMarkerTooltipDetail[] = [];

  appendTextDetail(details, 'Lap', formatNullableInteger(swimLength.lapIndex));
  appendLapDetail(details, 'Duration', swimLength.timerTime ?? swimLength.elapsedTime, unitSettings, { compactDuration: true });
  appendLapDetail(details, 'Distance', getSwimLengthDistance(swimLength), unitSettings);
  appendTextDetail(details, 'Type', formatSwimLengthLabel(swimLength.type));
  appendTextDetail(details, 'Stroke', formatSwimLengthLabel(swimLength.stroke));
  appendTextDetail(details, 'Strokes', formatNullableInteger(swimLength.strokes));
  appendLapDetail(details, 'Swim Pace', getSwimLengthPace(swimLength), unitSettings);
  appendLapDetail(details, 'Avg Cadence', swimLength.avgCadence ?? undefined, unitSettings);
  appendLapDetail(details, 'Avg Heart Rate', swimLength.avgHeartRate ?? undefined, unitSettings);
  appendLapDetail(details, 'Max Heart Rate', swimLength.maxHeartRate ?? undefined, unitSettings);
  appendTextDetail(details, 'SWOLF', formatNullableNumber(swimLength.swolf));
  appendLapDetail(details, 'Energy', swimLength.calories ?? undefined, unitSettings);

  return details;
}

function appendLapDetail(
  details: EventChartMarkerTooltipDetail[],
  label: string,
  data: DataInterface | null | void,
  unitSettings?: UserUnitSettingsInterface | null,
  options?: { compactDuration?: boolean }
): void {
  const value = formatLapDataValue(data, options, unitSettings);
  if (!value) {
    return;
  }

  details.push({ label, value });
}

function appendTextDetail(
  details: EventChartMarkerTooltipDetail[],
  label: string,
  value: string
): void {
  if (!value) {
    return;
  }

  details.push({ label, value });
}

function formatLapDataValue(
  data: DataInterface | null | void,
  options?: { compactDuration?: boolean },
  unitSettings?: UserUnitSettingsInterface | null
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

  if (unitSettings) {
    const unitAwareValue = resolveUnitAwareDisplayStat(data, unitSettings, {
      stripRepeatedUnit: true,
    })?.text;
    if (unitAwareValue) {
      return normalizeDisplayUnitText(unitAwareValue);
    }
  }

  const displayValue = `${data.getDisplayValue?.() ?? ''}`.trim();
  if (!displayValue) {
    return '';
  }

  return normalizeDisplayUnitText(`${displayValue}${data.getDisplayUnit?.() ?? ''}`.trim());
}

function normalizeDisplayUnitText(value: string): string {
  return value
    .replace(/\/100\s*yards?/gi, '/100yd')
    .replace(/\/100yrd/gi, '/100yd')
    .replace(/\byrds?\b/gi, 'yd');
}

function getSwimLengthPace(swimLength: AppSwimLength): DataSwimPace | null {
  const speedValue = swimLength.avgSpeed?.getValue?.();
  if (typeof speedValue !== 'number' || !Number.isFinite(speedValue) || speedValue <= 0) {
    return null;
  }

  return new DataSwimPace(convertSpeedToSwimPace(speedValue));
}

function getSwimLengthDistance(swimLength: AppSwimLength): DataPoolLength | null {
  const distanceValue = swimLength.distance?.getValue?.();
  if (typeof distanceValue !== 'number' || !Number.isFinite(distanceValue)) {
    return null;
  }

  return new DataPoolLength(distanceValue);
}

function formatNullableInteger(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}` : '';
}

function formatNullableNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatSwimLengthLabel(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return `${value}`
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, match => match.toUpperCase());
}

function isIdleSwimLength(swimLength: AppSwimLength): boolean {
  const type = `${swimLength.type || ''}`.toLowerCase();
  return type.includes('idle') || type.includes('rest');
}

function getStreamNumericValues(stream: StreamInterface, cache: ActivityNumericCache): EventChartNumericValues {
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
): EventChartNumericValues {
  const cached = cache.streamValuesByType.get(streamType);
  if (cached) {
    return cached;
  }

  const values = toNumericArray(getActivityStreamByType(activity, streamType, cache.streamByType)?.getData?.());
  cache.streamValuesByType.set(streamType, values);
  return values;
}

function getActivityTimeValues(activity: ActivityInterface, cache: ActivityNumericCache): EventChartNumericValues {
  if (cache.timeValues) {
    return cache.timeValues;
  }

  cache.timeValues = getActivityStreamNumericValues(activity, XAxisTypes.Time, cache);
  return cache.timeValues;
}

function getActivityDistanceValues(activity: ActivityInterface, cache: ActivityNumericCache): EventChartNumericValues {
  if (cache.distanceValues) {
    return cache.distanceValues;
  }

  const primaryDistance = getActivityStreamNumericValues(activity, DataDistance.type, cache);
  cache.distanceValues = primaryDistance.length > 0
    ? primaryDistance
    : getActivityStreamNumericValues(activity, DataStrydDistance.type, cache);
  return cache.distanceValues;
}

function getActivityAbsoluteTimes(activity: ActivityInterface, cache: ActivityNumericCache): EventChartNumericValues {
  if (cache.absoluteTimeValues) {
    return cache.absoluteTimeValues;
  }

  const startTimeMs = Number.isFinite(cache.startTimeMs) ? cache.startTimeMs : activity.startDate.getTime();
  const timeValues = getActivityTimeValues(activity, cache);
  const absoluteTimes = new Float64Array(timeValues.length);
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
  const minX = Number(panel.minX);
  const maxX = Number(panel.maxX);

  if (!panel.series.length || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return {
      ...panel,
      ...EMPTY_PANEL_DOMAIN,
    };
  }

  if (maxX <= minX) {
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
