import { describe, expect, it, vi } from 'vitest';
import type { SleepSession } from '@shared/sleep';
import { nightlyHealthAccountKey } from '@shared/nightly-hrv';
import { withHealthSleepAccountKeys } from './health-sleep-account.helper';

function sleepSession(): SleepSession {
  return { id: 'sleep-one', userID: 'owner',
    source: { provider: 'GarminAPI', providerUserId: 'provider-user', sourceSessionKey: 'night' },
    sleepDate: '2026-09-01', startTimeMs: 1, endTimeMs: 2, durationSeconds: 1,
    isNap: false, stages: [], stageDurationsSeconds: {}, vitals: { overnightHrvMs: 33 }, createdAtMs: 1, updatedAtMs: 2 };
}

describe('read-time Sleep account matching', () => {
  it('hashes each account once per read and reuses its existing identity without mutation', async () => {
    const first = sleepSession();
    const second = { ...first, id: 'second-night' };
    const other = { ...first, id: 'other-account', source: { ...first.source, providerUserId: 'other-provider-user' } };
    const expectedKey = await nightlyHealthAccountKey('owner', 'GarminAPI', first.source.providerUserId);
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
    try {
      const loaded = await withHealthSleepAccountKeys('owner', [first, second, other]);
      expect(digest).toHaveBeenCalledTimes(2);
      expect(loaded[0].healthAccountKey).toBe(expectedKey);
      expect(loaded[1].healthAccountKey).toBe(expectedKey);
      expect(loaded[2].healthAccountKey).not.toBe(expectedKey);
      expect(first).not.toHaveProperty('healthAccountKey');
      const reused = await withHealthSleepAccountKeys('owner', loaded);
      expect(reused[0]).toBe(loaded[0]);
      expect(digest).toHaveBeenCalledTimes(2);
    } finally {
      digest.mockRestore();
    }
  });

  it('retains native evidence when hashing fails or the account is unidentified or foreign', async () => {
    const session = sleepSession();
    const unidentified = { ...session, source: { ...session.source, providerUserId: undefined } };
    const foreign = { ...session, userID: 'other-owner' };
    const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('Secure matching unavailable'));
    try {
      const loaded = await withHealthSleepAccountKeys('owner', [session, unidentified, foreign]);
      expect(loaded).toEqual([session, unidentified, foreign]);
      expect(digest).toHaveBeenCalledOnce();
      expect(loaded.every(item => !item.healthAccountKey)).toBe(true);
    } finally {
      digest.mockRestore();
    }
  });
});
