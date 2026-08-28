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
  const cleanupUpdate = vi.fn();
  const cleanupDelete = vi.fn();
  const cleanupRef = {
    path: 'routeOriginalFileCleanup/cleanup-ref',
    update: cleanupUpdate,
    delete: cleanupDelete,
  };
  const transactionSet = vi.fn();
  const queryGet = vi.fn();
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    get: queryGet,
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  const cleanupCollectionRef = {
    ...query,
    doc: vi.fn(() => cleanupRef),
  };
  const routeGet = vi.fn();
  const db = {
    collection: vi.fn(() => cleanupCollectionRef),
    doc: vi.fn(() => ({ get: routeGet })),
    runTransaction: vi.fn(async (handler: (transaction: { set: typeof transactionSet }) => unknown) => (
      handler({ set: transactionSet })
    )),
  };
  const storageDelete = vi.fn();
  const storageFile = vi.fn(() => ({ delete: storageDelete }));
  const storageBucket = vi.fn(() => ({ name: 'test-bucket', file: storageFile }));
  let updateTriggerOptions: unknown;
  let scheduleOptions: unknown;
  return {
    cleanupRef,
    cleanupUpdate,
    cleanupDelete,
    db,
    getScheduleOptions: () => scheduleOptions,
    getUpdateTriggerOptions: () => updateTriggerOptions,
    onDocumentUpdated: vi.fn((options: unknown, handler: unknown) => {
      updateTriggerOptions = options;
      return handler;
    }),
    onSchedule: vi.fn((options: unknown, handler: unknown) => {
      scheduleOptions = options;
      return handler;
    }),
    query,
    queryGet,
    routeGet,
    storageBucket,
    storageDelete,
    storageFile,
    transactionSet,
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
  Timestamp: {
    fromMillis: vi.fn((millis: number) => ({ toMillis: () => millis })),
  },
}));

vi.mock('firebase-functions/logger', () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: hoisted.onDocumentUpdated,
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: hoisted.onSchedule,
}));

import {
  cleanupRejectedRouteOriginalFilesForUser,
  processRejectedRouteOriginalCleanupDocument,
  redriveRejectedRouteOriginalCleanupTasks,
  releaseRejectedRouteOriginalCleanupReservation,
  requestRejectedRouteOriginalCleanup,
  reserveRejectedRouteOriginalCleanupInTransaction,
} from './rejected-original-cleanup';

