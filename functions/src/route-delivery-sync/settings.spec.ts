import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

const { mockSettingsGet } = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: mockSettingsGet,
          })),
        })),
      })),
    })),
  }),
}));

import { isRouteDeliverySyncRouteEnabledForUser } from './settings';

describe('route-delivery-sync/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGet.mockResolvedValue({ data: () => undefined });
  });

  it('defaults route delivery sync routes to disabled when settings are missing', async () => {
    await expect(isRouteDeliverySyncRouteEnabledForUser(
      'user-1',
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
    )).resolves.toBe(false);
  });

  it('returns true only when the route delivery sync route is explicitly enabled', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          routeDeliverySyncRoutes: {
            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
          },
        },
      }),
    });

    await expect(isRouteDeliverySyncRouteEnabledForUser(
      'user-1',
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
    )).resolves.toBe(true);
  });

  it('ignores legacy activity sync route settings for route delivery sync', async () => {
    mockSettingsGet.mockResolvedValueOnce({
      data: () => ({
        serviceSyncSettings: {
          activitySyncRoutes: {
            [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: { enabled: true },
          },
        },
      }),
    });

    await expect(isRouteDeliverySyncRouteEnabledForUser(
      'user-1',
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
    )).resolves.toBe(false);
  });
});
