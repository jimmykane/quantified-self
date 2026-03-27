import { ensureLayer, removeLayerIfExists, removeSourceIfExists, setPaintIfLayerExists, upsertGeoJsonSource } from './mapbox-layer.utils';
import { MapboxLikeMap } from './mapbox-style-ready.utils';

export interface MapSearchScopeCoordinate {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface MapSearchScopeBoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapSearchScopeRadius {
  mode: 'radius';
  center: MapSearchScopeCoordinate;
  radiusKm: number;
}

export interface MapSearchScopeBbox {
  mode: 'bbox';
  bbox: MapSearchScopeBoundingBox;
}

export type MapSearchScope = MapSearchScopeRadius | MapSearchScopeBbox;

export interface MapSearchScopeOverlayConfig {
  sourceId: string;
  fillLayerId: string;
  outlineLayerId: string;
  featureCollection: { type: 'FeatureCollection'; features: any[] };
  fillPaint: Record<string, any>;
  outlinePaint: Record<string, any>;
  beforeLayerId?: string;
}

const EARTH_RADIUS_KM = 6371.0088;
const CIRCLE_STEPS = 48;

export function buildMapSearchScopeOverlayFeatureCollection(
  scope: MapSearchScope | null | undefined,
  featureProperties: Record<string, unknown> = {}
): { type: 'FeatureCollection'; features: any[] } | null {
  if (!isValidMapSearchScope(scope)) {
    return null;
  }

  const geometry = scope.mode === 'radius'
    ? {
      type: 'Polygon' as const,
      coordinates: [[
        ...buildGeodesicCircleCoordinates(
          scope.center.longitudeDegrees,
          scope.center.latitudeDegrees,
          scope.radiusKm,
          CIRCLE_STEPS
        ),
      ]],
    }
    : buildBoundingBoxGeometry(scope.bbox);

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        mode: scope.mode,
        ...featureProperties,
      },
      geometry,
    }],
  };
}

export function resolveMapSearchScopeFitCoordinates(scope: MapSearchScope | null | undefined): [number, number][] {
  if (!isValidMapSearchScope(scope)) {
    return [];
  }

  if (scope.mode === 'radius') {
    const center: [number, number] = [
      scope.center.longitudeDegrees,
      scope.center.latitudeDegrees,
    ];
    const ring = buildGeodesicCircleCoordinates(
      center[0],
      center[1],
      scope.radiusKm,
      Math.max(24, Math.floor(CIRCLE_STEPS / 2))
    );
    return [center, ...ring];
  }

  const geometry = buildBoundingBoxGeometry(scope.bbox);
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] as [number, number][];
  }

  return geometry.coordinates.flatMap((polygon) => polygon[0] as [number, number][]);
}

export function upsertMapSearchScopeOverlay(
  map: MapboxLikeMap | null | undefined,
  config: MapSearchScopeOverlayConfig
): void {
  if (!map || !config?.featureCollection?.features?.length) {
    return;
  }

  upsertGeoJsonSource(map, config.sourceId, config.featureCollection);

  ensureLayer(map, {
    id: config.fillLayerId,
    type: 'fill',
    source: config.sourceId,
    paint: config.fillPaint,
  }, config.beforeLayerId);

  ensureLayer(map, {
    id: config.outlineLayerId,
    type: 'line',
    source: config.sourceId,
    paint: config.outlinePaint,
  }, config.beforeLayerId);

  setPaintIfLayerExists(map, config.fillLayerId, config.fillPaint);
  setPaintIfLayerExists(map, config.outlineLayerId, config.outlinePaint);
}

export function removeMapSearchScopeOverlay(
  map: MapboxLikeMap | null | undefined,
  sourceId: string,
  fillLayerId: string,
  outlineLayerId: string
): void {
  if (!map) {
    return;
  }

  removeLayerIfExists(map, outlineLayerId);
  removeLayerIfExists(map, fillLayerId);
  removeSourceIfExists(map, sourceId);
}

function isValidMapSearchScope(scope: MapSearchScope | null | undefined): scope is MapSearchScope {
  if (!scope || typeof scope !== 'object') {
    return false;
  }

  if (scope.mode === 'radius') {
    const center = scope.center;
    if (!center || !isValidLatitude(center.latitudeDegrees) || !isValidLongitude(center.longitudeDegrees)) {
      return false;
    }
    return Number.isFinite(scope.radiusKm) && scope.radiusKm > 0;
  }

  if (scope.mode === 'bbox') {
    return isValidBoundingBox(scope.bbox);
  }

  return false;
}

function isValidBoundingBox(bbox: MapSearchScopeBoundingBox | null | undefined): bbox is MapSearchScopeBoundingBox {
  if (!bbox) {
    return false;
  }

  return isValidLongitude(bbox.west)
    && isValidLongitude(bbox.east)
    && isValidLatitude(bbox.south)
    && isValidLatitude(bbox.north)
    && bbox.south <= bbox.north;
}

function isValidLatitude(value: unknown): value is number {
  return Number.isFinite(value) && Math.abs(value as number) <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return Number.isFinite(value) && Math.abs(value as number) <= 180;
}

function buildBoundingBoxGeometry(
  bbox: MapSearchScopeBoundingBox
): { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] } {
  if (bbox.west <= bbox.east) {
    return {
      type: 'Polygon',
      coordinates: [buildRectangleRing(bbox.west, bbox.south, bbox.east, bbox.north)],
    };
  }

  // Wrapped anti-meridian interval: split into two polygons.
  return {
    type: 'MultiPolygon',
    coordinates: [
      [buildRectangleRing(bbox.west, bbox.south, 180, bbox.north)],
      [buildRectangleRing(-180, bbox.south, bbox.east, bbox.north)],
    ],
  };
}

function buildRectangleRing(west: number, south: number, east: number, north: number): number[][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

function buildGeodesicCircleCoordinates(
  centerLng: number,
  centerLat: number,
  radiusKm: number,
  steps: number
): [number, number][] {
  const angularDistance = radiusKm / EARTH_RADIUS_KM;
  const centerLatRad = toRadians(centerLat);
  const centerLngRad = toRadians(centerLng);
  const coordinates: [number, number][] = [];

  for (let step = 0; step <= steps; step += 1) {
    const bearing = (2 * Math.PI * step) / steps;
    const latitudeRad = Math.asin(
      Math.sin(centerLatRad) * Math.cos(angularDistance)
      + Math.cos(centerLatRad) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const longitudeRad = centerLngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLatRad),
      Math.cos(angularDistance) - Math.sin(centerLatRad) * Math.sin(latitudeRad)
    );

    coordinates.push([
      normalizeLongitude(toDegrees(longitudeRad)),
      toDegrees(latitudeRad),
    ]);
  }

  return coordinates;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeLongitude(value: number): number {
  return ((((value + 540) % 360) + 360) % 360) - 180;
}
