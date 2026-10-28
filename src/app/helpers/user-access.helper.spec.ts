import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUserInterface } from '../models/app-user.interface';
import { AppUserAccess } from './user-access.helper';

const profile = (properties: object): AppUserInterface => properties as AppUserInterface;

describe('account access policy', () => {
  const now = Date.UTC(2026, 9, 27);

  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [null, false, false, false, false],
    [profile({}), false, false, false, false],
    [profile({ stripeRole: 'basic' }), false, false, true, true],
    [profile({ stripeRole: 'pro' }), false, true, false, true],
    [profile({ isPro: true }), false, true, false, true],
    [profile({ isPro: 'true', stripeRole: 'unknown' }), false, false, false, false],
    [profile({}), true, true, false, true],
    [null, true, false, false, false],
    [profile({ stripeRole: 'basic', gracePeriodUntil: now + 1 }), false, true, true, true],
    [profile({ gracePeriodUntil: now }), false, false, false, false],
    [profile({ gracePeriodUntil: now - 1 }), false, false, false, false],
  ])('preserves Pro, Basic and paid access for %j (admin %j)', (user, admin, pro, basic, paid) => {
    expect(AppUserAccess.hasProAccess(user, admin)).toBe(pro);
    expect(AppUserAccess.isBasicUser(user)).toBe(basic);
    expect(AppUserAccess.hasPaidAccessUser(user, admin)).toBe(paid);
  });

  it.each([
    now + 1000,
    new Date(now + 1000),
    { toMillis: () => now + 1000 },
    { seconds: (now + 1000) / 1000, nanoseconds: 0 },
  ])('retains supported grace timestamp representations: %j', gracePeriodUntil => {
    const user = profile({ gracePeriodUntil });
    expect(AppUserAccess.getGracePeriodExpiryMs(user)).toBe(now + 1000);
    expect(AppUserAccess.isGracePeriodActive(user)).toBe(true);
    expect(AppUserAccess.isProUser(user)).toBe(false);
    expect(AppUserAccess.hasProAccess(user)).toBe(true);
  });

  it.each([undefined, null, '', '2099-01-01', {}, NaN, Infinity, new Date('invalid'),
    { seconds: '99999999999' }, { toMillis: () => NaN }])('rejects unsupported grace timestamps: %j', gracePeriodUntil => {
    expect(AppUserAccess.getGracePeriodExpiryMs(profile({ gracePeriodUntil }))).toBeNull();
    expect(AppUserAccess.hasPaidAccessUser(profile({ gracePeriodUntil }))).toBe(false);
  });

  it('keeps timestamp method precedence and strict expiry behavior', () => {
    const user = profile({ gracePeriodUntil: { toMillis: () => now, seconds: (now + 1000) / 1000 } });
    expect(AppUserAccess.getGracePeriodExpiryMs(user)).toBe(now);
    expect(AppUserAccess.isGracePeriodActive(user)).toBe(false);
  });
});
