import { afterEach, describe, expect, it } from 'vitest';
import { getDerivedMetricsUidAllowlistEnvKey, isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';

const ENV_KEY = getDerivedMetricsUidAllowlistEnvKey();

describe('derived-metrics uid allowlist gate', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('allows every uid when allowlist is not configured', () => {
    delete process.env[ENV_KEY];
    expect(isDerivedMetricsUidAllowed('user-a')).toBe(true);
    expect(isDerivedMetricsUidAllowed('user-b')).toBe(true);
  });

  it('allows only configured uid values', () => {
    process.env[ENV_KEY] = 'user-a,user-b';
    expect(isDerivedMetricsUidAllowed('user-a')).toBe(true);
    expect(isDerivedMetricsUidAllowed('user-b')).toBe(true);
    expect(isDerivedMetricsUidAllowed('user-c')).toBe(false);
  });

  it('supports newline/comma delimiters and trims whitespace', () => {
    process.env[ENV_KEY] = ' user-a ,\nuser-b \n\n';
    expect(isDerivedMetricsUidAllowed('user-a')).toBe(true);
    expect(isDerivedMetricsUidAllowed('user-b')).toBe(true);
    expect(isDerivedMetricsUidAllowed('user-c')).toBe(false);
  });
});

