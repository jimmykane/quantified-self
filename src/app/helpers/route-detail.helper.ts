import {
  DataAscent,
  DataDescent,
  DataDistance,
  DataGradeMax,
  DataGradeMin,
  RouteFileInterface,
  RouteInterface,
  RoutePointInterface,
  RouteWaypointInterface,
  UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON, FirestoreRouteSegmentJSON } from '@shared/app-route.interface';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { SummaryPrimaryInfoMetric } from '../components/shared/summary-primary-info/summary-primary-info.component';

export interface RouteMetricCellView {
  label: string;
  rawValue: number | null;
  title: string;
}

export interface RouteSegmentDetailView {
  id: string;
  routeIndex: number;
  label: string;
  activityType: string;
  color: string;
  route: RouteInterface;
  positions: Array<{ latitudeDegrees: number; longitudeDegrees: number }>;
  pointCount: number;
  distance: RouteMetricCellView;
  ascent: RouteMetricCellView;
  descent: RouteMetricCellView;
  minGrade: RouteMetricCellView;
  maxGrade: RouteMetricCellView;
}

export interface RouteWaypointDetailView {
  id: string;
  name: string;
  type: string;
  distanceLabel: string | null;
  routeIndex: number | null;
  routePointIndex: number | null;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface RouteWaypointDisplayView extends RouteWaypointDetailView {
  color: string;
  segmentLabel: string;
}

const ROUTE_SEGMENT_COLORS = [
  '#1e88e5',
  '#43a047',
  '#f9a825',
  '#8e24aa',
  '#e53935',
  '#00897b',
  '#3949ab',
  '#6d4c41',
] as const;

const ROUTE_WAYPOINT_DEFAULT_COLOR = '#607d8b';

const ROUTE_WAYPOINT_TYPE_COLORS: Array<{ pattern: RegExp; color: string }> = [
  { pattern: /\b(start|begin|trailhead)\b/i, color: '#2e7d32' },
  { pattern: /\b(end|finish|destination)\b/i, color: '#c62828' },
  { pattern: /\b(food|water|aid|gas|fuel|restaurant|cafe|shop|store|hotel|lodging|camp)\b/i, color: '#00897b' },
  { pattern: /\b(summit|peak|view|scenic|mountain|hill)\b/i, color: '#8e24aa' },
  { pattern: /\b(warning|danger|hazard|caution|roadblock|closed|accident|police|hospital)\b/i, color: '#f57c00' },
  { pattern: /\b(turn|left|right|junction|intersection|crossing|bridge|flag)\b/i, color: '#3949ab' },
];

const ROUTE_STAT_ALIASES: Record<string, string[]> = {
  [DataDistance.type]: [DataDistance.type, 'distance'],
  [DataAscent.type]: [DataAscent.type, 'ascent'],
  [DataDescent.type]: [DataDescent.type, 'descent'],
  [DataGradeMin.type]: [DataGradeMin.type, 'minGrade', 'gradeMin', 'minimumGrade'],
  [DataGradeMax.type]: [DataGradeMax.type, 'maxGrade', 'gradeMax', 'maximumGrade'],
};

export function buildRouteSegmentDetailViews(
  routeDocument: FirestoreRouteJSON,
  routeFile: RouteFileInterface,
  unitSettings: UserUnitSettingsInterface | null,
): RouteSegmentDetailView[] {
  const storedSegments = Array.isArray(routeDocument.routes) ? routeDocument.routes : [];
  return (routeFile.getRoutes?.() || []).map((route, index) => {
    const storedSegment = resolveStoredSegment(route, index, storedSegments);
    const segmentID = route.getID?.() || storedSegment?.id || `segment-${index + 1}`;
    const label = route.name || storedSegment?.name || `Segment ${index + 1}`;
    const activityType = `${route.activityType || storedSegment?.activityType || ''}`.trim() || 'Route';
    return {
      id: segmentID,
      routeIndex: index,
      label,
      activityType,
      color: ROUTE_SEGMENT_COLORS[index % ROUTE_SEGMENT_COLORS.length],
      route,
      positions: getRoutePositions(route),
      pointCount: getRoutePointCount(storedSegment),
      distance: buildRouteMetricCell(storedSegment, DataDistance.type, 'Distance', unitSettings),
      ascent: buildRouteMetricCell(storedSegment, DataAscent.type, 'Ascent', unitSettings),
      descent: buildRouteMetricCell(storedSegment, DataDescent.type, 'Descent', unitSettings),
      minGrade: buildRouteMetricCell(storedSegment, DataGradeMin.type, 'Minimum grade', unitSettings),
      maxGrade: buildRouteMetricCell(storedSegment, DataGradeMax.type, 'Maximum grade', unitSettings),
    };
  });
}

export function buildRouteSummaryMetrics(
  routeDocument: FirestoreRouteJSON,
  unitSettings: UserUnitSettingsInterface | null,
): SummaryPrimaryInfoMetric[] {
  const distance = readStoredRouteDocumentStat(routeDocument, DataDistance.type);
  const ascent = readStoredRouteDocumentStat(routeDocument, DataAscent.type);
  const descent = readStoredRouteDocumentStat(routeDocument, DataDescent.type);
  const minGrade = readStoredRouteDocumentStat(routeDocument, DataGradeMin.type);
  const maxGrade = readStoredRouteDocumentStat(routeDocument, DataGradeMax.type);
  const pointCount = toFiniteNumber(routeDocument.pointCount) ?? 0;

  return [
    {
      value: formatRouteMetricValue(DataDistance.type, distance, unitSettings),
      label: 'Distance',
    },
    {
      value: formatRouteMetricValue(DataAscent.type, ascent, unitSettings),
      label: 'Ascent',
    },
    {
      value: formatRouteMetricValue(DataDescent.type, descent, unitSettings),
      label: 'Descent',
    },
    {
      value: formatRouteMetricValue(DataGradeMin.type, minGrade, unitSettings),
      label: 'Min grade',
    },
    {
      value: formatRouteMetricValue(DataGradeMax.type, maxGrade, unitSettings),
      label: 'Max grade',
    },
    {
      value: `${pointCount}`,
      label: 'Points',
    },
  ];
}

export function buildRouteWaypointDetailViews(
  routeFile: RouteFileInterface,
  unitSettings: UserUnitSettingsInterface | null,
): RouteWaypointDetailView[] {
  return (routeFile.getWaypoints?.() || [])
    .filter(waypoint => Number.isFinite(waypoint?.latitudeDegrees) && Number.isFinite(waypoint?.longitudeDegrees))
    .map((waypoint, index) => ({
      id: `waypoint-${index}`,
      name: getWaypointName(waypoint, index),
      type: `${waypoint.type || waypoint.symbol || 'Waypoint'}`.trim(),
      distanceLabel: Number.isFinite(waypoint.distance)
        ? formatRouteMetricValue(DataDistance.type, waypoint.distance as number, unitSettings)
        : null,
      routeIndex: Number.isFinite(waypoint.routeIndex) ? waypoint.routeIndex as number : null,
      routePointIndex: Number.isFinite(waypoint.routePointIndex) ? waypoint.routePointIndex as number : null,
      latitudeDegrees: waypoint.latitudeDegrees,
      longitudeDegrees: waypoint.longitudeDegrees,
    }));
}

export function filterRouteWaypointsForSegments(
  waypoints: RouteWaypointDetailView[],
  segments: RouteSegmentDetailView[],
): RouteWaypointDetailView[] {
  const selectedSegments = Array.isArray(segments) ? segments : [];
  if (selectedSegments.length === 0) {
    return [];
  }

  const selectedRouteIndexes = new Set(selectedSegments.map(segment => segment.routeIndex));
  return (Array.isArray(waypoints) ? waypoints : [])
    .filter(waypoint => Number.isFinite(waypoint.latitudeDegrees) && Number.isFinite(waypoint.longitudeDegrees))
    .filter(waypoint => waypoint.routeIndex === null || selectedRouteIndexes.has(waypoint.routeIndex));
}

export function buildRouteWaypointDisplayViews(
  waypoints: RouteWaypointDetailView[],
  segments: RouteSegmentDetailView[],
): RouteWaypointDisplayView[] {
  return (Array.isArray(waypoints) ? waypoints : [])
    .filter(waypoint => Number.isFinite(waypoint.latitudeDegrees) && Number.isFinite(waypoint.longitudeDegrees))
    .map(waypoint => ({
      ...waypoint,
      color: getRouteWaypointDisplayColor(waypoint, segments),
      segmentLabel: getRouteWaypointSegmentLabel(waypoint, segments),
    }));
}

export function getRouteWaypointDisplayColor(
  waypoint: RouteWaypointDetailView,
  segments: RouteSegmentDetailView[],
): string {
  const segment = resolveWaypointSegment(waypoint, segments);
  if (segment?.color) {
    return segment.color;
  }

  return getWaypointTypeColor(`${waypoint.type} ${waypoint.name}`);
}

export function getRouteWaypointSegmentLabel(
  waypoint: RouteWaypointDetailView,
  segments: RouteSegmentDetailView[],
): string {
  const segment = resolveWaypointSegment(waypoint, segments);
  if (segment?.label) {
    return segment.label;
  }
  return waypoint.routeIndex === null ? 'Global' : 'Unmatched';
}

export function getRoutePositions(route: RouteInterface): Array<{ latitudeDegrees: number; longitudeDegrees: number }> {
  const positionData = route.getSquashedPositionData?.()
    || route.getPositionData?.()?.filter((position): position is { latitudeDegrees: number; longitudeDegrees: number } => !!position)
    || [];
  const pointData = positionData.length > 0
    ? positionData
    : (route.getPointData?.() || []);

  return pointData
    .filter((position: RoutePointInterface) => (
      Number.isFinite(position?.latitudeDegrees)
      && Number.isFinite(position?.longitudeDegrees)
      && (position.latitudeDegrees !== 0 || position.longitudeDegrees !== 0)
    ))
    .map((position: RoutePointInterface) => ({
      latitudeDegrees: position.latitudeDegrees,
      longitudeDegrees: position.longitudeDegrees,
    }));
}

export function buildRouteMetricCell(
  storedSegment: FirestoreRouteSegmentJSON | null | undefined,
  dataType: string,
  metricLabel: string,
  unitSettings: UserUnitSettingsInterface | null,
): RouteMetricCellView {
  const rawValue = readStoredRouteSegmentStat(storedSegment, dataType);
  const label = formatRouteMetricValue(dataType, rawValue, unitSettings);

  return {
    label,
    rawValue,
    title: rawValue === null ? `${metricLabel} unknown` : `${metricLabel}: ${label}`,
  };
}

export function readStoredRouteSegmentStat(
  storedSegment: FirestoreRouteSegmentJSON | null | undefined,
  dataType: string,
): number | null {
  const stats = storedSegment?.stats;
  if (!stats || typeof stats !== 'object') {
    return null;
  }

  const aliases = ROUTE_STAT_ALIASES[dataType] || [dataType];
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(stats, alias)) {
      continue;
    }

