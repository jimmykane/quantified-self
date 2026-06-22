import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';

const {
  mockOnDocumentDeleted,
  mockCollection,
  mockSettingsGet,
  mockSettingsSet,
  mockGetUserDeletionGuardStateInTransaction,
  mockRunTransaction,
  mockFieldValueDelete,
} = vi.hoisted(() => {
  const mockOnDocumentDeleted = vi.fn((_options: unknown, handler: unknown) => handler);
  const mockSettingsGet = vi.fn();
  const mockSettingsSet = vi.fn().mockResolvedValue(undefined);
  const mockGetUserDeletionGuardStateInTransaction = vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  });
  const mockRunTransaction = vi.fn();

  const mockCollection = vi.fn((collectionName: string) => {
    if (collectionName !== 'users') {
      throw new Error(`Unexpected collection: ${collectionName}`);
    }

    return {
      doc: vi.fn(() => ({
        collection: vi.fn((subcollectionName: string) => {
          if (subcollectionName !== 'config') {
            throw new Error(`Unexpected subcollection: ${subcollectionName}`);
          }

          return {
            doc: vi.fn((docName: string) => {
              if (docName !== 'settings') {
                throw new Error(`Unexpected config doc: ${docName}`);
              }

              return {
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
    mockSettingsGet,
    mockSettingsSet,
    mockGetUserDeletionGuardStateInTransaction,
    mockRunTransaction,
    mockFieldValueDelete: vi.fn(() => 'DELETE_SENTINEL'),
  };
});

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentDeleted: mockOnDocumentDeleted,
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(
    () => ({
      collection: mockCollection,
      runTransaction: mockRunTransaction,
    }),
    {
      FieldValue: {
        delete: mockFieldValueDelete,
      },
    },
  ),
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

import {
  disableActivitySyncRoutesOnCOROSTokenRootDelete,
  disableActivitySyncRoutesOnGarminTokenRootDelete,
  disableActivitySyncRoutesOnSuuntoTokenRootDelete,
} from './disconnect-routes';
import {
  disableActivitySyncRoutesForDisconnectedService,
  restoreActivitySyncRoutesForPendingDisconnectClear,
} from './route-cleanup';

describe('activity-sync/disconnect-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (runner: (transaction: {
      get: typeof mockSettingsGet;
      set: typeof mockSettingsSet;
    }) => unknown) => runner({
      get: mockSettingsGet,
      set: mockSettingsSet,
    }));
    mockSettingsGet.mockResolvedValue({
      data: () => ({}),
    });
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('disables Garmin -> Suunto route when Garmin token root is deleted', async () => {
    await (disableActivitySyncRoutesOnGarminTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
  });

  it('disables Garmin -> Suunto route when Suunto token root is deleted', async () => {
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
        },
      },
    }, { merge: true });
  });

  it('disables COROS -> Suunto route when COROS token root is deleted', async () => {
    await (disableActivitySyncRoutesOnCOROSTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: {
            enabled: false,
          },
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
        },
      },
    }, { merge: true });
    expect(mockSettingsSet).toHaveBeenNthCalledWith(2, expect.any(Object), {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
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
        },
        pendingDisconnectRouteRestore: {
          suuntoApp: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
          },
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
            suuntoApp: {
              [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
            },
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
          suuntoApp: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
          },
        },
      }),
    }), { merge: true });
  });

  it('restores only routes tracked by pending disconnect recovery', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          pendingDisconnectRouteRestore: {
            suuntoApp: {
              [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: true,
              [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: false,
            },
          },
        },
      }),
    });

    await restoreActivitySyncRoutesForPendingDisconnectClear('user-1', ServiceNames.SuuntoApp);

    expect(mockSettingsSet).toHaveBeenCalledWith(expect.any(Object), {
      serviceSyncSettings: {
        pendingDisconnectRouteRestore: {
          suuntoApp: 'DELETE_SENTINEL',
        },
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
        },
      },
    }, { merge: true });
  });
});
