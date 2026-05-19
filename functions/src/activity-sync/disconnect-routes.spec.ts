import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';

const {
  mockOnDocumentDeleted,
  mockCollection,
  mockSettingsSet,
  mockGetUserDeletionGuardState,
} = vi.hoisted(() => {
  const mockOnDocumentDeleted = vi.fn((_options: unknown, handler: unknown) => handler);
  const mockSettingsSet = vi.fn().mockResolvedValue(undefined);
  const mockGetUserDeletionGuardState = vi.fn().mockResolvedValue({
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
  });

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
    mockSettingsSet,
    mockGetUserDeletionGuardState,
  };
});

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentDeleted: mockOnDocumentDeleted,
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(
    () => ({
      collection: mockCollection,
    }),
    {
      FieldValue: {},
    },
  ),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mockGetUserDeletionGuardState,
}));

import {
  disableActivitySyncRoutesOnCOROSTokenRootDelete,
  disableActivitySyncRoutesOnGarminTokenRootDelete,
  disableActivitySyncRoutesOnSuuntoTokenRootDelete,
} from './disconnect-routes';

describe('activity-sync/disconnect-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('disables Garmin -> Suunto route when Garmin token root is deleted', async () => {
    await (disableActivitySyncRoutesOnGarminTokenRootDelete as unknown as (event: unknown) => Promise<void>)({
      params: { uid: 'user-1' },
    });

    expect(mockSettingsSet).toHaveBeenCalledWith({
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

    expect(mockSettingsSet).toHaveBeenCalledWith({
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

    expect(mockSettingsSet).toHaveBeenCalledWith({
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
    mockGetUserDeletionGuardState.mockResolvedValueOnce({
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
    expect(mockSettingsSet).toHaveBeenNthCalledWith(1, {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
    expect(mockSettingsSet).toHaveBeenNthCalledWith(2, {
      serviceSyncSettings: {
        activitySyncRoutes: {
          [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
            enabled: false,
          },
        },
      },
    }, { merge: true });
  });
});