    const value = readRouteStatValue(stats[alias]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function readStoredRouteDocumentStat(
  routeDocument: FirestoreRouteJSON | null | undefined,
  dataType: string,
): number | null {
  const stats = routeDocument?.stats;
  if (!stats || typeof stats !== 'object') {
    return null;
  }

  const aliases = ROUTE_STAT_ALIASES[dataType] || [dataType];
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(stats, alias)) {
      continue;
    }

    const value = readRouteStatValue(stats[alias]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function formatRouteMetricValue(
  dataType: string,
  value: number | null,
  unitSettings: UserUnitSettingsInterface | null,
): string {
  if (value === null) {
    return '-';
  }

  return resolveUnitAwareDisplayFromValue(dataType, value, unitSettings, {
    stripRepeatedUnit: true,
    compactAscentDescent: true,
  })?.text ?? `${Math.round(value)}`;
}

function resolveStoredSegment(
  route: RouteInterface,
  index: number,
  storedSegments: FirestoreRouteSegmentJSON[],
): FirestoreRouteSegmentJSON | null {
  const routeID = route.getID?.();
  return (routeID ? storedSegments.find(segment => segment.id === routeID) : null)
    || storedSegments[index]
    || null;
}

function getRoutePointCount(
  storedSegment: FirestoreRouteSegmentJSON | null | undefined,
): number {
  return toFiniteNumber(storedSegment?.pointCount) ?? 0;
}

function readRouteStatValue(value: unknown): number | null {
  const directValue = toFiniteNumber(value);
  if (directValue !== null) {
    return directValue;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const statObject = value as Record<string, unknown>;
  return toFiniteNumber(statObject.value)
    ?? toFiniteNumber(statObject.rawValue)
    ?? toFiniteNumber(statObject._value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }
    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  }
  return null;
}

function getWaypointName(waypoint: RouteWaypointInterface, index: number): string {
  return `${waypoint.name || waypoint.description || waypoint.comment || `Waypoint ${index + 1}`}`.trim();
}

function resolveWaypointSegment(
  waypoint: RouteWaypointDetailView,
  segments: RouteSegmentDetailView[],
): RouteSegmentDetailView | null {
  if (waypoint.routeIndex === null) {
    return null;
  }

  return (Array.isArray(segments) ? segments : [])
    .find(segment => segment.routeIndex === waypoint.routeIndex)
    || null;
}

function getWaypointTypeColor(descriptor: string): string {
  const normalizedDescriptor = `${descriptor || ''}`.trim();
  const match = ROUTE_WAYPOINT_TYPE_COLORS.find(rule => rule.pattern.test(normalizedDescriptor));
  return match?.color || ROUTE_WAYPOINT_DEFAULT_COLOR;
}
