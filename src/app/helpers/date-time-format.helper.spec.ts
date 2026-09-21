import { beforeEach, describe, expect, it, vi } from 'vitest';

let getDateTimeFormatter: typeof import('./date-time-format.helper').getDateTimeFormatter;
let getLocalDateTimeFormatter: typeof import('./date-time-format.helper').getLocalDateTimeFormatter;
beforeEach(async () => {
  vi.resetModules();
  ({ getDateTimeFormatter, getLocalDateTimeFormatter } = await import('./date-time-format.helper'));
});

describe('shared date formatter cache', () => {
  it('reuses equivalent options across call sites without caching timestamps', () => {
    const formatter = getDateTimeFormatter('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    expect(getDateTimeFormatter('en-GB', { timeZone: 'UTC', day: 'numeric', year: undefined, month: 'short' })).toBe(formatter);
    expect(formatter.format(Date.UTC(2026, 8, 2))).toBe('2 Sept');
    expect(formatter.format(Date.UTC(2026, 8, 3))).toBe('3 Sept');
  });
  it('preserves locales, recorded timezone choices and formatting options', () => {
    const timestamp = Date.UTC(2026, 8, 2, 22, 30);
    const utc = getDateTimeFormatter('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
    for (const locale of ['en-US', 'el-GR', 'fi-FI']) {
      for (const timeZone of ['UTC', 'Europe/Helsinki', 'America/New_York']) {
        const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', timeZone };
        const formatter = getDateTimeFormatter(locale, options);
        expect(formatter).not.toBe(utc);
        expect(formatter.format(timestamp)).toBe(new Intl.DateTimeFormat(locale, options).format(timestamp));
        expect(formatter.formatToParts(timestamp)).toEqual(new Intl.DateTimeFormat(locale, options).formatToParts(timestamp));
      }
    }
  });
  it('does not freeze the device timezone and does not reuse mutated caller options', () => {
    expect(getDateTimeFormatter(undefined, { month: 'short' }))
      .not.toBe(getDateTimeFormatter(undefined, { month: 'short' }));
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'short' };
    const first = getDateTimeFormatter(undefined, options);
    options.month = 'long';
    expect(getDateTimeFormatter(undefined, options)).not.toBe(first);
    expect(first.resolvedOptions().month).toBe('short');
  });
  it('uses the app locale policy when callers omit a locale', () => {
    const formatter = getDateTimeFormatter(undefined, { dateStyle: 'short', timeZone: 'UTC' });
    expect(formatter.resolvedOptions().locale).toMatch(/^(en-GB|en-US|de|fr|es|it|nl|pl|el)/i);
  });
  it('evicts the least recently used entry instead of growing with arbitrary locales', () => {
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'short' };
    const oldest = getDateTimeFormatter('en-x-000', options);
    const active = getDateTimeFormatter('en-x-001', options);
    for (let index = 2; index < 64; index++) getDateTimeFormatter(`en-x-${String(index).padStart(3, '0')}`, options);
    expect(getDateTimeFormatter('en-x-001', options)).toBe(active);
    getDateTimeFormatter('en-x-064', options);
    expect(getDateTimeFormatter('en-x-001', options)).toBe(active);
    expect(getDateTimeFormatter('en-x-000', options)).not.toBe(oldest);
  });
  it('retains Intl validation errors without poisoning later calls', () => {
    expect(() => getDateTimeFormatter('en', { timeZone: 'Invalid/Zone' })).toThrow(RangeError);
    expect(getDateTimeFormatter('en', { timeZone: 'UTC' }).resolvedOptions().timeZone).toBe('UTC');
  });
  it('preserves the date, time, and seconds shown by the default local date-time format', () => {
    const value = new Date(2026, 8, 21, 13, 14, 15);
    for (const locale of ['en-GB', 'en-US', 'el-GR']) {
      expect(getLocalDateTimeFormatter(locale).format(value)).toBe(value.toLocaleString(locale));
    }
  });
});
