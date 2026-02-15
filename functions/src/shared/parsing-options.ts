import { ActivityParsingOptions } from '@sports-alliance/sports-lib';

/**
 * Centralized parsing defaults for Firebase Functions.
 * Keep this helper as the single source of truth for queue/import parsing options.
 */
export function createParsingOptions(
  overrides: Partial<ActivityParsingOptions> = {},
): ActivityParsingOptions {
  return new ActivityParsingOptions({
    generateUnitStreams: false,
    deviceInfoMode: 'changes',
    ...overrides,
  });
}
