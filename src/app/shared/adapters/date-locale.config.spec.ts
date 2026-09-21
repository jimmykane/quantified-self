import { DatePipe } from '@angular/common';
import { DEFAULT_APP_LOCALE, getBrowserLocale, registerAppLocales } from './date-locale.config';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('date-locale.config', () => {

    describe('getBrowserLocale', () => {
        let originalNavigator: any;

        beforeEach(() => {
            // Save original navigator
            originalNavigator = global.navigator;
        });

        afterEach(() => {
            // Restore original navigator
            Object.defineProperty(global, 'navigator', {
                value: originalNavigator,
                writable: true
            });
            // Restore Intl
            vi.restoreAllMocks();
        });

        it('should return system locale if supported', () => {
            // Mock Intl.DateTimeFormat
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'pl-PL' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            expect(getBrowserLocale()).toBe('pl-PL');
        });

        it('should return detected locale if language code is in supported list (e.g. pl-PL includes pl)', () => {
            // Mock Intl.DateTimeFormat
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'pl-PL' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            expect(getBrowserLocale()).toBe('pl-PL');
        });

        it('should fall back to international English for unsupported locales', () => {
            // Mock Intl.DateTimeFormat
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'ja-JP' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP', languages: ['ja-JP'] },
                writable: true
            });

            expect(getBrowserLocale()).toBe(DEFAULT_APP_LOCALE);
        });

        it('should use a supported navigator preference when the resolved locale is unsupported', () => {
            // Mock Intl.DateTimeFormat
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'pt-BR' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            Object.defineProperty(global, 'navigator', {
                value: { language: 'pt-BR', languages: ['pt-BR', 'el-GR'] },
                writable: true
            });

            expect(getBrowserLocale()).toBe('el-GR');
        });

        it('should use navigator languages if Intl resolution throws', () => {
            vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
                throw new Error('Intl not supported');
            });

            Object.defineProperty(global, 'navigator', {
                value: { language: 'el-GR', languages: ['el-GR'] },
                writable: true
            });

            expect(getBrowserLocale()).toBe('el-GR');
        });

        it('uses registered international English for non-US English regions', () => {
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'en-GR' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            expect(getBrowserLocale()).toBe('en-GB');
        });
    });

    it('registers non-US English and Greek Angular date patterns', () => {
        registerAppLocales();
        const timestamp = Date.UTC(2026, 8, 21, 12);

        expect(new DatePipe('en-GB').transform(timestamp, 'shortDate', 'UTC')).toBe('21/09/2026');
        expect(new DatePipe('el-GR').transform(timestamp, 'shortDate', 'UTC')).toBe('21/9/26');
        expect(new DatePipe('en-US').transform(timestamp, 'shortDate', 'UTC')).toBe('9/21/26');
    });
});
