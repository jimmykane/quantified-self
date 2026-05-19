import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_SYNC_ROUTE_IDS, ACTIVITY_SYNC_ROUTES } from '../../../shared/activity-sync-routes';

const hoisted = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  isServiceReconnectRequiredForUser: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: hoisted.settingsGet,
          })),
        })),
      })),
    })),
  }),
}));

vi.mock('../service-connection-meta', () => ({
  isServiceReconnectRequiredForUser: hoisted.isServiceReconnectRequiredForUser,
}));

import {
  isActivitySyncRouteBlockedByReconnectRequiredForUser,
  isActivitySyncRouteEnabledForUser,
} from './settings';

describe('activity-sync/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.settingsGet.mockResolvedValue({ data: () => ({}) });
    hoisted.isServiceReconnectRequiredForUser.mockResolvedValue(false);
  });

  it('reads enabled route state from user settings', async () => {
    hoisted.settingsGet.mockResolvedValue({
      data: () => ({
        serviceSyncSettings: {
          activitySyncRoutes: {
            [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: { enabled: true },
          },
        },
      }),
    });

    await expect(isActivitySyncRouteEnabledForUser(
      'user-1',
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    )).resolves.toBe(true);
  });

  it('blocks routes when either source or destination service requires reconnect', async () => {
    hoisted.isServiceReconnectRequiredForUser
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(isActivitySyncRouteBlockedByReconnectRequiredForUser(
      'user-1',
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    )).resolves.toBe(true);

    expect(hoisted.isServiceReconnectRequiredForUser).toHaveBeenCalledWith(
      'user-1',
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp].sourceServiceName,
    );
    expect(hoisted.isServiceReconnectRequiredForUser).toHaveBeenCalledWith(
      'user-1',
      ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp].destinationServiceName,
    );
  });

  it('does not block routes when both services are healthy', async () => {
    await expect(isActivitySyncRouteBlockedByReconnectRequiredForUser(
      'user-1',
      ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
    )).resolves.toBe(false);
  });
});