function createCleanupSnapshot(overrides: Record<string, unknown> = {}) {
  const ref = {
    delete: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
  return {
    id: CLEANUP_ID,
    ref,
    data: () => ({
      schemaVersion: 1,
      userID: USER_ID,
      routeID: ROUTE_ID,
      bucket: BUCKET,
      path: ORIGINAL_PATH,
      cleanupAfter: { toMillis: () => 1_000 },
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
      ...overrides,
    }),
  } as never;
}

describe('rejected synced-route original cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.routeGet.mockResolvedValue({ exists: false, data: () => undefined });
    hoisted.storageDelete.mockResolvedValue(undefined);
    hoisted.cleanupUpdate.mockResolvedValue(undefined);
    hoisted.cleanupDelete.mockResolvedValue(undefined);
    hoisted.query.where.mockReturnValue(hoisted.query);
    hoisted.query.orderBy.mockReturnValue(hoisted.query);
    hoisted.query.limit.mockReturnValue(hoisted.query);
    hoisted.query.startAfter.mockReturnValue(hoisted.query);
    hoisted.queryGet.mockResolvedValue({ empty: true, docs: [] });
  });

  it('registers a retryable update trigger and recurring single-instance redrive', () => {
    expect(hoisted.getUpdateTriggerOptions()).toEqual(expect.objectContaining({
      document: 'routeOriginalFileCleanup/{cleanupID}',
      retry: true,
      region: 'europe-west2',
    }));
    expect(hoisted.getScheduleOptions()).toEqual(expect.objectContaining({
      schedule: 'every 30 minutes',
      maxInstances: 1,
      region: 'europe-west2',
    }));
  });

  it('reserves the exact path in a top-level durable task before upload', () => {
    const transaction = { set: hoisted.transactionSet } as never;
    const reservation = reserveRejectedRouteOriginalCleanupInTransaction({
      db: hoisted.db as never,
      transaction,
      userID: USER_ID,
      routeID: ROUTE_ID,
      originalFile: {
        bucket: BUCKET,
        path: ORIGINAL_PATH,
        extension: 'gpx',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
      nowMs: 10_000,
    });

    expect(hoisted.db.collection).toHaveBeenCalledWith('routeOriginalFileCleanup');
    expect(reservation).toEqual({ cleanupID: CLEANUP_ID, ref: hoisted.cleanupRef });
    expect(hoisted.transactionSet).toHaveBeenCalledWith(hoisted.cleanupRef, {
      schemaVersion: 1,
      userID: USER_ID,
      routeID: ROUTE_ID,
      bucket: BUCKET,
      path: ORIGINAL_PATH,
      cleanupAfter: expect.objectContaining({ toMillis: expect.any(Function) }),
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    const payload = hoisted.transactionSet.mock.calls[0][1];
    expect(payload.cleanupAfter.toMillis()).toBe(910_000);
  });

  it('can accelerate a reservation without changing its exact document identity', async () => {
    const reservation = { cleanupID: CLEANUP_ID, ref: hoisted.cleanupRef };
    await requestRejectedRouteOriginalCleanup(reservation, 20_000);
    await releaseRejectedRouteOriginalCleanupReservation(reservation);

    expect(hoisted.cleanupUpdate).toHaveBeenCalledWith({
      cleanupAfter: expect.objectContaining({ toMillis: expect.any(Function) }),
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(hoisted.cleanupUpdate.mock.calls[0][0].cleanupAfter.toMillis()).toBe(20_000);
    expect(hoisted.cleanupDelete).toHaveBeenCalledOnce();
  });

  it('deletes an unreferenced rejected upload and then its cleanup task', async () => {
    const snapshot = createCleanupSnapshot();

    await processRejectedRouteOriginalCleanupDocument(
      snapshot,
      CLEANUP_ID,
      2_000,
    );

    expect(hoisted.storageFile).toHaveBeenCalledWith(ORIGINAL_PATH);
    expect(hoisted.storageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('does not process an active reservation before its worker lease expires', async () => {
    const snapshot = createCleanupSnapshot({
      cleanupAfter: { toMillis: () => 3_000 },
    });

    await expect(processRejectedRouteOriginalCleanupDocument(
      snapshot,
      CLEANUP_ID,
      2_000,
    )).resolves.toBe('not_due');

    expect(hoisted.routeGet).not.toHaveBeenCalled();
    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).not.toHaveBeenCalled();
  });

  it('preserves a file that became the committed route original', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.routeGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ originalFiles: [{ path: ORIGINAL_PATH }] }),
    });

    await processRejectedRouteOriginalCleanupDocument(
      snapshot,
      CLEANUP_ID,
      2_000,
    );

    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('also preserves the legacy singular originalFile reference', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.routeGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ originalFile: { path: ORIGINAL_PATH } }),
    });

    await processRejectedRouteOriginalCleanupDocument(snapshot, CLEANUP_ID, 2_000);

    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('redrives due durable tasks independently of event retry windows', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.queryGet.mockResolvedValueOnce({ empty: false, docs: [snapshot] });

    await redriveRejectedRouteOriginalCleanupTasks(2_000);

    expect(hoisted.query.where).toHaveBeenCalledWith(
      'cleanupAfter',
      '<=',
      expect.objectContaining({ toMillis: expect.any(Function) }),
    );
    expect(hoisted.storageDelete).toHaveBeenCalledOnce();
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('backs off failed scheduled tasks so an old failure cannot starve newer due rows', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.queryGet.mockResolvedValueOnce({ empty: false, docs: [snapshot] });
    hoisted.storageDelete.mockRejectedValueOnce(new Error('Storage unavailable.'));

    await expect(redriveRejectedRouteOriginalCleanupTasks(2_000))
      .rejects.toThrow('Failed to redrive 1 route-original cleanup task');

    expect(snapshot.ref.delete).not.toHaveBeenCalled();
    expect(snapshot.ref.update).toHaveBeenCalledWith({
      cleanupAfter: expect.objectContaining({ toMillis: expect.any(Function) }),
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(snapshot.ref.update.mock.calls[0][0].cleanupAfter.toMillis()).toBe(1_802_000);
  });

  it('continues to a later page after backing off a full page of failures', async () => {
    const failedPage = Array.from({ length: 100 }, () => createCleanupSnapshot());
    const laterSnapshot = createCleanupSnapshot();
    hoisted.queryGet
      .mockResolvedValueOnce({ empty: false, docs: failedPage })
      .mockResolvedValueOnce({ empty: false, docs: [laterSnapshot] });
    hoisted.storageDelete.mockReset();
    for (let index = 0; index < failedPage.length; index += 1) {
      hoisted.storageDelete.mockRejectedValueOnce(new Error('Storage unavailable.'));
    }
    hoisted.storageDelete.mockResolvedValue(undefined);

    await expect(redriveRejectedRouteOriginalCleanupTasks(2_000))
      .rejects.toThrow('Failed to redrive 100 route-original cleanup task');

    expect(hoisted.queryGet).toHaveBeenCalledTimes(2);
    expect(hoisted.query.startAfter).toHaveBeenCalledWith(failedPage[failedPage.length - 1]);
    expect(laterSnapshot.ref.delete).toHaveBeenCalledOnce();
  });

  it('makes account cleanup deletion-aware without deleting an active reservation', async () => {
    const snapshot = createCleanupSnapshot({
      cleanupAfter: { toMillis: () => 3_000 },
    });
    hoisted.queryGet.mockResolvedValueOnce({ empty: false, docs: [snapshot] });

    await cleanupRejectedRouteOriginalFilesForUser(USER_ID, 2_000);

    expect(hoisted.query.where).toHaveBeenCalledWith('userID', '==', USER_ID);
    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).not.toHaveBeenCalled();
  });

  it('retains the cleanup task and fails retryably when Storage deletion fails', async () => {
    const snapshot = createCleanupSnapshot();
    hoisted.storageDelete.mockRejectedValueOnce(new Error('Storage unavailable.'));

    await expect(processRejectedRouteOriginalCleanupDocument(
      snapshot,
      CLEANUP_ID,
      2_000,
    )).rejects.toThrow('Storage unavailable.');

    expect(snapshot.ref.delete).not.toHaveBeenCalled();
  });

  it('drops malformed cleanup tasks without deleting arbitrary Storage paths', async () => {
    const snapshot = createCleanupSnapshot({
      path: 'users/another-user/routes/route-1/uploads/provider-sync/original-file-id.gpx',
    });

    await processRejectedRouteOriginalCleanupDocument(
      snapshot,
      CLEANUP_ID,
      2_000,
    );

    expect(hoisted.storageDelete).not.toHaveBeenCalled();
    expect(snapshot.ref.delete).toHaveBeenCalledOnce();
  });
});
