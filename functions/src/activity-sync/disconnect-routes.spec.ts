import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

const {
  mockOnDocumentDeleted,
  mockCollection,
  mockMetaGet,
  mockSettingsGet,
  mockSettingsSet,
  mockGetUserDeletionGuardStateInTransaction,
  mockRunTransaction,
  mockFieldValueDelete,
  mockUpdateHealthSyncState,
  mockTokenRootGet,
  mockTokenRootRef,
} = vi.hoisted(() => {
  const mockOnDocumentDeleted = vi.fn((_options: unknown, handler: unknown) => handler);
  const mockMetaGet = vi.fn();
  const mockSettingsGet = vi.fn();
  const mockSettingsSet = vi.fn().mockResolvedValue(undefined);
  const mockGetUserDeletionGuardStateInTransaction = vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  });
  const mockRunTransaction = vi.fn();
  const mockTokenRootGet = vi.fn();
  const mockTokenRootRef = { __mockType: 'tokenRoot' };

  const mockCollection = vi.fn((collectionName: string) => {
    if (collectionName !== 'users') {
      throw new Error(`Unexpected collection: ${collectionName}`);
    }

    return {
      doc: vi.fn(() => ({
        collection: vi.fn((subcollectionName: string) => {
          if (subcollectionName === 'meta') {
            return {
              doc: vi.fn((docName: string) => ({
                __mockType: 'meta',
                serviceName: docName,
                get: () => mockMetaGet(docName),
              })),
            };
          }

          if (subcollectionName !== 'config') {
            throw new Error(`Unexpected subcollection: ${subcollectionName}`);
          }

          return {
            doc: vi.fn((docName: string) => {
              if (docName !== 'settings') {
                throw new Error(`Unexpected config doc: ${docName}`);
              }

              return {
                __mockType: 'settings',
                get: mockSettingsGet,
                set: mockSettingsSet,
              };
            }),
          };
        }),
      })),
    };
  });

  return {
    mockOnDocumentDeleted,
    mockCollection,
    mockMetaGet,
    mockSettingsGet,
    mockSettingsSet,
    mockGetUserDeletionGuardStateInTransaction,
    mockRunTransaction,
    mockFieldValueDelete: vi.fn(() => 'DELETE_SENTINEL'),
    mockUpdateHealthSyncState: vi.fn().mockResolvedValue(true),
    mockTokenRootGet,
    mockTokenRootRef,
  };
});

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentDeleted: mockOnDocumentDeleted,
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: mockFieldValueDelete,
  },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  },
}));

vi.mock('../health/writer', () => ({
  updateHealthSyncState: mockUpdateHealthSyncState,
}));

vi.mock('../service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn(() => mockTokenRootRef),
}));

import {
  disableActivitySyncRoutesOnCOROSTokenRootDelete,
  disableActivitySyncRoutesOnGarminTokenRootDelete,
  disableActivitySyncRoutesOnSuuntoTokenRootDelete,
  disableActivitySyncRoutesOnWahooTokenRootDelete,
} from './disconnect-routes';
import {
  disableActivitySyncRoutesForDisconnectedService,
  restoreActivitySyncRoutesForPendingDisconnectClear,
} from './route-cleanup';

