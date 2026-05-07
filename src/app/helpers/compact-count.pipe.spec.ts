import { describe, expect, it } from 'vitest';

import { CompactCountPipe, formatCompactCount } from './compact-count.pipe';

describe('formatCompactCount', () => {
  it('uses full number formatting below 10,000', () => {
    expect(formatCompactCount(9999, 'en-US')).toBe('9,999');
    expect(formatCompactCount(12.9, 'en-US')).toBe('12');
  });

  it('uses compact notation for 10,000 and above', () => {
    expect(formatCompactCount(10_000, 'en-US')).toBe('10K');
    expect(formatCompactCount(10_120, 'en-US')).toBe('10.12K');
    expect(formatCompactCount(1_000_000, 'en-US')).toBe('1M');
  });

  it('returns a dash for unavailable counts', () => {
    expect(formatCompactCount(null, 'en-US')).toBe('-');
    expect(formatCompactCount(Number.NaN, 'en-US')).toBe('-');
  });

  it('uses the injected locale in the pipe', () => {
    const pipe = new CompactCountPipe('en-US');

    expect(pipe.transform(10_120)).toBe('10.12K');
  });
});
