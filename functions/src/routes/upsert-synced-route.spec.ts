import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockHasProAccess = vi.fn();
  const mockHasBasicAccess = vi.fn();
  const mockRandomUUID = vi.fn();
  const mockBuildFirestoreRoutePayload = vi.fn();
  const mockBuildRouteDocumentForWrite = vi.fn();
  const mockGetUserDeletionGuardStateInTransaction = vi.fn();
  const mockCreateRouteProcessingMetadataPayload = vi.fn();
  const mockTransactionGet = vi.fn();
  const mockTransactionSet = vi.fn();
  const mockRunTransaction = vi.fn(async (handler: unknown) => (
    handler as (transaction: unknown) => Promise<unknown>
  )({
    get: mockTransactionGet,
    set: mockTransactionSet,
  }));
  const mockStorageSave = vi.fn();
  const mockStorageDelete = vi.fn();
  const mockStorageFile = vi.fn((path: string) => ({
    path,
    save: (data: Buffer) => mockStorageSave(path, data),
    delete: (options: unknown) => mockStorageDelete(path, options),
  }));
  const mockStorageBucket = vi.fn((name?: string) => ({
    name: name ?? 'test-bucket',
    file: mockStorageFile,
  }));

  return {
    mockHasProAccess,
    mockHasBasicAccess,
    mockRandomUUID,
    mockBuildFirestoreRoutePayload,
    mockBuildRouteDocumentForWrite,
    mockGetUserDeletionGuardStateInTransaction,
    mockCreateRouteProcessingMetadataPayload,
    mockTransactionGet,
    mockTransactionSet,
    mockRunTransaction,
    mockStorageSave,
    mockStorageDelete,
    mockStorageFile,
    mockStorageBucket,
  };
});

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => hoisted.mockRandomUUID(...args),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    doc: (path: string) => ({ path }),
    runTransaction: hoisted.mockRunTransaction,
  }),
  storage: () => ({
    bucket: hoisted.mockStorageBucket,
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

vi.mock('../utils', () => ({
  hasProAccess: (...args: unknown[]) => hoisted.mockHasProAccess(...args),
  hasBasicAccess: (...args: unknown[]) => hoisted.mockHasBasicAccess(...args),
}));

vi.mock('../shared/route-writer', () => ({
  buildFirestoreRoutePayload: (...args: unknown[]) => hoisted.mockBuildFirestoreRoutePayload(...args),
}));

vi.mock('./route-persistence', () => ({
  buildRouteDocumentForWrite: (...args: unknown[]) => hoisted.mockBuildRouteDocumentForWrite(...args),
  getRouteSourceMetadataRef: (_db: unknown, userID: string, routeID: string) => ({
    path: `users/${userID}/routes/${routeID}/metaData/source`,
  }),
}));

vi.mock('./route-processing', () => ({
  createRouteProcessingMetadataPayload: (...args: unknown[]) => (
    hoisted.mockCreateRouteProcessingMetadataPayload(...args)
  ),
}));

vi.mock('../shared/user-deletion-guard', () => {
  class MockUserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';

    constructor(
      readonly uid: string,
      readonly phase: string,
      readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  }

  return {
    getUserDeletionGuardStateInTransaction: (...args: unknown[]) => (
      hoisted.mockGetUserDeletionGuardStateInTransaction(...args)
    ),
    UserDeletionGuardReadError: MockUserDeletionGuardReadError,
  };
});

import { upsertSyncedRoute } from './upsert-synced-route';

function makeSnapshot(exists: boolean, data: Record<string, unknown> = {}) {
  return {
    exists,
    data: () => data,
  };
}

function makeExistingRouteDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    userID: 'user-1',
    importedAt: new Date('2026-01-01T00:00:00.000Z'),
    originalFiles: [{
      path: 'users/user-1/routes/route-1/uploads/provider-sync/original-old.gpx',
      bucket: 'test-bucket',
      extension: 'gpx',
      originalFilename: 'Morning Route.gpx',
    }],
    originalFile: {
      path: 'users/user-1/routes/route-1/uploads/provider-sync/original-old.gpx',
      bucket: 'test-bucket',
      extension: 'gpx',
      originalFilename: 'Morning Route.gpx',
    },
    ...overrides,
  };
}

