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
    const assertUserAvailable = vi.fn().mockResolvedValue(undefined);
    const count = { value: 29 };
    const dependencies = {
      now: () => 75_000,
      document: vi.fn().mockReturnValue('rate-limit-document'),
      timestampFromMillis: vi.fn(value => `timestamp:${value}`),
      runTransaction: async (
        operation: (transaction: {
          get: () => Promise<{ exists: boolean; data: () => { count: number } }>;
          set: typeof set;
          assertUserAvailable: typeof assertUserAvailable;
        }) => Promise<void>,
      ) => operation({
        get: async () => ({
          exists: true,
          data: () => ({ count: count.value }),
        }),
        set,
        assertUserAvailable,
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
    expect(assertUserAvailable).toHaveBeenCalledWith('user-1', 75_000);

    count.value = 30;
    await expect(consumeMcpGeocodingRateLimit(
      'user-1',
      'connection-1',
      dependencies,
    )).rejects.toBeInstanceOf(McpGeocodingRateLimitError);
  });

  it('does not read or write a counter after account deletion begins', async () => {
    const get = vi.fn();
    const set = vi.fn();
    const unavailable = new Error('account unavailable');
    const dependencies = {
      now: () => 75_000,
      document: vi.fn().mockReturnValue('rate-limit-document'),
      timestampFromMillis: vi.fn(),
      runTransaction: async (
        operation: (transaction: {
          get: typeof get;
          set: typeof set;
          assertUserAvailable: () => Promise<void>;
        }) => Promise<void>,
      ) => operation({
        get,
        set,
        assertUserAvailable: vi.fn().mockRejectedValue(unavailable),
      }),
    };

    await expect(consumeMcpGeocodingRateLimit(
      'user-1',
      'connection-1',
      dependencies,
    )).rejects.toBe(unavailable);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
