import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  enforceAppCheck: vi.fn(),
  isEnabled: vi.fn(),
  isAllowed: vi.fn(),
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
vi.mock('./health-rollout', () => ({
  isSuuntoHealthSyncUserAllowed: hoisted.isAllowed,
}));

import { getSuuntoHealthSyncAvailability } from './health-availability';

type AvailabilityHandler = (request: unknown) => Promise<{ available: boolean }>;

describe('getSuuntoHealthSyncAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.isEnabled.mockReturnValue(true);
    hoisted.isAllowed.mockReturnValue(true);
  });

  it('requires authentication before checking App Check or rollout membership', async () => {
    await expect((getSuuntoHealthSyncAvailability as never as AvailabilityHandler)({ data: {} }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(hoisted.enforceAppCheck).not.toHaveBeenCalled();
    expect(hoisted.isAllowed).not.toHaveBeenCalled();
  });

  it('returns current server rollout availability for the authenticated user', async () => {
    await expect((getSuuntoHealthSyncAvailability as never as AvailabilityHandler)({
      auth: { uid: 'staged-user' },
      app: { appId: 'test-app' },
      data: {},
    })).resolves.toEqual({ available: true });
    expect(hoisted.enforceAppCheck).toHaveBeenCalledOnce();
    expect(hoisted.isAllowed).toHaveBeenCalledWith('staged-user');
  });

  it('returns unavailable when the rollback switch is off even for an allowlisted user', async () => {
    hoisted.isEnabled.mockReturnValue(false);

    await expect((getSuuntoHealthSyncAvailability as never as AvailabilityHandler)({
      auth: { uid: 'staged-user' },
      app: { appId: 'test-app' },
      data: {},
    })).resolves.toEqual({ available: false });
    expect(hoisted.isAllowed).not.toHaveBeenCalled();
  });
});
