import {
  DataAltitude,
  DataAltitudeSmooth,
  DataDistance,
  DataGrade,
  DataGradeSmooth,
  DynamicDataLoader,
  RouteInterface,
  RouteStreamInterface,
  UserUnitSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { TrackChartPanelModel, TrackChartPanelSeries } from './track-chart-panel.model';
import { normalizeUnitDerivedTypeLabel } from './stat-label.helper';
import { RouteSegmentDetailView } from './route-detail.helper';

export const ROUTE_CHART_POINT_INDEX_X_AXIS_TYPE = 'PointIndex' as XAxisTypes;

export interface RouteChartPanelsResult {
  panels: TrackChartPanelModel[];
  xAxisType: XAxisTypes;
  xAxisLabel: string;
  usesDistanceXAxis: boolean;
}

interface RouteChartTarget {
  panelDataType: string;
  displayName: string;
  streamTypes: string[];
}

interface RouteSeriesBuildResult {
  series: TrackChartPanelSeries | null;
  minX: number;
  maxX: number;
}

const ALTITUDE_TARGET: RouteChartTarget = {
  panelDataType: DataAltitude.type,
  displayName: 'Elevation',
  streamTypes: [DataAltitudeSmooth.type, DataAltitude.type],
};

const GRADE_TARGET: RouteChartTarget = {
  panelDataType: DataGrade.type,
  displayName: 'Grade',
  streamTypes: [DataGradeSmooth.type, DataGrade.type],
};

export function buildRouteChartPanels(
  segments: RouteSegmentDetailView[],
  unitSettings: UserUnitSettingsInterface | null,
): RouteChartPanelsResult {
  const selectedSegments = Array.isArray(segments) ? segments : [];
  const usesDistanceXAxis = selectedSegments.length > 0
    && selectedSegments.every(segment => routeHasDistanceXAxis(segment.route));
  const xAxisType = usesDistanceXAxis ? XAxisTypes.Distance : ROUTE_CHART_POINT_INDEX_X_AXIS_TYPE;
  const panels = [ALTITUDE_TARGET, GRADE_TARGET]
    .map(target => buildRouteChartPanel(target, selectedSegments, xAxisType, unitSettings))
    .filter((panel): panel is TrackChartPanelModel => !!panel && panel.series.length > 0);

  return {
    panels,
    xAxisType,
    xAxisLabel: usesDistanceXAxis ? 'Distance' : 'Point index',
    usesDistanceXAxis,
  };
}

export function routeHasDistanceXAxis(route: RouteInterface): boolean {
  const distanceValues = getRouteStreamNumericValues(route, DataDistance.type);
  return distanceValues.filter(value => Number.isFinite(value)).length >= 2;
}

export function getRouteStreamNumericValues(route: RouteInterface, streamType: string): number[] {
  const stream = getRouteStream(route, streamType);
  if (!stream) {
    return [];
  }
  return (stream.getData?.(true, true) || [])
    .map(value => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN);
}

function buildRouteChartPanel(
  target: RouteChartTarget,
  segments: RouteSegmentDetailView[],
  xAxisType: XAxisTypes,
  unitSettings: UserUnitSettingsInterface | null,
): TrackChartPanelModel | null {
  const dataClass = DynamicDataLoader.getDataClassFromDataType(target.panelDataType);
  const panel: TrackChartPanelModel = {
    dataType: target.panelDataType,
    displayName: normalizeUnitDerivedTypeLabel(target.panelDataType, target.displayName || dataClass.displayType || dataClass.type),
    unit: dataClass.unit || '',
    colorGroupKey: target.panelDataType,
    series: [],
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
  };

  segments.forEach((segment) => {
    const result = buildRouteSeries(segment, target, xAxisType, unitSettings);
    if (!result.series) {
      return;
    }
    panel.series.push(result.series);
    panel.minX = Math.min(panel.minX, result.minX);
    panel.maxX = Math.max(panel.maxX, result.maxX);
  });

  if (!panel.series.length || !Number.isFinite(panel.minX) || !Number.isFinite(panel.maxX)) {
    return null;
  }

  if (panel.maxX <= panel.minX) {
    panel.maxX = panel.minX + 1;
  }

  return panel;
}

function buildRouteSeries(
  segment: RouteSegmentDetailView,
  target: RouteChartTarget,
  xAxisType: XAxisTypes,
  _unitSettings: UserUnitSettingsInterface | null,
): RouteSeriesBuildResult {
  const streamType = target.streamTypes.find(type => getRouteStream(segment.route, type));
  if (!streamType) {
    return createEmptyRouteSeriesBuildResult();
  }

  const yValues = getRouteStreamNumericValues(segment.route, streamType);
  if (!yValues.length) {
    return createEmptyRouteSeriesBuildResult();
  }

  const distanceValues = xAxisType === XAxisTypes.Distance
    ? getRouteStreamNumericValues(segment.route, DataDistance.type)
    : [];
  const lineValues = new Float64Array(yValues.length * 2);
  const timeValues = new Float64Array(yValues.length);
  const gradeValues = target.panelDataType === DataAltitude.type
    ? buildGradeColorValues(segment.route, yValues.length)
    : null;
  let pointCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < yValues.length; index += 1) {
    const x = xAxisType === XAxisTypes.Distance ? distanceValues[index] : index;
    if (!Number.isFinite(x)) {
      continue;
    }

    const writeOffset = pointCount * 2;
    lineValues[writeOffset] = x;
    lineValues[writeOffset + 1] = Number.isFinite(yValues[index]) ? yValues[index] : Number.NaN;
    timeValues[pointCount] = x;
    if (gradeValues) {
      gradeValues[pointCount] = Number.isFinite(gradeValues[index]) ? gradeValues[index] : Number.NaN;
    }
    pointCount += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }

  if (!pointCount || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return createEmptyRouteSeriesBuildResult();
  }

  const dataClass = DynamicDataLoader.getDataClassFromDataType(target.panelDataType);
  const series: TrackChartPanelSeries = {
    id: `${segment.id}::${target.panelDataType}`,
    activityID: segment.id,
    activityName: segment.label,
    color: segment.color,
    streamType,
    displayName: normalizeUnitDerivedTypeLabel(target.panelDataType, target.displayName || dataClass.displayType || dataClass.type),
    unit: dataClass.unit || '',
    lineValues: pointCount * 2 === lineValues.length ? lineValues : lineValues.slice(0, pointCount * 2),
    timeValues: pointCount === timeValues.length ? timeValues : timeValues.slice(0, pointCount),
    pointCount,
    ...(gradeValues && gradeValues.some(value => Number.isFinite(value)) ? {
      gradeColorValues: pointCount === gradeValues.length ? gradeValues : gradeValues.slice(0, pointCount),
      gradeColorSourceType: getAvailableRouteStreamType(segment.route, [DataGradeSmooth.type, DataGrade.type]) || undefined,
    } : {}),
  };

  return { series, minX, maxX };
}

function buildGradeColorValues(route: RouteInterface, length: number): Float64Array | null {
  const gradeStreamType = getAvailableRouteStreamType(route, [DataGradeSmooth.type, DataGrade.type]);
  if (!gradeStreamType) {
    return null;
  }

  const sourceValues = getRouteStreamNumericValues(route, gradeStreamType);
  if (!sourceValues.length) {
    return null;
  }

  const gradeValues = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = sourceValues[index];
    gradeValues[index] = Number.isFinite(value) ? value : Number.NaN;
  }
  return gradeValues;
}

function getAvailableRouteStreamType(route: RouteInterface, streamTypes: string[]): string | null {
  return streamTypes.find(streamType => !!getRouteStream(route, streamType)) || null;
}

function getRouteStream(route: RouteInterface, streamType: string): RouteStreamInterface | null {
  try {
    const stream = route.getStream?.(streamType);
    return stream || null;
  } catch {
    return null;
  }
}

function createEmptyRouteSeriesBuildResult(): RouteSeriesBuildResult {
  return {
    series: null,
    minX: 0,
    maxX: 1,
  };
}
