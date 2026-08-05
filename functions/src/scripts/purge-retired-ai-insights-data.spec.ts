import { describe, expect, it, vi } from 'vitest';
import {
  RETIRED_AI_INSIGHTS_COLLECTION_GROUPS,
  parseRetiredAiInsightsPurgeArgs,
  purgeRetiredAiInsightsData,
} from './purge-retired-ai-insights-data';

type RetiredCollectionGroup = typeof RETIRED_AI_INSIGHTS_COLLECTION_GROUPS[number];

function createFakeFirestore(initialPaths: Partial<Record<RetiredCollectionGroup, string[]>>) {
  const remainingPaths = Object.fromEntries(
    RETIRED_AI_INSIGHTS_COLLECTION_GROUPS.map(collectionGroup => [
      collectionGroup,
      [...(initialPaths[collectionGroup] ?? [])],
    ]),
  ) as Record<RetiredCollectionGroup, string[]>;
  const close = vi.fn().mockResolvedValue(undefined);
  const onWriteError = vi.fn();
  const bulkWriter = vi.fn(() => ({ close, onWriteError }));
  const recursiveDelete = vi.fn(async (ref: { path: string }) => {
    for (const collectionGroup of RETIRED_AI_INSIGHTS_COLLECTION_GROUPS) {
      remainingPaths[collectionGroup] = remainingPaths[collectionGroup]
        .filter(path => path !== ref.path);
    }
  });
  const getBatch = vi.fn(async (
    collectionGroup: RetiredCollectionGroup,
    batchSize: number,
  ) => {
    const paths = remainingPaths[collectionGroup].slice(0, batchSize);
    const docs = paths.map(path => ({ ref: { path } }));
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
    };
  });
  const getCount = vi.fn(async (collectionGroup: RetiredCollectionGroup) => ({
    data: () => ({ count: remainingPaths[collectionGroup].length }),
  }));
  const collectionGroup = vi.fn((collectionGroupId: RetiredCollectionGroup) => ({
    count: () => ({ get: () => getCount(collectionGroupId) }),
    limit: (batchSize: number) => ({
      get: () => getBatch(collectionGroupId, batchSize),
    }),
  }));

  return {
    db: {
      bulkWriter,
      collectionGroup,
      recursiveDelete,
    },
    bulkWriter,
    close,
    collectionGroup,
    getBatch,
    getCount,
    onWriteError,
    recursiveDelete,
  };
}

