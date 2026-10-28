'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ProviderQueueUserNotConnectedError } from '../queue/provider-queue-errors';
import { UserDeletionGuardReadError } from '../shared/user-deletion-guard';
import * as logger from 'firebase-functions/logger';
import { buildRouteSyncQueueItemId } from '../routes/route-sync-queue';

const enqueueRouteSyncQueueItemMock = vi.fn();
const createSuuntoRouteUploadContextMock = vi.fn();
const listSuuntoRoutesMock = vi.fn();
const verifySuuntoWebhookSignatureMock = vi.fn();
const hasProAccessMock = vi.fn();
const enforceAppCheckMock = vi.fn();
const routeImportMetaSetMock = vi.fn();
const deleteFieldSentinel = { __op: 'delete' };
let resolvedWebhookUserIDs = ['firebase-user-1'];
const resolveActiveSuuntoWebhookUserIDsMock = vi.fn();

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('./webhook-signature', () => ({
  verifySuuntoWebhookSignature: (...args: any[]) => verifySuuntoWebhookSignatureMock(...args),
}));

vi.mock('../routes/route-sync-queue', async (importOriginal) => ({
  ...await importOriginal<typeof import('../routes/route-sync-queue')>(),
  enqueueRouteSyncQueueItem: (...args: any[]) => enqueueRouteSyncQueueItemMock(...args),
}));

vi.mock('./health-webhook-binding-lifecycle', () => ({
  resolveActiveSuuntoWebhookUserIDs: (...args: any[]) => resolveActiveSuuntoWebhookUserIDsMock(...args),
}));

vi.mock('./routes', () => ({
  createSuuntoRouteUploadContext: (...args: any[]) => createSuuntoRouteUploadContextMock(...args),
  listSuuntoRoutes: (...args: any[]) => listSuuntoRoutesMock(...args),
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    enforceAppCheck: (...args: any[]) => enforceAppCheckMock(...args),
    hasProAccess: (...args: any[]) => hasProAccessMock(...args),
  };
});

vi.mock('firebase-functions/v1', () => ({
  default: {},
  region: () => ({
    runWith: () => ({
      https: {
        onRequest: (_handler: unknown, maybeHandler?: unknown) => (
          typeof maybeHandler === 'function' ? maybeHandler : _handler
        ),
      },
    }),
  }),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            set: routeImportMetaSetMock,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: () => deleteFieldSentinel,
  },
}));

import { addSuuntoAppRoutesToQueue, insertSuuntoAppRouteToQueue } from './route-sync';

function createWebhookResponse() {
  const response = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return response;
}

