import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { changeMarketingCampaignStatus } from './handlers';
import { deleteCampaign, dispatchCampaigns, getCampaign, setCampaignStatus } from './service';

vi.mock('./service');

const request = (overrides: Record<string, unknown> = {}) => ({
  data: { id: 'campaign_1234567890', action: 'delete' },
  auth: { uid: 'admin', token: { admin: true } },
  app: { appId: 'test-app' },
  ...overrides,
} as unknown as CallableRequest<Record<string, unknown>>);

describe('marketing draft deletion endpoint', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('FUNCTIONS_EMULATOR', 'false'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    { auth: undefined, code: 'unauthenticated' },
    { auth: { uid: 'user', token: { admin: false } }, code: 'permission-denied' },
    { app: undefined, code: 'failed-precondition' },
  ])('rejects requests with $code before deleting anything', async ({ code, ...overrides }) => {
    await expect(changeMarketingCampaignStatus.run(request(overrides))).rejects.toMatchObject({ code });
    expect(deleteCampaign).not.toHaveBeenCalled();
  });

  it('uses the deletion transition without rendering, starting dispatch or reading the deleted draft', async () => {
    const result = { id: 'campaign_1234567890', deleted: true as const };
    vi.mocked(deleteCampaign).mockResolvedValueOnce(result);
    expect(await changeMarketingCampaignStatus.run(request())).toEqual(result);
    expect(deleteCampaign).toHaveBeenCalledWith(result.id);
    expect(setCampaignStatus).not.toHaveBeenCalled();
    expect(dispatchCampaigns).not.toHaveBeenCalled();
    expect(getCampaign).not.toHaveBeenCalled();
  });
});
