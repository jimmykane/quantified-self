import { beforeEach, describe, expect, it, vi } from 'vitest';

let getNumberFormatter: typeof import('./number-format.helper').getNumberFormatter;

beforeEach(async () => {
  vi.resetModules();
  ({ getNumberFormatter } = await import('./number-format.helper'));
});

describe('shared number formatter cache', () => {
  it('reuses equivalent formatter options without caching values', () => {
    const formatter = getNumberFormatter('en-GB', { maximumFractionDigits: 1 });
    expect(getNumberFormatter('en-GB', { minimumFractionDigits: undefined, maximumFractionDigits: 1 })).toBe(formatter);
    expect(formatter.format(1234.56)).toBe('1,234.6');
    expect(formatter.format(9876.54)).toBe('9,876.5');
  });

  it('uses the app locale policy when callers omit a locale', () => {
    const formatter = getNumberFormatter(undefined, { maximumFractionDigits: 1 });
    expect(formatter.resolvedOptions().locale).toMatch(/^(en-GB|en-US|de|fr|es|it|nl|pl|el)/i);
  });

  it('preserves explicit locales and formatting options', () => {
    expect(getNumberFormatter('el-GR', { minimumFractionDigits: 2 }).format(1234.5))
      .toBe(new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2 }).format(1234.5));
  });

  it('evicts the least recently used entry instead of growing with arbitrary locales', () => {
    const oldest = getNumberFormatter('en-x-000');
    const active = getNumberFormatter('en-x-001');
    for (let index = 2; index < 64; index++) getNumberFormatter(`en-x-${String(index).padStart(3, '0')}`);
    expect(getNumberFormatter('en-x-001')).toBe(active);
    getNumberFormatter('en-x-064');
    expect(getNumberFormatter('en-x-001')).toBe(active);
    expect(getNumberFormatter('en-x-000')).not.toBe(oldest);
  });
});
