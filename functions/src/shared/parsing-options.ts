import { ActivityParsingOptions } from '@sports-alliance/sports-lib';

/**
 * Centralized parsing defaults for Firebase Functions.
 * Keep this helper as the single source of truth for queue/import parsing options.
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
