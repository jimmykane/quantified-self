import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  enforceAppCheck: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class MockHttpsError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: { getGarminHealthSyncAvailability: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: true,
  enforceAppCheck: hoisted.enforceAppCheck,
}));
vi.mock('./health-flags', () => ({
  isGarminHealthSyncEnabled: hoisted.isEnabled,
}));

import { getGarminHealthSyncAvailability } from './health-availability';

type AvailabilityHandler = (request: unknown) => Promise<{ available: boolean }>;

describe('getGarminHealthSyncAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.isEnabled.mockReturnValue(true);
  });

  it('requires authentication', async () => {
    await expect((getGarminHealthSyncAvailability as never as AvailabilityHandler)({ data: {} }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('reports the production-wide rollback switch for every authenticated user', async () => {
    const request = { auth: { uid: 'health-user' }, app: { appId: 'test-app' }, data: {} };

    await expect((getGarminHealthSyncAvailability as never as AvailabilityHandler)(request))
      .resolves.toEqual({ available: true });

    hoisted.isEnabled.mockReturnValue(false);
    await expect((getGarminHealthSyncAvailability as never as AvailabilityHandler)(request))
      .resolves.toEqual({ available: false });
  });
});
