import { describe, expect, it } from 'vitest';
import { getDerivedMetricsUidAllowlist, isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';

describe('derived-metrics uid allowlist gate', () => {
  it('allows only values present in the hardcoded allowlist', () => {
    const allowlist = [...getDerivedMetricsUidAllowlist()];
    const allowedUid = allowlist[0];
    if (!allowedUid) {
      throw new Error('Expected non-empty derived metrics uid allowlist for test coverage');
    }
    expect(typeof allowedUid).toBe('string');
    expect(allowedUid.length).toBeGreaterThan(0);
    expect(isDerivedMetricsUidAllowed(allowedUid)).toBe(true);
    expect(isDerivedMetricsUidAllowed('not-allowlisted-uid')).toBe(false);
  });
});