describe('Suunto route sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasProAccessMock.mockResolvedValue(true);
    enforceAppCheckMock.mockReturnValue(undefined);
    verifySuuntoWebhookSignatureMock.mockReturnValue(true);
    resolvedWebhookUserIDs = ['firebase-user-1'];
    resolveActiveSuuntoWebhookUserIDsMock.mockReset().mockImplementation(async () => resolvedWebhookUserIDs);
    createSuuntoRouteUploadContextMock.mockResolvedValue({
      tokenRefs: [
        { id: 'token-1', ref: {}, providerUserId: 'suunto-user-1', sourceKey: 'suunto-user-1:1700000000000' },
        { id: 'token-2', ref: {}, providerUserId: 'suunto-user-2', sourceKey: 'suunto-user-2:1710000000000' },
      ],
      userNames: ['suunto-user-1', 'suunto-user-2'],
    });
    listSuuntoRoutesMock.mockResolvedValue({
      routes: [
        { id: 'route-1', providerUserId: 'suunto-user-1', providerSourceKey: 'suunto-user-1:1700000000000', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
        { id: 'route-2', providerUserId: 'suunto-user-2', providerSourceKey: 'suunto-user-2:1710000000000', description: 'Evening Route', created: 1700000010000, modified: 1700000015000 },
      ],
      successfulProviderUserIds: ['suunto-user-1', 'suunto-user-2'],
      failedProviderUserIds: [],
      successfulProviderSourceKeys: ['suunto-user-1:1700000000000', 'suunto-user-2:1710000000000'],
      failedProviderSourceKeys: [],
    });
    enqueueRouteSyncQueueItemMock.mockReset()
      .mockResolvedValueOnce({ enqueued: true, queueItemId: 'queue-1' })
      .mockResolvedValueOnce({ enqueued: false, queueItemId: 'queue-2', reason: 'already_pending' });
    routeImportMetaSetMock.mockResolvedValue(undefined);
  });

  it('queues current Suunto routes for the authenticated Pro user and stores the summary', async () => {
    const result = await addSuuntoAppRoutesToQueue({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {},
    } as any);

    expect(createSuuntoRouteUploadContextMock).toHaveBeenCalledWith('user-1');
    expect(listSuuntoRoutesMock).toHaveBeenCalledWith('user-1', {
      tokenRefs: [
        { id: 'token-1', ref: {}, providerUserId: 'suunto-user-1', sourceKey: 'suunto-user-1:1700000000000' },
        { id: 'token-2', ref: {}, providerUserId: 'suunto-user-2', sourceKey: 'suunto-user-2:1710000000000' },
      ],
      userNames: ['suunto-user-1', 'suunto-user-2'],
    });
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: 'suunto-user-1',
      providerRouteId: 'route-1',
      manual: true,
      firebaseUserID: 'user-1',
    }));
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: 'suunto-user-2',
      providerRouteId: 'route-2',
      manual: true,
      firebaseUserID: 'user-1',
    }));
    expect(result).toEqual({
      queuedCount: 1,
      skippedCount: 1,
      failureCount: 0,
      failedProviderCount: 0,
      totalCount: 2,
    });
    expect(routeImportMetaSetMock).toHaveBeenCalledWith(expect.objectContaining({
      queuedRoutesFromLastRouteImportCount: 1,
      skippedRoutesFromLastRouteImportCount: 1,
      failedRoutesFromLastRouteImportCount: 0,
      failedRouteImportProviderCount: 0,
      totalRoutesFromLastRouteImportCount: 2,
      didLastRouteImport: expect.any(Number),
      routeImportStatesByProviderSourceKey: [
        expect.objectContaining({
          sourceKey: 'suunto-user-1:1700000000000',
          providerUserId: 'suunto-user-1',
          queuedCount: 1,
          skippedCount: 0,
          failureCount: 0,
          totalCount: 1,
          didLastRouteImport: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
        expect.objectContaining({
          sourceKey: 'suunto-user-2:1710000000000',
          providerUserId: 'suunto-user-2',
          queuedCount: 0,
          skippedCount: 1,
          failureCount: 0,
          totalCount: 1,
          didLastRouteImport: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      ],
      routeImportStatesByProviderUserId: deleteFieldSentinel,
    }), { merge: true });
  });

  it('preserves partial provider failures in the catch-up summary and completion metadata', async () => {
    listSuuntoRoutesMock.mockResolvedValueOnce({
      routes: [
        { id: 'route-1', providerUserId: 'suunto-user-1', providerSourceKey: 'suunto-user-1:1700000000000', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
      ],
      successfulProviderUserIds: ['suunto-user-1'],
      failedProviderUserIds: ['suunto-user-2'],
      successfulProviderSourceKeys: ['suunto-user-1:1700000000000'],
      failedProviderSourceKeys: ['suunto-user-2:1710000000000'],
    });
    enqueueRouteSyncQueueItemMock.mockReset();
    enqueueRouteSyncQueueItemMock.mockResolvedValueOnce({ enqueued: true, queueItemId: 'queue-1' });

    const result = await addSuuntoAppRoutesToQueue({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {},
    } as any);

    expect(result).toEqual({
      queuedCount: 1,
      skippedCount: 0,
      failureCount: 0,
      failedProviderCount: 1,
      totalCount: 1,
    });
    expect(routeImportMetaSetMock).toHaveBeenCalledWith(expect.objectContaining({
      queuedRoutesFromLastRouteImportCount: 1,
      skippedRoutesFromLastRouteImportCount: 0,
      failedRoutesFromLastRouteImportCount: 0,
      failedRouteImportProviderCount: 1,
      totalRoutesFromLastRouteImportCount: 1,
      routeImportStatesByProviderSourceKey: [
        expect.objectContaining({
          sourceKey: 'suunto-user-1:1700000000000',
          providerUserId: 'suunto-user-1',
          queuedCount: 1,
          skippedCount: 0,
          failureCount: 0,
          totalCount: 1,
          didLastRouteImport: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      ],
      routeImportStatesByProviderUserId: deleteFieldSentinel,
      didLastRouteImport: deleteFieldSentinel,
    }), { merge: true });
  });

  it('does not mark a provider complete when some of its route queue writes fail', async () => {
    listSuuntoRoutesMock.mockResolvedValueOnce({
      routes: [
        { id: 'route-1', providerUserId: 'suunto-user-1', providerSourceKey: 'suunto-user-1:1700000000000', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
        { id: 'route-2', providerUserId: 'suunto-user-1', providerSourceKey: 'suunto-user-1:1700000000000', description: 'Evening Route', created: 1700000001000, modified: 1700000006000 },
      ],
      successfulProviderUserIds: ['suunto-user-1'],
      failedProviderUserIds: [],
      successfulProviderSourceKeys: ['suunto-user-1:1700000000000'],
      failedProviderSourceKeys: [],
    });
    enqueueRouteSyncQueueItemMock.mockReset();
    enqueueRouteSyncQueueItemMock.mockResolvedValueOnce({ enqueued: true, queueItemId: 'queue-1' });
    enqueueRouteSyncQueueItemMock.mockRejectedValueOnce(new Error('queue failed'));

    const result = await addSuuntoAppRoutesToQueue({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {},
    } as any);

    expect(result).toEqual({
      queuedCount: 1,
      skippedCount: 0,
      failureCount: 1,
      failedProviderCount: 0,
      totalCount: 2,
    });

    const updatePayload = routeImportMetaSetMock.mock.calls.at(-1)?.[0];
    expect(updatePayload).toMatchObject({
      queuedRoutesFromLastRouteImportCount: 1,
      skippedRoutesFromLastRouteImportCount: 0,
      failedRoutesFromLastRouteImportCount: 1,
      failedRouteImportProviderCount: 0,
      totalRoutesFromLastRouteImportCount: 2,
      routeImportStatesByProviderSourceKey: [
        expect.objectContaining({
          sourceKey: 'suunto-user-1:1700000000000',
          providerUserId: 'suunto-user-1',
          queuedCount: 1,
          skippedCount: 0,
          failureCount: 1,
          totalCount: 2,
          updatedAt: expect.any(Number),
        }),
      ],
      routeImportStatesByProviderUserId: deleteFieldSentinel,
      didLastRouteImport: deleteFieldSentinel,
    });
    expect(updatePayload.routeImportStatesByProviderSourceKey[0]).not.toHaveProperty('didLastRouteImport');
  });

  it('rejects manual route catch-up for unauthenticated or non-Pro users', async () => {
    await expect(addSuuntoAppRoutesToQueue({
      auth: null,
      app: { appId: 'app-1' },
      data: {},
    } as any)).rejects.toMatchObject({ code: 'unauthenticated' });

    hasProAccessMock.mockResolvedValueOnce(false);
    await expect(addSuuntoAppRoutesToQueue({
      auth: { uid: 'user-1' },
      app: { appId: 'app-1' },
      data: {},
    } as any)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects invalid route webhook signatures', async () => {
    verifySuuntoWebhookSignatureMock.mockReturnValueOnce(false);
    const response = createWebhookResponse();

    await insertSuuntoAppRouteToQueue({
      rawBody: Buffer.from('invalid'),
      body: {},
      get: vi.fn().mockReturnValue('bad-signature'),
      headers: {},
    } as any, response as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(enqueueRouteSyncQueueItemMock).not.toHaveBeenCalled();
  });

  it('queues valid route webhook notifications and soft-skips disconnected users', async () => {
    const response = createWebhookResponse();

    await insertSuuntoAppRouteToQueue({
      rawBody: Buffer.from('payload'),
      body: {
        username: 'suunto-user',
        route: {
          id: 'route-1',
          description: 'Morning Route',
          created: 1700000000000,
          modified: 1700000005000,
        },
      },
      get: vi.fn().mockReturnValue('valid-signature'),
      headers: {},
    } as any, response as any);

    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: 'suunto-user',
      providerRouteId: 'route-1',
      providerRouteName: 'Morning Route',
      manual: false,
      firebaseUserID: 'firebase-user-1',
    }));
    expect(response.status).toHaveBeenCalledWith(200);

    enqueueRouteSyncQueueItemMock.mockReset();
    enqueueRouteSyncQueueItemMock.mockRejectedValueOnce(
      new ProviderQueueUserNotConnectedError(ServiceNames.SuuntoApp, 'suunto-user', 'queue-1'),
    );
    const skippedResponse = createWebhookResponse();

    await insertSuuntoAppRouteToQueue({
      rawBody: Buffer.from('payload'),
      body: {
        username: 'suunto-user',
        route: {
          id: 'route-2',
        },
      },
      get: vi.fn().mockReturnValue('valid-signature'),
      headers: {},
    } as any, skippedResponse as any);

    expect(skippedResponse.status).toHaveBeenCalledWith(200);
  });

  it('fans out shared-account route notifications to every active owner', async () => {
    resolvedWebhookUserIDs = ['firebase-user-1', 'firebase-user-2'];
    enqueueRouteSyncQueueItemMock.mockReset();
    enqueueRouteSyncQueueItemMock.mockResolvedValue({
      enqueued: true,
      queueItemId: 'queue-id',
    });
    const response = createWebhookResponse();

    await insertSuuntoAppRouteToQueue({
      rawBody: Buffer.from('payload'),
      body: {
        username: 'shared-suunto-user',
        route: { id: 'shared-route' },
      },
      get: vi.fn().mockReturnValue('valid-signature'),
      headers: {},
    } as any, response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledTimes(2);
    // Asynchronous queue-ID hashing can reorder enqueue calls between recipients.
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledWith(expect.objectContaining({
      providerUserId: 'shared-suunto-user',
      providerRouteId: 'shared-route',
      firebaseUserID: 'firebase-user-1',
    }));
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledWith(expect.objectContaining({
      providerUserId: 'shared-suunto-user',
      providerRouteId: 'shared-route',
      firebaseUserID: 'firebase-user-2',
    }));
  });

  it('returns a retryable response when any route owner queue write fails transiently', async () => {
    resolvedWebhookUserIDs = ['firebase-user-1', 'firebase-user-2'];
    enqueueRouteSyncQueueItemMock.mockReset();
    enqueueRouteSyncQueueItemMock
      .mockResolvedValueOnce({ enqueued: true, queueItemId: 'queue-1' })
      .mockRejectedValueOnce(new Error('queue unavailable'));
    const response = createWebhookResponse();

    await insertSuuntoAppRouteToQueue({
      rawBody: Buffer.from('payload'),
      body: {
        username: 'shared-suunto-user',
        route: { id: 'shared-route' },
      },
      get: vi.fn().mockReturnValue('valid-signature'),
      headers: {},
    } as any, response as any);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledTimes(2);
  });

  it('correlates a transaction failure with redelivery and the canonical worker job without leaking private data', async () => {
    const request = {
      rawBody: Buffer.from('private payload'),
      body: { username: 'private-provider-user', route: { id: 'private-route', description: 'Private route name', modified: 123 } },
      get: vi.fn().mockReturnValue('private-signature'),
      headers: {},
    };
    const queueItemId = await buildRouteSyncQueueItemId(ServiceNames.SuuntoApp, 'private-provider-user', 'private-route', 'firebase-user-1');
    enqueueRouteSyncQueueItemMock.mockReset().mockRejectedValueOnce(new UserDeletionGuardReadError(
      'firebase-user-1', 'route_sync_queue_transaction', Object.assign(new Error('private original error'), { code: 10 }),
    )).mockResolvedValueOnce({ enqueued: false, queueItemId, reason: 'already_pending' });

    const failed = createWebhookResponse();
    await insertSuuntoAppRouteToQueue(request as any, failed as any);
    const failure = vi.mocked(logger.error).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(failed.status).toHaveBeenCalledWith(500);
    expect(failure).toEqual({ notificationId: expect.stringMatching(/^[a-f0-9]{64}$/), phase: 'enqueue',
      failedQueueItemIds: [queueItemId], statusCode: 500, errorCode: 10 });
    expect(logger.info).not.toHaveBeenCalledWith('Fanned out signed Suunto route webhook.', expect.anything());

    const recovered = createWebhookResponse();
    await insertSuuntoAppRouteToQueue(request as any, recovered as any);
    expect(recovered.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith('[SuuntoRouteWebhook] Queue result', {
      notificationId: failure.notificationId, queueItemId, outcome: 'already_pending',
    });
    expect(logger.info).toHaveBeenCalledWith('Fanned out signed Suunto route webhook.', expect.objectContaining({
      notificationId: failure.notificationId, statusCode: 200,
    }));
    const logs = JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls, vi.mocked(logger.error).mock.calls]);
    for (const privateValue of ['private-provider-user', 'private-route', 'Private route name', 'private payload',
      'private-signature', 'private original error', 'firebase-user-1']) expect(logs).not.toContain(privateValue);
  });

  it.each([
    { order: 'forward', recipients: ['firebase-user-1', 'firebase-user-2'], failedUserID: 'firebase-user-1' },
    { order: 'forward', recipients: ['firebase-user-1', 'firebase-user-2'], failedUserID: 'firebase-user-2' },
    { order: 'reverse', recipients: ['firebase-user-2', 'firebase-user-1'], failedUserID: 'firebase-user-1' },
    { order: 'reverse', recipients: ['firebase-user-2', 'firebase-user-1'], failedUserID: 'firebase-user-2' },
  ])('identifies only $failedUserID with $order recipient order after partial fan-out', async ({ recipients, failedUserID }) => {
    resolvedWebhookUserIDs = recipients;
    enqueueRouteSyncQueueItemMock.mockReset()
      .mockImplementation(async ({ firebaseUserID }: { firebaseUserID: string }) => {
        if (firebaseUserID === failedUserID) {
          throw Object.assign(new Error('private failure'), { code: 'private-code' });
        }
        return { enqueued: true, queueItemId: 'ignored' };
      });
    const response = createWebhookResponse();
    await insertSuuntoAppRouteToQueue({ body: { username: 'shared-user', route: { id: 'shared-route' } },
      rawBody: Buffer.from('payload'), get: vi.fn(), headers: {} } as any, response as any);
    const failedId = await buildRouteSyncQueueItemId(ServiceNames.SuuntoApp, 'shared-user', 'shared-route', failedUserID);
    const successfulUserID = recipients[0] === failedUserID ? recipients[1] : recipients[0];
    const successfulId = await buildRouteSyncQueueItemId(ServiceNames.SuuntoApp, 'shared-user', 'shared-route', successfulUserID);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('[SuuntoRouteWebhook] Notification failed', expect.objectContaining({
      failedQueueItemIds: [failedId], errorCode: 'unknown',
    }));
    expect(logger.info).toHaveBeenCalledWith('[SuuntoRouteWebhook] Queue result', {
      notificationId: expect.stringMatching(/^[a-f0-9]{64}$/), queueItemId: successfulId, outcome: 'enqueued',
    });
  });

  it('logs safe binding-lookup failures before a queue ID can be resolved', async () => {
    resolveActiveSuuntoWebhookUserIDsMock.mockRejectedValueOnce(Object.assign(new Error('private lookup failure'), { code: 14 }));
    const response = createWebhookResponse();
    await insertSuuntoAppRouteToQueue({ body: { username: 'private-user', route: { id: 'private-id' } },
      rawBody: Buffer.from('payload'), get: vi.fn(), headers: {} } as any, response as any);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(enqueueRouteSyncQueueItemMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[SuuntoRouteWebhook] Notification failed', {
      notificationId: expect.stringMatching(/^[a-f0-9]{64}$/), phase: 'binding_lookup',
      failedQueueItemIds: [], statusCode: 500, errorCode: 14,
    });
  });

  it.each([
    [{ enqueued: true }, 'enqueued'],
    [{ enqueued: false, redispatched: true }, 'redispatched'],
    [{ enqueued: false, reason: 'user_deleted_or_deleting' }, 'skipped'],
  ])('logs queue outcome %s without claiming a completed import', async (result, outcome) => {
    enqueueRouteSyncQueueItemMock.mockReset().mockResolvedValue({ ...result, queueItemId: 'ignored' });
    const response = createWebhookResponse();
    await insertSuuntoAppRouteToQueue({ body: { username: 'suunto-user', route: { id: 'route-id' } },
      rawBody: Buffer.from('payload'), get: vi.fn(), headers: {} } as any, response as any);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith('[SuuntoRouteWebhook] Queue result', {
      notificationId: expect.stringMatching(/^[a-f0-9]{64}$/),
      queueItemId: await buildRouteSyncQueueItemId(ServiceNames.SuuntoApp, 'suunto-user', 'route-id', 'firebase-user-1'), outcome,
    });
  });

  it('does not retry durable work if the new queue diagnostic logger fails', async () => {
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('logging unavailable'); });
    const response = createWebhookResponse();
    await insertSuuntoAppRouteToQueue({ body: { username: 'suunto-user', route: { id: 'route-id' } },
      rawBody: Buffer.from('payload'), get: vi.fn(), headers: {} } as any, response as any);
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
