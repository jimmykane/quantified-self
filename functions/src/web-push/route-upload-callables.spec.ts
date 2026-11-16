import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { beginRouteDeliveryNotification, completeRouteDeliveryNotification } from './route-delivery-service';
import { importRouteToGarminAPI } from '../garmin/manual-route-upload';
import { importRouteToSuuntoApp } from '../suunto/routes';
import { importRouteToCOROSAPI } from '../coros/routes';
import { importRouteToWahooAPI } from '../wahoo/routes';

vi.mock('firebase-functions/v2/https', async importOriginal => ({
  ...await importOriginal<typeof import('firebase-functions/v2/https')>(),
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-admin/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase-admin/firestore')>(), getFirestore: () => ({}),
}));
vi.mock('../utils', async importOriginal => ({
  ...await importOriginal<typeof import('../utils')>(), hasProAccess: vi.fn(async () => true), enforceAppCheck: vi.fn(),
}));
vi.mock('../shared/user-deletion-guard', async importOriginal => ({
  ...await importOriginal<typeof import('../shared/user-deletion-guard')>(),
  getUserDeletionGuardState: vi.fn(async () => ({ shouldSkip: false })),
}));
vi.mock('../service-disconnect-pending', () => ({ isServiceDisconnectPendingForUser: vi.fn(async () => false) }));
vi.mock('../../../shared/coros-rollout', () => ({ isCOROSRouteUploadUIDAllowlisted: () => true }));
vi.mock('./route-delivery-service', () => ({ beginRouteDeliveryNotification: vi.fn(), completeRouteDeliveryNotification: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000001';
const ticket = { uid: 'owner', id, index: 0, hash: 'hash' };
describe('manual route upload rejection notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(beginRouteDeliveryNotification).mockResolvedValue(ticket);
    vi.mocked(completeRouteDeliveryNotification).mockResolvedValue();
  });
  it.each([
    [ServiceNames.GarminAPI, importRouteToGarminAPI, 'route.gpx.gz', 'R1BY'],
    [ServiceNames.SuuntoApp, importRouteToSuuntoApp, 'route.gpx', 'invalid base64!'],
    [ServiceNames.COROSAPI, importRouteToCOROSAPI, 'route.gpx', 'invalid base64!'],
    [ServiceNames.WahooAPI, importRouteToWahooAPI, 'route.gpx', 'invalid base64!'],
  ] as const)('includes a first-file validation failure in the %s batch without changing the rejection', async (service, callable, filename, file) => {
    await expect(callable({ auth: { uid: 'owner', token: {} }, app: { appId: 'test-app' },
      rawRequest: { headers: { origin: 'https://beta.quantified-self.io' } }, data: {
        filename, file, notification: { requestId: id, createdAtMs: 1, totalRoutes: 2, chunkIndex: 0 },
      } } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(beginRouteDeliveryNotification).toHaveBeenCalledWith('owner', service,
      expect.objectContaining({ requestId: id, totalRoutes: 2, chunkIndex: 0 }), expect.any(Array), false, expect.any(Object));
    expect(completeRouteDeliveryNotification).toHaveBeenCalledWith(ticket,
      expect.objectContaining({ destinationServiceName: service, failureCount: 1, successCount: 0 }), 0, expect.any(Object));
  });
});
