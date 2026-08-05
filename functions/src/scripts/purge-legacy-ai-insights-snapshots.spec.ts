import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_AI_INSIGHTS_SNAPSHOT_COLLECTION_GROUP,
  parseLegacySnapshotPurgeArgs,
  purgeLegacyAiInsightsSnapshots,
} from './purge-legacy-ai-insights-snapshots';

function createFakeFirestore(paths: string[]) {
  let remainingPaths = [...paths];
  const close = vi.fn().mockResolvedValue(undefined);
  const onWriteError = vi.fn();
  const bulkWriter = vi.fn(() => ({ close, onWriteError }));
  const recursiveDelete = vi.fn(async (ref: { path: string }) => {
    remainingPaths = remainingPaths.filter(path => path !== ref.path);
  });
  const getBatch = vi.fn(async (batchSize: number) => {
    const batchPaths = remainingPaths.slice(0, batchSize);
    const docs = batchPaths.map(path => ({ ref: { path } }));
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
    };
  });
  const getCount = vi.fn(async () => ({
    data: () => ({ count: remainingPaths.length }),
  }));
  const collectionGroup = vi.fn((collectionGroupId: string) => {
    expect(collectionGroupId).toBe(LEGACY_AI_INSIGHTS_SNAPSHOT_COLLECTION_GROUP);
    return {
      count: () => ({ get: getCount }),
      limit: (batchSize: number) => ({
        get: () => getBatch(batchSize),
      }),
    };
  });

  return {
    db: {
      bulkWriter,
      collectionGroup,
      recursiveDelete,
    },
    bulkWriter,
    close,
    getBatch,
    getCount,
    onWriteError,
    recursiveDelete,
  };
}

describe('legacy AI Insights snapshot purge', () => {
  it('defaults to a count-only dry run', async () => {
    const fake = createFakeFirestore([
      'users/user-1/aiInsightsRequests/latest',
      'users/user-2/aiInsightsRequests/latest',
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(purgeLegacyAiInsightsSnapshots({
      db: fake.db as never,
      logger,
    })).resolves.toEqual({ found: 2, deleted: 0, remaining: 2 });

    expect(fake.getCount).toHaveBeenCalledOnce();
    expect(fake.getBatch).not.toHaveBeenCalled();
    expect(fake.bulkWriter).not.toHaveBeenCalled();
    expect(fake.recursiveDelete).not.toHaveBeenCalled();
  });

  it('recursively drains the retired collection group in bounded batches', async () => {
    const paths = Array.from(
      { length: 5 },
      (_, index) => `users/user-${index + 1}/aiInsightsRequests/latest`,
    );
    const fake = createFakeFirestore(paths);

    await expect(purgeLegacyAiInsightsSnapshots({
      db: fake.db as never,
      execute: true,
      batchSize: 2,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).resolves.toEqual({ found: 5, deleted: 5, remaining: 0 });

    expect(fake.getBatch.mock.calls.map(([batchSize]) => batchSize))
      .toEqual([2, 2, 2, 2]);
    expect(fake.recursiveDelete).toHaveBeenCalledTimes(5);
    expect(fake.recursiveDelete).toHaveBeenNthCalledWith(
      1,
      { path: paths[0] },
      fake.bulkWriter.mock.results[0].value,
    );
    expect(fake.bulkWriter).toHaveBeenCalledTimes(3);
    expect(fake.onWriteError).toHaveBeenCalledTimes(3);
    expect(fake.close).toHaveBeenCalledTimes(3);
  });

  it('closes the batch writer and remains safely rerunnable after a delete failure', async () => {
    const fake = createFakeFirestore([
      'users/user-1/aiInsightsRequests/latest',
    ]);
    fake.recursiveDelete.mockRejectedValueOnce(new Error('delete failed'));

    await expect(purgeLegacyAiInsightsSnapshots({
      db: fake.db as never,
      execute: true,
      logger: { info: vi.fn(), warn: vi.fn() },
    })).rejects.toThrow('delete failed');

    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.getCount).toHaveBeenCalledOnce();
  });

  it('requires an explicit project and validates destructive CLI options', () => {
    expect(parseLegacySnapshotPurgeArgs([
      '--project=quantified-self-io',
      '--execute',
      '--batch-size=250',
    ])).toEqual({
      projectId: 'quantified-self-io',
      execute: true,
      batchSize: 250,
    });
    expect(() => parseLegacySnapshotPurgeArgs([])).toThrow(
      'A valid --project=<firebase-project-id> argument is required.',
    );
    expect(() => parseLegacySnapshotPurgeArgs([
      '--project=quantified-self-io',
      '--execute',
      '--dry-run',
    ])).toThrow('Choose either --execute or --dry-run, not both.');
    expect(() => parseLegacySnapshotPurgeArgs([
      '--project=quantified-self-io',
      '--batch-size=501',
    ])).toThrow('batchSize must be an integer between 1 and 500.');
  });
});
