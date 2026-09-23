import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { DEFAULT_APP_LOCALE, getBrowserLocale, registerAppLocale } from './date-locale.config';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('date-locale.config', () => {

    describe('getBrowserLocale', () => {
        let originalNavigatorDescriptor: PropertyDescriptor | undefined;

        function setNavigator(value: unknown): void {
            Object.defineProperty(globalThis, 'navigator', {
                configurable: true,
                value,
            });
        }

        beforeEach(() => {
            originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        });

        afterEach(() => {
            if (originalNavigatorDescriptor) {
                Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'navigator');
            }
            vi.restoreAllMocks();
        });

        it('uses ordered browser language preferences ahead of the Intl default', () => {
            setNavigator({ language: 'pl-PL', languages: ['pl-PL', 'en-US'] });
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
                resolvedOptions: () => ({ locale: 'en-US' }),
            } as Intl.DateTimeFormat);

            expect(getBrowserLocale()).toBe('pl-PL');
        });

        it('uses the Intl default only when a browser navigator has no language fields', () => {
            setNavigator({});
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
                resolvedOptions: () => ({ locale: 'pl-PL' }),
            } as Intl.DateTimeFormat);

            expect(getBrowserLocale()).toBe('pl-PL');
        });

        it('should fall back to international English for unsupported locales', () => {
            setNavigator({ language: 'ja-JP', languages: ['ja-JP'] });

            expect(getBrowserLocale()).toBe(DEFAULT_APP_LOCALE);
        });

        it('uses a later supported navigator preference when the first is unsupported', () => {
            setNavigator({ language: 'pt-BR', languages: ['pt-BR', 'el-GR'] });

            expect(getBrowserLocale()).toBe('el-GR');
        });

        it('uses the deterministic fallback during server rendering', () => {
            setNavigator(undefined);
            const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat');

            expect(getBrowserLocale()).toBe(DEFAULT_APP_LOCALE);
            expect(dateTimeFormat).not.toHaveBeenCalled();
        });

        it('uses the deterministic fallback if the browser Intl fallback throws', () => {
            setNavigator({});
            vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
                throw new Error('Intl not supported');
            });

            expect(getBrowserLocale()).toBe(DEFAULT_APP_LOCALE);
        });

        it('uses registered international English for non-US English regions', () => {
            setNavigator({ language: 'en-GR', languages: ['en-GR'] });

            expect(getBrowserLocale()).toBe('en-GB');
        });

        it('preserves an explicit US English browser preference', () => {
            setNavigator({ language: 'en-US', languages: ['en-US'] });

            expect(getBrowserLocale()).toBe('en-US');
        });

        it('preserves US English when the browser locale includes Unicode extensions', () => {
            setNavigator({ language: 'en-US-u-nu-latn', languages: ['en-US-u-nu-latn'] });

            expect(getBrowserLocale()).toBe('en-US');
        });

        it('maps supported language variants to the registered regional locale', () => {
            setNavigator({ language: 'fr-CA', languages: ['fr-CA'] });

            expect(getBrowserLocale()).toBe('fr-FR');
        });
    });

    it.each([
        { locale: 'en-GB', date: '21/09/2026', number: '1,234.56', percent: '12%' },
        { locale: 'en-US', date: '9/21/26', number: '1,234.56', percent: '12%' },
        { locale: 'fr-FR', date: '21/09/2026', number: '1 234,56', percent: '12 %' },
        { locale: 'de-DE', date: '21.09.26', number: '1.234,56', percent: '12 %' },
        { locale: 'el-GR', date: '21/9/26', number: '1.234,56', percent: '12%' },
    ])('registers matching Angular date and numeric patterns for $locale', async ({ locale, date, number, percent }) => {
        await registerAppLocale(locale);
        const timestamp = Date.UTC(2026, 8, 21, 12);

        expect(new DatePipe(locale).transform(timestamp, 'shortDate', 'UTC')).toBe(date);
        expect(new DecimalPipe(locale).transform(1234.56, '1.2-2')?.replace(/\s/g, ' ')).toBe(number);
        expect(new PercentPipe(locale).transform(0.12, '1.0-0')?.replace(/\s/g, ' ')).toBe(percent);
    });
});
