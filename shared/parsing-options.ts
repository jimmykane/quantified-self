import { ActivityParsingOptions } from '@sports-alliance/sports-lib';

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
