import { describe, expect, it, vi } from 'vitest';
import {
  buildMcpGeocodingRateLimitBucketId,
  consumeMcpGeocodingRateLimit,
  McpGeocodingRateLimitError,
} from './geocoding-rate-limit';

describe('MCP geocoding rate limit', () => {
  it('uses an opaque bucket scoped to the user, connection, and minute', () => {
    const first = buildMcpGeocodingRateLimitBucketId('user-1', 'connection-1', 60_000);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).toBe(buildMcpGeocodingRateLimitBucketId(
      'user-1',
      'connection-1',
      60_000,
    ));
    expect(first).not.toBe(buildMcpGeocodingRateLimitBucketId(
      'user-1',
      'connection-2',
      60_000,
    ));
  });

  it('writes cleanup metadata and rejects the thirty-first lookup', async () => {
    const set = vi.fn();
    const count = { value: 29 };
    const dependencies = {
      now: () => 75_000,
      document: vi.fn().mockReturnValue('rate-limit-document'),
      timestampFromMillis: vi.fn(value => `timestamp:${value}`),
      runTransaction: async (
        operation: (transaction: {
          get: () => Promise<{ exists: boolean; data: () => { count: number } }>;
          set: typeof set;
        }) => Promise<void>,
      ) => operation({
        get: async () => ({
          exists: true,
          data: () => ({ count: count.value }),
        }),
        set,
      }),
    };

    await consumeMcpGeocodingRateLimit(
      'user-1',
      'connection-1',
      dependencies,
    );
    expect(set).toHaveBeenCalledWith('rate-limit-document', {
      uid: 'user-1',
      connectionId: 'connection-1',
      rateLimitType: 'geocoding',
      windowStartMs: 60_000,
      count: 30,
      expireAt: 'timestamp:360000',
    });

    count.value = 30;
    await expect(consumeMcpGeocodingRateLimit(
      'user-1',
      'connection-1',
      dependencies,
    )).rejects.toBeInstanceOf(McpGeocodingRateLimitError);
  });
});
