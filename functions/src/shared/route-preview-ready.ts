import { FirestoreRouteJSON } from '../../../shared/app-route.interface';

export function isRoutePreviewReady(preview: FirestoreRouteJSON['preview'] | null): boolean {
  return !!preview
    && preview.version === 1
    && preview.encoding === 'polyline5'
    && preview.precision === 5
    && typeof preview.pointCount === 'number'
    && preview.pointCount > 0
    && Array.isArray(preview.segments)
    && preview.segments.some(segment => (
      typeof segment?.encodedPolyline === 'string'
      && segment.encodedPolyline.length > 0
      && typeof segment.pointCount === 'number'
      && segment.pointCount > 1
    ));
}
