import { z } from 'genkit';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import type {
  AiInsightsRequestLocationFilter,
  NormalizedInsightLocationFilter,
} from '../../../../shared/ai-insights.types';
import { aiInsightsGenkit } from './genkit';
import { resolveMapboxAccessToken } from './mapbox-config';

const DEFAULT_LOCATION_RADIUS_KM = 50;
const LOCATION_RADIUS_MIN_KM = 1;
const LOCATION_RADIUS_MAX_KM = 500;
const MAPBOX_FORWARD_GEOCODING_TYPES = 'country,region,place,locality,district,postcode,address';
const MAPBOX_BBOX_FEATURE_TYPES = new Set(['country', 'region']);
const LOCATION_TEXT_MAX_LENGTH = 200;
const DIRECT_COORDINATE_DECIMAL_PLACES = 5;

interface GeocodedLocationResult {
  resolvedLabel: string;
  center: {
    latitudeDegrees: number;
    longitudeDegrees: number;
  };
  preferredMode?: 'bbox' | 'radius';
  bbox?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

interface PromptLocationCandidate {
  requestedText: string;
  radiusKm?: number;
  source: 'input' | 'prompt';
  directCoordinate?: {
    latitudeDegrees: number;
    longitudeDegrees: number;
  };
}

interface InferLocationInput {
  prompt: string;
  failedLocationText: string;
}

export interface ResolveLocationFilterDependencies {
  geocodeLocation: (locationText: string) => Promise<GeocodedLocationResult | null>;
  inferLocationText: (input: InferLocationInput) => Promise<string | null>;
}

export interface ResolveLocationFilterApi {
  resolveLocationFilter: (input: {
    prompt: string;
    requestLocationFilter?: AiInsightsRequestLocationFilter;
    onAiFallbackAttempt?: () => Promise<void> | void;
  }) => Promise<NormalizedInsightLocationFilter | null>;
}

const InferLocationTextSchema = z.object({
  locationText: z.string().trim().min(1).max(LOCATION_TEXT_MAX_LENGTH).optional(),
});

const COORDINATE_PAIR_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|[^\d.+-])(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?=$|[^\d.])/,
  /\blat(?:itude)?\s*[:=]?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]+\s*(?:lng|lon|longitude)\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)(?=$|[^\d.])/i,
];

const LOCATION_WITH_RADIUS_PATTERN =
  /\bwithin\s+(\d{1,3}(?:\.\d+)?)\s*(km|kilometers?|kilometres?|mi|mile|miles)\s+(?:of|around|near)\s+([^,.!?;]+)/i;

const LOCATION_KEYWORD_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:in|near|around|inside)\s+([^,.!?;]+)/i,
];

const LOCATION_TRAILING_STOP_PATTERNS: ReadonlyArray<RegExp> = [
  /\s+(?:for|with|during|over|between|from|across|while|where)\b.*$/i,
  /\s+(?:this|last|past|current|today|yesterday|tomorrow|tonight|ytd)\b.*$/i,
  /\s+(?:day|days|week|weeks|month|months|year|years|quarter|quarters|season|seasons)\b.*$/i,
  /\s+(?:by|per)\s+(?:day|week|month|year|activity|sport|date)\b.*$/i,
];

function normalizeLocationText(value: string | null | undefined): string {
  return `${value || ''}`
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:()/]+|[\s,.;:()/]+$/g, '')
    .trim()
    .slice(0, LOCATION_TEXT_MAX_LENGTH);
}

function clampLocationRadiusKm(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LOCATION_RADIUS_KM;
  }

  return Math.max(
    LOCATION_RADIUS_MIN_KM,
    Math.min(LOCATION_RADIUS_MAX_KM, Math.round(Number(value))),
  );
}

function resolveRadiusKmFromMatch(rawValue: string, rawUnit: string): number {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return DEFAULT_LOCATION_RADIUS_KM;
  }

  const normalizedUnit = rawUnit.trim().toLowerCase();
  const radiusKm = normalizedUnit.startsWith('mi')
    ? numericValue * 1.609344
    : numericValue;
  return clampLocationRadiusKm(radiusKm);
}