describe('retired AI Insights data purge', () => {
  it('defaults to a count-only dry run for every retired collection group', async () => {
    const fake = createFakeFirestore({
      aiInsightsRequests: ['users/user-1/aiInsightsRequests/latest'],
      aiInsightsUsage: [
        'users/user-1/aiInsightsUsage/period-1',
        'users/user-2/aiInsightsUsage/period-2',
      ],
      aiInsightsPromptRepairs: ['aiInsightsPromptRepairs/historical-repair'],
    });
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(purgeRetiredAiInsightsData({
      db: fake.db as never,
      logger,
    })).resolves.toEqual({
      found: {
        aiInsightsRequests: 1,
        aiInsightsUsage: 2,
        aiInsightsPromptRepairs: 1,
      },
      deleted: {
        aiInsightsRequests: 0,
        aiInsightsUsage: 0,
        aiInsightsPromptRepairs: 0,
      },
      remaining: {
        aiInsightsRequests: 1,
        aiInsightsUsage: 2,
        aiInsightsPromptRepairs: 1,
      },
    });

    expect(fake.collectionGroup.mock.calls.map(([collectionGroup]) => collectionGroup))
      .toEqual(RETIRED_AI_INSIGHTS_COLLECTION_GROUPS);
    expect(fake.getBatch).not.toHaveBeenCalled();
    expect(fake.bulkWriter).not.toHaveBeenCalled();
    expect(fake.recursiveDelete).not.toHaveBeenCalled();
  });

  it('recursively drains every retired collection group in bounded batches', async () => {
    const requestPaths = Array.from(
      { length: 5 },
      (_, index) => `users/user-${index + 1}/aiInsightsRequests/latest`,
    );
    const usagePath = 'users/user-1/aiInsightsUsage/period-1';
    const repairPath = 'aiInsightsPromptRepairs/historical-repair';
    const fake = createFakeFirestore({
      aiInsightsRequests: requestPaths,
      aiInsightsUsage: [usagePath],
      aiInsightsPromptRepairs: [repairPath],
    });

    await expect(purgeRetiredAiInsightsData({
      db: fake.db as never,
      execute: true,
      batchSize: 2,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).resolves.toEqual({
      found: {
        aiInsightsRequests: 5,
        aiInsightsUsage: 1,
        aiInsightsPromptRepairs: 1,
      },
      deleted: {
        aiInsightsRequests: 5,
        aiInsightsUsage: 1,
        aiInsightsPromptRepairs: 1,
      },
      remaining: {
        aiInsightsRequests: 0,
        aiInsightsUsage: 0,
        aiInsightsPromptRepairs: 0,
      },
    });

    expect(fake.recursiveDelete).toHaveBeenCalledTimes(7);
    expect(fake.recursiveDelete).toHaveBeenNthCalledWith(
      1,
      { path: requestPaths[0] },
      fake.bulkWriter.mock.results[0].value,
    );
    expect(fake.bulkWriter).toHaveBeenCalledTimes(5);
    expect(fake.onWriteError).toHaveBeenCalledTimes(5);
    expect(fake.close).toHaveBeenCalledTimes(5);
  });

  it('closes the batch writer and remains safely rerunnable after a delete failure', async () => {
    const fake = createFakeFirestore({
      aiInsightsRequests: ['users/user-1/aiInsightsRequests/latest'],
    });
    fake.recursiveDelete.mockRejectedValueOnce(new Error('delete failed'));

    await expect(purgeRetiredAiInsightsData({
      db: fake.db as never,
      execute: true,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).rejects.toThrow('delete failed');

    expect(fake.close).toHaveBeenCalledOnce();

    await expect(purgeRetiredAiInsightsData({
      db: fake.db as never,
      execute: true,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).resolves.toEqual({
      found: {
        aiInsightsRequests: 1,
        aiInsightsUsage: 0,
        aiInsightsPromptRepairs: 0,
      },
      deleted: {
        aiInsightsRequests: 1,
        aiInsightsUsage: 0,
        aiInsightsPromptRepairs: 0,
      },
      remaining: {
        aiInsightsRequests: 0,
        aiInsightsUsage: 0,
        aiInsightsPromptRepairs: 0,
      },
    });
    expect(fake.close).toHaveBeenCalledTimes(2);
  });

  it('refuses an unexpected collection-group path before scheduling any delete', async () => {
    const fake = createFakeFirestore({
      aiInsightsRequests: [
        'users/user-1/events/event-1/aiInsightsRequests/not-the-legacy-snapshot',
      ],
    });

    await expect(purgeRetiredAiInsightsData({
      db: fake.db as never,
      execute: true,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).rejects.toThrow(
      'Refusing to purge an unexpected aiInsightsRequests document path.',
    );

    expect(fake.bulkWriter).not.toHaveBeenCalled();
    expect(fake.recursiveDelete).not.toHaveBeenCalled();
  });

  it('requires an explicit project and validates destructive CLI options', () => {
    expect(parseRetiredAiInsightsPurgeArgs([
      '--project=quantified-self-io',
      '--execute',
      '--batch-size=250',
    ])).toEqual({
      projectId: 'quantified-self-io',
      execute: true,
      batchSize: 250,
    });
    expect(() => parseRetiredAiInsightsPurgeArgs([])).toThrow(
      'A valid --project=<firebase-project-id> argument is required.',
    );
    expect(() => parseRetiredAiInsightsPurgeArgs([
      '--project=quantified-self-io',
      '--execute',
      '--dry-run',
    ])).toThrow('Choose either --execute or --dry-run, not both.');
    expect(() => parseRetiredAiInsightsPurgeArgs([
      '--project=quantified-self-io',
      '--batch-size=501',
    ])).toThrow('batchSize must be an integer between 1 and 500.');
  });
});
