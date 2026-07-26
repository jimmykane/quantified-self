import fetch, { Response } from 'node-fetch';

const MAPBOX_FORWARD_GEOCODING_URL =
  'https://api.mapbox.com/search/geocode/v6/forward';
const MAPBOX_FORWARD_GEOCODING_TYPES = [
  'country',
  'region',
  'place',
  'locality',
  'district',
  'postcode',
  'address',
].join(',');
const MAPBOX_QUERY_MAX_CHARACTERS = 200;
const MAPBOX_QUERY_MAX_WORDS = 20;
const MAPBOX_RESPONSE_MAX_BYTES = 64 * 1024;
const MAPBOX_TIMEOUT_MS = 5_000;

export type MapboxGeocodingErrorCode =
  | 'invalid_query'
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'not_found'
  | 'unavailable';

export class MapboxGeocodingError extends Error {
  constructor(
    readonly code: MapboxGeocodingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MapboxGeocodingError';
  }
}

export interface MapboxForwardGeocodingResult {
  resolvedLabel: string;
  center: {
    latitudeDegrees: number;
    longitudeDegrees: number;
  };
  featureType: string | null;
  bbox?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

interface MapboxFetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export interface MapboxForwardGeocoderDependencies {
  accessToken: () => string;
  fetch: (
    url: string,
    options: {
      signal: AbortSignal;
      size: number;
    },
  ) => Promise<MapboxFetchResponse>;
  createAbortController: () => AbortController;
  setTimeout: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void;
}

const defaultDependencies: MapboxForwardGeocoderDependencies = {
  accessToken: () => `${process.env.MAPBOX_ACCESS_TOKEN || ''}`.trim(),
  fetch: (url, options) => fetch(url, options) as Promise<Response>,
  createAbortController: () => new AbortController(),
  setTimeout,
  clearTimeout,
};

export async function forwardGeocodeMapbox(
  rawQuery: string,
  dependencies: Partial<MapboxForwardGeocoderDependencies> = {},
): Promise<MapboxForwardGeocodingResult> {
  const resolvedDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const query = normalizeMapboxQuery(rawQuery);
  const accessToken = resolvedDependencies.accessToken();
  if (!accessToken) {
    throw new MapboxGeocodingError(
      'not_configured',
      'Mapbox geocoding is not configured.',
    );
  }

  const endpoint = new URL(MAPBOX_FORWARD_GEOCODING_URL);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('access_token', accessToken);
  endpoint.searchParams.set('autocomplete', 'false');
  endpoint.searchParams.set('limit', '1');
  endpoint.searchParams.set('types', MAPBOX_FORWARD_GEOCODING_TYPES);

  const abortController = resolvedDependencies.createAbortController();
  const timeout = resolvedDependencies.setTimeout(
    () => abortController.abort(),
    MAPBOX_TIMEOUT_MS,
  );
  try {
    const response = await resolvedDependencies.fetch(endpoint.toString(), {
      signal: abortController.signal,
      size: MAPBOX_RESPONSE_MAX_BYTES,
    });
    if (!response.ok) {
      throw mapMapboxStatusToError(response.status);
    }
    const rawPayload = await response.text();
    if (Buffer.byteLength(rawPayload, 'utf8') > MAPBOX_RESPONSE_MAX_BYTES) {
      throw new MapboxGeocodingError(
        'unavailable',
        'Mapbox geocoding returned an oversized response.',
      );
    }
    return parseMapboxForwardGeocodingResponse(rawPayload);
  } catch (error) {
    if (error instanceof MapboxGeocodingError) {
      throw error;
    }
    throw new MapboxGeocodingError(
      'unavailable',
      error instanceof Error && error.name === 'AbortError'
        ? 'Mapbox geocoding timed out.'
        : 'Mapbox geocoding is temporarily unavailable.',
    );
  } finally {
    resolvedDependencies.clearTimeout(timeout);
  }
}

export function normalizeMapboxQuery(rawQuery: string): string {
  const query = `${rawQuery || ''}`.replace(/\s+/g, ' ').trim();
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  if (
    !query
    || query.length > MAPBOX_QUERY_MAX_CHARACTERS
    || wordCount > MAPBOX_QUERY_MAX_WORDS
  ) {
    throw new MapboxGeocodingError(
      'invalid_query',
      'Location text must contain 1–20 words and at most 200 characters.',
    );
  }
  return query;
}

function parseMapboxForwardGeocodingResponse(
  rawPayload: string,
): MapboxForwardGeocodingResult {
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new MapboxGeocodingError(
      'unavailable',
      'Mapbox geocoding returned an invalid response.',
    );
  }
  const features = payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Array.isArray((payload as Record<string, unknown>).features)
    ? (payload as { features: unknown[] }).features
    : [];
  const feature = features[0];
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
    throw new MapboxGeocodingError(
      'not_found',
      'The location could not be resolved.',
    );
  }

  const featureRecord = feature as Record<string, unknown>;
  const geometry = asRecord(featureRecord.geometry);
  const coordinates = Array.isArray(geometry?.coordinates)
    ? geometry.coordinates
    : [];
  const longitudeDegrees = Number(coordinates[0]);
  const latitudeDegrees = Number(coordinates[1]);
  if (!isValidCoordinate(latitudeDegrees, longitudeDegrees)) {
    throw new MapboxGeocodingError(
      'unavailable',
      'Mapbox geocoding returned invalid coordinates.',
    );
  }

  const properties = asRecord(featureRecord.properties) || {};
  const resolvedLabel = firstNonEmptyString([
    properties.full_address,
    joinMapboxLabel(properties.name_preferred || properties.name, properties.place_formatted),
    properties.name_preferred,
    properties.name,
  ]);
  if (!resolvedLabel) {
    throw new MapboxGeocodingError(
      'unavailable',
      'Mapbox geocoding returned an invalid label.',
    );
  }

  const bbox = parseBoundingBox(featureRecord.bbox || properties.bbox);
  return {
    resolvedLabel,
    center: {
      latitudeDegrees,
      longitudeDegrees,
    },
    featureType: firstNonEmptyString([properties.feature_type])?.toLowerCase() || null,
    ...(bbox ? { bbox } : {}),
  };
}

function mapMapboxStatusToError(status: number): MapboxGeocodingError {
  if (status === 401 || status === 403) {
    return new MapboxGeocodingError(
      'unauthorized',
      'The configured Mapbox token was rejected.',
    );
  }
  if (status === 429) {
    return new MapboxGeocodingError(
      'rate_limited',
      'Mapbox geocoding is temporarily rate limited.',
    );
  }
  return new MapboxGeocodingError(
    'unavailable',
    'Mapbox geocoding is temporarily unavailable.',
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 240);
    }
  }
  return null;
}

function joinMapboxLabel(name: unknown, place: unknown): string | null {
  const normalizedName = firstNonEmptyString([name]);
  const normalizedPlace = firstNonEmptyString([place]);
  return [normalizedName, normalizedPlace].filter(Boolean).join(', ') || null;
}

function parseBoundingBox(value: unknown): MapboxForwardGeocodingResult['bbox'] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const [west, south, east, north] = value.map(Number);
  if (
    !isValidCoordinate(south, west)
    || !isValidCoordinate(north, east)
    || south > north
  ) {
    return undefined;
  }
  return { west, south, east, north };
}

function isValidCoordinate(latitudeDegrees: number, longitudeDegrees: number): boolean {
  return Number.isFinite(latitudeDegrees)
    && Number.isFinite(longitudeDegrees)
    && Math.abs(latitudeDegrees) <= 90
    && Math.abs(longitudeDegrees) <= 180;
}
