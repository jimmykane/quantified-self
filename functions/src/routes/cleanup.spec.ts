import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const hoisted = vi.hoisted(() => {
  const recursiveDeleteMock = vi.fn().mockResolvedValue(undefined);
  const collectionMock = vi.fn((path: string) => ({ path }));
  const docMock = vi.fn((path: string) => ({ path }));
  const transactionGetMock = vi.fn();
  const transactionSetMock = vi.fn();
  const runTransactionMock = vi.fn(async (handler: unknown) => (
    handler as (transaction: unknown) => Promise<unknown>
  )({
    get: transactionGetMock,
    set: transactionSetMock,
  }));
  const deleteFilesMock = vi.fn().mockResolvedValue(undefined);
  const serverTimestampMock = vi.fn(() => 'SERVER_TIMESTAMP');

  return {
    recursiveDeleteMock,
    collectionMock,
    docMock,
    transactionGetMock,
    transactionSetMock,
    runTransactionMock,
    deleteFilesMock,
    serverTimestampMock,
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
    doc: hoisted.docMock,
    recursiveDelete: hoisted.recursiveDeleteMock,
    runTransaction: hoisted.runTransactionMock,
  }),
  storage: () => ({
    bucket: () => ({
      deleteFiles: hoisted.deleteFilesMock,
    }),
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: hoisted.serverTimestampMock,
  },
}));

import { cleanupRouteFiles } from './cleanup';
import * as logger from 'firebase-functions/logger';

describe('cleanupRouteFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return {
          exists: true,
          data: () => ({ routeCount: 3 }),
        };
      }
      return {
        exists: false,
        data: () => ({}),
      };
    });
    hoisted.runTransactionMock.mockImplementation(async (handler: unknown) => (
      handler as (transaction: unknown) => Promise<unknown>
    )({
      get: hoisted.transactionGetMock,
      set: hoisted.transactionSetMock,
    }));
  });

  function deleteMarkerPath(eventId: string): string {
    const markerId = createHash('sha256')
      .update(eventId)
      .digest('hex');
    return `users/user-1/metaData/routeQuota/deletions/${markerId}`;
  }

  it('decrements route quota and deletes route metadata and original files by route prefix', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;

    await wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.docMock).toHaveBeenCalledWith('users/user-1/metaData/routeQuota');
    expect(hoisted.transactionSetMock).toHaveBeenCalledWith(
      { path: 'users/user-1/metaData/routeQuota' },
      {
        routeCount: 2,
        updatedAt: 'SERVER_TIMESTAMP',
        lastDeletedRouteId: 'route-1',
      },
      { merge: true },
    );
    expect(hoisted.transactionSetMock).toHaveBeenCalledWith(
      { path: deleteMarkerPath('delete-event-1') },
      {
        routeId: 'route-1',
        eventId: 'delete-event-1',
        eventTime: '2026-06-07T07:00:00.000Z',
        processedAt: 'SERVER_TIMESTAMP',
      },
    );
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
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
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
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
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

  it('continues route cleanup when quota counter decrement fails', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    const error = new Error('quota counter failed');
    hoisted.runTransactionMock.mockRejectedValueOnce(error);

    await wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.recursiveDeleteMock).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1/metaData' });
    expect(hoisted.deleteFilesMock).toHaveBeenCalledWith({
      prefix: 'users/user-1/routes/route-1/',
      force: true,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to decrement route quota counter',
      { userId: 'user-1', routeId: 'route-1', eventId: 'delete-event-1', error },
    );
  });

  it('does not create a route quota counter when none exists during deletion', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async () => {
      return {
        exists: false,
        data: () => ({}),
      };
    });

    await wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.transactionSetMock).not.toHaveBeenCalledWith(
      { path: 'users/user-1/metaData/routeQuota' },
      expect.anything(),
      expect.anything(),
    );
    expect(hoisted.transactionSetMock).toHaveBeenCalledWith(
      { path: deleteMarkerPath('delete-event-1') },
      expect.objectContaining({
        routeId: 'route-1',
        eventId: 'delete-event-1',
      }),
    );
    expect(hoisted.recursiveDeleteMock).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1/metaData' });
  });

  it('does not convert an invalid route quota counter to zero during deletion', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return {
          exists: true,
          data: () => ({ routeCount: 'invalid' }),
        };
      }
      return {
        exists: false,
        data: () => ({}),
      };
    });

    await wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.transactionSetMock).toHaveBeenCalledWith(
      { path: 'users/user-1/metaData/routeQuota' },
      {
        routeCountNeedsRepair: true,
        updatedAt: 'SERVER_TIMESTAMP',
        lastDeletedRouteId: 'route-1',
      },
      { merge: true },
    );
    expect(hoisted.transactionSetMock).not.toHaveBeenCalledWith(
      { path: 'users/user-1/metaData/routeQuota' },
      expect.objectContaining({ routeCount: 0 }),
      expect.anything(),
    );
  });

  it('does not decrement quota twice when the same delete event is retried', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.endsWith('/metaData/routeQuota')) {
        return {
          exists: true,
          data: () => ({ routeCount: 3 }),
        };
      }
      return {
        exists: true,
        data: () => ({ routeId: 'route-1' }),
      };
    });

    await wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    });

    expect(hoisted.transactionSetMock).not.toHaveBeenCalled();
    expect(hoisted.recursiveDeleteMock).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1/metaData' });
    expect(hoisted.deleteFilesMock).toHaveBeenCalledWith({
      prefix: 'users/user-1/routes/route-1/',
      force: true,
    });
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
    expect(hoisted.runTransactionMock).not.toHaveBeenCalled();
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
    expect(hoisted.runTransactionMock).not.toHaveBeenCalled();
  });
});