describe('activity-sync/disconnect-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (runner: (transaction: {
      get: (ref: { __mockType?: string; serviceName?: string }) => unknown;
      set: typeof mockSettingsSet;
    }) => unknown) => runner({
      get: vi.fn((ref: { __mockType?: string; serviceName?: string }) => (
        ref?.__mockType === 'tokenRoot'
          ? mockTokenRootGet()
          : ref?.__mockType === 'meta'
            ? mockMetaGet(ref.serviceName)
            : mockSettingsGet(ref)
      )),
      set: mockSettingsSet,
    }));
    mockSettingsGet.mockResolvedValue({
      data: () => ({}),
    });
    mockMetaGet.mockResolvedValue({
      exists: false,
      data: () => ({}),
    });
    mockTokenRootGet.mockResolvedValue({
      exists: false,
      data: () => undefined,
    });
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('disables every Garmin activity-sync route when Garmin token root is deleted', async () => {
    await (disableActivitySyncRoutesOnGarminTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI]: {
            enabled: false,
          },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
  });

  it('disables every Suunto activity-sync route when Suunto token root is deleted', async () => {
    await (disableActivitySyncRoutesOnSuuntoTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp]: {
            enabled: false,
          },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: {
            enabled: false,
          },
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: {
            enabled: false,
          },
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
  });

  it('disables every COROS activity-sync route when COROS token root is deleted', async () => {
    await (disableActivitySyncRoutesOnCOROSTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
      time: '2026-04-28T12:34:56.789Z',
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_COROSAPI]: {
            enabled: false,
          },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
    expect(mockUpdateHealthSyncState).toHaveBeenCalledWith(
      'user-1',
      'COROSAPI',
      { status: 'disconnected', lastErrorCode: null },
      Date.parse('2026-04-28T12:34:56.789Z'),
      {
        requiredMissingDocumentRef: mockTokenRootRef,
        updateWhenDocumentFieldEquals: {
          documentRef: expect.objectContaining({
            __mockType: 'meta',
            serviceName: ServiceNames.COROSAPI,
          }),
          field: 'connectionState',
          expectedValue: 'reconnect_required',
          updateValue: {
            status: 'reconnect_required',
            lastErrorCode: 'provider_auth_reconnect_required',
          },
        },
      },
    );
  });

  it('preserves reconnect-required Health state after terminal auth deletes the COROS token root', async () => {
    await (disableActivitySyncRoutesOnCOROSTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
      time: '2026-04-28T12:34:56.789Z',
    });

    expect(mockUpdateHealthSyncState).toHaveBeenCalledWith(
      'user-1',
      'COROSAPI',
      { status: 'disconnected', lastErrorCode: null },
      Date.parse('2026-04-28T12:34:56.789Z'),
      {
        requiredMissingDocumentRef: mockTokenRootRef,
        updateWhenDocumentFieldEquals: {
          documentRef: expect.objectContaining({
            __mockType: 'meta',
            serviceName: ServiceNames.COROSAPI,
          }),
          field: 'connectionState',
          expectedValue: 'reconnect_required',
          updateValue: {
            status: 'reconnect_required',
            lastErrorCode: 'provider_auth_reconnect_required',
          },
        },
      },
    );
  });

  it('ignores a delayed COROS token-root delete after the provider reconnects', async () => {
    mockTokenRootGet.mockResolvedValue({
      exists: true,
      data: () => ({ reconnected: true }),
    });

    await (disableActivitySyncRoutesOnCOROSTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).not.toHaveBeenCalled();
    expect(mockUpdateHealthSyncState).toHaveBeenCalledWith(
      'user-1',
      'COROSAPI',
      { status: 'disconnected', lastErrorCode: null },
      expect.any(Number),
      {
        requiredMissingDocumentRef: mockTokenRootRef,
        updateWhenDocumentFieldEquals: {
          documentRef: expect.any(Object),
          field: 'connectionState',
          expectedValue: 'reconnect_required',
          updateValue: {
            status: 'reconnect_required',
            lastErrorCode: 'provider_auth_reconnect_required',
          },
        },
      },
    );
  });

  it('disables every Wahoo activity-sync route when Wahoo token root is deleted', async () => {
    await (disableActivitySyncRoutesOnWahooTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_COROSAPI]: { enabled: false },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: false },
        },
      },
    }, { merge: true });
  });

  it('does not write route settings when user root does not exist', async () => {
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await (disableActivitySyncRoutesOnGarminTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'missing-user' },
    });

    expect(mockSettingsSet).not.toHaveBeenCalled();
  });

  it('is idempotent when repeated delete events are delivered', async () => {
    const event = { params: { uid: 'user-1' } };

    await (disableActivitySyncRoutesOnGarminTokenRootDelete as unknown as (event: unknown) => Promise<void>)(event);
    await (disableActivitySyncRoutesOnGarminTokenRootDelete as unknown as (event: unknown) => Promise<void>)(event);

    expect(mockSettingsSet).toHaveBeenCalledTimes(2);
    expect(mockSettingsSet).toHaveBeenNthCalledWith(1, expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI]: {
            enabled: false,
          },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
    expect(mockSettingsSet).toHaveBeenNthCalledWith(2, expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: {
            enabled: false,
          },
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI]: {
            enabled: false,
          },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
  });

  it('tracks originally enabled routes when pending disconnect disables route sync', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          activitySyncRoutes: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
          },
          routeDeliverySyncRoutes: {
            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
          },
        },
      }),
    });

    await disableActivitySyncRoutesForDisconnectedService('user-1', ServiceNames.SuuntoApp, {
      trackPendingDisconnectRestore: true,
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: { enabled: false },
          [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp]: { enabled: false },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: false },
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: false },
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: { enabled: false },
        },
        pendingDisconnectRouteRestore: {
          [`activity:${ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp}`]: true,
          [`routeDelivery:${ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI}`]: true,
        },
      },
    }, { merge: true });
  });

  it('preserves pending disconnect restore markers on repeated disable attempts', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          activitySyncRoutes: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
          },
          pendingDisconnectRouteRestore: {
            [`activity:${ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp}`]: true,
          },
        },
      }),
    });

    await disableActivitySyncRoutesForDisconnectedService('user-1', ServiceNames.SuuntoApp, {
      trackPendingDisconnectRestore: true,
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      serviceSyncSettings: expect.objectContaining({
        pendingDisconnectRouteRestore: {
          [`activity:${ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp}`]: true,
        },
      }),
    }), { merge: true });
  });

  it('does not let a stale reconnect incident disable routes after OAuth wins', async () => {
    mockMetaGet.mockResolvedValueOnce({
      data: () => ({
        connectionState: 'connected',
        connectionStateGeneration: 'oauth-generation',
      }),
    });

    await disableActivitySyncRoutesForDisconnectedService('user-1', ServiceNames.WahooAPI, {
      trackPendingDisconnectRestore: true,
      expectedConnectionStateGeneration: 'terminal-failure-generation',
      requiredConnectionState: 'reconnect_required',
    });

    expect(mockSettingsGet).not.toHaveBeenCalled();
    expect(mockSettingsSet).not.toHaveBeenCalled();
  });

  it('reconstructs pending restore state when Firestore retries the disable transaction', async () => {
    mockRunTransaction.mockImplementationOnce(async (runner: (transaction: {
      get: (ref: { __mockType?: string; serviceName?: string }) => unknown;
      set: typeof mockSettingsSet;
    }) => unknown) => {
      const transaction = {
        get: vi.fn((ref: { __mockType?: string; serviceName?: string }) => (
          ref?.__mockType === 'meta'
            ? mockMetaGet(ref.serviceName)
            : mockSettingsGet(ref)
        )),
        set: mockSettingsSet,
      };
      await runner(transaction);
      return runner(transaction);
    });
    mockSettingsGet
      .mockResolvedValueOnce({
        data: () => ({
          serviceSyncSettings: {
            activitySyncRoutes: {
              [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        data: () => ({
          serviceSyncSettings: {
            activitySyncRoutes: {
              [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: false },
            },
          },
        }),
      });

    await disableActivitySyncRoutesForDisconnectedService('user-1', ServiceNames.SuuntoApp, {
      trackPendingDisconnectRestore: true,
    });

    expect(mockSettingsSet).toHaveBeenCalledTimes(2);
    expect(mockSettingsSet.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      serviceSyncSettings: expect.objectContaining({
        pendingDisconnectRouteRestore: {
          [`activity:${ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp}`]: true,
        },
      }),
    }));
    expect(mockSettingsSet.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      serviceSyncSettings: expect.not.objectContaining({
        pendingDisconnectRouteRestore: expect.anything(),
      }),
    }));
  });

  it('restores only routes tracked by pending disconnect recovery', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [`activity:${ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp}`]: true,
            [`routeDelivery:${ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI}`]: true,
            [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: false,
          },
        },
      }),
    });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        pendingDisconnectRouteRestore: {
          [`activity:${ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp}`]: 'DELETE_SENTINEL',
          [`routeDelivery:${ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI}`]: 'DELETE_SENTINEL',
        },
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
        },
        routeDeliverySyncRoutes: {
          [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
        },
      },
    }, { merge: true });
  });

  it('keeps activity and route-delivery restore markers separate for shared route IDs', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          activitySyncRoutes: {
            [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: true },
          },
          routeDeliverySyncRoutes: {
            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: false },
          },
        },
      }),
    });

    await disableActivitySyncRoutesForDisconnectedService('user-1', ServiceNames.SuuntoApp, {
      trackPendingDisconnectRestore: true,
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      serviceSyncSettings: expect.objectContaining({
        pendingDisconnectRouteRestore: {
          [`activity:${ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI}`]: true,
        },
      }),
    }), { merge: true });

    mockSettingsSet.mockClear();
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [`activity:${ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI}`]: true,
          },
        },
      }),
    });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        pendingDisconnectRouteRestore: {
          [`activity:${ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI}`]: 'DELETE_SENTINEL',
        },
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: { enabled: true },
        },
      },
    }, { merge: true });
  });

  it('drops ambiguous legacy restore markers without enabling either shared route kind', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: true,
          },
        },
      }),
    });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        pendingDisconnectRouteRestore: {
          [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: 'DELETE_SENTINEL',
        },
      },
    }, { merge: true });
  });

  it('restores a non-conflicting legacy restore marker', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
          },
        },
      }),
    });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        pendingDisconnectRouteRestore: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: 'DELETE_SENTINEL',
        },
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
        },
      },
    }, { merge: true });
  });

  it('drops an ambiguous service-scoped legacy marker without enabling either shared route kind', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [ServiceNames.SuuntoApp]: {
              [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: true,
            },
          },
        },
      }),
    });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        pendingDisconnectRouteRestore: {
          [ServiceNames.SuuntoApp]: {
            [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: 'DELETE_SENTINEL',
          },
        },
      },
    }, { merge: true });
  });

  it('does not restore a route while the other route service is still unavailable', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
          },
        },
      }),
    });
    mockMetaGet.mockImplementation(async (serviceName: string) => ({
      data: () => (
        serviceName === `${ServiceNames.SuuntoApp}`
          ? {}
          : { connectionState: 'disconnect_pending' }
      ),
    }));

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).not.toHaveBeenCalled();
  });

  it('does not restore reconnect-parked routes after Wahoo was disconnected concurrently', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: true,
          },
        },
      }),
    });
    mockMetaGet.mockResolvedValueOnce({ data: () => ({}) });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.WahooAPI, {
      requireServiceConnected: true,
    });

    expect(mockSettingsSet).not.toHaveBeenCalled();
  });

  it('clears a route-repair marker atomically with the matching generation restore', async () => {
    mockMetaGet.mockImplementation(async (serviceName: string) => ({
      data: () => serviceName === ServiceNames.SuuntoApp
        ? { connectionState: 'connected', connectionStateGeneration: 'connection-generation-1' }
        : {},
    }));
    mockSettingsGet.mockResolvedValueOnce({ data: () => ({}) });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp, {
      requireServiceConnected: true,
      expectedConnectionStateGeneration: 'connection-generation-1',
      clearRouteRestoreMarker: true,
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ __mockType: 'meta' }), {
      routeRestorePending: 'DELETE_SENTINEL',
      routeRestoreParkingClosed: 'DELETE_SENTINEL',
      routeRestoreConnectionGeneration: 'DELETE_SENTINEL',
      routeRestoreLastAttemptAt: 'DELETE_SENTINEL',
      routeRestoreAttemptCount: 'DELETE_SENTINEL',
    }, { merge: true });
  });
});
