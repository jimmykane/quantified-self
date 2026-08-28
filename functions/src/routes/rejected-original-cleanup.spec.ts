import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const USER_ID = 'user-1';
const ROUTE_ID = 'route-1';
const BUCKET = 'test-bucket';
const ORIGINAL_PATH = `users/${USER_ID}/routes/${ROUTE_ID}/uploads/provider-sync/original-file-id.gpx`;
const CLEANUP_ID = createHash('sha256')
  .update(BUCKET)
  .update('\0')
  .update(ORIGINAL_PATH)
  .digest('hex');

const hoisted = vi.hoisted(() => {
  const cleanupSet = vi.fn();
  const cleanupRef = { set: cleanupSet };
  const cleanupCollectionRef = { doc: vi.fn(() => cleanupRef) };
  const userRef = { collection: vi.fn(() => cleanupCollectionRef) };
  const routeGet = vi.fn();
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => userRef) })),
    doc: vi.fn(() => ({ get: routeGet })),
  };
  const storageDelete = vi.fn();
  const storageFile = vi.fn(() => ({ delete: storageDelete }));
  const storageBucket = vi.fn(() => ({ name: 'test-bucket', file: storageFile }));
  let triggerOptions: unknown;
  return {
    cleanupRef,
    cleanupSet,
    db,
    getTriggerOptions: () => triggerOptions,
    onDocumentCreated: vi.fn((options: unknown, handler: unknown) => {
      triggerOptions = options;
      return handler;
    }),
    routeGet,
    storageBucket,
    storageDelete,
    storageFile,
  };
});

vi.mock('firebase-admin', () => ({
  firestore: vi.fn(() => hoisted.db),
  storage: vi.fn(() => ({ bucket: hoisted.storageBucket })),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

vi.mock('firebase-functions/logger', () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: hoisted.onDocumentCreated,
}));

import {
  enqueueRejectedRouteOriginalCleanup,
  processRejectedRouteOriginalCleanupDocument,
} from './rejected-original-cleanup';

function createCleanupSnapshot(overrides: Record<string, unknown> = {}) {
  const ref = { delete: vi.fn() };
  return {
    ref,
    data: () => ({
      schemaVersion: 1,
      userID: USER_ID,
      routeID: ROUTE_ID,
      bucket: BUCKET,
      path: ORIGINAL_PATH,
      createdAt: 'SERVER_TIMESTAMP',
      ...overrides,
    }),
  } as never;
}

describe('rejected synced-route original cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.routeGet.mockResolvedValue({ exists: false, data: () => undefined });
    hoisted.storageDelete.mockResolvedValue(undefined);
  });

  it('registers a retryable backend cleanup trigger', () => {
    expect(hoisted.getTriggerOptions()).toEqual(expect.objectContaining({
      document: 'users/{userID}/routeOriginalFileCleanup/{cleanupID}',
      retry: true,
      region: 'europe-west2',
    }));
  });

  it('persists an opaque deterministic cleanup task for a rejected upload', async () => {
    await enqueueRejectedRouteOriginalCleanup({
      userID: USER_ID,
      routeID: ROUTE_ID,
      originalFile: {
        bucket: BUCKET,
        path: ORIGINAL_PATH,
        extension: 'gpx',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(hoisted.db.collection).toHaveBeenCalledWith('users');
    expect(hoisted.cleanupRef.set).toHaveBeenCalledWith({
      schemaVersion: 1,
      userID: USER_ID,
      routeID: ROUTE_ID,
      bucket: BUCKET,
      path: ORIGINAL_PATH,
      createdAt: 'SERVER_TIMESTAMP',
    });
  });

  it('deletes an unreferenced rejected upload and then its cleanup task', async () => {
    const snapshot = createCleanupSnapshot();

    await processRejectedRouteOriginalCleanupDocument(
      snapshot,
      USER_ID,
      CLEANUP_ID,
    );

    expect(hoisted.storageFile).toHaveBeenCalledWith(ORIGINAL_PATH);
    expect(hoisted.storageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('preserves a file that became the committed route original', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.routeGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ originalFiles: [{ path: ORIGINAL_PATH }] }),
    });

    await processRejectedRouteOriginalCleanupDocument(
      snapshot,
      USER_ID,
      CLEANUP_ID,
    );

    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('retains the cleanup task and fails retryably when Storage deletion fails', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.storageDelete.mockRejectedValueOnce(new Error('Storage unavailable.'));

    await expect(processRejectedRouteOriginalCleanupDocument(
      snapshot,
      USER_ID,
      CLEANUP_ID,
    )).rejects.toThrow('Storage unavailable.');

    expect(snapshot.ref.delete).not.toHaveBeenCalled();
  });

  it('drops malformed cleanup tasks without deleting arbitrary Storage paths', async () => {
    const snapshot = createCleanupSnapshot({
      path: 'users/another-user/routes/route-1/uploads/provider-sync/original-file-id.gpx',
    });

    await processRejectedRouteOriginalCleanupDocument(
      snapshot,
      USER_ID,
      CLEANUP_ID,
    );

    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });
});