function transactionSetPayloadForPath(path: string): Record<string, unknown> | undefined {
  const call = hoisted.mockTransactionSet.mock.calls.find(([ref]) => (
    ref as { path?: string } | undefined
  )?.path === path);
  return call?.[1] as Record<string, unknown> | undefined;
}

describe('upsertSyncedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockHasProAccess.mockResolvedValue(true);
    hoisted.mockHasBasicAccess.mockResolvedValue(false);
    hoisted.mockRandomUUID.mockReturnValue('new-file-id');
    hoisted.mockBuildFirestoreRoutePayload.mockReturnValue({ parsed: true });
    hoisted.mockBuildRouteDocumentForWrite.mockImplementation(({ routeId, userID, originalFiles }) => ({
      id: routeId,
      userID,
      originalFiles,
      originalFile: originalFiles[0] ?? null,
    }));
    hoisted.mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    hoisted.mockCreateRouteProcessingMetadataPayload.mockReturnValue({
      processingEntity: 'route',
    });
    hoisted.mockTransactionGet.mockImplementation(async (ref: { path: string }) => {
      if (ref.path === 'users/user-1/routes/route-1') {
        return makeSnapshot(true, makeExistingRouteDocument());
      }
      return makeSnapshot(false, {});
    });
  });

  it('writes synced originals to a new path and deletes the replaced original after a successful update', async () => {
    const result = await upsertSyncedRoute({
      userID: 'user-1',
      routeID: 'route-1',
      routeFile: { name: 'Updated Route' } as never,
      sourceMetadata: {
        sourceType: 'service_sync',
        sourceServiceName: 'suuntoApp',
      } as never,
      originalFile: {
        data: Buffer.from('<gpx />'),
        extension: 'gpx',
        originalFilename: 'Updated Route.gpx',
      },
    });

    expect(result).toMatchObject({
      status: 'updated',
      routeID: 'route-1',
    });
    expect(hoisted.mockStorageSave).toHaveBeenCalledWith(
      'users/user-1/routes/route-1/uploads/provider-sync/original-new-file-id.gpx',
      Buffer.from('<gpx />'),
    );
    expect(transactionSetPayloadForPath('users/user-1/routes/route-1')).toEqual(expect.objectContaining({
      originalFiles: [expect.objectContaining({
        path: 'users/user-1/routes/route-1/uploads/provider-sync/original-new-file-id.gpx',
        originalFilename: 'Updated Route.gpx',
      })],
    }));
    expect(hoisted.mockStorageDelete).toHaveBeenCalledWith(
      'users/user-1/routes/route-1/uploads/provider-sync/original-old.gpx',
      { ignoreNotFound: true },
    );
    expect(hoisted.mockStorageDelete).not.toHaveBeenCalledWith(
      'users/user-1/routes/route-1/uploads/provider-sync/original-new-file-id.gpx',
      { ignoreNotFound: true },
    );
  });

  it('keeps the existing original file when the transaction fails after uploading a replacement', async () => {
    hoisted.mockRunTransaction.mockImplementationOnce(async (handler: unknown) => {
      await (handler as (transaction: unknown) => Promise<unknown>)({
        get: hoisted.mockTransactionGet,
        set: hoisted.mockTransactionSet,
      });
      throw new Error('transient failure');
    });

    await expect(upsertSyncedRoute({
      userID: 'user-1',
      routeID: 'route-1',
      routeFile: { name: 'Updated Route' } as never,
      sourceMetadata: {
        sourceType: 'service_sync',
        sourceServiceName: 'suuntoApp',
      } as never,
      originalFile: {
        data: Buffer.from('<gpx />'),
        extension: 'gpx',
        originalFilename: 'Updated Route.gpx',
      },
    })).rejects.toThrow('transient failure');

    expect(hoisted.mockStorageDelete).toHaveBeenCalledTimes(1);
    expect(hoisted.mockStorageDelete).toHaveBeenCalledWith(
      'users/user-1/routes/route-1/uploads/provider-sync/original-new-file-id.gpx',
      { ignoreNotFound: true },
    );
    expect(hoisted.mockStorageDelete).not.toHaveBeenCalledWith(
      'users/user-1/routes/route-1/uploads/provider-sync/original-old.gpx',
      { ignoreNotFound: true },
    );
  });
});
