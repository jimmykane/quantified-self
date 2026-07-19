import {
  decodeRoutePolyline5,
  type RoutePreviewCoordinateInterface,
  type RoutePreviewJSONInterface,
  type RoutePreviewSegmentJSONInterface,
} from '@sports-alliance/sports-lib';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import type { TrackMapRenderData } from '../services/map/track-map.manager';

const ROUTE_PREVIEW_TRACK_COLORS = [
  '#1e88e5',
  '#43a047',
  '#fb8c00',
  '#8e24aa',
  '#00acc1',
  '#e53935',
  '#7cb342',
  '#5e35b1',
];

export interface RoutePreviewThumbnailPoint {
  x: number;
  y: number;
}

export interface RoutePreviewThumbnailPath {
  id: string;
  label: string;
  d: string;
  strokeColor: string;
}

export interface RoutePreviewThumbnailRenderData {
  viewBox: string;
  paths: RoutePreviewThumbnailPath[];
  startPoint: RoutePreviewThumbnailPoint | null;
  endPoint: RoutePreviewThumbnailPoint | null;
}

export interface RoutePreviewThumbnailOptions {
  width?: number;
  height?: number;
  padding?: number;
}

export interface RoutePreviewMapTrackMetadata {
  routeId: string;
  routeUserId: string | null;
}

export interface RoutePreviewMapBuildOptions {
  decodedSegmentCache?: WeakMap<RoutePreviewSegmentJSONInterface, {
    encodedPolyline: string;
    positions: RoutePreviewCoordinateInterface[];
  }>;
}

export function isRenderableRoutePreview(preview: RoutePreviewJSONInterface | null | undefined): boolean {
  return !!preview
    && preview.version === 1
    && preview.encoding === 'polyline5'
    && preview.precision === 5
    && typeof preview.pointCount === 'number'
    && preview.pointCount > 0
    && Array.isArray(preview.segments)
    && preview.segments.some(segment => isRenderableRoutePreviewSegment(segment));
}

export function buildRoutePreviewMapTracks(
  routes: readonly FirestoreRouteJSON[] | null | undefined,
  options: RoutePreviewMapBuildOptions = {},
): TrackMapRenderData[] {
  return (routes || []).flatMap((route, routeIndex) => {
    if (!isRenderableRoutePreview(route.preview)) {
      return [];
    }

    return route.preview.segments
      .filter(segment => isRenderableRoutePreviewSegment(segment))
      .map<TrackMapRenderData | null>((segment, routeSegmentIndex) => {
        const decodedPositions = decodeRoutePreviewSegment(segment, options.decodedSegmentCache);
        if (decodedPositions.length < 2) {
          return null;
        }

        const trackId = `${route.id || `route-${routeIndex}`}-${segment.id || routeSegmentIndex}`;
        const color = ROUTE_PREVIEW_TRACK_COLORS[stablePaletteIndex(trackId, ROUTE_PREVIEW_TRACK_COLORS.length)];
        return {
          id: trackId,
          label: segment.name || route.name || 'Route',
          strokeColor: color,
          positions: decodedPositions,
          metadata: {
            routeId: `${route.id || ''}`,
            routeUserId: route.userID ? `${route.userID}` : null,
          } satisfies RoutePreviewMapTrackMetadata,
        };
      })
      .filter((track): track is TrackMapRenderData => track !== null);
  });
}

function decodeRoutePreviewSegment(
  segment: RoutePreviewSegmentJSONInterface,
  cache: RoutePreviewMapBuildOptions['decodedSegmentCache'],
): RoutePreviewCoordinateInterface[] {
  const cachedSegment = cache?.get(segment);
  if (cachedSegment?.encodedPolyline === segment.encodedPolyline) {
    return cachedSegment.positions;
  }

  const decodedPositions = decodeRoutePolyline5(segment.encodedPolyline)
    .filter(point => Number.isFinite(point.latitudeDegrees) && Number.isFinite(point.longitudeDegrees));
  cache?.set(segment, {
    encodedPolyline: segment.encodedPolyline,
    positions: decodedPositions,
  });
  return decodedPositions;
}

function stablePaletteIndex(value: string, paletteLength: number): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(1, paletteLength);
}

