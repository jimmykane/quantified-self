import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  hasProAccess: vi.fn(),
  isServiceDisconnectManualReviewRequiredForUser: vi.fn(),
  getServiceConnectionMeta: vi.fn(),
}));

vi.mock('./utils', () => ({
  hasProAccess: hoisted.hasProAccess,
}));

vi.mock('./service-disconnect-pending', () => ({
  isServiceDisconnectManualReviewRequiredForUser: hoisted.isServiceDisconnectManualReviewRequiredForUser,
}));

vi.mock('./service-connection-meta', () => ({
  getServiceConnectionMeta: hoisted.getServiceConnectionMeta,
}));

import { hasServiceOAuthConnectAccess } from './service-oauth-access';

describe('service-oauth-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasProAccess.mockResolvedValue(false);
    hoisted.isServiceDisconnectManualReviewRequiredForUser.mockResolvedValue(false);
    hoisted.getServiceConnectionMeta.mockResolvedValue(null);
  });

  it('allows OAuth for Pro users without reading pending manual-review state', async () => {
    hoisted.hasProAccess.mockResolvedValue(true);

    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.SuuntoApp)).resolves.toBe(true);

    expect(hoisted.isServiceDisconnectManualReviewRequiredForUser).not.toHaveBeenCalled();
    expect(hoisted.getServiceConnectionMeta).not.toHaveBeenCalled();
  });

  it('allows OAuth for non-Pro users when the token root requires manual review', async () => {
    hoisted.isServiceDisconnectManualReviewRequiredForUser.mockResolvedValue(true);

    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.GarminAPI)).resolves.toBe(true);

    expect(hoisted.isServiceDisconnectManualReviewRequiredForUser).toHaveBeenCalledWith('user-1', ServiceNames.GarminAPI);
    expect(hoisted.getServiceConnectionMeta).not.toHaveBeenCalled();
  });

  it('allows OAuth for non-Pro users when mirrored service meta requires manual review', async () => {
    hoisted.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'disconnect_pending',
      disconnectManualReviewRequired: true,
    });

    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.GarminAPI)).resolves.toBe(true);

    expect(hoisted.isServiceDisconnectManualReviewRequiredForUser).toHaveBeenCalledWith('user-1', ServiceNames.GarminAPI);
    expect(hoisted.getServiceConnectionMeta).toHaveBeenCalledWith('user-1', ServiceNames.GarminAPI);
  });

  it('rejects OAuth for non-Pro users without manual-review recovery state', async () => {
    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.COROSAPI)).resolves.toBe(false);
  });

  it('rejects OAuth when mirrored manual review is not in disconnect-pending state', async () => {
    hoisted.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'connected',
      disconnectManualReviewRequired: true,
    });

    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.COROSAPI)).resolves.toBe(false);
  });
});
