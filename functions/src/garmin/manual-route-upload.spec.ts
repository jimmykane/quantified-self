import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasProAccess: vi.fn(),
  getUserDeletionGuardState: vi.fn(),
  isServiceDisconnectPendingForUser: vi.fn(),
  decodeManualRouteUpload: vi.fn(),
  getManualRouteInputFormat: vi.fn(),
  parseManualRouteUpload: vi.fn(),
  uploadManualRouteToGarminConnect: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase-functions/v2/https')>();
  return {
    ...actual,
    onCall: (_options: unknown, handler: unknown) => handler,
  };
});

vi.mock('firebase-admin', () => ({
  firestore: vi.fn(),
}));

vi.mock('../utils', () => ({
  ALLOWED_CORS_ORIGINS: [],
  PRO_REQUIRED_MESSAGE: 'Pro subscription required.',
  enforceAppCheck: vi.fn(),
  hasProAccess: (...args: unknown[]) => mocks.hasProAccess(...args),
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: (...args: unknown[]) => mocks.getUserDeletionGuardState(...args),
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));

vi.mock('../service-disconnect-pending', () => ({
  isServiceDisconnectPendingForUser: (...args: unknown[]) => mocks.isServiceDisconnectPendingForUser(...args),
}));

vi.mock('../routes/manual-route-upload', () => ({
  decodeManualRouteUpload: (...args: unknown[]) => mocks.decodeManualRouteUpload(...args),
  getManualRouteInputFormat: (...args: unknown[]) => mocks.getManualRouteInputFormat(...args),
  parseManualRouteUpload: (...args: unknown[]) => mocks.parseManualRouteUpload(...args),
}));

vi.mock('./routes', () => ({
  GarminRouteSendPermissionRequiredError: class GarminRouteSendPermissionRequiredError extends Error {},
  GarminRouteValidationError: class GarminRouteValidationError extends Error {},
  uploadManualRouteToGarminConnect: (...args: unknown[]) => mocks.uploadManualRouteToGarminConnect(...args),
}));

import { importRouteToGarminAPI } from './manual-route-upload';

function request(data: Record<string, unknown>) {
  return {
    auth: { uid: 'user-1' },
    data,
  };
}

describe('importRouteToGarminAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasProAccess.mockResolvedValue(true);
    mocks.getUserDeletionGuardState.mockResolvedValue({ shouldSkip: false });
    mocks.isServiceDisconnectPendingForUser.mockResolvedValue(false);
    mocks.decodeManualRouteUpload.mockReturnValue(Buffer.from('route-source'));
    mocks.getManualRouteInputFormat.mockReturnValue('gpx');
    mocks.parseManualRouteUpload.mockResolvedValue({ name: 'Route file' });
    mocks.uploadManualRouteToGarminConnect.mockResolvedValue({ providerRouteId: 'course-1' });
  });

  it('parses a selected source route and creates a Garmin course without storing delivery metadata', async () => {
    await expect(importRouteToGarminAPI(request({
      file: 'cm91dGUtc291cmNl',
      filename: 'route.gpx',
    }) as never)).resolves.toEqual({ status: 'success', providerRouteId: 'course-1' });

    expect(mocks.getManualRouteInputFormat).toHaveBeenCalledWith('route.gpx', 'Garmin');
    expect(mocks.parseManualRouteUpload).toHaveBeenCalledWith(Buffer.from('route-source'), 'gpx');
    expect(mocks.uploadManualRouteToGarminConnect).toHaveBeenCalledWith(
      'user-1',
      { name: 'Route file' },
      expect.objectContaining({ beforeProviderRequest: expect.any(Function) }),
    );
  });

  it('stops before parsing or calling Garmin while disconnect is pending', async () => {
    mocks.isServiceDisconnectPendingForUser.mockResolvedValue(true);

    await expect(importRouteToGarminAPI(request({
      file: 'cm91dGUtc291cmNl',
      filename: 'route.gpx',
    }) as never)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Garmin disconnect is pending.',
    });

    expect(mocks.decodeManualRouteUpload).not.toHaveBeenCalled();
    expect(mocks.parseManualRouteUpload).not.toHaveBeenCalled();
    expect(mocks.uploadManualRouteToGarminConnect).not.toHaveBeenCalled();
  });
});
