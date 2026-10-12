import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { changeMarketingCampaignStatus, dispatchMarketingCampaigns, trackMarketingDelivery } from './handlers';
import { deleteCampaign, dispatchCampaigns, getCampaign, recordMailDelivery, setCampaignStatus } from './service';
import { observeEmailOutbox } from '../../email/monitoring-probe';
import * as logger from 'firebase-functions/logger';

vi.mock('./service');
vi.mock('../../email/monitoring-probe');

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

describe('email monitoring reuses existing handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MARKETING_UNSUBSCRIBE_SIGNING_KEY', 'x'.repeat(40));
    vi.mocked(dispatchCampaigns).mockResolvedValue(0);
    vi.mocked(recordMailDelivery).mockResolvedValue(undefined);
    vi.mocked(observeEmailOutbox).mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());
  const tick = (scheduleTime: string) => ({ scheduleTime } as Parameters<typeof dispatchMarketingCampaigns.run>[0]);
  it('observes only UTC quarter-hour scheduler ticks, including idle/capped dispatches', async () => {
    await dispatchMarketingCampaigns.run(tick('2026-10-12T08:05:00Z'));
    expect(observeEmailOutbox).not.toHaveBeenCalled();
    await dispatchMarketingCampaigns.run(tick('2026-10-12T08:15:00Z'));
    expect(observeEmailOutbox).toHaveBeenCalledTimes(1);
  });
  it('still observes on a dispatcher failure while preserving its original exception', async () => {
    const error = new Error('synthetic failure'); vi.mocked(dispatchCampaigns).mockRejectedValueOnce(error);
    await expect(dispatchMarketingCampaigns.run(tick('2026-10-12T08:30:00Z'))).rejects.toBe(error);
    expect(observeEmailOutbox).toHaveBeenCalledTimes(1);
  });
  it('an unexpected monitoring/client failure cannot replace dispatch success or its original error', async () => {
    vi.mocked(observeEmailOutbox).mockRejectedValue(new Error('private probe failure'));
    await expect(dispatchMarketingCampaigns.run(tick('2026-10-12T08:30:00Z'))).resolves.toBeUndefined();
    const original = new Error('original dispatch failure'); vi.mocked(dispatchCampaigns).mockRejectedValueOnce(original);
    await expect(dispatchMarketingCampaigns.run(tick('2026-10-12T08:45:00Z'))).rejects.toBe(original);
    expect(vi.mocked(logger.warn).mock.calls.every(call => (call[1] as Record<string, unknown>)?.event === 'outbox_sample_unavailable')).toBe(true);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });
  it('observes transactional SMTP errors without altering marketing tracking input', async () => {
    const before = { delivery: { state: 'PROCESSING' } };
    const after = { to: 'private@example.invalid', message: { text: 'private canary' }, delivery: { state: 'ERROR', error: 'private SMTP error' } };
    await trackMarketingDelivery.run({ params: { mailId: 'opaque' }, data: { before: { data: () => before }, after: { data: () => after } } } as unknown as Parameters<typeof trackMarketingDelivery.run>[0]);
    expect(recordMailDelivery).toHaveBeenCalledExactlyOnceWith('opaque', before, after);
    expect(vi.mocked(logger.warn).mock.calls[0][1]).toMatchObject({ source: 'transactional', state: 'error' });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });
  it('tracker failures preserve their exception and produce only a fixed failure category', async () => {
    const error = new Error('private tracking error'); vi.mocked(recordMailDelivery).mockRejectedValueOnce(error);
    await expect(trackMarketingDelivery.run({ params: { mailId: 'opaque' }, data: { before: { data: () => ({}) }, after: { data: () => ({}) } } } as unknown as Parameters<typeof trackMarketingDelivery.run>[0])).rejects.toBe(error);
    expect(vi.mocked(logger.warn).mock.calls[0][1]).toMatchObject({ operation: 'tracking', outcome: 'failed' });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });
});