function isValidCoordinate(latitudeDegrees: number, longitudeDegrees: number): boolean {
  return Number.isFinite(latitudeDegrees)
    && Number.isFinite(longitudeDegrees)
    && Math.abs(latitudeDegrees) <= 90
    && Math.abs(longitudeDegrees) <= 180;
}

function formatCoordinateLabel(latitudeDegrees: number, longitudeDegrees: number): string {
  return `${latitudeDegrees.toFixed(DIRECT_COORDINATE_DECIMAL_PLACES)}, ${longitudeDegrees.toFixed(DIRECT_COORDINATE_DECIMAL_PLACES)}`;
}

function parseDirectCoordinate(value: string): {
  latitudeDegrees: number;
  longitudeDegrees: number;
} | null {
  for (const pattern of COORDINATE_PAIR_PATTERNS) {
    const match = value.match(pattern);
    if (!match) {
      continue;
    }

    const latitudeDegrees = Number(match[1]);
    const longitudeDegrees = Number(match[2]);
    if (!isValidCoordinate(latitudeDegrees, longitudeDegrees)) {
      continue;
    }

    return {
      latitudeDegrees,
      longitudeDegrees,
    };
  }

  return null;
}

function trimPromptLocationCandidate(value: string): string {
  let normalized = normalizeLocationText(value);
  for (const pattern of LOCATION_TRAILING_STOP_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }

  normalized = normalizeLocationText(normalized);
  if (!normalized) {
    return '';
  }

  if (/^(?:the\s+)?(?:last|past|current|this|today|yesterday|tomorrow|tonight)\b/i.test(normalized)) {
    return '';
  }

  if (/^\d+(?:\.\d+)?(?:\s*(?:km|kilometers?|kilometres?|mi|mile|miles))?$/i.test(normalized)) {
    return '';
  }

  return normalized;
}

function resolvePromptLocationCandidate(
  prompt: string,
  requestLocationFilter?: AiInsightsRequestLocationFilter,
): PromptLocationCandidate | null {
  const explicitLocationText = normalizeLocationText(requestLocationFilter?.locationText);
  const requestedRadiusKm = requestLocationFilter?.radiusKm;

  if (explicitLocationText) {
    const directCoordinate = parseDirectCoordinate(explicitLocationText);
    return {
      requestedText: directCoordinate
        ? formatCoordinateLabel(directCoordinate.latitudeDegrees, directCoordinate.longitudeDegrees)
        : explicitLocationText,
      radiusKm: requestedRadiusKm,
      source: 'input',
      ...(directCoordinate ? { directCoordinate } : {}),
    };
  }

  const directCoordinate = parseDirectCoordinate(prompt);
  if (directCoordinate) {
    return {
      requestedText: formatCoordinateLabel(directCoordinate.latitudeDegrees, directCoordinate.longitudeDegrees),
      radiusKm: requestedRadiusKm,
      source: 'prompt',
      directCoordinate,
    };
  }

  const radiusMatch = prompt.match(LOCATION_WITH_RADIUS_PATTERN);
  if (radiusMatch) {
    const promptLocationText = trimPromptLocationCandidate(radiusMatch[3]);
    if (promptLocationText) {
      return {
        requestedText: promptLocationText,
        radiusKm: requestedRadiusKm ?? resolveRadiusKmFromMatch(radiusMatch[1], radiusMatch[2]),
        source: 'prompt',
      };
    }
  }

  for (const pattern of LOCATION_KEYWORD_PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) {
      continue;
    }

    const promptLocationText = trimPromptLocationCandidate(match[1]);
    if (!promptLocationText) {
      continue;
    }

    return {
      requestedText: promptLocationText,
      radiusKm: requestedRadiusKm,
      source: 'prompt',
    };
  }

  return null;
}

function getMapboxAccessToken(): string {
  const token = resolveMapboxAccessToken();
  if (!token) {
    throw new HttpsError(
      'internal',
      'Location filtering is unavailable because MAPBOX_ACCESS_TOKEN is not configured on the backend.',
    );
  }
  return token;
}

