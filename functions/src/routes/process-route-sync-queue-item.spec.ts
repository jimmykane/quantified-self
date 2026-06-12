'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const routeDocuments = new Map<string, Record<string, unknown>>();

const queueUtilsMocks = {
  increaseRetryCountForQueueItem: vi.fn(),
  markQueueItemSkipped: vi.fn(),
  moveToDeadLetterQueue: vi.fn(),
  updateToProcessed: vi.fn(),
};

vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
    Skipped: 'SKIPPED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    RetryIncremented: 'RETRY_INCREMENTED',
    Failed: 'FAILED',
  },
  QUEUE_SKIPPED_REASONS: {
    UserDeletedOrDeleting: 'user_deleted_or_deleting',
  },
  increaseRetryCountForQueueItem: (...args: any[]) => queueUtilsMocks.increaseRetryCountForQueueItem(...args),
  markQueueItemSkipped: (...args: any[]) => queueUtilsMocks.markQueueItemSkipped(...args),
  moveToDeadLetterQueue: (...args: any[]) => queueUtilsMocks.moveToDeadLetterQueue(...args),
  updateToProcessed: (...args: any[]) => queueUtilsMocks.updateToProcessed(...args),
}));

const utilsMocks = {
  generateIDFromParts: vi.fn(),
};

vi.mock('../utils', () => ({
  generateIDFromParts: (...args: any[]) => utilsMocks.generateIDFromParts(...args),
}));

const routeProcessingMocks = {
  assignRouteSegmentIDs: vi.fn(),
  getRouteParsingFailureMessage: vi.fn(),
  parseRoutePayload: vi.fn(),
};

vi.mock('./route-processing', () => ({
  RouteProcessingHttpStatusError: class RouteProcessingHttpStatusError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
      this.name = 'RouteProcessingHttpStatusError';
    }
  },
  assignRouteSegmentIDs: (...args: any[]) => routeProcessingMocks.assignRouteSegmentIDs(...args),
  getRouteParsingFailureMessage: (...args: any[]) => routeProcessingMocks.getRouteParsingFailureMessage(...args),
  parseRoutePayload: (...args: any[]) => routeProcessingMocks.parseRoutePayload(...args),
}));

const suuntoRouteMocks = {
  exportSuuntoRouteAsGPX: vi.fn(),
};

vi.mock('../suunto/routes', () => ({
  exportSuuntoRouteAsGPX: (...args: any[]) => suuntoRouteMocks.exportSuuntoRouteAsGPX(...args),
}));

const upsertSyncedRouteMocks = {
  upsertSyncedRoute: vi.fn(),
};

vi.mock('./upsert-synced-route', () => ({
  SyncedRouteLimitExceededError: class SyncedRouteLimitExceededError extends Error {},
  SyncedRouteSkippedForDeletedUserError: class SyncedRouteSkippedForDeletedUserError extends Error {},
  upsertSyncedRoute: (...args: any[]) => upsertSyncedRouteMocks.upsertSyncedRoute(...args),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    doc: (path: string) => ({
      get: vi.fn().mockImplementation(async () => {
        const data = routeDocuments.get(path);
        return {
          exists: data !== undefined,
          data: () => data,
        };
      }),
    }),
  }),
}));

import { processRouteSyncQueueItem } from './process-route-sync-queue-item';
import { QueueResult } from '../queue-utils';

function createQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-1',
    ref: { update: vi.fn() },
    dateCreated: 1,
    processed: false,
    retryCount: 0,
    totalRetryCount: 0,
    errors: [],
    dispatchedToCloudTask: null,
    sourceServiceName: ServiceNames.SuuntoApp,
    providerUserId: 'suunto-user',
    providerRouteId: 'provider-route-1',
    providerRouteName: 'Morning Route',
    providerRouteCreatedAt: 1700000000000,
    providerRouteModifiedAt: 1700000005000,
    manual: false,
    firebaseUserID: 'user-1',
    ...overrides,
  } as any;
}

function createParsedRouteFile() {
  let id: string | null = null;
  const routes = [{ name: 'Imported segment' }];
  return {
    name: 'Imported route',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    hasRoutes: vi.fn(() => true),
    getRoutes: vi.fn(() => routes),
    setID: vi.fn((nextID: string) => { id = nextID; }),
    getID: vi.fn(() => id),
  };
}

function createTimestampLike(dateString: string) {
  const date = new Date(dateString);
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: (date.getTime() % 1000) * 1_000_000,
    toDate: () => date,
  };
}

