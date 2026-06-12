'use strict';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ProviderQueueUserNotConnectedError } from '../queue/provider-queue-errors';

const enqueueRouteSyncQueueItemMock = vi.fn();
const createSuuntoRouteUploadContextMock = vi.fn();
const listSuuntoRoutesMock = vi.fn();
const verifySuuntoWebhookSignatureMock = vi.fn();
const hasProAccessMock = vi.fn();
const enforceAppCheckMock = vi.fn();
const routeImportMetaSetMock = vi.fn();

vi.mock('./webhook-signature', () => ({
  verifySuuntoWebhookSignature: (...args: any[]) => verifySuuntoWebhookSignatureMock(...args),
}));

vi.mock('../routes/route-sync-queue', () => ({
  enqueueRouteSyncQueueItem: (...args: any[]) => enqueueRouteSyncQueueItemMock(...args),
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
    createSuuntoRouteUploadContextMock.mockResolvedValue({
      tokenRefs: [
        { id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' },
        { id: 'token-2', ref: {}, providerUserId: 'suunto-user-2' },
      ],
      userNames: ['suunto-user-1', 'suunto-user-2'],
    });
    listSuuntoRoutesMock.mockResolvedValue({
      routes: [
        { id: 'route-1', providerUserId: 'suunto-user-1', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
        { id: 'route-2', providerUserId: 'suunto-user-2', description: 'Evening Route', created: 1700000010000, modified: 1700000015000 },
      ],
      successfulProviderUserIds: ['suunto-user-1', 'suunto-user-2'],
      failedProviderUserIds: [],
    });
    enqueueRouteSyncQueueItemMock
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
        { id: 'token-1', ref: {}, providerUserId: 'suunto-user-1' },
        { id: 'token-2', ref: {}, providerUserId: 'suunto-user-2' },
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
      routeImportStatesByProviderUserId: {
        'suunto-user-1': expect.objectContaining({
          queuedCount: 1,
          skippedCount: 0,
          failureCount: 0,
          totalCount: 1,
          didLastRouteImport: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
        'suunto-user-2': expect.objectContaining({
          queuedCount: 0,
          skippedCount: 1,
          failureCount: 0,
          totalCount: 1,
          didLastRouteImport: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      },
    }), { merge: true });
  });

  it('preserves partial provider failures in the catch-up summary and completion metadata', async () => {
    listSuuntoRoutesMock.mockResolvedValueOnce({
      routes: [
        { id: 'route-1', providerUserId: 'suunto-user-1', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
      ],
      successfulProviderUserIds: ['suunto-user-1'],
      failedProviderUserIds: ['suunto-user-2'],
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
      routeImportStatesByProviderUserId: {
        'suunto-user-1': expect.objectContaining({
          queuedCount: 1,
          skippedCount: 0,
          failureCount: 0,
          totalCount: 1,
          didLastRouteImport: expect.any(Number),
          updatedAt: expect.any(Number),
        }),
      },
    }), { merge: true });
    expect(routeImportMetaSetMock).not.toHaveBeenCalledWith(expect.objectContaining({
      didLastRouteImport: expect.any(Number),
      failedRouteImportProviderCount: 1,
    }), { merge: true });
  });

  it('does not mark a provider complete when some of its route queue writes fail', async () => {
    listSuuntoRoutesMock.mockResolvedValueOnce({
      routes: [
        { id: 'route-1', providerUserId: 'suunto-user-1', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
        { id: 'route-2', providerUserId: 'suunto-user-1', description: 'Evening Route', created: 1700000001000, modified: 1700000006000 },
      ],
      successfulProviderUserIds: ['suunto-user-1'],
      failedProviderUserIds: [],
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
      routeImportStatesByProviderUserId: {
        'suunto-user-1': expect.objectContaining({
          queuedCount: 1,
          skippedCount: 0,
          failureCount: 1,
          totalCount: 2,
          updatedAt: expect.any(Number),
        }),
      },
    });
    expect(updatePayload).not.toHaveProperty('didLastRouteImport');
    expect(updatePayload.routeImportStatesByProviderUserId['suunto-user-1']).not.toHaveProperty('didLastRouteImport');
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
});
