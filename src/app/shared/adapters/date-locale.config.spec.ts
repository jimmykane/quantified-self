import { getBrowserLocale } from './date-locale.config';
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

        it('should fallback to en-US for unsupported locales (e.g. ja-JP)', () => {
            // Mock Intl.DateTimeFormat
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'ja-JP' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            expect(getBrowserLocale()).toBe('en-US');
        });

        it('should fallback to en-US for unsupported language codes (e.g. pt-BR)', () => {
            // Mock Intl.DateTimeFormat
            const mockIntl = {
                resolvedOptions: () => ({ locale: 'pt-BR' })
            };
            vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue(mockIntl as any);

            expect(getBrowserLocale()).toBe('en-US');
        });

        it('should fallback to en-US if Intl throws', () => {
            vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
                throw new Error('Intl not supported');
            });

            // Mock navigator fallback also failing or being unsupported for test isolation
            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP' },
                writable: true
            });

            expect(getBrowserLocale()).toBe('en-US');
        });
    });
});