describe('processRouteSyncQueueItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeDocuments.clear();
    utilsMocks.generateIDFromParts.mockResolvedValue('route-doc-1');
    queueUtilsMocks.markQueueItemSkipped.mockResolvedValue(QueueResult.Processed);
    queueUtilsMocks.updateToProcessed.mockResolvedValue(QueueResult.Processed);
    queueUtilsMocks.increaseRetryCountForQueueItem.mockResolvedValue(QueueResult.RetryIncremented);
    queueUtilsMocks.moveToDeadLetterQueue.mockResolvedValue(QueueResult.MovedToDLQ);
    routeProcessingMocks.parseRoutePayload.mockResolvedValue(createParsedRouteFile());
    routeProcessingMocks.getRouteParsingFailureMessage.mockReturnValue('Could not parse route.');
    suuntoRouteMocks.exportSuuntoRouteAsGPX.mockResolvedValue('<gpx />');
    upsertSyncedRouteMocks.upsertSyncedRoute.mockResolvedValue({
      status: 'created',
      routeID: 'route-doc-1',
      routeCountAfterWrite: 1,
    });
  });

  it('skips provider routes that are already up to date', async () => {
    routeDocuments.set('users/user-1/routes/route-doc-1', {
      id: 'route-doc-1',
      userID: 'user-1',
      sourceSummary: {
        sourceType: 'service_sync',
        sourceServiceName: ServiceNames.SuuntoApp,
        providerRouteId: 'provider-route-1',
        providerRouteName: 'Morning Route',
        modifiedAt: createTimestampLike('2026-02-01T12:00:09.000Z'),
        importedAt: createTimestampLike('2026-02-01T12:00:01.000Z'),
      },
    });

    const result = await processRouteSyncQueueItem(createQueueItem({
      providerRouteModifiedAt: new Date('2026-02-01T12:00:05.000Z').getTime(),
    }));

    expect(result).toBe(QueueResult.Processed);
    expect(queueUtilsMocks.markQueueItemSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-1' }),
      undefined,
      'provider_route_up_to_date',
      expect.objectContaining({
        resultRouteId: 'route-doc-1',
        resultStatus: 'skipped',
      }),
    );
    expect(suuntoRouteMocks.exportSuuntoRouteAsGPX).not.toHaveBeenCalled();
    expect(upsertSyncedRouteMocks.upsertSyncedRoute).not.toHaveBeenCalled();
  });

  it('marks provider auth failures as skipped instead of retrying', async () => {
    const { HttpsError } = await import('firebase-functions/v2/https');
    suuntoRouteMocks.exportSuuntoRouteAsGPX.mockRejectedValueOnce(
      new HttpsError('unauthenticated', 'Reconnect Suunto.'),
    );

    const result = await processRouteSyncQueueItem(createQueueItem());

    expect(result).toBe(QueueResult.Processed);
    expect(queueUtilsMocks.markQueueItemSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-1' }),
      undefined,
      'provider_auth_required',
      expect.objectContaining({
        resultStatus: 'skipped',
      }),
    );
    expect(queueUtilsMocks.increaseRetryCountForQueueItem).not.toHaveBeenCalled();
  });

  it('preserves importedAt and unicode provider filenames when syncing updated routes', async () => {
    const originalImportedAt = new Date('2026-02-01T12:00:00.000Z');
    routeDocuments.set('users/user-1/routes/route-doc-1', {
      id: 'route-doc-1',
      userID: 'user-1',
      importedAt: { seconds: Math.floor(originalImportedAt.getTime() / 1000), nanoseconds: 0 },
      sourceSummary: {
        sourceType: 'service_sync',
        sourceServiceName: ServiceNames.SuuntoApp,
        providerRouteId: 'provider-route-1',
        providerRouteName: 'Παλιό όνομα',
        importedAt: createTimestampLike('2026-02-01T12:00:00.000Z'),
        modifiedAt: createTimestampLike('2023-11-14T22:13:20.000Z'),
      },
    });

    const result = await processRouteSyncQueueItem(createQueueItem({
      providerRouteName: 'Εγνατία Ποδηλασία δρόμου',
      providerRouteModifiedAt: 1700000010000,
    }));

    expect(result).toBe(QueueResult.Processed);
    expect(suuntoRouteMocks.exportSuuntoRouteAsGPX).toHaveBeenCalledWith(
      'user-1',
      'provider-route-1',
      { providerUserId: 'suunto-user' },
    );
    expect(upsertSyncedRouteMocks.upsertSyncedRoute).toHaveBeenCalledWith(expect.objectContaining({
      routeID: 'route-doc-1',
      sourceMetadata: expect.objectContaining({
        importedAt: originalImportedAt,
        originalFilename: 'Εγνατία-Ποδηλασία-δρόμου.gpx',
        providerUserId: 'suunto-user',
        providerRouteName: 'Εγνατία Ποδηλασία δρόμου',
      }),
    }));
  });
});