export function buildRoutePreviewThumbnail(
  preview: RoutePreviewJSONInterface | null | undefined,
  options: RoutePreviewThumbnailOptions = {},
): RoutePreviewThumbnailRenderData | null {
  const width = normalizePositiveNumber(options.width, 96);
  const height = normalizePositiveNumber(options.height, 56);
  const padding = Math.max(0, Math.min(normalizeFiniteNumber(options.padding, 6), width / 2, height / 2));
  const drawableWidth = Math.max(1, width - padding * 2);
  const drawableHeight = Math.max(1, height - padding * 2);

  if (!isRenderableRoutePreview(preview)) {
    return null;
  }

  const decodedSegments = preview.segments
    .filter(segment => isRenderableRoutePreviewSegment(segment))
    .map((segment, index) => ({
      id: `${segment.id || 'segment'}-${index}`,
      label: segment.name || `Segment ${index + 1}`,
      points: decodeRoutePolyline5(segment.encodedPolyline)
        .filter(point => Number.isFinite(point.latitudeDegrees) && Number.isFinite(point.longitudeDegrees)),
    }))
    .filter(segment => segment.points.length >= 2);

  const allPoints = decodedSegments.flatMap(segment => segment.points);
  const bounds = getRoutePreviewCoordinateBounds(allPoints);
  if (!bounds) {
    return null;
  }

  const projectPoint = (point: RoutePreviewCoordinateInterface): RoutePreviewThumbnailPoint => {
    const longitudeSpan = bounds.maxLongitudeDegrees - bounds.minLongitudeDegrees;
    const latitudeSpan = bounds.maxLatitudeDegrees - bounds.minLatitudeDegrees;
    const xRatio = longitudeSpan > 0
      ? (point.longitudeDegrees - bounds.minLongitudeDegrees) / longitudeSpan
      : 0.5;
    const yRatio = latitudeSpan > 0
      ? (bounds.maxLatitudeDegrees - point.latitudeDegrees) / latitudeSpan
      : 0.5;

    return {
      x: roundSvgCoordinate(padding + clamp(xRatio, 0, 1) * drawableWidth),
      y: roundSvgCoordinate(padding + clamp(yRatio, 0, 1) * drawableHeight),
    };
  };

  const paths = decodedSegments.map((segment, index) => ({
    id: segment.id,
    label: segment.label,
    d: buildSvgPolylinePath(segment.points.map(projectPoint)),
    strokeColor: ROUTE_PREVIEW_TRACK_COLORS[index % ROUTE_PREVIEW_TRACK_COLORS.length],
  })).filter(path => path.d.length > 0);

  if (paths.length === 0) {
    return null;
  }

  return {
    viewBox: `0 0 ${width} ${height}`,
    paths,
    startPoint: projectPoint(allPoints[0]),
    endPoint: projectPoint(allPoints[allPoints.length - 1]),
  };
}

function isRenderableRoutePreviewSegment(segment: RoutePreviewSegmentJSONInterface | null | undefined): boolean {
  return !!segment
    && typeof segment.encodedPolyline === 'string'
    && segment.encodedPolyline.length > 0
    && typeof segment.pointCount === 'number'
    && segment.pointCount > 1;
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getRoutePreviewCoordinateBounds(points: readonly RoutePreviewCoordinateInterface[]): {
  minLatitudeDegrees: number;
  maxLatitudeDegrees: number;
  minLongitudeDegrees: number;
  maxLongitudeDegrees: number;
} | null {
  if (points.length === 0) {
    return null;
  }

  return points.reduce((bounds, point) => ({
    minLatitudeDegrees: Math.min(bounds.minLatitudeDegrees, point.latitudeDegrees),
    maxLatitudeDegrees: Math.max(bounds.maxLatitudeDegrees, point.latitudeDegrees),
    minLongitudeDegrees: Math.min(bounds.minLongitudeDegrees, point.longitudeDegrees),
    maxLongitudeDegrees: Math.max(bounds.maxLongitudeDegrees, point.longitudeDegrees),
  }), {
    minLatitudeDegrees: points[0].latitudeDegrees,
    maxLatitudeDegrees: points[0].latitudeDegrees,
    minLongitudeDegrees: points[0].longitudeDegrees,
    maxLongitudeDegrees: points[0].longitudeDegrees,
  });
}

function buildSvgPolylinePath(points: readonly RoutePreviewThumbnailPoint[]): string {
  if (points.length < 2) {
    return '';
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundSvgCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}
