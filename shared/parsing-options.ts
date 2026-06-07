import { ActivityParsingOptions } from '@sports-alliance/sports-lib';

export interface RouteParsingStreamOptionsInput {
  smooth?: {
    altitudeSmooth?: boolean;
    grade?: boolean;
    gradeSmooth?: boolean;
  };
  includeTypes?: string[];
}

export interface RouteParsingOptionsInput {
  streams?: RouteParsingStreamOptionsInput;
  generateUnitStreams?: boolean;
}

export interface RouteParsingOptionsLike {
  streams: {
    smooth: {
      altitudeSmooth?: boolean;
      grade?: boolean;
      gradeSmooth?: boolean;
    };
    includeTypes?: string[];
  };
  generateUnitStreams: boolean;
}

/**
 * Centralized parsing defaults shared by frontend upload/reprocess flows and Firebase Functions.
 */
export function createParsingOptions(
  overrides: Partial<ActivityParsingOptions> = {},
  streamTypes?: string[],
): ActivityParsingOptions {
  const streamOptions =
    streamTypes && streamTypes.length > 0
      ? { streams: { includeTypes: streamTypes } }
      : {};
  return new ActivityParsingOptions({
    generateUnitStreams: false,
    deviceInfoMode: 'changes',
    ...streamOptions,
    ...overrides,
  });
}

/**
 * Centralized route parsing defaults.
 *
 * This intentionally uses a structural type instead of importing RouteParsingOptions
 * so quantified-self can compile until the route-enabled sports-lib package is
 * published. Sports-lib route parsing reads this shape at runtime.
 */
export function createRouteParsingOptions(
  overrides: RouteParsingOptionsInput = {},
  streamTypes?: string[],
): RouteParsingOptionsLike {
  const includeTypes = streamTypes && streamTypes.length > 0
    ? [...streamTypes]
    : overrides.streams?.includeTypes;

  return {
    streams: {
      smooth: {
        altitudeSmooth: overrides.streams?.smooth?.altitudeSmooth ?? true,
        grade: overrides.streams?.smooth?.grade ?? true,
        gradeSmooth: overrides.streams?.smooth?.gradeSmooth ?? true,
      },
      ...(includeTypes ? { includeTypes: [...includeTypes] } : {}),
    },
    generateUnitStreams: overrides.generateUnitStreams ?? false,
  };
}
