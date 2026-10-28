import { describe, expect, it } from 'vitest';
import { canDeleteMarketingCampaign } from '../../../shared/admin-marketing';

const ready = { status: 'ready', startedAt: null,
  stats: { eligible: 569, pending: 569, queued: 0, accepted: 0, failed: 0, skipped: 0 } };

describe('marketing campaign deletion eligibility', () => {
  it('allows drafts, cleanup retries and prepared audiences before Start', () => {
    expect(canDeleteMarketingCampaign({ status: 'draft' })).toBe(true);
    expect(canDeleteMarketingCampaign({ status: 'deleting' })).toBe(true);
    expect(canDeleteMarketingCampaign(ready)).toBe(true);
    expect(canDeleteMarketingCampaign({ ...ready, startedAt: undefined })).toBe(true);
  });

  it.each(['preparing', 'running', 'paused', 'completed', 'unknown'])('protects %s campaigns', status => {
    expect(canDeleteMarketingCampaign({ ...ready, status })).toBe(false);
  });

  it('protects campaigns after Start even before scheduled submissions', () => {
    expect(canDeleteMarketingCampaign({ ...ready, startedAt: '2026-10-06T09:00:00Z' })).toBe(false);
  });

  it.each(['queued', 'accepted', 'failed', 'skipped'])('protects campaigns with %s recipients', field => {
    expect(canDeleteMarketingCampaign({ ...ready, stats: { ...ready.stats, [field]: 1 } })).toBe(false);
  });

  it('rejects missing campaigns and incomplete prepared delivery stats', () => {
    expect(canDeleteMarketingCampaign(null)).toBe(false);
    expect(canDeleteMarketingCampaign(undefined)).toBe(false);
    expect(canDeleteMarketingCampaign({ ...ready, stats: undefined })).toBe(false);
    expect(canDeleteMarketingCampaign({ ...ready, stats: { queued: 0 } })).toBe(false);
  });
});
