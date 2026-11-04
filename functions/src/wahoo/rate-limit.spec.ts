import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { productionRequestCapacity, WAHOO_PRODUCTION_WINDOWS } from '../training-plans/delivery/request-capacity';

const { get, set, runTransaction } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), runTransaction: vi.fn() }));
vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}`, get }) }),
    runTransaction,
  }),
}));

import { extendWahooRateLimitCooldown, getWahooRateLimitCooldownSeconds, normalizeWahooRateLimitResetSeconds } from './rate-limit';

describe('Wahoo application quota cooldown', () => {
  const now = 1_700_000_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    get.mockResolvedValue({ data: () => undefined });
    runTransaction.mockImplementation(callback => callback({ get, set }));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([null, 0, -1, NaN, Infinity, 1_700_000_000])('uses a bounded fallback for invalid reset %s', value => {
    expect(normalizeWahooRateLimitResetSeconds(value)).toBe(300);
  });

  it('shares a seconds-based deadline with a small reset grace and no account data', async () => {
    expect(await extendWahooRateLimitCooldown(3600)).toBe(3605);
    expect(set).toHaveBeenCalledExactlyOnceWith(
      { path: 'trainingProviderCapacity/wahoo_86400000_app', get }, { notBeforeMs: now + 3_605_000 }, { merge: true },
    );
  });

  it('never shortens an already recorded deadline when concurrent rejections differ', async () => {
    get.mockResolvedValue({ data: () => ({ notBeforeMs: now + 7_200_000 }) });
    expect(await extendWahooRateLimitCooldown(300)).toBe(7200);
    expect(set).not.toHaveBeenCalled();
  });

  it('blocks Training through its existing capacity check and preserves its counters', async () => {
    const path = 'trainingProviderCapacity/wahoo_86400000_app';
    const buckets = [{ at: now, count: 7 }];
    const documents = new Map<string, Record<string, unknown>>([[path, { buckets, notBeforeMs: 0 }]]);
    get.mockImplementation((ref?: { path: string }) => Promise.resolve({ data: () => documents.get(ref?.path ?? path) }));
    set.mockImplementation((ref, value, options) => documents.set(ref.path, { ...(options?.merge ? documents.get(ref.path) : {}), ...value }));
    await extendWahooRateLimitCooldown(3600);
    const capacity = productionRequestCapacity(admin.firestore(), 'test-user', 'wahoo', 'test-account', WAHOO_PRODUCTION_WINDOWS, () => now);
    expect(await capacity.notBefore({ get } as unknown as admin.firestore.Transaction)).toBe(now + 3_605_000);
    expect(documents.get(path)?.buckets).toEqual(buckets);
  });

  it('returns the remaining cooldown and allows calls once it expires', async () => {
    get.mockResolvedValueOnce({ data: () => ({ notBeforeMs: now + 1001 }) })
      .mockResolvedValueOnce({ data: () => ({ notBeforeMs: now }) });
    expect(await getWahooRateLimitCooldownSeconds()).toBe(2);
    expect(await getWahooRateLimitCooldownSeconds()).toBe(0);
  });

  it('propagates storage failures so callers do not bypass a cooldown they cannot check', async () => {
    get.mockRejectedValueOnce(new Error('unavailable'));
    await expect(getWahooRateLimitCooldownSeconds()).rejects.toThrow('unavailable');
  });
});