function parseMapboxBoundingBox(rawValue: unknown): GeocodedLocationResult['bbox'] | undefined {
  if (!Array.isArray(rawValue) || rawValue.length !== 4) {
    return undefined;
  }

  const [west, south, east, north] = rawValue.map(value => Number(value));
  if (
    !Number.isFinite(west)
    || !Number.isFinite(south)
    || !Number.isFinite(east)
    || !Number.isFinite(north)
  ) {
    return undefined;
  }

  if (west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || south > 90 || north < -90 || north > 90) {
    return undefined;
  }

  return { west, south, east, north };
}

function normalizeMapboxFeatureTypes(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim().toLowerCase());
}

function resolveMapboxPreferredMode(
  featureTypes: readonly string[],
  bbox: GeocodedLocationResult['bbox'] | undefined,
): 'bbox' | 'radius' {
  if (!bbox) {
    return 'radius';
  }

  return featureTypes.some(featureType => MAPBOX_BBOX_FEATURE_TYPES.has(featureType))
    ? 'bbox'
    : 'radius';
}

const defaultResolveLocationFilterDependencies: ResolveLocationFilterDependencies = {
  geocodeLocation: async (locationText) => {
    const accessToken = getMapboxAccessToken();
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationText)}.json?limit=1&autocomplete=false&types=${MAPBOX_FORWARD_GEOCODING_TYPES}&access_token=${accessToken}`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new HttpsError(
          'internal',
          'Location filtering is unavailable because the configured Mapbox token was rejected.',
        );
      }

      if (response.status === 429) {
        throw new HttpsError(
          'unavailable',
          'Location filtering is temporarily unavailable because Mapbox rate limiting was reached.',
        );
      }

      throw new HttpsError(
        'unavailable',
        `Location filtering is temporarily unavailable because Mapbox geocoding returned ${response.status}.`,
      );
    }

    const payload = await response.json() as {
      features?: Array<{
        center?: [number, number];
        place_name?: string;
        text?: string;
        bbox?: unknown;
        place_type?: unknown;
      }>;
    };
    const feature = Array.isArray(payload.features) ? payload.features[0] : null;
    if (!feature) {
      return null;
    }

    const longitudeDegrees = Number(feature.center?.[0]);
    const latitudeDegrees = Number(feature.center?.[1]);
    if (!isValidCoordinate(latitudeDegrees, longitudeDegrees)) {
      return null;
    }

    const bbox = parseMapboxBoundingBox(feature.bbox);
    const featureTypes = normalizeMapboxFeatureTypes(feature.place_type);

    return {
      resolvedLabel: normalizeLocationText(feature.place_name || feature.text || locationText) || locationText,
      center: {
        latitudeDegrees,
        longitudeDegrees,
      },
      preferredMode: resolveMapboxPreferredMode(featureTypes, bbox),
      bbox,
    };
  },
  inferLocationText: async (input) => {
    const { output } = await aiInsightsGenkit.generate({
      system: [
        'You normalize fitness insight location filters into one concrete place name or coordinates.',
        'Use the prompt and failed candidate as hints.',
        'Return a single city, region, country, or coordinate pair only when it is clear.',
        'Do not explain your reasoning.',
        'Return no locationText when the location is unclear.',
      ].join(' '),
      prompt: JSON.stringify(input),
      output: { schema: InferLocationTextSchema },
    });

    return normalizeLocationText(output?.locationText);
  },
};

function buildResolvedLocationFilter(params: {
  requestedText: string;
  effectiveText: string;
  source: NormalizedInsightLocationFilter['source'];
  radiusKm: number;
  geocodedResult?: GeocodedLocationResult;
  directCoordinate?: {
    latitudeDegrees: number;
    longitudeDegrees: number;
  };
}): NormalizedInsightLocationFilter {
  if (params.directCoordinate) {
    return {
      requestedText: params.requestedText,
      effectiveText: params.effectiveText,
      resolvedLabel: params.effectiveText,
      source: params.source,
      mode: 'radius',
      radiusKm: params.radiusKm,
      center: params.directCoordinate,
    };
  }

  if (!params.geocodedResult) {
    throw new Error('Expected either a geocoded result or a direct coordinate.');
  }

  const mode = params.geocodedResult.preferredMode
    ?? (params.geocodedResult.bbox ? 'bbox' : 'radius');

  return {
    requestedText: params.requestedText,
    effectiveText: params.effectiveText,
    resolvedLabel: params.geocodedResult.resolvedLabel,
    source: params.source,
    mode,
    radiusKm: params.radiusKm,
    center: params.geocodedResult.center,
    ...(mode === 'bbox' && params.geocodedResult.bbox ? { bbox: params.geocodedResult.bbox } : {}),
  };
}

export function createResolveLocationFilter(
  dependencies: Partial<ResolveLocationFilterDependencies> = {},
): ResolveLocationFilterApi {
  const resolvedDependencies: ResolveLocationFilterDependencies = {
    ...defaultResolveLocationFilterDependencies,
    ...dependencies,
  };

  return {
    resolveLocationFilter: async ({
      prompt,
      requestLocationFilter,
      onAiFallbackAttempt,
    }): Promise<NormalizedInsightLocationFilter | null> => {
      const candidate = resolvePromptLocationCandidate(prompt, requestLocationFilter);
      if (!candidate) {
        return null;
      }

      const radiusKm = clampLocationRadiusKm(candidate.radiusKm);
      if (candidate.directCoordinate) {
        return buildResolvedLocationFilter({
          requestedText: candidate.requestedText,
          effectiveText: candidate.requestedText,
          source: candidate.source,
          radiusKm,
          directCoordinate: candidate.directCoordinate,
        });
      }

      const initialGeocodeResult = await resolvedDependencies.geocodeLocation(candidate.requestedText);
      if (initialGeocodeResult) {
        return buildResolvedLocationFilter({
          requestedText: candidate.requestedText,
          effectiveText: candidate.requestedText,
          source: candidate.source,
          radiusKm,
          geocodedResult: initialGeocodeResult,
        });
      }

      await onAiFallbackAttempt?.();
      const fallbackLocationText = normalizeLocationText(
        await resolvedDependencies.inferLocationText({
          prompt,
          failedLocationText: candidate.requestedText,
        }),
      );

      if (!fallbackLocationText || fallbackLocationText === candidate.requestedText) {
        throw new HttpsError(
          'invalid-argument',
          `Could not resolve the location "${candidate.requestedText}". Try a city, region, country, or coordinates.`,
        );
      }

      const fallbackCoordinate = parseDirectCoordinate(fallbackLocationText);
      if (fallbackCoordinate) {
        logger.info('[aiInsights] Resolved location filter from AI fallback coordinates', {
          requestedText: candidate.requestedText,
          effectiveText: fallbackLocationText,
        });
        return buildResolvedLocationFilter({
          requestedText: candidate.requestedText,
          effectiveText: formatCoordinateLabel(
            fallbackCoordinate.latitudeDegrees,
            fallbackCoordinate.longitudeDegrees,
          ),
          source: 'ai_fallback',
          radiusKm,
          directCoordinate: fallbackCoordinate,
        });
      }

      const fallbackGeocodeResult = await resolvedDependencies.geocodeLocation(fallbackLocationText);
      if (fallbackGeocodeResult) {
        logger.info('[aiInsights] Resolved location filter from AI fallback geocoding', {
          requestedText: candidate.requestedText,
          effectiveText: fallbackLocationText,
          resolvedLabel: fallbackGeocodeResult.resolvedLabel,
        });
        return buildResolvedLocationFilter({
          requestedText: candidate.requestedText,
          effectiveText: fallbackLocationText,
          source: 'ai_fallback',
          radiusKm,
          geocodedResult: fallbackGeocodeResult,
        });
      }

      throw new HttpsError(
        'invalid-argument',
        `Could not resolve the location "${candidate.requestedText}". Try a city, region, country, or coordinates.`,
      );
    },
  };
}

const resolveLocationFilterRuntime = createResolveLocationFilter();

export async function resolveLocationFilter(input: {
  prompt: string;
  requestLocationFilter?: AiInsightsRequestLocationFilter;
  onAiFallbackAttempt?: () => Promise<void> | void;
}): Promise<NormalizedInsightLocationFilter | null> {
  return resolveLocationFilterRuntime.resolveLocationFilter(input);
}
