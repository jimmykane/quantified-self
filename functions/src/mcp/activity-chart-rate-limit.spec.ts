import { describe, expect, it, vi } from 'vitest';
import {
  buildActivityChartRateLimitBucketId,
  consumeActivityChartRateLimit,
  McpActivityChartRateLimitError,
} from './activity-chart-rate-limit';

describe('MCP activity chart rate limit', () => {
  it('uses separate opaque connection and user buckets', () => {
    const connection = buildActivityChartRateLimitBucketId(
      'connection',
      'user-1',
      'connection-1',
      60_000,
    );
    const user = buildActivityChartRateLimitBucketId(
      'user',
      'user-1',
      'connection-1',
      60_000,
    );
    expect(connection).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(user).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(connection).not.toBe(user);
    expect(user).toBe(buildActivityChartRateLimitBucketId(
      'user',
      'user-1',
      'another-connection',
      60_000,
    ));
  });

  it('atomically enforces six per connection and twelve per user with TTL metadata', async () => {
    const references = ['connection-counter', 'user-counter'];
    const counts = new Map<string, number>([
      [references[0], 5],
      [references[1], 11],
    ]);
    const set = vi.fn();
    const dependencies = {
      now: () => 75_000,
      document: vi.fn()
        .mockReturnValueOnce(references[0])
        .mockReturnValueOnce(references[1]),
      timestampFromMillis: vi.fn(value => `timestamp:${value}`),
      runTransaction: async (
        operation: (transaction: {
          get: (reference: string) => Promise<{
            exists: boolean;
            data: () => { count: number };
          }>;
          set: typeof set;
          assertUserAvailable: (uid: string, nowMs: number) => Promise<void>;
        }) => Promise<void>,
      ) => operation({
        get: async reference => ({
          exists: true,
          data: () => ({ count: counts.get(reference) || 0 }),
        }),
        set,
        assertUserAvailable: vi.fn().mockResolvedValue(undefined),
      }),
    };

    await consumeActivityChartRateLimit('user-1', 'connection-1', dependencies);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({
        rateLimitType: 'activity_chart',
        subjectKind: 'connection',
        count: 6,
        expireAt: 'timestamp:360000',
      }),
      expect.objectContaining({
        rateLimitType: 'activity_chart',
        subjectKind: 'user',
        count: 12,
        expireAt: 'timestamp:360000',
      }),
    ]);
    expect(JSON.stringify(set.mock.calls)).not.toContain('user-1');
    expect(JSON.stringify(set.mock.calls)).not.toContain('connection-1');
  });

  it.each([
    ['connection-counter', 6, 1],
    ['user-counter', 1, 12],
  ])(
    'rejects an over-limit %s without writing either counter',
    async (_limitedCounter, connectionCount, userCount) => {
      const set = vi.fn();
      const dependencies = {
        now: () => 75_000,
        document: vi.fn()
          .mockReturnValueOnce('connection-counter')
          .mockReturnValueOnce('user-counter'),
        timestampFromMillis: vi.fn(),
        runTransaction: async (
          operation: (transaction: {
            get: (reference: string) => Promise<{
              exists: boolean;
              data: () => { count: number };
            }>;
            set: typeof set;
            assertUserAvailable: () => Promise<void>;
          }) => Promise<void>,
        ) => operation({
          get: async reference => ({
            exists: true,
            data: () => ({
              count: reference === 'connection-counter'
                ? connectionCount
                : userCount,
            }),
          }),
          set,
          assertUserAvailable: vi.fn().mockResolvedValue(undefined),
        }),
      };
      await expect(consumeActivityChartRateLimit(
        'user-1',
        'connection-1',
        dependencies,
      )).rejects.toBeInstanceOf(McpActivityChartRateLimitError);
      expect(set).not.toHaveBeenCalled();
    },
  );
});
