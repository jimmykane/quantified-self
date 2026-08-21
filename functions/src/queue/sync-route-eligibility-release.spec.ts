import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const mocks = vi.hoisted(() => {
  const metaRef = { path: 'users/user-1/meta/wahooAPI' };
  const settingsRef = { path: 'users/user-1/config/settings' };
  const queueRef = { path: 'activitySyncQueue/queue-1' };
  const tokenRootRef = { path: 'wahooAPIAccessTokens/user-1' };
  const transactionUpdate = vi.fn();
  const deletionGuard = vi.fn();
  let metaData: Record<string, unknown> = {};
  let settingsData: Record<string, unknown> = {};
  let queueData: Record<string, unknown> = {};
  let tokenRootData: Record<string, unknown> = {};
  const queueDoc = { ref: queueRef, data: () => queueData };
  return {
    metaRef,
    settingsRef,
    queueRef,
    tokenRootRef,
    queueDoc,
    transactionUpdate,
    deletionGuard,
    get metaData() { return metaData; },
    set metaData(value: Record<string, unknown>) { metaData = value; },
    get settingsData() { return settingsData; },
    set settingsData(value: Record<string, unknown>) { settingsData = value; },
    get queueData() { return queueData; },
    set queueData(value: Record<string, unknown>) { queueData = value; },
    get tokenRootData() { return tokenRootData; },
    set tokenRootData(value: Record<string, unknown>) { tokenRootData = value; },
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: (collectionName: string) => {
      if (collectionName === 'users') {
        return {
          doc: () => ({
            collection: (nestedCollection: string) => ({
              doc: () => nestedCollection === 'meta' ? mocks.metaRef : mocks.settingsRef,
            }),
          }),
        };
      }
      if (collectionName === 'activitySyncQueue') {
        return {
          where: () => ({ get: async () => ({ docs: [mocks.queueDoc] }) }),
        };
      }
      if (collectionName === 'routeDeliverySyncQueue') {
        return {
          where: () => ({ get: async () => ({ docs: [] }) }),
        };
      }
      throw new Error(`Unexpected collection ${collectionName}`);
    },
    runTransaction: async (callback: (transaction: unknown) => unknown) => callback({
      get: vi.fn(async (target: unknown) => {
        if (target === mocks.metaRef) return { exists: true, data: () => mocks.metaData };
        if (target === mocks.settingsRef) return { exists: true, data: () => mocks.settingsData };
        if (target === mocks.queueRef) return { exists: true, data: () => mocks.queueData };
        if (target === mocks.tokenRootRef) {
          return {
            exists: Object.keys(mocks.tokenRootData).length > 0,
            data: () => mocks.tokenRootData,
          };
        }
        throw new Error('Unexpected transaction target');
      }),
      update: mocks.transactionUpdate,
    }),
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => 'delete-field' },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mocks.deletionGuard,
}));

vi.mock('../service-token-store', () => ({
  OAUTH_FLOW_GENERATION_FIELD: 'oauthFlowGeneration',
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD: 'disconnectOperationGeneration',
  getServiceTokenRootDocumentRef: () => mocks.tokenRootRef,
}));

import { releaseQueueItemsDeferredForRouteRestore } from './sync-route-eligibility';

describe('releaseQueueItemsDeferredForRouteRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletionGuard.mockResolvedValue({ shouldSkip: false });
    mocks.metaData = {
      connectionStateGeneration: 'connection-1',
      routeRestorePending: true,
      routeRestoreParkingClosed: true,
    };
    mocks.settingsData = {
      serviceSyncSettings: {
        activitySyncRoutes: {
          routeA: { enabled: true },
        },
      },
    };
    mocks.queueData = {
      processed: true,
      resultStatus: 'deferred',
      deferredReason: 'route_restore_pending',
      deferredContext: JSON.stringify({
        serviceName: ServiceNames.WahooAPI,
        settingsKind: 'activitySyncRoutes',
        routeId: 'routeA',
      }),
    };
    mocks.tokenRootData = {
      activeOAuthCredentialGeneration: 'oauth-generation-1',
    };
  });

  it('reopens parked work only after the matching route restoration completes', async () => {
    await expect(releaseQueueItemsDeferredForRouteRestore(
      'user-1',
      ServiceNames.WahooAPI,
      'connection-1',
    )).resolves.toBe(1);

    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.queueRef, expect.objectContaining({
      processed: false,
      dispatchedToCloudTask: null,
      resultStatus: 'delete-field',
      deferredReason: 'delete-field',
    }));
  });

  it('does not reopen work for a superseded connection generation', async () => {
    mocks.metaData = {
      connectionStateGeneration: 'connection-2',
      routeRestorePending: true,
    };

    await expect(releaseQueueItemsDeferredForRouteRestore(
      'user-1',
      ServiceNames.WahooAPI,
      'connection-1',
    )).resolves.toBe(0);

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('does not reopen work parked for another provider restoration', async () => {
    mocks.queueData = {
      ...mocks.queueData,
      deferredContext: JSON.stringify({
        serviceName: ServiceNames.SuuntoApp,
        settingsKind: 'activitySyncRoutes',
        routeId: 'routeA',
      }),
    };

    await expect(releaseQueueItemsDeferredForRouteRestore(
      'user-1',
      ServiceNames.WahooAPI,
      'connection-1',
    )).resolves.toBe(0);

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('does not reopen parked work after the token-root lifecycle changes', async () => {
    mocks.tokenRootData = {
      activeOAuthCredentialGeneration: 'oauth-generation-2',
    };

    await expect(releaseQueueItemsDeferredForRouteRestore(
      'user-1',
      ServiceNames.WahooAPI,
      'connection-1',
      {
        disconnectGeneration: null,
        oauthCredentialGeneration: 'oauth-generation-1',
        oauthFlowGeneration: null,
        disconnectOperationGeneration: null,
      },
    )).resolves.toBe(0);

    expect(mocks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('finalizes parked work when restoration confirms the route remains disabled', async () => {
    mocks.settingsData = {
      serviceSyncSettings: {
        activitySyncRoutes: {
          routeA: { enabled: false },
        },
      },
    };

    await expect(releaseQueueItemsDeferredForRouteRestore(
      'user-1',
      ServiceNames.WahooAPI,
      'connection-1',
    )).resolves.toBe(1);

    expect(mocks.transactionUpdate).toHaveBeenCalledWith(mocks.queueRef, expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
      skippedReason: 'route_disabled',
      destinationUploadContinuation: null,
    }));
  });
});
