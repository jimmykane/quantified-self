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

const EMPTY_PANEL_DOMAIN = { minX: 0, maxX: 1 };
const NEVER_RENDER_STREAM_TYPES = new Set<string>([
  DataDuration.type,
  XAxisTypes.Time,
  XAxisTypes.Duration,
]);

export function buildEventChartPanels(input: BuildEventChartPanelsInput): EventChartPanelModel[] {
  const selectedActivities = Array.isArray(input.selectedActivities) ? input.selectedActivities : [];
  if (!selectedActivities.length) {
    return [];
  }

  const panelsMap = new Map<string, EventChartPanelModel>();

  selectedActivities.forEach((activity) => {
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
      const points = toSeriesPoints(activity, stream, input.xAxisType);
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
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

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
  const lapTypeSet = new Set((input.lapTypes || []).map((lapType) => `${lapType}`));
  const markers: EventChartLapMarker[] = [];

  input.selectedActivities.forEach((activity) => {
    const laps = activity.getLaps() || [];
    if (!laps.length) {
      return;
    }

    laps.forEach((lap, index) => {
      if (index === laps.length - 1) {
        return;
      }

      if (lapTypeSet.size > 0 && !lapTypeSet.has(`${lap.type}`)) {
        return;
      }

      const xValue = resolveLapAxisValue(activity, lap.endDate?.getTime(), input.xAxisType);
      if (!Number.isFinite(xValue)) {
        return;
      }

      markers.push({
        xValue,
        label: `Lap ${index + 1}`,
        color: input.eventColorService.getActivityColor(input.allActivities, activity),
        lapType: `${lap.type}`,
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

  const allKnownUnitVariants = Object.values(DynamicDataLoader.dataTypeUnitGroups)
    .flatMap((group: any) => Object.keys(group));

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

      if (allowedDataTypes !== null && !allowedDataTypes.includes(stream.type)) {
        return false;
      }

      if (allKnownUnitVariants.includes(stream.type) && !whitelistedUnitTypes.includes(stream.type)) {
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

function toSeriesPoints(activity: ActivityInterface, stream: StreamInterface, xAxisType: XAxisTypes): EventChartPoint[] {
  const streamValues = toNumericArray(stream.getData());
  if (!streamValues.length) {
    return [];
  }

  if (xAxisType === XAxisTypes.Distance) {
    const distanceStream = activity.getStream(DataDistance.type) || activity.getStream(DataStrydDistance.type);
    const distanceValues = toNumericArray(distanceStream?.getData());
    const timeValues = toNumericArray(activity.getStream(XAxisTypes.Time)?.getData());
    const length = Math.min(streamValues.length, distanceValues.length, timeValues.length);

    const points: EventChartPoint[] = [];
    for (let index = 0; index < length; index += 1) {
      const y = streamValues[index];
      const x = distanceValues[index];
      const seconds = timeValues[index];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(seconds)) {
        continue;
      }
      points.push({
        x,
        y,
        time: activity.startDate.getTime() + seconds * 1000
      });
    }
    return points;
  }

  const timeValues = toNumericArray(activity.getStream(XAxisTypes.Time)?.getData());
  const length = Math.min(streamValues.length, timeValues.length);
  const points: EventChartPoint[] = [];

  for (let index = 0; index < length; index += 1) {
    const y = streamValues[index];
    const seconds = timeValues[index];
    if (!Number.isFinite(y) || !Number.isFinite(seconds)) {
      continue;
    }

    const x = xAxisType === XAxisTypes.Time
      ? activity.startDate.getTime() + seconds * 1000
      : seconds;

    points.push({
      x,
      y,
      time: activity.startDate.getTime() + seconds * 1000
    });
  }

  return points;
}

function toNumericArray(data: unknown): number[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((value) => Number(value));
}

function resolveLapAxisValue(activity: ActivityInterface, lapEndTimeMs: number | undefined, xAxisType: XAxisTypes): number {
  if (!Number.isFinite(lapEndTimeMs)) {
    return Number.NaN;
  }

  if (xAxisType === XAxisTypes.Time) {
    return lapEndTimeMs as number;
  }

  if (xAxisType === XAxisTypes.Duration) {
    return ((lapEndTimeMs as number) - activity.startDate.getTime()) / 1000;
  }

  const distanceStream = activity.getStream(DataDistance.type) || activity.getStream(DataStrydDistance.type);
  const timeStream = activity.getStream(XAxisTypes.Time);
  const distanceValues = toNumericArray(distanceStream?.getData());
  const timeValues = toNumericArray(timeStream?.getData());
  const length = Math.min(distanceValues.length, timeValues.length);
  if (!length) {
    return Number.NaN;
  }

  let closestIndex = 0;
  let smallestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < length; index += 1) {
    const absoluteTime = activity.startDate.getTime() + timeValues[index] * 1000;
    const delta = Math.abs((lapEndTimeMs as number) - absoluteTime);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closestIndex = index;
    }
  }

  return distanceValues[closestIndex];
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
