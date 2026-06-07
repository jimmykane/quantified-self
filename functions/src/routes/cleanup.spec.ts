import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const recursiveDeleteMock = vi.fn().mockResolvedValue(undefined);
  const collectionMock = vi.fn((path: string) => ({ path }));
  const deleteFilesMock = vi.fn().mockResolvedValue(undefined);

  return {
    recursiveDeleteMock,
    collectionMock,
    deleteFilesMock,
  };
});

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentDeleted: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: hoisted.collectionMock,
    recursiveDelete: hoisted.recursiveDeleteMock,
  }),
  storage: () => ({
    bucket: () => ({
      deleteFiles: hoisted.deleteFilesMock,
    }),
  }),
}));

import { cleanupRouteFiles } from './cleanup';
import * as logger from 'firebase-functions/logger';

describe('cleanupRouteFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes route metadata and original files by route prefix', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;

    await wrapped({
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.collectionMock).toHaveBeenCalledWith('users/user-1/routes/route-1/metaData');
    expect(hoisted.recursiveDeleteMock).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1/metaData' });
    expect(hoisted.deleteFilesMock).toHaveBeenCalledWith({
      prefix: 'users/user-1/routes/route-1/',
      force: true,
    });
  });

  it('continues deleting route original files when metadata cleanup fails', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    const error = new Error('metadata cleanup failed');
    hoisted.recursiveDeleteMock.mockRejectedValueOnce(error);

    await wrapped({
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.deleteFilesMock).toHaveBeenCalledWith({
      prefix: 'users/user-1/routes/route-1/',
      force: true,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to clean up route metadata',
      { userId: 'user-1', routeId: 'route-1', error },
    );
  });

  it('continues route cleanup when original file deletion fails', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    const error = new Error('storage cleanup failed');
    hoisted.deleteFilesMock.mockRejectedValueOnce(error);

    await wrapped({
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.recursiveDeleteMock).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1/metaData' });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to clean up route original files',
      {
        userId: 'user-1',
        routeId: 'route-1',
        storagePrefix: 'users/user-1/routes/route-1/',
        error,
      },
    );
  });

  it('does nothing when trigger params are missing', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;

    await wrapped({
      data: { exists: false },
      params: {
        userId: '',
        routeId: 'route-1',
      },
    });

    expect(hoisted.recursiveDeleteMock).not.toHaveBeenCalled();
    expect(hoisted.deleteFilesMock).not.toHaveBeenCalled();
  });

  it('does nothing when the delete event has no snapshot data', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;

    await wrapped({
      data: null,
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.recursiveDeleteMock).not.toHaveBeenCalled();
    expect(hoisted.deleteFilesMock).not.toHaveBeenCalled();
  });
});
