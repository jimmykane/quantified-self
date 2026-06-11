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
      tokenRefs: [{ id: 'token-1', ref: {} }],
      userNames: ['suunto-user'],
    });
    listSuuntoRoutesMock.mockResolvedValue([
      { id: 'route-1', description: 'Morning Route', created: 1700000000000, modified: 1700000005000 },
      { id: 'route-2', description: 'Evening Route', created: 1700000010000, modified: 1700000015000 },
    ]);
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
      tokenRefs: [{ id: 'token-1', ref: {} }],
      userNames: ['suunto-user'],
    });
    expect(enqueueRouteSyncQueueItemMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceServiceName: ServiceNames.SuuntoApp,
      providerUserId: 'suunto-user',
      providerRouteId: 'route-1',
      manual: true,
      firebaseUserID: 'user-1',
    }));
    expect(result).toEqual({
      queuedCount: 1,
      skippedCount: 1,
      failureCount: 0,
      totalCount: 2,
    });
    expect(routeImportMetaSetMock).toHaveBeenCalledWith(expect.objectContaining({
      queuedRoutesFromLastRouteImportCount: 1,
      skippedRoutesFromLastRouteImportCount: 1,
      failedRoutesFromLastRouteImportCount: 0,
      totalRoutesFromLastRouteImportCount: 2,
      didLastRouteImport: expect.any(Number),
    }), { merge: true });
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
