import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const hoisted = vi.hoisted(() => {
  const capturedOnDocumentDeletedOptions = { value: undefined as unknown };
  const mockOnDocumentDeleted = vi.fn((options: unknown, handler: unknown) => {
    capturedOnDocumentDeletedOptions.value = options;
    return handler;
  });
  const recursiveDeleteMock = vi.fn().mockResolvedValue(undefined);
  const routesCountGetMock = vi.fn();
  const collectionMock = vi.fn((path: string) => {
    if (path === 'users' || path === 'userDeletionTombstones') {
      return {
        path,
        doc: (id: string) => ({ path: `${path}/${id}` }),
      };
    }
    if (path.endsWith('/routes')) {
      return {
        path,
        count: () => ({ get: routesCountGetMock }),
      };
    }
    return { path };
  });
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
    capturedOnDocumentDeletedOptions,
    mockOnDocumentDeleted,
    recursiveDeleteMock,
    routesCountGetMock,
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
  onDocumentDeleted: hoisted.mockOnDocumentDeleted,
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

function activeUserGuardSnapshot(ref: { path: string }) {
  if (ref.path === 'users/user-1') {
    return {
      exists: true,
      data: () => ({}),
    };
  }
  if (ref.path === 'userDeletionTombstones/user-1') {
    return {
      exists: false,
      data: () => ({}),
    };
  }
  return null;
}

describe('cleanupRouteFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.routesCountGetMock.mockResolvedValue({ data: () => ({ count: 2 }) });
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
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

  it('configures the route cleanup trigger as retryable', () => {
    expect(hoisted.capturedOnDocumentDeletedOptions.value).toMatchObject({
      document: 'users/{userId}/routes/{routeId}',
      region: 'europe-west2',
      retry: true,
    });
  });

  it('reconciles route quota and deletes route metadata and original files by route prefix', async () => {
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
    expect(hoisted.collectionMock).toHaveBeenCalledWith('users/user-1/routes');
    expect(hoisted.routesCountGetMock).toHaveBeenCalledOnce();
    expect(hoisted.transactionSetMock).toHaveBeenCalledWith(
      { path: 'users/user-1/metaData/routeQuota' },
      {
        routeCount: 2,
        updatedAt: 'SERVER_TIMESTAMP',
        lastDeletedRouteId: 'route-1',
        reconciledAfterDeleteAt: 'SERVER_TIMESTAMP',
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

  it('skips route quota and marker writes when account deletion is in progress', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path === 'users/user-1') {
        return {
          exists: true,
          data: () => ({}),
        };
      }
      if (ref.path === 'userDeletionTombstones/user-1') {
        return {
          exists: true,
          data: () => ({}),
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

    expect(hoisted.routesCountGetMock).not.toHaveBeenCalled();
    expect(hoisted.transactionSetMock).not.toHaveBeenCalled();
    expect(hoisted.recursiveDeleteMock).not.toHaveBeenCalled();
    expect(hoisted.deleteFilesMock).toHaveBeenCalledWith({
      prefix: 'users/user-1/routes/route-1/',
      force: true,
    });
  });

  it('continues deleting route original files when metadata cleanup fails', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    const error = new Error('metadata cleanup failed');
    hoisted.recursiveDeleteMock.mockRejectedValueOnce(error);

    await expect(wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    })).rejects.toThrow('Route cleanup failed: metadata.');

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

    await expect(wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    })).rejects.toThrow('Route cleanup failed: storage.');

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

  it('continues route cleanup when quota counter reconciliation fails', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    const error = new Error('quota counter failed');
    hoisted.runTransactionMock.mockRejectedValueOnce(error);

    await expect(wrapped({
      id: 'delete-event-1',
      time: '2026-06-07T07:00:00.000Z',
      data: { exists: false },
      params: {
        userId: 'user-1',
        routeId: 'route-1',
      },
    })).rejects.toThrow('Route cleanup failed: quota.');

    expect(hoisted.recursiveDeleteMock).toHaveBeenCalledWith({ path: 'users/user-1/routes/route-1/metaData' });
    expect(hoisted.deleteFilesMock).toHaveBeenCalledWith({
      prefix: 'users/user-1/routes/route-1/',
      force: true,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to reconcile route quota counter after delete',
      { userId: 'user-1', routeId: 'route-1', eventId: 'delete-event-1', error },
    );
  });

  it('initializes a missing route quota counter from the aggregate count during deletion', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
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
        routeCount: 2,
        updatedAt: 'SERVER_TIMESTAMP',
        lastDeletedRouteId: 'route-1',
        reconciledAfterDeleteAt: 'SERVER_TIMESTAMP',
        initializedAt: 'SERVER_TIMESTAMP',
      },
      { merge: true },
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

  it('repairs an invalid route quota counter from the aggregate count during deletion', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
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
        routeCount: 2,
        updatedAt: 'SERVER_TIMESTAMP',
        lastDeletedRouteId: 'route-1',
        reconciledAfterDeleteAt: 'SERVER_TIMESTAMP',
        repairedAt: 'SERVER_TIMESTAMP',
      },
      { merge: true },
    );
  });

  it('does not reconcile quota twice when the same delete event is retried', async () => {
    const wrapped = cleanupRouteFiles as unknown as (event: unknown) => Promise<void>;
    hoisted.transactionGetMock.mockImplementation(async (ref: { path: string }) => {
      const guardSnapshot = activeUserGuardSnapshot(ref);
      if (guardSnapshot) {
        return guardSnapshot;
      }
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
    expect(hoisted.routesCountGetMock).not.toHaveBeenCalled();
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
