import { describe, expect, it } from 'vitest';
import { getDerivedMetricsUidAllowlist, isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';

describe('derived-metrics uid allowlist gate', () => {
  it('allows all non-empty UIDs when allowlist is empty (gate disabled)', () => {
    expect(getDerivedMetricsUidAllowlist().size).toBe(0);
    expect(isDerivedMetricsUidAllowed('xcsAolLDDTWTgtRN9eYF3lW2YKL2')).toBe(true);
    expect(isDerivedMetricsUidAllowed('not-allowlisted-uid')).toBe(true);
    expect(isDerivedMetricsUidAllowed('')).toBe(false);
    expect(isDerivedMetricsUidAllowed('   ')).toBe(false);
  });
});
