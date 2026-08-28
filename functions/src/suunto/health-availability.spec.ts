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
  FUNCTIONS_MANIFEST: { getSuuntoHealthSyncAvailability: { region: 'europe-west2' } },
}));
vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: true,
  enforceAppCheck: hoisted.enforceAppCheck,
}));
vi.mock('./health-flags', () => ({
  isSuuntoHealthSyncEnabled: hoisted.isEnabled,
}));

import { getSuuntoHealthSyncAvailability } from './health-availability';

type AvailabilityHandler = (request: unknown) => Promise<{ available: boolean }>;

describe('getSuuntoHealthSyncAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.isEnabled.mockReturnValue(true);
  });

  it('requires authentication before checking App Check or availability', async () => {
    await expect((getSuuntoHealthSyncAvailability as never as AvailabilityHandler)({ data: {} }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
  });

  it('returns current server availability for every authenticated user', async () => {
    await expect((getSuuntoHealthSyncAvailability as never as AvailabilityHandler)({
      auth: { uid: 'health-user' },
      app: { appId: 'test-app' },
      data: {},
    })).resolves.toEqual({ available: true });
    expect(hoisted.enforceAppCheck).toHaveBeenCalledOnce();
  });

  it('returns unavailable when the rollback switch is off', async () => {
    hoisted.isEnabled.mockReturnValue(false);

    await expect((getSuuntoHealthSyncAvailability as never as AvailabilityHandler)({
      auth: { uid: 'health-user' },
      app: { appId: 'test-app' },
      data: {},
    })).resolves.toEqual({ available: false });
  });
});
