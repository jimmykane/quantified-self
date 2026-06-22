import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  hasProAccess: vi.fn(),
  isServiceDisconnectManualReviewRequiredForUser: vi.fn(),
}));

vi.mock('./utils', () => ({
  hasProAccess: hoisted.hasProAccess,
}));

vi.mock('./service-disconnect-pending', () => ({
  isServiceDisconnectManualReviewRequiredForUser: hoisted.isServiceDisconnectManualReviewRequiredForUser,
}));

import { hasServiceOAuthConnectAccess } from './service-oauth-access';

describe('service-oauth-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasProAccess.mockResolvedValue(false);
    hoisted.isServiceDisconnectManualReviewRequiredForUser.mockResolvedValue(false);
  });

  it('allows OAuth for Pro users without reading pending manual-review state', async () => {
    hoisted.hasProAccess.mockResolvedValue(true);

    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.SuuntoApp)).resolves.toBe(true);

    expect(hoisted.isServiceDisconnectManualReviewRequiredForUser).not.toHaveBeenCalled();
  });

  it('allows OAuth for non-Pro users only when the service pending disconnect requires manual review', async () => {
    hoisted.isServiceDisconnectManualReviewRequiredForUser.mockResolvedValue(true);

    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.GarminAPI)).resolves.toBe(true);

    expect(hoisted.isServiceDisconnectManualReviewRequiredForUser).toHaveBeenCalledWith('user-1', ServiceNames.GarminAPI);
  });

  it('rejects OAuth for non-Pro users without manual-review recovery state', async () => {
    await expect(hasServiceOAuthConnectAccess('user-1', ServiceNames.COROSAPI)).resolves.toBe(false);
  });
});
