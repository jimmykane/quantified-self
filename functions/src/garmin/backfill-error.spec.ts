import { describe, expect, it } from 'vitest';
import {
  extractGarminBackfillMinimumStartMs,
  getGarminBackfillStatusCode,
  isGarminBackfillMinimumStartError,
} from './backfill-error';

describe('Garmin backfill errors', () => {
  it('extracts a nested second-based minimum start', () => {
    const error = {
      statusCode: 400,
      error: { details: { minStartTimeInSeconds: 1_700_000_000 } },
    };

    expect(extractGarminBackfillMinimumStartMs(error)).toBe(1_700_000_000_000);
    expect(isGarminBackfillMinimumStartError(error)).toBe(true);
  });

  it('extracts an ISO minimum start from provider text', () => {
    const error = Object.assign(new Error(
      'The requested range is earlier than minimum start time 2024-01-02T00:00:00Z',
    ), { statusCode: 400 });

    expect(extractGarminBackfillMinimumStartMs(error)).toBe(Date.parse('2024-01-02T00:00:00Z'));
  });

  it('does not classify unrelated bad requests as minimum-start errors', () => {
    expect(isGarminBackfillMinimumStartError({ statusCode: 400, error: 'invalid family' }))
      .toBe(false);
    expect(getGarminBackfillStatusCode({ statusCode: 429 })).toBe(429);
  });
});
