import {
  decodeRoutePolyline5,
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

export function buildRoutePreviewMapTracks(routes: readonly FirestoreRouteJSON[] | null | undefined): TrackMapRenderData[] {
  let segmentIndex = 0;
  return (routes || []).flatMap((route, routeIndex) => {
    if (!isRenderableRoutePreview(route.preview)) {
      return [];
    }

    return route.preview.segments
      .filter(segment => isRenderableRoutePreviewSegment(segment))
      .map<TrackMapRenderData | null>((segment, routeSegmentIndex) => {
        const decodedPositions = decodeRoutePolyline5(segment.encodedPolyline)
          .filter(point => Number.isFinite(point.latitudeDegrees) && Number.isFinite(point.longitudeDegrees));
        if (decodedPositions.length < 2) {
          return null;
        }

        const color = ROUTE_PREVIEW_TRACK_COLORS[segmentIndex % ROUTE_PREVIEW_TRACK_COLORS.length];
        segmentIndex += 1;
        return {
          id: `${route.id || `route-${routeIndex}`}-${segment.id || routeSegmentIndex}`,
          label: segment.name || route.name || 'Route',
          strokeColor: color,
          positions: decodedPositions,
        };
      })
      .filter((track): track is TrackMapRenderData => track !== null);
  });
}

function isRenderableRoutePreviewSegment(segment: RoutePreviewSegmentJSONInterface | null | undefined): boolean {
  return !!segment
    && typeof segment.encodedPolyline === 'string'
    && segment.encodedPolyline.length > 0
    && typeof segment.pointCount === 'number'
    && segment.pointCount > 1;
}
